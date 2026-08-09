package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/memes"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/memegeneration"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/ratelimit"
	"github.com/uptrace/bun"
	_ "golang.org/x/image/webp"
)

const (
	memeTemplateRequestsPerMinute   = 120
	memeSuggestionRequestsPerMinute = 5
	memePreviewRequestsPerMinute    = 30
	memeRenderRequestsPerMinute     = 30
	memeRecipeRequestsPerMinute     = 120
	memeThumbnailRequestsPerMinute  = 120

	defaultMemeTemplateLimit         = 40
	maxMemeTemplateLimit             = 250
	maxMemeSearchCharacters          = 120
	maxMemeOverlayMedia              = 8
	maxMemeOverlayBytes              = 10 * 1024 * 1024
	maxMemeOverlayTotalBytes         = 20 * 1024 * 1024
	maxMemePreviewBytes              = 5 * 1024 * 1024
	maxMemeRenderedBytes             = 20 * 1024 * 1024
	maxMemeThumbnailBytes            = 2 * 1024 * 1024
	maxMemeThumbnailDimension        = 2048
	maxMemeThumbnailPixels     int64 = 4_000_000
	maxMemeImageDimension            = 6000
	maxMemeImagePixels         int64 = 12_000_000
	maxMemeThumbnailEntries          = 128
	maxMemeThumbnailCacheBytes int64 = 32 * 1024 * 1024
	maxMemeRequestBytes              = 32 * 1024
	memeThumbnailTTL                 = 12 * time.Hour
	memeCleanupTimeout               = 10 * time.Second
	memeRecipeSchemaVersion          = 1
)

type memeConcurrencyLimiter struct {
	mu          sync.Mutex
	global      chan struct{}
	perUser     int
	activeUsers map[string]int
}

// MemeBodyLimitMiddleware bounds meme request bodies before Huma decodes
// them. The routes accept text and media IDs only; 32 KiB leaves ample room
// for every valid request while preventing unbounded authenticated allocations.
func MemeBodyLimitMiddleware(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		request := c.Request()
		if request.Method != http.MethodPost || !isMemeWritePath(request.URL.Path) {
			return next(c)
		}
		if request.ContentLength > maxMemeRequestBytes {
			return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "meme request is too large")
		}
		body, err := io.ReadAll(io.LimitReader(request.Body, maxMemeRequestBytes+1))
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "failed to read meme request")
		}
		if len(body) > maxMemeRequestBytes {
			return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "meme request is too large")
		}
		request.Body = io.NopCloser(bytes.NewReader(body))
		return next(c)
	}
}

func isMemeWritePath(path string) bool {
	switch path {
	case "/api/v1/memes/suggestions", "/api/v1/memes/preview", "/api/v1/memes/render":
		return true
	default:
		return false
	}
}

func newMemeConcurrencyLimiter(global, perUser int) *memeConcurrencyLimiter {
	return &memeConcurrencyLimiter{
		global: make(chan struct{}, global), perUser: perUser,
		activeUsers: make(map[string]int),
	}
}

func (l *memeConcurrencyLimiter) acquire(userID string) (func(), bool) {
	if l == nil || strings.TrimSpace(userID) == "" {
		return nil, false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.activeUsers[userID] >= l.perUser {
		return nil, false
	}
	select {
	case l.global <- struct{}{}:
		l.activeUsers[userID]++
	default:
		return nil, false
	}
	return func() {
		l.mu.Lock()
		if l.activeUsers[userID] <= 1 {
			delete(l.activeUsers, userID)
		} else {
			l.activeUsers[userID]--
		}
		<-l.global
		l.mu.Unlock()
	}, true
}

type memeThumbnailCacheEntry struct {
	data       []byte
	mimeType   string
	templateID string
	expiresAt  time.Time
}

// MemeMediaURLResolver resolves workspace-owned media to the HTTPS URLs that
// an external renderer may fetch. The persisted recipe stores media IDs, not
// these short-lived URLs.
type MemeMediaURLResolver interface {
	URL(models.MediaAttachment) string
}

// MemeMediaImport is the bounded input to the existing media pipeline.
type MemeMediaImport struct {
	WorkspaceID   string
	TemplateID    string
	Extension     string
	MIMEType      string
	Data          []byte
	AltText       string
	ParentMediaID string
}

// MemeMediaImporter keeps media mutation injectable while the production
// implementation delegates to MediaHandler.processUploadBytes.
type MemeMediaImporter interface {
	ImportMeme(context.Context, MemeMediaImport) (models.MediaAttachment, bool, error)
	RollbackMeme(context.Context, models.MediaAttachment) error
}

type mediaHandlerMemeImporter struct {
	handler *MediaHandler
}

func (i mediaHandlerMemeImporter) ImportMeme(ctx context.Context, input MemeMediaImport) (models.MediaAttachment, bool, error) {
	if i.handler == nil || i.handler.db == nil {
		return models.MediaAttachment{}, false, errors.New("media handler is unavailable")
	}
	extension := normalizedMemeExtension(input.Extension)
	result, err := i.handler.processUploadBytes(ctx, mediaUploadBytesInput{
		WorkspaceID:      input.WorkspaceID,
		Filename:         "meme-" + input.TemplateID + "." + extension,
		DeclaredMimeType: input.MIMEType,
		Size:             int64(len(input.Data)),
		Content:          input.Data,
		AltText:          input.AltText,
		Source:           "meme_generator",
		AssetKind:        "library",
		RetentionClass:   "library",
		ParentMediaID:    input.ParentMediaID,
	})
	if err != nil {
		return models.MediaAttachment{}, false, err
	}
	mediaID, _ := result["id"].(string)
	deduped, _ := result["deduped"].(bool)
	if strings.TrimSpace(mediaID) == "" {
		return models.MediaAttachment{}, deduped, errors.New("media pipeline returned no media ID")
	}
	var media models.MediaAttachment
	if err := i.handler.db.NewSelect().Model(&media).
		Where("id = ? AND workspace_id = ?", mediaID, input.WorkspaceID).
		Scan(ctx); err != nil {
		return models.MediaAttachment{}, deduped, err
	}
	return media, deduped, nil
}

func (i mediaHandlerMemeImporter) RollbackMeme(ctx context.Context, media models.MediaAttachment) error {
	if i.handler == nil {
		return errors.New("media handler is unavailable")
	}
	return i.handler.deleteMedia(ctx, &media)
}

type MemeHandler struct {
	db             *bun.DB
	auth           middleware.Authenticator
	provider       memes.Provider
	suggester      memegeneration.Suggester
	mediaURLs      MemeMediaURLResolver
	importer       MemeMediaImporter
	limiter        *ratelimit.Limiter
	renders        *memeConcurrencyLimiter
	imports        *memeConcurrencyLimiter
	suggestions    *memeConcurrencyLimiter
	thumbnails     *memeConcurrencyLimiter
	thumbnailMu    sync.Mutex
	thumbnailCache map[string]memeThumbnailCacheEntry
	thumbnailBytes int64
	now            func() time.Time
}

func NewMemeHandler(
	db *bun.DB,
	authn middleware.Authenticator,
	mediaHandler *MediaHandler,
	publicMedia *publicurl.MediaVerifier,
	renderer memes.Provider,
	suggester memegeneration.Suggester,
) *MemeHandler {
	handler := &MemeHandler{
		db: db, auth: authn, provider: renderer, suggester: suggester,
		limiter:        ratelimit.New(),
		renders:        newMemeConcurrencyLimiter(4, 2),
		imports:        newMemeConcurrencyLimiter(2, 1),
		suggestions:    newMemeConcurrencyLimiter(4, 1),
		thumbnails:     newMemeConcurrencyLimiter(8, 4),
		thumbnailCache: make(map[string]memeThumbnailCacheEntry),
		now:            func() time.Time { return time.Now().UTC() },
	}
	if mediaHandler != nil {
		handler.importer = mediaHandlerMemeImporter{handler: mediaHandler}
	}
	if publicMedia != nil {
		handler.mediaURLs = publicMedia
	} else if mediaHandler != nil {
		handler.mediaURLs = mediaHandler.publicMedia
	}
	return handler
}

func (h *MemeHandler) SetMediaURLResolver(resolver MemeMediaURLResolver) {
	if resolver != nil {
		h.mediaURLs = resolver
	}
}

func (h *MemeHandler) SetMediaImporter(importer MemeMediaImporter) {
	if importer != nil {
		h.importer = importer
	}
}

type ListMemeTemplatesInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
	Query       string `query:"q" maxLength:"120" doc:"Template name, keyword, or example text"`
	Limit       int    `query:"limit" default:"40" minimum:"1" maximum:"250" doc:"Maximum templates to return"`
}

type MemeCatalogMetadata struct {
	ProviderKey    string `json:"provider_key,omitempty" doc:"Configured meme renderer key"`
	Revision       string `json:"revision,omitempty" doc:"Stable digest of the normalized catalog snapshot"`
	RefreshedAt    string `json:"refreshed_at,omitempty" doc:"Time the provider catalog was refreshed"`
	Stale          bool   `json:"stale" doc:"Whether a stale cached catalog is being served"`
	TotalTemplates int    `json:"total_templates" doc:"Templates in the full cached catalog"`
	Returned       int    `json:"returned" doc:"Templates returned by this request"`
}

type ListMemeTemplatesOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		Configured   bool                `json:"configured" doc:"Whether a meme renderer is configured"`
		AIConfigured bool                `json:"ai_configured" doc:"Whether AI meme suggestions are configured"`
		Catalog      MemeCatalogMetadata `json:"catalog"`
		Templates    []memes.Template    `json:"templates"`
	}
}

type GetMemeTemplateThumbnailInput struct {
	PathTemplateID string `path:"template_id" doc:"Memegen template ID"`
	WorkspaceID    string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type GetMemeTemplateThumbnailOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		TemplateID string `json:"template_id"`
		MIMEType   string `json:"mime_type"`
		DataBase64 string `json:"data_base64" doc:"Base64-encoded template thumbnail bytes"`
	}
}

type GenerateMemeSuggestionsInput struct {
	Body struct {
		WorkspaceID string `json:"workspace_id" required:"true" doc:"Workspace ID"`
		Idea        string `json:"idea" required:"true" minLength:"1" maxLength:"1000" doc:"Topic or situation for the meme"`
		Tone        string `json:"tone,omitempty" maxLength:"100" doc:"Requested humor tone; defaults to witty"`
		Language    string `json:"language,omitempty" maxLength:"35" doc:"BCP 47 language tag; defaults to English"`
		Count       int    `json:"count,omitempty" default:"3" minimum:"1" maximum:"4" doc:"Number of distinct suggestions"`
	}
}

type MemeSuggestionCandidate struct {
	TemplateID   string         `json:"template_id"`
	CaptionLines []string       `json:"caption_lines"`
	Rationale    string         `json:"rationale"`
	AltText      string         `json:"alt_text"`
	Template     memes.Template `json:"template"`
}

type GenerateMemeSuggestionsOutput struct {
	Body struct {
		Candidates      []MemeSuggestionCandidate `json:"candidates"`
		Model           string                    `json:"model"`
		CatalogRevision string                    `json:"catalog_revision"`
	}
}

type PreviewMemeInput struct {
	Body struct {
		WorkspaceID     string   `json:"workspace_id" required:"true" doc:"Workspace ID"`
		TemplateID      string   `json:"template_id" required:"true" minLength:"1" maxLength:"80" doc:"Memegen template ID"`
		Captions        []string `json:"captions" required:"true" minItems:"1" maxItems:"16" maxLength:"200" doc:"Caption values in template order"`
		OverlayMediaIDs []string `json:"overlay_media_ids,omitempty" maxItems:"8" maxLength:"80" doc:"Workspace media IDs for replaceable image slots"`
		Format          string   `json:"format,omitempty" default:"png" enum:"png,jpg,jpeg,gif,webp" doc:"Rendered image format"`
	}
}

type PreviewMemeOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         struct {
		TemplateID string `json:"template_id"`
		MIMEType   string `json:"mime_type"`
		DataBase64 string `json:"data_base64" doc:"Base64-encoded rendered image bytes"`
	}
}

type RenderMemeInput struct {
	Body struct {
		WorkspaceID     string   `json:"workspace_id" required:"true" doc:"Workspace ID"`
		TemplateID      string   `json:"template_id" required:"true" minLength:"1" maxLength:"80" doc:"Memegen template ID"`
		Captions        []string `json:"captions" required:"true" minItems:"1" maxItems:"16" maxLength:"200" doc:"Caption values in template order"`
		OverlayMediaIDs []string `json:"overlay_media_ids,omitempty" maxItems:"8" maxLength:"80" doc:"Workspace media IDs for replaceable image slots"`
		Format          string   `json:"format,omitempty" default:"png" enum:"png,jpg,jpeg,gif,webp" doc:"Rendered image format"`
		AltText         string   `json:"alt_text,omitempty" maxLength:"500" doc:"Alternative text saved with the media"`
		ParentMediaID   string   `json:"parent_media_id,omitempty" maxLength:"80" doc:"Prior generated media when this is an edited version"`
	}
}

type MemeRecipeTemplateSnapshot struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Lines     int    `json:"lines"`
	Overlays  int    `json:"overlays"`
	SourceURL string `json:"source_url,omitempty"`
}

type MemeRecipeDocument struct {
	SchemaVersion    int                        `json:"schema_version"`
	RendererKey      string                     `json:"renderer_key"`
	CatalogRevision  string                     `json:"catalog_revision"`
	Template         MemeRecipeTemplateSnapshot `json:"template"`
	Captions         []string                   `json:"captions"`
	OverlayMediaIDs  []string                   `json:"overlay_media_ids,omitempty"`
	Format           string                     `json:"format"`
	RenderedMIMEType string                     `json:"rendered_mime_type"`
	AltText          string                     `json:"alt_text,omitempty"`
	ParentMediaID    string                     `json:"parent_media_id,omitempty"`
}

type MemeRecipeResponse struct {
	MediaID           string             `json:"media_id"`
	WorkspaceID       string             `json:"workspace_id"`
	CreatedByID       string             `json:"created_by_id"`
	Kind              string             `json:"kind"`
	RendererKey       string             `json:"renderer_key"`
	TemplateID        string             `json:"template_id"`
	TemplateName      string             `json:"template_name"`
	TemplateSourceURL string             `json:"template_source_url,omitempty"`
	CatalogRevision   string             `json:"catalog_revision,omitempty"`
	Recipe            MemeRecipeDocument `json:"recipe"`
	CreatedAt         string             `json:"created_at"`
}

type RenderMemeOutput struct {
	Body struct {
		Media  MediaUploadResult  `json:"media"`
		Recipe MemeRecipeResponse `json:"recipe"`
	}
}

type GetMemeRecipeInput struct {
	PathMediaID string `path:"media_id" doc:"Generated media ID"`
}

type GetMemeRecipeOutput struct {
	CacheControl string `header:"Cache-Control"`
	Body         MemeRecipeResponse
}

func (h *MemeHandler) RegisterRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-meme-templates",
		Method:      http.MethodGet,
		Path:        "/memes/templates",
		Summary:     "List and search meme templates",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 429, 502, 503},
	}, h.listTemplates)

	huma.Register(api, huma.Operation{
		OperationID: "generate-meme-suggestions",
		Method:      http.MethodPost,
		Path:        "/memes/suggestions",
		Summary:     "Generate meme template and caption suggestions",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 413, 429, 502, 503},
	}, h.generateSuggestions)

	huma.Register(api, huma.Operation{
		OperationID: "get-meme-template-thumbnail",
		Method:      http.MethodGet,
		Path:        "/memes/templates/{template_id}/thumbnail",
		Summary:     "Load a proxied meme template thumbnail",
		Description: "Returns a bounded OpenPost-proxied image so private Memegen hosts and server-only provider credentials are never exposed to the browser.",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 429, 502, 503},
	}, h.getTemplateThumbnail)

	huma.Register(api, huma.Operation{
		OperationID: "preview-meme",
		Method:      http.MethodPost,
		Path:        "/memes/preview",
		Summary:     "Render a meme preview without saving it",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 413, 429, 502, 503},
	}, h.previewMeme)

	huma.Register(api, huma.Operation{
		OperationID: "render-meme",
		Method:      http.MethodPost,
		Path:        "/memes/render",
		Summary:     "Render and save a meme",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 413, 429, 500, 502, 503},
	}, h.renderMeme)

	huma.Register(api, huma.Operation{
		OperationID: "get-meme-recipe",
		Method:      http.MethodGet,
		Path:        "/memes/recipes/{media_id}",
		Summary:     "Get the immutable recipe for a generated meme",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404, 429, 500},
	}, h.getRecipe)
}

func (h *MemeHandler) listTemplates(ctx context.Context, input *ListMemeTemplatesInput) (*ListMemeTemplatesOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.WorkspaceID, false); err != nil {
		return nil, err
	}
	if !h.allow(ctx, "templates", memeTemplateRequestsPerMinute) {
		return nil, huma.Error429TooManyRequests("meme template limit reached; try again in one minute")
	}

	output := &ListMemeTemplatesOutput{CacheControl: "private, max-age=60"}
	output.Body.Configured = h.provider != nil && h.provider.Available()
	output.Body.AIConfigured = h.suggester != nil
	output.Body.Templates = []memes.Template{}
	if h.provider != nil {
		output.Body.Catalog.ProviderKey = strings.TrimSpace(h.provider.Key())
	}
	if !output.Body.Configured {
		return output, nil
	}

	fullCatalog, err := h.provider.Templates(ctx)
	if err != nil {
		return nil, memeProviderError(err)
	}
	selectedCatalog := fullCatalog
	query := strings.TrimSpace(input.Query)
	if utf8.RuneCountInString(query) > maxMemeSearchCharacters {
		return nil, huma.Error400BadRequest("meme template query is too long")
	}
	limit := input.Limit
	if limit == 0 {
		limit = defaultMemeTemplateLimit
	}
	if limit < 1 || limit > maxMemeTemplateLimit {
		return nil, huma.Error400BadRequest("meme template limit must be between 1 and 250")
	}
	if query != "" {
		selectedCatalog, err = h.provider.Search(ctx, query, limit)
		if err != nil {
			return nil, memeProviderError(err)
		}
	}
	if len(selectedCatalog.Templates) > limit {
		selectedCatalog.Templates = selectedCatalog.Templates[:limit]
	}
	output.Body.Templates = publicMemeTemplates(selectedCatalog.Templates)
	output.Body.Catalog = memeCatalogMetadata(h.provider.Key(), fullCatalog, len(selectedCatalog.Templates))
	return output, nil
}

func (h *MemeHandler) getTemplateThumbnail(
	ctx context.Context,
	input *GetMemeTemplateThumbnailInput,
) (*GetMemeTemplateThumbnailOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.WorkspaceID, false); err != nil {
		return nil, err
	}
	if !h.allow(ctx, "thumbnail", memeThumbnailRequestsPerMinute) {
		return nil, huma.Error429TooManyRequests("meme thumbnail limit reached; try again in one minute")
	}
	if h.provider == nil || !h.provider.Available() {
		return nil, huma.Error503ServiceUnavailable("meme generation is not configured")
	}
	catalog, template, err := h.loadTemplate(ctx, input.PathTemplateID)
	if err != nil {
		return nil, err
	}
	cacheKey := memeCatalogRevision(catalog) + ":" + template.ID
	if cached, ok := h.cachedMemeThumbnail(cacheKey); ok {
		return memeThumbnailOutput(cached), nil
	}
	release, acquired := h.thumbnails.acquire(middleware.GetUserID(ctx))
	if !acquired {
		return nil, huma.Error429TooManyRequests("meme thumbnails are busy; try again shortly")
	}
	defer release()

	var rendered memes.RenderedImage
	if imageProvider, ok := h.provider.(memes.TemplateImageProvider); ok {
		rendered, err = imageProvider.TemplateImage(ctx, template.ID)
	} else {
		rendered, err = h.provider.Render(ctx, memes.RenderRequest{
			TemplateID: template.ID,
			Text:       make([]string, template.Lines),
			Extension:  "webp",
		})
	}
	if err != nil {
		return nil, memeProviderError(err)
	}
	if err := validateMemeRenderedImage(rendered, template.ID); err != nil {
		return nil, err
	}
	if err := validateMemeThumbnailImage(rendered.Data); err != nil {
		return nil, err
	}
	if len(rendered.Data) > maxMemeThumbnailBytes {
		return nil, huma.Error502BadGateway("meme template thumbnail is too large")
	}
	entry := memeThumbnailCacheEntry{
		data: append([]byte(nil), rendered.Data...), mimeType: rendered.MIMEType,
		templateID: template.ID, expiresAt: h.now().Add(memeThumbnailTTL),
	}
	h.storeMemeThumbnail(cacheKey, entry)
	return memeThumbnailOutput(entry), nil
}

func (h *MemeHandler) generateSuggestions(ctx context.Context, input *GenerateMemeSuggestionsInput) (*GenerateMemeSuggestionsOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	if !h.allow(ctx, "suggestions", memeSuggestionRequestsPerMinute) {
		return nil, huma.Error429TooManyRequests("AI meme suggestion limit reached; try again in one minute")
	}
	release, acquired := h.suggestions.acquire(middleware.GetUserID(ctx))
	if !acquired {
		return nil, huma.Error429TooManyRequests("another AI meme request is still running; try again shortly")
	}
	defer release()
	if h.provider == nil || !h.provider.Available() {
		return nil, huma.Error503ServiceUnavailable("meme generation is not configured")
	}
	if h.suggester == nil {
		return nil, huma.Error503ServiceUnavailable("AI meme suggestions are not configured")
	}
	count := input.Body.Count
	if count == 0 {
		count = memegeneration.DefaultCandidateCount
	}
	if count < 1 || count > memegeneration.MaxCandidateCount {
		return nil, huma.Error400BadRequest("meme suggestion count must be between 1 and 4")
	}

	catalog, shortlist, err := h.rankSuggestionTemplates(ctx, input.Body.Idea, count)
	if err != nil {
		return nil, err
	}
	generationTemplates := make([]memegeneration.Template, 0, len(shortlist))
	for _, template := range shortlist {
		generationTemplates = append(generationTemplates, memeGenerationTemplate(template))
	}
	generated, err := h.suggester.Suggest(ctx, memegeneration.Input{
		Idea: input.Body.Idea, Tone: input.Body.Tone, Language: input.Body.Language,
		CandidateCount: count, Templates: generationTemplates,
	})
	if err != nil {
		return nil, memeSuggestionError(err)
	}

	byID := make(map[string]memes.Template, len(shortlist))
	for _, template := range shortlist {
		byID[template.ID] = template
	}
	output := &GenerateMemeSuggestionsOutput{}
	output.Body.Model = generated.Model
	output.Body.CatalogRevision = memeCatalogRevision(catalog)
	output.Body.Candidates = make([]MemeSuggestionCandidate, 0, len(generated.Candidates))
	for _, candidate := range generated.Candidates {
		template, ok := byID[candidate.TemplateID]
		if !ok {
			return nil, huma.Error502BadGateway("AI meme suggestions returned an invalid template")
		}
		for _, caption := range candidate.CaptionLines {
			if memes.ValidateMemegenCaption(caption) != nil {
				return nil, huma.Error502BadGateway("AI meme suggestions returned caption text that Memegen cannot render")
			}
		}
		output.Body.Candidates = append(output.Body.Candidates, MemeSuggestionCandidate{
			TemplateID: candidate.TemplateID, CaptionLines: candidate.CaptionLines,
			Rationale: candidate.Rationale, AltText: candidate.AltText, Template: publicMemeTemplate(template),
		})
	}
	return output, nil
}

func (h *MemeHandler) previewMeme(ctx context.Context, input *PreviewMemeInput) (*PreviewMemeOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	if !h.allow(ctx, "preview", memePreviewRequestsPerMinute) {
		return nil, huma.Error429TooManyRequests("meme preview limit reached; try again in one minute")
	}
	rendered, _, _, err := h.render(ctx, memeRenderParameters{
		WorkspaceID: input.Body.WorkspaceID, TemplateID: input.Body.TemplateID,
		Captions: input.Body.Captions, OverlayMediaIDs: input.Body.OverlayMediaIDs, Format: input.Body.Format,
	})
	if err != nil {
		return nil, err
	}
	if len(rendered.Data) > maxMemePreviewBytes {
		return nil, huma.Error502BadGateway("rendered meme is too large to return as a preview")
	}
	output := &PreviewMemeOutput{CacheControl: "no-store"}
	output.Body.TemplateID = rendered.TemplateID
	output.Body.MIMEType = rendered.MIMEType
	output.Body.DataBase64 = base64.StdEncoding.EncodeToString(rendered.Data)
	return output, nil
}

func (h *MemeHandler) renderMeme(ctx context.Context, input *RenderMemeInput) (*RenderMemeOutput, error) {
	if err := h.requireWorkspaceAccess(ctx, input.Body.WorkspaceID, true); err != nil {
		return nil, err
	}
	if !h.allow(ctx, "render", memeRenderRequestsPerMinute) {
		return nil, huma.Error429TooManyRequests("meme render limit reached; try again in one minute")
	}
	if h.importer == nil || h.db == nil {
		return nil, huma.Error503ServiceUnavailable("meme media storage is not configured")
	}
	altText := strings.TrimSpace(input.Body.AltText)
	if utf8.RuneCountInString(altText) > memegeneration.MaxAltTextCharacters || hasMemeControl(altText, false) {
		return nil, huma.Error400BadRequest("meme alt text is invalid")
	}
	if err := h.validateMemeParent(ctx, input.Body.WorkspaceID, input.Body.ParentMediaID); err != nil {
		return nil, err
	}

	rendered, template, catalog, err := h.render(ctx, memeRenderParameters{
		WorkspaceID: input.Body.WorkspaceID, TemplateID: input.Body.TemplateID,
		Captions: input.Body.Captions, OverlayMediaIDs: input.Body.OverlayMediaIDs, Format: input.Body.Format,
	})
	if err != nil {
		return nil, err
	}
	if altText == "" {
		altText = defaultMemeAltText(template, input.Body.Captions)
	}
	releaseImport, acquired := h.imports.acquire(middleware.GetUserID(ctx))
	if !acquired {
		return nil, huma.Error429TooManyRequests("another generated image is still being saved; try again shortly")
	}
	media, deduped, err := h.importer.ImportMeme(ctx, MemeMediaImport{
		WorkspaceID: input.Body.WorkspaceID, TemplateID: template.ID,
		Extension: rendered.Extension, MIMEType: rendered.MIMEType, Data: rendered.Data,
		AltText: altText, ParentMediaID: strings.TrimSpace(input.Body.ParentMediaID),
	})
	releaseImport()
	if err != nil {
		return nil, memeImportError(err)
	}

	revision := memeCatalogRevision(catalog)
	sourceURL := publicMemeSourceURL(template.SourceURL)
	document := MemeRecipeDocument{
		SchemaVersion: memeRecipeSchemaVersion, RendererKey: h.provider.Key(), CatalogRevision: revision,
		Template: MemeRecipeTemplateSnapshot{
			ID: template.ID, Name: template.Name, Lines: template.Lines,
			Overlays: template.Overlays, SourceURL: sourceURL,
		},
		Captions:        append([]string(nil), input.Body.Captions...),
		OverlayMediaIDs: append([]string(nil), input.Body.OverlayMediaIDs...),
		Format:          rendered.Extension, RenderedMIMEType: rendered.MIMEType,
		AltText: altText, ParentMediaID: strings.TrimSpace(input.Body.ParentMediaID),
	}
	recipeJSON, err := json.Marshal(document)
	if err != nil {
		if !deduped {
			h.rollbackImportedMeme(ctx, media)
		}
		return nil, huma.Error500InternalServerError("failed to save meme recipe")
	}
	recipe := models.MediaGenerationRecipe{
		MediaID: media.ID, WorkspaceID: input.Body.WorkspaceID,
		CreatedByID: middleware.GetUserID(ctx), Kind: "meme", RendererKey: h.provider.Key(),
		TemplateID: template.ID, TemplateName: template.Name, TemplateSourceURL: sourceURL,
		CatalogRevision: revision, RecipeJSON: string(recipeJSON), CreatedAt: h.now().UTC(),
	}
	if _, err := h.db.NewInsert().Model(&recipe).Exec(ctx); err != nil {
		if !deduped {
			h.rollbackImportedMeme(ctx, media)
		}
		return nil, huma.Error500InternalServerError("failed to save meme recipe")
	}

	output := &RenderMemeOutput{}
	output.Body.Media = mediaUploadResultFromAttachment(media, deduped)
	output.Body.Recipe = memeRecipeResponse(recipe, document)
	return output, nil
}

func (h *MemeHandler) getRecipe(ctx context.Context, input *GetMemeRecipeInput) (*GetMemeRecipeOutput, error) {
	if h.db == nil {
		return nil, huma.Error500InternalServerError("meme recipe storage is unavailable")
	}
	if !h.allow(ctx, "recipe", memeRecipeRequestsPerMinute) {
		return nil, huma.Error429TooManyRequests("meme recipe limit reached; try again in one minute")
	}
	mediaID := strings.TrimSpace(input.PathMediaID)
	if mediaID == "" || utf8.RuneCountInString(mediaID) > 80 || hasMemeControl(mediaID, false) {
		return nil, huma.Error404NotFound("meme recipe not found")
	}
	var recipe models.MediaGenerationRecipe
	if err := h.db.NewSelect().Model(&recipe).Where("media_id = ?", mediaID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("meme recipe not found")
		}
		return nil, huma.Error500InternalServerError("failed to load meme recipe")
	}
	var media models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).Column("id", "workspace_id").Where("id = ?", mediaID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound("meme recipe not found")
		}
		return nil, huma.Error500InternalServerError("failed to validate meme recipe")
	}
	if media.WorkspaceID == "" || recipe.WorkspaceID != media.WorkspaceID {
		return nil, huma.Error500InternalServerError("stored meme recipe is invalid")
	}
	if err := h.requireWorkspaceAccess(ctx, media.WorkspaceID, false); err != nil {
		return nil, err
	}
	var document MemeRecipeDocument
	if err := decodeMemeRecipe(recipe.RecipeJSON, &document); err != nil {
		return nil, huma.Error500InternalServerError("stored meme recipe is invalid")
	}
	return &GetMemeRecipeOutput{CacheControl: "no-store", Body: memeRecipeResponse(recipe, document)}, nil
}

type memeRenderParameters struct {
	WorkspaceID     string
	TemplateID      string
	Captions        []string
	OverlayMediaIDs []string
	Format          string
}

func (h *MemeHandler) render(ctx context.Context, input memeRenderParameters) (memes.RenderedImage, memes.Template, memes.Catalog, error) {
	if h.provider == nil || !h.provider.Available() {
		return memes.RenderedImage{}, memes.Template{}, memes.Catalog{}, huma.Error503ServiceUnavailable("meme generation is not configured")
	}
	release, acquired := h.renders.acquire(middleware.GetUserID(ctx))
	if !acquired {
		return memes.RenderedImage{}, memes.Template{}, memes.Catalog{}, huma.Error429TooManyRequests("another meme render is still running; try again shortly")
	}
	defer release()
	catalog, template, err := h.loadTemplate(ctx, input.TemplateID)
	if err != nil {
		return memes.RenderedImage{}, memes.Template{}, memes.Catalog{}, err
	}
	if err := validateMemeRenderValues(template, input.Captions, input.OverlayMediaIDs, input.Format); err != nil {
		return memes.RenderedImage{}, memes.Template{}, memes.Catalog{}, err
	}
	overlayURLs, err := h.resolveOverlayURLs(ctx, input.WorkspaceID, input.OverlayMediaIDs)
	if err != nil {
		return memes.RenderedImage{}, memes.Template{}, memes.Catalog{}, err
	}
	rendered, err := h.provider.Render(ctx, memes.RenderRequest{
		TemplateID: template.ID, Text: append([]string(nil), input.Captions...),
		OverlayURLs: overlayURLs, Extension: normalizedMemeExtension(input.Format),
	})
	if err != nil {
		return memes.RenderedImage{}, memes.Template{}, memes.Catalog{}, memeProviderError(err)
	}
	if err := validateMemeRenderedImage(rendered, template.ID); err != nil {
		return memes.RenderedImage{}, memes.Template{}, memes.Catalog{}, err
	}
	return rendered, template, catalog, nil
}

func (h *MemeHandler) validateMemeParent(ctx context.Context, workspaceID, rawMediaID string) error {
	mediaID := strings.TrimSpace(rawMediaID)
	if mediaID == "" {
		return nil
	}
	if utf8.RuneCountInString(mediaID) > 80 || hasMemeControl(mediaID, false) {
		return huma.Error400BadRequest("source media ID is invalid")
	}
	if h.db == nil {
		return huma.Error503ServiceUnavailable("meme media storage is not configured")
	}
	count, err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("id = ? AND workspace_id = ?", mediaID, workspaceID).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate source media")
	}
	if count != 1 {
		return huma.Error400BadRequest("source media must belong to the workspace")
	}
	return nil
}

func (h *MemeHandler) loadTemplate(ctx context.Context, templateID string) (memes.Catalog, memes.Template, error) {
	templateID = strings.TrimSpace(templateID)
	if templateID == "" || utf8.RuneCountInString(templateID) > memegeneration.MaxTemplateIDCharacters || hasMemeControl(templateID, false) {
		return memes.Catalog{}, memes.Template{}, huma.Error400BadRequest("meme template ID is invalid")
	}
	catalog, err := h.provider.Templates(ctx)
	if err != nil {
		return memes.Catalog{}, memes.Template{}, memeProviderError(err)
	}
	for _, template := range catalog.Templates {
		if template.ID == templateID {
			return catalog, template, nil
		}
	}
	return memes.Catalog{}, memes.Template{}, huma.Error404NotFound("meme template not found")
}

func (h *MemeHandler) resolveOverlayURLs(ctx context.Context, workspaceID string, mediaIDs []string) ([]string, error) {
	if len(mediaIDs) == 0 {
		return nil, nil
	}
	if len(mediaIDs) > maxMemeOverlayMedia {
		return nil, huma.Error400BadRequest("a meme can use at most 8 overlay images")
	}
	if h.db == nil || h.mediaURLs == nil {
		return nil, huma.Error503ServiceUnavailable("public media URLs are not configured for meme overlays")
	}
	result := make([]string, 0, len(mediaIDs))
	var totalBytes int64
	for _, rawID := range mediaIDs {
		mediaID := strings.TrimSpace(rawID)
		if mediaID == "" || utf8.RuneCountInString(mediaID) > 80 || hasMemeControl(mediaID, false) {
			return nil, huma.Error400BadRequest("overlay media ID is invalid")
		}
		var media models.MediaAttachment
		if err := h.db.NewSelect().Model(&media).
			Where("id = ? AND workspace_id = ?", mediaID, workspaceID).
			Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound("overlay media not found")
			}
			return nil, huma.Error500InternalServerError("failed to load overlay media")
		}
		mimeType := strings.ToLower(strings.TrimSpace(media.MimeType))
		if !media.TrashedAt.IsZero() || media.ProcessingStatus != mediaReadyStatus || !supportedMemeOverlayMIME(mimeType) {
			return nil, huma.Error400BadRequest("overlay media must be a ready PNG, JPEG, GIF, or WebP image")
		}
		pixels := int64(media.Width) * int64(media.Height)
		if media.Size <= 0 || media.Size > maxMemeOverlayBytes ||
			media.Width <= 0 || media.Height <= 0 ||
			media.Width > maxMemeImageDimension || media.Height > maxMemeImageDimension ||
			pixels <= 0 || pixels > maxMemeImagePixels {
			return nil, huma.Error400BadRequest("overlay image is too large for meme rendering")
		}
		totalBytes += media.Size
		if totalBytes > maxMemeOverlayTotalBytes {
			return nil, huma.Error400BadRequest("combined overlay images are too large for meme rendering")
		}
		resolved := strings.TrimSpace(h.mediaURLs.URL(media))
		parsed, err := url.Parse(resolved)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
			return nil, huma.Error503ServiceUnavailable("overlay media does not have a safe public HTTPS URL")
		}
		result = append(result, resolved)
	}
	return result, nil
}

func (h *MemeHandler) rankSuggestionTemplates(ctx context.Context, idea string, count int) (memes.Catalog, []memes.Template, error) {
	fullCatalog, err := h.provider.Templates(ctx)
	if err != nil {
		return memes.Catalog{}, nil, memeProviderError(err)
	}
	shortlist := make([]memes.Template, 0, memegeneration.MaxCandidateTemplates)
	seen := make(map[string]struct{}, memegeneration.MaxCandidateTemplates)
	appendTemplates := func(values []memes.Template) {
		for _, template := range values {
			if len(shortlist) >= memegeneration.MaxCandidateTemplates || !memeTemplateSupportsSuggestions(template) {
				continue
			}
			if _, exists := seen[template.ID]; exists {
				continue
			}
			seen[template.ID] = struct{}{}
			shortlist = append(shortlist, template)
		}
	}
	for _, query := range memeSuggestionSearchQueries(idea) {
		catalog, searchErr := h.provider.Search(ctx, query, memegeneration.MaxCandidateTemplates)
		if searchErr != nil {
			return memes.Catalog{}, nil, memeProviderError(searchErr)
		}
		appendTemplates(catalog.Templates)
		if len(shortlist) >= memegeneration.MaxCandidateTemplates {
			break
		}
	}
	appendTemplates(fullCatalog.Templates)
	if len(shortlist) < count {
		return memes.Catalog{}, nil, huma.Error503ServiceUnavailable("not enough compatible meme templates are available")
	}
	return fullCatalog, shortlist, nil
}

func memeSuggestionSearchQueries(idea string) []string {
	idea = strings.TrimSpace(idea)
	queries := make([]string, 0, 6)
	seen := make(map[string]struct{}, 6)
	add := func(value string) {
		value = truncateMemeText(strings.TrimSpace(value), maxMemeSearchCharacters)
		key := strings.ToLower(value)
		if value == "" {
			return
		}
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		queries = append(queries, value)
	}
	add(idea)
	for _, field := range strings.FieldsFunc(idea, func(current rune) bool {
		return !(unicode.IsLetter(current) || unicode.IsNumber(current))
	}) {
		if utf8.RuneCountInString(field) >= 3 {
			add(field)
		}
		if len(queries) >= 6 {
			break
		}
	}
	return queries
}

func memeGenerationTemplate(template memes.Template) memegeneration.Template {
	keywords := make([]string, 0, min(len(template.Keywords), memegeneration.MaxTemplateKeywords))
	for _, keyword := range template.Keywords {
		if len(keywords) >= memegeneration.MaxTemplateKeywords {
			break
		}
		keyword = truncateMemeText(strings.TrimSpace(keyword), memegeneration.MaxKeywordCharacters)
		if keyword != "" && !hasMemeControl(keyword, false) {
			keywords = append(keywords, keyword)
		}
	}
	exampleLines := []string(nil)
	if len(template.Example.Text) == template.Lines {
		exampleLines = make([]string, 0, len(template.Example.Text))
		for _, line := range template.Example.Text {
			line = truncateMemeText(strings.TrimSpace(line), memegeneration.MaxExampleLineCharacters)
			if hasMemeControl(line, false) {
				exampleLines = nil
				break
			}
			exampleLines = append(exampleLines, line)
		}
	}
	return memegeneration.Template{
		ID: template.ID, Name: truncateMemeText(template.Name, memegeneration.MaxTemplateNameCharacters),
		LineCount: template.Lines, OverlayCount: min(template.Overlays, memegeneration.MaxTemplateOverlays),
		Keywords: keywords, ExampleLines: exampleLines,
	}
}

func memeTemplateSupportsSuggestions(template memes.Template) bool {
	return strings.TrimSpace(template.ID) != "" && strings.TrimSpace(template.Name) != "" &&
		template.Lines >= 1 && template.Lines <= memegeneration.MaxTemplateLines &&
		template.Overlays >= 0 && template.Overlays <= memegeneration.MaxTemplateOverlays
}

func validateMemeRenderValues(template memes.Template, captions, overlayMediaIDs []string, format string) error {
	if len(captions) != template.Lines {
		return huma.Error400BadRequest(fmt.Sprintf("this meme template requires exactly %d caption lines", template.Lines))
	}
	for _, caption := range captions {
		if !utf8.ValidString(caption) || utf8.RuneCountInString(caption) > memegeneration.MaxCaptionLineCharacters ||
			hasMemeControl(caption, true) || memes.ValidateMemegenCaption(caption) != nil {
			return huma.Error400BadRequest("meme captions must fit Memegen's 200-byte text limit")
		}
	}
	if len(overlayMediaIDs) > template.Overlays {
		return huma.Error400BadRequest(fmt.Sprintf("this meme template accepts at most %d overlay images", template.Overlays))
	}
	if len(overlayMediaIDs) > maxMemeOverlayMedia {
		return huma.Error400BadRequest("a meme can use at most 8 overlay images")
	}
	if _, ok := expectedMemeMIMEType(normalizedMemeExtension(format)); !ok {
		return huma.Error400BadRequest("meme format must be png, jpg, jpeg, gif, or webp")
	}
	return nil
}

func validateMemeRenderedImage(rendered memes.RenderedImage, templateID string) error {
	if rendered.TemplateID != templateID || len(rendered.Data) == 0 || len(rendered.Data) > maxMemeRenderedBytes {
		return huma.Error502BadGateway("meme renderer returned an invalid image")
	}
	extension := normalizedMemeExtension(rendered.Extension)
	expected, ok := expectedMemeMIMEType(extension)
	if !ok || strings.ToLower(strings.TrimSpace(rendered.MIMEType)) != expected {
		return huma.Error502BadGateway("meme renderer returned an invalid image format")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(rendered.Data))
	if err != nil || !memeImageFormatMatchesMIME(format, expected) {
		return huma.Error502BadGateway("meme renderer returned an invalid image")
	}
	pixels := int64(config.Width) * int64(config.Height)
	if config.Width <= 0 || config.Height <= 0 ||
		config.Width > maxMemeImageDimension || config.Height > maxMemeImageDimension ||
		pixels <= 0 || pixels > maxMemeImagePixels {
		return huma.Error502BadGateway("meme renderer returned an image with unsafe dimensions")
	}
	return nil
}

func validateMemeThumbnailImage(data []byte) error {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return huma.Error502BadGateway("meme renderer returned an invalid template thumbnail")
	}
	pixels := int64(config.Width) * int64(config.Height)
	if config.Width <= 0 || config.Height <= 0 ||
		config.Width > maxMemeThumbnailDimension || config.Height > maxMemeThumbnailDimension ||
		pixels <= 0 || pixels > maxMemeThumbnailPixels {
		return huma.Error502BadGateway("meme template thumbnail has unsafe dimensions")
	}
	return nil
}

func supportedMemeOverlayMIME(value string) bool {
	switch value {
	case "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp":
		return true
	default:
		return false
	}
}

func memeImageFormatMatchesMIME(format, mimeType string) bool {
	switch mimeType {
	case "image/png":
		return format == "png"
	case "image/jpeg":
		return format == "jpeg"
	case "image/gif":
		return format == "gif"
	case "image/webp":
		return format == "webp"
	default:
		return false
	}
}

func expectedMemeMIMEType(extension string) (string, bool) {
	switch extension {
	case "png":
		return "image/png", true
	case "jpg":
		return "image/jpeg", true
	case "gif":
		return "image/gif", true
	case "webp":
		return "image/webp", true
	default:
		return "", false
	}
}

func normalizedMemeExtension(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return "png"
	}
	if value == "jpeg" {
		return "jpg"
	}
	return value
}

func (h *MemeHandler) requireWorkspaceAccess(ctx context.Context, workspaceID string, edit bool) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if h.db == nil {
		return huma.Error503ServiceUnavailable("meme generation is unavailable")
	}
	var (
		allowed bool
		err     error
	)
	if edit {
		allowed, err = middleware.CheckWorkspaceEditAccess(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	} else {
		allowed, err = middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, middleware.GetUserID(ctx))
	}
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		if edit {
			return huma.Error403Forbidden("workspace editor role required")
		}
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *MemeHandler) allow(ctx context.Context, action string, limit int) bool {
	if h.limiter == nil {
		return false
	}
	userID := strings.TrimSpace(middleware.GetUserID(ctx))
	return h.limiter.Allow("memes:"+action+":"+userID, limit, time.Minute)
}

func (h *MemeHandler) rollbackImportedMeme(ctx context.Context, media models.MediaAttachment) {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), memeCleanupTimeout)
	defer cancel()
	if err := h.importer.RollbackMeme(cleanupCtx, media); err != nil {
		log.Printf("failed to roll back generated meme media %s (%T)", media.ID, err)
	}
}

func (h *MemeHandler) cachedMemeThumbnail(key string) (memeThumbnailCacheEntry, bool) {
	now := h.now()
	h.thumbnailMu.Lock()
	defer h.thumbnailMu.Unlock()
	entry, ok := h.thumbnailCache[key]
	if !ok || !entry.expiresAt.After(now) {
		if ok {
			h.thumbnailBytes -= int64(len(entry.data))
		}
		delete(h.thumbnailCache, key)
		return memeThumbnailCacheEntry{}, false
	}
	entry.data = append([]byte(nil), entry.data...)
	return entry, true
}

func (h *MemeHandler) storeMemeThumbnail(key string, entry memeThumbnailCacheEntry) {
	h.thumbnailMu.Lock()
	defer h.thumbnailMu.Unlock()
	if existing, ok := h.thumbnailCache[key]; ok {
		h.thumbnailBytes -= int64(len(existing.data))
		delete(h.thumbnailCache, key)
	}
	entry.data = append([]byte(nil), entry.data...)
	for len(h.thumbnailCache) >= maxMemeThumbnailEntries ||
		h.thumbnailBytes+int64(len(entry.data)) > maxMemeThumbnailCacheBytes {
		var oldestKey string
		var oldest time.Time
		for candidateKey, candidate := range h.thumbnailCache {
			if oldestKey == "" || candidate.expiresAt.Before(oldest) {
				oldestKey, oldest = candidateKey, candidate.expiresAt
			}
		}
		if oldestKey == "" {
			break
		}
		h.thumbnailBytes -= int64(len(h.thumbnailCache[oldestKey].data))
		delete(h.thumbnailCache, oldestKey)
	}
	if int64(len(entry.data)) > maxMemeThumbnailCacheBytes {
		return
	}
	h.thumbnailCache[key] = entry
	h.thumbnailBytes += int64(len(entry.data))
}

func memeThumbnailOutput(entry memeThumbnailCacheEntry) *GetMemeTemplateThumbnailOutput {
	output := &GetMemeTemplateThumbnailOutput{CacheControl: "private, max-age=3600"}
	output.Body.TemplateID = entry.templateID
	output.Body.MIMEType = entry.mimeType
	output.Body.DataBase64 = base64.StdEncoding.EncodeToString(entry.data)
	return output
}

func publicMemeTemplates(templates []memes.Template) []memes.Template {
	result := make([]memes.Template, 0, len(templates))
	for _, template := range templates {
		result = append(result, publicMemeTemplate(template))
	}
	return result
}

func publicMemeTemplate(template memes.Template) memes.Template {
	template.BlankURL = ""
	template.Example.URL = ""
	template.SourceURL = publicMemeSourceURL(template.SourceURL)
	template.SearchTerms = append([]string(nil), template.SearchTerms...)
	template.Styles = append([]string(nil), template.Styles...)
	template.Keywords = append([]string(nil), template.Keywords...)
	template.Example.Text = append([]string(nil), template.Example.Text...)
	return template
}

func publicMemeSourceURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "localhost" || !strings.Contains(hostname, ".") || memeSourceHostIsReserved(hostname) {
		return ""
	}
	if address := net.ParseIP(hostname); address != nil && (!address.IsGlobalUnicast() || address.IsPrivate()) {
		return ""
	}
	return parsed.String()
}

func memeSourceHostIsReserved(hostname string) bool {
	for _, suffix := range []string{
		".localhost", ".local", ".internal", ".lan", ".home", ".test", ".example", ".invalid",
	} {
		if strings.HasSuffix(hostname, suffix) {
			return true
		}
	}
	return false
}

func memeCatalogMetadata(providerKey string, catalog memes.Catalog, returned int) MemeCatalogMetadata {
	metadata := MemeCatalogMetadata{
		ProviderKey: strings.TrimSpace(providerKey), Revision: memeCatalogRevision(catalog),
		Stale: catalog.Stale, TotalTemplates: len(catalog.Templates), Returned: returned,
	}
	if !catalog.RefreshedAt.IsZero() {
		metadata.RefreshedAt = catalog.RefreshedAt.UTC().Format(time.RFC3339Nano)
	}
	return metadata
}

func memeCatalogRevision(catalog memes.Catalog) string {
	templates := append([]memes.Template(nil), catalog.Templates...)
	sort.Slice(templates, func(left, right int) bool { return templates[left].ID < templates[right].ID })
	payload, err := json.Marshal(templates)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func memeRecipeResponse(recipe models.MediaGenerationRecipe, document MemeRecipeDocument) MemeRecipeResponse {
	response := MemeRecipeResponse{
		MediaID: recipe.MediaID, WorkspaceID: recipe.WorkspaceID, CreatedByID: recipe.CreatedByID,
		Kind: recipe.Kind, RendererKey: recipe.RendererKey, TemplateID: recipe.TemplateID,
		TemplateName: recipe.TemplateName, TemplateSourceURL: recipe.TemplateSourceURL,
		CatalogRevision: recipe.CatalogRevision, Recipe: document,
	}
	if !recipe.CreatedAt.IsZero() {
		response.CreatedAt = recipe.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	return response
}

func decodeMemeRecipe(value string, destination *MemeRecipeDocument) error {
	decoder := json.NewDecoder(strings.NewReader(value))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return errors.New("meme recipe has trailing data")
	} else if !errors.Is(err, io.EOF) {
		return err
	}
	if destination.SchemaVersion != memeRecipeSchemaVersion || destination.Template.ID == "" || len(destination.Captions) == 0 {
		return errors.New("meme recipe is incomplete")
	}
	return nil
}

func truncateMemeText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maximum {
		runes = runes[:maximum]
	}
	return string(runes)
}

func defaultMemeAltText(template memes.Template, captions []string) string {
	name := strings.Join(strings.Fields(template.Name), " ")
	if name == "" {
		name = "Meme"
	} else {
		name += " meme"
	}
	visible := make([]string, 0, len(captions))
	for _, caption := range captions {
		if caption = strings.Join(strings.Fields(caption), " "); caption != "" {
			visible = append(visible, caption)
		}
	}
	value := name + "."
	if len(visible) > 0 {
		value = name + ". Text: " + strings.Join(visible, "; ") + "."
	}
	return truncateMemeText(value, memegeneration.MaxAltTextCharacters)
}

func hasMemeControl(value string, allowLineBreaks bool) bool {
	for _, current := range value {
		if !unicode.IsControl(current) {
			continue
		}
		if allowLineBreaks && (current == '\n' || current == '\r' || current == '\t') {
			continue
		}
		return true
	}
	return false
}

func memeProviderError(err error) error {
	switch {
	case errors.Is(err, memes.ErrInvalidRequest):
		return huma.Error400BadRequest("meme renderer rejected the request")
	case errors.Is(err, memes.ErrNotFound):
		return huma.Error404NotFound("meme template not found")
	case errors.Is(err, memes.ErrRateLimited):
		return huma.Error429TooManyRequests("meme renderer is rate limited; try again later")
	case errors.Is(err, memes.ErrDisabled):
		return huma.Error503ServiceUnavailable("meme generation is not configured")
	case errors.Is(err, memes.ErrUnavailable), errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return huma.Error503ServiceUnavailable("meme renderer is temporarily unavailable")
	case errors.Is(err, memes.ErrUnauthorized):
		return huma.Error503ServiceUnavailable("meme renderer authorization is not configured correctly")
	case errors.Is(err, memes.ErrInvalidResponse), errors.Is(err, memes.ErrResponseTooLarge), errors.Is(err, memes.ErrUnsafeResponseURL):
		return huma.Error502BadGateway("meme renderer returned an invalid response")
	default:
		return huma.Error502BadGateway("meme renderer failed")
	}
}

func memeImportError(err error) error {
	var statusErr huma.StatusError
	if errors.As(err, &statusErr) {
		return err
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "quota exceeded") || strings.Contains(message, "limit exceeded") {
		return huma.Error403Forbidden("workspace media storage limit reached")
	}
	return huma.Error500InternalServerError("failed to save generated meme")
}

func memeSuggestionError(err error) error {
	switch {
	case errors.Is(err, memegeneration.ErrInvalidInput):
		return huma.Error400BadRequest("meme suggestion input is invalid")
	case errors.Is(err, memegeneration.ErrInvalidResponse), errors.Is(err, ai.ErrEmptyResponse):
		return huma.Error502BadGateway("AI meme suggestions returned an invalid response")
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return huma.Error503ServiceUnavailable("AI meme suggestions timed out")
	}
	var providerErr *ai.ProviderError
	if errors.As(err, &providerErr) {
		if providerErr.StatusCode == http.StatusTooManyRequests {
			return huma.Error429TooManyRequests("AI meme suggestions are rate limited; try again later")
		}
		if providerErr.StatusCode == http.StatusUnauthorized || providerErr.StatusCode == http.StatusForbidden {
			return huma.Error503ServiceUnavailable("AI meme suggestions are not configured correctly")
		}
	}
	return huma.Error502BadGateway("AI meme suggestions failed")
}
