package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/screenshottemplates"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/openpost/backend/internal/services/workspaceaccess"
	"github.com/uptrace/bun"
)

type ScreenshotTemplateHandler struct {
	db       *bun.DB
	auth     middleware.Authenticator
	renderer *ScreenshotTemplateRenderer
	limiter  *ratelimit.Limiter
}

func NewScreenshotTemplateHandler(db *bun.DB, auth middleware.Authenticator, renderer *ScreenshotTemplateRenderer) *ScreenshotTemplateHandler {
	return &ScreenshotTemplateHandler{db: db, auth: auth, renderer: renderer, limiter: ratelimit.New()}
}

// Live previews follow typing. Rendering is bounded by shared slots, so the
// per-user cap only stops runaway clients.
const screenshotTemplatePreviewsPerMinute = 240

type PreviewScreenshotTemplateInput struct {
	Body struct {
		WorkspaceID string                     `json:"workspace_id" minLength:"1"`
		Document    ScreenshotTemplateDocument `json:"document"`
		Scale       float64                    `json:"scale,omitempty" enum:"1,2" doc:"Device pixel ratio of the preview. Defaults to 2."`
	}
}

type PreviewScreenshotTemplateOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		MIMEType   string                       `json:"mime_type"`
		DataBase64 string                       `json:"data_base64" doc:"Base64-encoded JPEG preview from the publishing renderer"`
		Width      int                          `json:"width" doc:"Pixel width of the preview image"`
		Height     int                          `json:"height" doc:"Pixel height of the preview image"`
		Scale      float64                      `json:"scale"`
		Regions    []screenshottemplates.Region `json:"regions" nullable:"false" doc:"Selectable content boxes in CSS pixels at the 540 px template width"`
	}
}

type ScreenshotTemplateDesignSummary struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Title       string    `json:"title"`
	TemplateID  string    `json:"template_id"`
	Revision    int       `json:"revision"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type ScreenshotTemplateDesignResponse struct {
	ScreenshotTemplateDesignSummary
	CanEdit  bool                       `json:"can_edit"`
	Document ScreenshotTemplateDocument `json:"document"`
}

type ListScreenshotTemplateDesignsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Limit       int    `query:"limit" default:"40" minimum:"1" maximum:"100"`
	Offset      int    `query:"offset" default:"0" minimum:"0"`
}
type ListScreenshotTemplateDesignsOutput struct {
	Body struct {
		Designs []ScreenshotTemplateDesignSummary `json:"designs"`
		Total   int                               `json:"total"`
		CanEdit bool                              `json:"can_edit"`
	}
}
type CreateScreenshotTemplateDesignInput struct {
	Body struct {
		WorkspaceID string                     `json:"workspace_id" minLength:"1"`
		Document    ScreenshotTemplateDocument `json:"document"`
	}
}
type ScreenshotTemplateDesignOutput struct {
	Body ScreenshotTemplateDesignResponse
}
type GetScreenshotTemplateDesignInput struct {
	ID string `path:"id"`
}
type UpdateScreenshotTemplateDesignInput struct {
	ID   string `path:"id"`
	Body struct {
		Revision int                        `json:"revision" minimum:"1"`
		Document ScreenshotTemplateDocument `json:"document"`
	}
}
type DeleteScreenshotTemplateDesignOutput struct{ Status int }
type SaveScreenshotTemplateExportInput struct {
	ID   string `path:"id"`
	Body struct {
		Revision int    `json:"revision" minimum:"1"`
		MediaID  string `json:"media_id,omitempty" doc:"A PNG the client rendered. Omit it to have the server render and save the export."`
	}
}
type ScreenshotTemplateRecipeInput struct {
	MediaID string `path:"media_id"`
}
type ScreenshotTemplateRecipeOutput struct {
	Body struct {
		WorkspaceID string                     `json:"workspace_id"`
		Document    ScreenshotTemplateDocument `json:"document"`
		Media       *MediaUploadResult         `json:"media,omitempty" doc:"The exported image when the server rendered it"`
	}
}

func (h *ScreenshotTemplateHandler) RegisterRoutes(api huma.API) {
	operation := func(id, method, path, summary string) huma.Operation {
		return huma.Operation{OperationID: id, Method: method, Path: path, Summary: summary,
			Tags: []string{tagMedia}, MaxBodyBytes: 256*1024 + 1,
			Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
			Errors:      []int{400, 401, 403, 404, 409, 500}}
	}
	huma.Register(api, operation("list-screenshot-template-designs", http.MethodGet, "/screenshot-templates/designs", "List screenshot template designs"), h.list)
	huma.Register(api, operation("create-screenshot-template-design", http.MethodPost, "/screenshot-templates/designs", "Create a screenshot template design"), h.create)
	huma.Register(api, operation("get-screenshot-template-design", http.MethodGet, "/screenshot-templates/designs/{id}", "Get a screenshot template design"), h.get)
	huma.Register(api, operation("update-screenshot-template-design", http.MethodPut, "/screenshot-templates/designs/{id}", "Save a screenshot template design"), h.update)
	huma.Register(api, operation("delete-screenshot-template-design", http.MethodDelete, "/screenshot-templates/designs/{id}", "Delete a screenshot template design"), h.delete)
	huma.Register(api, operation("save-screenshot-template-export", http.MethodPost, "/screenshot-templates/designs/{id}/exports", "Export a screenshot template design"), h.saveExport)
	preview := operation("preview-screenshot-template", http.MethodPost, "/screenshot-templates/previews", "Preview a screenshot template with the publishing renderer")
	preview.Errors = append(preview.Errors, 422, 429, 503)
	huma.Register(api, preview, h.preview)
	huma.Register(api, operation("get-screenshot-template-recipe", http.MethodGet, "/screenshot-templates/recipes/{media_id}", "Get the editable recipe for a screenshot export"), h.recipe)
}

func (h *ScreenshotTemplateHandler) access(ctx context.Context, workspaceID string, level workspaceaccess.Level) (bool, error) {
	decision, err := workspaceDecision(ctx, h.db, workspaceID, middleware.GetUserID(ctx), level)
	if err != nil {
		return false, huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !decision.Allowed {
		return false, huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return decision.Role == models.WorkspaceRoleAdmin || decision.Role == models.WorkspaceRoleEditor, nil
}

func screenshotTemplateSummary(row models.ScreenshotTemplateDesign) ScreenshotTemplateDesignSummary {
	return ScreenshotTemplateDesignSummary{ID: row.ID, WorkspaceID: row.WorkspaceID, Title: row.Title, TemplateID: row.TemplateID, Revision: row.Revision, UpdatedAt: row.UpdatedAt}
}

func screenshotTemplateResponse(row models.ScreenshotTemplateDesign, canEdit bool) (*ScreenshotTemplateDesignOutput, error) {
	out := &ScreenshotTemplateDesignOutput{Body: ScreenshotTemplateDesignResponse{ScreenshotTemplateDesignSummary: screenshotTemplateSummary(row), CanEdit: canEdit}}
	if err := json.Unmarshal([]byte(row.DocumentJSON), &out.Body.Document); err != nil {
		return nil, huma.Error500InternalServerError("failed to read template document")
	}
	return out, nil
}

func (h *ScreenshotTemplateHandler) load(ctx context.Context, id string, level workspaceaccess.Level) (models.ScreenshotTemplateDesign, bool, error) {
	var row models.ScreenshotTemplateDesign
	err := h.db.NewSelect().Model(&row).Where("id = ?", id).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return row, false, huma.Error404NotFound("template design not found")
	}
	if err != nil {
		return row, false, huma.Error500InternalServerError("failed to load template design")
	}
	canEdit, err := h.access(ctx, row.WorkspaceID, level)
	return row, canEdit, err
}

func (h *ScreenshotTemplateHandler) list(ctx context.Context, input *ListScreenshotTemplateDesignsInput) (*ListScreenshotTemplateDesignsOutput, error) {
	canEdit, err := h.access(ctx, input.WorkspaceID, workspaceaccess.LevelRead)
	if err != nil {
		return nil, err
	}
	var rows []models.ScreenshotTemplateDesign
	total, err := h.db.NewSelect().Model(&rows).ExcludeColumn("document_json").Where("workspace_id = ?", input.WorkspaceID).Order("updated_at DESC", "id DESC").Limit(int64(input.Limit)).Offset(int64(input.Offset)).ScanAndCount(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list template designs")
	}
	out := &ListScreenshotTemplateDesignsOutput{}
	out.Body.CanEdit = canEdit
	out.Body.Total = int(total)
	out.Body.Designs = make([]ScreenshotTemplateDesignSummary, 0, len(rows))
	for _, row := range rows {
		out.Body.Designs = append(out.Body.Designs, screenshotTemplateSummary(row))
	}
	return out, nil
}

func (h *ScreenshotTemplateHandler) create(ctx context.Context, input *CreateScreenshotTemplateDesignInput) (*ScreenshotTemplateDesignOutput, error) {
	if _, err := h.access(ctx, input.Body.WorkspaceID, workspaceaccess.LevelEdit); err != nil {
		return nil, err
	}
	if err := validateScreenshotTemplateDocument(input.Body.Document); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	encoded, err := json.Marshal(input.Body.Document)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid template document")
	}
	now := time.Now().UTC()
	row := models.ScreenshotTemplateDesign{ID: uuid.NewString(), WorkspaceID: input.Body.WorkspaceID, CreatedByID: middleware.GetUserID(ctx), Title: input.Body.Document.Title, TemplateID: input.Body.Document.TemplateID, Revision: 1, DocumentJSON: string(encoded), CreatedAt: now, UpdatedAt: now}
	ids := screenshotTemplateMediaIDs(input.Body.Document)
	err = h.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := validateScreenshotTemplateMedia(ctx, tx, row.WorkspaceID, input.Body.Document); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(&row).Exec(ctx); err != nil {
			return huma.Error500InternalServerError("failed to create template design")
		}
		if err := replaceScreenshotTemplateMedia(ctx, tx, row.ID, ids); err != nil {
			return huma.Error500InternalServerError("failed to save template images")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return screenshotTemplateResponse(row, true)
}

func (h *ScreenshotTemplateHandler) get(ctx context.Context, input *GetScreenshotTemplateDesignInput) (*ScreenshotTemplateDesignOutput, error) {
	row, canEdit, err := h.load(ctx, input.ID, workspaceaccess.LevelRead)
	if err != nil {
		return nil, err
	}
	return screenshotTemplateResponse(row, canEdit)
}

func (h *ScreenshotTemplateHandler) update(ctx context.Context, input *UpdateScreenshotTemplateDesignInput) (*ScreenshotTemplateDesignOutput, error) {
	row, _, err := h.load(ctx, input.ID, workspaceaccess.LevelEdit)
	if err != nil {
		return nil, err
	}
	if err := validateScreenshotTemplateDocument(input.Body.Document); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	encoded, err := json.Marshal(input.Body.Document)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid template document")
	}
	row.DocumentJSON = string(encoded)
	row.Title = input.Body.Document.Title
	row.TemplateID = input.Body.Document.TemplateID
	row.Revision = input.Body.Revision + 1
	row.UpdatedAt = time.Now().UTC()
	ids := screenshotTemplateMediaIDs(input.Body.Document)
	err = h.db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if err := validateScreenshotTemplateMedia(ctx, tx, row.WorkspaceID, input.Body.Document); err != nil {
			return err
		}
		result, err := tx.NewUpdate().Model(&row).Column("document_json", "title", "template_id", "revision", "updated_at").Where("id = ? AND revision = ?", row.ID, input.Body.Revision).Exec(ctx)
		if err != nil {
			return huma.Error500InternalServerError("failed to save template design")
		}
		count, err := result.RowsAffected()
		if err != nil {
			return huma.Error500InternalServerError("failed to verify template save")
		}
		if count != 1 {
			return huma.Error409Conflict("this design changed elsewhere; save a copy to keep your changes")
		}
		if err := replaceScreenshotTemplateMedia(ctx, tx, row.ID, ids); err != nil {
			return huma.Error500InternalServerError("failed to save template images")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return screenshotTemplateResponse(row, true)
}

func (h *ScreenshotTemplateHandler) delete(ctx context.Context, input *GetScreenshotTemplateDesignInput) (*DeleteScreenshotTemplateDesignOutput, error) {
	row, _, err := h.load(ctx, input.ID, workspaceaccess.LevelEdit)
	if err != nil {
		return nil, err
	}
	if _, err := h.db.NewDelete().Model(&row).WherePK().Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to delete template design")
	}
	return &DeleteScreenshotTemplateDesignOutput{Status: http.StatusNoContent}, nil
}

func (h *ScreenshotTemplateHandler) preview(ctx context.Context, input *PreviewScreenshotTemplateInput) (*PreviewScreenshotTemplateOutput, error) {
	if _, err := h.access(ctx, input.Body.WorkspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	if h.renderer == nil {
		return nil, huma.Error503ServiceUnavailable("the template renderer is not configured")
	}
	if !h.limiter.Allow("screenshot-template-preview:"+middleware.GetUserID(ctx), screenshotTemplatePreviewsPerMinute, time.Minute) {
		return nil, huma.Error429TooManyRequests("template previews are rate limited; try again shortly")
	}
	scale := input.Body.Scale
	if scale == 0 {
		scale = screenshottemplates.ExportScale
	}
	rendered, err := h.renderer.Render(ctx, input.Body.WorkspaceID, input.Body.Document, scale)
	if err != nil {
		return nil, err
	}
	data, err := screenshottemplates.EncodeJPEG(rendered.Image)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to encode the template preview")
	}
	out := &PreviewScreenshotTemplateOutput{CacheControl: "no-store"}
	out.Body.MIMEType = "image/jpeg"
	out.Body.DataBase64 = base64.StdEncoding.EncodeToString(data)
	out.Body.Width, out.Body.Height = rendered.Image.Rect.Dx(), rendered.Image.Rect.Dy()
	out.Body.Scale = scale
	out.Body.Regions = rendered.Regions
	if out.Body.Regions == nil {
		out.Body.Regions = []screenshottemplates.Region{}
	}
	return out, nil
}

func (h *ScreenshotTemplateHandler) saveExport(ctx context.Context, input *SaveScreenshotTemplateExportInput) (*ScreenshotTemplateRecipeOutput, error) {
	row, _, err := h.load(ctx, input.ID, workspaceaccess.LevelEdit)
	if err != nil {
		return nil, err
	}
	if row.Revision != input.Body.Revision {
		return nil, huma.Error409Conflict("the design changed while exporting; export it again")
	}
	var doc ScreenshotTemplateDocument
	if err := json.Unmarshal([]byte(row.DocumentJSON), &doc); err != nil {
		return nil, huma.Error500InternalServerError("failed to read template document")
	}
	if input.Body.MediaID == "" {
		if h.renderer == nil {
			return nil, huma.Error503ServiceUnavailable("the template renderer is not configured")
		}
		media, err := h.renderer.Export(ctx, row.WorkspaceID, middleware.GetUserID(ctx), doc)
		if err != nil {
			return nil, err
		}
		out, err := h.recipe(ctx, &ScreenshotTemplateRecipeInput{MediaID: media.ID})
		if err != nil {
			return nil, err
		}
		result := mediaUploadResultFromAttachment(media, false)
		out.Body.Media = &result
		return out, nil
	}
	// Clients released before server rendering upload their own PNG.
	var media models.MediaAttachment
	err = h.db.NewSelect().Model(&media).Where("id = ? AND workspace_id = ? AND processing_status = ? AND trashed_at IS NULL", input.Body.MediaID, row.WorkspaceID, mediaReadyStatus).Scan(ctx)
	if err != nil {
		return nil, huma.Error400BadRequest("the export must be ready media in this workspace")
	}
	if media.MimeType != "image/png" || media.Source != "screenshot_template" {
		return nil, huma.Error400BadRequest("the export must be a screenshot template PNG")
	}
	ids := screenshotTemplateMediaIDs(doc)
	for _, id := range ids {
		if id == media.ID {
			return nil, huma.Error400BadRequest("an export cannot be its own source image")
		}
	}
	recipe := models.MediaGenerationRecipe{MediaID: media.ID, WorkspaceID: row.WorkspaceID, CreatedByID: middleware.GetUserID(ctx), Kind: "screenshot_template", RendererKey: screenshotTemplateClientRenderer, TemplateID: row.TemplateID, TemplateName: row.Title, CatalogRevision: "1", RecipeJSON: row.DocumentJSON, CreatedAt: time.Now().UTC()}
	if err := saveScreenshotTemplateRecipe(ctx, h.db, row.WorkspaceID, media.ID, doc, recipe); err != nil {
		return nil, err
	}
	return h.recipe(ctx, &ScreenshotTemplateRecipeInput{MediaID: media.ID})
}

func (h *ScreenshotTemplateHandler) recipe(ctx context.Context, input *ScreenshotTemplateRecipeInput) (*ScreenshotTemplateRecipeOutput, error) {
	var recipe models.MediaGenerationRecipe
	err := h.db.NewSelect().Model(&recipe).Where("media_id = ? AND kind IN (?, ?)", input.MediaID, "screenshot_template", "meme").Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("template recipe not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to read template recipe")
	}
	if _, err := h.access(ctx, recipe.WorkspaceID, workspaceaccess.LevelRead); err != nil {
		return nil, err
	}
	out := &ScreenshotTemplateRecipeOutput{}
	out.Body.WorkspaceID = recipe.WorkspaceID
	if recipe.Kind == "meme" {
		var meme MemeRecipeDocument
		if err := json.Unmarshal([]byte(recipe.RecipeJSON), &meme); err != nil {
			return nil, huma.Error500InternalServerError("failed to read meme recipe")
		}
		format := meme.Format
		if format != "gif" && format != "webp" {
			format = "png"
		}
		overlays := append([]string{}, meme.OverlayMediaIDs...)
		out.Body.Document = ScreenshotTemplateDocument{SchemaVersion: 1, TemplateID: "meme", Title: meme.Template.Name, Appearance: "light", Frame: "natural", TextSize: "normal", Meme: &ScreenshotTemplateMeme{TemplateID: meme.Template.ID, Name: meme.Template.Name, Captions: meme.Captions, OverlaySlots: meme.Template.Overlays, OverlayMediaIDs: overlays, Format: format, AltText: meme.AltText, ParentMediaID: recipe.MediaID}}
		return out, nil
	}
	if err := json.Unmarshal([]byte(recipe.RecipeJSON), &out.Body.Document); err != nil {
		return nil, huma.Error500InternalServerError("failed to read template document")
	}
	return out, nil
}
