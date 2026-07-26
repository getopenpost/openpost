package handlers

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	studioSchemaVersion       = 1
	studioMaxPages            = 35
	studioMaxLayersPerPage    = 500
	studioMaxDocumentBytes    = 10 << 20
	studioMinDimension        = 64
	studioMaxDimension        = 4096
	studioMaxPixels           = 25_000_000
	studioRecoveryRevisionTTL = 30 * 24 * time.Hour
)

type StudioPreset struct {
	Key           string   `json:"key" doc:"Stable preset key"`
	Name          string   `json:"name" doc:"User-visible preset name"`
	WidthPX       int      `json:"width_px" doc:"Canvas width in pixels"`
	HeightPX      int      `json:"height_px" doc:"Canvas height in pixels"`
	DefaultFormat string   `json:"default_format" enum:"png,jpeg,webp" doc:"Default export format"`
	Profiles      []string `json:"profiles" doc:"Compatible provider content profiles"`
}

var studioPresets = []StudioPreset{
	{Key: "instagram-square", Name: "Instagram square", WidthPX: 1080, HeightPX: 1080, DefaultFormat: "png", Profiles: []string{"instagram_feed", "carousel"}},
	{Key: "instagram-portrait", Name: "Instagram portrait", WidthPX: 1080, HeightPX: 1350, DefaultFormat: "png", Profiles: []string{"instagram_feed", "carousel"}},
	{Key: "story-reel-slide", Name: "Story, Reel, or TikTok slide", WidthPX: 1080, HeightPX: 1920, DefaultFormat: "png", Profiles: []string{"instagram_story", "tiktok_photo"}},
	{Key: "linkedin-square", Name: "LinkedIn square", WidthPX: 1200, HeightPX: 1200, DefaultFormat: "png", Profiles: []string{"linkedin_post"}},
	{Key: "linkedin-landscape", Name: "LinkedIn landscape", WidthPX: 1200, HeightPX: 627, DefaultFormat: "png", Profiles: []string{"linkedin_post"}},
	{Key: "x-landscape", Name: "X landscape", WidthPX: 1600, HeightPX: 900, DefaultFormat: "png", Profiles: []string{"short_text"}},
	{Key: "youtube-thumbnail", Name: "YouTube thumbnail", WidthPX: 1280, HeightPX: 720, DefaultFormat: "jpeg", Profiles: []string{"youtube_video"}},
}

type StudioTransform struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Rotation float64 `json:"rotation"`
	FlipX    bool    `json:"flip_x"`
	FlipY    bool    `json:"flip_y"`
}

type StudioTextShadow struct {
	Color   string  `json:"color"`
	Blur    float64 `json:"blur"`
	OffsetX float64 `json:"offset_x"`
	OffsetY float64 `json:"offset_y"`
}

type StudioTextCurve struct {
	Type     string  `json:"type" enum:"none,arc_up,arc_down,wave,circle,ellipse"`
	Strength float64 `json:"strength" minimum:"0.05" maximum:"1"`
	Offset   float64 `json:"offset" minimum:"-1" maximum:"1"`
	Reverse  bool    `json:"reverse"`
}

type StudioTextValue struct {
	Text           string           `json:"text"`
	FontFamily     string           `json:"font_family"`
	FontAssetID    string           `json:"font_asset_id,omitempty"`
	FontWeight     int              `json:"font_weight"`
	FontStyle      string           `json:"font_style"`
	FontSize       float64          `json:"font_size"`
	Color          string           `json:"color"`
	Align          string           `json:"align"`
	LineHeight     float64          `json:"line_height"`
	LetterSpacing  float64          `json:"letter_spacing"`
	HighlightColor string           `json:"highlight_color,omitempty"`
	StrokeColor    string           `json:"stroke_color,omitempty"`
	StrokeWidth    float64          `json:"stroke_width"`
	Shadow         StudioTextShadow `json:"shadow"`
	Curve          *StudioTextCurve `json:"curve,omitempty"`
}

type StudioImageAdjustments struct {
	Brightness  float64 `json:"brightness"`
	Contrast    float64 `json:"contrast"`
	Saturation  float64 `json:"saturation"`
	Temperature float64 `json:"temperature"`
	Exposure    float64 `json:"exposure"`
	Highlights  float64 `json:"highlights"`
	Shadows     float64 `json:"shadows"`
	Blur        float64 `json:"blur"`
}

type StudioCrop struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type StudioImageValue struct {
	MediaID          string                 `json:"media_id"`
	SourceWidth      int                    `json:"source_width"`
	SourceHeight     int                    `json:"source_height"`
	IntrinsicPending bool                   `json:"intrinsic_pending,omitempty"`
	Fit              string                 `json:"fit" enum:"cover,contain,stretch"`
	Crop             StudioCrop             `json:"crop"`
	Adjustments      StudioImageAdjustments `json:"adjustments"`
}

type StudioShapeValue struct {
	Kind        string  `json:"kind" enum:"rectangle,rounded_rectangle,ellipse,line"`
	Fill        string  `json:"fill"`
	Stroke      string  `json:"stroke"`
	StrokeWidth float64 `json:"stroke_width"`
	Radius      float64 `json:"radius"`
}

type StudioPaintPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type StudioPaintSpan struct {
	Y     float64 `json:"y"`
	X     float64 `json:"x"`
	Width float64 `json:"width"`
}

type StudioGradientStop struct {
	Offset float64 `json:"offset" minimum:"0" maximum:"1"`
	Color  string  `json:"color"`
}

type StudioGradientValue struct {
	Type    string               `json:"type" enum:"linear,radial,angle,reflected,diamond"`
	Start   StudioPaintPoint     `json:"start"`
	End     StudioPaintPoint     `json:"end"`
	Stops   []StudioGradientStop `json:"stops"`
	Reverse bool                 `json:"reverse"`
}

type StudioPaintValue struct {
	Kind         string               `json:"kind" enum:"stroke,fill,gradient"`
	Color        string               `json:"color"`
	Size         float64              `json:"size" minimum:"0" maximum:"512"`
	Opacity      float64              `json:"opacity" minimum:"0" maximum:"1"`
	SourceWidth  float64              `json:"source_width" minimum:"0"`
	SourceHeight float64              `json:"source_height" minimum:"0"`
	Points       []StudioPaintPoint   `json:"points"`
	Spans        []StudioPaintSpan    `json:"spans"`
	Gradient     *StudioGradientValue `json:"gradient,omitempty"`
}

type StudioShadowEffect struct {
	Color    string  `json:"color"`
	Opacity  float64 `json:"opacity" minimum:"0" maximum:"1"`
	Blur     float64 `json:"blur" minimum:"0" maximum:"100"`
	Angle    float64 `json:"angle" minimum:"-360" maximum:"360"`
	Distance float64 `json:"distance" minimum:"0" maximum:"500"`
}

type StudioLayerEffects struct {
	BlendMode   string              `json:"blend_mode" enum:"normal,multiply,screen,overlay,darken,lighten,soft_light"`
	DropShadow  *StudioShadowEffect `json:"drop_shadow,omitempty"`
	InnerShadow *StudioShadowEffect `json:"inner_shadow,omitempty"`
	Stroke      *StudioStrokeEffect `json:"stroke,omitempty"`
}

type StudioStrokeEffect struct {
	Color    string  `json:"color"`
	Opacity  float64 `json:"opacity" minimum:"0" maximum:"1"`
	Width    float64 `json:"width" minimum:"0" maximum:"500"`
	Position string  `json:"position" enum:"inside,center,outside"`
}

type StudioLayerMask struct {
	Shape  string  `json:"shape" enum:"rectangle,rounded_rectangle,circle,ellipse,diamond"`
	Inset  float64 `json:"inset" minimum:"0"`
	Radius float64 `json:"radius" minimum:"0"`
}

type StudioLayer struct {
	ID        string              `json:"id"`
	Type      string              `json:"type" enum:"text,image,shape,paint,group"`
	Name      string              `json:"name"`
	ParentID  string              `json:"parent_id,omitempty"`
	Visible   bool                `json:"visible"`
	Locked    bool                `json:"locked"`
	Opacity   float64             `json:"opacity"`
	Transform StudioTransform     `json:"transform"`
	Text      *StudioTextValue    `json:"text,omitempty"`
	Image     *StudioImageValue   `json:"image,omitempty"`
	Shape     *StudioShapeValue   `json:"shape,omitempty"`
	Paint     *StudioPaintValue   `json:"paint,omitempty"`
	Effects   *StudioLayerEffects `json:"effects,omitempty"`
	Mask      *StudioLayerMask    `json:"mask,omitempty"`
}

type StudioPagePayload struct {
	ID                  string        `json:"id"`
	Name                string        `json:"name"`
	BackgroundColor     string        `json:"background_color"`
	Layers              []StudioLayer `json:"layers"`
	PreviewMediaID      string        `json:"preview_media_id,omitempty"`
	LatestExportMediaID string        `json:"latest_export_media_id,omitempty"`
}

type StudioExportDefaults struct {
	Format  string  `json:"format" enum:"png,jpeg,webp"`
	Quality float64 `json:"quality" minimum:"0.1" maximum:"1"`
}

type StudioDocumentPayload struct {
	SchemaVersion    int                  `json:"schema_version"`
	Title            string               `json:"title"`
	PresetKey        string               `json:"preset_key"`
	WidthPX          int                  `json:"width_px"`
	HeightPX         int                  `json:"height_px"`
	BrandKitID       string               `json:"brand_kit_id,omitempty"`
	BrandKitRevision int                  `json:"brand_kit_revision"`
	ExportDefaults   StudioExportDefaults `json:"export_defaults"`
	Pages            []StudioPagePayload  `json:"pages"`
}

type StudioDocumentResponse struct {
	ID                  string                `json:"id"`
	WorkspaceID         string                `json:"workspace_id"`
	CreatedByID         string                `json:"created_by_id"`
	Revision            int                   `json:"revision"`
	CanEdit             bool                  `json:"can_edit"`
	CoverPreviewMediaID string                `json:"cover_preview_media_id,omitempty"`
	CreatedAt           string                `json:"created_at"`
	UpdatedAt           string                `json:"updated_at"`
	Document            StudioDocumentPayload `json:"document"`
}

type StudioDesignSummary struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	PresetKey           string `json:"preset_key"`
	WidthPX             int    `json:"width_px"`
	HeightPX            int    `json:"height_px"`
	PageCount           int    `json:"page_count"`
	Revision            int    `json:"revision"`
	CoverPreviewMediaID string `json:"cover_preview_media_id,omitempty"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
}

type StudioHandler struct {
	db           *bun.DB
	auth         middleware.Authenticator
	enabled      bool
	modelBaseURL string
}

func NewStudioHandler(db *bun.DB, authenticator middleware.Authenticator, enabled bool, modelBaseURL string) *StudioHandler {
	return &StudioHandler{
		db:           db,
		auth:         authenticator,
		enabled:      enabled,
		modelBaseURL: strings.TrimRight(strings.TrimSpace(modelBaseURL), "/"),
	}
}

type StudioPresetOutput struct {
	Body struct {
		Enabled             bool           `json:"enabled"`
		SchemaVersion       int            `json:"schema_version"`
		BackgroundModelBase string         `json:"background_model_base_url"`
		Presets             []StudioPreset `json:"presets"`
	}
}

type ListStudioDesignsInput struct {
	WorkspaceID string `query:"workspace_id" required:"true"`
	Search      string `query:"search"`
	Limit       int    `query:"limit" minimum:"1" maximum:"100"`
	Offset      int    `query:"offset" minimum:"0"`
}

type ListStudioDesignsOutput struct {
	Body struct {
		Designs []StudioDesignSummary `json:"designs"`
		Total   int                   `json:"total"`
		CanEdit bool                  `json:"can_edit"`
	}
}

type CreateStudioDesignInput struct {
	Body struct {
		WorkspaceID   string `json:"workspace_id"`
		Title         string `json:"title" maxLength:"160"`
		PresetKey     string `json:"preset_key"`
		WidthPX       int    `json:"width_px"`
		HeightPX      int    `json:"height_px"`
		SourceMediaID string `json:"source_media_id,omitempty"`
	}
}

type CreateStudioDesignOutput struct {
	Body StudioDocumentResponse
}

type GetStudioDesignInput struct {
	PathID string `path:"id"`
}

type GetStudioDesignOutput struct {
	Body StudioDocumentResponse
}

type UpdateStudioDesignInput struct {
	PathID string `path:"id"`
	Body   struct {
		ExpectedRevision int                   `json:"expected_revision" minimum:"1"`
		Document         StudioDocumentPayload `json:"document"`
		CoverPreviewID   string                `json:"cover_preview_media_id,omitempty"`
		RecoveryReason   string                `json:"recovery_reason,omitempty" enum:"idle,export,close"`
	}
}

type UpdateStudioDesignOutput struct {
	Body StudioDocumentResponse
}

type DeleteStudioDesignInput struct {
	PathID string `path:"id"`
}

type DeleteStudioDesignOutput struct {
	Body struct {
		Deleted bool `json:"deleted"`
	}
}

type DuplicateStudioDesignInput struct {
	PathID string `path:"id"`
}

type DuplicateStudioDesignOutput struct {
	Body StudioDocumentResponse
}

type ListStudioRevisionsInput struct {
	PathID string `path:"id"`
}

type StudioRevisionSummary struct {
	ID        string `json:"id"`
	Revision  int    `json:"revision"`
	Kind      string `json:"kind"`
	Name      string `json:"name,omitempty"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

type ListStudioRevisionsOutput struct {
	Body struct {
		Revisions []StudioRevisionSummary `json:"revisions"`
	}
}

type CreateStudioCheckpointInput struct {
	PathID string `path:"id"`
	Body   struct {
		Name string `json:"name" minLength:"1" maxLength:"100"`
	}
}

type CreateStudioCheckpointOutput struct {
	Body StudioRevisionSummary
}

type RestoreStudioRevisionInput struct {
	PathID     string `path:"id"`
	RevisionID string `path:"revision_id"`
	Body       struct {
		ExpectedRevision int `json:"expected_revision" minimum:"1"`
	}
}

type RestoreStudioRevisionOutput struct {
	Body StudioDocumentResponse
}

type CreateStudioReturnTokenInput struct {
	Body struct {
		WorkspaceID  string         `json:"workspace_id"`
		ReturnURL    string         `json:"return_url"`
		Purpose      string         `json:"purpose" maxLength:"64"`
		MaxSelection int            `json:"max_selection" minimum:"1" maximum:"35"`
		Constraints  map[string]any `json:"constraints"`
	}
}

type CreateStudioReturnTokenOutput struct {
	Body struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}
}

type CompleteStudioReturnTokenInput struct {
	Token string `path:"token"`
	Body  struct {
		DesignID string   `json:"design_id"`
		MediaIDs []string `json:"media_ids" maxItems:"35"`
	}
}

type CompleteStudioReturnTokenOutput struct {
	Body struct {
		ReturnURL string `json:"return_url"`
	}
}

type ConsumeStudioReturnTokenInput struct {
	Token string `path:"token"`
}

type ConsumeStudioReturnTokenOutput struct {
	Body struct {
		WorkspaceID string         `json:"workspace_id"`
		ReturnURL   string         `json:"return_url"`
		Purpose     string         `json:"purpose"`
		DesignID    string         `json:"design_id"`
		MediaIDs    []string       `json:"media_ids"`
		Constraints map[string]any `json:"constraints"`
	}
}

func (h *StudioHandler) RegisterRoutes(api huma.API) {
	h.registerPresets(api)
	h.registerDesigns(api)
	h.registerRevisions(api)
	h.registerReturnTokens(api)
	h.registerTemplates(api)
	h.registerBrandKit(api)
	h.registerMediaOrganization(api)
}

func (h *StudioHandler) registerReturnTokens(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID:   "create-studio-return-token",
		Method:        http.MethodPost,
		Path:          "/studio/return-tokens",
		Summary:       "Create a one-time Studio composer return token",
		Tags:          []string{tagStudio},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403},
	}, h.createReturnToken)
	huma.Register(api, huma.Operation{
		OperationID: "complete-studio-return-token",
		Method:      http.MethodPost,
		Path:        "/studio/return-tokens/{token}/complete",
		Summary:     "Store ordered Studio exports for a composer return",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.completeReturnToken)
	huma.Register(api, huma.Operation{
		OperationID: "consume-studio-return-token",
		Method:      http.MethodPost,
		Path:        "/studio/return-tokens/{token}/consume",
		Summary:     "Consume a completed Studio composer return token",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.consumeReturnToken)
}

func (h *StudioHandler) registerPresets(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-studio-presets",
		Method:      http.MethodGet,
		Path:        "/studio/presets",
		Summary:     "List OpenPost Studio presets and runtime configuration",
		Tags:        []string{tagStudio},
	}, func(_ context.Context, _ *struct{}) (*StudioPresetOutput, error) {
		out := &StudioPresetOutput{}
		out.Body.Enabled = h.enabled
		out.Body.SchemaVersion = studioSchemaVersion
		out.Body.BackgroundModelBase = h.modelBaseURL
		out.Body.Presets = append([]StudioPreset(nil), studioPresets...)
		return out, nil
	})
}

func (h *StudioHandler) registerDesigns(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-studio-designs",
		Method:      http.MethodGet,
		Path:        "/studio/designs",
		Summary:     "List Studio designs",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403},
	}, h.listDesigns)

	huma.Register(api, huma.Operation{
		OperationID:   "create-studio-design",
		Method:        http.MethodPost,
		Path:          "/studio/designs",
		Summary:       "Create a Studio design",
		Tags:          []string{tagStudio},
		DefaultStatus: http.StatusCreated,
		Middlewares:   huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:        []int{400, 403, 404},
	}, h.createDesign)

	huma.Register(api, huma.Operation{
		OperationID: "get-studio-design",
		Method:      http.MethodGet,
		Path:        "/studio/designs/{id}",
		Summary:     "Get a Studio design",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.getDesign)

	huma.Register(api, huma.Operation{
		OperationID: "update-studio-design",
		Method:      http.MethodPatch,
		Path:        "/studio/designs/{id}",
		Summary:     "Save a Studio design with optimistic concurrency",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.updateDesign)

	huma.Register(api, huma.Operation{
		OperationID: "delete-studio-design",
		Method:      http.MethodDelete,
		Path:        "/studio/designs/{id}",
		Summary:     "Move a Studio design to trash",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.deleteDesign)

	huma.Register(api, huma.Operation{
		OperationID: "duplicate-studio-design",
		Method:      http.MethodPost,
		Path:        "/studio/designs/{id}/duplicate",
		Summary:     "Duplicate a Studio design",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.duplicateDesign)
}

func (h *StudioHandler) registerRevisions(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-studio-design-revisions",
		Method:      http.MethodGet,
		Path:        "/studio/designs/{id}/revisions",
		Summary:     "List Studio design recovery revisions and checkpoints",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{403, 404},
	}, h.listRevisions)

	huma.Register(api, huma.Operation{
		OperationID: "create-studio-design-checkpoint",
		Method:      http.MethodPost,
		Path:        "/studio/designs/{id}/revisions",
		Summary:     "Create a named Studio design checkpoint",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404},
	}, h.createCheckpoint)

	huma.Register(api, huma.Operation{
		OperationID: "restore-studio-design-revision",
		Method:      http.MethodPost,
		Path:        "/studio/designs/{id}/revisions/{revision_id}/restore",
		Summary:     "Restore a Studio design revision as a new head",
		Tags:        []string{tagStudio},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.auth)},
		Errors:      []int{400, 403, 404, 409},
	}, h.restoreRevision)
}

func (h *StudioHandler) ensureEnabled() error {
	if !h.enabled {
		return huma.Error404NotFound("OpenPost Studio is disabled")
	}
	return nil
}

func (h *StudioHandler) requireAccess(ctx context.Context, workspaceID string, edit bool) (bool, error) {
	userID := middleware.GetUserID(ctx)
	role, ok, err := middleware.WorkspaceRole(ctx, h.db, workspaceID, userID)
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

func (h *StudioHandler) listDesigns(ctx context.Context, input *ListStudioDesignsInput) (*ListStudioDesignsOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.WorkspaceID) == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	canEdit, err := h.requireAccess(ctx, input.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	limit := input.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := h.db.NewSelect().Model((*models.DesignDocument)(nil)).
		Where("workspace_id = ? AND deleted_at IS NULL", input.WorkspaceID)
	if search := strings.TrimSpace(input.Search); search != "" {
		query = query.Where("LOWER(title) LIKE ?", "%"+strings.ToLower(search)+"%")
	}
	total, err := query.Count(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to count Studio designs")
	}
	var rows []struct {
		models.DesignDocument
		PageCount              int    `bun:"page_count"`
		FallbackPreviewMediaID string `bun:"fallback_preview_media_id"`
	}
	err = h.db.NewSelect().
		TableExpr("design_documents AS d").
		ColumnExpr("d.*").
		ColumnExpr("(SELECT COUNT(*) FROM design_pages p WHERE p.design_document_id = d.id) AS page_count").
		ColumnExpr(`(
			SELECT r.media_id
			FROM design_media_references AS r
			JOIN media_attachments AS m ON m.id = r.media_id
			WHERE r.design_document_id = d.id
				AND r.usage = 'layer'
				AND m.asset_kind = 'library'
			ORDER BY r.created_at ASC
			LIMIT 1
		) AS fallback_preview_media_id`).
		Where("d.workspace_id = ? AND d.deleted_at IS NULL", input.WorkspaceID).
		Apply(func(q *bun.SelectQuery) *bun.SelectQuery {
			if search := strings.TrimSpace(input.Search); search != "" {
				return q.Where("LOWER(d.title) LIKE ?", "%"+strings.ToLower(search)+"%")
			}
			return q
		}).
		OrderExpr("d.updated_at DESC").
		Limit(limit).
		Offset(input.Offset).
		Scan(ctx, &rows)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to list Studio designs")
	}
	out := &ListStudioDesignsOutput{}
	out.Body.Total = total
	out.Body.CanEdit = canEdit
	out.Body.Designs = make([]StudioDesignSummary, 0, len(rows))
	for _, row := range rows {
		if row.CoverPreviewMediaID == "" {
			row.CoverPreviewMediaID = row.FallbackPreviewMediaID
		}
		out.Body.Designs = append(out.Body.Designs, designSummary(row.DesignDocument, row.PageCount))
	}
	return out, nil
}

func (h *StudioHandler) createDesign(ctx context.Context, input *CreateStudioDesignInput) (*CreateStudioDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if _, err := h.requireAccess(ctx, workspaceID, true); err != nil {
		return nil, err
	}
	width, height, presetKey, err := resolveStudioDimensions(input.Body.PresetKey, input.Body.WidthPX, input.Body.HeightPX)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	title := strings.TrimSpace(input.Body.Title)
	if title == "" {
		title = "Untitled design"
	}
	now := time.Now().UTC()
	document := &models.DesignDocument{
		ID:            uuid.NewString(),
		WorkspaceID:   workspaceID,
		CreatedByID:   middleware.GetUserID(ctx),
		Title:         title,
		SchemaVersion: studioSchemaVersion,
		Revision:      1,
		PresetKey:     presetKey,
		WidthPX:       width,
		HeightPX:      height,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	page := StudioPagePayload{
		ID:              uuid.NewString(),
		Name:            "Page 1",
		BackgroundColor: "#ffffff",
		Layers:          []StudioLayer{},
	}
	if sourceID := strings.TrimSpace(input.Body.SourceMediaID); sourceID != "" {
		var media models.MediaAttachment
		err := h.db.NewSelect().Model(&media).
			Where("id = ? AND workspace_id = ? AND asset_kind = ?", sourceID, workspaceID, "library").
			Scan(ctx)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, huma.Error404NotFound(errMediaNotFound)
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load source media")
		}
		document.CoverPreviewMediaID = media.ID
		page.Layers = append(page.Layers, newStudioImageLayer(media, width, height))
	}
	payload := StudioDocumentPayload{
		SchemaVersion:  studioSchemaVersion,
		Title:          title,
		PresetKey:      presetKey,
		WidthPX:        width,
		HeightPX:       height,
		ExportDefaults: StudioExportDefaults{Format: defaultStudioFormat(presetKey), Quality: 0.92},
		Pages:          []StudioPagePayload{page},
	}
	if err := validateStudioPayload(payload); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(document).Exec(txCtx); err != nil {
			return err
		}
		if err := insertStudioPages(txCtx, tx, document.ID, payload.Pages, now); err != nil {
			return err
		}
		return replaceStudioMediaReferences(txCtx, tx, document, payload.Pages)
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to create Studio design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &CreateStudioDesignOutput{Body: *response}, nil
}

func (h *StudioHandler) getDesign(ctx context.Context, input *GetStudioDesignInput) (*GetStudioDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	response, err := h.documentResponse(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	return &GetStudioDesignOutput{Body: *response}, nil
}

//nolint:gocyclo // The transaction keeps validation, CAS, page replacement, references, and recovery atomic.
func (h *StudioHandler) updateDesign(ctx context.Context, input *UpdateStudioDesignInput) (*UpdateStudioDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	if err := validateStudioPayload(input.Body.Document); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	if document.Revision != input.Body.ExpectedRevision {
		return nil, huma.NewError(http.StatusConflict, "Studio design changed elsewhere; reload or save a copy")
	}
	if err := h.validateMediaReferences(
		ctx,
		document.WorkspaceID,
		input.Body.Document.Pages,
		input.Body.CoverPreviewID,
	); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	nextRevision := document.Revision + 1
	document.Title = strings.TrimSpace(input.Body.Document.Title)
	document.SchemaVersion = input.Body.Document.SchemaVersion
	document.Revision = nextRevision
	document.PresetKey = input.Body.Document.PresetKey
	document.WidthPX = input.Body.Document.WidthPX
	document.HeightPX = input.Body.Document.HeightPX
	document.BrandKitID = input.Body.Document.BrandKitID
	document.BrandKitRevision = input.Body.Document.BrandKitRevision
	document.CoverPreviewMediaID = strings.TrimSpace(input.Body.CoverPreviewID)
	document.UpdatedAt = now

	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model(document).
			Column("title", "schema_version", "revision", "preset_key", "width_px", "height_px", "brand_kit_id", "brand_kit_revision", "cover_preview_media_id", "updated_at").
			WherePK().
			Where("revision = ?", input.Body.ExpectedRevision).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return errStudioRevisionConflict
		}
		if _, err := tx.NewDelete().Model((*models.DesignPage)(nil)).
			Where("design_document_id = ?", document.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if err := insertStudioPages(txCtx, tx, document.ID, input.Body.Document.Pages, now); err != nil {
			return err
		}
		if err := replaceStudioMediaReferences(txCtx, tx, document, input.Body.Document.Pages); err != nil {
			return err
		}
		return h.maybeStoreRecoveryRevision(
			txCtx,
			tx,
			document,
			input.Body.Document,
			input.Body.RecoveryReason == "export" || input.Body.RecoveryReason == "close",
		)
	})
	if errors.Is(err, errStudioRevisionConflict) {
		return nil, huma.NewError(http.StatusConflict, "Studio design changed elsewhere; reload or save a copy")
	}
	if err != nil {
		log.Printf("failed to save Studio design %s: %v", document.ID, err)
		return nil, huma.Error500InternalServerError("failed to save Studio design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &UpdateStudioDesignOutput{Body: *response}, nil
}

var errStudioRevisionConflict = errors.New("studio revision conflict")

func (h *StudioHandler) deleteDesign(ctx context.Context, input *DeleteStudioDesignInput) (*DeleteStudioDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	result, err := h.db.NewUpdate().Model((*models.DesignDocument)(nil)).
		Set("deleted_at = ?", time.Now().UTC()).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ? AND deleted_at IS NULL", document.ID).
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to delete Studio design")
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, huma.Error404NotFound("Studio design not found")
	}
	return &DeleteStudioDesignOutput{Body: struct {
		Deleted bool `json:"deleted"`
	}{Deleted: true}}, nil
}

func (h *StudioHandler) duplicateDesign(ctx context.Context, input *DuplicateStudioDesignInput) (*DuplicateStudioDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	source, err := h.documentResponse(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, source.WorkspaceID, true); err != nil {
		return nil, err
	}
	payload := cloneStudioPayload(source.Document)
	payload.Title = strings.TrimSpace(source.Document.Title) + " copy"
	now := time.Now().UTC()
	document := &models.DesignDocument{
		ID:                  uuid.NewString(),
		WorkspaceID:         source.WorkspaceID,
		CreatedByID:         middleware.GetUserID(ctx),
		Title:               payload.Title,
		SchemaVersion:       payload.SchemaVersion,
		Revision:            1,
		PresetKey:           payload.PresetKey,
		WidthPX:             payload.WidthPX,
		HeightPX:            payload.HeightPX,
		BrandKitID:          payload.BrandKitID,
		BrandKitRevision:    payload.BrandKitRevision,
		CoverPreviewMediaID: source.CoverPreviewMediaID,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(document).Exec(txCtx); err != nil {
			return err
		}
		if err := insertStudioPages(txCtx, tx, document.ID, payload.Pages, now); err != nil {
			return err
		}
		return replaceStudioMediaReferences(txCtx, tx, document, payload.Pages)
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to duplicate Studio design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &DuplicateStudioDesignOutput{Body: *response}, nil
}

func (h *StudioHandler) listRevisions(ctx context.Context, input *ListStudioRevisionsInput) (*ListStudioRevisionsOutput, error) {
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, false); err != nil {
		return nil, err
	}
	var revisions []models.DesignRevision
	if err := h.db.NewSelect().Model(&revisions).
		Where("design_document_id = ?", document.ID).
		OrderExpr("created_at DESC").
		Limit(100).
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to list Studio revisions")
	}
	out := &ListStudioRevisionsOutput{}
	out.Body.Revisions = make([]StudioRevisionSummary, 0, len(revisions))
	for _, revision := range revisions {
		out.Body.Revisions = append(out.Body.Revisions, revisionSummary(revision))
	}
	return out, nil
}

func (h *StudioHandler) createCheckpoint(ctx context.Context, input *CreateStudioCheckpointInput) (*CreateStudioCheckpointOutput, error) {
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	snapshot, err := compressStudioSnapshot(response.Document)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create Studio checkpoint")
	}
	revision := &models.DesignRevision{
		ID:               uuid.NewString(),
		DesignDocumentID: document.ID,
		Revision:         document.Revision,
		Kind:             "checkpoint",
		Name:             strings.TrimSpace(input.Body.Name),
		Snapshot:         snapshot,
		CreatedByID:      middleware.GetUserID(ctx),
		CreatedAt:        time.Now().UTC(),
	}
	if revision.Name == "" {
		return nil, huma.Error400BadRequest("checkpoint name is required")
	}
	if _, err := h.db.NewInsert().Model(revision).Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to create Studio checkpoint")
	}
	return &CreateStudioCheckpointOutput{Body: revisionSummary(*revision)}, nil
}

func (h *StudioHandler) restoreRevision(ctx context.Context, input *RestoreStudioRevisionInput) (*RestoreStudioRevisionOutput, error) {
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, true); err != nil {
		return nil, err
	}
	if document.Revision != input.Body.ExpectedRevision {
		return nil, huma.NewError(http.StatusConflict, "Studio design changed elsewhere; reload before restoring")
	}
	var revision models.DesignRevision
	err = h.db.NewSelect().Model(&revision).
		Where("id = ? AND design_document_id = ?", input.RevisionID, document.ID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("Studio revision not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load Studio revision")
	}
	payload, err := decompressStudioSnapshot(revision.Snapshot)
	if err != nil {
		return nil, huma.Error400BadRequest("Studio revision is corrupt")
	}
	if err := validateStudioPayload(payload); err != nil {
		return nil, huma.Error400BadRequest("Studio revision is invalid")
	}
	update := &UpdateStudioDesignInput{PathID: document.ID}
	update.Body.ExpectedRevision = document.Revision
	update.Body.Document = payload
	result, err := h.updateDesign(ctx, update)
	if err != nil {
		return nil, err
	}
	return &RestoreStudioRevisionOutput{Body: result.Body}, nil
}

func (h *StudioHandler) createReturnToken(ctx context.Context, input *CreateStudioReturnTokenInput) (*CreateStudioReturnTokenOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
	if workspaceID == "" {
		return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
	}
	if _, err := h.requireAccess(ctx, workspaceID, true); err != nil {
		return nil, err
	}
	returnURL, err := normalizeStudioReturnURL(input.Body.ReturnURL)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	maxSelection := input.Body.MaxSelection
	if maxSelection <= 0 {
		maxSelection = 1
	}
	constraints, err := json.Marshal(input.Body.Constraints)
	if err != nil || len(constraints) > 32<<10 {
		return nil, huma.Error400BadRequest("Studio return constraints are invalid")
	}
	rawToken, tokenHash, err := newStudioReturnToken()
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create Studio return token")
	}
	now := time.Now().UTC()
	record := &models.DesignReturnToken{
		ID:              uuid.NewString(),
		TokenHash:       tokenHash,
		WorkspaceID:     workspaceID,
		UserID:          middleware.GetUserID(ctx),
		ReturnURL:       returnURL,
		Purpose:         strings.TrimSpace(input.Body.Purpose),
		MaxSelection:    maxSelection,
		ConstraintsJSON: string(constraints),
		ResultMediaIDs:  "[]",
		CreatedAt:       now,
		ExpiresAt:       now.Add(2 * time.Hour),
	}
	if record.Purpose == "" {
		record.Purpose = "post_media"
	}
	if _, err := h.db.NewInsert().Model(record).Exec(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to store Studio return token")
	}
	out := &CreateStudioReturnTokenOutput{}
	out.Body.Token = rawToken
	out.Body.ExpiresAt = record.ExpiresAt.Format(time.RFC3339)
	return out, nil
}

//nolint:gocyclo // Return completion validates the token and every ordered export constraint together.
func (h *StudioHandler) completeReturnToken(ctx context.Context, input *CompleteStudioReturnTokenInput) (*CompleteStudioReturnTokenOutput, error) {
	record, err := h.loadReturnToken(ctx, input.Token)
	if err != nil {
		return nil, err
	}
	if !record.CompletedAt.IsZero() || !record.ConsumedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "Studio return token has already been used")
	}
	mediaIDs := uniqueStudioStringsInOrder(input.Body.MediaIDs)
	if len(mediaIDs) == 0 || len(mediaIDs) > record.MaxSelection {
		return nil, huma.Error400BadRequest("Studio export count does not match the return constraints")
	}
	var media []models.MediaAttachment
	err = h.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND processing_status = ? AND id IN (?)", record.WorkspaceID, mediaReadyStatus, bun.List(mediaIDs)).
		Scan(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to validate Studio exports")
	}
	if len(media) != len(mediaIDs) {
		return nil, huma.Error400BadRequest("every Studio export must belong to the workspace")
	}
	var constraints struct {
		AllowedMIMEs []string `json:"allowed_mimes"`
		MaxWidth     int      `json:"max_width"`
		MaxHeight    int      `json:"max_height"`
		MaxFileSize  int64    `json:"max_file_size"`
	}
	if err := json.Unmarshal([]byte(record.ConstraintsJSON), &constraints); err != nil {
		return nil, huma.Error400BadRequest("Studio return constraints are invalid")
	}
	allowedMIMEs := make(map[string]struct{}, len(constraints.AllowedMIMEs))
	for _, mime := range constraints.AllowedMIMEs {
		allowedMIMEs[strings.ToLower(strings.TrimSpace(mime))] = struct{}{}
	}
	for _, item := range media {
		if len(allowedMIMEs) > 0 {
			if _, ok := allowedMIMEs[strings.ToLower(item.MimeType)]; !ok {
				return nil, huma.Error400BadRequest("a Studio export format is not supported by the composer")
			}
		}
		if constraints.MaxWidth > 0 && item.Width > constraints.MaxWidth {
			return nil, huma.Error400BadRequest("a Studio export is wider than the composer allows")
		}
		if constraints.MaxHeight > 0 && item.Height > constraints.MaxHeight {
			return nil, huma.Error400BadRequest("a Studio export is taller than the composer allows")
		}
		if constraints.MaxFileSize > 0 && item.Size > constraints.MaxFileSize {
			return nil, huma.Error400BadRequest("a Studio export is larger than the composer allows")
		}
		if input.Body.DesignID != "" && item.DesignDocumentID != input.Body.DesignID {
			return nil, huma.Error400BadRequest("every Studio export must come from the returning design")
		}
	}
	if input.Body.DesignID != "" {
		count, err := h.db.NewSelect().Model((*models.DesignDocument)(nil)).
			Where("id = ? AND workspace_id = ? AND deleted_at IS NULL", input.Body.DesignID, record.WorkspaceID).
			Count(ctx)
		if err != nil || count != 1 {
			return nil, huma.Error400BadRequest("Studio design must belong to the workspace")
		}
	}
	encodedIDs, _ := json.Marshal(mediaIDs)
	now := time.Now().UTC()
	result, err := h.db.NewUpdate().Model((*models.DesignReturnToken)(nil)).
		Set("result_media_ids = ?", string(encodedIDs)).
		Set("design_id = ?", strings.TrimSpace(input.Body.DesignID)).
		Set("completed_at = ?", now).
		Where("id = ? AND completed_at IS NULL AND consumed_at IS NULL", record.ID).
		Exec(ctx)
	if err != nil {
		log.Printf("failed to complete Studio return token %s: %v", record.ID, err)
		return nil, huma.Error500InternalServerError("failed to complete Studio return token")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.NewError(http.StatusConflict, "Studio return token has already been used")
	}
	out := &CompleteStudioReturnTokenOutput{}
	out.Body.ReturnURL = record.ReturnURL
	return out, nil
}

func (h *StudioHandler) consumeReturnToken(ctx context.Context, input *ConsumeStudioReturnTokenInput) (*ConsumeStudioReturnTokenOutput, error) {
	record, err := h.loadReturnToken(ctx, input.Token)
	if err != nil {
		return nil, err
	}
	if record.CompletedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "Studio return token is not complete")
	}
	if !record.ConsumedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "Studio return token has already been consumed")
	}
	now := time.Now().UTC()
	result, err := h.db.NewUpdate().Model((*models.DesignReturnToken)(nil)).
		Set("consumed_at = ?", now).
		Where("id = ? AND consumed_at IS NULL", record.ID).
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to consume Studio return token")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.NewError(http.StatusConflict, "Studio return token has already been consumed")
	}
	out := &ConsumeStudioReturnTokenOutput{}
	out.Body.WorkspaceID = record.WorkspaceID
	out.Body.ReturnURL = record.ReturnURL
	out.Body.Purpose = record.Purpose
	out.Body.DesignID = record.DesignID
	if err := json.Unmarshal([]byte(record.ResultMediaIDs), &out.Body.MediaIDs); err != nil {
		return nil, huma.Error500InternalServerError("Studio return token result is corrupt")
	}
	if err := json.Unmarshal([]byte(record.ConstraintsJSON), &out.Body.Constraints); err != nil {
		out.Body.Constraints = map[string]any{}
	}
	return out, nil
}

func (h *StudioHandler) loadReturnToken(ctx context.Context, rawToken string) (*models.DesignReturnToken, error) {
	if strings.TrimSpace(rawToken) == "" {
		return nil, huma.Error400BadRequest("Studio return token is required")
	}
	hash := sha256.Sum256([]byte(rawToken))
	var record models.DesignReturnToken
	err := h.db.NewSelect().Model(&record).
		Where("token_hash = ? AND user_id = ?", hex.EncodeToString(hash[:]), middleware.GetUserID(ctx)).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("Studio return token not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load Studio return token")
	}
	if time.Now().UTC().After(record.ExpiresAt) {
		return nil, huma.Error404NotFound("Studio return token has expired")
	}
	if _, err := h.requireAccess(ctx, record.WorkspaceID, true); err != nil {
		return nil, err
	}
	return &record, nil
}

func newStudioReturnToken() (string, string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(bytes[:])
	hash := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(hash[:]), nil
}

func normalizeStudioReturnURL(raw string) (string, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/") || strings.HasPrefix(parsed.Path, "//") {
		return "", errors.New("studio return URL must be a same-origin OpenPost route")
	}
	path := parsed.Path
	allowed := path == "/" ||
		path == "/media" ||
		strings.HasPrefix(path, "/posts/") ||
		strings.HasPrefix(path, "/publications/")
	if !allowed {
		return "", errors.New("studio return URL is not an allowed composer route")
	}
	return parsed.String(), nil
}

func uniqueStudioStringsInOrder(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func (h *StudioHandler) loadDocument(ctx context.Context, id string) (*models.DesignDocument, error) {
	var document models.DesignDocument
	err := h.db.NewSelect().Model(&document).
		Where("id = ? AND deleted_at IS NULL", id).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("Studio design not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load Studio design")
	}
	return &document, nil
}

func (h *StudioHandler) documentResponse(ctx context.Context, id string) (*StudioDocumentResponse, error) {
	document, err := h.loadDocument(ctx, id)
	if err != nil {
		return nil, err
	}
	canEdit, err := h.requireAccess(ctx, document.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	var pages []models.DesignPage
	if err := h.db.NewSelect().Model(&pages).
		Where("design_document_id = ?", document.ID).
		OrderExpr("display_order ASC").
		Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to load Studio pages")
	}
	payload := StudioDocumentPayload{
		SchemaVersion:    document.SchemaVersion,
		Title:            document.Title,
		PresetKey:        document.PresetKey,
		WidthPX:          document.WidthPX,
		HeightPX:         document.HeightPX,
		BrandKitID:       document.BrandKitID,
		BrandKitRevision: document.BrandKitRevision,
		ExportDefaults:   StudioExportDefaults{Format: defaultStudioFormat(document.PresetKey), Quality: 0.92},
		Pages:            make([]StudioPagePayload, 0, len(pages)),
	}
	for _, page := range pages {
		var layers []StudioLayer
		if err := json.Unmarshal([]byte(page.SceneJSON), &layers); err != nil {
			return nil, huma.Error500InternalServerError("Studio design contains an invalid page")
		}
		payload.Pages = append(payload.Pages, StudioPagePayload{
			ID:                  page.ID,
			Name:                page.Name,
			BackgroundColor:     page.BackgroundColor,
			Layers:              layers,
			PreviewMediaID:      page.PreviewMediaID,
			LatestExportMediaID: page.LatestExportMediaID,
		})
	}
	return &StudioDocumentResponse{
		ID:                  document.ID,
		WorkspaceID:         document.WorkspaceID,
		CreatedByID:         document.CreatedByID,
		Revision:            document.Revision,
		CanEdit:             canEdit,
		CoverPreviewMediaID: document.CoverPreviewMediaID,
		CreatedAt:           document.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           document.UpdatedAt.UTC().Format(time.RFC3339),
		Document:            payload,
	}, nil
}

func (h *StudioHandler) validateMediaReferences(
	ctx context.Context,
	workspaceID string,
	pages []StudioPagePayload,
	extraIDs ...string,
) error {
	ids := studioMediaIDs(pages)
	set := make(map[string]struct{}, len(ids)+len(extraIDs))
	for _, id := range ids {
		set[id] = struct{}{}
	}
	for _, id := range extraIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			set[trimmed] = struct{}{}
		}
	}
	ids = ids[:0]
	for id := range set {
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil
	}
	count, err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(ids)).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate Studio media")
	}
	if count != len(ids) {
		return huma.Error400BadRequest("every Studio media reference must belong to the workspace")
	}
	return nil
}

func resolveStudioDimensions(presetKey string, customWidth, customHeight int) (int, int, string, error) {
	key := strings.TrimSpace(presetKey)
	if key == "" {
		key = studioPresets[0].Key
	}
	if key == "custom" {
		if err := validateStudioDimensions(customWidth, customHeight); err != nil {
			return 0, 0, "", err
		}
		return customWidth, customHeight, key, nil
	}
	for _, preset := range studioPresets {
		if preset.Key == key {
			return preset.WidthPX, preset.HeightPX, key, nil
		}
	}
	return 0, 0, "", fmt.Errorf("unknown Studio preset")
}

func validateStudioDimensions(width, height int) error {
	if width < studioMinDimension || height < studioMinDimension || width > studioMaxDimension || height > studioMaxDimension {
		return fmt.Errorf("studio dimensions must be between %d and %d pixels", studioMinDimension, studioMaxDimension)
	}
	if width*height > studioMaxPixels {
		return fmt.Errorf("studio canvas cannot exceed %d pixels", studioMaxPixels)
	}
	return nil
}

//nolint:gocyclo // Document validation reports precise failures across bounded pages and hierarchy.
func validateStudioPayload(payload StudioDocumentPayload) error {
	if payload.SchemaVersion != studioSchemaVersion {
		return fmt.Errorf("unsupported Studio schema version")
	}
	if strings.TrimSpace(payload.Title) == "" || len([]rune(payload.Title)) > 160 {
		return fmt.Errorf("studio title must be between 1 and 160 characters")
	}
	if err := validateStudioDimensions(payload.WidthPX, payload.HeightPX); err != nil {
		return err
	}
	if len(payload.Pages) == 0 || len(payload.Pages) > studioMaxPages {
		return fmt.Errorf("studio designs must contain between 1 and %d pages", studioMaxPages)
	}
	encoded, err := json.Marshal(payload)
	if err != nil || len(encoded) > studioMaxDocumentBytes {
		return fmt.Errorf("studio design exceeds the %d MiB document limit", studioMaxDocumentBytes>>20)
	}
	pageIDs := make(map[string]struct{}, len(payload.Pages))
	layerIDs := make(map[string]struct{})
	for _, page := range payload.Pages {
		if strings.TrimSpace(page.ID) == "" {
			return fmt.Errorf("every Studio page requires an ID")
		}
		if _, exists := pageIDs[page.ID]; exists {
			return fmt.Errorf("studio page IDs must be unique")
		}
		pageIDs[page.ID] = struct{}{}
		if len(page.Layers) > studioMaxLayersPerPage {
			return fmt.Errorf("a Studio page cannot contain more than %d layers", studioMaxLayersPerPage)
		}
		if !studioHexColor.MatchString(page.BackgroundColor) {
			return fmt.Errorf("studio page backgrounds must use hexadecimal colors")
		}
		pageLayerIDs := make(map[string]struct{}, len(page.Layers))
		parents := make(map[string]string, len(page.Layers))
		for _, layer := range page.Layers {
			if strings.TrimSpace(layer.ID) == "" {
				return fmt.Errorf("every Studio layer requires an ID")
			}
			if _, exists := layerIDs[layer.ID]; exists {
				return fmt.Errorf("studio layer IDs must be unique across the document")
			}
			layerIDs[layer.ID] = struct{}{}
			pageLayerIDs[layer.ID] = struct{}{}
			parents[layer.ID] = layer.ParentID
			if err := validateStudioLayer(layer); err != nil {
				return err
			}
		}
		for id, parentID := range parents {
			if parentID == "" {
				continue
			}
			if _, exists := pageLayerIDs[parentID]; !exists {
				return fmt.Errorf("studio layer %s references a missing parent", id)
			}
			seen := map[string]bool{id: true}
			for current := parentID; current != ""; current = parents[current] {
				if seen[current] {
					return fmt.Errorf("studio layer hierarchy cannot contain cycles")
				}
				seen[current] = true
			}
		}
	}
	return nil
}

//nolint:gocyclo // Layer-specific validation is centralized so every write path enforces identical limits.
func validateStudioLayer(layer StudioLayer) error {
	if !finiteStudioNumber(layer.Opacity) || layer.Opacity < 0 || layer.Opacity > 1 {
		return fmt.Errorf("studio layer opacity must be between 0 and 1")
	}
	transformValues := []float64{
		layer.Transform.X,
		layer.Transform.Y,
		layer.Transform.Width,
		layer.Transform.Height,
		layer.Transform.Rotation,
	}
	for _, value := range transformValues {
		if !finiteStudioNumber(value) {
			return fmt.Errorf("studio layer transforms must be finite numbers")
		}
	}
	if layer.Transform.Width < 0 || layer.Transform.Height < 0 {
		return fmt.Errorf("studio layer dimensions cannot be negative")
	}
	if layer.Mask != nil {
		if !oneOfStudioString(layer.Mask.Shape, "rectangle", "rounded_rectangle", "circle", "ellipse", "diamond") ||
			!finiteStudioNumber(layer.Mask.Inset) ||
			!finiteStudioNumber(layer.Mask.Radius) ||
			layer.Mask.Inset < 0 ||
			layer.Mask.Radius < 0 {
			return fmt.Errorf("studio layer mask is invalid")
		}
	}
	if layer.Effects != nil {
		if !oneOfStudioString(layer.Effects.BlendMode, "normal", "multiply", "screen", "overlay", "darken", "lighten", "soft_light") {
			return fmt.Errorf("studio layer blend mode is invalid")
		}
		if err := validateStudioShadowEffect(layer.Effects.DropShadow); err != nil {
			return err
		}
		if err := validateStudioShadowEffect(layer.Effects.InnerShadow); err != nil {
			return err
		}
		if err := validateStudioStrokeEffect(layer.Effects.Stroke); err != nil {
			return err
		}
	}
	switch layer.Type {
	case "text":
		if layer.Text == nil || layer.Image != nil || layer.Shape != nil || layer.Paint != nil {
			return fmt.Errorf("text layers require only text properties")
		}
		if layer.Text.FontSize <= 0 ||
			!finiteStudioNumber(layer.Text.FontSize) ||
			layer.Text.FontWeight < 100 ||
			layer.Text.FontWeight > 900 ||
			!oneOfStudioString(layer.Text.FontStyle, "normal", "italic") ||
			!oneOfStudioString(layer.Text.Align, "left", "center", "right", "justify") ||
			layer.Text.LineHeight <= 0 ||
			!finiteStudioNumber(layer.Text.LineHeight) ||
			!finiteStudioNumber(layer.Text.LetterSpacing) ||
			layer.Text.StrokeWidth < 0 ||
			!finiteStudioNumber(layer.Text.StrokeWidth) ||
			len([]rune(layer.Text.Text)) > 20_000 {
			return fmt.Errorf("text layer properties are invalid")
		}
		if !studioHexColor.MatchString(layer.Text.Color) {
			return fmt.Errorf("text colors must use hexadecimal values")
		}
		if (layer.Text.HighlightColor != "" && !studioHexColor.MatchString(layer.Text.HighlightColor)) ||
			(layer.Text.StrokeColor != "" && !studioHexColor.MatchString(layer.Text.StrokeColor)) ||
			!studioHexColor.MatchString(layer.Text.Shadow.Color) ||
			!finiteStudioNumber(layer.Text.Shadow.Blur) ||
			!finiteStudioNumber(layer.Text.Shadow.OffsetX) ||
			!finiteStudioNumber(layer.Text.Shadow.OffsetY) ||
			layer.Text.Shadow.Blur < 0 ||
			layer.Text.Shadow.Blur > 100 {
			return fmt.Errorf("text effects are invalid")
		}
		if layer.Text.Curve != nil &&
			(!oneOfStudioString(layer.Text.Curve.Type, "none", "arc_up", "arc_down", "wave", "circle", "ellipse") ||
				!finiteStudioNumber(layer.Text.Curve.Strength) ||
				layer.Text.Curve.Strength < 0.05 ||
				layer.Text.Curve.Strength > 1 ||
				!finiteStudioNumber(layer.Text.Curve.Offset) ||
				layer.Text.Curve.Offset < -1 ||
				layer.Text.Curve.Offset > 1) {
			return fmt.Errorf("text curve is invalid")
		}
	case "image":
		if layer.Image == nil || layer.Text != nil || layer.Shape != nil || layer.Paint != nil || strings.TrimSpace(layer.Image.MediaID) == "" {
			return fmt.Errorf("image layers require only image properties and a media ID")
		}
		crop := layer.Image.Crop
		if !oneOfStudioString(layer.Image.Fit, "cover", "contain", "stretch") ||
			!finiteStudioNumber(crop.X) ||
			!finiteStudioNumber(crop.Y) ||
			!finiteStudioNumber(crop.Width) ||
			!finiteStudioNumber(crop.Height) ||
			crop.X < 0 ||
			crop.Y < 0 ||
			crop.Width <= 0 ||
			crop.Height <= 0 ||
			crop.X+crop.Width > 1.000001 ||
			crop.Y+crop.Height > 1.000001 {
			return fmt.Errorf("image crop must stay within normalized image bounds")
		}
		adjustments := layer.Image.Adjustments
		for _, value := range []float64{
			adjustments.Brightness,
			adjustments.Contrast,
			adjustments.Saturation,
			adjustments.Temperature,
			adjustments.Exposure,
			adjustments.Highlights,
			adjustments.Shadows,
		} {
			if !finiteStudioNumber(value) || value < -1 || value > 1 {
				return fmt.Errorf("image adjustments must be between -1 and 1")
			}
		}
		if !finiteStudioNumber(adjustments.Blur) || adjustments.Blur < 0 || adjustments.Blur > 1 {
			return fmt.Errorf("image blur must be between 0 and 1")
		}
	case "shape":
		if layer.Shape == nil || layer.Text != nil || layer.Image != nil || layer.Paint != nil {
			return fmt.Errorf("shape layers require only shape properties")
		}
		if !oneOfStudioString(layer.Shape.Kind, "rectangle", "rounded_rectangle", "ellipse", "line") ||
			layer.Shape.StrokeWidth < 0 ||
			layer.Shape.Radius < 0 ||
			!finiteStudioNumber(layer.Shape.StrokeWidth) ||
			!finiteStudioNumber(layer.Shape.Radius) {
			return fmt.Errorf("shape layer properties are invalid")
		}
		if !studioHexColor.MatchString(layer.Shape.Fill) || !studioHexColor.MatchString(layer.Shape.Stroke) {
			return fmt.Errorf("shape colors must use hexadecimal values")
		}
	case "paint":
		if layer.Paint == nil || layer.Text != nil || layer.Image != nil || layer.Shape != nil {
			return fmt.Errorf("paint layers require only paint properties")
		}
		if !oneOfStudioString(layer.Paint.Kind, "stroke", "fill", "gradient") ||
			!studioHexColor.MatchString(layer.Paint.Color) ||
			!finiteStudioNumber(layer.Paint.Size) ||
			layer.Paint.Size <= 0 ||
			layer.Paint.Size > 512 ||
			!finiteStudioNumber(layer.Paint.Opacity) ||
			layer.Paint.Opacity < 0 ||
			layer.Paint.Opacity > 1 ||
			!finiteStudioNumber(layer.Paint.SourceWidth) ||
			!finiteStudioNumber(layer.Paint.SourceHeight) ||
			layer.Paint.SourceWidth <= 0 ||
			layer.Paint.SourceHeight <= 0 ||
			len(layer.Paint.Points) > 100_000 ||
			len(layer.Paint.Spans) > 250_000 {
			return fmt.Errorf("paint layer properties are invalid")
		}
		for _, point := range layer.Paint.Points {
			if !finiteStudioNumber(point.X) || !finiteStudioNumber(point.Y) {
				return fmt.Errorf("paint layer points must be finite")
			}
		}
		for _, span := range layer.Paint.Spans {
			if !finiteStudioNumber(span.X) ||
				!finiteStudioNumber(span.Y) ||
				!finiteStudioNumber(span.Width) ||
				span.Width <= 0 {
				return fmt.Errorf("paint layer spans are invalid")
			}
		}
		if layer.Paint.Kind == "gradient" {
			if err := validateStudioGradient(layer.Paint.Gradient); err != nil {
				return err
			}
		} else if layer.Paint.Gradient != nil {
			return fmt.Errorf("only gradient paint layers can include gradient properties")
		}
	case "group":
		if layer.Text != nil || layer.Image != nil || layer.Shape != nil || layer.Paint != nil || layer.Effects != nil || layer.Mask != nil {
			return fmt.Errorf("group layers cannot contain visual properties")
		}
	default:
		return fmt.Errorf("unsupported Studio layer type")
	}
	return nil
}

func validateStudioShadowEffect(effect *StudioShadowEffect) error {
	if effect == nil {
		return nil
	}
	if !studioHexColor.MatchString(effect.Color) ||
		!finiteStudioNumber(effect.Opacity) ||
		!finiteStudioNumber(effect.Blur) ||
		!finiteStudioNumber(effect.Angle) ||
		!finiteStudioNumber(effect.Distance) ||
		effect.Opacity < 0 ||
		effect.Opacity > 1 ||
		effect.Blur < 0 ||
		effect.Blur > 100 ||
		effect.Angle < -360 ||
		effect.Angle > 360 ||
		effect.Distance < 0 ||
		effect.Distance > 500 {
		return fmt.Errorf("studio layer shadow effect is invalid")
	}
	return nil
}

func validateStudioStrokeEffect(effect *StudioStrokeEffect) error {
	if effect == nil {
		return nil
	}
	if !studioHexColor.MatchString(effect.Color) ||
		!finiteStudioNumber(effect.Opacity) ||
		effect.Opacity < 0 ||
		effect.Opacity > 1 ||
		!finiteStudioNumber(effect.Width) ||
		effect.Width <= 0 ||
		effect.Width > 500 ||
		!oneOfStudioString(effect.Position, "inside", "center", "outside") {
		return fmt.Errorf("studio layer stroke effect is invalid")
	}
	return nil
}

func validateStudioGradient(gradient *StudioGradientValue) error {
	if gradient == nil ||
		!oneOfStudioString(gradient.Type, "linear", "radial", "angle", "reflected", "diamond") ||
		!finiteStudioNumber(gradient.Start.X) ||
		!finiteStudioNumber(gradient.Start.Y) ||
		!finiteStudioNumber(gradient.End.X) ||
		!finiteStudioNumber(gradient.End.Y) ||
		len(gradient.Stops) < 2 ||
		len(gradient.Stops) > 32 {
		return fmt.Errorf("studio gradient is invalid")
	}
	for _, stop := range gradient.Stops {
		if !finiteStudioNumber(stop.Offset) ||
			stop.Offset < 0 ||
			stop.Offset > 1 ||
			!studioHexColor.MatchString(stop.Color) {
			return fmt.Errorf("studio gradient is invalid")
		}
	}
	return nil
}

func finiteStudioNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func oneOfStudioString(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func insertStudioPages(ctx context.Context, tx bun.Tx, documentID string, pages []StudioPagePayload, now time.Time) error {
	rows := make([]models.DesignPage, 0, len(pages))
	for index, page := range pages {
		scene, err := json.Marshal(page.Layers)
		if err != nil {
			return err
		}
		rows = append(rows, models.DesignPage{
			ID:                  page.ID,
			DesignDocumentID:    documentID,
			Name:                defaultStudioPageName(page.Name, index),
			DisplayOrder:        index,
			BackgroundColor:     defaultStudioBackground(page.BackgroundColor),
			SceneJSON:           string(scene),
			PreviewMediaID:      page.PreviewMediaID,
			LatestExportMediaID: page.LatestExportMediaID,
			CreatedAt:           now,
			UpdatedAt:           now,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	_, err := tx.NewInsert().Model(&rows).Exec(ctx)
	return err
}

func replaceStudioMediaReferences(ctx context.Context, tx bun.Tx, document *models.DesignDocument, pages []StudioPagePayload) error {
	if _, err := tx.NewDelete().Model((*models.DesignMediaReference)(nil)).
		Where("design_document_id = ?", document.ID).
		Exec(ctx); err != nil {
		return err
	}
	refs := make([]models.DesignMediaReference, 0)
	seen := make(map[string]bool)
	for _, page := range pages {
		for _, layer := range page.Layers {
			mediaID := ""
			usage := ""
			if layer.Image != nil {
				mediaID = strings.TrimSpace(layer.Image.MediaID)
				usage = "layer"
			} else if layer.Text != nil {
				mediaID = strings.TrimSpace(layer.Text.FontAssetID)
				usage = "font"
			}
			if mediaID == "" {
				continue
			}
			key := page.ID + "\x00" + mediaID
			if seen[key] {
				continue
			}
			seen[key] = true
			refs = append(refs, models.DesignMediaReference{
				DesignDocumentID: document.ID,
				DesignPageID:     page.ID,
				MediaID:          mediaID,
				Usage:            usage,
				CreatedAt:        time.Now().UTC(),
			})
		}
	}
	if len(refs) == 0 {
		return nil
	}
	_, err := tx.NewInsert().Model(&refs).Exec(ctx)
	return err
}

func (h *StudioHandler) maybeStoreRecoveryRevision(
	ctx context.Context,
	tx bun.Tx,
	document *models.DesignDocument,
	payload StudioDocumentPayload,
	force bool,
) error {
	var latest time.Time
	_ = tx.NewSelect().Model((*models.DesignRevision)(nil)).
		ColumnExpr("MAX(created_at)").
		Where("design_document_id = ? AND kind = ?", document.ID, "autosave").
		Scan(ctx, &latest)
	if !force && !latest.IsZero() && time.Since(latest) < 5*time.Minute {
		return nil
	}
	snapshot, err := compressStudioSnapshot(payload)
	if err != nil {
		return err
	}
	revision := &models.DesignRevision{
		ID:               uuid.NewString(),
		DesignDocumentID: document.ID,
		Revision:         document.Revision,
		Kind:             "autosave",
		Snapshot:         snapshot,
		CreatedByID:      middleware.GetUserID(ctx),
		CreatedAt:        time.Now().UTC(),
		ExpiresAt:        time.Now().UTC().Add(studioRecoveryRevisionTTL),
	}
	if _, err := tx.NewInsert().Model(revision).Exec(ctx); err != nil {
		return err
	}
	var stale []models.DesignRevision
	if err := tx.NewSelect().Model(&stale).
		Where("design_document_id = ? AND kind = ?", document.ID, "autosave").
		OrderExpr("created_at DESC").
		Limit(1000).
		Offset(20).
		Scan(ctx); err != nil {
		return err
	}
	if len(stale) > 0 {
		ids := make([]string, 0, len(stale))
		for _, item := range stale {
			ids = append(ids, item.ID)
		}
		if _, err := tx.NewDelete().Model((*models.DesignRevision)(nil)).Where("id IN (?)", bun.List(ids)).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func compressStudioSnapshot(payload StudioDocumentPayload) ([]byte, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(data); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func decompressStudioSnapshot(snapshot []byte) (StudioDocumentPayload, error) {
	var payload StudioDocumentPayload
	reader, err := gzip.NewReader(bytes.NewReader(snapshot))
	if err != nil {
		return payload, err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, studioMaxDocumentBytes+1))
	if err != nil || len(data) > studioMaxDocumentBytes {
		return payload, fmt.Errorf("invalid Studio snapshot")
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return payload, err
	}
	return payload, nil
}

func studioMediaIDs(pages []StudioPagePayload) []string {
	set := make(map[string]struct{})
	for _, page := range pages {
		if strings.TrimSpace(page.PreviewMediaID) != "" {
			set[page.PreviewMediaID] = struct{}{}
		}
		if strings.TrimSpace(page.LatestExportMediaID) != "" {
			set[page.LatestExportMediaID] = struct{}{}
		}
		for _, layer := range page.Layers {
			if layer.Image != nil && strings.TrimSpace(layer.Image.MediaID) != "" {
				set[layer.Image.MediaID] = struct{}{}
			}
			if layer.Text != nil && strings.TrimSpace(layer.Text.FontAssetID) != "" {
				set[layer.Text.FontAssetID] = struct{}{}
			}
		}
	}
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func cloneStudioPayload(payload StudioDocumentPayload) StudioDocumentPayload {
	data, _ := json.Marshal(payload)
	var clone StudioDocumentPayload
	_ = json.Unmarshal(data, &clone)
	layerIDs := make(map[string]string)
	for pageIndex := range clone.Pages {
		clone.Pages[pageIndex].ID = uuid.NewString()
		for layerIndex := range clone.Pages[pageIndex].Layers {
			oldID := clone.Pages[pageIndex].Layers[layerIndex].ID
			newID := uuid.NewString()
			layerIDs[oldID] = newID
			clone.Pages[pageIndex].Layers[layerIndex].ID = newID
		}
		for layerIndex := range clone.Pages[pageIndex].Layers {
			parentID := clone.Pages[pageIndex].Layers[layerIndex].ParentID
			if parentID != "" {
				clone.Pages[pageIndex].Layers[layerIndex].ParentID = layerIDs[parentID]
			}
		}
	}
	return clone
}

func newStudioImageLayer(media models.MediaAttachment, width, height int) StudioLayer {
	sourceWidth := media.Width
	sourceHeight := media.Height
	if sourceWidth <= 0 {
		sourceWidth = width
	}
	if sourceHeight <= 0 {
		sourceHeight = height
	}
	scale := math.Min(float64(width)/float64(sourceWidth), float64(height)/float64(sourceHeight))
	layerWidth := float64(sourceWidth) * scale
	layerHeight := float64(sourceHeight) * scale
	return StudioLayer{
		ID:      uuid.NewString(),
		Type:    "image",
		Name:    defaultStudioLayerName(media.OriginalFilename, "Image"),
		Visible: true,
		Opacity: 1,
		Transform: StudioTransform{
			X:      (float64(width) - layerWidth) / 2,
			Y:      (float64(height) - layerHeight) / 2,
			Width:  layerWidth,
			Height: layerHeight,
		},
		Image: &StudioImageValue{
			MediaID:      media.ID,
			SourceWidth:  sourceWidth,
			SourceHeight: sourceHeight,
			Fit:          "cover",
			Crop:         StudioCrop{Width: 1, Height: 1},
		},
	}
}

func designSummary(document models.DesignDocument, pageCount int) StudioDesignSummary {
	return StudioDesignSummary{
		ID:                  document.ID,
		Title:               document.Title,
		PresetKey:           document.PresetKey,
		WidthPX:             document.WidthPX,
		HeightPX:            document.HeightPX,
		PageCount:           pageCount,
		Revision:            document.Revision,
		CoverPreviewMediaID: document.CoverPreviewMediaID,
		CreatedAt:           document.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           document.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func revisionSummary(revision models.DesignRevision) StudioRevisionSummary {
	summary := StudioRevisionSummary{
		ID:        revision.ID,
		Revision:  revision.Revision,
		Kind:      revision.Kind,
		Name:      revision.Name,
		CreatedAt: revision.CreatedAt.UTC().Format(time.RFC3339),
	}
	if !revision.ExpiresAt.IsZero() {
		summary.ExpiresAt = revision.ExpiresAt.UTC().Format(time.RFC3339)
	}
	return summary
}

func defaultStudioFormat(presetKey string) string {
	for _, preset := range studioPresets {
		if preset.Key == presetKey {
			return preset.DefaultFormat
		}
	}
	return "png"
}

func defaultStudioPageName(name string, index int) string {
	if trimmed := strings.TrimSpace(name); trimmed != "" {
		return trimmed
	}
	return fmt.Sprintf("Page %d", index+1)
}

func defaultStudioBackground(value string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return "#ffffff"
}

func defaultStudioLayerName(value, fallback string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return fallback
}
