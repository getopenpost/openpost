package models

import (
	"time"

	"github.com/uptrace/bun"
)

// AnalyticsAccountSnapshot is an immutable provider measurement. MetricsJSON
// contains only normalized integers and MetricMetadataJSON preserves their
// meaning; provider responses and tokens are never retained.
type AnalyticsAccountSnapshot struct {
	bun.BaseModel `bun:"table:analytics_account_snapshots"`

	ID                 string    `bun:",pk" json:"id"`
	WorkspaceID        string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SocialAccountID    string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform           string    `bun:",notnull" json:"platform"`
	MetricsJSON        string    `bun:"metrics_json,notnull,default:'{}'" json:"metrics_json"`
	MetricMetadataJSON string    `bun:"metric_metadata_json,notnull,default:'{}'" json:"metric_metadata_json"`
	CaptureKey         string    `bun:"capture_key,notnull,default:''" json:"-"`
	CapturedAt         time.Time `bun:"captured_at,notnull" json:"captured_at"`
}

// AnalyticsRenditionSnapshot stores normalized metrics for one provider
// rendition. Thread segment counters are normalized into the rendition total.
type AnalyticsRenditionSnapshot struct {
	bun.BaseModel `bun:"table:analytics_rendition_snapshots"`

	ID                 string    `bun:",pk" json:"id"`
	WorkspaceID        string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID      string    `bun:"publication_id,notnull" json:"publication_id"`
	RenditionID        string    `bun:"rendition_id,notnull" json:"rendition_id"`
	SocialAccountID    string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform           string    `bun:",notnull" json:"platform"`
	MetricsJSON        string    `bun:"metrics_json,notnull,default:'{}'" json:"metrics_json"`
	MetricMetadataJSON string    `bun:"metric_metadata_json,notnull,default:'{}'" json:"metric_metadata_json"`
	CaptureKey         string    `bun:"capture_key,notnull,default:''" json:"-"`
	CapturedAt         time.Time `bun:"captured_at,notnull" json:"captured_at"`
}

// AnalyticsSyncState is the latest collection state for an account or
// rendition. SubjectID is namespaced by SubjectType through the primary ID.
type AnalyticsSyncState struct {
	bun.BaseModel `bun:"table:analytics_sync_states"`

	ID                 string    `bun:",pk" json:"id"`
	WorkspaceID        string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SubjectType        string    `bun:"subject_type,notnull" json:"subject_type"`
	SubjectID          string    `bun:"subject_id,notnull" json:"subject_id"`
	SocialAccountID    string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform           string    `bun:",notnull" json:"platform"`
	Status             string    `bun:",notnull,default:'pending'" json:"status"`
	ErrorCode          string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorMessage       string    `bun:"error_message,notnull,default:''" json:"error_message"`
	MetricsJSON        string    `bun:"metrics_json,notnull,default:'{}'" json:"metrics_json"`
	MetricMetadataJSON string    `bun:"metric_metadata_json,notnull,default:'{}'" json:"metric_metadata_json"`
	LastAttemptedAt    time.Time `bun:"last_attempted_at,nullzero" json:"last_attempted_at"`
	LastSuccessAt      time.Time `bun:"last_success_at,nullzero" json:"last_success_at"`
	NextSyncAt         time.Time `bun:"next_sync_at,nullzero" json:"next_sync_at"`
	UnchangedStreak    int       `bun:"unchanged_streak,notnull,default:0" json:"unchanged_streak"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

const (
	GrowthRecommendationFollowIdle      = "idle"
	GrowthRecommendationFollowPending   = "pending"
	GrowthRecommendationFollowFollowing = "following"
	GrowthRecommendationFollowRequested = "requested"
	GrowthRecommendationFollowFailed    = "failed"
)

const (
	GrowthSyncStatusIdle                   = "idle"
	GrowthSyncStatusQueued                 = "queued"
	GrowthSyncStatusRefreshing             = "refreshing"
	GrowthSyncStatusOK                     = "ok"
	GrowthSyncStatusPermissionRequired     = "permission_required"
	GrowthSyncStatusRateLimited            = "rate_limited"
	GrowthSyncStatusTemporarilyUnavailable = "temporarily_unavailable"
	GrowthSyncStatusFailed                 = "failed"
)

type GrowthRecommendation struct {
	bun.BaseModel `bun:"table:growth_recommendations"`

	ID                 string    `bun:",pk" json:"id"`
	WorkspaceID        string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SocialAccountID    string    `bun:"social_account_id,notnull,unique:growth_account_remote" json:"social_account_id"`
	Platform           string    `bun:",notnull" json:"platform"`
	RemoteAccountID    string    `bun:"remote_account_id,notnull,unique:growth_account_remote" json:"remote_account_id"`
	Handle             string    `bun:",notnull,default:''" json:"handle"`
	DisplayName        string    `bun:"display_name,notnull,default:''" json:"display_name"`
	Bio                string    `bun:",notnull,default:''" json:"bio"`
	AvatarURL          string    `bun:"avatar_url,notnull,default:''" json:"avatar_url"`
	ProfileURL         string    `bun:"profile_url,notnull,default:''" json:"profile_url"`
	FollowersCount     int       `bun:"followers_count,notnull,default:0" json:"followers_count"`
	FollowingCount     int       `bun:"following_count,notnull,default:0" json:"following_count"`
	MutualCount        int       `bun:"mutual_count,notnull,default:0" json:"mutual_count"`
	MutualsJSON        string    `bun:"mutuals_json,notnull,default:'[]'" json:"-"`
	MutualExact        bool      `bun:"mutual_exact,notnull,default:false" json:"mutual_exact"`
	FollowsViewer      bool      `bun:"follows_viewer,notnull,default:false" json:"follows_viewer"`
	SignalsJSON        string    `bun:"signals_json,notnull,default:'[]'" json:"-"`
	Score              float64   `bun:"score,notnull,default:0" json:"score"`
	GenerationID       string    `bun:"generation_id,notnull" json:"generation_id"`
	DismissedAt        time.Time `bun:"dismissed_at,nullzero" json:"dismissed_at,omitempty"`
	FollowState        string    `bun:"follow_state,notnull,default:'idle'" json:"follow_state"`
	FollowErrorCode    string    `bun:"follow_error_code,notnull,default:''" json:"follow_error_code,omitempty"`
	FollowErrorMessage string    `bun:"follow_error_message,notnull,default:''" json:"follow_error_message,omitempty"`
	LastSeenAt         time.Time `bun:"last_seen_at,notnull" json:"last_seen_at"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type GrowthSyncState struct {
	bun.BaseModel `bun:"table:growth_sync_states"`

	ID                  string    `bun:",pk" json:"id"`
	WorkspaceID         string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SocialAccountID     string    `bun:"social_account_id,notnull,unique" json:"social_account_id"`
	Platform            string    `bun:",notnull" json:"platform"`
	Status              string    `bun:",notnull,default:'idle'" json:"status"`
	ErrorCode           string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorMessage        string    `bun:"error_message,notnull,default:''" json:"error_message"`
	CurrentGenerationID string    `bun:"current_generation_id,notnull,default:''" json:"current_generation_id"`
	LastAttemptedAt     time.Time `bun:"last_attempted_at,nullzero" json:"last_attempted_at,omitempty"`
	LastSuccessAt       time.Time `bun:"last_success_at,nullzero" json:"last_success_at,omitempty"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}
