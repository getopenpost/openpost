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
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
)

const (
	imageEditorSchemaVersion       = 1
	imageEditorSnapshotVersion     = 1
	imageEditorPageStorageVersion  = 1
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

type ImageEditorTransform struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Rotation float64 `json:"rotation"`
	FlipX    bool    `json:"flip_x"`
	FlipY    bool    `json:"flip_y"`
}

type ImageEditorTextShadow struct {
	Color   string  `json:"color"`
	Blur    float64 `json:"blur"`
	OffsetX float64 `json:"offset_x"`
	OffsetY float64 `json:"offset_y"`
}

type ImageEditorTextCurve struct {
	Type     string  `json:"type" enum:"none,arc_up,arc_down,wave,circle,ellipse"`
	Strength float64 `json:"strength" minimum:"0.05" maximum:"1"`
	Offset   float64 `json:"offset" minimum:"-1" maximum:"1"`
	Reverse  bool    `json:"reverse"`
}

type ImageEditorTextValue struct {
	Text           string                `json:"text"`
	FontFamily     string                `json:"font_family"`
	FontAssetID    string                `json:"font_asset_id,omitempty"`
	FontWeight     int                   `json:"font_weight"`
	FontStyle      string                `json:"font_style"`
	Underline      bool                  `json:"underline,omitempty"`
	Strike         bool                  `json:"strike,omitempty"`
	Wrap           string                `json:"wrap,omitempty" enum:"word,character"`
	FontSize       float64               `json:"font_size"`
	Color          string                `json:"color"`
	Align          string                `json:"align"`
	LineHeight     float64               `json:"line_height"`
	LetterSpacing  float64               `json:"letter_spacing"`
	HighlightColor string                `json:"highlight_color,omitempty"`
	StrokeColor    string                `json:"stroke_color,omitempty"`
	StrokeWidth    float64               `json:"stroke_width"`
	Shadow         ImageEditorTextShadow `json:"shadow"`
	Curve          *ImageEditorTextCurve `json:"curve,omitempty"`
}

type ImageEditorImageAdjustments struct {
	Brightness  float64 `json:"brightness"`
	Contrast    float64 `json:"contrast"`
	Saturation  float64 `json:"saturation"`
	Temperature float64 `json:"temperature"`
	Tint        float64 `json:"tint"`
	Vibrance    float64 `json:"vibrance"`
	Hue         float64 `json:"hue"`
	Exposure    float64 `json:"exposure"`
	Highlights  float64 `json:"highlights"`
	Shadows     float64 `json:"shadows"`
	Blur        float64 `json:"blur"`
}

type ImageEditorCrop struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type ImageEditorImageValue struct {
	MediaID          string                      `json:"media_id"`
	SourceWidth      int                         `json:"source_width"`
	SourceHeight     int                         `json:"source_height"`
	IntrinsicPending bool                        `json:"intrinsic_pending,omitempty"`
	Fit              string                      `json:"fit" enum:"cover,contain,stretch"`
	Crop             ImageEditorCrop             `json:"crop"`
	Adjustments      ImageEditorImageAdjustments `json:"adjustments"`
}

type ImageEditorShapeValue struct {
	Kind        string  `json:"kind" enum:"rectangle,rounded_rectangle,ellipse,line"`
	Fill        string  `json:"fill"`
	Stroke      string  `json:"stroke"`
	StrokeWidth float64 `json:"stroke_width"`
	Radius      float64 `json:"radius"`
}

type ImageEditorPaintPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type ImageEditorPaintSpan struct {
	Y     float64 `json:"y"`
	X     float64 `json:"x"`
	Width float64 `json:"width"`
}

type ImageEditorEraseStroke struct {
	Size   float64                 `json:"size" minimum:"1" maximum:"512"`
	Points []ImageEditorPaintPoint `json:"points"`
}

type ImageEditorEraseMask struct {
	SourceWidth  float64                  `json:"source_width" minimum:"1"`
	SourceHeight float64                  `json:"source_height" minimum:"1"`
	Strokes      []ImageEditorEraseStroke `json:"strokes"`
	Spans        []ImageEditorPaintSpan   `json:"spans"`
}

type ImageEditorGradientStop struct {
	Offset float64 `json:"offset" minimum:"0" maximum:"1"`
	Color  string  `json:"color"`
}

type ImageEditorGradientValue struct {
	Type    string                    `json:"type" enum:"linear,radial,angle,reflected,diamond"`
	Start   ImageEditorPaintPoint     `json:"start"`
	End     ImageEditorPaintPoint     `json:"end"`
	Stops   []ImageEditorGradientStop `json:"stops"`
	Reverse bool                      `json:"reverse"`
}

type ImageEditorPaintValue struct {
	Kind         string                    `json:"kind" enum:"stroke,fill,gradient"`
	Color        string                    `json:"color"`
	Size         float64                   `json:"size" minimum:"0" maximum:"512"`
	Opacity      float64                   `json:"opacity" minimum:"0" maximum:"1"`
	SourceWidth  float64                   `json:"source_width" minimum:"0"`
	SourceHeight float64                   `json:"source_height" minimum:"0"`
	Points       []ImageEditorPaintPoint   `json:"points"`
	Spans        []ImageEditorPaintSpan    `json:"spans"`
	Gradient     *ImageEditorGradientValue `json:"gradient,omitempty"`
}

type ImageEditorShadowEffect struct {
	Color    string  `json:"color"`
	Opacity  float64 `json:"opacity" minimum:"0" maximum:"1"`
	Blur     float64 `json:"blur" minimum:"0" maximum:"100"`
	Angle    float64 `json:"angle" minimum:"-360" maximum:"360"`
	Distance float64 `json:"distance" minimum:"0" maximum:"500"`
}

type ImageEditorLayerEffects struct {
	BlendMode   string                   `json:"blend_mode" enum:"normal,multiply,screen,overlay,darken,lighten,soft_light"`
	DropShadow  *ImageEditorShadowEffect `json:"drop_shadow,omitempty"`
	InnerShadow *ImageEditorShadowEffect `json:"inner_shadow,omitempty"`
	Stroke      *ImageEditorStrokeEffect `json:"stroke,omitempty"`
}

type ImageEditorStrokeEffect struct {
	Color    string  `json:"color"`
	Opacity  float64 `json:"opacity" minimum:"0" maximum:"1"`
	Width    float64 `json:"width" minimum:"0" maximum:"500"`
	Position string  `json:"position" enum:"inside,center,outside"`
}

type ImageEditorLayerMask struct {
	Shape  string  `json:"shape" enum:"rectangle,rounded_rectangle,circle,ellipse,diamond"`
	Inset  float64 `json:"inset" minimum:"0"`
	Radius float64 `json:"radius" minimum:"0"`
}

type ImageEditorLayer struct {
	ID        string                   `json:"id"`
	Type      string                   `json:"type" enum:"text,image,shape,paint,group"`
	Name      string                   `json:"name"`
	ParentID  string                   `json:"parent_id,omitempty"`
	Visible   bool                     `json:"visible"`
	Locked    bool                     `json:"locked"`
	Opacity   float64                  `json:"opacity"`
	Transform ImageEditorTransform     `json:"transform"`
	Text      *ImageEditorTextValue    `json:"text,omitempty"`
	Image     *ImageEditorImageValue   `json:"image,omitempty"`
	Shape     *ImageEditorShapeValue   `json:"shape,omitempty"`
	Paint     *ImageEditorPaintValue   `json:"paint,omitempty"`
	Effects   *ImageEditorLayerEffects `json:"effects,omitempty"`
	Mask      *ImageEditorLayerMask    `json:"mask,omitempty"`
	EraseMask *ImageEditorEraseMask    `json:"erase_mask,omitempty"`
}

type ImageEditorPageBackgroundImage struct {
	MediaID string `json:"media_id"`
	Fit     string `json:"fit" enum:"cover,contain,stretch"`
}

type ImageEditorPageBackground struct {
	Type     string                          `json:"type" enum:"transparent,solid,gradient,image"`
	Color    string                          `json:"color,omitempty"`
	Opacity  float64                         `json:"opacity" minimum:"0" maximum:"1"`
	Gradient *ImageEditorGradientValue       `json:"gradient,omitempty"`
	Image    *ImageEditorPageBackgroundImage `json:"image,omitempty"`
}

type ImageEditorPagePayload struct {
	ID                  string                     `json:"id"`
	Name                string                     `json:"name"`
	BackgroundColor     string                     `json:"background_color"`
	Background          *ImageEditorPageBackground `json:"background,omitempty"`
	Guides              *ImageEditorPageGuides     `json:"guides,omitempty"`
	Layers              []ImageEditorLayer         `json:"layers"`
	PreviewMediaID      string                     `json:"preview_media_id,omitempty"`
	LatestExportMediaID string                     `json:"latest_export_media_id,omitempty"`
}

type ImageEditorPageGuides struct {
	Horizontal []float64 `json:"horizontal"`
	Vertical   []float64 `json:"vertical"`
}

type imageEditorStoredPageState struct {
	StorageVersion int                        `json:"storage_version"`
	Background     *ImageEditorPageBackground `json:"background"`
	Guides         *ImageEditorPageGuides     `json:"guides,omitempty"`
}

func (page ImageEditorPagePayload) BackgroundMediaID() string {
	if page.Background == nil || page.Background.Type != "image" || page.Background.Image == nil {
		return ""
	}
	return strings.TrimSpace(page.Background.Image.MediaID)
}

type ImageEditorExportDefaults struct {
	Format     string  `json:"format" enum:"png,jpeg,webp"`
	Quality    float64 `json:"quality" minimum:"0.1" maximum:"1"`
	MatteColor string  `json:"matte_color"`
}

type ImageEditorDocumentPayload struct {
	SchemaVersion    int                       `json:"schema_version"`
	Title            string                    `json:"title"`
	PresetKey        string                    `json:"preset_key"`
	WidthPX          int                       `json:"width_px"`
	HeightPX         int                       `json:"height_px"`
	BrandKitID       string                    `json:"brand_kit_id,omitempty"`
	BrandKitRevision int                       `json:"brand_kit_revision"`
	ExportDefaults   ImageEditorExportDefaults `json:"export_defaults"`
	Pages            []ImageEditorPagePayload  `json:"pages"`
}

type imageEditorRevisionSnapshot struct {
	SnapshotVersion     int                        `json:"snapshot_version"`
	Document            ImageEditorDocumentPayload `json:"document"`
	CoverPreviewMediaID string                     `json:"cover_preview_media_id,omitempty"`
}

type ImageEditorDocumentResponse struct {
	ID                  string                     `json:"id"`
	WorkspaceID         string                     `json:"workspace_id"`
	CreatedByID         string                     `json:"created_by_id"`
	Revision            int                        `json:"revision"`
	CanEdit             bool                       `json:"can_edit"`
	CoverPreviewMediaID string                     `json:"cover_preview_media_id,omitempty"`
	CreatedAt           string                     `json:"created_at"`
	UpdatedAt           string                     `json:"updated_at"`
	Document            ImageEditorDocumentPayload `json:"document"`
}

type ImageEditorDesignSummary struct {
	ID                  string `json:"id"`
	Title               string `json:"title"`
	PresetKey           string `json:"preset_key"`
	WidthPX             int    `json:"width_px"`
	HeightPX            int    `json:"height_px"`
	PageCount           int    `json:"page_count"`
	Revision            int    `json:"revision"`
	CoverPreviewMediaID string `json:"cover_preview_media_id,omitempty"`
	IsFavorite          bool   `json:"is_favorite"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
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
		SourceMediaID   string `json:"source_media_id,omitempty"`
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

func (h *ImageEditorHandler) listDesigns(ctx context.Context, input *ListImageEditorDesignsInput) (*ListImageEditorDesignsOutput, error) {
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
		return nil, huma.Error500InternalServerError("failed to count OpenPost Image Editor designs")
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
		return nil, huma.Error500InternalServerError("failed to list OpenPost Image Editor designs")
	}
	out := &ListImageEditorDesignsOutput{}
	out.Body.Total = total
	out.Body.CanEdit = canEdit
	out.Body.Designs = make([]ImageEditorDesignSummary, 0, len(rows))
	for _, row := range rows {
		if row.CoverPreviewMediaID == "" {
			row.CoverPreviewMediaID = row.FallbackPreviewMediaID
		}
		out.Body.Designs = append(out.Body.Designs, designSummary(row.DesignDocument, row.PageCount))
	}
	return out, nil
}

func (h *ImageEditorHandler) createDesign(ctx context.Context, input *CreateImageEditorDesignInput) (*CreateImageEditorDesignOutput, error) {
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
	userID := middleware.GetUserID(ctx)
	clientRequestID := strings.TrimSpace(input.Body.ClientRequestID)
	documentID, existing, err := h.resolveCreateDesignRequest(
		ctx,
		userID,
		workspaceID,
		clientRequestID,
	)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return &CreateImageEditorDesignOutput{Body: *existing}, nil
	}
	width, height, presetKey, err := resolveImageEditorDimensions(input.Body.PresetKey, input.Body.WidthPX, input.Body.HeightPX)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	title := strings.TrimSpace(input.Body.Title)
	if title == "" {
		title = "Untitled design"
	}
	now := time.Now().UTC()
	document := &models.DesignDocument{
		ID:               documentID,
		WorkspaceID:      workspaceID,
		CreatedByID:      userID,
		Title:            title,
		SchemaVersion:    imageEditorSchemaVersion,
		Revision:         1,
		PresetKey:        presetKey,
		WidthPX:          width,
		HeightPX:         height,
		ExportFormat:     defaultImageEditorFormat(presetKey),
		ExportQuality:    0.92,
		ExportMatteColor: "#ffffff",
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	page := ImageEditorPagePayload{
		ID:              uuid.NewString(),
		Name:            "Page 1",
		BackgroundColor: "#ffffff",
		Background:      defaultImageEditorPageBackground("#ffffff"),
		Layers:          []ImageEditorLayer{},
	}
	if err := h.attachCreateDesignSource(
		ctx,
		workspaceID,
		input.Body.SourceMediaID,
		width,
		height,
		document,
		&page,
	); err != nil {
		return nil, err
	}
	payload := ImageEditorDocumentPayload{
		SchemaVersion: imageEditorSchemaVersion,
		Title:         title,
		PresetKey:     presetKey,
		WidthPX:       width,
		HeightPX:      height,
		ExportDefaults: ImageEditorExportDefaults{
			Format:     defaultImageEditorFormat(presetKey),
			Quality:    0.92,
			MatteColor: "#ffffff",
		},
		Pages: []ImageEditorPagePayload{page},
	}
	if err := validateImageEditorPayload(payload); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := h.insertCreatedDesign(ctx, document, payload.Pages, now); err != nil {
		if clientRequestID != "" {
			if response, responseErr := h.documentResponse(ctx, documentID); responseErr == nil {
				return &CreateImageEditorDesignOutput{Body: *response}, nil
			}
		}
		return nil, huma.Error500InternalServerError("failed to create OpenPost Image Editor design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &CreateImageEditorDesignOutput{Body: *response}, nil
}

func (h *ImageEditorHandler) resolveCreateDesignRequest(
	ctx context.Context,
	userID string,
	workspaceID string,
	clientRequestID string,
) (string, *ImageEditorDocumentResponse, error) {
	if clientRequestID == "" {
		return uuid.NewString(), nil, nil
	}
	documentID := uuid.NewSHA1(
		uuid.NameSpaceURL,
		[]byte(fmt.Sprintf("openpost:image-editor-design:%s:%s:%s", userID, workspaceID, clientRequestID)),
	).String()
	exists, err := h.db.NewSelect().
		Model((*models.DesignDocument)(nil)).
		Where("id = ? AND workspace_id = ? AND created_by_id = ?", documentID, workspaceID, userID).
		Exists(ctx)
	if err != nil {
		return "", nil, huma.Error500InternalServerError("failed to check OpenPost Image Editor design request")
	}
	if !exists {
		return documentID, nil, nil
	}
	response, err := h.documentResponse(ctx, documentID)
	if err != nil {
		return "", nil, err
	}
	return documentID, response, nil
}

func (h *ImageEditorHandler) attachCreateDesignSource(
	ctx context.Context,
	workspaceID string,
	sourceMediaID string,
	width int,
	height int,
	document *models.DesignDocument,
	page *ImageEditorPagePayload,
) error {
	sourceID := strings.TrimSpace(sourceMediaID)
	if sourceID == "" {
		return nil
	}
	var media models.MediaAttachment
	err := h.db.NewSelect().Model(&media).
		Where("id = ? AND workspace_id = ? AND asset_kind = ?", sourceID, workspaceID, "library").
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return huma.Error404NotFound(errMediaNotFound)
	}
	if err != nil {
		return huma.Error500InternalServerError("failed to load source media")
	}
	document.CoverPreviewMediaID = media.ID
	page.Layers = append(page.Layers, newImageEditorImageLayer(media, width, height))
	return nil
}

func (h *ImageEditorHandler) insertCreatedDesign(
	ctx context.Context,
	document *models.DesignDocument,
	pages []ImageEditorPagePayload,
	now time.Time,
) error {
	return h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(document).Exec(txCtx); err != nil {
			return err
		}
		if err := insertImageEditorPages(txCtx, tx, document.ID, pages, now); err != nil {
			return err
		}
		return replaceImageEditorMediaReferences(txCtx, tx, document, pages)
	})
}

func (h *ImageEditorHandler) getDesign(ctx context.Context, input *GetImageEditorDesignInput) (*GetImageEditorDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	response, err := h.documentResponse(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	return &GetImageEditorDesignOutput{Body: *response}, nil
}

//nolint:gocyclo // The transaction keeps validation, CAS, page replacement, references, and recovery atomic.
func (h *ImageEditorHandler) updateDesign(ctx context.Context, input *UpdateImageEditorDesignInput) (*UpdateImageEditorDesignOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	if err := validateImageEditorPayload(input.Body.Document); err != nil {
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
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor design changed elsewhere; reload or save a copy")
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
	document.ExportFormat = input.Body.Document.ExportDefaults.Format
	document.ExportQuality = input.Body.Document.ExportDefaults.Quality
	document.ExportMatteColor = defaultImageEditorBackground(input.Body.Document.ExportDefaults.MatteColor)
	document.CoverPreviewMediaID = strings.TrimSpace(input.Body.CoverPreviewID)
	document.UpdatedAt = now

	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().Model(document).
			Column("title", "schema_version", "revision", "preset_key", "width_px", "height_px", "brand_kit_id", "brand_kit_revision", "export_format", "export_quality", "export_matte_color", "cover_preview_media_id", "updated_at").
			WherePK().
			Where("revision = ?", input.Body.ExpectedRevision).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return errImageEditorRevisionConflict
		}
		if _, err := tx.NewDelete().Model((*models.DesignPage)(nil)).
			Where("design_document_id = ?", document.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if err := insertImageEditorPages(txCtx, tx, document.ID, input.Body.Document.Pages, now); err != nil {
			return err
		}
		if err := replaceImageEditorMediaReferences(txCtx, tx, document, input.Body.Document.Pages); err != nil {
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
	if errors.Is(err, errImageEditorRevisionConflict) {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor design changed elsewhere; reload or save a copy")
	}
	if err != nil {
		log.Printf("failed to save OpenPost Image Editor design %s: %v", document.ID, err)
		return nil, huma.Error500InternalServerError("failed to save OpenPost Image Editor design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &UpdateImageEditorDesignOutput{Body: *response}, nil
}

var errImageEditorRevisionConflict = errors.New("image editor revision conflict")

func (h *ImageEditorHandler) deleteDesign(ctx context.Context, input *DeleteImageEditorDesignInput) (*DeleteImageEditorDesignOutput, error) {
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
		return nil, huma.Error500InternalServerError("failed to delete OpenPost Image Editor design")
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, huma.Error404NotFound("OpenPost Image Editor design not found")
	}
	return &DeleteImageEditorDesignOutput{Body: struct {
		Deleted bool `json:"deleted"`
	}{Deleted: true}}, nil
}

func (h *ImageEditorHandler) toggleDesignFavorite(ctx context.Context, input *ToggleImageEditorDesignFavoriteInput) (*ToggleImageEditorDesignFavoriteOutput, error) {
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
	document.IsFavorite = !document.IsFavorite
	_, err = h.db.NewUpdate().
		Model(document).
		Column("is_favorite").
		WherePK().
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to update OpenPost Image Editor design favorite")
	}
	out := &ToggleImageEditorDesignFavoriteOutput{}
	out.Body.IsFavorite = document.IsFavorite
	return out, nil
}

func (h *ImageEditorHandler) duplicateDesign(ctx context.Context, input *DuplicateImageEditorDesignInput) (*DuplicateImageEditorDesignOutput, error) {
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
	payload := cloneImageEditorPayload(source.Document)
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
		ExportFormat:        payload.ExportDefaults.Format,
		ExportQuality:       payload.ExportDefaults.Quality,
		ExportMatteColor:    defaultImageEditorBackground(payload.ExportDefaults.MatteColor),
		CoverPreviewMediaID: source.CoverPreviewMediaID,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(document).Exec(txCtx); err != nil {
			return err
		}
		if err := insertImageEditorPages(txCtx, tx, document.ID, payload.Pages, now); err != nil {
			return err
		}
		return replaceImageEditorMediaReferences(txCtx, tx, document, payload.Pages)
	}); err != nil {
		return nil, huma.Error500InternalServerError("failed to duplicate OpenPost Image Editor design")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &DuplicateImageEditorDesignOutput{Body: *response}, nil
}

func (h *ImageEditorHandler) listRevisions(ctx context.Context, input *ListImageEditorRevisionsInput) (*ListImageEditorRevisionsOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, false); err != nil {
		return nil, err
	}
	var revisions []models.DesignRevision
	cursor, err := decodeEditorRevisionCursor(input.Cursor)
	if err != nil {
		return nil, huma.Error400BadRequest("invalid OpenPost Image Editor revision cursor")
	}
	limit := editorRevisionLimit(input.Limit)
	query := h.db.NewSelect().Model(&revisions).
		Where("design_document_id = ?", document.ID).
		OrderExpr("created_at DESC, id DESC").
		Limit(limit + 1)
	if !cursor.CreatedAt.IsZero() {
		query = query.Where(
			"(created_at < ?) OR (created_at = ? AND id < ?)",
			cursor.CreatedAt,
			cursor.CreatedAt,
			cursor.ID,
		)
	}
	if err := query.Scan(ctx); err != nil {
		return nil, huma.Error500InternalServerError("failed to list OpenPost Image Editor revisions")
	}
	nextCursor := ""
	if len(revisions) > limit {
		next := revisions[limit-1]
		nextCursor = encodeEditorRevisionCursor(next.CreatedAt, next.ID)
		revisions = revisions[:limit]
	}
	actorIDs := make([]string, 0, len(revisions))
	for _, revision := range revisions {
		actorIDs = append(actorIDs, revision.CreatedByID)
	}
	currentUserID := middleware.GetUserID(ctx)
	actors, err := loadEditorRevisionActors(ctx, h.db, actorIDs, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor revision actors")
	}
	out := &ListImageEditorRevisionsOutput{}
	out.Body.NextCursor = nextCursor
	out.Body.Revisions = make([]ImageEditorRevisionSummary, 0, len(revisions))
	for _, revision := range revisions {
		out.Body.Revisions = append(out.Body.Revisions, imageRevisionSummary(
			revision,
			editorRevisionActor(actors, revision.CreatedByID, currentUserID),
		))
	}
	return out, nil
}

func (h *ImageEditorHandler) getRevision(
	ctx context.Context,
	input *GetImageEditorRevisionInput,
) (*GetImageEditorRevisionOutput, error) {
	if err := h.ensureEnabled(); err != nil {
		return nil, err
	}
	document, err := h.loadDocument(ctx, input.PathID)
	if err != nil {
		return nil, err
	}
	if _, err := h.requireAccess(ctx, document.WorkspaceID, false); err != nil {
		return nil, err
	}
	revision, snapshot, err := h.loadImageEditorRevisionSnapshot(ctx, h.db, document.ID, input.RevisionID)
	if err != nil {
		return nil, err
	}
	if err := validateImageEditorPayload(snapshot.Document); err != nil {
		return nil, huma.Error400BadRequest("OpenPost Image Editor revision is invalid")
	}
	currentUserID := middleware.GetUserID(ctx)
	actors, err := loadEditorRevisionActors(ctx, h.db, []string{revision.CreatedByID}, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor revision actor")
	}
	return &GetImageEditorRevisionOutput{Body: ImageEditorRevisionResponse{
		Summary: imageRevisionSummary(
			*revision,
			editorRevisionActor(actors, revision.CreatedByID, currentUserID),
		),
		CoverPreviewMediaID: snapshot.CoverPreviewMediaID,
		Document:            snapshot.Document,
	}}, nil
}

func (h *ImageEditorHandler) loadImageEditorRevisionSnapshot(
	ctx context.Context,
	db bun.IDB,
	documentID string,
	revisionID string,
) (*models.DesignRevision, imageEditorRevisionSnapshot, error) {
	var revision models.DesignRevision
	err := db.NewSelect().Model(&revision).
		Where("id = ? AND design_document_id = ?", revisionID, documentID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, imageEditorRevisionSnapshot{}, huma.Error404NotFound("OpenPost Image Editor revision not found")
	}
	if err != nil {
		return nil, imageEditorRevisionSnapshot{}, huma.Error500InternalServerError("failed to load OpenPost Image Editor revision")
	}
	snapshot, err := decompressImageEditorSnapshot(revision.Snapshot)
	if err != nil {
		return nil, imageEditorRevisionSnapshot{}, huma.Error400BadRequest("OpenPost Image Editor revision is corrupt")
	}
	return &revision, snapshot, nil
}

func (h *ImageEditorHandler) createCheckpoint(ctx context.Context, input *CreateImageEditorCheckpointInput) (*CreateImageEditorCheckpointOutput, error) {
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
	name := strings.TrimSpace(input.Body.Name)
	if name == "" {
		return nil, huma.Error400BadRequest("checkpoint name is required")
	}
	actorID := middleware.GetUserID(ctx)
	createdAt := time.Now().UTC()
	var revision *models.DesignRevision
	err = h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		var current models.DesignDocument
		query := tx.NewSelect().Model(&current).
			Where("id = ? AND deleted_at IS NULL", document.ID)
		if tx.Dialect().Name() == dialect.PG {
			query = query.For("UPDATE")
		}
		if err := query.Scan(txCtx); err != nil {
			return err
		}
		if current.Revision != input.Body.ExpectedRevision {
			return errImageEditorRevisionConflict
		}
		payload, err := imageEditorDocumentPayload(txCtx, tx, &current)
		if err != nil {
			return err
		}
		snapshot, err := compressImageEditorSnapshot(imageEditorRevisionSnapshot{
			SnapshotVersion:     imageEditorSnapshotVersion,
			Document:            payload,
			CoverPreviewMediaID: current.CoverPreviewMediaID,
		})
		if err != nil {
			return err
		}
		revision = &models.DesignRevision{
			ID:               uuid.NewString(),
			DesignDocumentID: current.ID,
			Revision:         current.Revision,
			Kind:             "checkpoint",
			Name:             name,
			Snapshot:         snapshot,
			CreatedByID:      actorID,
			CreatedAt:        createdAt,
		}
		if _, err := tx.NewInsert().Model(revision).Exec(txCtx); err != nil {
			return err
		}
		return storeImageEditorRevisionMediaReferences(
			txCtx,
			tx,
			revision.ID,
			payload,
			current.CoverPreviewMediaID,
			createdAt,
		)
	})
	if errors.Is(err, errImageEditorRevisionConflict) {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor design changed elsewhere; reload before creating a checkpoint")
	}
	if err != nil || revision == nil {
		return nil, huma.Error500InternalServerError("failed to create OpenPost Image Editor checkpoint")
	}
	currentUserID := middleware.GetUserID(ctx)
	actors, err := loadEditorRevisionActors(ctx, h.db, []string{currentUserID}, currentUserID)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor revision actor")
	}
	return &CreateImageEditorCheckpointOutput{Body: imageRevisionSummary(
		*revision,
		editorRevisionActor(actors, currentUserID, currentUserID),
	)}, nil
}

func (h *ImageEditorHandler) restoreRevision(ctx context.Context, input *RestoreImageEditorRevisionInput) (*RestoreImageEditorRevisionOutput, error) {
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
	now := time.Now().UTC()
	actorID := middleware.GetUserID(ctx)
	err = h.restoreImageEditorRevisionInTx(
		ctx,
		document.ID,
		input.RevisionID,
		input.Body.ExpectedRevision,
		actorID,
		now,
	)
	if errors.Is(err, errImageEditorRevisionConflict) {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor design changed elsewhere; reload before restoring")
	}
	if err != nil {
		var statusError huma.StatusError
		if errors.As(err, &statusError) {
			return nil, err
		}
		log.Printf("failed to restore OpenPost Image Editor design %s: %v", document.ID, err)
		return nil, huma.Error500InternalServerError("failed to restore OpenPost Image Editor revision")
	}
	response, err := h.documentResponse(ctx, document.ID)
	if err != nil {
		return nil, err
	}
	return &RestoreImageEditorRevisionOutput{Body: *response}, nil
}

func (h *ImageEditorHandler) restoreImageEditorRevisionInTx(
	ctx context.Context,
	documentID string,
	revisionID string,
	expectedRevision int,
	actorID string,
	now time.Time,
) error {
	return h.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		current, target, err := h.prepareImageEditorRevisionRestore(
			txCtx,
			tx,
			documentID,
			revisionID,
			expectedRevision,
			now,
		)
		if err != nil {
			return err
		}
		currentPayload, err := imageEditorDocumentPayload(txCtx, tx, &current)
		if err != nil {
			return err
		}
		if err := storeImageEditorRestorePoint(
			txCtx,
			tx,
			&current,
			currentPayload,
			actorID,
			now,
		); err != nil {
			return err
		}
		return applyImageEditorRevisionRestore(
			txCtx,
			tx,
			&current,
			target,
			expectedRevision,
			now,
		)
	})
}

func (h *ImageEditorHandler) prepareImageEditorRevisionRestore(
	ctx context.Context,
	tx bun.Tx,
	documentID string,
	revisionID string,
	expectedRevision int,
	now time.Time,
) (models.DesignDocument, imageEditorRevisionSnapshot, error) {
	var current models.DesignDocument
	if err := tx.NewSelect().Model(&current).
		Where("id = ? AND deleted_at IS NULL", documentID).
		Scan(ctx); err != nil {
		return current, imageEditorRevisionSnapshot{}, err
	}
	if current.Revision != expectedRevision {
		return current, imageEditorRevisionSnapshot{}, errImageEditorRevisionConflict
	}
	_, target, err := h.loadImageEditorRevisionSnapshot(ctx, tx, current.ID, revisionID)
	if err != nil {
		return current, target, err
	}
	if err := validateImageEditorPayload(target.Document); err != nil {
		return current, target, huma.Error400BadRequest("OpenPost Image Editor revision is invalid")
	}
	if err := validateImageEditorMediaReferences(
		ctx,
		tx,
		current.WorkspaceID,
		target.Document.Pages,
		target.CoverPreviewMediaID,
	); err != nil {
		return current, target, err
	}
	targetMediaIDs := append(
		imageEditorMediaIDs(target.Document.Pages),
		target.CoverPreviewMediaID,
	)
	if err := reviveEditorMediaReferences(
		ctx,
		tx,
		current.WorkspaceID,
		targetMediaIDs,
		now,
	); err != nil {
		return current, target, err
	}
	return current, target, nil
}

func storeImageEditorRestorePoint(
	ctx context.Context,
	tx bun.Tx,
	current *models.DesignDocument,
	currentPayload ImageEditorDocumentPayload,
	actorID string,
	now time.Time,
) error {
	snapshot, err := compressImageEditorSnapshot(imageEditorRevisionSnapshot{
		SnapshotVersion:     imageEditorSnapshotVersion,
		Document:            currentPayload,
		CoverPreviewMediaID: current.CoverPreviewMediaID,
	})
	if err != nil {
		return err
	}
	restorePoint := &models.DesignRevision{
		ID:               uuid.NewString(),
		DesignDocumentID: current.ID,
		Revision:         current.Revision,
		Kind:             "restore_point",
		Snapshot:         snapshot,
		CreatedByID:      actorID,
		CreatedAt:        now,
	}
	if _, err := tx.NewInsert().Model(restorePoint).Exec(ctx); err != nil {
		return err
	}
	return storeImageEditorRevisionMediaReferences(
		ctx,
		tx,
		restorePoint.ID,
		currentPayload,
		current.CoverPreviewMediaID,
		now,
	)
}

func applyImageEditorRevisionRestore(
	ctx context.Context,
	tx bun.Tx,
	current *models.DesignDocument,
	target imageEditorRevisionSnapshot,
	expectedRevision int,
	now time.Time,
) error {
	current.Title = strings.TrimSpace(target.Document.Title)
	current.SchemaVersion = target.Document.SchemaVersion
	current.Revision++
	current.PresetKey = target.Document.PresetKey
	current.WidthPX = target.Document.WidthPX
	current.HeightPX = target.Document.HeightPX
	current.BrandKitID = target.Document.BrandKitID
	current.BrandKitRevision = target.Document.BrandKitRevision
	current.ExportFormat = target.Document.ExportDefaults.Format
	current.ExportQuality = target.Document.ExportDefaults.Quality
	current.ExportMatteColor = defaultImageEditorBackground(target.Document.ExportDefaults.MatteColor)
	current.CoverPreviewMediaID = strings.TrimSpace(target.CoverPreviewMediaID)
	current.UpdatedAt = now
	result, err := tx.NewUpdate().Model(current).
		Column("title", "schema_version", "revision", "preset_key", "width_px", "height_px", "brand_kit_id", "brand_kit_revision", "export_format", "export_quality", "export_matte_color", "cover_preview_media_id", "updated_at").
		WherePK().
		Where("revision = ?", expectedRevision).
		Exec(ctx)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return errImageEditorRevisionConflict
	}
	if _, err := tx.NewDelete().Model((*models.DesignPage)(nil)).
		Where("design_document_id = ?", current.ID).
		Exec(ctx); err != nil {
		return err
	}
	if err := insertImageEditorPages(ctx, tx, current.ID, target.Document.Pages, now); err != nil {
		return err
	}
	return replaceImageEditorMediaReferences(ctx, tx, current, target.Document.Pages)
}

func (h *ImageEditorHandler) createReturnToken(ctx context.Context, input *CreateImageEditorReturnTokenInput) (*CreateImageEditorReturnTokenOutput, error) {
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
	returnURL, err := normalizeImageEditorReturnURL(input.Body.ReturnURL)
	if err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	maxSelection := input.Body.MaxSelection
	if maxSelection <= 0 {
		maxSelection = 1
	}
	constraints, err := json.Marshal(input.Body.Constraints)
	if err != nil || len(constraints) > 32<<10 {
		return nil, huma.Error400BadRequest("OpenPost Image Editor return constraints are invalid")
	}
	rawToken, tokenHash, err := newImageEditorReturnToken()
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to create OpenPost Image Editor return token")
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
		return nil, huma.Error500InternalServerError("failed to store OpenPost Image Editor return token")
	}
	out := &CreateImageEditorReturnTokenOutput{}
	out.Body.Token = rawToken
	out.Body.ExpiresAt = record.ExpiresAt.Format(time.RFC3339)
	return out, nil
}

//nolint:gocyclo // Return completion validates the token and every ordered export constraint together.
func (h *ImageEditorHandler) completeReturnToken(ctx context.Context, input *CompleteImageEditorReturnTokenInput) (*CompleteImageEditorReturnTokenOutput, error) {
	record, err := h.loadReturnToken(ctx, input.Token)
	if err != nil {
		return nil, err
	}
	if !record.CompletedAt.IsZero() || !record.ConsumedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token has already been used")
	}
	mediaIDs := uniqueImageEditorStringsInOrder(input.Body.MediaIDs)
	if len(mediaIDs) == 0 || len(mediaIDs) > record.MaxSelection {
		return nil, huma.Error400BadRequest("OpenPost Image Editor export count does not match the return constraints")
	}
	var media []models.MediaAttachment
	err = h.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND processing_status = ? AND id IN (?)", record.WorkspaceID, mediaReadyStatus, bun.List(mediaIDs)).
		Scan(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to validate OpenPost Image Editor exports")
	}
	if len(media) != len(mediaIDs) {
		return nil, huma.Error400BadRequest("every OpenPost Image Editor export must belong to the workspace")
	}
	var constraints struct {
		AllowedMIMEs []string `json:"allowed_mimes"`
		MaxWidth     int      `json:"max_width"`
		MaxHeight    int      `json:"max_height"`
		MaxFileSize  int64    `json:"max_file_size"`
	}
	if err := json.Unmarshal([]byte(record.ConstraintsJSON), &constraints); err != nil {
		return nil, huma.Error400BadRequest("OpenPost Image Editor return constraints are invalid")
	}
	allowedMIMEs := make(map[string]struct{}, len(constraints.AllowedMIMEs))
	for _, mime := range constraints.AllowedMIMEs {
		allowedMIMEs[strings.ToLower(strings.TrimSpace(mime))] = struct{}{}
	}
	for _, item := range media {
		if len(allowedMIMEs) > 0 {
			if _, ok := allowedMIMEs[strings.ToLower(item.MimeType)]; !ok {
				return nil, huma.Error400BadRequest("an OpenPost Image Editor export format is not supported by the composer")
			}
		}
		if constraints.MaxWidth > 0 && item.Width > constraints.MaxWidth {
			return nil, huma.Error400BadRequest("an OpenPost Image Editor export is wider than the composer allows")
		}
		if constraints.MaxHeight > 0 && item.Height > constraints.MaxHeight {
			return nil, huma.Error400BadRequest("an OpenPost Image Editor export is taller than the composer allows")
		}
		if constraints.MaxFileSize > 0 && item.Size > constraints.MaxFileSize {
			return nil, huma.Error400BadRequest("an OpenPost Image Editor export is larger than the composer allows")
		}
		if input.Body.DesignID != "" && item.DesignDocumentID != input.Body.DesignID {
			return nil, huma.Error400BadRequest("every OpenPost Image Editor export must come from the returning design")
		}
	}
	if input.Body.DesignID != "" {
		count, err := h.db.NewSelect().Model((*models.DesignDocument)(nil)).
			Where("id = ? AND workspace_id = ? AND deleted_at IS NULL", input.Body.DesignID, record.WorkspaceID).
			Count(ctx)
		if err != nil || count != 1 {
			return nil, huma.Error400BadRequest("OpenPost Image Editor design must belong to the workspace")
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
		log.Printf("failed to complete OpenPost Image Editor return token %s: %v", record.ID, err)
		return nil, huma.Error500InternalServerError("failed to complete OpenPost Image Editor return token")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token has already been used")
	}
	out := &CompleteImageEditorReturnTokenOutput{}
	out.Body.ReturnURL = record.ReturnURL
	return out, nil
}

func (h *ImageEditorHandler) consumeReturnToken(ctx context.Context, input *ConsumeImageEditorReturnTokenInput) (*ConsumeImageEditorReturnTokenOutput, error) {
	record, err := h.loadReturnToken(ctx, input.Token)
	if err != nil {
		return nil, err
	}
	if record.CompletedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token is not complete")
	}
	if !record.ConsumedAt.IsZero() {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token has already been consumed")
	}
	now := time.Now().UTC()
	result, err := h.db.NewUpdate().Model((*models.DesignReturnToken)(nil)).
		Set("consumed_at = ?", now).
		Where("id = ? AND consumed_at IS NULL", record.ID).
		Exec(ctx)
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to consume OpenPost Image Editor return token")
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return nil, huma.NewError(http.StatusConflict, "OpenPost Image Editor return token has already been consumed")
	}
	out := &ConsumeImageEditorReturnTokenOutput{}
	out.Body.WorkspaceID = record.WorkspaceID
	out.Body.ReturnURL = record.ReturnURL
	out.Body.Purpose = record.Purpose
	out.Body.DesignID = record.DesignID
	if err := json.Unmarshal([]byte(record.ResultMediaIDs), &out.Body.MediaIDs); err != nil {
		return nil, huma.Error500InternalServerError("OpenPost Image Editor return token result is corrupt")
	}
	if err := json.Unmarshal([]byte(record.ConstraintsJSON), &out.Body.Constraints); err != nil {
		out.Body.Constraints = map[string]any{}
	}
	return out, nil
}

func (h *ImageEditorHandler) loadReturnToken(ctx context.Context, rawToken string) (*models.DesignReturnToken, error) {
	if strings.TrimSpace(rawToken) == "" {
		return nil, huma.Error400BadRequest("OpenPost Image Editor return token is required")
	}
	hash := sha256.Sum256([]byte(rawToken))
	var record models.DesignReturnToken
	err := h.db.NewSelect().Model(&record).
		Where("token_hash = ? AND user_id = ?", hex.EncodeToString(hash[:]), middleware.GetUserID(ctx)).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("OpenPost Image Editor return token not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor return token")
	}
	if time.Now().UTC().After(record.ExpiresAt) {
		return nil, huma.Error404NotFound("OpenPost Image Editor return token has expired")
	}
	if _, err := h.requireAccess(ctx, record.WorkspaceID, true); err != nil {
		return nil, err
	}
	return &record, nil
}

func newImageEditorReturnToken() (string, string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(bytes[:])
	hash := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(hash[:]), nil
}

func normalizeImageEditorReturnURL(raw string) (string, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/") || strings.HasPrefix(parsed.Path, "//") {
		return "", errors.New("image editor return URL must be a same-origin OpenPost route")
	}
	path := parsed.Path
	allowed := path == "/" ||
		path == "/media" ||
		strings.HasPrefix(path, "/publications/")
	if !allowed {
		return "", errors.New("image editor return URL is not an allowed composer route")
	}
	return parsed.String(), nil
}

func uniqueImageEditorStringsInOrder(values []string) []string {
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

func (h *ImageEditorHandler) loadDocument(ctx context.Context, id string) (*models.DesignDocument, error) {
	var document models.DesignDocument
	err := h.db.NewSelect().Model(&document).
		Where("id = ? AND deleted_at IS NULL", id).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, huma.Error404NotFound("OpenPost Image Editor design not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to load OpenPost Image Editor design")
	}
	return &document, nil
}

func (h *ImageEditorHandler) documentResponse(ctx context.Context, id string) (*ImageEditorDocumentResponse, error) {
	document, err := h.loadDocument(ctx, id)
	if err != nil {
		return nil, err
	}
	canEdit, err := h.requireAccess(ctx, document.WorkspaceID, false)
	if err != nil {
		return nil, err
	}
	payload, err := imageEditorDocumentPayload(ctx, h.db, document)
	if err != nil {
		return nil, huma.Error500InternalServerError(err.Error())
	}
	return &ImageEditorDocumentResponse{
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

func imageEditorDocumentPayload(
	ctx context.Context,
	db bun.IDB,
	document *models.DesignDocument,
) (ImageEditorDocumentPayload, error) {
	payload := ImageEditorDocumentPayload{
		SchemaVersion:    document.SchemaVersion,
		Title:            document.Title,
		PresetKey:        document.PresetKey,
		WidthPX:          document.WidthPX,
		HeightPX:         document.HeightPX,
		BrandKitID:       document.BrandKitID,
		BrandKitRevision: document.BrandKitRevision,
		ExportDefaults: ImageEditorExportDefaults{
			Format:     document.ExportFormat,
			Quality:    document.ExportQuality,
			MatteColor: defaultImageEditorBackground(document.ExportMatteColor),
		},
	}
	var pages []models.DesignPage
	if err := db.NewSelect().Model(&pages).
		Where("design_document_id = ?", document.ID).
		OrderExpr("display_order ASC").
		Scan(ctx); err != nil {
		return payload, errors.New("failed to load OpenPost Image Editor pages")
	}
	payload.Pages = make([]ImageEditorPagePayload, 0, len(pages))
	for _, page := range pages {
		var layers []ImageEditorLayer
		if err := json.Unmarshal([]byte(page.SceneJSON), &layers); err != nil {
			return payload, errors.New("OpenPost Image Editor design contains an invalid page")
		}
		background := defaultImageEditorPageBackground(page.BackgroundColor)
		var guides *ImageEditorPageGuides
		if encoded := strings.TrimSpace(page.BackgroundJSON); encoded != "" && encoded != "{}" {
			storedBackground, storedGuides, err := decodeImageEditorPageState(encoded, page.BackgroundColor)
			if err != nil {
				return payload, errors.New("OpenPost Image Editor design contains an invalid page background")
			}
			background = storedBackground
			guides = storedGuides
		}
		payload.Pages = append(payload.Pages, ImageEditorPagePayload{
			ID:                  page.ID,
			Name:                page.Name,
			BackgroundColor:     page.BackgroundColor,
			Background:          background,
			Guides:              guides,
			Layers:              layers,
			PreviewMediaID:      page.PreviewMediaID,
			LatestExportMediaID: page.LatestExportMediaID,
		})
	}
	return payload, nil
}

func (h *ImageEditorHandler) validateMediaReferences(
	ctx context.Context,
	workspaceID string,
	pages []ImageEditorPagePayload,
	extraIDs ...string,
) error {
	return validateImageEditorMediaReferences(ctx, h.db, workspaceID, pages, extraIDs...)
}

func validateImageEditorMediaReferences(
	ctx context.Context,
	db bun.IDB,
	workspaceID string,
	pages []ImageEditorPagePayload,
	extraIDs ...string,
) error {
	ids := imageEditorMediaIDs(pages)
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
	valid, err := allEditorMediaBelongToWorkspace(ctx, db, workspaceID, ids, "")
	if err != nil {
		return huma.Error500InternalServerError("failed to validate OpenPost Image Editor media")
	}
	if !valid {
		return huma.Error400BadRequest("every OpenPost Image Editor media reference must belong to the workspace")
	}
	return nil
}

func resolveImageEditorDimensions(presetKey string, customWidth, customHeight int) (int, int, string, error) {
	key := strings.TrimSpace(presetKey)
	if key == "" {
		key = imageEditorPresets[0].Key
	}
	if key == "custom" {
		if err := validateImageEditorDimensions(customWidth, customHeight); err != nil {
			return 0, 0, "", err
		}
		return customWidth, customHeight, key, nil
	}
	for _, preset := range imageEditorPresets {
		if preset.Key == key {
			return preset.WidthPX, preset.HeightPX, key, nil
		}
	}
	return 0, 0, "", fmt.Errorf("unknown OpenPost Image Editor preset")
}

func validateImageEditorDimensions(width, height int) error {
	if width < imageEditorMinDimension || height < imageEditorMinDimension || width > imageEditorMaxDimension || height > imageEditorMaxDimension {
		return fmt.Errorf("image editor dimensions must be between %d and %d pixels", imageEditorMinDimension, imageEditorMaxDimension)
	}
	if width*height > imageEditorMaxPixels {
		return fmt.Errorf("image editor canvas cannot exceed %d pixels", imageEditorMaxPixels)
	}
	return nil
}

//nolint:gocyclo // Document validation reports precise failures across bounded pages and hierarchy.
func validateImageEditorPayload(payload ImageEditorDocumentPayload) error {
	if payload.SchemaVersion != imageEditorSchemaVersion {
		return fmt.Errorf("unsupported OpenPost Image Editor schema version")
	}
	if strings.TrimSpace(payload.Title) == "" || len([]rune(payload.Title)) > 160 {
		return fmt.Errorf("image editor title must be between 1 and 160 characters")
	}
	if err := validateImageEditorDimensions(payload.WidthPX, payload.HeightPX); err != nil {
		return err
	}
	if len(payload.Pages) == 0 || len(payload.Pages) > imageEditorMaxPages {
		return fmt.Errorf("image editor designs must contain between 1 and %d pages", imageEditorMaxPages)
	}
	if !oneOfImageEditorString(payload.ExportDefaults.Format, "png", "jpeg", "webp") ||
		!finiteImageEditorNumber(payload.ExportDefaults.Quality) ||
		payload.ExportDefaults.Quality < 0.1 ||
		payload.ExportDefaults.Quality > 1 ||
		(payload.ExportDefaults.MatteColor != "" &&
			!imageEditorHexColor.MatchString(payload.ExportDefaults.MatteColor)) {
		return fmt.Errorf("image editor export defaults are invalid")
	}
	encoded, err := json.Marshal(payload)
	if err != nil || len(encoded) > imageEditorMaxDocumentBytes {
		return fmt.Errorf("image editor design exceeds the %d MiB document limit", imageEditorMaxDocumentBytes>>20)
	}
	pageIDs := make(map[string]struct{}, len(payload.Pages))
	layerIDs := make(map[string]struct{})
	for _, page := range payload.Pages {
		if strings.TrimSpace(page.ID) == "" {
			return fmt.Errorf("every OpenPost Image Editor page requires an ID")
		}
		if _, exists := pageIDs[page.ID]; exists {
			return fmt.Errorf("image editor page IDs must be unique")
		}
		pageIDs[page.ID] = struct{}{}
		if len(page.Layers) > imageEditorMaxLayersPerPage {
			return fmt.Errorf("an OpenPost Image Editor page cannot contain more than %d layers", imageEditorMaxLayersPerPage)
		}
		if err := validateImageEditorPageBackground(page); err != nil {
			return err
		}
		if page.Guides != nil {
			if len(page.Guides.Horizontal) > 100 || len(page.Guides.Vertical) > 100 {
				return fmt.Errorf("image editor pages cannot contain more than 100 guides per axis")
			}
			for _, value := range page.Guides.Horizontal {
				if !finiteImageEditorNumber(value) || value < 0 || value > float64(payload.HeightPX) {
					return fmt.Errorf("image editor horizontal guides must remain inside the page")
				}
			}
			for _, value := range page.Guides.Vertical {
				if !finiteImageEditorNumber(value) || value < 0 || value > float64(payload.WidthPX) {
					return fmt.Errorf("image editor vertical guides must remain inside the page")
				}
			}
		}
		pageLayerIDs := make(map[string]struct{}, len(page.Layers))
		parents := make(map[string]string, len(page.Layers))
		for _, layer := range page.Layers {
			if strings.TrimSpace(layer.ID) == "" {
				return fmt.Errorf("every OpenPost Image Editor layer requires an ID")
			}
			if _, exists := layerIDs[layer.ID]; exists {
				return fmt.Errorf("image editor layer IDs must be unique across the document")
			}
			layerIDs[layer.ID] = struct{}{}
			pageLayerIDs[layer.ID] = struct{}{}
			parents[layer.ID] = layer.ParentID
			if err := validateImageEditorLayer(layer); err != nil {
				return err
			}
		}
		for id, parentID := range parents {
			if parentID == "" {
				continue
			}
			if _, exists := pageLayerIDs[parentID]; !exists {
				return fmt.Errorf("image editor layer %s references a missing parent", id)
			}
			seen := map[string]bool{id: true}
			for current := parentID; current != ""; current = parents[current] {
				if seen[current] {
					return fmt.Errorf("image editor layer hierarchy cannot contain cycles")
				}
				seen[current] = true
			}
		}
	}
	return nil
}

func validateImageEditorPageBackground(page ImageEditorPagePayload) error {
	if !imageEditorHexColor.MatchString(page.BackgroundColor) {
		return fmt.Errorf("image editor page backgrounds must use hexadecimal colors")
	}
	if page.Background == nil {
		return nil
	}
	background := page.Background
	if !oneOfImageEditorString(background.Type, "transparent", "solid", "gradient", "image") ||
		!finiteImageEditorNumber(background.Opacity) ||
		background.Opacity < 0 ||
		background.Opacity > 1 {
		return fmt.Errorf("image editor page background is invalid")
	}
	switch background.Type {
	case "transparent":
		return validateTransparentImageEditorBackground(background)
	case "solid":
		return validateSolidImageEditorBackground(background)
	case "gradient":
		return validateGradientImageEditorBackground(background)
	case "image":
		return validateImageImageEditorBackground(background)
	}
	return nil
}

func validateTransparentImageEditorBackground(background *ImageEditorPageBackground) error {
	if background.Gradient != nil || background.Image != nil {
		return fmt.Errorf("transparent OpenPost Image Editor backgrounds cannot include fill properties")
	}
	return nil
}

func validateSolidImageEditorBackground(background *ImageEditorPageBackground) error {
	if !imageEditorHexColor.MatchString(background.Color) ||
		background.Gradient != nil ||
		background.Image != nil {
		return fmt.Errorf("solid OpenPost Image Editor backgrounds are invalid")
	}
	return nil
}

func validateGradientImageEditorBackground(background *ImageEditorPageBackground) error {
	if background.Image != nil {
		return fmt.Errorf("gradient OpenPost Image Editor backgrounds cannot include an image")
	}
	return validateImageEditorGradient(background.Gradient)
}

func validateImageImageEditorBackground(background *ImageEditorPageBackground) error {
	if background.Gradient != nil ||
		background.Image == nil ||
		strings.TrimSpace(background.Image.MediaID) == "" ||
		!oneOfImageEditorString(background.Image.Fit, "cover", "contain", "stretch") {
		return fmt.Errorf("image OpenPost Image Editor backgrounds are invalid")
	}
	return nil
}

//nolint:gocyclo // Layer-specific validation is centralized so every write path enforces identical limits.
func validateImageEditorLayer(layer ImageEditorLayer) error {
	if !finiteImageEditorNumber(layer.Opacity) || layer.Opacity < 0 || layer.Opacity > 1 {
		return fmt.Errorf("image editor layer opacity must be between 0 and 1")
	}
	transformValues := []float64{
		layer.Transform.X,
		layer.Transform.Y,
		layer.Transform.Width,
		layer.Transform.Height,
		layer.Transform.Rotation,
	}
	for _, value := range transformValues {
		if !finiteImageEditorNumber(value) {
			return fmt.Errorf("image editor layer transforms must be finite numbers")
		}
	}
	if layer.Transform.Width < 0 || layer.Transform.Height < 0 {
		return fmt.Errorf("image editor layer dimensions cannot be negative")
	}
	if layer.Mask != nil {
		if !oneOfImageEditorString(layer.Mask.Shape, "rectangle", "rounded_rectangle", "circle", "ellipse", "diamond") ||
			!finiteImageEditorNumber(layer.Mask.Inset) ||
			!finiteImageEditorNumber(layer.Mask.Radius) ||
			layer.Mask.Inset < 0 ||
			layer.Mask.Radius < 0 {
			return fmt.Errorf("image editor layer mask is invalid")
		}
	}
	if layer.EraseMask != nil {
		if layer.Type != "image" && layer.Type != "paint" {
			return fmt.Errorf("only image and paint layers can include erase masks")
		}
		if err := validateImageEditorEraseMask(layer.EraseMask); err != nil {
			return err
		}
	}
	if layer.Effects != nil {
		if !oneOfImageEditorString(layer.Effects.BlendMode, "normal", "multiply", "screen", "overlay", "darken", "lighten", "soft_light") {
			return fmt.Errorf("image editor layer blend mode is invalid")
		}
		if err := validateImageEditorShadowEffect(layer.Effects.DropShadow); err != nil {
			return err
		}
		if err := validateImageEditorShadowEffect(layer.Effects.InnerShadow); err != nil {
			return err
		}
		if err := validateImageEditorStrokeEffect(layer.Effects.Stroke); err != nil {
			return err
		}
	}
	switch layer.Type {
	case "text":
		if layer.Text == nil || layer.Image != nil || layer.Shape != nil || layer.Paint != nil {
			return fmt.Errorf("text layers require only text properties")
		}
		if layer.Text.FontSize <= 0 ||
			!finiteImageEditorNumber(layer.Text.FontSize) ||
			layer.Text.FontWeight < 100 ||
			layer.Text.FontWeight > 900 ||
			!oneOfImageEditorString(layer.Text.FontStyle, "normal", "italic") ||
			(layer.Text.Wrap != "" && !oneOfImageEditorString(layer.Text.Wrap, "word", "character")) ||
			!oneOfImageEditorString(layer.Text.Align, "left", "center", "right", "justify") ||
			layer.Text.LineHeight <= 0 ||
			!finiteImageEditorNumber(layer.Text.LineHeight) ||
			!finiteImageEditorNumber(layer.Text.LetterSpacing) ||
			layer.Text.StrokeWidth < 0 ||
			!finiteImageEditorNumber(layer.Text.StrokeWidth) ||
			len([]rune(layer.Text.Text)) > 20_000 {
			return fmt.Errorf("text layer properties are invalid")
		}
		if !imageEditorHexColor.MatchString(layer.Text.Color) {
			return fmt.Errorf("text colors must use hexadecimal values")
		}
		if (layer.Text.HighlightColor != "" && !imageEditorHexColor.MatchString(layer.Text.HighlightColor)) ||
			(layer.Text.StrokeColor != "" && !imageEditorHexColor.MatchString(layer.Text.StrokeColor)) ||
			!imageEditorHexColor.MatchString(layer.Text.Shadow.Color) ||
			!finiteImageEditorNumber(layer.Text.Shadow.Blur) ||
			!finiteImageEditorNumber(layer.Text.Shadow.OffsetX) ||
			!finiteImageEditorNumber(layer.Text.Shadow.OffsetY) ||
			layer.Text.Shadow.Blur < 0 ||
			layer.Text.Shadow.Blur > 100 {
			return fmt.Errorf("text effects are invalid")
		}
		if layer.Text.Curve != nil &&
			(!oneOfImageEditorString(layer.Text.Curve.Type, "none", "arc_up", "arc_down", "wave", "circle", "ellipse") ||
				!finiteImageEditorNumber(layer.Text.Curve.Strength) ||
				layer.Text.Curve.Strength < 0.05 ||
				layer.Text.Curve.Strength > 1 ||
				!finiteImageEditorNumber(layer.Text.Curve.Offset) ||
				layer.Text.Curve.Offset < -1 ||
				layer.Text.Curve.Offset > 1) {
			return fmt.Errorf("text curve is invalid")
		}
	case "image":
		if layer.Image == nil || layer.Text != nil || layer.Shape != nil || layer.Paint != nil || strings.TrimSpace(layer.Image.MediaID) == "" {
			return fmt.Errorf("image layers require only image properties and a media ID")
		}
		crop := layer.Image.Crop
		if !oneOfImageEditorString(layer.Image.Fit, "cover", "contain", "stretch") ||
			!finiteImageEditorNumber(crop.X) ||
			!finiteImageEditorNumber(crop.Y) ||
			!finiteImageEditorNumber(crop.Width) ||
			!finiteImageEditorNumber(crop.Height) ||
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
			adjustments.Tint,
			adjustments.Vibrance,
			adjustments.Hue,
			adjustments.Exposure,
			adjustments.Highlights,
			adjustments.Shadows,
		} {
			if !finiteImageEditorNumber(value) || value < -1 || value > 1 {
				return fmt.Errorf("image adjustments must be between -1 and 1")
			}
		}
		if !finiteImageEditorNumber(adjustments.Blur) || adjustments.Blur < 0 || adjustments.Blur > 1 {
			return fmt.Errorf("image blur must be between 0 and 1")
		}
	case "shape":
		if layer.Shape == nil || layer.Text != nil || layer.Image != nil || layer.Paint != nil {
			return fmt.Errorf("shape layers require only shape properties")
		}
		if !oneOfImageEditorString(layer.Shape.Kind, "rectangle", "rounded_rectangle", "ellipse", "line") ||
			layer.Shape.StrokeWidth < 0 ||
			layer.Shape.Radius < 0 ||
			!finiteImageEditorNumber(layer.Shape.StrokeWidth) ||
			!finiteImageEditorNumber(layer.Shape.Radius) {
			return fmt.Errorf("shape layer properties are invalid")
		}
		if !imageEditorHexColor.MatchString(layer.Shape.Fill) || !imageEditorHexColor.MatchString(layer.Shape.Stroke) {
			return fmt.Errorf("shape colors must use hexadecimal values")
		}
	case "paint":
		if layer.Paint == nil || layer.Text != nil || layer.Image != nil || layer.Shape != nil {
			return fmt.Errorf("paint layers require only paint properties")
		}
		if !oneOfImageEditorString(layer.Paint.Kind, "stroke", "fill", "gradient") ||
			!imageEditorHexColor.MatchString(layer.Paint.Color) ||
			!finiteImageEditorNumber(layer.Paint.Size) ||
			layer.Paint.Size <= 0 ||
			layer.Paint.Size > 512 ||
			!finiteImageEditorNumber(layer.Paint.Opacity) ||
			layer.Paint.Opacity < 0 ||
			layer.Paint.Opacity > 1 ||
			!finiteImageEditorNumber(layer.Paint.SourceWidth) ||
			!finiteImageEditorNumber(layer.Paint.SourceHeight) ||
			layer.Paint.SourceWidth <= 0 ||
			layer.Paint.SourceHeight <= 0 ||
			len(layer.Paint.Points) > 100_000 ||
			len(layer.Paint.Spans) > 250_000 {
			return fmt.Errorf("paint layer properties are invalid")
		}
		for _, point := range layer.Paint.Points {
			if !finiteImageEditorNumber(point.X) || !finiteImageEditorNumber(point.Y) {
				return fmt.Errorf("paint layer points must be finite")
			}
		}
		for _, span := range layer.Paint.Spans {
			if !finiteImageEditorNumber(span.X) ||
				!finiteImageEditorNumber(span.Y) ||
				!finiteImageEditorNumber(span.Width) ||
				span.Width <= 0 {
				return fmt.Errorf("paint layer spans are invalid")
			}
		}
		if layer.Paint.Kind == "gradient" {
			if err := validateImageEditorGradient(layer.Paint.Gradient); err != nil {
				return err
			}
		} else if layer.Paint.Gradient != nil {
			return fmt.Errorf("only gradient paint layers can include gradient properties")
		}
	case "group":
		if layer.Text != nil || layer.Image != nil || layer.Shape != nil || layer.Paint != nil || layer.Effects != nil || layer.Mask != nil || layer.EraseMask != nil {
			return fmt.Errorf("group layers cannot contain visual properties")
		}
	default:
		return fmt.Errorf("unsupported OpenPost Image Editor layer type")
	}
	return nil
}

//nolint:gocyclo // Erase-mask validation keeps all bounded raster limits at the API boundary.
func validateImageEditorEraseMask(mask *ImageEditorEraseMask) error {
	if mask == nil {
		return nil
	}
	if !finiteImageEditorNumber(mask.SourceWidth) ||
		!finiteImageEditorNumber(mask.SourceHeight) ||
		mask.SourceWidth <= 0 ||
		mask.SourceHeight <= 0 ||
		mask.SourceWidth > imageEditorMaxDimension ||
		mask.SourceHeight > imageEditorMaxDimension ||
		len(mask.Strokes) > 10_000 ||
		len(mask.Spans) > 250_000 {
		return fmt.Errorf("image editor erase mask properties are invalid")
	}
	totalPoints := 0
	for _, stroke := range mask.Strokes {
		totalPoints += len(stroke.Points)
		if !finiteImageEditorNumber(stroke.Size) ||
			stroke.Size < 1 ||
			stroke.Size > 512 ||
			totalPoints > 100_000 {
			return fmt.Errorf("image editor erase mask strokes are invalid")
		}
		for _, point := range stroke.Points {
			if !finiteImageEditorNumber(point.X) || !finiteImageEditorNumber(point.Y) {
				return fmt.Errorf("image editor erase mask points must be finite")
			}
		}
	}
	for _, span := range mask.Spans {
		if !finiteImageEditorNumber(span.X) ||
			!finiteImageEditorNumber(span.Y) ||
			!finiteImageEditorNumber(span.Width) ||
			span.Width <= 0 {
			return fmt.Errorf("image editor erase mask spans are invalid")
		}
	}
	return nil
}

func validateImageEditorShadowEffect(effect *ImageEditorShadowEffect) error {
	if effect == nil {
		return nil
	}
	if !imageEditorHexColor.MatchString(effect.Color) ||
		!finiteImageEditorNumber(effect.Opacity) ||
		!finiteImageEditorNumber(effect.Blur) ||
		!finiteImageEditorNumber(effect.Angle) ||
		!finiteImageEditorNumber(effect.Distance) ||
		effect.Opacity < 0 ||
		effect.Opacity > 1 ||
		effect.Blur < 0 ||
		effect.Blur > 100 ||
		effect.Angle < -360 ||
		effect.Angle > 360 ||
		effect.Distance < 0 ||
		effect.Distance > 500 {
		return fmt.Errorf("image editor layer shadow effect is invalid")
	}
	return nil
}

func validateImageEditorStrokeEffect(effect *ImageEditorStrokeEffect) error {
	if effect == nil {
		return nil
	}
	if !imageEditorHexColor.MatchString(effect.Color) ||
		!finiteImageEditorNumber(effect.Opacity) ||
		effect.Opacity < 0 ||
		effect.Opacity > 1 ||
		!finiteImageEditorNumber(effect.Width) ||
		effect.Width <= 0 ||
		effect.Width > 500 ||
		!oneOfImageEditorString(effect.Position, "inside", "center", "outside") {
		return fmt.Errorf("image editor layer stroke effect is invalid")
	}
	return nil
}

func validateImageEditorGradient(gradient *ImageEditorGradientValue) error {
	if gradient == nil ||
		!oneOfImageEditorString(gradient.Type, "linear", "radial", "angle", "reflected", "diamond") ||
		!finiteImageEditorNumber(gradient.Start.X) ||
		!finiteImageEditorNumber(gradient.Start.Y) ||
		!finiteImageEditorNumber(gradient.End.X) ||
		!finiteImageEditorNumber(gradient.End.Y) ||
		len(gradient.Stops) < 2 ||
		len(gradient.Stops) > 32 {
		return fmt.Errorf("image editor gradient is invalid")
	}
	for _, stop := range gradient.Stops {
		if !finiteImageEditorNumber(stop.Offset) ||
			stop.Offset < 0 ||
			stop.Offset > 1 ||
			!imageEditorHexColor.MatchString(stop.Color) {
			return fmt.Errorf("image editor gradient is invalid")
		}
	}
	return nil
}

func finiteImageEditorNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func oneOfImageEditorString(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func insertImageEditorPages(ctx context.Context, tx bun.Tx, documentID string, pages []ImageEditorPagePayload, now time.Time) error {
	rows := make([]models.DesignPage, 0, len(pages))
	for index, page := range pages {
		scene, err := json.Marshal(page.Layers)
		if err != nil {
			return err
		}
		background := normalizeImageEditorPageBackground(page.Background, page.BackgroundColor)
		backgroundJSON, err := json.Marshal(imageEditorStoredPageState{
			StorageVersion: imageEditorPageStorageVersion,
			Background:     background,
			Guides:         page.Guides,
		})
		if err != nil {
			return err
		}
		rows = append(rows, models.DesignPage{
			ID:                  page.ID,
			DesignDocumentID:    documentID,
			Name:                defaultImageEditorPageName(page.Name, index),
			DisplayOrder:        index,
			BackgroundColor:     defaultImageEditorBackground(page.BackgroundColor),
			BackgroundJSON:      string(backgroundJSON),
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

func decodeImageEditorPageState(
	encoded string,
	fallbackColor string,
) (*ImageEditorPageBackground, *ImageEditorPageGuides, error) {
	var versionProbe struct {
		StorageVersion int `json:"storage_version"`
	}
	if err := json.Unmarshal([]byte(encoded), &versionProbe); err != nil {
		return nil, nil, err
	}
	if versionProbe.StorageVersion == 0 {
		var legacy ImageEditorPageBackground
		if err := json.Unmarshal([]byte(encoded), &legacy); err != nil {
			return nil, nil, err
		}
		return normalizeImageEditorPageBackground(&legacy, fallbackColor), nil, nil
	}
	if versionProbe.StorageVersion != imageEditorPageStorageVersion {
		return nil, nil, fmt.Errorf("unsupported image editor page storage version %d", versionProbe.StorageVersion)
	}
	var state imageEditorStoredPageState
	if err := json.Unmarshal([]byte(encoded), &state); err != nil {
		return nil, nil, err
	}
	return normalizeImageEditorPageBackground(state.Background, fallbackColor), state.Guides, nil
}

func replaceImageEditorMediaReferences(ctx context.Context, tx bun.Tx, document *models.DesignDocument, pages []ImageEditorPagePayload) error {
	var previousMediaIDs []string
	if err := tx.NewSelect().
		Model((*models.DesignMediaReference)(nil)).
		Column("media_id").
		Where("design_document_id = ?", document.ID).
		Scan(ctx, &previousMediaIDs); err != nil {
		return err
	}
	if _, err := tx.NewDelete().Model((*models.DesignMediaReference)(nil)).
		Where("design_document_id = ?", document.ID).
		Exec(ctx); err != nil {
		return err
	}
	refs := make([]models.DesignMediaReference, 0)
	seen := make(map[string]bool)
	for _, page := range pages {
		if mediaID := strings.TrimSpace(page.BackgroundMediaID()); mediaID != "" {
			key := page.ID + "\x00" + mediaID
			seen[key] = true
			refs = append(refs, models.DesignMediaReference{
				DesignDocumentID: document.ID,
				DesignPageID:     page.ID,
				MediaID:          mediaID,
				Usage:            "background",
				CreatedAt:        time.Now().UTC(),
			})
		}
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
	if len(refs) > 0 {
		for start := 0; start < len(refs); start += imageEditorMediaWriteChunkSize {
			end := min(start+imageEditorMediaWriteChunkSize, len(refs))
			chunk := refs[start:end]
			if _, err := tx.NewInsert().Model(&chunk).Exec(ctx); err != nil {
				return err
			}
		}
	}
	mediaIDs := make([]string, 0, len(previousMediaIDs)+len(refs))
	mediaIDs = append(mediaIDs, previousMediaIDs...)
	for _, ref := range refs {
		mediaIDs = append(mediaIDs, ref.MediaID)
	}
	return medialifecycle.TouchWithDB(ctx, tx, mediaIDs, time.Now().UTC())
}

func (h *ImageEditorHandler) maybeStoreRecoveryRevision(
	ctx context.Context,
	tx bun.Tx,
	document *models.DesignDocument,
	payload ImageEditorDocumentPayload,
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
	snapshot, err := compressImageEditorSnapshot(imageEditorRevisionSnapshot{
		SnapshotVersion:     imageEditorSnapshotVersion,
		Document:            payload,
		CoverPreviewMediaID: document.CoverPreviewMediaID,
	})
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	revision := &models.DesignRevision{
		ID:               uuid.NewString(),
		DesignDocumentID: document.ID,
		Revision:         document.Revision,
		Kind:             "autosave",
		Snapshot:         snapshot,
		CreatedByID:      middleware.GetUserID(ctx),
		CreatedAt:        now,
		ExpiresAt:        now.Add(imageEditorRecoveryRevisionTTL),
	}
	if _, err := tx.NewInsert().Model(revision).Exec(ctx); err != nil {
		return err
	}
	if err := storeImageEditorRevisionMediaReferences(
		ctx,
		tx,
		revision.ID,
		payload,
		document.CoverPreviewMediaID,
		revision.CreatedAt,
	); err != nil {
		return err
	}
	var expiredIDs []string
	if err := tx.NewSelect().Model((*models.DesignRevision)(nil)).
		Column("id").
		Where("design_document_id = ? AND kind = ? AND expires_at IS NOT NULL AND expires_at <= ?", document.ID, "autosave", now).
		OrderExpr("expires_at ASC, id ASC").
		Limit(1_000).
		Scan(ctx, &expiredIDs); err != nil {
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
	ids := append([]string(nil), expiredIDs...)
	for _, item := range stale {
		ids = append(ids, item.ID)
	}
	ids = uniqueImageEditorStringsInOrder(ids)
	if len(ids) > 0 {
		if _, err := tx.NewDelete().Model((*models.DesignRevision)(nil)).Where("id IN (?)", bun.List(ids)).Exec(ctx); err != nil {
			return err
		}
	}
	return nil
}

func compressImageEditorSnapshot(snapshot imageEditorRevisionSnapshot) ([]byte, error) {
	data, err := json.Marshal(snapshot)
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

func decompressImageEditorSnapshot(compressed []byte) (imageEditorRevisionSnapshot, error) {
	var snapshot imageEditorRevisionSnapshot
	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return snapshot, err
	}
	defer reader.Close()
	const envelopeAllowance = 64 << 10
	data, err := io.ReadAll(io.LimitReader(reader, imageEditorMaxDocumentBytes+envelopeAllowance+1))
	if err != nil || len(data) > imageEditorMaxDocumentBytes+envelopeAllowance {
		return snapshot, fmt.Errorf("invalid OpenPost Image Editor snapshot")
	}
	var probe struct {
		SnapshotVersion int `json:"snapshot_version"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return snapshot, err
	}
	if probe.SnapshotVersion == 0 {
		if err := json.Unmarshal(data, &snapshot.Document); err != nil {
			return snapshot, err
		}
		return snapshot, nil
	}
	if probe.SnapshotVersion != imageEditorSnapshotVersion {
		return snapshot, fmt.Errorf("unsupported OpenPost Image Editor snapshot version %d", probe.SnapshotVersion)
	}
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return snapshot, err
	}
	return snapshot, nil
}

func storeImageEditorRevisionMediaReferences(
	ctx context.Context,
	tx bun.Tx,
	revisionID string,
	payload ImageEditorDocumentPayload,
	coverPreviewMediaID string,
	createdAt time.Time,
) error {
	mediaIDs := imageEditorMediaIDs(payload.Pages)
	mediaIDs = append(mediaIDs, coverPreviewMediaID)
	mediaIDs = uniqueImageEditorStringsInOrder(mediaIDs)
	if len(mediaIDs) > 0 {
		refs := make([]models.DesignRevisionMediaReference, 0, len(mediaIDs))
		for _, mediaID := range mediaIDs {
			refs = append(refs, models.DesignRevisionMediaReference{
				RevisionID: revisionID,
				MediaID:    mediaID,
				Usage:      "snapshot",
				CreatedAt:  createdAt,
			})
		}
		for start := 0; start < len(refs); start += imageEditorMediaWriteChunkSize {
			end := min(start+imageEditorMediaWriteChunkSize, len(refs))
			chunk := refs[start:end]
			if _, err := tx.NewInsert().Model(&chunk).Exec(ctx); err != nil {
				return err
			}
		}
	}
	state := &models.DesignRevisionMediaIndexState{
		RevisionID:  revisionID,
		MediaCount:  len(mediaIDs),
		Status:      "complete",
		ProcessedAt: createdAt,
	}
	_, err := tx.NewInsert().Model(state).Exec(ctx)
	return err
}

func imageEditorMediaIDs(pages []ImageEditorPagePayload) []string {
	set := make(map[string]struct{})
	for _, page := range pages {
		if strings.TrimSpace(page.PreviewMediaID) != "" {
			set[page.PreviewMediaID] = struct{}{}
		}
		if strings.TrimSpace(page.LatestExportMediaID) != "" {
			set[page.LatestExportMediaID] = struct{}{}
		}
		if mediaID := page.BackgroundMediaID(); mediaID != "" {
			set[mediaID] = struct{}{}
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

func cloneImageEditorPayload(payload ImageEditorDocumentPayload) ImageEditorDocumentPayload {
	data, _ := json.Marshal(payload)
	var clone ImageEditorDocumentPayload
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

func newImageEditorImageLayer(media models.MediaAttachment, width, height int) ImageEditorLayer {
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
	return ImageEditorLayer{
		ID:      uuid.NewString(),
		Type:    "image",
		Name:    defaultImageEditorLayerName(media.OriginalFilename, "Image"),
		Visible: true,
		Opacity: 1,
		Transform: ImageEditorTransform{
			X:      (float64(width) - layerWidth) / 2,
			Y:      (float64(height) - layerHeight) / 2,
			Width:  layerWidth,
			Height: layerHeight,
		},
		Image: &ImageEditorImageValue{
			MediaID:      media.ID,
			SourceWidth:  sourceWidth,
			SourceHeight: sourceHeight,
			Fit:          "cover",
			Crop:         ImageEditorCrop{Width: 1, Height: 1},
		},
	}
}

func designSummary(document models.DesignDocument, pageCount int) ImageEditorDesignSummary {
	return ImageEditorDesignSummary{
		ID:                  document.ID,
		Title:               document.Title,
		PresetKey:           document.PresetKey,
		WidthPX:             document.WidthPX,
		HeightPX:            document.HeightPX,
		PageCount:           pageCount,
		Revision:            document.Revision,
		CoverPreviewMediaID: document.CoverPreviewMediaID,
		IsFavorite:          document.IsFavorite,
		CreatedAt:           document.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           document.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func imageRevisionSummary(
	revision models.DesignRevision,
	actor EditorRevisionActor,
) ImageEditorRevisionSummary {
	summary := ImageEditorRevisionSummary{
		ID:        revision.ID,
		Revision:  revision.Revision,
		Kind:      revision.Kind,
		Name:      revision.Name,
		CreatedAt: revision.CreatedAt.UTC().Format(time.RFC3339),
		Actor:     actor,
	}
	if !revision.ExpiresAt.IsZero() {
		summary.ExpiresAt = revision.ExpiresAt.UTC().Format(time.RFC3339)
	}
	return summary
}

func defaultImageEditorFormat(presetKey string) string {
	for _, preset := range imageEditorPresets {
		if preset.Key == presetKey {
			return preset.DefaultFormat
		}
	}
	return "png"
}

func defaultImageEditorPageName(name string, index int) string {
	if trimmed := strings.TrimSpace(name); trimmed != "" {
		return trimmed
	}
	return fmt.Sprintf("Page %d", index+1)
}

func defaultImageEditorBackground(value string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return "#ffffff"
}

func defaultImageEditorPageBackground(color string) *ImageEditorPageBackground {
	return &ImageEditorPageBackground{
		Type:    "solid",
		Color:   defaultImageEditorBackground(color),
		Opacity: 1,
	}
}

func normalizeImageEditorPageBackground(
	background *ImageEditorPageBackground,
	legacyColor string,
) *ImageEditorPageBackground {
	if background == nil || !oneOfImageEditorString(background.Type, "transparent", "solid", "gradient", "image") {
		return defaultImageEditorPageBackground(legacyColor)
	}
	normalized := *background
	switch normalized.Type {
	case "transparent":
		normalized.Color = ""
		normalized.Opacity = 0
		normalized.Gradient = nil
		normalized.Image = nil
	case "solid":
		normalized.Color = defaultImageEditorBackground(normalized.Color)
		normalized.Gradient = nil
		normalized.Image = nil
	case "gradient":
		normalized.Color = ""
		normalized.Image = nil
	case "image":
		normalized.Color = ""
		normalized.Gradient = nil
	}
	return &normalized
}

func defaultImageEditorLayerName(value, fallback string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return fallback
}
