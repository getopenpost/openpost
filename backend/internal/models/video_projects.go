package models

import (
	"time"

	"github.com/uptrace/bun"
)

const (
	VideoProjectSyncPending        = "pending"
	VideoProjectSyncUploading      = "uploading"
	VideoProjectSyncSaving         = "saving"
	VideoProjectSyncSynced         = "synced"
	VideoProjectSyncNeedsAttention = "needs_attention"

	ProjectAssetStatusPending      = "pending"
	ProjectAssetStatusUploading    = "uploading"
	ProjectAssetStatusReady        = "ready"
	ProjectAssetStatusNeedsStorage = "needs_storage"
	ProjectAssetStatusFailed       = "failed"
)

type VideoProject struct {
	bun.BaseModel `bun:"table:video_projects"`

	ID                 string    `bun:",pk" json:"id"`
	WorkspaceID        string    `bun:"workspace_id,notnull" json:"workspace_id"`
	Name               string    `bun:",notnull" json:"name"`
	HeadRevision       int64     `bun:"head_revision,notnull,default:1" json:"head_revision"`
	DocumentJSON       string    `bun:"document_json,notnull" json:"-"`
	SyncStatus         string    `bun:"sync_status,notnull,default:'pending'" json:"sync_status"`
	AttentionReason    string    `bun:"attention_reason,notnull,default:''" json:"attention_reason,omitempty"`
	PreviewObjectKey   string    `bun:"preview_object_key,notnull,default:''" json:"preview_object_key,omitempty"`
	CreatedByUserID    string    `bun:"created_by_user_id,notnull" json:"created_by_user_id"`
	UpdatedByUserID    string    `bun:"updated_by_user_id,notnull" json:"updated_by_user_id"`
	TrashedAt          time.Time `bun:"trashed_at,nullzero" json:"trashed_at,omitempty"`
	RetentionExpiresAt time.Time `bun:"retention_expires_at,nullzero" json:"retention_expires_at,omitempty"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type VideoProjectRevision struct {
	bun.BaseModel `bun:"table:video_project_revisions"`

	ID                 string    `bun:",pk" json:"id"`
	ProjectID          string    `bun:"project_id,notnull" json:"project_id"`
	Revision           int64     `bun:",notnull" json:"revision"`
	ParentRevision     int64     `bun:"parent_revision,notnull,default:0" json:"parent_revision"`
	Kind               string    `bun:",notnull" json:"kind"`
	DocumentJSON       string    `bun:"document_json,notnull" json:"-"`
	TouchedTargetsJSON string    `bun:"touched_targets_json,notnull,default:'[]'" json:"-"`
	AuthorUserID       string    `bun:"author_user_id,notnull" json:"author_user_id"`
	DeviceID           string    `bun:"device_id,notnull,default:''" json:"device_id,omitempty"`
	MutationID         string    `bun:"mutation_id,notnull,default:''" json:"mutation_id,omitempty"`
	RestoredFrom       int64     `bun:"restored_from_revision,notnull,default:0" json:"restored_from_revision,omitempty"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	ExpiresAt          time.Time `bun:"expires_at,nullzero" json:"expires_at,omitempty"`
}

type VideoProjectMutation struct {
	bun.BaseModel `bun:"table:video_project_mutations"`

	ProjectID  string    `bun:"project_id,pk" json:"project_id"`
	MutationID string    `bun:"mutation_id,pk" json:"mutation_id"`
	Outcome    string    `bun:",notnull" json:"outcome"`
	Revision   int64     `bun:",notnull,default:0" json:"revision,omitempty"`
	ConflictID string    `bun:"conflict_id,notnull,default:''" json:"conflict_id,omitempty"`
	CreatedAt  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type VideoProjectConflict struct {
	bun.BaseModel `bun:"table:video_project_conflicts"`

	ID                 string    `bun:",pk" json:"id"`
	ProjectID          string    `bun:"project_id,notnull" json:"project_id"`
	Name               string    `bun:",notnull" json:"name"`
	BaseRevision       int64     `bun:"base_revision,notnull" json:"base_revision"`
	HeadRevision       int64     `bun:"head_revision,notnull" json:"head_revision"`
	MutationID         string    `bun:"mutation_id,notnull" json:"mutation_id"`
	DocumentJSON       string    `bun:"document_json,notnull" json:"-"`
	OverlapTargetsJSON string    `bun:"overlap_targets_json,notnull" json:"-"`
	AuthorUserID       string    `bun:"author_user_id,notnull" json:"author_user_id"`
	DeviceID           string    `bun:"device_id,notnull,default:''" json:"device_id,omitempty"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	ResolvedAt         time.Time `bun:"resolved_at,nullzero" json:"resolved_at,omitempty"`
}

type VideoProjectCheckpoint struct {
	bun.BaseModel `bun:"table:video_project_checkpoints"`

	ID              string    `bun:",pk" json:"id"`
	ProjectID       string    `bun:"project_id,notnull" json:"project_id"`
	Name            string    `bun:",notnull" json:"name"`
	Revision        int64     `bun:",notnull" json:"revision"`
	CreatedByUserID string    `bun:"created_by_user_id,notnull" json:"created_by_user_id"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	DeletedAt       time.Time `bun:"deleted_at,nullzero" json:"deleted_at,omitempty"`
}

type ProjectAsset struct {
	bun.BaseModel `bun:"table:project_assets"`

	ID               string    `bun:",pk" json:"id"`
	ProjectID        string    `bun:"project_id,notnull" json:"project_id"`
	WorkspaceID      string    `bun:"workspace_id,notnull" json:"workspace_id"`
	MediaID          string    `bun:"media_id,nullzero" json:"media_id,omitempty"`
	StableMediaID    string    `bun:"stable_media_id,notnull" json:"stable_media_id"`
	OriginalFilename string    `bun:"original_filename,notnull" json:"original_filename"`
	MimeType         string    `bun:"mime_type,notnull" json:"mime_type"`
	Size             int64     `bun:",notnull,default:0" json:"size"`
	SHA256           string    `bun:"sha256,notnull,default:''" json:"sha256,omitempty"`
	Status           string    `bun:",notnull,default:'pending'" json:"status"`
	AttentionReason  string    `bun:"attention_reason,notnull,default:''" json:"attention_reason,omitempty"`
	PreparationJSON  string    `bun:"preparation_json,notnull,default:'{}'" json:"-"`
	Required         bool      `bun:",notnull,default:true" json:"required"`
	UploadedByUserID string    `bun:"uploaded_by_user_id,notnull" json:"uploaded_by_user_id"`
	DeviceID         string    `bun:"device_id,notnull,default:''" json:"device_id,omitempty"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}
