package handlers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // Decode template photos and avatars.
	_ "image/png"
	"io"
	"log"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/screenshottemplates"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/uptrace/bun"
	_ "golang.org/x/image/webp" // Decode template photos and avatars.
)

const (
	maxTemplateImageBytes  = 20 << 20
	maxTemplateImagePixels = 40_000_000
	templateRenderWait     = 10 * time.Second
)

// templateRenderSlots bounds CPU-heavy template rendering across previews,
// exports and build commits. A short wait is better than failing a live
// preview, and the bound keeps a burst from starving the API.
var templateRenderSlots = make(chan struct{}, max(2, runtime.GOMAXPROCS(0)))

func acquireTemplateRender(ctx context.Context) (func(), error) {
	timer := time.NewTimer(templateRenderWait)
	defer timer.Stop()
	select {
	case templateRenderSlots <- struct{}{}:
		return func() { <-templateRenderSlots }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, huma.Error503ServiceUnavailable("the image renderer is busy; try again shortly")
	}
}

// ScreenshotTemplateRenderer is the single renderer for screenshot templates
// and memes. Editor previews, exports, mobile and headless build commits all
// receive the same pixels from it.
type ScreenshotTemplateRenderer struct {
	db      *bun.DB
	storage mediastore.BlobStorage
	media   *MediaHandler
	memes   *MemeHandler
}

func NewScreenshotTemplateRenderer(db *bun.DB, storage mediastore.BlobStorage, media *MediaHandler) *ScreenshotTemplateRenderer {
	return &ScreenshotTemplateRenderer{db: db, storage: storage, media: media}
}

// SetMemes binds the meme renderer once routes construct it.
func (r *ScreenshotTemplateRenderer) SetMemes(memes *MemeHandler) { r.memes = memes }

// Render rasterizes a non-meme template document at scale.
func (r *ScreenshotTemplateRenderer) Render(ctx context.Context, workspaceID string, doc ScreenshotTemplateDocument, scale float64) (screenshottemplates.Rendered, error) {
	if doc.Meme != nil {
		return screenshottemplates.Rendered{}, huma.Error400BadRequest(screenshottemplates.ErrUnsupported.Error())
	}
	if err := validateScreenshotTemplateDocument(doc); err != nil {
		return screenshottemplates.Rendered{}, huma.Error400BadRequest(err.Error())
	}
	release, err := acquireTemplateRender(ctx)
	if err != nil {
		return screenshottemplates.Rendered{}, err
	}
	defer release()
	rendered, err := screenshottemplates.Render(ctx, doc, r.imageSource(workspaceID), scale)
	if err != nil {
		return screenshottemplates.Rendered{}, templateRenderError(err)
	}
	return rendered, nil
}

// RenderVisual implements publicationbuilder.VisualRenderer.
func (r *ScreenshotTemplateRenderer) RenderVisual(ctx context.Context, workspaceID, userID string, doc ScreenshotTemplateDocument) (models.MediaAttachment, error) {
	return r.Export(ctx, workspaceID, userID, doc)
}

// Export renders a document at publishing size, imports it as Media library
// media and stores its editable recipe. An identical ready export is reused,
// so retried build commits and repeated exports do not duplicate media.
func (r *ScreenshotTemplateRenderer) Export(ctx context.Context, workspaceID, userID string, doc ScreenshotTemplateDocument) (models.MediaAttachment, error) {
	if doc.Meme != nil {
		return r.exportMeme(ctx, workspaceID, userID, *doc.Meme)
	}
	if r.media == nil || r.db == nil {
		return models.MediaAttachment{}, huma.Error503ServiceUnavailable("template media storage is not configured")
	}
	documentJSON, err := json.Marshal(doc)
	if err != nil {
		return models.MediaAttachment{}, huma.Error400BadRequest("template document is invalid")
	}
	if media, ok, err := r.existingExport(ctx, workspaceID, string(documentJSON)); err != nil || ok {
		return media, err
	}
	rendered, err := r.Render(ctx, workspaceID, doc, screenshottemplates.ExportScale)
	if err != nil {
		return models.MediaAttachment{}, err
	}
	data, err := screenshottemplates.EncodePNG(rendered.Image)
	if err != nil {
		return models.MediaAttachment{}, huma.Error500InternalServerError("failed to encode the template image")
	}
	var created models.MediaAttachment
	result, err := r.media.processUploadBytes(ctx, mediaUploadBytesInput{
		WorkspaceID: workspaceID, Filename: templateExportFilename(doc.Title), DeclaredMimeType: "image/png",
		Size: int64(len(data)), Content: data, Source: "screenshot_template", AssetKind: "library",
		RetentionClass: "library", OnCreated: func(media models.MediaAttachment) { created = media },
	})
	if err != nil {
		return models.MediaAttachment{}, err
	}
	mediaID, _ := result["id"].(string)
	var media models.MediaAttachment
	if err := r.db.NewSelect().Model(&media).Where("id = ? AND workspace_id = ?", mediaID, workspaceID).Scan(ctx); err != nil {
		return models.MediaAttachment{}, huma.Error500InternalServerError("failed to read the template image")
	}
	recipe := models.MediaGenerationRecipe{
		MediaID: media.ID, WorkspaceID: workspaceID, CreatedByID: userID, Kind: "screenshot_template",
		RendererKey: screenshotTemplateRenderer, TemplateID: doc.TemplateID, TemplateName: doc.Title,
		CatalogRevision: "1", RecipeJSON: string(documentJSON), CreatedAt: time.Now().UTC(),
	}
	if err := saveScreenshotTemplateRecipe(ctx, r.db, workspaceID, media.ID, doc, recipe); err != nil {
		if created.ID != "" {
			r.rollback(ctx, created)
		}
		return models.MediaAttachment{}, err
	}
	return media, nil
}

// rollback removes media created by a failed export so no orphan remains.
func (r *ScreenshotTemplateRenderer) rollback(ctx context.Context, media models.MediaAttachment) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), memeCleanupTimeout)
	defer cancel()
	if err := (mediaHandlerMemeImporter{handler: r.media}).RollbackMeme(cleanup, media); err != nil {
		log.Printf("failed to roll back template export media %s (%T)", media.ID, err)
	}
}

func (r *ScreenshotTemplateRenderer) exportMeme(ctx context.Context, workspaceID, userID string, meme ScreenshotTemplateMeme) (models.MediaAttachment, error) {
	if r.memes == nil || r.memes.provider == nil {
		return models.MediaAttachment{}, huma.Error503ServiceUnavailable("the meme generator is not enabled")
	}
	media, _, _, _, err := r.memes.renderAndSave(ctx, memeSaveInput{
		WorkspaceID: workspaceID, UserID: userID, TemplateID: meme.TemplateID, Format: meme.Format,
		RetentionClass: "library", AltText: strings.TrimSpace(meme.AltText), ParentMediaID: meme.ParentMediaID,
		Captions: meme.Captions, OverlayMediaIDs: meme.OverlayMediaIDs,
	})
	return media, err
}

func (r *ScreenshotTemplateRenderer) existingExport(ctx context.Context, workspaceID, documentJSON string) (models.MediaAttachment, bool, error) {
	var media models.MediaAttachment
	err := r.db.NewSelect().Model(&media).
		Join("JOIN media_generation_recipes AS recipe ON recipe.media_id = media_attachment.id").
		Where("recipe.workspace_id = ? AND recipe.kind = ? AND recipe.renderer_key = ? AND recipe.recipe_json = ?", workspaceID, "screenshot_template", screenshotTemplateRenderer, documentJSON).
		Where("media_attachment.processing_status = ? AND media_attachment.trashed_at IS NULL", mediaReadyStatus).
		Limit(1).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.MediaAttachment{}, false, nil
	}
	if err != nil {
		return models.MediaAttachment{}, false, huma.Error500InternalServerError("failed to look up template exports")
	}
	return media, true, nil
}

// saveScreenshotTemplateRecipe stores an export's immutable recipe and keeps
// its source images retained. A retry may only reuse the identical recipe.
func saveScreenshotTemplateRecipe(ctx context.Context, db *bun.DB, workspaceID, mediaID string, doc ScreenshotTemplateDocument, recipe models.MediaGenerationRecipe) error {
	ids := screenshotTemplateMediaIDs(doc)
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := validateScreenshotTemplateMedia(ctx, tx, workspaceID, doc); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(&recipe).On("CONFLICT (media_id) DO NOTHING").Exec(ctx); err != nil {
			return huma.Error500InternalServerError("failed to save template recipe")
		}
		var saved models.MediaGenerationRecipe
		if err := tx.NewSelect().Model(&saved).Where("media_id = ?", mediaID).Scan(ctx); err != nil {
			return huma.Error500InternalServerError("failed to read template recipe")
		}
		if saved.RecipeJSON != recipe.RecipeJSON || saved.Kind != "screenshot_template" {
			return huma.Error409Conflict("this media already has a different recipe")
		}
		for _, id := range ids {
			ref := models.ScreenshotTemplateRecipeMediaReference{ExportMediaID: mediaID, MediaID: id}
			if _, err := tx.NewInsert().Model(&ref).On("CONFLICT DO NOTHING").Exec(ctx); err != nil {
				return huma.Error500InternalServerError("failed to retain template images")
			}
		}
		return nil
	})
}

// imageSource loads ready workspace images once per render.
func (r *ScreenshotTemplateRenderer) imageSource(workspaceID string) screenshottemplates.ImageSource {
	var mu sync.Mutex
	cache := map[string]image.Image{}
	return func(ctx context.Context, mediaID string) (image.Image, error) {
		mu.Lock()
		defer mu.Unlock()
		if img, ok := cache[mediaID]; ok {
			return img, nil
		}
		img, err := r.loadImage(ctx, workspaceID, mediaID)
		if err != nil {
			return nil, err
		}
		cache[mediaID] = img
		return img, nil
	}
}

func (r *ScreenshotTemplateRenderer) loadImage(ctx context.Context, workspaceID, mediaID string) (image.Image, error) {
	if r.db == nil || r.storage == nil {
		return nil, huma.Error503ServiceUnavailable("template media storage is not configured")
	}
	var media models.MediaAttachment
	err := r.db.NewSelect().Model(&media).Where("id = ? AND workspace_id = ?", mediaID, workspaceID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error400BadRequest("template images must belong to this workspace")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load template image")
	}
	if !media.TrashedAt.IsZero() || media.ProcessingStatus != mediaReadyStatus {
		return nil, huma.Error400BadRequest("template images must be ready and outside Trash")
	}
	switch strings.ToLower(strings.TrimSpace(media.MimeType)) {
	case "image/png", "image/jpeg", "image/webp":
	default:
		return nil, huma.Error400BadRequest("template images must be PNG, JPEG or WebP")
	}
	if media.Size > maxTemplateImageBytes || int64(media.Width)*int64(media.Height) > maxTemplateImagePixels {
		return nil, huma.Error400BadRequest("a template image is too large; use one under 20 MB and 40 megapixels")
	}
	reader, err := r.storage.Open(ctx, filepath.Base(media.FilePath))
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to open template image")
	}
	data, readErr := io.ReadAll(io.LimitReader(reader, maxTemplateImageBytes+1))
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || len(data) > maxTemplateImageBytes {
		return nil, huma.Error500InternalServerError("failed to read template image")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || int64(config.Width)*int64(config.Height) > maxTemplateImagePixels {
		return nil, huma.Error400BadRequest("a template image could not be decoded")
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, huma.Error400BadRequest("a template image could not be decoded")
	}
	return img, nil
}

func templateRenderError(err error) error {
	var status huma.StatusError
	switch {
	case errors.As(err, &status):
		return err
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	case errors.Is(err, screenshottemplates.ErrOverflow), errors.Is(err, screenshottemplates.ErrTooTall):
		return huma.Error422UnprocessableEntity(err.Error())
	default:
		return huma.Error400BadRequest(fmt.Sprintf("the template could not be rendered: %v", err))
	}
}

func templateExportFilename(title string) string {
	var name strings.Builder
	for _, r := range strings.TrimSpace(title) {
		switch {
		case r == '/' || r == '\\' || r < 0x20 || r == 0x7f:
			continue
		case name.Len() >= 100:
		default:
			name.WriteRune(r)
		}
	}
	if strings.TrimSpace(name.String()) == "" {
		return "template.png"
	}
	return strings.TrimSpace(name.String()) + ".png"
}
