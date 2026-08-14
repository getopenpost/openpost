package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/disintegration/imaging"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	echoMiddleware "github.com/labstack/echo/v4/middleware"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/auth"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/medialifecycle"
	"github.com/openpost/backend/internal/services/mediasigner"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/services/videoprocessing"
	"github.com/openpost/backend/internal/videoproject"
	"github.com/uptrace/bun"
)

const (
	ThumbnailSizeSM                   = 150
	ThumbnailSizeMD                   = 400
	MaxBufferedMediaUploadBytes int64 = 50 * 1024 * 1024
	MaxMediaUploadBytes         int64 = 16 * 1024 * 1024 * 1024
	MaxDirectMediaUploadBytes   int64 = 5_000_000_000
	MediaUploadSessionTTL             = 15 * time.Minute
	maxMediaUploadSessionTTL          = 6 * time.Hour
	defaultMediaMimeType              = "application/octet-stream"
	mediaProcessingStatus             = "processing"
	mediaUploadingStatus              = "uploading"
	mediaReadyStatus                  = "ready"
	mediaFailedStatus                 = "failed"
)

type MediaHandler struct {
	db          *bun.DB
	storage     mediastore.BlobStorage
	auth        *auth.Service
	authn       middleware.Authenticator
	signer      *mediasigner.Signer
	quota       entitlements.Service
	usage       *usage.Service
	video       *videoprocessing.Service
	publicMedia *publicurl.MediaVerifier
}

type mediaUploadBytesInput struct {
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
	VideoProjectID   string
	StockProvenance  *videoproject.StockMediaProvenance
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

type countingReader struct {
	reader io.Reader
	count  int64
}

func (r *countingReader) Read(buffer []byte) (int, error) {
	read, err := r.reader.Read(buffer)
	r.count += int64(read)
	return read, err
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
	Kind      string `json:"kind" doc:"Usage kind: post, design, template, brand_asset, or brand_font"`
	ID        string `json:"id" doc:"Referenced object ID"`
	Label     string `json:"label" doc:"User-visible usage label"`
	PostID    string `json:"post_id,omitempty" doc:"Post ID for post usages"`
	Content   string `json:"content,omitempty" doc:"Post content (truncated)"`
	Status    string `json:"status,omitempty" doc:"Post or design status"`
	Scheduled string `json:"scheduled_at,omitempty" doc:"Scheduled time"`
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
	UsageCount         int      `json:"usage_count" doc:"Number of posts using this media"`
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
	VideoProjectID     string   `json:"video_project_id,omitempty" doc:"Producing OpenPost Video Editor project"`
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

type GetMediaStorageOutput struct {
	Body struct {
		UsedBytes             int64 `json:"used_bytes" doc:"Quota-counted media bytes"`
		AssetCount            int   `json:"asset_count" doc:"Quota-counted media assets"`
		InternalBytes         int64 `json:"internal_bytes" doc:"Hidden preview bytes excluded from quota"`
		LimitBytes            int64 `json:"limit_bytes" doc:"Storage limit, or zero when no fixed limit is exposed"`
		DirectUploadSupported bool  `json:"direct_upload_supported" doc:"Whether this instance supports direct-to-storage or server-streamed upload sessions"`
	}
}

type GetMediaUsageInput struct {
	PathID string `path:"id" doc:"Media ID"`
}

type GetMediaUsageOutput struct {
	Body struct {
		Usage []MediaUsageItem `json:"usage" doc:"Posts using this media"`
		Count int              `json:"count" doc:"Number of posts using this media"`
	}
}

type MediaMetadataItem struct {
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
	IsDeleted          bool    `json:"is_deleted" doc:"Whether the item is in Trash and unavailable to posts"`
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
	Body struct {
		WorkspaceID      string                             `json:"workspace_id" doc:"Workspace ID"`
		Filename         string                             `json:"filename" doc:"Original filename"`
		MimeType         string                             `json:"mime_type,omitempty" doc:"Declared MIME type"`
		Size             int64                              `json:"size" doc:"Expected upload size in bytes"`
		AltText          string                             `json:"alt_text,omitempty" doc:"Alt text for accessibility"`
		Source           string                             `json:"source,omitempty" enum:"upload,camera,image_editor_export,image_editor_edit,background_removal,video_editor_source,video_editor_export,stock_import,meme_generator" doc:"Media provenance"`
		AssetKind        string                             `json:"asset_kind,omitempty" enum:"library,brand_asset,brand_font,design_preview,template_preview" doc:"Media library role"`
		RetentionClass   string                             `json:"retention_class,omitempty" enum:"library,temporary" doc:"Keep in the library or manage as temporary post media"`
		TagID            string                             `json:"tag_id,omitempty" doc:"Optional tag to assign to this upload"`
		ParentMediaID    string                             `json:"parent_media_id,omitempty" doc:"Source media ID for a derivative"`
		DesignDocumentID string                             `json:"design_document_id,omitempty" doc:"Producing OpenPost Image Editor design ID"`
		DesignPageID     string                             `json:"design_page_id,omitempty" doc:"Producing OpenPost Image Editor page ID"`
		VideoProjectID   string                             `json:"video_project_id,omitempty" doc:"Producing OpenPost Video Editor project ID"`
		ClientSHA256     string                             `json:"client_sha256,omitempty" pattern:"^[a-fA-F0-9]{64}$" doc:"Optional SHA-256 used to reuse an identical ready asset in this workspace"`
		StockProvenance  *videoproject.StockMediaProvenance `json:"stock_provenance,omitempty" doc:"License and creator provenance for a selected stock asset"`
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
	Body struct {
		MediaID     string                  `json:"media_id" doc:"Pending media ID"`
		Upload      DirectMediaUploadTarget `json:"upload" doc:"Streaming upload request details"`
		CompleteURL string                  `json:"complete_url" doc:"API path to call after the upload succeeds"`
		Deduped     bool                    `json:"deduped" doc:"Whether an identical ready workspace asset was reused"`
	}
}

type CompleteMediaUploadSessionInput struct {
	PathID string `path:"id" doc:"Pending media ID"`
	Body   struct {
		WorkspaceID string `json:"workspace_id" doc:"Workspace ID"`
	}
}

type MediaUploadResult struct {
	ID                 string `json:"id" doc:"Media ID"`
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
	VideoProjectID     string `json:"video_project_id,omitempty" doc:"Producing OpenPost Video Editor project ID"`
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
	huma.Register(api, huma.Operation{
		OperationID: "list-media",
		Method:      http.MethodGet,
		Path:        "/media",
		Summary:     "List media attachments for a workspace",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *ListMediaInput) (*ListMediaOutput, error) {
		userID := middleware.GetUserID(ctx)

		if input.WorkspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}

		if err := h.ensureMediaWorkspaceAccess(ctx, userID, input.WorkspaceID); err != nil {
			return nil, err
		}

		limit := input.Limit
		if limit <= 0 || limit > 200 {
			limit = 50
		}

		query := h.db.NewSelect().Model(&models.MediaAttachment{}).
			Where("workspace_id = ?", input.WorkspaceID)
		switch strings.TrimSpace(input.Lifecycle) {
		case "temporary":
			query = query.Where("retention_class = ? AND trashed_at IS NULL", medialifecycle.RetentionTemporary)
		case "trash":
			query = query.Where("trashed_at IS NOT NULL")
		case "all":
			// Used only by internal organization surfaces that explicitly ask for all states.
		default:
			query = query.Where("(retention_class = ? OR retention_class = '' OR retention_class IS NULL) AND trashed_at IS NULL", medialifecycle.RetentionLibrary)
		}
		assetKind := strings.TrimSpace(input.AssetKind)
		if assetKind == "" {
			assetKind = "library"
		}
		if assetKind != "all" {
			if assetKind == "library" {
				query = query.Where("(asset_kind = ? OR asset_kind = '' OR asset_kind IS NULL)", assetKind)
			} else {
				query = query.Where("asset_kind = ?", assetKind)
			}
		}
		if search := strings.TrimSpace(input.Search); search != "" {
			pattern := "%" + strings.ToLower(search) + "%"
			query = query.WhereGroup(" AND ", func(group *bun.SelectQuery) *bun.SelectQuery {
				return group.
					Where("LOWER(original_filename) LIKE ?", pattern).
					WhereOr("LOWER(alt_text) LIKE ?", pattern).
					WhereOr(`id IN (
						SELECT assignment.media_id
						FROM media_tag_assignments assignment
						JOIN media_tags tag ON tag.id = assignment.tag_id
						WHERE LOWER(tag.name) LIKE ?
					)`, pattern)
			})
		}
		if mediaType := strings.TrimSpace(input.Type); mediaType != "" && mediaType != "all" {
			query = query.Where("dominant_type = ?", mediaType)
		}
		if source := strings.TrimSpace(input.Source); source != "" && source != "all" {
			query = query.Where("source = ?", source)
		}
		switch input.Aspect {
		case "square":
			query = query.Where("width > 0 AND height > 0 AND ABS(width - height) <= (CASE WHEN width > height THEN width ELSE height END) * 0.02")
		case "portrait":
			query = query.Where("height > width")
		case "landscape":
			query = query.Where("width > height")
		}
		if input.MinWidth > 0 {
			query = query.Where("width >= ?", input.MinWidth)
		}
		if input.MinHeight > 0 {
			query = query.Where("height >= ?", input.MinHeight)
		}
		if input.MaxWidth > 0 {
			query = query.Where("width <= ?", input.MaxWidth)
		}
		if input.MaxHeight > 0 {
			query = query.Where("height <= ?", input.MaxHeight)
		}
		if value := strings.TrimSpace(input.DateFrom); value != "" {
			date, parseErr := time.Parse("2006-01-02", value)
			if parseErr != nil {
				return nil, huma.Error400BadRequest("date_from must use YYYY-MM-DD")
			}
			query = query.Where("created_at >= ?", date.UTC())
		}
		if value := strings.TrimSpace(input.DateTo); value != "" {
			date, parseErr := time.Parse("2006-01-02", value)
			if parseErr != nil {
				return nil, huma.Error400BadRequest("date_to must use YYYY-MM-DD")
			}
			query = query.Where("created_at < ?", date.UTC().AddDate(0, 0, 1))
		}
		tagIDs := uniqueMediaFilterValues(input.TagID, input.TagIDs)
		for _, tagID := range tagIDs {
			query = query.Where("id IN (SELECT media_id FROM media_tag_assignments WHERE tag_id = ?)", tagID)
		}
		if input.Untagged {
			query = query.Where("id NOT IN (SELECT media_id FROM media_tag_assignments)")
		}
		variantMediaIDs := []string{}
		if input.Filter == "used" || input.Filter == "unused" {
			ids, usageErr := h.variantMediaIDsForWorkspace(ctx, input.WorkspaceID)
			if usageErr != nil {
				return nil, huma.Error500InternalServerError("failed to check media usage")
			}
			variantMediaIDs = ids
		}

		switch input.Filter {
		case "favorites":
			query = query.Where("is_favorite = ?", true)
		case "used":
			query = query.WhereGroup(" AND ", func(group *bun.SelectQuery) *bun.SelectQuery {
				group = group.Where(`id IN (SELECT media_id FROM post_media)
					OR id IN (SELECT media_id FROM rendition_media)
					OR id IN (SELECT r.media_id FROM design_media_references r JOIN design_documents d ON d.id = r.design_document_id WHERE d.deleted_at IS NULL)
					OR id IN (SELECT r.media_id FROM design_revision_media_references r JOIN design_revisions v ON v.id = r.revision_id JOIN design_documents d ON d.id = v.design_document_id WHERE d.deleted_at IS NULL)
					OR id IN (SELECT media_id FROM design_template_media_references)
					OR id IN (SELECT a.media_id FROM video_project_assets a JOIN video_projects p ON p.id = a.video_project_id WHERE p.deleted_at IS NULL)
					OR id IN (SELECT media_id FROM brand_fonts)
					OR id IN (SELECT cover_preview_media_id FROM design_documents WHERE cover_preview_media_id IS NOT NULL AND deleted_at IS NULL)
					OR id IN (SELECT p.preview_media_id FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE p.preview_media_id IS NOT NULL AND d.deleted_at IS NULL)
					OR id IN (SELECT p.latest_export_media_id FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE p.latest_export_media_id IS NOT NULL AND d.deleted_at IS NULL)
					OR id IN (SELECT preview_media_id FROM design_templates WHERE preview_media_id IS NOT NULL)`)
				if len(variantMediaIDs) > 0 {
					group = group.WhereOr("id IN (?)", bun.List(variantMediaIDs))
				}
				return group
			})
		case "unused":
			query = query.Where(`id NOT IN (SELECT media_id FROM post_media)
				AND id NOT IN (SELECT media_id FROM rendition_media)
				AND id NOT IN (SELECT r.media_id FROM design_media_references r JOIN design_documents d ON d.id = r.design_document_id WHERE d.deleted_at IS NULL)
				AND id NOT IN (SELECT r.media_id FROM design_revision_media_references r JOIN design_revisions v ON v.id = r.revision_id JOIN design_documents d ON d.id = v.design_document_id WHERE d.deleted_at IS NULL)
				AND id NOT IN (SELECT media_id FROM design_template_media_references)
				AND id NOT IN (SELECT a.media_id FROM video_project_assets a JOIN video_projects p ON p.id = a.video_project_id WHERE p.deleted_at IS NULL)
				AND id NOT IN (SELECT media_id FROM brand_fonts)
				AND id NOT IN (SELECT cover_preview_media_id FROM design_documents WHERE cover_preview_media_id IS NOT NULL AND deleted_at IS NULL)
				AND id NOT IN (SELECT p.preview_media_id FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE p.preview_media_id IS NOT NULL AND d.deleted_at IS NULL)
				AND id NOT IN (SELECT p.latest_export_media_id FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id WHERE p.latest_export_media_id IS NOT NULL AND d.deleted_at IS NULL)
				AND id NOT IN (SELECT preview_media_id FROM design_templates WHERE preview_media_id IS NOT NULL)`)
			if len(variantMediaIDs) > 0 {
				query = query.Where("id NOT IN (?)", bun.List(variantMediaIDs))
			}
		}

		var total int
		total, err := query.Count(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to count media")
		}

		switch input.Sort {
		case "oldest":
			query = query.Order("created_at ASC")
		case mediaSortSize:
			query = query.Order("size DESC")
		case "name":
			query = query.OrderExpr("LOWER(original_filename) ASC")
		case "recently_used":
			query = query.OrderExpr(`COALESCE(
				(SELECT MAX(post.created_at)
				 FROM post_media post_media_item
				 JOIN posts post ON post.id = post_media_item.post_id
				 WHERE post_media_item.media_id = media_attachments.id),
				(SELECT MAX(document.updated_at)
				 FROM design_media_references design_reference
				 JOIN design_documents document ON document.id = design_reference.design_document_id
				 WHERE design_reference.media_id = media_attachments.id),
				(SELECT MAX(revision.created_at)
				 FROM design_revision_media_references revision_reference
				 JOIN design_revisions revision ON revision.id = revision_reference.revision_id
				 JOIN design_documents document ON document.id = revision.design_document_id
				 WHERE revision_reference.media_id = media_attachments.id AND document.deleted_at IS NULL),
				media_attachments.created_at
			) DESC`)
		default:
			query = query.Order("created_at DESC")
		}

		var media []models.MediaAttachment
		err = query.Limit(limit).Offset(input.Offset).Scan(ctx, &media)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}

		mediaIDs := make([]string, len(media))
		for i := range media {
			mediaIDs[i] = media[i].ID
		}
		usageByMedia, err := h.mediaUsageSummaries(ctx, input.WorkspaceID, mediaIDs)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to check media usage")
		}
		tagsByMedia, err := h.mediaTagsByMedia(ctx, mediaIDs)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load media organization")
		}

		result := make([]MediaListItem, len(media))
		for i, m := range media {
			usage := usageByMedia[m.ID]

			var thumbs Thumbnails
			if m.ThumbnailsJSON != "" {
				if err := json.Unmarshal([]byte(m.ThumbnailsJSON), &thumbs); err != nil {
					thumbs = Thumbnails{}
				}
			}

			result[i] = MediaListItem{
				ID:                 m.ID,
				WorkspaceID:        m.WorkspaceID,
				MimeType:           m.MimeType,
				Size:               m.Size,
				OriginalFilename:   m.OriginalFilename,
				Width:              m.Width,
				Height:             m.Height,
				AltText:            m.AltText,
				IsFavorite:         m.IsFavorite,
				CreatedAt:          m.CreatedAt.Format(time.RFC3339),
				URL:                "/media/" + m.ID,
				ThumbnailURL:       "",
				UsageCount:         usage.Total,
				CanDelete:          usage.Blocking == 0,
				ProcessingStatus:   m.ProcessingStatus,
				DurationMS:         m.DurationMS,
				FrameRate:          m.FrameRate,
				ContainerFormat:    m.ContainerFormat,
				VideoCodec:         m.VideoCodec,
				VideoProfile:       m.VideoProfile,
				AudioCodec:         m.AudioCodec,
				PixelFormat:        m.PixelFormat,
				ColorSpace:         m.ColorSpace,
				BitRate:            m.BitRate,
				Rotation:           m.Rotation,
				AudioChannels:      m.AudioChannels,
				ProcessingProgress: m.ProcessingProgress,
				AnalysisStatus:     m.AnalysisStatus,
				AnalysisError:      m.AnalysisError,
				PosterThumbnailURL: mediaPosterURL(m),
				PublicURLCheckedAt: formatMediaTime(m.PublicURLCheckedAt),
				PublicURLStatus:    m.PublicURLStatus,
				PublicURLError:     m.PublicURLError,
				Source:             m.Source,
				AssetKind:          m.AssetKind,
				ParentMediaID:      m.ParentMediaID,
				DesignDocumentID:   m.DesignDocumentID,
				DesignPageID:       m.DesignPageID,
				VideoProjectID:     m.VideoProjectID,
				Tags:               tagsByMedia[m.ID],
				RetentionClass:     m.RetentionClass,
				LastUsedAt:         formatMediaTime(m.LastUsedAt),
				TrashedAt:          formatMediaTime(m.TrashedAt),
				PurgeAfter:         formatMediaTime(m.PurgeAfter),
				TrashReason:        m.TrashReason,
			}
			if result[i].Source == "" {
				result[i].Source = "upload"
			}
			if result[i].AssetKind == "" {
				result[i].AssetKind = "library"
			}
			if result[i].RetentionClass == "" {
				result[i].RetentionClass = medialifecycle.RetentionLibrary
			}
			switch {
			case thumbs.SM != "":
				result[i].ThumbnailURL = "/media/" + m.ID + "/thumb/sm"
			case strings.HasPrefix(m.MimeType, "video/"):
				result[i].ThumbnailURL = result[i].PosterThumbnailURL
			case strings.HasPrefix(m.MimeType, "image/"):
				result[i].ThumbnailURL = result[i].URL
			}
		}

		return &ListMediaOutput{Body: struct {
			Media []MediaListItem `json:"media" doc:"Media attachments"`
			Total int             `json:"total" doc:"Total count matching filter"`
		}{Media: result, Total: total}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-media-storage",
		Method:      http.MethodGet,
		Path:        "/media/storage",
		Summary:     "Get workspace media storage usage",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *GetMediaStorageInput) (*GetMediaStorageOutput, error) {
		if input.WorkspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}
		if err := h.ensureMediaWorkspaceAccess(ctx, middleware.GetUserID(ctx), input.WorkspaceID); err != nil {
			return nil, err
		}
		var storageUsage struct {
			UsedBytes     int64 `bun:"used_bytes"`
			AssetCount    int   `bun:"asset_count"`
			InternalBytes int64 `bun:"internal_bytes"`
		}
		err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
			ColumnExpr(`COALESCE(SUM(CASE WHEN asset_kind NOT IN ('design_preview', 'template_preview') THEN size ELSE 0 END), 0) AS used_bytes`).
			ColumnExpr(`COALESCE(SUM(CASE WHEN asset_kind NOT IN ('design_preview', 'template_preview') THEN 1 ELSE 0 END), 0) AS asset_count`).
			ColumnExpr(`COALESCE(SUM(CASE WHEN asset_kind IN ('design_preview', 'template_preview') THEN size ELSE 0 END), 0) AS internal_bytes`).
			Where("workspace_id = ?", input.WorkspaceID).
			Scan(ctx, &storageUsage)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to load media storage usage")
		}
		out := &GetMediaStorageOutput{}
		out.Body.UsedBytes = storageUsage.UsedBytes
		out.Body.AssetCount = storageUsage.AssetCount
		out.Body.InternalBytes = storageUsage.InternalBytes
		out.Body.DirectUploadSupported = h.supportsUploadSessions()
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-media-usage",
		Method:      http.MethodGet,
		Path:        "/media/{id}/usage",
		Summary:     "Get posts that use a media attachment",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *GetMediaUsageInput) (*GetMediaUsageOutput, error) {
		userID := middleware.GetUserID(ctx)

		var media models.MediaAttachment
		err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound(errMediaNotFound)
			}
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}

		if err := h.ensureMediaWorkspaceAccess(ctx, userID, media.WorkspaceID); err != nil {
			return nil, err
		}

		posts, err := h.postsUsingMedia(ctx, media.WorkspaceID, input.PathID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch usage")
		}

		usage := make([]MediaUsageItem, 0, len(posts))
		for _, post := range posts {
			content := post.Content
			if len(content) > 100 {
				content = content[:100] + "..."
			}
			scheduled := ""
			if !post.ScheduledAt.IsZero() {
				scheduled = post.ScheduledAt.Format(time.RFC3339)
			}
			usage = append(usage, MediaUsageItem{
				Kind:      "post",
				ID:        post.ID,
				Label:     content,
				PostID:    post.ID,
				Content:   content,
				Status:    post.Status,
				Scheduled: scheduled,
			})
		}
		otherUsage, err := h.nonPostMediaUsage(ctx, media.WorkspaceID, input.PathID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to fetch OpenPost Image Editor media usage")
		}
		usage = append(usage, otherUsage...)

		return &GetMediaUsageOutput{Body: struct {
			Usage []MediaUsageItem `json:"usage" doc:"Posts using this media"`
			Count int              `json:"count" doc:"Number of posts using this media"`
		}{Usage: usage, Count: len(usage)}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-media",
		Method:      http.MethodDelete,
		Path:        "/media/{id}",
		Summary:     "Move a media attachment to Trash when active work does not use it",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *DeleteMediaInput) (*DeleteMediaOutput, error) {
		userID := middleware.GetUserID(ctx)

		var media models.MediaAttachment
		err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound(errMediaNotFound)
			}
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}

		if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
			return nil, err
		}

		usage, err := h.mediaUsageSummary(ctx, media.WorkspaceID, input.PathID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to check usage")
		}
		if usage.Blocking > 0 {
			return nil, huma.Error400BadRequest("cannot delete media while it is used by a draft, design, template, or brand kit")
		}

		trashed, err := medialifecycle.NewService(h.db, h.storage).TrashManual(ctx, media.ID, media.WorkspaceID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to move media to Trash")
		}
		if !trashed {
			return nil, huma.Error400BadRequest("cannot delete media while it is used by active work")
		}

		return &DeleteMediaOutput{Body: struct {
			Message string `json:"message" doc:"Success message"`
		}{Message: "media moved to Trash"}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "restore-media",
		Method:      http.MethodPost,
		Path:        "/media/{id}/restore",
		Summary:     "Restore a media attachment from Trash",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *RestoreMediaInput) (*RestoreMediaOutput, error) {
		var media models.MediaAttachment
		if err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound(errMediaNotFound)
			}
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}
		if err := h.ensureMediaWorkspaceEditAccess(ctx, middleware.GetUserID(ctx), media.WorkspaceID); err != nil {
			return nil, err
		}
		restored, err := medialifecycle.NewService(h.db, h.storage).Restore(ctx, media.ID, media.WorkspaceID)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to restore media")
		}
		if !restored {
			return nil, huma.Error400BadRequest("media is not in Trash")
		}
		return &RestoreMediaOutput{Body: struct {
			Message string `json:"message" doc:"Success message"`
		}{Message: "media restored"}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "batch-delete-media",
		Method:      http.MethodPost,
		Path:        "/media/batch-delete",
		Summary:     "Move multiple media attachments to Trash",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *BatchDeleteMediaInput) (*BatchDeleteMediaOutput, error) {
		userID := middleware.GetUserID(ctx)

		if len(input.Body.MediaIDs) == 0 {
			return nil, huma.Error400BadRequest("media_ids is required")
		}

		if len(input.Body.MediaIDs) > 100 {
			return nil, huma.Error400BadRequest("max 100 media IDs at once")
		}

		deleted := 0
		failedIDs := []string{}

		for _, mediaID := range input.Body.MediaIDs {
			var media models.MediaAttachment
			err := h.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(ctx)
			if err != nil {
				failedIDs = append(failedIDs, mediaID)
				continue
			}

			if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
				failedIDs = append(failedIDs, mediaID)
				continue
			}
			if mediaBatchDeletionAlreadyComplete(media) {
				// Replays after a lost response are successful when the requested state already holds.
				deleted++
				continue
			}

			usage, err := h.mediaUsageSummary(ctx, media.WorkspaceID, mediaID)
			if err != nil || usage.Blocking > 0 {
				failedIDs = append(failedIDs, mediaID)
				continue
			}

			trashed, err := medialifecycle.NewService(h.db, h.storage).TrashManual(ctx, media.ID, media.WorkspaceID)
			if err != nil || !trashed {
				failedIDs = append(failedIDs, mediaID)
				continue
			}

			deleted++
		}

		return &BatchDeleteMediaOutput{Body: struct {
			Deleted   int      `json:"deleted" doc:"Number of media deleted"`
			FailedIDs []string `json:"failed_ids" doc:"IDs that could not be deleted (in use)"`
		}{Deleted: deleted, FailedIDs: failedIDs}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-media-favorite",
		Method:      http.MethodPatch,
		Path:        "/media/{id}/favorite",
		Summary:     "Toggle favorite status of a media attachment",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *UpdateMediaFavoriteInput) (*UpdateMediaFavoriteOutput, error) {
		userID := middleware.GetUserID(ctx)

		var media models.MediaAttachment
		err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound(errMediaNotFound)
			}
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}

		if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
			return nil, err
		}

		media.IsFavorite = !media.IsFavorite
		query := h.db.NewUpdate().Model(&media).Column("is_favorite").Where("id = ?", input.PathID)
		if media.IsFavorite {
			media.RetentionClass = medialifecycle.RetentionLibrary
			query = query.Column("retention_class")
		}
		_, err = query.Exec(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to update favorite status")
		}

		return &UpdateMediaFavoriteOutput{Body: struct {
			IsFavorite bool `json:"is_favorite" doc:"Updated favorite status"`
		}{IsFavorite: media.IsFavorite}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-media",
		Method:      http.MethodPatch,
		Path:        "/media/{id}",
		Summary:     "Update media metadata",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{403, 404},
	}, func(ctx context.Context, input *UpdateMediaInput) (*UpdateMediaOutput, error) {
		userID := middleware.GetUserID(ctx)

		var media models.MediaAttachment
		err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound(errMediaNotFound)
			}
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}

		if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, media.WorkspaceID); err != nil {
			return nil, err
		}

		columns := make([]string, 0, 2)
		if input.Body.AltText != nil {
			media.AltText = strings.TrimSpace(*input.Body.AltText)
			columns = append(columns, "alt_text")
		}
		if input.Body.OriginalFilename != nil {
			filename, filenameErr := normalizeMediaFilename(media.OriginalFilename, *input.Body.OriginalFilename)
			if filenameErr != nil {
				return nil, huma.Error400BadRequest(filenameErr.Error())
			}
			media.OriginalFilename = filename
			columns = append(columns, "original_filename")
		}
		if len(columns) == 0 {
			return nil, huma.Error400BadRequest("alt_text or original_filename is required")
		}
		_, err = h.db.NewUpdate().Model(&media).Column(columns...).Where("id = ?", input.PathID).Exec(ctx)
		if err != nil {
			return nil, huma.Error500InternalServerError("failed to update media")
		}

		return &UpdateMediaOutput{Body: struct {
			Message string `json:"message" doc:"Success message"`
		}{Message: "media updated successfully"}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "retry-media-analysis",
		Method:      http.MethodPost,
		Path:        "/media/{id}/analysis/retry",
		Summary:     "Retry authoritative analysis for a video",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *RetryMediaAnalysisInput) (*RetryMediaAnalysisOutput, error) {
		var media models.MediaAttachment
		if err := h.db.NewSelect().Model(&media).Where("id = ?", input.PathID).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, huma.Error404NotFound(errMediaNotFound)
			}
			return nil, huma.Error500InternalServerError("failed to fetch media")
		}
		if err := h.ensureMediaWorkspaceEditAccess(ctx, middleware.GetUserID(ctx), media.WorkspaceID); err != nil {
			return nil, err
		}
		if !strings.HasPrefix(media.MimeType, "video/") {
			return nil, huma.Error400BadRequest("only video media can be analyzed")
		}
		if h.video == nil {
			return nil, huma.Error500InternalServerError("video processing is not configured")
		}
		if _, err := h.db.NewUpdate().
			Model((*models.MediaAttachment)(nil)).
			Set("processing_status = ?", mediaProcessingStatus).
			Set("processing_progress = 0").
			Set("analysis_status = ?", mediaanalysis.AnalysisStatusPending).
			Set("analysis_error = ''").
			Where("id = ?", media.ID).
			Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to reset video analysis")
		}
		if err := h.video.EnqueueAnalysis(ctx, media.ID); err != nil {
			return nil, huma.Error500InternalServerError("failed to queue video analysis")
		}
		return &RetryMediaAnalysisOutput{Body: struct {
			MediaID          string `json:"media_id" doc:"Media ID"`
			ProcessingStatus string `json:"processing_status" doc:"Current processing status"`
			AnalysisStatus   string `json:"analysis_status" doc:"Current analysis status"`
		}{
			MediaID:          media.ID,
			ProcessingStatus: mediaProcessingStatus,
			AnalysisStatus:   mediaanalysis.AnalysisStatusPending,
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "create-media-upload-session",
		Method:      http.MethodPost,
		Path:        "/media/upload-session",
		Summary:     "Create a streaming media upload session",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403},
	}, func(ctx context.Context, input *CreateMediaUploadSessionInput) (*CreateMediaUploadSessionOutput, error) {
		userID := middleware.GetUserID(ctx)

		workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
		if workspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}
		if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, workspaceID); err != nil {
			return nil, err
		}

		filename := cleanUploadFilename(input.Body.Filename)
		if filename == "" {
			return nil, huma.Error400BadRequest("filename is required")
		}
		if input.Body.Size <= 0 {
			return nil, huma.Error400BadRequest("size must be positive")
		}
		source, assetKind, err := normalizeMediaProvenance(input.Body.Source, input.Body.AssetKind)
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		tagID, err := h.resolveMediaUploadTag(ctx, workspaceID, input.Body.TagID, assetKind)
		if err != nil {
			return nil, err
		}
		retentionClass, err := medialifecycle.NormalizeRetention(input.Body.RetentionClass, assetKind, tagID != "")
		if err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		if err := validateStockUploadProvenance(source, input.Body.StockProvenance); err != nil {
			return nil, huma.Error400BadRequest(err.Error())
		}
		mimeType := strings.TrimSpace(input.Body.MimeType)
		if mimeType == "" {
			mimeType = defaultMediaMimeType
		}
		sizeLimit := mediaUploadSizeLimit(assetKind, filename, mimeType)
		if input.Body.Size > sizeLimit {
			return nil, huma.Error400BadRequest(mediaUploadSizeError(sizeLimit))
		}
		if !isInternalMediaAssetKind(assetKind) {
			if err := h.checkUploadQuota(ctx, workspaceID, input.Body.Size); err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		}
		if err := h.validateMediaProvenanceReferences(
			ctx,
			workspaceID,
			input.Body.ParentMediaID,
			input.Body.DesignDocumentID,
			input.Body.DesignPageID,
		); err != nil {
			return nil, err
		}
		if err := h.validateVideoProjectReference(ctx, workspaceID, input.Body.VideoProjectID); err != nil {
			return nil, err
		}
		reusable, err := h.reusableMediaForClientHash(
			ctx,
			workspaceID,
			input.Body.ClientSHA256,
			input.Body.Size,
			mimeType,
		)
		if err != nil {
			return nil, err
		}
		if reusable != nil {
			if err := h.persistStockMediaProvenance(ctx, reusable.ID, input.Body.StockProvenance); err != nil {
				return nil, huma.Error500InternalServerError("failed to save stock media provenance")
			}
			if err := h.addMediaTag(ctx, tagID, reusable.ID); err != nil {
				return nil, err
			}
			return &CreateMediaUploadSessionOutput{Body: struct {
				MediaID     string                  `json:"media_id" doc:"Pending media ID"`
				Upload      DirectMediaUploadTarget `json:"upload" doc:"Streaming upload request details"`
				CompleteURL string                  `json:"complete_url" doc:"API path to call after the upload succeeds"`
				Deduped     bool                    `json:"deduped" doc:"Whether an identical ready workspace asset was reused"`
			}{
				MediaID: reusable.ID,
				Deduped: true,
			}}, nil
		}

		mediaID := uuid.New().String()
		objectKey := mediaID + filepath.Ext(filename)
		sessionTTL := mediaUploadSessionTTL(input.Body.Size)
		var session *mediastore.DirectUploadSession
		if directStorage, ok := h.storage.(mediastore.DirectUploadStorage); ok && input.Body.Size <= MaxDirectMediaUploadBytes {
			session, err = directStorage.CreateDirectUploadSession(ctx, mediastore.DirectUploadInput{
				Key:         objectKey,
				ContentType: mimeType,
				Size:        input.Body.Size,
				ExpiresIn:   sessionTTL,
			})
			if err != nil {
				return nil, huma.Error500InternalServerError("failed to create media upload session")
			}
		} else if h.storage != nil {
			session = &mediastore.DirectUploadSession{
				Method: http.MethodPut,
				URL:    "/api/v1/media/upload-session/" + mediaID + "/content",
				Headers: map[string]string{
					"Content-Type": mimeType,
				},
				Key:       objectKey,
				ExpiresAt: time.Now().UTC().Add(sessionTTL),
			}
		} else {
			return nil, huma.Error400BadRequest("streaming media upload sessions are unavailable")
		}

		now := time.Now().UTC()
		media := &models.MediaAttachment{
			ID:                 mediaID,
			WorkspaceID:        workspaceID,
			FilePath:           session.Key,
			StorageType:        h.storage.Driver(),
			MimeType:           mimeType,
			ProcessingStatus:   mediaProcessingStatus,
			ProcessingProgress: 0,
			Size:               input.Body.Size,
			OriginalFilename:   filename,
			FileHash:           "pending:" + mediaID,
			Source:             source,
			AssetKind:          assetKind,
			RetentionClass:     retentionClass,
			ParentMediaID:      strings.TrimSpace(input.Body.ParentMediaID),
			DesignDocumentID:   strings.TrimSpace(input.Body.DesignDocumentID),
			DesignPageID:       strings.TrimSpace(input.Body.DesignPageID),
			VideoProjectID:     strings.TrimSpace(input.Body.VideoProjectID),
			AltText:            input.Body.AltText,
			AnalysisStatus:     mediaanalysis.AnalysisStatusPending,
			LastUsedAt:         now,
			CreatedAt:          now,
		}
		if _, err := h.db.NewInsert().Model(media).Exec(ctx); err != nil {
			return nil, huma.Error500InternalServerError("failed to reserve media upload")
		}
		if err := h.addMediaTag(ctx, tagID, media.ID); err != nil {
			_, _ = h.db.NewDelete().Model(media).WherePK().Exec(ctx)
			return nil, err
		}
		if err := h.persistStockMediaProvenance(ctx, media.ID, input.Body.StockProvenance); err != nil {
			_, _ = h.db.NewDelete().Model((*models.MediaAttachment)(nil)).Where("id = ?", media.ID).Exec(ctx)
			return nil, huma.Error500InternalServerError("failed to save stock media provenance")
		}

		return &CreateMediaUploadSessionOutput{Body: struct {
			MediaID     string                  `json:"media_id" doc:"Pending media ID"`
			Upload      DirectMediaUploadTarget `json:"upload" doc:"Streaming upload request details"`
			CompleteURL string                  `json:"complete_url" doc:"API path to call after the upload succeeds"`
			Deduped     bool                    `json:"deduped" doc:"Whether an identical ready workspace asset was reused"`
		}{
			MediaID: mediaID,
			Upload: DirectMediaUploadTarget{
				Method:    session.Method,
				URL:       session.URL,
				Headers:   session.Headers,
				ExpiresAt: session.ExpiresAt.Format(time.RFC3339),
				ObjectKey: session.Key,
			},
			CompleteURL: "/api/v1/media/upload-session/" + mediaID + "/complete",
			Deduped:     false,
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "complete-media-upload-session",
		Method:      http.MethodPost,
		Path:        "/media/upload-session/{id}/complete",
		Summary:     "Complete a streaming media upload session",
		Tags:        []string{tagMedia},
		Middlewares: huma.Middlewares{middleware.AuthMiddleware(api, h.authn)},
		Errors:      []int{400, 403, 404},
	}, func(ctx context.Context, input *CompleteMediaUploadSessionInput) (*CompleteMediaUploadSessionOutput, error) {
		userID := middleware.GetUserID(ctx)
		workspaceID := strings.TrimSpace(input.Body.WorkspaceID)
		if workspaceID == "" {
			return nil, huma.Error400BadRequest(errWorkspaceIDRequired)
		}

		result, err := h.completeDirectMediaUpload(ctx, userID, workspaceID, input.PathID)
		if err != nil {
			return nil, err
		}
		return &CompleteMediaUploadSessionOutput{Body: result}, nil
	})
}

type mediaUsageSummary struct {
	Total    int
	Blocking int
}

func (h *MediaHandler) ensureMediaWorkspaceAccess(ctx context.Context, userID, workspaceID string) error {
	allowed, err := middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	return nil
}

func (h *MediaHandler) ensureMediaWorkspaceEditAccess(ctx context.Context, userID, workspaceID string) error {
	allowed, err := middleware.CheckWorkspaceEditAccess(ctx, h.db, workspaceID, userID)
	if err != nil {
		return huma.Error500InternalServerError(errValidateWorkspaceAccess)
	}
	if !allowed {
		return huma.Error403Forbidden("workspace editor role required")
	}
	return nil
}

func (h *MediaHandler) resolveMediaUploadTag(ctx context.Context, workspaceID, requestedTagID, assetKind string) (string, error) {
	if defaultMediaAssetKind(assetKind) != "library" {
		return "", nil
	}
	tagID := strings.TrimSpace(requestedTagID)
	if tagID == "" {
		return "", nil
	}
	var tag models.MediaTag
	if err := h.db.NewSelect().Model(&tag).Column("id", "workspace_id").Where("id = ?", tagID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", huma.Error400BadRequest("media tag not found")
		}
		return "", huma.Error500InternalServerError("failed to load media tag")
	}
	if tag.WorkspaceID != workspaceID {
		return "", huma.Error400BadRequest("media tag must belong to this workspace")
	}
	return tag.ID, nil
}

func (h *MediaHandler) addMediaTag(ctx context.Context, tagID, mediaID string) error {
	if tagID == "" || mediaID == "" {
		return nil
	}
	assignment := &models.MediaTagAssignment{
		TagID:     tagID,
		MediaID:   mediaID,
		CreatedAt: time.Now().UTC(),
	}
	if _, err := h.db.NewInsert().Model(assignment).On("CONFLICT (tag_id, media_id) DO NOTHING").Exec(ctx); err != nil {
		return huma.Error500InternalServerError("failed to tag media")
	}
	if err := medialifecycle.NewService(h.db, h.storage).Promote(ctx, mediaID); err != nil {
		return huma.Error500InternalServerError("failed to keep tagged media in the library")
	}
	return nil
}

func (h *MediaHandler) transferMediaTagAssignments(ctx context.Context, sourceMediaID, destinationMediaID string) error {
	if sourceMediaID == "" || destinationMediaID == "" || sourceMediaID == destinationMediaID {
		return nil
	}
	var assignments []models.MediaTagAssignment
	if err := h.db.NewSelect().Model(&assignments).Where("media_id = ?", sourceMediaID).Scan(ctx); err != nil {
		if isMissingOptionalMediaTable(err) {
			return nil
		}
		return huma.Error500InternalServerError("failed to load media tags")
	}
	for _, assignment := range assignments {
		if err := h.addMediaTag(ctx, assignment.TagID, destinationMediaID); err != nil {
			return err
		}
	}
	return nil
}

func uniqueMediaFilterValues(values ...string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, value := range values {
		for _, candidate := range strings.Split(value, ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate == "" {
				continue
			}
			if _, exists := seen[candidate]; exists {
				continue
			}
			seen[candidate] = struct{}{}
			result = append(result, candidate)
		}
	}
	return result
}

func cleanUploadFilename(filename string) string {
	filename = strings.TrimSpace(strings.ReplaceAll(filename, "\\", "/"))
	if filename == "" {
		return ""
	}
	filename = filepath.Base(filename)
	if filename == "." || filename == "/" {
		return ""
	}
	return filename
}

func mediaUploadSizeLimit(assetKind, filename, mimeType string) int64 {
	if assetKind == "brand_font" {
		return 10 * 1024 * 1024
	}
	if isVideoUpload(filename, mimeType) {
		return MaxMediaUploadBytes
	}
	return MaxBufferedMediaUploadBytes
}

func isVideoUpload(filename, mimeType string) bool {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "video/") {
		return true
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".mp4", ".mov", ".m4v", ".webm":
		return true
	default:
		return false
	}
}

func mediaUploadSizeError(limit int64) string {
	switch limit {
	case MaxMediaUploadBytes:
		return "video file size exceeds 16 GiB limit"
	case 10 * 1024 * 1024:
		return "brand fonts must be 10MB or smaller"
	default:
		return "file size exceeds 50MB limit"
	}
}

func mediaUploadSessionTTL(size int64) time.Duration {
	if size <= 0 {
		return MediaUploadSessionTTL
	}
	estimated := 10*time.Minute + time.Duration(size/(1024*1024))*time.Second
	if estimated < MediaUploadSessionTTL {
		return MediaUploadSessionTTL
	}
	if estimated > maxMediaUploadSessionTTL {
		return maxMediaUploadSessionTTL
	}
	return estimated
}

func (h *MediaHandler) supportsUploadSessions() bool {
	if h.storage == nil {
		return false
	}
	return h.storage.Driver() == "local" || h.storage.Driver() == "s3"
}

func (h *MediaHandler) completeDirectMediaUpload(ctx context.Context, userID, workspaceID, mediaID string) (MediaUploadResult, error) {
	var result MediaUploadResult
	media, err := h.loadDirectMediaUpload(ctx, userID, workspaceID, mediaID)
	if err != nil {
		return result, err
	}
	if directMediaUploadFinalized(media) {
		return mediaUploadResultFromAttachment(media, false), nil
	}

	inspection, err := h.inspectDirectMediaUpload(ctx, media)
	if err != nil {
		return result, err
	}
	if !isInternalMediaAssetKind(media.AssetKind) {
		if err := h.checkUploadQuotaExcludingMedia(ctx, workspaceID, inspection.Size, media.ID); err != nil {
			return result, huma.Error400BadRequest(err.Error())
		}
	}

	fileHash := inspection.FileHash
	if mediaSourceSupportsDeduplication(media.Source) && media.AssetKind == "library" {
		if existing, found, err := h.findDuplicateMedia(ctx, workspaceID, fileHash, media.ID); err != nil {
			return result, err
		} else if found {
			if err := h.transferMediaTagAssignments(ctx, media.ID, existing.ID); err != nil {
				return result, err
			}
			_ = h.storage.Delete(filepath.Base(media.FilePath))
			_, _ = h.db.NewDelete().Model(&media).Where("id = ?", media.ID).Exec(ctx)
			return mediaUploadResultFromAttachment(existing, true), nil
		}
	}

	media, err = h.finalizeDirectMediaUploadRecord(ctx, media, inspection)
	if err != nil {
		if duplicate, deduped := h.resolveDirectUploadDeduplication(ctx, workspaceID, fileHash, media); deduped {
			return duplicate, nil
		}
		return result, err
	}
	if !isInternalMediaAssetKind(media.AssetKind) {
		if _, err := h.usage.IncrementMonthly(ctx, workspaceID, entitlements.LimitMediaBytesUploadedMonthly, media.Size, time.Now().UTC()); err != nil {
			return result, huma.Error500InternalServerError("failed to record media upload usage")
		}
	}

	return mediaUploadResultFromAttachment(media, false), nil
}

func (h *MediaHandler) resolveDirectUploadDeduplication(
	ctx context.Context,
	workspaceID string,
	fileHash string,
	media models.MediaAttachment,
) (MediaUploadResult, bool) {
	if !mediaSourceSupportsDeduplication(media.Source) || media.AssetKind != "library" {
		return MediaUploadResult{}, false
	}
	existing, found, err := h.findDuplicateMedia(ctx, workspaceID, fileHash, media.ID)
	if err != nil || !found {
		return MediaUploadResult{}, false
	}
	if err := h.transferMediaTagAssignments(ctx, media.ID, existing.ID); err != nil {
		return MediaUploadResult{}, false
	}
	_, _ = h.db.NewDelete().Model(&media).Where("id = ?", media.ID).Exec(ctx)
	if deleteErr := h.deleteMediaFiles(&media); deleteErr != nil {
		log.Printf("failed to delete deduplicated direct upload files for %s: %v", media.ID, deleteErr)
	}
	return mediaUploadResultFromAttachment(existing, true), true
}

func (h *MediaHandler) loadDirectMediaUpload(ctx context.Context, userID, workspaceID, mediaID string) (models.MediaAttachment, error) {
	var media models.MediaAttachment
	if strings.TrimSpace(mediaID) == "" {
		return media, huma.Error400BadRequest("media id is required")
	}
	if err := h.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return media, huma.Error404NotFound(errMediaNotFound)
		}
		return media, huma.Error500InternalServerError("failed to fetch media")
	}
	if media.WorkspaceID != workspaceID {
		return media, huma.Error403Forbidden(errWorkspaceAccessDenied)
	}
	if err := h.ensureMediaWorkspaceEditAccess(ctx, userID, workspaceID); err != nil {
		return media, err
	}
	if !directMediaUploadFinalized(media) &&
		media.ProcessingStatus != mediaReadyStatus &&
		media.ProcessingStatus != mediaProcessingStatus {
		return media, huma.Error400BadRequest("media upload session is not pending")
	}
	if media.StorageType != h.storage.Driver() {
		return media, huma.Error400BadRequest("media upload session belongs to a different storage driver")
	}
	return media, nil
}

func directMediaUploadFinalized(media models.MediaAttachment) bool {
	fileHash := strings.TrimSpace(media.FileHash)
	return media.ProcessingStatus == mediaReadyStatus ||
		(fileHash != "" && !strings.HasPrefix(fileHash, "pending:"))
}

func (h *MediaHandler) inspectDirectMediaUpload(ctx context.Context, media models.MediaAttachment) (mediaUploadInspection, error) {
	var inspection mediaUploadInspection
	sizeLimit := mediaUploadSizeLimit(media.AssetKind, media.OriginalFilename, media.MimeType)
	if media.Size <= 0 {
		h.markMediaUploadFailed(ctx, media.ID)
		return inspection, huma.Error400BadRequest("uploaded media object is empty")
	}
	if media.Size > sizeLimit {
		h.markMediaUploadFailed(ctx, media.ID)
		return inspection, huma.Error400BadRequest(mediaUploadSizeError(sizeLimit))
	}

	file, err := h.storage.Open(filepath.Base(media.FilePath))
	if err != nil {
		h.markMediaUploadFailed(ctx, media.ID)
		return inspection, huma.Error400BadRequest("uploaded media object was not found")
	}
	defer file.Close()

	if media.Size <= MaxBufferedMediaUploadBytes {
		content, readErr := io.ReadAll(io.LimitReader(file, sizeLimit+1))
		if readErr != nil {
			h.markMediaUploadFailed(ctx, media.ID)
			return inspection, huma.Error500InternalServerError("failed to read uploaded media")
		}
		inspection.Content = content
		inspection.Size = int64(len(content))
		if len(content) > 512 {
			inspection.Prefix = content[:512]
		} else {
			inspection.Prefix = content
		}
		hash := sha256.Sum256(content)
		inspection.FileHash = hex.EncodeToString(hash[:])
	} else {
		prefix := make([]byte, 512)
		prefixBytes, readErr := io.ReadFull(file, prefix)
		if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
			h.markMediaUploadFailed(ctx, media.ID)
			return inspection, huma.Error500InternalServerError("failed to read uploaded media")
		}
		prefix = prefix[:prefixBytes]
		hasher := sha256.New()
		_, _ = hasher.Write(prefix)
		remainingBytes, copyErr := io.Copy(hasher, io.LimitReader(file, sizeLimit-int64(prefixBytes)+1))
		if copyErr != nil {
			h.markMediaUploadFailed(ctx, media.ID)
			return inspection, huma.Error500InternalServerError("failed to read uploaded media")
		}
		inspection.Prefix = prefix
		inspection.Size = int64(prefixBytes) + remainingBytes
		inspection.FileHash = hex.EncodeToString(hasher.Sum(nil))
	}
	if inspection.Size > sizeLimit {
		h.markMediaUploadFailed(ctx, media.ID)
		return mediaUploadInspection{}, huma.Error400BadRequest(mediaUploadSizeError(sizeLimit))
	}
	if inspection.Size == 0 {
		h.markMediaUploadFailed(ctx, media.ID)
		return mediaUploadInspection{}, huma.Error400BadRequest("uploaded media object is empty")
	}
	if media.Size != inspection.Size {
		h.markMediaUploadFailed(ctx, media.ID)
		return mediaUploadInspection{}, huma.Error400BadRequest("uploaded media size does not match upload session")
	}
	return inspection, nil
}

func (h *MediaHandler) findDuplicateMedia(ctx context.Context, workspaceID, fileHash, mediaID string) (models.MediaAttachment, bool, error) {
	var existing models.MediaAttachment
	err := h.db.NewSelect().Model(&existing).
		Where("workspace_id = ? AND file_hash = ? AND id != ?", workspaceID, fileHash, mediaID).
		Where("(source = ? OR source = '' OR source IS NULL)", "upload").
		Where("(asset_kind = ? OR asset_kind = '' OR asset_kind IS NULL)", "library").
		Scan(ctx)
	if err == nil {
		return existing, true, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return existing, false, nil
	}
	return existing, false, huma.Error500InternalServerError("failed to check duplicate media")
}

func (h *MediaHandler) finalizeDirectMediaUploadRecord(ctx context.Context, media models.MediaAttachment, inspection mediaUploadInspection) (models.MediaAttachment, error) {
	validationContent := inspection.Content
	if len(validationContent) == 0 {
		validationContent = inspection.Prefix
	}
	if err := validateMediaAssetContent(media.AssetKind, media.OriginalFilename, media.MimeType, validationContent); err != nil {
		h.markMediaUploadFailed(ctx, media.ID)
		return media, huma.Error400BadRequest(err.Error())
	}
	mimeType := detectedMediaMimeType(inspection.Prefix, media.MimeType)
	width, height := 0, 0
	var thumbnails Thumbnails
	var err error
	if strings.HasPrefix(mimeType, "image/") {
		width, height, thumbnails, err = h.processImage(inspection.Content, media.ID, mimeType)
		if err != nil {
			width, height = h.getImageDimensions(bytes.NewReader(inspection.Content), mimeType)
		}
	}
	thumbsJSON := ""
	if encoded, err := json.Marshal(thumbnails); err == nil {
		thumbsJSON = string(encoded)
	}

	media.MimeType = mimeType
	media.ProcessingStatus = mediaReadyStatus
	media.ProcessingProgress = 100
	media.Size = inspection.Size
	media.FileHash = inspection.FileHash
	media.Width = width
	media.Height = height
	media.ThumbnailsJSON = thumbsJSON
	media.DominantType = dominantMediaType(mimeType)
	media.AspectRatio = mediaAspectRatio(width, height)
	media.AnalysisStatus = mediaanalysis.AnalysisStatusReady
	if strings.HasPrefix(mimeType, "video/") && h.video != nil {
		media.ProcessingStatus = mediaProcessingStatus
		media.ProcessingProgress = 0
		media.AnalysisStatus = mediaanalysis.AnalysisStatusPending
		media.AnalysisError = ""
	}
	h.applyPublicURLVerification(ctx, &media)
	if _, err := h.db.NewUpdate().
		Model(&media).
		Column("mime_type", "processing_status", "processing_progress", "size", "file_hash", "width", "height", "duration_ms", "frame_rate", "thumbnails", "dominant_type", "aspect_ratio", "analysis_status", "analysis_error", "thumbnail_object_key", "public_url_ready", "public_url_checked_at", "public_url_status", "public_url_error").
		Where("id = ?", media.ID).
		Exec(ctx); err != nil {
		h.markMediaUploadFailed(ctx, media.ID)
		return media, huma.Error500InternalServerError("failed to finalize media record")
	}
	if strings.HasPrefix(mimeType, "video/") && h.video != nil {
		h.enqueueVideoAnalysis(ctx, media.ID)
	}
	return media, nil
}

func dominantMediaType(mimeType string) string {
	switch {
	case strings.HasPrefix(mimeType, "image/"):
		return "image"
	case strings.HasPrefix(mimeType, "video/"):
		return "video"
	case strings.HasPrefix(mimeType, "audio/"):
		return "audio"
	default:
		return "other"
	}
}

func mediaAspectRatio(width, height int) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	gcd := greatestCommonDivisor(width, height)
	return strconv.Itoa(width/gcd) + ":" + strconv.Itoa(height/gcd)
}

func greatestCommonDivisor(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}

func (h *MediaHandler) enqueueVideoAnalysis(ctx context.Context, mediaID string) {
	if h.video == nil {
		log.Printf("video analysis service is unavailable for media %s", mediaID)
		return
	}
	if err := h.video.EnqueueAnalysis(ctx, mediaID); err != nil {
		log.Printf("failed to enqueue video analysis for media %s: %v", mediaID, err)
	}
}

func (h *MediaHandler) applyPublicURLVerification(ctx context.Context, media *models.MediaAttachment) {
	if h.publicMedia == nil {
		h.publicMedia = publicurl.NewMediaVerifier("", h.storage, h.signer)
	}
	applyPublicMediaResult(media, h.publicMedia.Verify(ctx, *media))
}

func mediaPosterURL(media models.MediaAttachment) string {
	if media.ThumbnailObjectKey == "" {
		return ""
	}
	return "/media/" + media.ID + "/poster"
}

func formatMediaTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func detectedMediaMimeType(content []byte, fallback string) string {
	mimeType := http.DetectContentType(content)
	if !strings.HasPrefix(mimeType, defaultMediaMimeType) {
		return mimeType
	}
	if fallback != "" {
		return fallback
	}
	return defaultMediaMimeType
}

func validateMediaAssetContent(assetKind, filename, declaredMimeType string, content []byte) error {
	if isSVGMediaUpload(filename, declaredMimeType, content) {
		return errors.New("SVG upload could not be processed")
	}
	if assetKind != "brand_font" {
		return nil
	}
	if len(content) > 10*1024*1024 {
		return errors.New("brand fonts must be 10MB or smaller")
	}
	extension := strings.ToLower(filepath.Ext(filename))
	var formatName string
	var validSignature bool
	var allowedMimeTypes []string
	switch extension {
	case ".woff2":
		formatName = "WOFF2"
		validSignature = len(content) >= 4 && bytes.Equal(content[:4], []byte{'w', 'O', 'F', '2'})
		allowedMimeTypes = []string{"font/woff2"}
	case ".ttf":
		formatName = "TTF"
		validSignature = len(content) >= 4 &&
			(bytes.Equal(content[:4], []byte{0x00, 0x01, 0x00, 0x00}) ||
				bytes.Equal(content[:4], []byte{'t', 'r', 'u', 'e'}))
		allowedMimeTypes = []string{"font/ttf", "font/sfnt", "application/x-font-ttf", "application/font-sfnt"}
	case ".otf":
		formatName = "OTF"
		validSignature = len(content) >= 4 && bytes.Equal(content[:4], []byte{'O', 'T', 'T', 'O'})
		allowedMimeTypes = []string{"font/otf", "font/sfnt", "application/x-font-opentype", "application/font-sfnt"}
	default:
		return errors.New("brand fonts must use a .woff2, .ttf, or .otf extension")
	}
	if !validSignature {
		return fmt.Errorf("brand font content is not a valid %s file", formatName)
	}
	if declaredMimeType != "" &&
		!strings.EqualFold(declaredMimeType, defaultMediaMimeType) &&
		!slices.ContainsFunc(allowedMimeTypes, func(candidate string) bool {
			return strings.EqualFold(declaredMimeType, candidate)
		}) {
		return fmt.Errorf("brand font MIME type does not match the %s file", formatName)
	}
	return nil
}

func isSVGMediaUpload(filename, declaredMimeType string, content []byte) bool {
	if strings.EqualFold(strings.TrimSpace(declaredMimeType), "image/svg+xml") ||
		strings.EqualFold(filepath.Ext(strings.TrimSpace(filename)), ".svg") {
		return true
	}
	normalized := bytes.ToLower(bytes.TrimSpace(content))
	return bytes.Contains(normalized, []byte("<svg"))
}

func (h *MediaHandler) markMediaUploadFailed(ctx context.Context, mediaID string) {
	_, _ = h.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("processing_status = ?", mediaFailedStatus).
		Where("id = ?", mediaID).
		Exec(ctx)
}

func mediaUploadResultFromAttachment(media models.MediaAttachment, deduped bool) MediaUploadResult {
	return MediaUploadResult{
		ID:                 media.ID,
		MimeType:           media.MimeType,
		URL:                "/media/" + media.ID,
		Size:               media.Size,
		Deduped:            deduped,
		AltText:            media.AltText,
		OriginalFilename:   media.OriginalFilename,
		Source:             defaultMediaSource(media.Source),
		AssetKind:          defaultMediaAssetKind(media.AssetKind),
		RetentionClass:     defaultMediaRetentionClass(media.RetentionClass),
		ParentMediaID:      media.ParentMediaID,
		DesignDocumentID:   media.DesignDocumentID,
		DesignPageID:       media.DesignPageID,
		VideoProjectID:     media.VideoProjectID,
		ProcessingStatus:   media.ProcessingStatus,
		ProcessingProgress: media.ProcessingProgress,
		AnalysisStatus:     media.AnalysisStatus,
		AnalysisError:      media.AnalysisError,
		PosterThumbnailURL: mediaPosterURL(media),
	}
}

func mediaUploadMap(media models.MediaAttachment, deduped bool) map[string]interface{} {
	result := mediaUploadResultFromAttachment(media, deduped)
	return map[string]interface{}{
		"id":                   result.ID,
		"mime_type":            result.MimeType,
		"url":                  result.URL,
		"size":                 result.Size,
		"deduped":              result.Deduped,
		"alt_text":             result.AltText,
		"original_filename":    result.OriginalFilename,
		"source":               result.Source,
		"asset_kind":           result.AssetKind,
		"retention_class":      result.RetentionClass,
		"parent_media_id":      result.ParentMediaID,
		"design_document_id":   result.DesignDocumentID,
		"design_page_id":       result.DesignPageID,
		"processing_status":    result.ProcessingStatus,
		"processing_progress":  result.ProcessingProgress,
		"analysis_status":      result.AnalysisStatus,
		"analysis_error":       result.AnalysisError,
		"poster_thumbnail_url": result.PosterThumbnailURL,
	}
}

func isInternalMediaAssetKind(assetKind string) bool {
	switch defaultMediaAssetKind(assetKind) {
	case "design_preview", "template_preview":
		return true
	default:
		return false
	}
}

func defaultMediaRetentionClass(value string) string {
	if strings.TrimSpace(value) == medialifecycle.RetentionTemporary {
		return medialifecycle.RetentionTemporary
	}
	return medialifecycle.RetentionLibrary
}

func mediaSourceSupportsDeduplication(source string) bool {
	switch source {
	case "upload", "video_editor_source", "stock_import":
		return true
	default:
		return false
	}
}

func normalizeMediaProvenance(source, assetKind string) (string, string, error) {
	source = defaultMediaSource(source)
	switch source {
	case "upload", "camera", "image_editor_export", "image_editor_edit", "background_removal",
		"video_editor_source", "video_editor_export", "stock_import", "meme_generator":
	default:
		return "", "", errors.New("invalid media source")
	}
	assetKind = defaultMediaAssetKind(assetKind)
	switch assetKind {
	case "library", "brand_asset", "brand_font", "design_preview", "template_preview":
	default:
		return "", "", errors.New("invalid media asset kind")
	}
	if assetKind == "design_preview" && source != "image_editor_export" && source != "image_editor_edit" {
		return "", "", errors.New("design previews must be produced by OpenPost Image Editor")
	}
	return source, assetKind, nil
}

func parseStockMediaProvenance(raw string) (*videoproject.StockMediaProvenance, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var provenance videoproject.StockMediaProvenance
	if err := json.Unmarshal([]byte(raw), &provenance); err != nil {
		return nil, errors.New("stock provenance must be valid JSON")
	}
	if err := videoproject.ValidateStockMediaProvenance(provenance); err != nil {
		return nil, err
	}
	return &provenance, nil
}

func validateStockUploadProvenance(source string, provenance *videoproject.StockMediaProvenance) error {
	if source == "stock_import" && provenance == nil {
		return errors.New("stock imports require license and creator provenance")
	}
	if provenance == nil {
		return nil
	}
	if source != "stock_import" {
		return errors.New("stock provenance is allowed only for stock imports")
	}
	return videoproject.ValidateStockMediaProvenance(*provenance)
}

func (h *MediaHandler) persistStockMediaProvenance(
	ctx context.Context,
	mediaID string,
	provenance *videoproject.StockMediaProvenance,
) error {
	if provenance == nil {
		return nil
	}
	record := &models.MediaProvenance{
		MediaID:         mediaID,
		Provider:        strings.TrimSpace(provenance.Provider),
		ExternalID:      strings.TrimSpace(provenance.ExternalID),
		SourceURL:       strings.TrimSpace(provenance.SourceURL),
		CreatorName:     strings.TrimSpace(provenance.CreatorName),
		CreatorURL:      strings.TrimSpace(provenance.CreatorURL),
		LicenseName:     strings.TrimSpace(provenance.LicenseName),
		LicenseURL:      strings.TrimSpace(provenance.LicenseURL),
		AttributionText: strings.TrimSpace(provenance.AttributionText),
		ImportedAt:      time.Now().UTC(),
	}
	_, err := h.db.NewInsert().Model(record).On("CONFLICT (media_id) DO NOTHING").Exec(ctx)
	return err
}

func (h *MediaHandler) validateVideoProjectReference(
	ctx context.Context,
	workspaceID string,
	videoProjectID string,
) error {
	videoProjectID = strings.TrimSpace(videoProjectID)
	if videoProjectID == "" {
		return nil
	}
	count, err := h.db.NewSelect().Model((*models.VideoProject)(nil)).
		Where("id = ? AND workspace_id = ? AND deleted_at IS NULL", videoProjectID, workspaceID).
		Count(ctx)
	if err != nil {
		return huma.Error500InternalServerError("failed to validate OpenPost Video Editor project")
	}
	if count != 1 {
		return huma.Error400BadRequest("OpenPost Video Editor project must belong to the workspace")
	}
	return nil
}

func (h *MediaHandler) reusableMediaForClientHash(
	ctx context.Context,
	workspaceID string,
	clientSHA256 string,
	size int64,
	mimeType string,
) (*models.MediaAttachment, error) {
	hash := strings.ToLower(strings.TrimSpace(clientSHA256))
	if hash == "" {
		return nil, nil
	}
	if len(hash) != sha256.Size*2 {
		return nil, huma.Error400BadRequest("client_sha256 must be a SHA-256 hex digest")
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return nil, huma.Error400BadRequest("client_sha256 must be a SHA-256 hex digest")
	}
	var media models.MediaAttachment
	err := h.db.NewSelect().Model(&media).
		Where(
			"workspace_id = ? AND file_hash = ? AND size = ? AND mime_type = ? AND processing_status = ? AND asset_kind = ?",
			workspaceID,
			hash,
			size,
			mimeType,
			mediaReadyStatus,
			"library",
		).
		OrderExpr("created_at ASC").
		Limit(1).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("failed to check reusable workspace media")
	}
	return &media, nil
}

func defaultMediaSource(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "upload"
}

func defaultMediaAssetKind(value string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return "library"
}

func (h *MediaHandler) validateMediaProvenanceReferences(ctx context.Context, workspaceID, parentMediaID, designDocumentID, designPageID string) error {
	parentMediaID = strings.TrimSpace(parentMediaID)
	designDocumentID = strings.TrimSpace(designDocumentID)
	designPageID = strings.TrimSpace(designPageID)
	if parentMediaID != "" {
		count, err := h.db.NewSelect().Model((*models.MediaAttachment)(nil)).
			Where("id = ? AND workspace_id = ?", parentMediaID, workspaceID).
			Count(ctx)
		if err != nil {
			return huma.Error500InternalServerError("failed to validate source media")
		}
		if count != 1 {
			return huma.Error400BadRequest("source media must belong to the workspace")
		}
	}
	if designDocumentID == "" && designPageID != "" {
		return huma.Error400BadRequest("design_document_id is required with design_page_id")
	}
	if designDocumentID != "" {
		count, err := h.db.NewSelect().Model((*models.DesignDocument)(nil)).
			Where("id = ? AND workspace_id = ? AND deleted_at IS NULL", designDocumentID, workspaceID).
			Count(ctx)
		if err != nil {
			return huma.Error500InternalServerError("failed to validate OpenPost Image Editor design")
		}
		if count != 1 {
			return huma.Error400BadRequest("OpenPost Image Editor design must belong to the workspace")
		}
	}
	if designPageID != "" {
		count, err := h.db.NewSelect().Model((*models.DesignPage)(nil)).
			Where("id = ? AND design_document_id = ?", designPageID, designDocumentID).
			Count(ctx)
		if err != nil {
			return huma.Error500InternalServerError("failed to validate OpenPost Image Editor page")
		}
		if count != 1 {
			return huma.Error400BadRequest("OpenPost Image Editor page must belong to the design")
		}
	}
	return nil
}

func (h *MediaHandler) mediaUsageSummary(ctx context.Context, workspaceID, mediaID string) (mediaUsageSummary, error) {
	summaries, err := h.mediaUsageSummaries(ctx, workspaceID, []string{mediaID})
	return summaries[mediaID], err
}

func (h *MediaHandler) variantMediaIDsForWorkspace(ctx context.Context, workspaceID string) ([]string, error) {
	var rows []mediaVariantUsageRow
	if err := h.db.NewSelect().
		TableExpr("post_variants AS pv").
		ColumnExpr("pv.media_ids").
		Join("JOIN posts AS p ON p.id = pv.post_id").
		Where("p.workspace_id = ?", workspaceID).
		Where("pv.media_ids != ''").
		Scan(ctx, &rows); err != nil {
		return nil, err
	}
	unique := make(map[string]struct{})
	for _, row := range rows {
		var ids []string
		if json.Unmarshal([]byte(row.MediaIDs), &ids) != nil {
			continue
		}
		for _, id := range ids {
			if strings.TrimSpace(id) != "" {
				unique[id] = struct{}{}
			}
		}
	}
	ids := make([]string, 0, len(unique))
	for id := range unique {
		ids = append(ids, id)
	}
	return ids, nil
}

type mediaPostUsageRow struct {
	MediaID string `bun:"media_id"`
	PostID  string `bun:"post_id"`
	Status  string `bun:"status"`
}

type mediaVariantUsageRow struct {
	MediaIDs string `bun:"media_ids"`
	PostID   string `bun:"post_id"`
	Status   string `bun:"status"`
}

type mediaRenditionUsageRow struct {
	MediaID     string `bun:"media_id"`
	RenditionID string `bun:"rendition_id"`
	Status      string `bun:"status"`
}

type mediaOrganizationRow struct {
	MediaID string `bun:"media_id"`
	ID      string `bun:"id"`
}

func (h *MediaHandler) mediaTagsByMedia(ctx context.Context, mediaIDs []string) (map[string][]string, error) {
	tags := make(map[string][]string, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		tags[mediaID] = []string{}
	}
	if len(mediaIDs) == 0 {
		return tags, nil
	}
	var rows []mediaOrganizationRow
	if err := h.db.NewSelect().
		TableExpr("media_tag_assignments AS a").
		ColumnExpr("a.media_id").
		ColumnExpr("a.tag_id AS id").
		Where("a.media_id IN (?)", bun.List(mediaIDs)).
		Scan(ctx, &rows); err != nil && !isMissingOptionalMediaTable(err) {
		return nil, err
	}
	for _, row := range rows {
		tags[row.MediaID] = append(tags[row.MediaID], row.ID)
	}
	return tags, nil
}

//nolint:gocyclo // Usage aggregation intentionally checks every independent reference surface.
func (h *MediaHandler) mediaUsageSummaries(ctx context.Context, workspaceID string, mediaIDs []string) (map[string]mediaUsageSummary, error) {
	summaries := make(map[string]mediaUsageSummary, len(mediaIDs))
	targets := make(map[string]struct{}, len(mediaIDs))
	postUsage := make(map[string]map[string]string, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		summaries[mediaID] = mediaUsageSummary{}
		targets[mediaID] = struct{}{}
		postUsage[mediaID] = make(map[string]string)
	}
	if len(mediaIDs) == 0 {
		return summaries, nil
	}
	postUsage, err := h.mediaPostUsage(ctx, workspaceID, mediaIDs, targets, postUsage)
	if err != nil {
		return nil, err
	}
	for mediaID, posts := range postUsage {
		summary := summaries[mediaID]
		for _, status := range posts {
			summary.Total++
			if mediaUsageStatusBlocks(status) {
				summary.Blocking++
			}
		}
		summaries[mediaID] = summary
	}

	renditionRows, err := h.mediaRenditionUsageRows(ctx, workspaceID, mediaIDs)
	if err != nil {
		return nil, err
	}
	for _, row := range renditionRows {
		summary := summaries[row.MediaID]
		summary.Total++
		if mediaUsageStatusBlocks(row.Status) {
			summary.Blocking++
		}
		summaries[row.MediaID] = summary
	}
	segmentQueries := []string{
		`SELECT psm.media_id, p.id AS rendition_id, p.status
				FROM publication_segment_media psm
				JOIN publication_segments ps ON ps.id = psm.segment_id
				JOIN publications p ON p.id = ps.publication_id
				WHERE p.workspace_id = ? AND psm.media_id IN (?)`,
		`SELECT rsm.media_id, r.id AS rendition_id, p.status
				FROM rendition_segment_media rsm
				JOIN rendition_segments rs ON rs.id = rsm.rendition_segment_id
				JOIN renditions r ON r.id = rs.rendition_id
				JOIN publications p ON p.id = r.publication_id
				WHERE p.workspace_id = ? AND rsm.media_id IN (?)`,
	}
	for _, query := range segmentQueries {
		var rows []mediaRenditionUsageRow
		if err := h.db.NewRaw(query, workspaceID, bun.List(mediaIDs)).Scan(ctx, &rows); err != nil && !isMissingOptionalMediaTable(err) {
			return nil, err
		}
		for _, row := range rows {
			summary := summaries[row.MediaID]
			summary.Total++
			if mediaUsageStatusBlocks(row.Status) {
				summary.Blocking++
			}
			summaries[row.MediaID] = summary
		}
	}

	blockingQueries := []string{
		`SELECT r.media_id, COUNT(*) AS usage_count
			FROM design_media_references r
			JOIN design_documents d ON d.id = r.design_document_id
			WHERE r.media_id IN (?) AND d.deleted_at IS NULL
			GROUP BY r.media_id`,
		`SELECT r.media_id, COUNT(*) AS usage_count
			FROM design_revision_media_references r
			JOIN design_revisions v ON v.id = r.revision_id
			JOIN design_documents d ON d.id = v.design_document_id
			WHERE r.media_id IN (?) AND d.deleted_at IS NULL
			GROUP BY r.media_id`,
		`SELECT r.media_id, COUNT(*) AS usage_count
			FROM design_template_media_references r
			WHERE r.media_id IN (?) GROUP BY r.media_id`,
		`SELECT a.media_id, COUNT(*) AS usage_count
			FROM video_project_assets a
			JOIN video_projects p ON p.id = a.video_project_id
			WHERE a.media_id IN (?) AND p.deleted_at IS NULL
			GROUP BY a.media_id`,
		`SELECT media_id, COUNT(*) AS usage_count FROM brand_fonts
			WHERE media_id IN (?) GROUP BY media_id`,
	}
	for _, query := range blockingQueries {
		var rows []struct {
			MediaID string `bun:"media_id"`
			Count   int    `bun:"usage_count"`
		}
		if err := h.db.NewRaw(query, bun.List(mediaIDs)).Scan(ctx, &rows); err != nil && !isMissingOptionalMediaTable(err) {
			return nil, err
		}
		for _, row := range rows {
			summary := summaries[row.MediaID]
			summary.Total += row.Count
			summary.Blocking += row.Count
			summaries[row.MediaID] = summary
		}
	}
	directReferenceQueries := []string{
		`SELECT cover_preview_media_id AS media_id, COUNT(*) AS usage_count
			FROM design_documents WHERE cover_preview_media_id IN (?) AND deleted_at IS NULL
			GROUP BY cover_preview_media_id`,
		`SELECT p.preview_media_id AS media_id, COUNT(*) AS usage_count
			FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id
			WHERE p.preview_media_id IN (?) AND d.deleted_at IS NULL GROUP BY p.preview_media_id`,
		`SELECT p.latest_export_media_id AS media_id, COUNT(*) AS usage_count
			FROM design_pages p JOIN design_documents d ON d.id = p.design_document_id
			WHERE p.latest_export_media_id IN (?) AND d.deleted_at IS NULL GROUP BY p.latest_export_media_id`,
		`SELECT preview_media_id AS media_id, COUNT(*) AS usage_count
			FROM design_templates WHERE preview_media_id IN (?) GROUP BY preview_media_id`,
		`SELECT cover_preview_media_id AS media_id, COUNT(*) AS usage_count
			FROM video_projects WHERE cover_preview_media_id IN (?) AND deleted_at IS NULL
			GROUP BY cover_preview_media_id`,
	}
	for _, query := range directReferenceQueries {
		var rows []struct {
			MediaID string `bun:"media_id"`
			Count   int    `bun:"usage_count"`
		}
		if err := h.db.NewRaw(query, bun.List(mediaIDs)).Scan(ctx, &rows); err != nil && !isMissingOptionalMediaTable(err) {
			return nil, err
		}
		for _, row := range rows {
			summary := summaries[row.MediaID]
			summary.Total += row.Count
			summary.Blocking += row.Count
			summaries[row.MediaID] = summary
		}
	}

	return summaries, nil
}

func mediaUsageStatusBlocks(status string) bool {
	status = strings.ToLower(strings.TrimSpace(status))
	return status != models.PostStatusPublished && status != models.PostStatusFailed
}

func normalizeMediaFilename(current, requested string) (string, error) {
	name := strings.TrimSpace(requested)
	if name == "" {
		return "", errors.New("filename is required")
	}
	if len([]rune(name)) > 255 {
		return "", errors.New("filename must be 255 characters or fewer")
	}
	if strings.ContainsAny(name, `/\\`) || strings.IndexFunc(name, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
		return "", errors.New("filename cannot contain path separators or control characters")
	}
	currentExtension := filepath.Ext(strings.TrimSpace(current))
	requestedExtension := filepath.Ext(name)
	if currentExtension != "" && requestedExtension == "" {
		return name + currentExtension, nil
	}
	if currentExtension != "" && !strings.EqualFold(currentExtension, requestedExtension) {
		return "", errors.New("file extension cannot be changed")
	}
	return name, nil
}

func (h *MediaHandler) mediaPostUsage(ctx context.Context, workspaceID string, mediaIDs []string, targets map[string]struct{}, postUsage map[string]map[string]string) (map[string]map[string]string, error) {
	var directRows []mediaPostUsageRow
	if err := h.db.NewSelect().
		TableExpr("post_media AS pm").
		ColumnExpr("pm.media_id").
		ColumnExpr("p.id AS post_id").
		ColumnExpr("p.status").
		Join("JOIN posts AS p ON p.id = pm.post_id").
		Where("p.workspace_id = ?", workspaceID).
		Where("pm.media_id IN (?)", bun.List(mediaIDs)).
		Scan(ctx, &directRows); err != nil {
		return nil, err
	}
	for _, row := range directRows {
		postUsage[row.MediaID][row.PostID] = row.Status
	}

	var variantRows []mediaVariantUsageRow
	if err := h.db.NewSelect().
		TableExpr("post_variants AS pv").
		ColumnExpr("pv.media_ids").
		ColumnExpr("p.id AS post_id").
		ColumnExpr("p.status").
		Join("JOIN posts AS p ON p.id = pv.post_id").
		Where("p.workspace_id = ?", workspaceID).
		Where("pv.media_ids != ''").
		Scan(ctx, &variantRows); err != nil {
		return nil, err
	}
	for _, row := range variantRows {
		var ids []string
		if json.Unmarshal([]byte(row.MediaIDs), &ids) != nil {
			continue
		}
		for _, mediaID := range ids {
			if _, ok := targets[mediaID]; ok {
				postUsage[mediaID][row.PostID] = row.Status
			}
		}
	}

	return postUsage, nil
}

func (h *MediaHandler) mediaRenditionUsageRows(ctx context.Context, workspaceID string, mediaIDs []string) ([]mediaRenditionUsageRow, error) {
	var renditionRows []mediaRenditionUsageRow
	err := h.db.NewSelect().
		TableExpr("rendition_media AS rm").
		ColumnExpr("rm.media_id").
		ColumnExpr("r.id AS rendition_id").
		ColumnExpr("p.status").
		Join("JOIN renditions AS r ON r.id = rm.rendition_id").
		Join("JOIN publications AS p ON p.id = r.publication_id").
		Where("p.workspace_id = ?", workspaceID).
		Where("rm.media_id IN (?)", bun.List(mediaIDs)).
		Scan(ctx, &renditionRows)
	if err != nil && !isMissingRenditionMediaTable(err) {
		return nil, err
	}
	return renditionRows, nil
}

func isMissingRenditionMediaTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table: rendition_media") ||
		strings.Contains(message, "relation \"rendition_media\" does not exist")
}

func isMissingOptionalMediaTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table:") ||
		strings.Contains(message, "does not exist")
}

func (h *MediaHandler) postsUsingMedia(ctx context.Context, workspaceID, mediaID string) ([]models.Post, error) {
	postRows := []models.Post{}
	if err := h.db.NewSelect().
		TableExpr("post_media AS pm").
		ColumnExpr("p.*").
		Join("JOIN posts AS p ON p.id = pm.post_id").
		Where("p.workspace_id = ?", workspaceID).
		Where("pm.media_id = ?", mediaID).
		Scan(ctx, &postRows); err != nil {
		return nil, err
	}

	var variants []mediaVariantUsageRow
	if err := h.db.NewSelect().
		TableExpr("post_variants AS pv").
		ColumnExpr("pv.media_ids").
		ColumnExpr("p.id AS post_id").
		ColumnExpr("p.status").
		Join("JOIN posts AS p ON p.id = pv.post_id").
		Where("p.workspace_id = ?", workspaceID).
		Where("pv.media_ids != ''").
		Scan(ctx, &variants); err != nil {
		return nil, err
	}

	postsByID := make(map[string]models.Post, len(postRows)+len(variants))
	for _, post := range postRows {
		postsByID[post.ID] = post
	}
	variantPostIDs := make([]string, 0, len(variants))
	for _, variant := range variants {
		if !variantContainsMedia(variant.MediaIDs, mediaID) {
			continue
		}
		variantPostIDs = append(variantPostIDs, variant.PostID)
	}
	if len(variantPostIDs) > 0 {
		var variantPosts []models.Post
		if err := h.db.NewSelect().Model(&variantPosts).
			Where("workspace_id = ?", workspaceID).
			Where("id IN (?)", bun.List(variantPostIDs)).
			Scan(ctx); err != nil {
			return nil, err
		}
		for _, post := range variantPosts {
			postsByID[post.ID] = post
		}
	}

	posts := make([]models.Post, 0, len(postsByID))
	for _, post := range postsByID {
		posts = append(posts, post)
	}
	return posts, nil
}

//nolint:gocyclo // Each usage type has distinct labels and destination metadata.
func (h *MediaHandler) nonPostMediaUsage(ctx context.Context, workspaceID, mediaID string) ([]MediaUsageItem, error) {
	usage := []MediaUsageItem{}
	var designs []struct {
		ID    string `bun:"id"`
		Title string `bun:"title"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_media_references AS r").
		ColumnExpr("DISTINCT d.id").
		ColumnExpr("d.title").
		Join("JOIN design_documents AS d ON d.id = r.design_document_id").
		Where("r.media_id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL", mediaID, workspaceID).
		Scan(ctx, &designs); err != nil {
		return nil, err
	}
	for _, design := range designs {
		usage = append(usage, MediaUsageItem{Kind: "design", ID: design.ID, Label: design.Title, Status: "editable"})
	}
	var versionDesigns []struct {
		ID    string `bun:"id"`
		Title string `bun:"title"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_revision_media_references AS reference").
		ColumnExpr("DISTINCT document.id").
		ColumnExpr("document.title").
		Join("JOIN design_revisions AS revision ON revision.id = reference.revision_id").
		Join("JOIN design_documents AS document ON document.id = revision.design_document_id").
		Where("reference.media_id = ? AND document.workspace_id = ? AND document.deleted_at IS NULL", mediaID, workspaceID).
		Scan(ctx, &versionDesigns); err != nil {
		return nil, err
	}
	for _, design := range versionDesigns {
		usage = append(usage, MediaUsageItem{
			Kind: "design_version", ID: design.ID, Label: design.Title, Status: "recovery version",
		})
	}
	var previewDesigns []struct {
		ID    string `bun:"id"`
		Title string `bun:"title"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_documents AS d").
		ColumnExpr("d.id, d.title").
		Where("d.cover_preview_media_id = ? AND d.workspace_id = ? AND d.deleted_at IS NULL", mediaID, workspaceID).
		Scan(ctx, &previewDesigns); err != nil {
		return nil, err
	}
	for _, design := range previewDesigns {
		usage = append(usage, MediaUsageItem{Kind: "design_preview", ID: design.ID, Label: design.Title})
	}
	var designPages []struct {
		ID       string `bun:"id"`
		Name     string `bun:"name"`
		DesignID string `bun:"design_id"`
		Title    string `bun:"title"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_pages AS page").
		ColumnExpr("page.id, page.name, document.id AS design_id, document.title").
		Join("JOIN design_documents AS document ON document.id = page.design_document_id").
		Where("document.workspace_id = ? AND document.deleted_at IS NULL", workspaceID).
		Where("(page.preview_media_id = ? OR page.latest_export_media_id = ?)", mediaID, mediaID).
		Scan(ctx, &designPages); err != nil {
		return nil, err
	}
	for _, page := range designPages {
		usage = append(usage, MediaUsageItem{
			Kind:  "design_page_export",
			ID:    page.ID,
			Label: page.Title + " · " + page.Name,
		})
	}

	var templates []struct {
		ID   string `bun:"id"`
		Name string `bun:"name"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_template_media_references AS r").
		ColumnExpr("DISTINCT t.id").
		ColumnExpr("t.name").
		Join("JOIN design_templates AS t ON t.id = r.design_template_id").
		Where("r.media_id = ? AND t.workspace_id = ?", mediaID, workspaceID).
		Scan(ctx, &templates); err != nil {
		return nil, err
	}
	for _, template := range templates {
		usage = append(usage, MediaUsageItem{Kind: "template", ID: template.ID, Label: template.Name})
	}
	var templatePreviews []struct {
		ID   string `bun:"id"`
		Name string `bun:"name"`
	}
	if err := h.db.NewSelect().
		TableExpr("design_templates AS template").
		ColumnExpr("template.id, template.name").
		Where("template.preview_media_id = ? AND template.workspace_id = ?", mediaID, workspaceID).
		Scan(ctx, &templatePreviews); err != nil {
		return nil, err
	}
	for _, template := range templatePreviews {
		usage = append(usage, MediaUsageItem{
			Kind:  "template_preview",
			ID:    template.ID,
			Label: template.Name,
		})
	}

	var brandFonts []struct {
		ID     string `bun:"id"`
		Family string `bun:"family"`
	}
	if err := h.db.NewSelect().
		TableExpr("brand_fonts AS f").
		ColumnExpr("f.id, f.family").
		Join("JOIN brand_kits AS k ON k.id = f.brand_kit_id").
		Where("f.media_id = ? AND k.workspace_id = ?", mediaID, workspaceID).
		Scan(ctx, &brandFonts); err != nil {
		return nil, err
	}
	for _, font := range brandFonts {
		usage = append(usage, MediaUsageItem{Kind: "brand_font", ID: font.ID, Label: font.Family})
	}
	return usage, nil
}

func variantContainsMedia(mediaIDsJSON, mediaID string) bool {
	var ids []string
	if err := json.Unmarshal([]byte(mediaIDsJSON), &ids); err != nil {
		return false
	}
	for _, id := range ids {
		if id == mediaID {
			return true
		}
	}
	return false
}

func (h *MediaHandler) mediaMetadata(c echo.Context) error {
	userID := c.Get(string(middleware.UserIDKey)).(string)

	workspaceID := c.QueryParam("workspace_id")
	if workspaceID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: errWorkspaceIDRequired})
	}

	mediaIDsRaw := c.QueryParam("media_ids")
	if mediaIDsRaw == "" {
		return c.JSON(http.StatusOK, map[string]interface{}{"media": []MediaMetadataItem{}})
	}

	mediaIDs := strings.Split(mediaIDsRaw, ",")
	for i := range mediaIDs {
		mediaIDs[i] = strings.TrimSpace(mediaIDs[i])
		if mediaIDs[i] == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "media_ids must not contain empty values"})
		}
	}

	if ok, err := h.userCanAccessWorkspace(c.Request().Context(), workspaceID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to validate workspace access"})
	} else if !ok {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
	}

	var media []models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).
		Where("workspace_id = ? AND id IN (?)", workspaceID, bun.List(mediaIDs)).
		Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to fetch media"})
	}

	result := make([]MediaMetadataItem, 0, len(media))
	for _, m := range media {
		item := MediaMetadataItem{
			ID:                 m.ID,
			MimeType:           m.MimeType,
			AltText:            m.AltText,
			Size:               m.Size,
			Width:              m.Width,
			Height:             m.Height,
			URL:                "/media/" + m.ID,
			DurationMS:         m.DurationMS,
			FrameRate:          m.FrameRate,
			ContainerFormat:    m.ContainerFormat,
			VideoCodec:         m.VideoCodec,
			AudioCodec:         m.AudioCodec,
			ProcessingStatus:   m.ProcessingStatus,
			ProcessingProgress: m.ProcessingProgress,
			PosterThumbnailURL: mediaPosterURL(m),
			AnalysisStatus:     m.AnalysisStatus,
			AnalysisError:      m.AnalysisError,
			PublicURLCheckedAt: formatMediaTime(m.PublicURLCheckedAt),
			PublicURLStatus:    m.PublicURLStatus,
			PublicURLError:     m.PublicURLError,
			IsDeleted:          !m.TrashedAt.IsZero(),
		}
		if item.IsDeleted {
			item.URL = ""
			item.Thumbnail = ""
			item.PosterThumbnailURL = ""
		}
		if thumbsJSON := m.ThumbnailsJSON; thumbsJSON != "" {
			var thumbs Thumbnails
			if json.Unmarshal([]byte(thumbsJSON), &thumbs) == nil && thumbs.SM != "" {
				item.Thumbnail = "/media/" + m.ID + "/thumb/sm"
			}
		}
		if item.Thumbnail == "" && item.PosterThumbnailURL != "" {
			item.Thumbnail = item.PosterThumbnailURL
		}
		result = append(result, item)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{"media": result})
}

func (h *MediaHandler) deleteMediaFiles(media *models.MediaAttachment) error {
	if err := h.storage.Delete(filepath.Base(media.FilePath)); err != nil {
		return err
	}

	var thumbs Thumbnails
	if media.ThumbnailsJSON != "" {
		_ = json.Unmarshal([]byte(media.ThumbnailsJSON), &thumbs)
	}

	if thumbs.SM != "" {
		h.storage.Delete(thumbs.SM) //nolint:errcheck
	}
	if thumbs.MD != "" {
		h.storage.Delete(thumbs.MD) //nolint:errcheck
	}
	if media.ThumbnailObjectKey != "" {
		h.storage.Delete(media.ThumbnailObjectKey) //nolint:errcheck
	}

	return nil
}

func (h *MediaHandler) RegisterLegacyRoutes(e *echo.Echo) {
	singleUploadLimit := strconv.FormatInt(MaxMediaUploadBytes+512*1024, 10)
	batchUploadLimit := strconv.FormatInt((MaxBufferedMediaUploadBytes*10)+(10*1024*1024), 10)
	// Legacy upload routes support both web (JWT) and CLI (op_cli_...)
	// credentials via the unified Authenticator. AuthMiddleware cannot
	// be used here because these are raw Echo handlers, not Huma ops.
	uploadAuth := middleware.BearerMiddleware(h.authn)
	uploadSessionContentAuth := middleware.BearerMiddleware(
		h.authn,
		middleware.RESTOperationUploadMediaSessionContent,
	)
	e.POST("/api/v1/media/upload", h.uploadMedia, echoMiddleware.BodyLimit(singleUploadLimit), uploadAuth)
	e.POST("/api/v1/media/batch-upload", h.batchUploadMedia, echoMiddleware.BodyLimit(batchUploadLimit), uploadAuth)
	e.PUT(
		"/api/v1/media/upload-session/:id/content",
		h.uploadMediaSessionContent,
		echoMiddleware.BodyLimit(singleUploadLimit),
		uploadSessionContentAuth,
	)
	e.GET("/api/v1/media/metadata", h.mediaMetadata, uploadAuth)
	e.GET("/media/:id", h.serveMedia, h.optionalMediaAuth())
	e.HEAD("/media/:id", h.serveMedia, h.optionalMediaAuth())
	e.GET("/media/:id/thumb/:size", h.serveThumbnailSize, h.optionalMediaAuth())
	e.HEAD("/media/:id/thumb/:size", h.serveThumbnailSize, h.optionalMediaAuth())
	e.GET("/media/:id/poster", h.serveVideoPoster, h.optionalMediaAuth())
	e.HEAD("/media/:id/poster", h.serveVideoPoster, h.optionalMediaAuth())
}

//nolint:gocyclo // Auth, session claiming, bounded streaming, storage cleanup, and retry recovery form one ordered transaction boundary.
func (h *MediaHandler) uploadMediaSessionContent(c echo.Context) error {
	userID, _ := c.Get(string(middleware.UserIDKey)).(string)
	mediaID := strings.TrimSpace(c.Param("id"))
	var media models.MediaAttachment
	if err := h.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(c.Request().Context()); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to load media upload session"})
	}
	if ok, err := h.userCanEditWorkspace(c.Request().Context(), media.WorkspaceID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
	} else if !ok {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
	}
	if h.storage == nil || media.StorageType != h.storage.Driver() {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "media upload session does not use this instance's storage"})
	}
	if media.ProcessingStatus != mediaProcessingStatus {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "media upload session is not pending"})
	}
	if media.CreatedAt.IsZero() || time.Since(media.CreatedAt) > mediaUploadSessionTTL(media.Size) {
		h.markMediaUploadFailed(c.Request().Context(), media.ID)
		return c.JSON(http.StatusGone, map[string]string{fieldError: "media upload session expired"})
	}

	sizeLimit := mediaUploadSizeLimit(media.AssetKind, media.OriginalFilename, media.MimeType)
	if media.Size <= 0 || media.Size > sizeLimit {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: mediaUploadSizeError(sizeLimit)})
	}
	if contentLength := c.Request().ContentLength; contentLength >= 0 && contentLength != media.Size {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "uploaded media size does not match upload session"})
	}
	claimResult, err := h.db.NewUpdate().
		Model(&media).
		Set("processing_status = ?", mediaUploadingStatus).
		Where("id = ? AND processing_status = ?", media.ID, mediaProcessingStatus).
		Exec(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to claim media upload session"})
	}
	claimed, err := claimResult.RowsAffected()
	if err != nil || claimed != 1 {
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "media upload session is already in use"})
	}
	resetPending := func() {
		_, _ = h.db.NewUpdate().
			Model((*models.MediaAttachment)(nil)).
			Set("processing_status = ?", mediaProcessingStatus).
			Where("id = ? AND processing_status = ?", media.ID, mediaUploadingStatus).
			Exec(c.Request().Context())
	}

	counter := &countingReader{
		reader: io.LimitReader(c.Request().Body, sizeLimit+1),
	}
	objectKey := filepath.Base(media.FilePath)
	savedPath, err := mediastore.SaveWithContentType(h.storage, objectKey, counter, media.MimeType)
	if err != nil {
		_ = h.storage.Delete(objectKey)
		resetPending()
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "failed to stream media upload"})
	}
	if counter.count > sizeLimit {
		_ = h.storage.Delete(objectKey)
		resetPending()
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{fieldError: mediaUploadSizeError(sizeLimit)})
	}
	if counter.count != media.Size {
		_ = h.storage.Delete(objectKey)
		resetPending()
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "uploaded media size does not match upload session"})
	}
	updateResult, err := h.db.NewUpdate().
		Model(&media).
		Set("file_path = ?, processing_status = ?", savedPath, mediaProcessingStatus).
		Where("id = ? AND processing_status = ?", media.ID, mediaUploadingStatus).
		Exec(c.Request().Context())
	if err != nil {
		_ = h.storage.Delete(objectKey)
		resetPending()
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: "failed to save media upload session"})
	}
	rowsAffected, err := updateResult.RowsAffected()
	if err != nil || rowsAffected != 1 {
		_ = h.storage.Delete(objectKey)
		resetPending()
		return c.JSON(http.StatusConflict, map[string]string{fieldError: "media upload session is no longer pending"})
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *MediaHandler) uploadMedia(c echo.Context) error {
	userID := c.Get(string(middleware.UserIDKey)).(string)

	workspaceID := c.FormValue("workspace_id")
	if workspaceID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: errWorkspaceIDRequired})
	}

	if ok, err := h.userCanEditWorkspace(c.Request().Context(), workspaceID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
	} else if !ok {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "file is required"})
	}

	stockProvenance, err := parseStockMediaProvenance(c.FormValue("stock_provenance"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: err.Error()})
	}

	result, err := h.processUpload(c.Request().Context(), workspaceID, fileHeader, mediaUploadBytesInput{
		AltText:          c.FormValue("alt_text"),
		Source:           c.FormValue("source"),
		AssetKind:        c.FormValue("asset_kind"),
		RetentionClass:   c.FormValue("retention_class"),
		TagID:            c.FormValue("tag_id"),
		ParentMediaID:    c.FormValue("parent_media_id"),
		DesignDocumentID: c.FormValue("design_document_id"),
		DesignPageID:     c.FormValue("design_page_id"),
		VideoProjectID:   c.FormValue("video_project_id"),
		StockProvenance:  stockProvenance,
	})
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: err.Error()})
	}

	return c.JSON(http.StatusOK, result)
}

func (h *MediaHandler) batchUploadMedia(c echo.Context) error {
	userID := c.Get(string(middleware.UserIDKey)).(string)

	workspaceID := c.FormValue("workspace_id")
	if workspaceID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: errWorkspaceIDRequired})
	}

	if ok, err := h.userCanEditWorkspace(c.Request().Context(), workspaceID, userID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
	} else if !ok {
		return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
	}

	form, err := c.MultipartForm()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "failed to parse multipart form"})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "no files provided"})
	}

	if len(files) > 10 {
		return c.JSON(http.StatusBadRequest, map[string]string{fieldError: "max 10 files at once"})
	}

	results := []map[string]interface{}{}
	uploadErrors := []string{}

	for _, fileHeader := range files {
		result, err := h.processUpload(c.Request().Context(), workspaceID, fileHeader, mediaUploadBytesInput{})
		if err != nil {
			uploadErrors = append(uploadErrors, fileHeader.Filename+": "+err.Error())
			continue
		}
		results = append(results, result)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"uploaded": results,
		"errors":   uploadErrors,
	})
}

func (h *MediaHandler) processUpload(ctx context.Context, workspaceID string, fileHeader *multipart.FileHeader, metadata mediaUploadBytesInput) (map[string]interface{}, error) {
	file, err := fileHeader.Open()
	if err != nil {
		return nil, errors.New("failed to open file")
	}
	defer file.Close()

	metadata.WorkspaceID = workspaceID
	metadata.Filename = fileHeader.Filename
	metadata.DeclaredMimeType = fileHeader.Header.Get("Content-Type")
	metadata.Size = fileHeader.Size
	source, assetKind, err := normalizeMediaProvenance(metadata.Source, metadata.AssetKind)
	if err != nil {
		return nil, err
	}
	metadata.TagID, err = h.resolveMediaUploadTag(ctx, workspaceID, metadata.TagID, assetKind)
	if err != nil {
		return nil, errors.New(err.Error())
	}
	metadata.RetentionClass, err = medialifecycle.NormalizeRetention(metadata.RetentionClass, assetKind, metadata.TagID != "")
	if err != nil {
		return nil, err
	}
	if err := validateStockUploadProvenance(source, metadata.StockProvenance); err != nil {
		return nil, err
	}
	sizeLimit := mediaUploadSizeLimit(assetKind, metadata.Filename, metadata.DeclaredMimeType)
	if metadata.Size > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if metadata.Size > MaxBufferedMediaUploadBytes {
		return h.processStreamUpload(ctx, metadata, source, assetKind, file, sizeLimit)
	}

	content, err := io.ReadAll(io.LimitReader(file, sizeLimit+1))
	if err != nil {
		return nil, errors.New("failed to read file")
	}
	if int64(len(content)) > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	metadata.Content = content
	return h.processUploadBytes(ctx, metadata)
}

//nolint:gocyclo // Streaming validation, hashing, deduplication, analysis, persistence, and usage accounting form one ordered pipeline.
func (h *MediaHandler) processStreamUpload(
	ctx context.Context,
	input mediaUploadBytesInput,
	source string,
	assetKind string,
	reader io.Reader,
	sizeLimit int64,
) (map[string]interface{}, error) {
	if input.Size <= 0 {
		return nil, errors.New("file size is invalid")
	}
	if input.Size > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if err := h.validateMediaProvenanceReferences(ctx, input.WorkspaceID, input.ParentMediaID, input.DesignDocumentID, input.DesignPageID); err != nil {
		return nil, errors.New(err.Error())
	}
	if err := h.validateVideoProjectReference(ctx, input.WorkspaceID, input.VideoProjectID); err != nil {
		return nil, errors.New(err.Error())
	}
	if !isInternalMediaAssetKind(assetKind) {
		if err := h.checkUploadQuota(ctx, input.WorkspaceID, input.Size); err != nil {
			return nil, err
		}
	}

	prefix := make([]byte, 512)
	prefixBytes, readErr := io.ReadFull(reader, prefix)
	if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return nil, errors.New("failed to read file")
	}
	prefix = prefix[:prefixBytes]
	if len(prefix) == 0 {
		return nil, errors.New("file is empty")
	}
	if err := validateMediaAssetContent(assetKind, input.Filename, input.DeclaredMimeType, prefix); err != nil {
		return nil, err
	}
	mimeType := detectedMediaMimeType(prefix, input.DeclaredMimeType)

	mediaID := uuid.New().String()
	objectKey := mediaID + filepath.Ext(input.Filename)
	counter := &countingReader{reader: io.MultiReader(bytes.NewReader(prefix), reader)}
	hasher := sha256.New()
	limited := io.LimitReader(counter, sizeLimit+1)
	savedPath, err := mediastore.SaveWithContentType(h.storage, objectKey, io.TeeReader(limited, hasher), mimeType)
	if err != nil {
		_ = h.storage.Delete(objectKey)
		return nil, errors.New("failed to save media")
	}
	if counter.count > sizeLimit {
		_ = h.storage.Delete(objectKey)
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if counter.count != input.Size {
		_ = h.storage.Delete(objectKey)
		return nil, errors.New("uploaded media size does not match multipart metadata")
	}
	fileHash := hex.EncodeToString(hasher.Sum(nil))
	if mediaSourceSupportsDeduplication(source) && assetKind == "library" {
		if existing, found, duplicateErr := h.findDuplicateMedia(ctx, input.WorkspaceID, fileHash, mediaID); duplicateErr != nil {
			_ = h.storage.Delete(objectKey)
			return nil, duplicateErr
		} else if found {
			if err := h.persistStockMediaProvenance(ctx, existing.ID, input.StockProvenance); err != nil {
				_ = h.storage.Delete(objectKey)
				return nil, err
			}
			if err := h.addMediaTag(ctx, input.TagID, existing.ID); err != nil {
				_ = h.storage.Delete(objectKey)
				return nil, errors.New(err.Error())
			}
			_ = h.storage.Delete(objectKey)
			return mediaUploadMap(existing, true), nil
		}
	}

	media := &models.MediaAttachment{
		ID:                 mediaID,
		WorkspaceID:        input.WorkspaceID,
		FilePath:           savedPath,
		StorageType:        h.storage.Driver(),
		MimeType:           mimeType,
		ProcessingStatus:   mediaReadyStatus,
		ProcessingProgress: 100,
		Size:               counter.count,
		OriginalFilename:   input.Filename,
		FileHash:           fileHash,
		AltText:            input.AltText,
		Source:             source,
		AssetKind:          assetKind,
		RetentionClass:     input.RetentionClass,
		ParentMediaID:      strings.TrimSpace(input.ParentMediaID),
		DesignDocumentID:   strings.TrimSpace(input.DesignDocumentID),
		DesignPageID:       strings.TrimSpace(input.DesignPageID),
		VideoProjectID:     strings.TrimSpace(input.VideoProjectID),
		DominantType:       dominantMediaType(mimeType),
		AnalysisStatus:     mediaanalysis.AnalysisStatusReady,
		LastUsedAt:         time.Now().UTC(),
	}
	if strings.HasPrefix(mimeType, "video/") && h.video != nil {
		media.ProcessingStatus = mediaProcessingStatus
		media.ProcessingProgress = 0
		media.AnalysisStatus = mediaanalysis.AnalysisStatusPending
	}

	if _, err := h.db.NewInsert().Model(media).Exec(ctx); err != nil {
		if mediaSourceSupportsDeduplication(source) && assetKind == "library" {
			if existing, found, duplicateErr := h.findDuplicateMedia(ctx, input.WorkspaceID, fileHash, media.ID); duplicateErr == nil && found {
				_ = h.storage.Delete(objectKey)
				if provenanceErr := h.persistStockMediaProvenance(ctx, existing.ID, input.StockProvenance); provenanceErr != nil {
					return nil, provenanceErr
				}
				if tagErr := h.addMediaTag(ctx, input.TagID, existing.ID); tagErr != nil {
					return nil, errors.New(tagErr.Error())
				}
				return mediaUploadMap(existing, true), nil
			}
		}
		_ = h.storage.Delete(objectKey)
		return nil, errors.New("failed to save media record")
	}
	if err := h.addMediaTag(ctx, input.TagID, media.ID); err != nil {
		_, _ = h.db.NewDelete().Model(media).WherePK().Exec(ctx)
		_ = h.storage.Delete(objectKey)
		return nil, errors.New(err.Error())
	}
	if err := h.persistStockMediaProvenance(ctx, media.ID, input.StockProvenance); err != nil {
		_, _ = h.db.NewDelete().Model((*models.MediaAttachment)(nil)).Where("id = ?", media.ID).Exec(ctx)
		_ = h.storage.Delete(objectKey)
		return nil, errors.New("failed to save stock media provenance")
	}
	if err := refreshPublicMediaState(ctx, h.db, h.publicMedia, media); err != nil {
		log.Printf("failed to persist public URL verification for media %s: %v", media.ID, err)
	}
	if strings.HasPrefix(mimeType, "video/") && h.video != nil {
		h.enqueueVideoAnalysis(ctx, media.ID)
	}
	if !isInternalMediaAssetKind(assetKind) {
		if _, err := h.usage.IncrementMonthly(ctx, input.WorkspaceID, entitlements.LimitMediaBytesUploadedMonthly, media.Size, time.Now().UTC()); err != nil {
			return nil, errors.New("failed to record media upload usage")
		}
	}
	return mediaUploadMap(*media, false), nil
}

//nolint:gocyclo // Upload validation, analysis, storage, and deduplication form one ordered pipeline.
func (h *MediaHandler) processUploadBytes(ctx context.Context, input mediaUploadBytesInput) (map[string]interface{}, error) {
	if input.Size < 0 {
		return nil, errors.New("file size is invalid")
	}
	if int64(len(input.Content)) != input.Size {
		input.Size = int64(len(input.Content))
	}

	source, assetKind, err := normalizeMediaProvenance(input.Source, input.AssetKind)
	if err != nil {
		return nil, err
	}
	input.TagID, err = h.resolveMediaUploadTag(ctx, input.WorkspaceID, input.TagID, assetKind)
	if err != nil {
		return nil, errors.New(err.Error())
	}
	input.RetentionClass, err = medialifecycle.NormalizeRetention(input.RetentionClass, assetKind, input.TagID != "")
	if err != nil {
		return nil, err
	}
	sizeLimit := mediaUploadSizeLimit(assetKind, input.Filename, input.DeclaredMimeType)
	if input.Size > sizeLimit {
		return nil, errors.New(mediaUploadSizeError(sizeLimit))
	}
	if err := validateMediaAssetContent(assetKind, input.Filename, input.DeclaredMimeType, input.Content); err != nil {
		return nil, err
	}
	if err := h.validateMediaProvenanceReferences(ctx, input.WorkspaceID, input.ParentMediaID, input.DesignDocumentID, input.DesignPageID); err != nil {
		return nil, errors.New(err.Error())
	}
	if err := h.validateVideoProjectReference(ctx, input.WorkspaceID, input.VideoProjectID); err != nil {
		return nil, errors.New(err.Error())
	}
	hash := sha256.Sum256(input.Content)
	fileHash := hex.EncodeToString(hash[:])

	mimeType := http.DetectContentType(input.Content)
	if strings.HasPrefix(mimeType, defaultMediaMimeType) {
		mimeType = input.DeclaredMimeType
		if mimeType == "" {
			mimeType = defaultMediaMimeType
		}
	}

	var existing models.MediaAttachment
	if mediaSourceSupportsDeduplication(source) && assetKind == "library" {
		err = h.db.NewSelect().Model(&existing).
			Where("workspace_id = ? AND file_hash = ? AND (asset_kind = ? OR asset_kind = '' OR asset_kind IS NULL)", input.WorkspaceID, fileHash, "library").
			Scan(ctx)
		if err == nil {
			if err := h.persistStockMediaProvenance(ctx, existing.ID, input.StockProvenance); err != nil {
				return nil, err
			}
			if err := h.addMediaTag(ctx, input.TagID, existing.ID); err != nil {
				return nil, errors.New(err.Error())
			}
			return mediaUploadMap(existing, true), nil
		}
	}
	if !isInternalMediaAssetKind(assetKind) {
		if err := h.checkUploadQuota(ctx, input.WorkspaceID, input.Size); err != nil {
			return nil, err
		}
	}

	mediaID := uuid.New().String()
	ext := filepath.Ext(input.Filename)
	filename := mediaID + ext

	savedPath, err := mediastore.SaveWithContentType(h.storage, filename, bytes.NewReader(input.Content), mimeType)
	if err != nil {
		return nil, errors.New("failed to save media")
	}

	media := &models.MediaAttachment{
		ID:                 mediaID,
		WorkspaceID:        input.WorkspaceID,
		FilePath:           savedPath,
		StorageType:        h.storage.Driver(),
		MimeType:           mimeType,
		ProcessingStatus:   mediaReadyStatus,
		ProcessingProgress: 100,
		Size:               input.Size,
		OriginalFilename:   input.Filename,
		FileHash:           fileHash,
		AltText:            input.AltText,
		Source:             source,
		AssetKind:          assetKind,
		RetentionClass:     input.RetentionClass,
		ParentMediaID:      strings.TrimSpace(input.ParentMediaID),
		DesignDocumentID:   strings.TrimSpace(input.DesignDocumentID),
		DesignPageID:       strings.TrimSpace(input.DesignPageID),
		VideoProjectID:     strings.TrimSpace(input.VideoProjectID),
		LastUsedAt:         time.Now().UTC(),
	}

	width, height := 0, 0
	var thumbnails Thumbnails

	if strings.HasPrefix(mimeType, "image/") {
		width, height, thumbnails, err = h.processImage(input.Content, mediaID, mimeType)
		if err != nil {
			width, height = h.getImageDimensions(bytes.NewReader(input.Content), mimeType)
		}
		media.Width = width
		media.Height = height
		if thumbsJSON, err := json.Marshal(thumbnails); err == nil {
			media.ThumbnailsJSON = string(thumbsJSON)
		}
	}
	media.DominantType = dominantMediaType(mimeType)
	media.AspectRatio = mediaAspectRatio(media.Width, media.Height)
	media.AnalysisStatus = mediaanalysis.AnalysisStatusReady
	if strings.HasPrefix(mimeType, "video/") && h.video != nil {
		media.ProcessingStatus = mediaProcessingStatus
		media.ProcessingProgress = 0
		media.AnalysisStatus = mediaanalysis.AnalysisStatusPending
	}

	if _, err := h.db.NewInsert().Model(media).Exec(ctx); err != nil {
		if mediaSourceSupportsDeduplication(source) && assetKind == "library" {
			if existing, found, duplicateErr := h.findDuplicateMedia(ctx, input.WorkspaceID, fileHash, media.ID); duplicateErr == nil && found {
				if deleteErr := h.deleteMediaFiles(media); deleteErr != nil {
					log.Printf("failed to delete deduplicated upload files for %s: %v", media.ID, deleteErr)
				}
				if provenanceErr := h.persistStockMediaProvenance(ctx, existing.ID, input.StockProvenance); provenanceErr != nil {
					return nil, provenanceErr
				}
				if tagErr := h.addMediaTag(ctx, input.TagID, existing.ID); tagErr != nil {
					return nil, errors.New(tagErr.Error())
				}
				return mediaUploadMap(existing, true), nil
			}
		}
		if deleteErr := h.deleteMediaFiles(media); deleteErr != nil {
			log.Printf("failed to delete media files after record insertion failure for %s: %v", media.ID, deleteErr)
		}
		return nil, errors.New("failed to save media record")
	}
	if input.OnCreated != nil {
		input.OnCreated(*media)
	}
	if err := h.addMediaTag(ctx, input.TagID, media.ID); err != nil {
		_, _ = h.db.NewDelete().Model(media).WherePK().Exec(ctx)
		if deleteErr := h.deleteMediaFiles(media); deleteErr != nil {
			log.Printf("failed to delete media after tag assignment failure for %s: %v", media.ID, deleteErr)
		}
		return nil, errors.New(err.Error())
	}
	if err := h.persistStockMediaProvenance(ctx, media.ID, input.StockProvenance); err != nil {
		_, _ = h.db.NewDelete().Model((*models.MediaAttachment)(nil)).Where("id = ?", media.ID).Exec(ctx)
		if deleteErr := h.deleteMediaFiles(media); deleteErr != nil {
			log.Printf("failed to delete media after provenance persistence failure for %s: %v", media.ID, deleteErr)
		}
		return nil, errors.New("failed to save stock media provenance")
	}
	if err := refreshPublicMediaState(ctx, h.db, h.publicMedia, media); err != nil {
		log.Printf("failed to persist public URL verification for media %s: %v", media.ID, err)
	}
	if strings.HasPrefix(mimeType, "video/") {
		h.enqueueVideoAnalysis(ctx, media.ID)
	}
	if !isInternalMediaAssetKind(assetKind) {
		if _, err := h.usage.IncrementMonthly(ctx, input.WorkspaceID, entitlements.LimitMediaBytesUploadedMonthly, input.Size, time.Now().UTC()); err != nil {
			return nil, errors.New("failed to record media upload usage")
		}
	}

	return mediaUploadMap(*media, false), nil
}

func (h *MediaHandler) checkUploadQuota(ctx context.Context, workspaceID string, size int64) error {
	return h.checkUploadQuotaExcludingMedia(ctx, workspaceID, size, "")
}

func (h *MediaHandler) checkUploadQuotaExcludingMedia(ctx context.Context, workspaceID string, size int64, excludeMediaID string) error {
	uploaded, err := h.usage.CurrentMonthly(ctx, workspaceID, entitlements.LimitMediaBytesUploadedMonthly, time.Now().UTC())
	if err != nil {
		return errors.New("failed to load upload usage")
	}
	if err := h.checkQuota(ctx, workspaceID, entitlements.LimitMediaBytesUploadedMonthly, uploaded, size); err != nil {
		return err
	}

	var stored int64
	storedQuery := h.db.NewSelect().
		Model((*models.MediaAttachment)(nil)).
		ColumnExpr("COALESCE(SUM(size), 0)").
		Where("workspace_id = ?", workspaceID).
		Where("(asset_kind NOT IN (?, ?) OR asset_kind = '' OR asset_kind IS NULL)", "design_preview", "template_preview")
	if excludeMediaID != "" {
		storedQuery = storedQuery.Where("id != ?", excludeMediaID)
	}
	if err := storedQuery.Scan(ctx, &stored); err != nil {
		return errors.New("failed to load stored media usage")
	}
	return h.checkQuota(ctx, workspaceID, entitlements.LimitMediaBytesStored, stored, size)
}

func (h *MediaHandler) checkQuota(ctx context.Context, workspaceID string, limit entitlements.LimitKey, current, amount int64) error {
	decision, err := h.quota.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID,
		Limit:       limit,
		Current:     current,
		Amount:      amount,
	})
	if err != nil {
		return errors.New("failed to check quota")
	}
	if !decision.Allowed {
		if decision.Reason != "" {
			return errors.New(decision.Reason)
		}
		return errors.New("quota exceeded")
	}
	return nil
}

func (h *MediaHandler) processImage(content []byte, mediaID, mimeType string) (int, int, Thumbnails, error) {
	reader := bytes.NewReader(content)

	var img image.Image
	var err error

	switch strings.ToLower(mimeType) {
	case "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/tiff":
		img, err = imaging.Decode(reader)
	default:
		return 0, 0, Thumbnails{}, errors.New("unsupported image format")
	}

	if err != nil {
		return 0, 0, Thumbnails{}, err
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	thumbnails := Thumbnails{}

	smThumb := imaging.Thumbnail(img, ThumbnailSizeSM, ThumbnailSizeSM, imaging.Lanczos)
	smFilename := "sm_" + mediaID + ".jpg"
	if err := h.saveThumbnail(smFilename, smThumb, imaging.JPEG); err == nil {
		thumbnails.SM = smFilename
	}

	mdThumb := imaging.Thumbnail(img, ThumbnailSizeMD, ThumbnailSizeMD, imaging.Lanczos)
	mdFilename := "md_" + mediaID + ".jpg"
	if err := h.saveThumbnail(mdFilename, mdThumb, imaging.JPEG); err == nil {
		thumbnails.MD = mdFilename
	}

	return width, height, thumbnails, nil
}

func (h *MediaHandler) saveThumbnail(filename string, img image.Image, format imaging.Format) error {
	var buf bytes.Buffer
	if err := imaging.Encode(&buf, img, format); err != nil {
		return err
	}
	_, err := mediastore.SaveWithContentType(h.storage, filename, &buf, "image/jpeg")
	return err
}

func (h *MediaHandler) getImageDimensions(reader io.Reader, _ string) (int, int) {
	config, _, err := image.DecodeConfig(reader)
	if err != nil {
		return 0, 0
	}
	return config.Width, config.Height
}

func (h *MediaHandler) serveMedia(c echo.Context) error {
	mediaID := c.Param("id")

	// Strip file extension if present (e.g., "abc123.jpg" -> "abc123")
	// Media IDs in the database are UUIDs without extensions, but Threads
	// requires URLs with extensions for content-type detection.
	if dotIdx := strings.LastIndex(mediaID, "."); dotIdx > 0 {
		mediaID = mediaID[:dotIdx]
	}

	media := new(models.MediaAttachment)
	if err := h.db.NewSelect().Model(media).Where("id = ?", mediaID).Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
	}
	if err := h.authorizeMediaAccess(c, media); err != nil {
		return err
	}
	if !media.TrashedAt.IsZero() {
		return c.JSON(http.StatusGone, map[string]string{fieldError: "media was deleted"})
	}

	file, err := h.storage.Open(filepath.Base(media.FilePath))
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "media file not found"})
	}
	defer file.Close()

	c.Response().Header().Set("Content-Type", media.MimeType)
	if f, ok := file.(*os.File); ok {
		if stat, err := f.Stat(); err == nil {
			http.ServeContent(c.Response(), c.Request(), stat.Name(), stat.ModTime(), f)
			return nil
		}
	}

	return c.Stream(http.StatusOK, media.MimeType, file)
}

func (h *MediaHandler) serveThumbnailSize(c echo.Context) error {
	mediaID := c.Param("id")

	// Strip file extension if present (e.g., "abc123.jpg" -> "abc123")
	if dotIdx := strings.LastIndex(mediaID, "."); dotIdx > 0 {
		mediaID = mediaID[:dotIdx]
	}

	size := c.Param("size")
	if size == "" {
		size = "md"
	}

	media := new(models.MediaAttachment)
	if err := h.db.NewSelect().Model(media).Where("id = ?", mediaID).Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
	}
	if err := h.authorizeMediaAccess(c, media); err != nil {
		return err
	}
	if !media.TrashedAt.IsZero() {
		return c.JSON(http.StatusGone, map[string]string{fieldError: "media was deleted"})
	}

	var thumbs Thumbnails
	if media.ThumbnailsJSON != "" {
		_ = json.Unmarshal([]byte(media.ThumbnailsJSON), &thumbs)
	}

	var thumbFilename string
	switch size {
	case "sm":
		thumbFilename = thumbs.SM
	case "md":
		thumbFilename = thumbs.MD
	default:
		thumbFilename = thumbs.MD
	}

	if thumbFilename == "" {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "thumbnail not found"})
	}

	file, err := h.storage.Open(thumbFilename)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "thumbnail file not found"})
	}
	defer file.Close()

	if f, ok := file.(*os.File); ok {
		if stat, err := f.Stat(); err == nil {
			c.Response().Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
		}
	}

	c.Response().Header().Set("Content-Type", "image/jpeg")
	return c.Stream(http.StatusOK, "image/jpeg", file)
}

func (h *MediaHandler) serveVideoPoster(c echo.Context) error {
	mediaID := c.Param("id")
	if dotIdx := strings.LastIndex(mediaID, "."); dotIdx > 0 {
		mediaID = mediaID[:dotIdx]
	}
	media := new(models.MediaAttachment)
	if err := h.db.NewSelect().Model(media).Where("id = ?", mediaID).Scan(c.Request().Context()); err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
	}
	if err := h.authorizeMediaAccess(c, media); err != nil {
		return err
	}
	if !media.TrashedAt.IsZero() {
		return c.JSON(http.StatusGone, map[string]string{fieldError: "media was deleted"})
	}
	if strings.TrimSpace(media.ThumbnailObjectKey) == "" {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "video poster not found"})
	}
	file, err := h.storage.Open(media.ThumbnailObjectKey)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: "video poster file not found"})
	}
	defer file.Close()
	c.Response().Header().Set("Content-Type", "image/jpeg")
	if f, ok := file.(*os.File); ok {
		if stat, statErr := f.Stat(); statErr == nil {
			http.ServeContent(c.Response(), c.Request(), stat.Name(), stat.ModTime(), f)
			return nil
		}
	}
	return c.Stream(http.StatusOK, "image/jpeg", file)
}

func (h *MediaHandler) optionalMediaAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			_, cookieErr := c.Cookie("openpost_session")
			if (authHeader != "" || cookieErr == nil) && h.authn != nil {
				return middleware.BearerMiddleware(h.authn)(next)(c)
			}
			if authHeader != "" && h.auth != nil {
				return middleware.JWTMiddleware(h.auth)(next)(c)
			}
			return next(c)
		}
	}
}

func (h *MediaHandler) authorizeMediaAccess(c echo.Context, media *models.MediaAttachment) error {
	if media == nil {
		return c.JSON(http.StatusNotFound, map[string]string{fieldError: errMediaNotFound})
	}

	if userID, _ := c.Get(string(middleware.UserIDKey)).(string); userID != "" {
		allowed, err := h.userCanAccessWorkspace(c.Request().Context(), media.WorkspaceID, userID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
		}
		if !allowed {
			return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
		}
		setCredentialMediaCache(c)
		return nil
	}

	if token := c.QueryParam("token"); token != "" {
		principal, err := h.principalFromQueryToken(c.Request().Context(), token)
		if errors.Is(err, errMediaQueryTokenScope) {
			return c.JSON(http.StatusForbidden, map[string]string{fieldError: "token is not authorized for media access"})
		}
		if err == nil && principal != nil {
			middleware.AttachPrincipal(c, principal)
			allowed, accessErr := h.userCanAccessWorkspace(c.Request().Context(), media.WorkspaceID, principal.UserID)
			if accessErr != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{fieldError: errValidateWorkspaceAccess})
			}
			if allowed {
				setCredentialMediaCache(c)
				return nil
			}
			return c.JSON(http.StatusForbidden, map[string]string{fieldError: errWorkspaceAccessDenied})
		}
	}

	expiresAtUnix, _ := strconv.ParseInt(c.QueryParam("exp"), 10, 64)
	signature := c.QueryParam("sig")
	if signature == "" || h.signer == nil || !h.signer.Verify(media.ID, signature, expiresAtUnix) {
		return c.JSON(http.StatusUnauthorized, map[string]string{fieldError: "authentication required"})
	}

	remainingSeconds := expiresAtUnix - time.Now().UTC().Unix()
	if remainingSeconds < 0 {
		remainingSeconds = 0
	}
	c.Response().Header().Set("Cache-Control", "public, max-age="+strconv.FormatInt(remainingSeconds, 10))
	return nil
}

var errMediaQueryTokenScope = errors.New("query token scope cannot access media")

func (h *MediaHandler) principalFromQueryToken(ctx context.Context, token string) (*middleware.Principal, error) {
	if h.authn != nil {
		principal, err := h.authn.AuthenticateBearer(ctx, token)
		if err != nil || principal == nil {
			return nil, err
		}
		if !middleware.PrincipalCanAccessREST(principal) {
			return nil, errMediaQueryTokenScope
		}
		return principal, nil
	}
	if h.auth != nil {
		claims, err := h.auth.ValidateToken(token)
		if err == nil && claims != nil {
			return &middleware.Principal{
				UserID: claims.UserID, Email: claims.Email, SessionID: claims.SessionID,
			}, nil
		}
		return nil, err
	}
	return nil, errors.New("media authentication is unavailable")
}

func setCredentialMediaCache(c echo.Context) {
	header := c.Response().Header()
	header.Set("Cache-Control", "private, max-age=86400")
	appendVaryHeaders(header, echo.HeaderAuthorization, echo.HeaderCookie)
}

func appendVaryHeaders(header http.Header, fields ...string) {
	existingValues := header.Values(echo.HeaderVary)
	capacity := len(existingValues) + len(fields)
	values := make([]string, 0, capacity)
	seen := make(map[string]struct{}, capacity)
	appendValue := func(value string) bool {
		value = strings.TrimSpace(value)
		if value == "" {
			return false
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			return false
		}
		seen[key] = struct{}{}
		values = append(values, value)
		return value == "*"
	}

	for _, existing := range existingValues {
		for _, value := range strings.Split(existing, ",") {
			if appendValue(value) {
				header.Set(echo.HeaderVary, "*")
				return
			}
		}
	}
	for _, field := range fields {
		if appendValue(field) {
			header.Set(echo.HeaderVary, "*")
			return
		}
	}
	if len(values) > 0 {
		header.Set(echo.HeaderVary, strings.Join(values, ", "))
	}
}

func (h *MediaHandler) userCanAccessWorkspace(ctx context.Context, workspaceID, userID string) (bool, error) {
	return middleware.CheckWorkspaceAccess(ctx, h.db, workspaceID, userID)
}

func (h *MediaHandler) userCanEditWorkspace(ctx context.Context, workspaceID, userID string) (bool, error) {
	return middleware.CheckWorkspaceEditAccess(ctx, h.db, workspaceID, userID)
}
