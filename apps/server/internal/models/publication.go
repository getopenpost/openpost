package models

import (
	"time"

	"github.com/uptrace/bun"
)

// Publication is the user's canonical unit of intent: one idea, launch,
// update, or announcement that can produce platform-specific posts.
type Publication struct {
	bun.BaseModel `bun:"table:publications"`

	ID             string `bun:",pk" json:"id"`
	WorkspaceID    string `bun:",notnull" json:"workspace_id"`
	CreatedByID    string `bun:"created_by,notnull" json:"created_by"`
	Title          string `bun:",notnull" json:"title"`
	Intent         string `bun:"intent,notnull,default:'post'" json:"intent"`
	CreationPreset string `bun:"creation_preset,notnull,default:'post'" json:"creation_preset"`
	CreationSource string `bun:"creation_source,notnull,default:'unknown'" json:"creation_source"`
	SocialSetID    string `bun:"social_set_id,notnull,default:''" json:"social_set_id,omitempty"`
	ContentProfile string `bun:"content_profile,notnull,default:'short_text'" json:"content_profile"`
	SourceText     string `bun:"source_text,notnull,default:''" json:"source_text"`
	SourceContent  string `bun:"source_content,notnull" json:"source_content"` // legacy mirror until old post flows are removed
	SourceURL      string `bun:"source_url" json:"source_url"`
	Goal           string `json:"goal"`
	Audience       string `json:"audience"`
	Status         string `bun:",notnull,default:'draft'" json:"status"`
	Revision       int    `bun:",notnull,default:1" json:"revision"`
	ReviewID       string `bun:"review_id,notnull,default:''" json:"review_id,omitempty"`
	ReviewEpoch    int    `bun:"review_epoch,notnull,default:0" json:"review_epoch,omitempty"`
	ReviewState    string `bun:"review_state,notnull,default:''" json:"review_state,omitempty"`

	ScheduledAt         time.Time `bun:"scheduled_at,nullzero" json:"scheduled_at"`
	ActualRunAt         time.Time `bun:"actual_run_at,nullzero" json:"actual_run_at"`
	FailureDismissedAt  time.Time `bun:"failure_dismissed_at,nullzero" json:"failure_dismissed_at"`
	RandomDelayMinutes  int       `bun:"random_delay_minutes,notnull,default:0" json:"random_delay_minutes"`
	RandomDelayExplicit bool      `bun:"random_delay_explicit,notnull,default:false" json:"-"`
	MetadataJSON        string    `bun:"metadata_json,notnull,default:'{}'" json:"metadata_json"`
	ReleasePlanJSON     string    `bun:"release_plan_json,notnull,default:'{}'" json:"release_plan_json"` // legacy mirror until old post flows are removed
	RepostOverride      string    `bun:"repost_override_json,notnull,default:'{}'" json:"repost_override_json"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// SocialSet is a reusable, format-independent collection of connected accounts.
// Publications copy its current membership into renditions when a draft is created.
type SocialSet struct {
	bun.BaseModel `bun:"table:social_sets"`

	ID          string    `bun:",pk" json:"id"`
	WorkspaceID string    `bun:"workspace_id,notnull" json:"workspace_id"`
	Name        string    `bun:",notnull" json:"name"`
	IsDefault   bool      `bun:"is_default,notnull,default:false" json:"is_default"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// SocialSetAccount stores membership and defaults for new rendition snapshots.
// Updates never change existing publications.
type SocialSetAccount struct {
	bun.BaseModel `bun:"table:social_set_accounts"`

	SocialSetID                string    `bun:"social_set_id,pk" json:"social_set_id"`
	SocialAccountID            string    `bun:"social_account_id,pk" json:"social_account_id"`
	DisplayOrder               int       `bun:"display_order,notnull,default:0" json:"display_order"`
	DefaultOutputProfile       string    `bun:"default_output_profile,notnull,default:''" json:"default_output_profile,omitempty"`
	DefaultSettingsJSON        string    `bun:"default_settings_json,notnull,default:'{}'" json:"-"`
	DefaultSegmentSettingsJSON string    `bun:"default_segment_settings_json,notnull,default:'{}'" json:"-"`
	CreatedAt                  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// RepostPolicy is a workspace-owned rule that turns a published rendition into
// a native provider repost after its time and engagement gates are satisfied.
type RepostPolicy struct {
	bun.BaseModel `bun:"table:repost_policies"`

	ID                      string    `bun:",pk" json:"id"`
	WorkspaceID             string    `bun:"workspace_id,notnull" json:"workspace_id"`
	Name                    string    `bun:",notnull" json:"name"`
	Enabled                 bool      `bun:",notnull" json:"enabled"`
	DelaySeconds            int       `bun:"delay_seconds,notnull,default:86400" json:"delay_seconds"`
	EvaluationWindowSeconds int       `bun:"evaluation_window_seconds,notnull,default:604800" json:"evaluation_window_seconds"`
	ThresholdMode           string    `bun:"threshold_mode,notnull,default:'all'" json:"threshold_mode"`
	MinLikes                int64     `bun:"min_likes,notnull,default:0" json:"min_likes"`
	MinComments             int64     `bun:"min_comments,notnull,default:0" json:"min_comments"`
	MinReposts              int64     `bun:"min_reposts,notnull,default:0" json:"min_reposts"`
	MinViews                int64     `bun:"min_views,notnull,default:0" json:"min_views"`
	RequirePlateau          bool      `bun:"require_plateau,notnull,default:false" json:"require_plateau"`
	PlateauChecks           int       `bun:"plateau_checks,notnull,default:2" json:"plateau_checks"`
	StagesJSON              string    `bun:"stages_json,notnull,default:'[]'" json:"stages_json"`
	CreatedByID             string    `bun:"created_by,notnull" json:"created_by"`
	UpdatedByID             string    `bun:"updated_by,notnull" json:"updated_by"`
	CreatedAt               time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt               time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// RepostPolicyAccount assigns source and target accounts to a policy. Empty
// source assignments mean every compatible source account in the workspace.
type RepostPolicyAccount struct {
	bun.BaseModel `bun:"table:repost_policy_accounts"`

	PolicyID        string `bun:"policy_id,pk" json:"policy_id"`
	SocialAccountID string `bun:"social_account_id,pk" json:"social_account_id"`
	Role            string `bun:",pk" json:"role"`
}

// RepostAccountGrant explicitly permits one workspace to use an account owned
// by another workspace as a repost target. The target workspace can revoke it.
type RepostAccountGrant struct {
	bun.BaseModel `bun:"table:repost_account_grants"`

	ID                string    `bun:",pk" json:"id"`
	SourceWorkspaceID string    `bun:"source_workspace_id,notnull" json:"source_workspace_id"`
	TargetWorkspaceID string    `bun:"target_workspace_id,notnull" json:"target_workspace_id"`
	TargetAccountID   string    `bun:"target_account_id,notnull" json:"target_account_id"`
	CreatedByID       string    `bun:"created_by,notnull" json:"created_by"`
	RevokedByID       string    `bun:"revoked_by,nullzero" json:"revoked_by,omitempty"`
	RevokedAt         time.Time `bun:"revoked_at,nullzero" json:"revoked_at,omitempty"`
	CreatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// RepostExecution is the durable state machine for one source rendition and
// target account. The rule snapshot makes in-flight behavior auditable and
// independent from later settings edits.
type RepostExecution struct {
	bun.BaseModel `bun:"table:repost_executions"`

	ID               string    `bun:",pk" json:"id"`
	WorkspaceID      string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID    string    `bun:"publication_id,notnull" json:"publication_id"`
	RenditionID      string    `bun:"rendition_id,notnull,unique:rendition_target" json:"rendition_id"`
	SourceAccountID  string    `bun:"source_account_id,notnull" json:"source_account_id"`
	TargetAccountID  string    `bun:"target_account_id,notnull,unique:rendition_target" json:"target_account_id"`
	PolicyID         string    `bun:"policy_id,nullzero" json:"policy_id,omitempty"`
	RuleSnapshotJSON string    `bun:"rule_snapshot_json,notnull,default:'{}'" json:"rule_snapshot_json"`
	Status           string    `bun:",notnull,default:'pending'" json:"status"`
	CurrentStage     int       `bun:"current_stage,notnull,default:1" json:"current_stage"`
	TotalStages      int       `bun:"total_stages,notnull,default:1" json:"total_stages"`
	UnrepostAttempts int       `bun:"unrepost_attempts,notnull,default:0" json:"unrepost_attempts"`
	StageHistoryJSON string    `bun:"stage_history_json,notnull,default:'[]'" json:"stage_history_json"`
	EligibleAfter    time.Time `bun:"eligible_after,notnull" json:"eligible_after"`
	DeadlineAt       time.Time `bun:"deadline_at,notnull" json:"deadline_at"`
	NextCheckAt      time.Time `bun:"next_check_at,nullzero" json:"next_check_at"`
	CheckCount       int       `bun:"check_count,notnull,default:0" json:"check_count"`
	LastMetricsJSON  string    `bun:"last_metrics_json,notnull,default:'{}'" json:"last_metrics_json"`
	ExternalID       string    `bun:"external_id,notnull,default:''" json:"external_id,omitempty"`
	ExternalURL      string    `bun:"external_url,notnull,default:''" json:"external_url,omitempty"`
	ErrorCode        string    `bun:"error_code,notnull,default:''" json:"error_code,omitempty"`
	ErrorMessage     string    `bun:"error_message,notnull,default:''" json:"error_message,omitempty"`
	CompletedAt      time.Time `bun:"completed_at,nullzero" json:"completed_at,omitempty"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// PublicationSegment is an ordered canonical content unit. A post has one
// segment; a thread and follow-up sequence can have many.
type PublicationSegment struct {
	bun.BaseModel `bun:"table:publication_segments"`

	ID            string    `bun:",pk" json:"id"`
	PublicationID string    `bun:"publication_id,notnull" json:"publication_id"`
	Position      int       `bun:"position,notnull,default:0" json:"position"`
	Body          string    `bun:"body,notnull,default:''" json:"body"`
	Title         string    `bun:"title,notnull,default:''" json:"title"`
	Description   string    `bun:"description,notnull,default:''" json:"description"`
	URL           string    `bun:"url,notnull,default:''" json:"url"`
	SettingsJSON  string    `bun:"settings_json,notnull,default:'{}'" json:"settings_json"`
	CreatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type PublicationSegmentMedia struct {
	bun.BaseModel `bun:"table:publication_segment_media"`

	SegmentID            string `bun:"segment_id,pk" json:"segment_id"`
	MediaID              string `bun:"media_id,pk" json:"media_id"`
	Role                 string `bun:"role,notnull,default:'attachment'" json:"role"`
	DisplayOrder         int    `bun:"display_order,notnull,default:0" json:"display_order"`
	AltText              string `bun:"alt_text,notnull,default:''" json:"alt_text"`
	ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms,notnull,default:0" json:"thumbnail_timestamp_ms"`
	SettingsJSON         string `bun:"settings_json,notnull,default:'{}'" json:"settings_json"`
}

type Rendition struct {
	bun.BaseModel `bun:"table:renditions"`

	Position         int       `bun:"position,notnull,default:0" json:"-"`
	ID               string    `bun:",pk" json:"id"`
	PublicationID    string    `bun:"publication_id,notnull" json:"publication_id"`
	SocialAccountID  string    `bun:"social_account_id,notnull" json:"social_account_id"`
	TargetKey        string    `bun:"target_key,notnull" json:"target_key"`
	Platform         string    `bun:",notnull" json:"platform"`
	Profile          string    `bun:",notnull" json:"profile"`
	OutputProfile    string    `bun:"output_profile,notnull,default:''" json:"output_profile"`
	FormatLocked     bool      `bun:"format_locked,notnull,default:false" json:"format_locked"`
	ScheduleOverride time.Time `bun:"schedule_override,nullzero" json:"schedule_override,omitempty"`
	Body             string    `bun:",notnull,default:''" json:"body"`
	Title            string    `bun:",notnull,default:''" json:"title"`
	Description      string    `bun:",notnull,default:''" json:"description"`
	SettingsJSON     string    `bun:"settings_json,notnull,default:'{}'" json:"settings_json"`
	Status           string    `bun:",notnull,default:'draft'" json:"status"`
	ExternalID       string    `bun:"external_id" json:"external_id"`
	ExternalURL      string    `bun:"external_url" json:"external_url"`
	ErrorMessage     string    `bun:"error_message" json:"error_message"`
	ErrorKind        string    `bun:"error_kind,notnull,default:''" json:"error_kind"`
	ErrorCode        string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorHTTPStatus  int       `bun:"error_http_status,notnull,default:0" json:"error_http_status"`
	ErrorRetryable   bool      `bun:"error_retryable,notnull,default:false" json:"error_retryable"`
	ErrorRetryAt     time.Time `bun:"error_retry_at,nullzero" json:"error_retry_at"`
	ErrorAction      string    `bun:"error_action,notnull,default:''" json:"error_action"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type RenditionSegment struct {
	bun.BaseModel `bun:"table:rendition_segments"`

	ID                   string    `bun:",pk" json:"id"`
	RenditionID          string    `bun:"rendition_id,notnull" json:"rendition_id"`
	PublicationSegmentID string    `bun:"publication_segment_id,notnull" json:"publication_segment_id"`
	Position             int       `bun:"position,notnull,default:0" json:"position"`
	Body                 string    `bun:"body,notnull,default:''" json:"body"`
	Title                string    `bun:"title,notnull,default:''" json:"title"`
	Description          string    `bun:"description,notnull,default:''" json:"description"`
	URL                  string    `bun:"url,notnull,default:''" json:"url"`
	BodyOverride         *string   `bun:"body_override" json:"body_override,omitempty"`
	TitleOverride        *string   `bun:"title_override" json:"title_override,omitempty"`
	DescriptionOverride  *string   `bun:"description_override" json:"description_override,omitempty"`
	URLOverride          *string   `bun:"url_override" json:"url_override,omitempty"`
	MediaInherited       bool      `bun:"media_inherited,notnull,default:true" json:"media_inherited"`
	SourceOverridesJSON  string    `bun:"source_overrides_json,notnull,default:'[]'" json:"source_overrides_json"`
	SettingsJSON         string    `bun:"settings_json,notnull,default:'{}'" json:"settings_json"`
	Status               string    `bun:"status,notnull,default:'draft'" json:"status"`
	ExternalID           string    `bun:"external_id,notnull,default:''" json:"external_id"`
	ExternalURL          string    `bun:"external_url,notnull,default:''" json:"external_url"`
	ErrorMessage         string    `bun:"error_message,notnull,default:''" json:"error_message"`
	ErrorKind            string    `bun:"error_kind,notnull,default:''" json:"error_kind"`
	ErrorCode            string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorHTTPStatus      int       `bun:"error_http_status,notnull,default:0" json:"error_http_status"`
	ErrorRetryable       bool      `bun:"error_retryable,notnull,default:false" json:"error_retryable"`
	ErrorRetryAt         time.Time `bun:"error_retry_at,nullzero" json:"error_retry_at"`
	ErrorAction          string    `bun:"error_action,notnull,default:''" json:"error_action"`
	CreatedAt            time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt            time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type RenditionSegmentMedia struct {
	bun.BaseModel `bun:"table:rendition_segment_media"`

	RenditionSegmentID   string `bun:"rendition_segment_id,pk" json:"rendition_segment_id"`
	MediaID              string `bun:"media_id,pk" json:"media_id"`
	Role                 string `bun:"role,notnull,default:'attachment'" json:"role"`
	DisplayOrder         int    `bun:"display_order,notnull,default:0" json:"display_order"`
	AltText              string `bun:"alt_text,notnull,default:''" json:"alt_text"`
	ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms,notnull,default:0" json:"thumbnail_timestamp_ms"`
	SettingsJSON         string `bun:"settings_json,notnull,default:'{}'" json:"settings_json"`
}

type RenditionMedia struct {
	bun.BaseModel `bun:"table:rendition_media"`

	RenditionID          string `bun:"rendition_id,pk" json:"rendition_id"`
	MediaID              string `bun:"media_id,pk" json:"media_id"`
	Role                 string `bun:",notnull,default:'attachment'" json:"role"`
	DisplayOrder         int    `bun:"display_order,notnull,default:0" json:"display_order"`
	AltText              string `bun:"alt_text" json:"alt_text"`
	ThumbnailTimestampMS int    `bun:"thumbnail_timestamp_ms,notnull,default:0" json:"thumbnail_timestamp_ms"`
}

// ImportedPost is the read-only library inventory of native posts authored
// outside OpenPost. It is owned by the post-import surface, never by
// analytics: analytics reads publications and renditions only, so imported
// rows cannot clutter analytics views. Origin is always "external"; rows are
// never published, repurposed, or measured.
type ImportedPost struct {
	bun.BaseModel `bun:"table:imported_posts"`

	ID               string    `bun:",pk" json:"id"`
	WorkspaceID      string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SocialAccountID  string    `bun:"social_account_id,notnull,unique:imported_post_identity" json:"social_account_id"`
	Platform         string    `bun:",notnull" json:"platform"`
	ProviderPostID   string    `bun:"provider_post_id,notnull,unique:imported_post_identity" json:"provider_post_id"`
	ProviderParentID string    `bun:"provider_parent_id,notnull,default:''" json:"provider_parent_id,omitempty"`
	Title            string    `bun:",notnull,default:''" json:"title,omitempty"`
	Text             string    `bun:",notnull,default:''" json:"text"`
	ExternalURL      string    `bun:"external_url,notnull,default:''" json:"external_url,omitempty"`
	PublishedAt      time.Time `bun:"published_at,notnull" json:"published_at"`
	Origin           string    `bun:",notnull,default:'external'" json:"origin"`
	FirstSeenAt      time.Time `bun:"first_seen_at,notnull" json:"first_seen_at"`
	LastSeenAt       time.Time `bun:"last_seen_at,notnull" json:"last_seen_at"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// PostImportState is the mutable per-account checkpoint for bounded,
// resumable native-post imports. A row exists only after explicit opt-in;
// enabling sets the watermark to now so activation never backfills history.
type PostImportState struct {
	bun.BaseModel `bun:"table:post_import_states"`

	ID                string    `bun:",pk" json:"id"`
	WorkspaceID       string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SocialAccountID   string    `bun:"social_account_id,notnull,unique" json:"social_account_id"`
	Platform          string    `bun:",notnull" json:"platform"`
	Enabled           bool      `bun:",notnull,default:true" json:"enabled"`
	Status            string    `bun:",notnull,default:'partial'" json:"status"`
	Cursor            string    `bun:",notnull,default:''" json:"-"`
	ImportWatermark   time.Time `bun:"import_watermark,nullzero" json:"import_watermark,omitempty"`
	CycleStartedAt    time.Time `bun:"cycle_started_at,nullzero" json:"-"`
	InitialFinishedAt time.Time `bun:"initial_finished_at,nullzero" json:"initial_finished_at,omitempty"`
	InitialItemsSeen  int       `bun:"initial_items_seen,notnull,default:0" json:"initial_items_seen"`
	ReadBudgetStart   time.Time `bun:"read_budget_start,nullzero" json:"-"`
	ReadBudgetUsed    int       `bun:"read_budget_used,notnull,default:0" json:"-"`
	LastAttemptedAt   time.Time `bun:"last_attempted_at,nullzero" json:"last_attempted_at,omitempty"`
	LastSuccessAt     time.Time `bun:"last_success_at,nullzero" json:"last_success_at,omitempty"`
	FailureCode       string    `bun:"failure_code,notnull,default:''" json:"failure_code,omitempty"`
	FailureMessage    string    `bun:"failure_message,notnull,default:''" json:"failure_message,omitempty"`
	NextEligibleAt    time.Time `bun:"next_eligible_at,nullzero" json:"next_eligible_at,omitempty"`
	CreatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type PublicationLifecycleEvent struct {
	bun.BaseModel `bun:"table:publication_lifecycle_events"`

	ID             string    `bun:",pk" json:"id"`
	WorkspaceID    string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID  string    `bun:"publication_id,notnull" json:"publication_id"`
	RenditionID    string    `bun:"rendition_id,notnull,default:''" json:"rendition_id"`
	Type           string    `bun:"column:type,notnull" json:"type"`
	Status         string    `bun:"status,notnull,default:'info'" json:"status"`
	Message        string    `bun:"message,notnull,default:''" json:"message"`
	MetadataJSON   string    `bun:"metadata_json,notnull,default:'{}'" json:"metadata_json"`
	IdempotencyKey string    `bun:"idempotency_key,notnull,default:''" json:"idempotency_key"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// PublicationAuthorization is an append-only proof of the exact publication
// revision and destination payload that an actor allowed OpenPost to send. The
// three hashes deliberately replace content, media metadata, and provider
// settings; plaintext payloads and credentials must never be stored here.
type PublicationAuthorization struct {
	bun.BaseModel `bun:"table:publication_authorizations"`

	ID                  string    `bun:",pk" json:"id"`
	BatchID             string    `bun:"batch_id,notnull" json:"batch_id"`
	JobID               string    `bun:"job_id,notnull,default:''" json:"job_id,omitempty"`
	WorkspaceID         string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID       string    `bun:"publication_id,notnull" json:"publication_id"`
	RenditionID         string    `bun:"rendition_id,notnull" json:"rendition_id"`
	Action              string    `bun:",notnull" json:"action"`
	ActorOrigin         string    `bun:"actor_origin,notnull" json:"actor_origin"`
	ActorUserID         string    `bun:"actor_user_id,notnull,default:''" json:"-"`
	ActorSessionID      string    `bun:"actor_session_id,notnull,default:''" json:"-"`
	ActorTokenID        string    `bun:"actor_token_id,notnull,default:''" json:"-"`
	ActorClientID       string    `bun:"actor_client_id,notnull,default:''" json:"-"`
	ActorClientName     string    `bun:"actor_client_name,notnull,default:''" json:"-"`
	PublicationRevision int       `bun:"publication_revision,notnull" json:"publication_revision"`
	SocialAccountID     string    `bun:"social_account_id,notnull" json:"social_account_id"`
	TargetKey           string    `bun:"target_key,notnull" json:"target_key"`
	ScheduledAt         time.Time `bun:"scheduled_at,notnull" json:"scheduled_at"`
	ContentHash         string    `bun:"content_hash,notnull" json:"-"`
	MediaHash           string    `bun:"media_hash,notnull" json:"-"`
	SettingsHash        string    `bun:"settings_hash,notnull" json:"-"`
	PolicyMode          string    `bun:"policy_mode,notnull" json:"policy_mode"`
	ProviderPolicyMode  string    `bun:"provider_policy_mode,notnull,default:'provider.unspecified'" json:"provider_policy_mode"`
	ExecutionIntent     string    `bun:"execution_intent,notnull,default:'production'" json:"execution_intent"`
	ConfirmedAt         time.Time `bun:"confirmed_at,notnull" json:"confirmed_at"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// ProviderWriteAttempt is the durable fence around one externally visible
// provider mutation. It stores only normalized state, provider-issued IDs, and
// a one-way payload fingerprint. Content, raw provider responses, bearer
// values, and credential-bearing URLs must never be persisted here.
type PublicationAlias struct {
	bun.BaseModel `bun:"table:publication_aliases"`

	AliasType     string    `bun:"alias_type,pk" json:"alias_type"`
	AliasID       string    `bun:"alias_id,pk" json:"alias_id"`
	PublicationID string    `bun:"publication_id,notnull" json:"publication_id"`
	SegmentID     string    `bun:"segment_id,notnull,default:''" json:"segment_id,omitempty"`
	CreatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type ProviderWriteAttempt struct {
	bun.BaseModel `bun:"table:provider_write_attempts"`

	ID                   string    `bun:",pk" json:"id"`
	OperationID          string    `bun:"operation_id,notnull" json:"operation_id"`
	AttemptNumber        int       `bun:"attempt_number,notnull" json:"attempt_number"`
	JobID                string    `bun:"job_id,notnull,default:''" json:"job_id,omitempty"`
	AuthorizationID      string    `bun:"authorization_id,nullzero" json:"authorization_id,omitempty"`
	WorkspaceID          string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID        string    `bun:"publication_id,nullzero" json:"publication_id,omitempty"`
	RenditionID          string    `bun:"rendition_id,nullzero" json:"rendition_id,omitempty"`
	SocialAccountID      string    `bun:"social_account_id,notnull" json:"social_account_id"`
	TargetKey            string    `bun:"target_key,notnull" json:"target_key"`
	Provider             string    `bun:",notnull" json:"provider"`
	Operation            string    `bun:",notnull" json:"operation"`
	PayloadFingerprint   string    `bun:"payload_fingerprint,notnull" json:"-"`
	Status               string    `bun:",notnull" json:"status"`
	SubmissionState      string    `bun:"submission_state,notnull" json:"submission_state"`
	ProviderState        string    `bun:"provider_state,notnull,default:''" json:"provider_state,omitempty"`
	ProviderReference    string    `bun:"provider_reference,notnull,default:''" json:"provider_reference,omitempty"`
	RetrySafety          string    `bun:"retry_safety,notnull" json:"retry_safety"`
	IdempotencyKey       string    `bun:"idempotency_key,notnull,default:''" json:"idempotency_key,omitempty"`
	IdempotencyExpiresAt time.Time `bun:"idempotency_expires_at,nullzero" json:"idempotency_expires_at,omitempty"`
	ExternalID           string    `bun:"external_id,notnull,default:''" json:"external_id,omitempty"`
	ExternalURL          string    `bun:"external_url,notnull,default:''" json:"external_url,omitempty"`
	SafeErrorClass       string    `bun:"safe_error_class,notnull,default:''" json:"safe_error_class,omitempty"`
	SafeErrorCode        string    `bun:"safe_error_code,notnull,default:''" json:"safe_error_code,omitempty"`
	ErrorHTTPStatus      int       `bun:"error_http_status,notnull,default:0" json:"error_http_status,omitempty"`
	ReconcileAfter       time.Time `bun:"reconcile_after,nullzero" json:"reconcile_after,omitempty"`
	SendingStartedAt     time.Time `bun:"sending_started_at,nullzero" json:"sending_started_at,omitempty"`
	CompletedAt          time.Time `bun:"completed_at,nullzero" json:"completed_at,omitempty"`
	CreatedAt            time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt            time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// ProviderDelivery is the current projection of one exact provider target.
// Attempts remain the immutable/fenced history; this row advances only to a
// later-created attempt, while reconciliation may update the same attempt.
type ProviderDelivery struct {
	bun.BaseModel `bun:"table:provider_deliveries"`

	ID                      string    `bun:",pk" json:"id"`
	WorkspaceID             string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID           string    `bun:"publication_id,notnull" json:"publication_id"`
	RenditionID             string    `bun:"rendition_id,notnull" json:"rendition_id"`
	SocialAccountID         string    `bun:"social_account_id,notnull" json:"social_account_id"`
	TargetKey               string    `bun:"target_key,notnull" json:"target_key"`
	Provider                string    `bun:",notnull" json:"provider"`
	State                   string    `bun:",notnull" json:"state"`
	TerminalReason          string    `bun:"terminal_reason,notnull,default:''" json:"terminal_reason,omitempty"`
	CurrentAttemptID        string    `bun:"current_attempt_id,notnull" json:"current_attempt_id"`
	CurrentAttemptNumber    int       `bun:"current_attempt_number,notnull" json:"current_attempt_number"`
	CurrentAttemptCreatedAt time.Time `bun:"current_attempt_created_at,notnull" json:"current_attempt_created_at"`
	ExternalID              string    `bun:"external_id,notnull,default:''" json:"external_id,omitempty"`
	ExternalURL             string    `bun:"external_url,notnull,default:''" json:"external_url,omitempty"`
	RetrySafety             string    `bun:"retry_safety,notnull,default:'never'" json:"retry_safety"`
	SafeErrorClass          string    `bun:"safe_error_class,notnull,default:''" json:"safe_error_class,omitempty"`
	SafeErrorCode           string    `bun:"safe_error_code,notnull,default:''" json:"safe_error_code,omitempty"`
	ErrorHTTPStatus         int       `bun:"error_http_status,notnull,default:0" json:"error_http_status,omitempty"`
	LastReconciledAt        time.Time `bun:"last_reconciled_at,nullzero" json:"last_reconciled_at,omitempty"`
	NextReconciliationAt    time.Time `bun:"next_reconciliation_at,nullzero" json:"next_reconciliation_at,omitempty"`
	CreatedAt               time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt               time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type Post struct {
	bun.BaseModel `bun:"table:posts"`

	ID            string `bun:",pk" json:"id"`
	WorkspaceID   string `bun:",notnull" json:"workspace_id"`
	CreatedByID   string `bun:"created_by,notnull" json:"created_by"`
	PublicationID string `bun:"publication_id" json:"publication_id"`
	Content       string `bun:",notnull" json:"content"`

	ParentPostID   string `json:"parent_post_id"`
	ThreadSequence int    `bun:",default:0" json:"thread_sequence"`

	Status             string    `bun:",notnull" json:"status"` // 'draft', 'scheduled', 'publishing', 'published', 'failed'
	Revision           int       `bun:",notnull,default:1" json:"revision"`
	ScheduledAt        time.Time `bun:"scheduled_at,nullzero" json:"scheduled_at"`
	PublishedAt        time.Time `bun:"published_at,nullzero" json:"published_at"`
	RandomDelayMinutes int       `bun:",default:0" json:"random_delay_minutes"`
	ActualRunAt        time.Time `bun:",nullzero" json:"actual_run_at"` // Set by worker, differs from ScheduledAt if randomized
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// DraftRevisionChange records the safe, coarse domains changed by an atomic
// authoring save. It never stores draft text, media contents, or provider
// credentials.
type DraftRevisionChange struct {
	bun.BaseModel `bun:"table:draft_revision_changes"`

	AggregateType  string    `bun:"aggregate_type,pk" json:"aggregate_type"`
	AggregateID    string    `bun:"aggregate_id,pk" json:"aggregate_id"`
	Revision       int       `bun:",pk" json:"revision"`
	ChangedDomains string    `bun:"changed_domains,notnull,default:'[]'" json:"changed_domains"`
	ChangedBy      string    `bun:"changed_by,notnull,default:''" json:"changed_by"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type PostDestination struct {
	bun.BaseModel `bun:"table:post_destinations"`

	ID              string    `bun:",pk" json:"id"`
	PostID          string    `bun:",notnull" json:"post_id"`
	SocialAccountID string    `bun:",notnull" json:"social_account_id"`
	ExternalID      string    `json:"external_id"`
	Status          string    `bun:",notnull" json:"status"` // 'pending', 'success', 'failed'
	ErrorMessage    string    `json:"error_message"`
	ErrorKind       string    `bun:"error_kind,notnull,default:''" json:"error_kind"`
	ErrorCode       string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorHTTPStatus int       `bun:"error_http_status,notnull,default:0" json:"error_http_status"`
	ErrorRetryable  bool      `bun:"error_retryable,notnull,default:false" json:"error_retryable"`
	ErrorRetryAt    time.Time `bun:"error_retry_at,nullzero" json:"error_retry_at"`
	ErrorAction     string    `bun:"error_action,notnull,default:''" json:"error_action"`
}

type PostMedia struct {
	bun.BaseModel `bun:"table:post_media"`

	PostID       string `bun:",pk" json:"post_id"`
	MediaID      string `bun:",pk" json:"media_id"`
	DisplayOrder int    `json:"display_order"`
}

// PostMediaDelivery is the legacy text-and-thread publishing cache. It is
// deliberately separate from rendition delivery state so both owner types can
// retain real foreign keys instead of sharing a polymorphic identifier.
type PostMediaDelivery struct {
	bun.BaseModel `bun:"table:post_media_deliveries"`

	WorkspaceID     string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PostID          string    `bun:"post_id,pk" json:"post_id"`
	SocialAccountID string    `bun:"social_account_id,pk" json:"social_account_id"`
	MediaID         string    `bun:"media_id,pk" json:"media_id"`
	Platform        string    `bun:",notnull" json:"platform"`
	ProviderMediaID string    `bun:"provider_media_id,notnull,default:''" json:"provider_media_id"`
	Status          string    `bun:",notnull,default:'ready'" json:"status"`
	ErrorMessage    string    `bun:"error_message,notnull,default:''" json:"error_message"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// RenditionMediaDelivery owns one provider-side upload for one exact
// rendition/media pair. SessionStateEnc may contain a bearer-style resumable
// upload URL, so it is encrypted with the same application key as credentials.
type RenditionMediaDelivery struct {
	bun.BaseModel `bun:"table:rendition_media_deliveries"`

	WorkspaceID         string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID       string    `bun:"publication_id,notnull" json:"publication_id"`
	RenditionID         string    `bun:"rendition_id,pk" json:"rendition_id"`
	SocialAccountID     string    `bun:"social_account_id,notnull" json:"social_account_id"`
	MediaID             string    `bun:"media_id,pk" json:"media_id"`
	Platform            string    `bun:",notnull" json:"platform"`
	ProviderMediaID     string    `bun:"provider_media_id,notnull,default:''" json:"provider_media_id"`
	Status              string    `bun:",notnull,default:'pending'" json:"status"`
	SessionStateEnc     []byte    `bun:"session_state_encrypted" json:"-"`
	UploadedBytes       int64     `bun:"uploaded_bytes,notnull,default:0" json:"uploaded_bytes"`
	TotalBytes          int64     `bun:"total_bytes,notnull,default:0" json:"total_bytes"`
	SessionExpiresAt    time.Time `bun:"session_expires_at,nullzero" json:"session_expires_at,omitempty"`
	LastCheckedAt       time.Time `bun:"last_checked_at,nullzero" json:"last_checked_at,omitempty"`
	RetryClassification string    `bun:"retry_classification,notnull,default:'safe_resume'" json:"retry_classification"`
	ErrorMessage        string    `bun:"error_message,notnull,default:''" json:"error_message"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// RenditionMediaDeliveryRelation records an exact workspace-owned auxiliary
// file used by a provider upload. The migration enforces both its delivery and
// attachment workspace through composite foreign keys.
type RenditionMediaDeliveryRelation struct {
	bun.BaseModel `bun:"table:rendition_media_delivery_relations"`

	WorkspaceID     string `bun:"workspace_id,notnull" json:"workspace_id"`
	RenditionID     string `bun:"rendition_id,pk" json:"rendition_id"`
	DeliveryMediaID string `bun:"delivery_media_id,pk" json:"delivery_media_id"`
	Role            string `bun:"role,pk" json:"role"`
	RelatedMediaID  string `bun:"related_media_id,notnull" json:"related_media_id"`
}

type PublicationAsset struct {
	bun.BaseModel `bun:"table:publication_assets"`

	PublicationID string    `bun:",pk" json:"publication_id"`
	MediaID       string    `bun:",pk" json:"media_id"`
	DisplayOrder  int       `bun:",notnull,default:0" json:"display_order"`
	CreatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type Job struct {
	bun.BaseModel `bun:"table:jobs"`

	ID              string    `bun:",pk" json:"id"`
	Type            string    `bun:",notnull" json:"type"` // 'publish_post', 'refresh_token', 'media_cleanup', 'storage_delete'
	ScopeID         string    `bun:"scope_id,notnull,default:''" json:"scope_id,omitempty"`
	DedupeKey       string    `bun:"dedupe_key,notnull,default:''" json:"dedupe_key,omitempty"`
	Payload         string    `bun:",notnull" json:"payload"`
	Status          string    `bun:",default:'pending'" json:"status"` // 'pending', 'processing', 'completed', 'failed'
	RunAt           time.Time `bun:",notnull" json:"run_at"`
	Attempts        int       `bun:",default:0" json:"attempts"`
	MaxAttempts     int       `bun:",default:3" json:"max_attempts"`
	LastError       string    `json:"last_error"`
	LockedAt        time.Time `bun:"locked_at,nullzero" json:"locked_at"`
	LockedBy        string    `json:"locked_by"`
	LeaseGeneration int64     `bun:"lease_generation,notnull,default:0" json:"-"`
}

type PostVariant struct {
	bun.BaseModel `bun:"table:post_variants"`

	ID              string    `bun:",pk" json:"id"`
	PostID          string    `bun:",notnull" json:"post_id"`
	SocialAccountID string    `bun:",notnull" json:"social_account_id"`
	Content         string    `bun:",notnull" json:"content"`
	MediaIDs        string    `bun:"media_ids,notnull" json:"media_ids"` // JSON array of media IDs override
	IsUnsynced      bool      `bun:",default:false" json:"is_unsynced"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// PostingSchedule defines preferred time slots for posting per workspace.
type PostingSchedule struct {
	bun.BaseModel `bun:"table:posting_schedules"`

	ID          string `bun:",pk" json:"id"`
	WorkspaceID string `bun:",notnull" json:"workspace_id"`
	SetID       string `json:"-"` // Legacy column kept for old databases; schedules are workspace-scoped.

	// Legacy column names; values are workspace-local wall-clock fields so
	// recurring slots remain stable through daylight-saving transitions.
	UTCHour   int `bun:",notnull" json:"utc_hour"`    // 0-23 workspace local time
	UTCMinute int `bun:",notnull" json:"utc_minute"`  // 0-59 workspace local time
	DayOfWeek int `bun:",notnull" json:"day_of_week"` // 0=Sunday, 6=Saturday (workspace local)

	// Display/helpers
	Label    string `json:"label"` // e.g., "Morning", "Lunch", "Evening"
	IsActive bool   `bun:",default:true" json:"is_active"`

	CreatedAt time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// ThreadDraft is the per-post, not-yet-published thread state.
//
// While a user is composing a multi-post thread, the parent Post row holds
// only the parent post's text in `content`, and the full unsaved thread state
// (parent + every child post + per-account content variants) is encoded as
// JSON in this table. The JSON shape is shared with the frontend
// (`apps/web/src/lib/components/compose/draft-utils.ts`):
//
//	{ "p": [ { "k": "key", "c": "content", "m": ["media_id", ...] } ],
//	  "v": { "<social_account_id>": { "<post_key>": { "content": "...",
//	                                                 "mediaIds": [...] } } } }
//
// On publish, the thread becomes real `posts` rows linked by `ParentPostID`,
// and this row is no longer authoritative. It is left in place (cheap) and
// will be re-upserted on the next edit of the parent post.
//
// Cascade-delete with the parent post: deleting a draft thread removes this
// row, and publishing a thread leaves it behind as a benign cached draft.
type ThreadDraft struct {
	bun.BaseModel `bun:"table:thread_drafts"`

	PostID    string    `bun:",pk" json:"post_id"`
	DraftJSON string    `bun:"draft_json,notnull" json:"-"`
	CreatedAt time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}
