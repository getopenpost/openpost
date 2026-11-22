package models

import (
	"time"

	"github.com/uptrace/bun"
)

type MediaAttachment struct {
	bun.BaseModel `bun:"table:media_attachments"`

	ID                 string    `bun:",pk" json:"id"`
	WorkspaceID        string    `bun:",notnull" json:"workspace_id"`
	FilePath           string    `bun:",notnull" json:"file_path"`
	StorageType        string    `bun:",default:'local'" json:"storage_type"` // 'local', 's3'
	MimeType           string    `json:"mime_type"`
	ProcessingStatus   string    `bun:",default:'ready'" json:"processing_status"` // 'processing', 'ready', 'failed'
	Size               int64     `json:"size"`
	OriginalFilename   string    `json:"original_filename"`
	Width              int       `json:"width"`
	Height             int       `json:"height"`
	DurationMS         int64     `bun:"duration_ms,notnull,default:0" json:"duration_ms"`
	FrameRate          float64   `bun:"frame_rate,notnull,default:0" json:"frame_rate"`
	AspectRatio        string    `bun:"aspect_ratio,notnull,default:''" json:"aspect_ratio"`
	ContainerFormat    string    `bun:"container_format,notnull,default:''" json:"container_format"`
	VideoCodec         string    `bun:"video_codec,notnull,default:''" json:"video_codec"`
	VideoProfile       string    `bun:"video_profile,notnull,default:''" json:"video_profile"`
	AudioCodec         string    `bun:"audio_codec,notnull,default:''" json:"audio_codec"`
	PixelFormat        string    `bun:"pixel_format,notnull,default:''" json:"pixel_format"`
	ColorSpace         string    `bun:"color_space,notnull,default:''" json:"color_space"`
	BitRate            int64     `bun:"bit_rate,notnull,default:0" json:"bit_rate"`
	Rotation           int       `bun:"rotation,notnull,default:0" json:"rotation"`
	AudioChannels      int       `bun:"audio_channels,notnull,default:0" json:"audio_channels"`
	ProcessingProgress int       `bun:"processing_progress,notnull,default:0" json:"processing_progress"`
	DominantType       string    `bun:"dominant_type,notnull,default:''" json:"dominant_type"`
	AnalysisStatus     string    `bun:"analysis_status,notnull,default:'ready'" json:"analysis_status"`
	AnalysisError      string    `bun:"analysis_error,notnull,default:''" json:"analysis_error"`
	ThumbnailObjectKey string    `bun:"thumbnail_object_key,notnull,default:''" json:"thumbnail_object_key"`
	PublicURLReady     bool      `bun:"public_url_ready,notnull,default:false" json:"public_url_ready"`
	PublicURLCheckedAt time.Time `bun:"public_url_checked_at,nullzero" json:"public_url_checked_at"`
	PublicURLStatus    int       `bun:"public_url_status,notnull,default:0" json:"public_url_status"`
	PublicURLError     string    `bun:"public_url_error,notnull,default:''" json:"public_url_error"`
	ThumbnailsJSON     string    `bun:"thumbnails" json:"thumbnails"` // JSON: {"sm": "sm_xxx.jpg", "md": "md_xxx.jpg"}
	FileHash           string    `json:"-"`                           // SHA-256, unique within a workspace
	Source             string    `bun:",notnull,default:'upload'" json:"source"`
	AssetKind          string    `bun:"asset_kind,notnull,default:'library'" json:"asset_kind"`
	ParentMediaID      string    `bun:"parent_media_id,nullzero" json:"parent_media_id,omitempty"`
	DesignDocumentID   string    `bun:"design_document_id,nullzero" json:"design_document_id,omitempty"`
	DesignPageID       string    `bun:"design_page_id,nullzero" json:"design_page_id,omitempty"`
	AltText            string    `json:"alt_text"`
	IsFavorite         bool      `bun:",default:false" json:"is_favorite"`
	RetentionClass     string    `bun:"retention_class,notnull,default:'library'" json:"retention_class"`
	LastUsedAt         time.Time `bun:"last_used_at,nullzero" json:"last_used_at,omitempty"`
	TrashedAt          time.Time `bun:"trashed_at,nullzero" json:"trashed_at,omitempty"`
	PurgeAfter         time.Time `bun:"purge_after,nullzero" json:"purge_after,omitempty"`
	TrashReason        string    `bun:"trash_reason,notnull,default:''" json:"trash_reason,omitempty"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// MediaGenerationRecipe keeps the structured inputs used to create a media
// attachment. Generated media stays immutable: editing a recipe creates a new
// attachment and recipe, while ParentMediaID links it to the prior result.
type MediaGenerationRecipe struct {
	bun.BaseModel `bun:"table:media_generation_recipes"`

	MediaID           string    `bun:"media_id,pk" json:"media_id"`
	WorkspaceID       string    `bun:"workspace_id,notnull" json:"workspace_id"`
	CreatedByID       string    `bun:"created_by_id,nullzero" json:"created_by_id,omitempty"`
	Kind              string    `bun:",notnull" json:"kind"`
	RendererKey       string    `bun:"renderer_key,notnull" json:"renderer_key"`
	TemplateID        string    `bun:"template_id,notnull" json:"template_id"`
	TemplateName      string    `bun:"template_name,notnull,default:''" json:"template_name"`
	TemplateSourceURL string    `bun:"template_source_url,notnull,default:''" json:"template_source_url,omitempty"`
	CatalogRevision   string    `bun:"catalog_revision,notnull,default:''" json:"catalog_revision,omitempty"`
	RecipeJSON        string    `bun:"recipe_json,notnull" json:"recipe_json"`
	CreatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// DesignDocument is the persisted Image Editor document head. Its pages are stored
// separately so saving or loading a large multi-page design remains bounded.
type DesignDocument struct {
	bun.BaseModel `bun:"table:design_documents"`

	ID                  string    `bun:",pk" json:"id"`
	WorkspaceID         string    `bun:",notnull" json:"workspace_id"`
	CreatedByID         string    `bun:"created_by_id,notnull" json:"created_by_id"`
	Title               string    `bun:",notnull" json:"title"`
	SchemaVersion       int       `bun:"schema_version,notnull,default:1" json:"schema_version"`
	Revision            int       `bun:",notnull,default:1" json:"revision"`
	PresetKey           string    `bun:"preset_key,notnull,default:''" json:"preset_key"`
	WidthPX             int       `bun:"width_px,notnull" json:"width_px"`
	HeightPX            int       `bun:"height_px,notnull" json:"height_px"`
	BrandKitID          string    `bun:"brand_kit_id,nullzero" json:"brand_kit_id,omitempty"`
	BrandKitRevision    int       `bun:"brand_kit_revision,notnull,default:0" json:"brand_kit_revision"`
	ExportFormat        string    `bun:"export_format,notnull,default:'png'" json:"export_format"`
	ExportQuality       float64   `bun:"export_quality,notnull,default:0.92" json:"export_quality"`
	ExportMatteColor    string    `bun:"export_matte_color,notnull,default:'#ffffff'" json:"export_matte_color"`
	SourceMediaID       string    `bun:"source_media_id,nullzero" json:"-"`
	CoverPreviewMediaID string    `bun:"cover_preview_media_id,nullzero" json:"cover_preview_media_id,omitempty"`
	IsFavorite          bool      `bun:"is_favorite,notnull,default:false" json:"is_favorite"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
	DeletedAt           time.Time `bun:",nullzero" json:"deleted_at,omitempty"`
}

type DesignPage struct {
	bun.BaseModel `bun:"table:design_pages"`

	ID                  string    `bun:",pk" json:"id"`
	DesignDocumentID    string    `bun:"design_document_id,notnull" json:"design_document_id"`
	Name                string    `bun:",notnull" json:"name"`
	DisplayOrder        int       `bun:"display_order,notnull" json:"display_order"`
	BackgroundColor     string    `bun:"background_color,notnull,default:'#ffffff'" json:"background_color"`
	BackgroundJSON      string    `bun:"background_json,notnull,default:'{}'" json:"-"`
	SceneJSON           string    `bun:"scene_json,notnull,default:'[]'" json:"scene_json"`
	PreviewMediaID      string    `bun:"preview_media_id,nullzero" json:"preview_media_id,omitempty"`
	LatestExportMediaID string    `bun:"latest_export_media_id,nullzero" json:"latest_export_media_id,omitempty"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type DesignRevision struct {
	bun.BaseModel `bun:"table:design_revisions"`

	ID               string    `bun:",pk" json:"id"`
	DesignDocumentID string    `bun:"design_document_id,notnull" json:"design_document_id"`
	Revision         int       `bun:",notnull" json:"revision"`
	Kind             string    `bun:",notnull" json:"kind"`
	Name             string    `bun:",notnull,default:''" json:"name"`
	Snapshot         []byte    `bun:",notnull" json:"-"`
	CreatedByID      string    `bun:"created_by_id,notnull" json:"created_by_id"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	ExpiresAt        time.Time `bun:",nullzero" json:"expires_at,omitempty"`
}

type DesignRevisionMediaReference struct {
	bun.BaseModel `bun:"table:design_revision_media_references"`

	RevisionID string    `bun:"revision_id,pk" json:"revision_id"`
	MediaID    string    `bun:"media_id,pk" json:"media_id"`
	Usage      string    `bun:",notnull,default:'snapshot'" json:"usage"`
	CreatedAt  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type DesignRevisionMediaIndexState struct {
	bun.BaseModel `bun:"table:design_revision_media_index_state"`

	RevisionID        string    `bun:"revision_id,pk" json:"revision_id"`
	MediaCount        int       `bun:"media_count,notnull,default:0" json:"media_count"`
	MissingMediaCount int       `bun:"missing_media_count,notnull,default:0" json:"missing_media_count"`
	Status            string    `bun:",notnull,default:'complete'" json:"status"`
	FailureCode       string    `bun:"failure_code,notnull,default:''" json:"failure_code,omitempty"`
	ProcessedAt       time.Time `bun:"processed_at,nullzero,notnull,default:current_timestamp" json:"processed_at"`
}

type DesignMediaReference struct {
	bun.BaseModel `bun:"table:design_media_references"`

	DesignDocumentID string    `bun:"design_document_id,pk" json:"design_document_id"`
	DesignPageID     string    `bun:"design_page_id,pk" json:"design_page_id"`
	MediaID          string    `bun:"media_id,pk" json:"media_id"`
	Usage            string    `bun:",notnull,default:'layer'" json:"usage"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type DesignReturnToken struct {
	bun.BaseModel `bun:"table:design_return_tokens"`

	ID              string    `bun:",pk" json:"id"`
	TokenHash       string    `bun:",notnull,unique" json:"-"`
	WorkspaceID     string    `bun:",notnull" json:"workspace_id"`
	UserID          string    `bun:",notnull" json:"user_id"`
	ReturnURL       string    `bun:",notnull" json:"return_url"`
	Purpose         string    `bun:",notnull" json:"purpose"`
	MaxSelection    int       `bun:",notnull" json:"max_selection"`
	ConstraintsJSON string    `bun:"constraints_json,notnull" json:"constraints_json"`
	ResultMediaIDs  string    `bun:"result_media_ids,notnull" json:"result_media_ids"`
	DesignID        string    `bun:"design_id" json:"design_id"`
	CreatedAt       time.Time `bun:",notnull,default:current_timestamp" json:"created_at"`
	ExpiresAt       time.Time `bun:",notnull" json:"expires_at"`
	CompletedAt     time.Time `bun:"completed_at,nullzero" json:"completed_at,omitempty"`
	ConsumedAt      time.Time `bun:"consumed_at,nullzero" json:"consumed_at,omitempty"`
}

type MediaProvenance struct {
	bun.BaseModel `bun:"table:media_provenance"`

	MediaID         string    `bun:"media_id,pk" json:"media_id"`
	Provider        string    `bun:",notnull" json:"provider"`
	ExternalID      string    `bun:"external_id,notnull" json:"external_id"`
	SourceURL       string    `bun:"source_url,notnull" json:"source_url"`
	CreatorName     string    `bun:"creator_name,notnull,default:''" json:"creator_name"`
	CreatorURL      string    `bun:"creator_url,notnull,default:''" json:"creator_url"`
	LicenseName     string    `bun:"license_name,notnull,default:''" json:"license_name"`
	LicenseURL      string    `bun:"license_url,notnull,default:''" json:"license_url"`
	AttributionText string    `bun:"attribution_text,notnull,default:''" json:"attribution_text"`
	ImportedAt      time.Time `bun:"imported_at,notnull,default:current_timestamp" json:"imported_at"`
}

type StockSearchCache struct {
	bun.BaseModel `bun:"table:stock_search_cache"`

	Provider               string    `bun:",pk" json:"provider"`
	MediaKind              string    `bun:"media_kind,pk" json:"media_kind"`
	QueryHash              string    `bun:"query_hash,pk" json:"query_hash"`
	NormalizedResponseJSON string    `bun:"normalized_response_json,notnull" json:"-"`
	ExpiresAt              time.Time `bun:",notnull" json:"expires_at"`
	CreatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type DesignTemplate struct {
	bun.BaseModel `bun:"table:design_templates"`

	ID             string    `bun:",pk" json:"id"`
	WorkspaceID    string    `bun:",notnull" json:"workspace_id"`
	CreatedByID    string    `bun:"created_by_id,notnull" json:"created_by_id"`
	Name           string    `bun:",notnull" json:"name"`
	Category       string    `bun:",notnull,default:''" json:"category"`
	PresetKey      string    `bun:"preset_key,notnull,default:''" json:"preset_key"`
	SchemaVersion  int       `bun:"schema_version,notnull,default:1" json:"schema_version"`
	SnapshotJSON   string    `bun:"snapshot_json,notnull" json:"snapshot_json"`
	PreviewMediaID string    `bun:"preview_media_id,nullzero" json:"preview_media_id,omitempty"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type DesignTemplateMediaReference struct {
	bun.BaseModel `bun:"table:design_template_media_references"`

	DesignTemplateID string    `bun:"design_template_id,pk" json:"design_template_id"`
	MediaID          string    `bun:"media_id,pk" json:"media_id"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type BrandKit struct {
	bun.BaseModel `bun:"table:brand_kits"`

	ID              string    `bun:",pk" json:"id"`
	WorkspaceID     string    `bun:",unique,notnull" json:"workspace_id"`
	Name            string    `bun:",notnull,default:'Workspace brand'" json:"name"`
	Revision        int       `bun:",notnull,default:1" json:"revision"`
	ColorsJSON      string    `bun:"colors_json,notnull,default:'[]'" json:"colors_json"`
	TextStylesJSON  string    `bun:"text_styles_json,notnull,default:'{}'" json:"text_styles_json"`
	BackgroundsJSON string    `bun:"backgrounds_json,notnull,default:'[]'" json:"backgrounds_json"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type BrandFont struct {
	bun.BaseModel `bun:"table:brand_fonts"`

	ID                    string    `bun:",pk" json:"id"`
	BrandKitID            string    `bun:"brand_kit_id,notnull" json:"brand_kit_id"`
	MediaID               string    `bun:"media_id,notnull" json:"media_id"`
	Family                string    `bun:",notnull" json:"family"`
	Weight                int       `bun:",notnull,default:400" json:"weight"`
	Style                 string    `bun:",notnull,default:'normal'" json:"style"`
	LicenseAcknowledgedBy string    `bun:"license_acknowledged_by,notnull" json:"license_acknowledged_by"`
	LicenseAcknowledgedAt time.Time `bun:"license_acknowledged_at,notnull" json:"license_acknowledged_at"`
	CreatedAt             time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type MediaCollection struct {
	bun.BaseModel `bun:"table:media_collections"`

	ID          string    `bun:",pk" json:"id"`
	WorkspaceID string    `bun:",notnull" json:"workspace_id"`
	Name        string    `bun:",notnull" json:"name"`
	Color       string    `bun:",notnull,default:''" json:"color"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type MediaCollectionItem struct {
	bun.BaseModel `bun:"table:media_collection_items"`

	CollectionID string    `bun:"collection_id,pk" json:"collection_id"`
	MediaID      string    `bun:"media_id,pk" json:"media_id"`
	CreatedAt    time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type MediaTag struct {
	bun.BaseModel `bun:"table:media_tags"`

	ID             string    `bun:",pk" json:"id"`
	WorkspaceID    string    `bun:",notnull" json:"workspace_id"`
	Name           string    `bun:",notnull" json:"name"`
	NormalizedName string    `bun:"normalized_name,notnull" json:"normalized_name"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type MediaTagAssignment struct {
	bun.BaseModel `bun:"table:media_tag_assignments"`

	TagID     string    `bun:"tag_id,pk" json:"tag_id"`
	MediaID   string    `bun:"media_id,pk" json:"media_id"`
	CreatedAt time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}
