package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	imageEditorSchemaVersion       = 2
	imageEditorSnapshotVersion     = 1
	imageEditorPageStorageVersion  = 1
	imageEditorColorGradeVersion   = 1
	imageEditorMaxPages            = 35
	imageEditorMaxLayersPerPage    = 500
	imageEditorMaxDocumentBytes    = 10 << 20
	imageEditorMinDimension        = 64
	imageEditorMaxDimension        = 4096
	imageEditorMaxPixels           = 25_000_000
	imageEditorRecoveryRevisionTTL = 30 * 24 * time.Hour
	imageEditorMediaWriteChunkSize = 200
)

type ImageEditorPreset struct {
	Key           string   `json:"key" doc:"Stable preset key"`
	Name          string   `json:"name" doc:"User-visible preset name"`
	WidthPX       int      `json:"width_px" doc:"Canvas width in pixels"`
	HeightPX      int      `json:"height_px" doc:"Canvas height in pixels"`
	DefaultFormat string   `json:"default_format" enum:"png,jpeg,webp" doc:"Default export format"`
	Profiles      []string `json:"profiles" doc:"Compatible provider content profiles"`
}

var imageEditorPresets = []ImageEditorPreset{
	{Key: "instagram-square", Name: "Instagram square", WidthPX: 1080, HeightPX: 1080, DefaultFormat: "png", Profiles: []string{"instagram_feed", "carousel"}},
	{Key: "instagram-portrait", Name: "Instagram portrait", WidthPX: 1080, HeightPX: 1350, DefaultFormat: "png", Profiles: []string{"instagram_feed", "carousel"}},
	{Key: "story-reel-slide", Name: "Story, Reel, or TikTok slide", WidthPX: 1080, HeightPX: 1920, DefaultFormat: "png", Profiles: []string{"instagram_story", "tiktok_photo"}},
	{Key: "linkedin-square", Name: "LinkedIn square", WidthPX: 1200, HeightPX: 1200, DefaultFormat: "png", Profiles: []string{"linkedin_post"}},
	{Key: "linkedin-landscape", Name: "LinkedIn landscape", WidthPX: 1200, HeightPX: 627, DefaultFormat: "png", Profiles: []string{"linkedin_post"}},
	{Key: "x-landscape", Name: "X landscape", WidthPX: 1600, HeightPX: 900, DefaultFormat: "png", Profiles: []string{"short_text"}},
	{Key: "youtube-thumbnail", Name: "YouTube thumbnail", WidthPX: 1280, HeightPX: 720, DefaultFormat: "jpeg", Profiles: []string{"youtube_video"}},
}

type ImageEditorHandler struct {
	db           *bun.DB
	auth         middleware.Authenticator
	enabled      bool
	modelBaseURL string
}

func NewImageEditorHandler(db *bun.DB, authenticator middleware.Authenticator, enabled bool, modelBaseURL string) *ImageEditorHandler {
	return &ImageEditorHandler{
		db:           db,
		auth:         authenticator,
		enabled:      enabled,
		modelBaseURL: strings.TrimRight(strings.TrimSpace(modelBaseURL), "/"),
	}
}

type ImageEditorPresetOutput struct {
	Body struct {
		Enabled             bool                `json:"enabled"`
		SchemaVersion       int                 `json:"schema_version"`
		BackgroundModelBase string              `json:"background_model_base_url"`
		Presets             []ImageEditorPreset `json:"presets"`
	}
}

type ListImageEditorDesignsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Search      string `query:"search"`
	Trashed     bool   `query:"trashed" doc:"List recoverable deleted designs instead of active designs."`
	Limit       int    `query:"limit" minimum:"1" maximum:"100"`
	Offset      int    `query:"offset" minimum:"0"`
}

type ListImageEditorDesignsOutput struct {
	Body struct {
		Designs []ImageEditorDesignSummary `json:"designs"`
		Total   int                        `json:"total"`
		CanEdit bool                       `json:"can_edit"`
	}
}

type CreateImageEditorDesignInput struct {
	Body struct {
		WorkspaceID     string `json:"workspace_id"`
		Title           string `json:"title" maxLength:"160"`
		PresetKey       string `json:"preset_key"`
		WidthPX         int    `json:"width_px"`
		HeightPX        int    `json:"height_px"`
		SourceMediaID   string `json:"source_media_id,omitempty" doc:"Source library image. Reopens its active editing design when one exists."`
		ClientRequestID string `json:"client_request_id,omitempty" maxLength:"200" doc:"Stable client request ID used to make design creation idempotent"`
	}
}

type CreateImageEditorDesignOutput struct {
	Body ImageEditorDocumentResponse
}

type GetImageEditorDesignInput struct {
	PathID string `path:"id"`
}

type GetImageEditorDesignOutput struct {
	Body ImageEditorDocumentResponse
}

type UpdateImageEditorDesignInput struct {
	PathID string `path:"id"`
	Body   struct {
		ExpectedRevision int                        `json:"expected_revision" minimum:"1"`
		Document         ImageEditorDocumentPayload `json:"document"`
		CoverPreviewID   string                     `json:"cover_preview_media_id,omitempty"`
		RecoveryReason   string                     `json:"recovery_reason,omitempty" enum:"idle,export,close"`
	}
}

type UpdateImageEditorDesignOutput struct {
	Body ImageEditorDocumentResponse
}

type DeleteImageEditorDesignInput struct {
	PathID string `path:"id"`
}

type DeleteImageEditorDesignOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type ToggleImageEditorDesignFavoriteInput struct {
	PathID string `path:"id"`
}

type ToggleImageEditorDesignFavoriteOutput struct {
	Body struct {
		IsFavorite bool `json:"is_favorite"`
	}
}

type DuplicateImageEditorDesignInput struct {
	PathID string `path:"id"`
}

type DuplicateImageEditorDesignOutput struct {
	Body ImageEditorDocumentResponse
}

type ListImageEditorRevisionsInput struct {
	PathID string `path:"id"`
	Cursor string `query:"cursor" maxLength:"1024"`
	Limit  int    `query:"limit" minimum:"1" maximum:"100"`
}

type ImageEditorRevisionSummary struct {
	ID        string              `json:"id"`
	Revision  int                 `json:"revision"`
	Kind      string              `json:"kind"`
	Name      string              `json:"name,omitempty"`
	CreatedAt string              `json:"created_at"`
	ExpiresAt string              `json:"expires_at,omitempty"`
	Actor     EditorRevisionActor `json:"actor"`
}

type ListImageEditorRevisionsOutput struct {
	Body struct {
		Revisions  []ImageEditorRevisionSummary `json:"revisions"`
		NextCursor string                       `json:"next_cursor,omitempty"`
	}
}

type GetImageEditorRevisionInput struct {
	PathID     string `path:"id"`
	RevisionID string `path:"revision_id"`
}

type ImageEditorRevisionResponse struct {
	Summary             ImageEditorRevisionSummary `json:"summary"`
	CoverPreviewMediaID string                     `json:"cover_preview_media_id,omitempty"`
	Document            ImageEditorDocumentPayload `json:"document"`
}

type GetImageEditorRevisionOutput struct {
	Body ImageEditorRevisionResponse
}

type DeleteImageEditorRevisionInput struct {
	PathID     string `path:"id"`
	RevisionID string `path:"revision_id"`
	Confirm    bool   `query:"confirm" required:"true" doc:"Confirm permanent removal of this named checkpoint"`
}

type DeleteImageEditorRevisionOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type CreateImageEditorCheckpointInput struct {
	PathID string `path:"id"`
	Body   struct {
		Name             string `json:"name" minLength:"1" maxLength:"100"`
		ExpectedRevision int    `json:"expected_revision" minimum:"1"`
	}
}

type CreateImageEditorCheckpointOutput struct {
	Body ImageEditorRevisionSummary
}

type RestoreImageEditorRevisionInput struct {
	PathID     string `path:"id"`
	RevisionID string `path:"revision_id"`
	Body       struct {
		ExpectedRevision int `json:"expected_revision" minimum:"1"`
	}
}

type RestoreImageEditorRevisionOutput struct {
	Body ImageEditorDocumentResponse
}

type CreateImageEditorReturnTokenInput struct {
	Body struct {
		WorkspaceID  string         `json:"workspace_id"`
		ReturnURL    string         `json:"return_url"`
		Purpose      string         `json:"purpose" maxLength:"64"`
		MaxSelection int            `json:"max_selection" minimum:"1" maximum:"35"`
		Constraints  map[string]any `json:"constraints"`
	}
}

type CreateImageEditorReturnTokenOutput struct {
	Body struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}
}

type CompleteImageEditorReturnTokenInput struct {
	Token string `path:"token"`
	Body  struct {
		DesignID string   `json:"design_id"`
		MediaIDs []string `json:"media_ids" maxItems:"35"`
	}
}

type CompleteImageEditorReturnTokenOutput struct {
	Body struct {
		ReturnURL string `json:"return_url"`
	}
}

type ConsumeImageEditorReturnTokenInput struct {
	Token string `path:"token"`
}

type ConsumeImageEditorReturnTokenOutput struct {
	Body struct {
		WorkspaceID string         `json:"workspace_id"`
		ReturnURL   string         `json:"return_url"`
		Purpose     string         `json:"purpose"`
		DesignID    string         `json:"design_id"`
		MediaIDs    []string       `json:"media_ids"`
		Constraints map[string]any `json:"constraints"`
	}
}

func (h *ImageEditorHandler) RegisterRoutes(api huma.API) {
	h.registerPresets(api)
	h.registerDesigns(api)
	h.registerRevisions(api)
	h.registerReturnTokens(api)
	h.registerTemplates(api)
	h.registerBrandKit(api)
	h.registerMediaOrganization(api)
}

func (h *ImageEditorHandler) registerReturnTokens(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID:   "create-image-editor-return-token",
		Method:        http.MethodPost,
		Path:          "/image-editor/return-tokens",
		Summary:       "Create a one-time OpenPost Image Editor composer return token",
		Tags:          []string{tagImageEditor},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403},
	}, h.createReturnToken)
	huma.Register(api, huma.Operation{
		OperationID: "complete-image-editor-return-token",
		Method:      http.MethodPost,
		Path:        "/image-editor/return-tokens/{token}/complete",
		Summary:     "Store ordered OpenPost Image Editor exports for a composer return",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.completeReturnToken)
	huma.Register(api, huma.Operation{
		OperationID: "consume-image-editor-return-token",
		Method:      http.MethodPost,
		Path:        "/image-editor/return-tokens/{token}/consume",
		Summary:     "Consume a completed OpenPost Image Editor composer return token",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.consumeReturnToken)
}

func (h *ImageEditorHandler) registerPresets(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-image-editor-presets",
		Method:      http.MethodGet,
		Path:        "/image-editor/presets",
		Summary:     "List OpenPost Image Editor presets and runtime configuration",
		Tags:        []string{tagImageEditor},
	}, func(_ context.Context, _ *struct{}) (*ImageEditorPresetOutput, error) {
		out := &ImageEditorPresetOutput{}
		out.Body.Enabled = h.enabled
		out.Body.SchemaVersion = imageEditorSchemaVersion
		out.Body.BackgroundModelBase = h.modelBaseURL
		out.Body.Presets = append([]ImageEditorPreset(nil), imageEditorPresets...)
		return out, nil
	})
}

func (h *ImageEditorHandler) registerDesigns(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-image-editor-designs",
		Method:      http.MethodGet,
		Path:        "/image-editor/designs",
		Summary:     "List OpenPost Image Editor designs",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.listDesigns)

	huma.Register(api, huma.Operation{
		OperationID:   "create-image-editor-design",
		Method:        http.MethodPost,
		Path:          "/image-editor/designs",
		Summary:       "Create an OpenPost Image Editor design",
		Tags:          []string{tagImageEditor},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403, 404},
	}, h.createDesign)

	huma.Register(api, huma.Operation{
		OperationID: "get-image-editor-design",
		Method:      http.MethodGet,
		Path:        "/image-editor/designs/{id}",
		Summary:     "Get an OpenPost Image Editor design",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.getDesign)

	huma.Register(api, huma.Operation{
		OperationID: "restore-image-editor-design", Method: http.MethodPost,
		Path: "/image-editor/designs/{id}/restore", Summary: "Restore a trashed OpenPost Image Editor design",
		Tags: []string{tagImageEditor}, Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors: []int{403, 404},
	}, h.restoreDesign)

	huma.Register(api, huma.Operation{
		OperationID: "update-image-editor-design",
		Method:      http.MethodPatch,
		Path:        "/image-editor/designs/{id}",
		Summary:     "Save an OpenPost Image Editor design with optimistic concurrency",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.updateDesign)

	huma.Register(api, huma.Operation{
		OperationID: "delete-image-editor-design",
		Method:      http.MethodDelete,
		Path:        "/image-editor/designs/{id}",
		Summary:     "Move an OpenPost Image Editor design to trash",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.deleteDesign)

	huma.Register(api, huma.Operation{
		OperationID: "toggle-image-editor-design-favorite",
		Method:      http.MethodPatch,
		Path:        "/image-editor/designs/{id}/favorite",
		Summary:     "Toggle an OpenPost Image Editor design favorite",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.toggleDesignFavorite)

	huma.Register(api, huma.Operation{
		OperationID: "duplicate-image-editor-design",
		Method:      http.MethodPost,
		Path:        "/image-editor/designs/{id}/duplicate",
		Summary:     "Duplicate an OpenPost Image Editor design",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.duplicateDesign)
}

func (h *ImageEditorHandler) registerRevisions(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-image-editor-design-revisions",
		Method:      http.MethodGet,
		Path:        "/image-editor/designs/{id}/revisions",
		Summary:     "List OpenPost Image Editor design recovery revisions and checkpoints",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.listRevisions)

	huma.Register(api, huma.Operation{
		OperationID: "get-image-editor-design-revision",
		Method:      http.MethodGet,
		Path:        "/image-editor/designs/{id}/revisions/{revision_id}",
		Summary:     "Inspect an OpenPost Image Editor design revision",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.getRevision)

	huma.Register(api, huma.Operation{
		OperationID: "delete-image-editor-design-checkpoint",
		Method:      http.MethodDelete,
		Path:        "/image-editor/designs/{id}/revisions/{revision_id}",
		Summary:     "Remove a named OpenPost Image Editor checkpoint",
		Description: "Removes only the selected named checkpoint and its snapshot references. The current design and other versions remain unchanged.",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.deleteRevision)

	huma.Register(api, huma.Operation{
		OperationID: "create-image-editor-design-checkpoint",
		Method:      http.MethodPost,
		Path:        "/image-editor/designs/{id}/revisions",
		Summary:     "Create a named OpenPost Image Editor design checkpoint",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.createCheckpoint)

	huma.Register(api, huma.Operation{
		OperationID: "restore-image-editor-design-revision",
		Method:      http.MethodPost,
		Path:        "/image-editor/designs/{id}/revisions/{revision_id}/restore",
		Summary:     "Restore an OpenPost Image Editor design revision as a new head",
		Tags:        []string{tagImageEditor},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.restoreRevision)
}

func (h *ImageEditorHandler) ensureEnabled() error {
	if !h.enabled {
		return huma.Error404NotFound("OpenPost Image Editor is disabled")
	}
	return nil
}

func (h *ImageEditorHandler) requireAccess(ctx context.Context, workspaceID string, edit bool) (bool, error) {
	userID := middleware.GetUserID(ctx)
	role, ok, err := workspaceRole(ctx, h.db, workspaceID, userID)
	if err != nil {
		return false, huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !ok {
		return false, huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	canEdit := role == models.WorkspaceRoleAdmin || role == models.WorkspaceRoleEditor
	if edit && !canEdit {
		return false, huma.Error403Forbidden("workspace is read-only for this user")
	}
	return canEdit, nil
}
