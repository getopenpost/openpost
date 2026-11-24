package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/imageprepare"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/services/videoprocessing"
	"github.com/uptrace/bun"
)

const (
	ThumbnailSizeSM                   = imageprepare.ThumbnailSizeSM
	ThumbnailSizeMD                   = imageprepare.ThumbnailSizeMD
	MaxBufferedMediaUploadBytes int64 = 50 * 1024 * 1024
	MaxBrandFontUploadBytes     int64 = 10 * 1024 * 1024
	mediaUploadMaxImagePixels   int64 = 64_000_000
	MaxMediaUploadBytes         int64 = 16 * 1024 * 1024 * 1024
	MaxDirectMediaUploadBytes   int64 = 5_000_000_000
	MediaUploadSessionTTL             = 15 * time.Minute
	maxMediaUploadSessionTTL          = 6 * time.Hour
	mediaUploadCleanupTimeout         = 30 * time.Second
	mediaUploadDeleteTimeout          = 10 * time.Second
	defaultMediaMimeType              = "application/octet-stream"
	mediaProcessingStatus             = "processing"
	mediaUploadingStatus              = "uploading"
	mediaReadyStatus                  = "ready"
	mediaFailedStatus                 = "failed"
)

type MediaHandler struct {
	capabilityResolver *CapabilityResolverHandler
	db                 *bun.DB
	storage            mediastore.BlobStorage
	auth               *auth.Service
	authn              middleware.Authenticator
	signer             *mediasigner.Signer
	quota              entitlements.Service
	usage              *usage.Service
	video              *videoprocessing.Service
	publicMedia        *publicurl.MediaVerifier
}

type mediaUploadBytesInput struct {
	// PreparedImage is an internal worker receipt, never accepted from HTTP uploads.
	PreparedImage *imageprepare.Prepared
	// StableID is an internal durable import identity, never accepted from uploads.
	StableID         string
	WorkspaceID      string
	Filename         string
	DeclaredMimeType string
	Size             int64
	Content          []byte
	AltText          string
	Source           string
	AssetKind        string
	RetentionClass   string
	TagID            string
	ParentMediaID    string
	DesignDocumentID string
	DesignPageID     string
	StockProvenance  *StockMediaProvenance
	// OnCreated runs synchronously after a new media row is inserted and
	// before later bookkeeping can fail. Callers that require compensation can
	// retain the immutable attachment without changing existing call sites.
	OnCreated func(models.MediaAttachment)
}

type mediaUploadInspection struct {
	Content  []byte
	Prefix   []byte
	Size     int64
	FileHash string
}

func NewMediaHandler(
	db *bun.DB,
	storage mediastore.BlobStorage,
	authService *auth.Service,
	authenticator middleware.Authenticator,
	signer *mediasigner.Signer,
) *MediaHandler {
	if authenticator == nil && authService != nil {
		authenticator = middleware.NewJWTAuthenticator(authService)
	}
	return &MediaHandler{
		db:          db,
		storage:     storage,
		auth:        authService,
		authn:       authenticator,
		signer:      signer,
		quota:       entitlements.NewSelfHostedService(),
		usage:       usage.NewService(db),
		publicMedia: publicurl.NewMediaVerifier("", storage, signer),
	}
}

func (h *MediaHandler) SetEntitlement(entitlement entitlements.Service) {
	if entitlement != nil {
		h.quota = entitlement
	}
}

func (h *MediaHandler) SetUsage(usageService *usage.Service) {
	if usageService != nil {
		h.usage = usageService
	}
}

func (h *MediaHandler) SetVideoProcessor(service *videoprocessing.Service) {
	if service != nil {
		h.video = service
	}
}

func (h *MediaHandler) SetPublicURLVerifier(verifier publicurl.Verifier) {
	if h.publicMedia == nil {
		h.publicMedia = publicurl.NewMediaVerifier("", h.storage, h.signer)
	}
	h.publicMedia.SetVerifier(verifier)
}

func (h *MediaHandler) SetPublicMediaVerifier(verifier *publicurl.MediaVerifier) {
	if verifier != nil {
		h.publicMedia = verifier
	}
}

type Thumbnails struct {
	SM string `json:"sm,omitempty"`
	MD string `json:"md,omitempty"`
}

type MediaUsageItem struct {
	Kind          string `json:"kind" doc:"Usage kind: publication, design, template, brand_asset, or brand_font"`
	ID            string `json:"id" doc:"Referenced object ID"`
	Label         string `json:"label" doc:"User-visible usage label"`
	PublicationID string `json:"publication_id,omitempty" doc:"Publication ID for publication usages"`
	Content       string `json:"content,omitempty" doc:"Publication content (truncated)"`
	Status        string `json:"status,omitempty" doc:"Publication or design status"`
	Scheduled     string `json:"scheduled_at,omitempty" doc:"Scheduled time"`
}

type MediaListItem struct {
	ID                 string   `json:"id" doc:"Media ID"`
	WorkspaceID        string   `json:"workspace_id" doc:"Workspace ID"`
	MimeType           string   `json:"mime_type" doc:"MIME type"`
	Size               int64    `json:"size" doc:"File size in bytes"`
	OriginalFilename   string   `json:"original_filename" doc:"Original filename"`
	Width              int      `json:"width" doc:"Image width"`
	Height             int      `json:"height" doc:"Image height"`
	AltText            string   `json:"alt_text" doc:"Alt text"`
	IsFavorite         bool     `json:"is_favorite" doc:"Whether media is favorited"`
	CreatedAt          string   `json:"created_at" doc:"Creation time"`
	URL                string   `json:"url" doc:"URL to access the media"`
	ThumbnailURL       string   `json:"thumbnail_url" doc:"Thumbnail URL for grid view"`
	UsageCount         int      `json:"usage_count" doc:"Number of publications and reusable assets using this media"`
	CanDelete          bool     `json:"can_delete" doc:"Whether media can be deleted"`
	ProcessingStatus   string   `json:"processing_status" doc:"Processing status"`
	DurationMS         int64    `json:"duration_ms" doc:"Video duration in milliseconds"`
	FrameRate          float64  `json:"frame_rate" doc:"Video frame rate"`
	ContainerFormat    string   `json:"container_format,omitempty" doc:"Detected media container"`
	VideoCodec         string   `json:"video_codec,omitempty" doc:"Detected video codec"`
	VideoProfile       string   `json:"video_profile,omitempty" doc:"Detected video codec profile"`
	AudioCodec         string   `json:"audio_codec,omitempty" doc:"Detected audio codec"`
	PixelFormat        string   `json:"pixel_format,omitempty" doc:"Detected video pixel format"`
	ColorSpace         string   `json:"color_space,omitempty" doc:"Detected video color space"`
	BitRate            int64    `json:"bit_rate" doc:"Detected aggregate bitrate in bits per second"`
	Rotation           int      `json:"rotation" doc:"Normalized display rotation"`
	AudioChannels      int      `json:"audio_channels" doc:"Detected audio channel count"`
	ProcessingProgress int      `json:"processing_progress" doc:"Server processing progress from 0 to 100"`
	AnalysisStatus     string   `json:"analysis_status" doc:"Media analysis status"`
	AnalysisError      string   `json:"analysis_error,omitempty" doc:"Media analysis error"`
	PosterThumbnailURL string   `json:"poster_thumbnail_url,omitempty" doc:"Poster thumbnail URL"`
	PublicURLCheckedAt string   `json:"public_url_checked_at,omitempty" doc:"Public URL verification time"`
	PublicURLStatus    int      `json:"public_url_status" doc:"Public URL verification HTTP status"`
	PublicURLError     string   `json:"public_url_error,omitempty" doc:"Public URL verification error"`
	Source             string   `json:"source" doc:"Media provenance"`
	AssetKind          string   `json:"asset_kind" doc:"Media library role"`
	ParentMediaID      string   `json:"parent_media_id,omitempty" doc:"Source media for this derivative"`
	DesignDocumentID   string   `json:"design_document_id,omitempty" doc:"Producing OpenPost Image Editor design"`
	DesignPageID       string   `json:"design_page_id,omitempty" doc:"Producing OpenPost Image Editor page"`
	Tags               []string `json:"tags" doc:"Tag IDs assigned to this media"`
	RetentionClass     string   `json:"retention_class" enum:"library,temporary" doc:"Whether the asset is kept in the library or managed as temporary post media"`
	LastUsedAt         string   `json:"last_used_at,omitempty" doc:"Most recent known reference time"`
	TrashedAt          string   `json:"trashed_at,omitempty" doc:"Time the item entered Trash"`
	PurgeAfter         string   `json:"purge_after,omitempty" doc:"Time the item becomes eligible for permanent deletion"`
	TrashReason        string   `json:"trash_reason,omitempty" enum:"manual,published,expired" doc:"Why the item entered Trash"`
}

type ListMediaInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Filter by workspace ID"`
	Filter      string `query:"filter" doc:"Filter: all, used, unused, favorites"`
	Sort        string `query:"sort" doc:"Sort: newest, oldest, name, size, recently_used"`
	Search      string `query:"search" doc:"Search filename, alt text, and tag"`
	Type        string `query:"type" doc:"Filter by dominant media type"`
	Source      string `query:"source" doc:"Filter by media provenance"`
	AssetKind   string `query:"asset_kind" doc:"Filter by asset role; defaults to library"`
	Lifecycle   string `query:"lifecycle" enum:"library,temporary,trash,all" doc:"Lifecycle view; defaults to library"`
	Aspect      string `query:"aspect" doc:"Filter: square, portrait, landscape"`
	TagID       string `query:"tag_id" doc:"Filter by one tag ID"`
	TagIDs      string `query:"tag_ids" doc:"Comma-separated tag IDs; media must have every selected tag"`
	Untagged    bool   `query:"untagged" doc:"Only media that has no tags"`
	MinWidth    int    `query:"min_width" minimum:"0"`
	MinHeight   int    `query:"min_height" minimum:"0"`
	MaxWidth    int    `query:"max_width" minimum:"0"`
	MaxHeight   int    `query:"max_height" minimum:"0"`
	DateFrom    string `query:"date_from" doc:"Created on or after this YYYY-MM-DD date"`
	DateTo      string `query:"date_to" doc:"Created on or before this YYYY-MM-DD date"`
	Limit       int    `query:"limit" doc:"Limit (default 50, max 200)"`
	Offset      int    `query:"offset" doc:"Offset for pagination"`
}

type ListMediaOutput struct {
	Body struct {
		Media []MediaListItem `json:"media" doc:"Media attachments"`
		Total int             `json:"total" doc:"Total count matching filter"`
	}
}

type GetMediaStorageInput struct {
	WorkspaceID string `query:"workspace_id" required:"true" doc:"Workspace ID"`
}

type MediaUploadLimits struct {
	DefaultBytes   int64 `json:"default_bytes" doc:"Upload ceiling in bytes for non-video, non-brand-font assets"`
	VideoBytes     int64 `json:"video_bytes" doc:"Upload ceiling in bytes for video assets"`
	BrandFontBytes int64 `json:"brand_font_bytes" doc:"Upload ceiling in bytes for brand-font assets"`
}

type GetMediaStorageOutput struct {
	Body struct {
		UsedBytes             int64             `json:"used_bytes" doc:"Quota-counted media bytes"`
		AssetCount            int               `json:"asset_count" doc:"Quota-counted media assets"`
		InternalBytes         int64             `json:"internal_bytes" doc:"Hidden preview bytes excluded from quota"`
		LimitBytes            int64             `json:"limit_bytes" doc:"Storage limit, or zero when no fixed limit is exposed"`
		DirectUploadSupported bool              `json:"direct_upload_supported" doc:"Whether this instance supports direct-to-storage or server-streamed upload sessions"`
		UploadLimits          MediaUploadLimits `json:"upload_limits" doc:"Per-kind upload ceilings matching the enforced admission limits"`
	}
}

type GetMediaUsageInput struct {
	PathID string `path:"id" doc:"Media ID"`
}

type GetMediaUsageOutput struct {
	Body struct {
		Usage []MediaUsageItem `json:"usage" doc:"Publications and reusable assets using this media"`
		Count int              `json:"count" doc:"Number of objects using this media"`
	}
}

type MediaMetadataItem struct {
	Source             string  `json:"source" doc:"Media provenance"`
	ParentMediaID      string  `json:"parent_media_id,omitempty" doc:"Input image for this derivative"`
	OriginalFilename   string  `json:"original_filename,omitempty" doc:"Original uploaded filename"`
	ID                 string  `json:"id" doc:"Media ID"`
	MimeType           string  `json:"mime_type" doc:"MIME type"`
	AltText            string  `json:"alt_text" doc:"Alt text"`
	Size               int64   `json:"size" doc:"File size in bytes"`
	Width              int     `json:"width" doc:"Image width"`
	Height             int     `json:"height" doc:"Image height"`
	URL                string  `json:"url" doc:"URL to access the media"`
	Thumbnail          string  `json:"thumbnail_url" doc:"Thumbnail URL"`
	DurationMS         int64   `json:"duration_ms" doc:"Video duration in milliseconds"`
	FrameRate          float64 `json:"frame_rate" doc:"Video frame rate"`
	ContainerFormat    string  `json:"container_format,omitempty" doc:"Detected media container"`
	VideoCodec         string  `json:"video_codec,omitempty" doc:"Detected video codec"`
	AudioCodec         string  `json:"audio_codec,omitempty" doc:"Detected audio codec"`
	ProcessingStatus   string  `json:"processing_status" doc:"Media processing status"`
	ProcessingProgress int     `json:"processing_progress" doc:"Server processing progress from 0 to 100"`
	PosterThumbnailURL string  `json:"poster_thumbnail_url,omitempty" doc:"Poster thumbnail URL"`
	AnalysisStatus     string  `json:"analysis_status" doc:"Media analysis status"`
	AnalysisError      string  `json:"analysis_error,omitempty" doc:"Media analysis error"`
	PublicURLCheckedAt string  `json:"public_url_checked_at,omitempty" doc:"Public URL verification time"`
	PublicURLStatus    int     `json:"public_url_status" doc:"Public URL verification HTTP status"`
	PublicURLError     string  `json:"public_url_error,omitempty" doc:"Public URL verification error"`
	IsDeleted          bool    `json:"is_deleted" doc:"Whether the item is in Trash and unavailable to publications"`
}

type MediaMetadataInput struct {
	WorkspaceID string   `query:"workspace_id" required:"true" doc:"Workspace ID"`
	MediaIDs    []string `query:"media_ids" doc:"Comma-separated list of media IDs"`
}

type MediaMetadataOutput struct {
	Body struct {
		Media []MediaMetadataItem `json:"media" doc:"Media metadata list"`
	}
}

type DeleteMediaInput struct {
	PathID string `path:"id" doc:"Media ID"`
}

type DeleteMediaOutput struct {
	Body struct {
		Message string `json:"message" doc:"Success message"`
	}
}

type BatchDeleteMediaInput struct {
	Body struct {
		MediaIDs []string `json:"media_ids" doc:"Array of media IDs to delete"`
	}
}

type BatchDeleteMediaOutput struct {
	Body struct {
		Deleted   int      `json:"deleted" doc:"Number of media deleted"`
		FailedIDs []string `json:"failed_ids" doc:"IDs that could not be deleted (in use)"`
	}
}

func mediaBatchDeletionAlreadyComplete(media models.MediaAttachment) bool {
	return !media.TrashedAt.IsZero()
}

type UpdateMediaFavoriteInput struct {
	PathID string `path:"id" doc:"Media ID"`
}

type UpdateMediaFavoriteOutput struct {
	Body struct {
		IsFavorite bool `json:"is_favorite" doc:"Updated favorite status"`
	}
}

type RestoreMediaInput struct {
	PathID string `path:"id" doc:"Media ID"`
}

type RestoreMediaOutput struct {
	Body struct {
		Message string `json:"message" doc:"Success message"`
	}
}

type UpdateMediaInput struct {
	PathID string `path:"id" doc:"Media ID"`
	Body   struct {
		AltText          *string `json:"alt_text,omitempty" doc:"Alt text for accessibility"`
		OriginalFilename *string `json:"original_filename,omitempty" maxLength:"255" doc:"User-visible filename; the file extension cannot be changed"`
	}
}

type UpdateMediaOutput struct {
	Body struct {
		Message string `json:"message" doc:"Success message"`
	}
}

type RetryMediaAnalysisInput struct {
	PathID string `path:"id" doc:"Media ID"`
}

type RetryMediaAnalysisOutput struct {
	Body struct {
		MediaID          string `json:"media_id" doc:"Media ID"`
		ProcessingStatus string `json:"processing_status" doc:"Current processing status"`
		AnalysisStatus   string `json:"analysis_status" doc:"Current analysis status"`
	}
}

type CreateMediaUploadSessionInput struct {
	IdempotencyKey string `header:"Idempotency-Key" maxLength:"200" doc:"Replay key scoped to the caller, Workspace, and operation"`
	Body           struct {
		WorkspaceID      string                `json:"workspace_id" doc:"Workspace ID"`
		Filename         string                `json:"filename" doc:"Original filename"`
		MimeType         string                `json:"mime_type,omitempty" doc:"Declared MIME type"`
		Size             int64                 `json:"size" doc:"Expected upload size in bytes"`
		AltText          string                `json:"alt_text,omitempty" doc:"Alt text for accessibility"`
		Source           string                `json:"source,omitempty" enum:"upload,media_copy,image_optimization,image_fit,camera,image_editor_export,image_editor_edit,background_removal,video_editor_source,video_editor_export,stock_import,meme_generator,screenshot_template,image_generation" doc:"Media provenance"`
		AssetKind        string                `json:"asset_kind,omitempty" enum:"library,brand_asset,brand_font,design_preview,template_preview,project_asset" doc:"Media library role"`
		RetentionClass   string                `json:"retention_class,omitempty" enum:"library,temporary" doc:"Keep in the library or manage as temporary post media"`
		TagID            string                `json:"tag_id,omitempty" doc:"Optional tag to assign to this upload"`
		ParentMediaID    string                `json:"parent_media_id,omitempty" doc:"Source media ID for a derivative"`
		DesignDocumentID string                `json:"design_document_id,omitempty" doc:"Producing OpenPost Image Editor design ID"`
		DesignPageID     string                `json:"design_page_id,omitempty" doc:"Producing OpenPost Image Editor page ID"`
		ClientSHA256     string                `json:"client_sha256,omitempty" pattern:"^[a-fA-F0-9]{64}$" doc:"Optional SHA-256 used to reuse an identical ready asset in this workspace"`
		ProjectAssetID   string                `json:"project_asset_id,omitempty" doc:"Reserved Project Asset receiving this upload"`
		StockProvenance  *StockMediaProvenance `json:"stock_provenance,omitempty" doc:"License and creator provenance for a selected stock asset"`
	}
}

type DirectMediaUploadTarget struct {
	Method    string            `json:"method" doc:"HTTP method to use for the upload"`
	URL       string            `json:"url" doc:"Presigned or authenticated upload target URL"`
	Headers   map[string]string `json:"headers" doc:"Headers that must be sent with the upload request"`
	ExpiresAt string            `json:"expires_at" doc:"Upload URL expiration time"`
	ObjectKey string            `json:"object_key" doc:"Storage object key reserved for the upload"`
}

type CreateMediaUploadSessionOutput struct {
	Body CreateMediaUploadSessionResponse
}

type CreateMediaUploadSessionResponse struct {
	MediaID        string                  `json:"media_id" doc:"Pending media ID"`
	Upload         DirectMediaUploadTarget `json:"upload" doc:"Streaming upload request details"`
	CompleteURL    string                  `json:"complete_url" doc:"API path to call after the upload succeeds"`
	Deduped        bool                    `json:"deduped" doc:"Whether an identical ready workspace asset was reused"`
	ProjectAssetID string                  `json:"project_asset_id,omitempty" doc:"Project Asset linked to the media"`
}

type CompleteMediaUploadSessionInput struct {
	PathID string `path:"id" doc:"Pending media ID"`
	Body   struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
	}
}

type MediaUploadResult struct {
	ID                 string `json:"id" doc:"Media ID"`
	Width              int    `json:"width,omitempty" doc:"Known image width in pixels"`
	Height             int    `json:"height,omitempty" doc:"Known image height in pixels"`
	MimeType           string `json:"mime_type" doc:"MIME type"`
	URL                string `json:"url" doc:"URL to access the media"`
	Size               int64  `json:"size" doc:"File size in bytes"`
	Deduped            bool   `json:"deduped" doc:"Whether an existing media attachment was reused"`
	AltText            string `json:"alt_text" doc:"Persisted alt text"`
	OriginalFilename   string `json:"original_filename" doc:"Persisted original filename"`
	Source             string `json:"source" doc:"Media provenance"`
	AssetKind          string `json:"asset_kind" doc:"Media library role"`
	RetentionClass     string `json:"retention_class" enum:"library,temporary" doc:"Media lifecycle class"`
	ParentMediaID      string `json:"parent_media_id,omitempty" doc:"Source media ID"`
	DesignDocumentID   string `json:"design_document_id,omitempty" doc:"Producing OpenPost Image Editor design ID"`
	DesignPageID       string `json:"design_page_id,omitempty" doc:"Producing OpenPost Image Editor page ID"`
	ProcessingStatus   string `json:"processing_status" doc:"Media processing status"`
	ProcessingProgress int    `json:"processing_progress" doc:"Server processing progress from 0 to 100"`
	AnalysisStatus     string `json:"analysis_status" doc:"Media analysis status"`
	AnalysisError      string `json:"analysis_error,omitempty" doc:"Media analysis error"`
	PosterThumbnailURL string `json:"poster_thumbnail_url,omitempty" doc:"Poster thumbnail URL"`
}

type CompleteMediaUploadSessionOutput struct {
	Body MediaUploadResult
}

//nolint:gocyclo
func (h *MediaHandler) RegisterRoutes(api huma.API) {
	h.registerMediaReadRoutes(api)
	h.registerMediaMutationRoutes(api)
	h.registerMediaImagePreparation(api)
	h.registerMediaAnalysisRoutes(api)
	h.registerMediaUploadSessionRoutes(api)
}

func (h *MediaHandler) registerMediaReadRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-media",
		Method:      http.MethodGet,
		Path:        "/media",
		Summary:     "List media attachments for a workspace",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403},
	}, h.listMedia)

	huma.Register(api, huma.Operation{
		OperationID: "get-media-storage",
		Method:      http.MethodGet,
		Path:        "/media/storage",
		Summary:     "Get workspace media storage usage",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403},
	}, h.getMediaStorage)

	huma.Register(api, huma.Operation{
		OperationID: "get-media-usage",
		Method:      http.MethodGet,
		Path:        "/media/{id}/usage",
		Summary:     "Get publications that use a media attachment",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, h.getMediaUsage)
}

func (h *MediaHandler) registerMediaMutationRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-media",
		Method:      http.MethodDelete,
		Path:        "/media/{id}",
		Summary:     "Move a media attachment to Trash when active work does not use it",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, h.deleteMedia)

	huma.Register(api, huma.Operation{
		OperationID: "restore-media",
		Method:      http.MethodPost,
		Path:        "/media/{id}/restore",
		Summary:     "Restore a media attachment from Trash",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, h.restoreMedia)

	huma.Register(api, huma.Operation{
		OperationID: "batch-delete-media",
		Method:      http.MethodPost,
		Path:        "/media/batch-delete",
		Summary:     "Move multiple media attachments to Trash",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403},
	}, h.batchDeleteMedia)

	huma.Register(api, huma.Operation{
		OperationID: "update-media-favorite",
		Method:      http.MethodPatch,
		Path:        "/media/{id}/favorite",
		Summary:     "Toggle favorite status of a media attachment",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, h.updateMediaFavorite)

	huma.Register(api, huma.Operation{
		OperationID: "update-media",
		Method:      http.MethodPatch,
		Path:        "/media/{id}",
		Summary:     "Update media metadata",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, h.updateMedia)
}

func (h *MediaHandler) registerMediaAnalysisRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "retry-media-analysis",
		Method:      http.MethodPost,
		Path:        "/media/{id}/analysis/retry",
		Summary:     "Retry authoritative analysis for a video",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403, 404},
	}, h.retryMediaAnalysis)
}

func (h *MediaHandler) registerMediaUploadSessionRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-media-upload-session",
		Method:      http.MethodPost,
		Path:        "/media/upload-session",
		Summary:     "Create a streaming media upload session",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403},
	}, h.createMediaUploadSession)

	huma.Register(api, huma.Operation{
		OperationID: "complete-media-upload-session",
		Method:      http.MethodPost,
		Path:        "/media/upload-session/{id}/complete",
		Summary:     "Complete a streaming media upload session",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403, 404},
	}, h.completeMediaUploadSession)
}

func (h *MediaHandler) ensureMediaWorkspaceAccess(ctx context.Context, userID, workspaceID string) error {
	allowed, err := workspaceReadAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *MediaHandler) ensureMediaWorkspaceEditAccess(ctx context.Context, userID, workspaceID string) error {
	allowed, err := workspaceEditAllowed(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

func (h *MediaHandler) userCanAccessWorkspace(ctx context.Context, workspaceID, userID string) (bool, error) {
	return workspaceReadAllowed(ctx, h.db, workspaceID, userID)
}

func (h *MediaHandler) userCanEditWorkspace(ctx context.Context, workspaceID, userID string) (bool, error) {
	return workspaceEditAllowed(ctx, h.db, workspaceID, userID)
}
