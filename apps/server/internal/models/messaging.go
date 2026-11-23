package models

import (
	"time"

	"github.com/uptrace/bun"
)

// EngagementAttachment is the safe public metadata needed to render a
// provider-owned attachment. Provider payloads and media contents are not
// retained.
type EngagementAttachment struct {
	Type      string `json:"type"`
	URL       string `json:"url"`
	Name      string `json:"name,omitempty"`
	MimeType  string `json:"mime_type,omitempty"`
	Thumbnail string `json:"thumbnail,omitempty"`
	AltText   string `json:"alt_text,omitempty"`
}

// EngagementItem is a normalized reply or comment collected from a provider.
// Provider payloads are deliberately not retained.
type EngagementItem struct {
	AutomationState     string    `bun:"-" json:"automation_state,omitempty"`
	AutomationRunID     string    `bun:"-" json:"automation_run_id,omitempty"`
	AutomationStoppedAt time.Time `bun:"automation_stopped_at,nullzero" json:"automation_stopped_at,omitempty,omitzero"`
	RepliedAt           time.Time `bun:"replied_at,nullzero" json:"replied_at,omitempty,omitzero"`
	bun.BaseModel       `bun:"table:engagement_items"`

	ID                   string                 `bun:",pk" json:"id"`
	WorkspaceID          string                 `bun:"workspace_id,notnull" json:"workspace_id"`
	RenditionID          string                 `bun:"rendition_id,nullzero" json:"rendition_id,omitempty"`
	Kind                 string                 `bun:"kind,notnull,default:'comment'" json:"kind,omitempty"`
	SubjectJSON          string                 `bun:"subject_json,notnull,default:'{}'" json:"-"`
	Subject              *EngagementSubject     `bun:"-" json:"subject,omitempty"`
	ReviewReplyCheckAt   time.Time              `bun:"review_reply_check_at,nullzero" json:"-"`
	ReviewReplyWrittenAt time.Time              `bun:"review_reply_written_at,nullzero" json:"-"`
	CanDeleteReply       bool                   `bun:"-" json:"can_delete_reply,omitempty"`
	ReplyJobID           string                 `bun:"-" json:"reply_job_id,omitempty"`
	ReplyOperationState  string                 `bun:"-" json:"reply_operation_state,omitempty"`
	SocialAccountID      string                 `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform             string                 `bun:",notnull" json:"platform"`
	RemoteID             string                 `bun:"remote_id,notnull" json:"remote_id"`
	NativeRemoteID       string                 `bun:"native_remote_id,notnull,default:''" json:"-"`
	ParentRemoteID       string                 `bun:"parent_remote_id,notnull,default:''" json:"parent_remote_id"`
	ConversationRemoteID string                 `bun:"conversation_remote_id,notnull,default:''" json:"conversation_remote_id"`
	AuthorRemoteID       string                 `bun:"author_remote_id,notnull,default:''" json:"author_remote_id"`
	AuthorName           string                 `bun:"author_name,notnull,default:''" json:"author_name"`
	AuthorHandle         string                 `bun:"author_handle,notnull,default:''" json:"author_handle"`
	AuthorAvatarURL      string                 `bun:"author_avatar_url,notnull,default:''" json:"author_avatar_url"`
	Body                 string                 `bun:",notnull,default:''" json:"body"`
	AttachmentsJSON      string                 `bun:"attachments_json,notnull,default:'[]'" json:"-"`
	IsOurs               bool                   `bun:"is_ours,notnull,default:false" json:"is_ours"`
	CanReply             bool                   `bun:"can_reply,notnull,default:false" json:"can_reply"`
	CanHide              bool                   `bun:"can_hide,notnull,default:false" json:"can_hide"`
	CanDelete            bool                   `bun:"can_delete,notnull,default:false" json:"can_delete"`
	CanLike              bool                   `bun:"can_like,notnull,default:false" json:"can_like"`
	CanUnlike            bool                   `bun:"can_unlike,notnull,default:false" json:"can_unlike"`
	Liked                bool                   `bun:"liked,notnull,default:false" json:"liked"`
	Hidden               bool                   `bun:",notnull,default:false" json:"hidden"`
	ReadAt               time.Time              `bun:"read_at,nullzero" json:"read_at,omitempty,omitzero"`
	ArchivedAt           time.Time              `bun:"archived_at,nullzero" json:"archived_at,omitempty,omitzero"`
	EditedAt             time.Time              `bun:"edited_at,nullzero" json:"edited_at,omitempty,omitzero"`
	DeletedAt            time.Time              `bun:"deleted_at,nullzero" json:"deleted_at,omitempty,omitzero"`
	RemoteCreatedAt      time.Time              `bun:"remote_created_at,nullzero" json:"remote_created_at,omitempty,omitzero"`
	LastSeenAt           time.Time              `bun:"last_seen_at,notnull" json:"last_seen_at"`
	CreatedAt            time.Time              `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt            time.Time              `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
	ProviderPostURL      string                 `bun:"-" json:"provider_post_url,omitempty"`
	PublicationID        string                 `bun:"-" json:"publication_id,omitempty"`
	PublicationTitle     string                 `bun:"-" json:"publication_title,omitempty"`
	PublicationExcerpt   string                 `bun:"-" json:"publication_excerpt,omitempty"`
	AccountUsername      string                 `bun:"-" json:"account_username,omitempty"`
	Attachments          []EngagementAttachment `bun:"-" json:"attachments"`
}

// Conversation is a provider DM thread. It stores only the normalized
// counterpart and latest-message summary needed by the inbox.
type Conversation struct {
	bun.BaseModel `bun:"table:conversations"`

	ID                       string    `bun:",pk" json:"id"`
	WorkspaceID              string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SocialAccountID          string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform                 string    `bun:",notnull" json:"platform"`
	RemoteConversationID     string    `bun:"remote_conversation_id,notnull" json:"remote_conversation_id"`
	CounterpartRemoteID      string    `bun:"counterpart_remote_id,notnull,default:''" json:"counterpart_remote_id"`
	CounterpartName          string    `bun:"counterpart_name,notnull,default:''" json:"counterpart_name"`
	CounterpartHandle        string    `bun:"counterpart_handle,notnull,default:''" json:"counterpart_handle"`
	CounterpartAvatarURL     string    `bun:"counterpart_avatar_url,notnull,default:''" json:"counterpart_avatar_url"`
	LastMessageAt            time.Time `bun:"last_message_at,nullzero" json:"last_message_at"`
	LastMessagePreview       string    `bun:"last_message_preview,notnull,default:''" json:"last_message_preview"`
	LastRemoteMessageID      string    `bun:"last_remote_message_id,notnull,default:''" json:"last_remote_message_id"`
	UnreadCount              int       `bun:"unread_count,notnull,default:0" json:"unread_count"`
	ReadAt                   time.Time `bun:"read_at,nullzero" json:"read_at,omitempty,omitzero"`
	ArchivedAt               time.Time `bun:"archived_at,nullzero" json:"archived_at,omitempty,omitzero"`
	MessagingWindowExpiresAt time.Time `bun:"messaging_window_expires_at,nullzero" json:"messaging_window_expires_at,omitempty,omitzero"`
	CreatedAt                time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt                time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// DirectMessage is a normalized inbound or outbound message in a Conversation.
type DirectMessage struct {
	bun.BaseModel `bun:"table:direct_messages"`

	ID                string    `bun:",pk" json:"id"`
	WorkspaceID       string    `bun:"workspace_id,notnull" json:"workspace_id"`
	ConversationID    string    `bun:"conversation_id,notnull" json:"conversation_id"`
	RemoteMessageID   string    `bun:"remote_message_id,notnull,default:''" json:"remote_message_id"`
	ReplyToRemoteID   string    `bun:"reply_to_remote_id,notnull,default:''" json:"-"`
	ClientOperationID string    `bun:"client_operation_id,notnull,default:''" json:"client_operation_id,omitempty"`
	DeletedAt         time.Time `bun:"deleted_at,nullzero" json:"deleted_at,omitempty,omitzero"`
	ProviderReadAt    time.Time `bun:"provider_read_at,nullzero" json:"provider_read_at,omitempty,omitzero"`
	Direction         string    `bun:",notnull" json:"direction"`
	AuthorRemoteID    string    `bun:"author_remote_id,notnull,default:''" json:"author_remote_id"`
	Body              string    `bun:",notnull,default:''" json:"body"`
	AttachmentsJSON   string    `bun:"attachments_json,notnull,default:'[]'" json:"attachments_json"`
	SendStatus        string    `bun:"send_status,notnull,default:'received'" json:"send_status"`
	ErrorMessage      string    `bun:"error_message,notnull,default:''" json:"error_message"`
	RemoteCreatedAt   time.Time `bun:"remote_created_at,nullzero" json:"remote_created_at"`
	CreatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// EngagementSyncState is the latest safe cursor and collection state for one rendition.
type EngagementSyncState struct {
	bun.BaseModel `bun:"table:engagement_sync_states"`
	Feed          string `bun:"-" json:"feed,omitempty"`

	ID               string    `bun:",pk" json:"id"`
	WorkspaceID      string    `bun:"workspace_id,notnull" json:"workspace_id"`
	RenditionID      string    `bun:"rendition_id,notnull" json:"rendition_id"`
	SocialAccountID  string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform         string    `bun:",notnull" json:"platform"`
	Status           string    `bun:",notnull,default:'pending'" json:"status"`
	ErrorCode        string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorMessage     string    `bun:"error_message,notnull,default:''" json:"error_message"`
	Cursor           string    `bun:",notnull,default:''" json:"cursor"`
	BackfillComplete bool      `bun:"backfill_complete,notnull,default:false" json:"backfill_complete"`
	LastAttemptedAt  time.Time `bun:"last_attempted_at,nullzero" json:"last_attempted_at"`
	LastSuccessAt    time.Time `bun:"last_success_at,nullzero" json:"last_success_at"`
	NextSyncAt       time.Time `bun:"next_sync_at,nullzero" json:"next_sync_at"`
	EmptyStreak      int       `bun:"empty_streak,notnull,default:0" json:"empty_streak"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// XEngagementReadBudget is the durable UTC-day provider-read fence shared by
// scheduled and manual engagement collection for one X account.
type XEngagementReadBudget struct {
	bun.BaseModel `bun:"table:x_engagement_read_budgets"`

	SocialAccountID string    `bun:"social_account_id,pk" json:"social_account_id"`
	WorkspaceID     string    `bun:"workspace_id,notnull" json:"workspace_id"`
	WindowStart     time.Time `bun:"window_start,notnull" json:"window_start"`
	AttemptsUsed    int       `bun:"attempts_used,notnull,default:0" json:"attempts_used"`
	BlockedUntil    time.Time `bun:"blocked_until,nullzero" json:"blocked_until"`
	BlockCode       string    `bun:"block_code,notnull,default:''" json:"block_code"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// MessagingSyncState is the latest safe cursor and collection state for one account inbox.
type MessagingSyncState struct {
	bun.BaseModel `bun:"table:messaging_sync_states"`

	ID               string    `bun:",pk" json:"id"`
	WorkspaceID      string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SocialAccountID  string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform         string    `bun:",notnull" json:"platform"`
	Status           string    `bun:",notnull,default:'pending'" json:"status"`
	ErrorCode        string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorMessage     string    `bun:"error_message,notnull,default:''" json:"error_message"`
	Cursor           string    `bun:",notnull,default:''" json:"cursor"`
	BackfillComplete bool      `bun:"backfill_complete,notnull,default:false" json:"backfill_complete"`
	LastAttemptedAt  time.Time `bun:"last_attempted_at,nullzero" json:"last_attempted_at"`
	LastSuccessAt    time.Time `bun:"last_success_at,nullzero" json:"last_success_at"`
	NextSyncAt       time.Time `bun:"next_sync_at,nullzero" json:"next_sync_at"`
	EmptyStreak      int       `bun:"empty_streak,notnull,default:0" json:"empty_streak"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// UserNotification is an in-app notification addressed to one user.
type UserNotification struct {
	bun.BaseModel `bun:"table:user_notifications"`

	ID          string               `bun:",pk" json:"id"`
	UserID      string               `bun:"user_id,notnull" json:"user_id"`
	WorkspaceID string               `bun:"workspace_id,notnull,default:''" json:"workspace_id"`
	Type        string               `bun:",notnull" json:"type"`
	Title       string               `bun:",notnull" json:"title"`
	Body        string               `bun:",notnull,default:''" json:"body"`
	Href        string               `bun:",notnull,default:''" json:"href"`
	PayloadJSON string               `bun:"payload_json,notnull,default:'{}'" json:"payload_json"`
	DedupKey    string               `bun:"dedup_key,notnull,default:''" json:"-"`
	ReadAt      time.Time            `bun:"read_at,nullzero" json:"read_at,omitempty,omitzero"`
	CreatedAt   time.Time            `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	Actions     []NotificationAction `bun:"-" json:"actions,omitempty"`
}

// NotificationAction is a safe in-app action. Only local application paths are
// accepted by the notification service.
type NotificationAction struct {
	Label     string `json:"label"`
	Href      string `json:"href,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Operation string `json:"operation,omitempty"`
	TargetID  string `json:"target_id,omitempty"`
}

// UserNotificationPreference stores the user's per-event delivery choices.
// Critical in-app notifications are enforced by the notification service.
type UserNotificationPreference struct {
	bun.BaseModel `bun:"table:user_notification_preferences"`

	UserID           string    `bun:"user_id,pk" json:"user_id"`
	PreferencesJSON  string    `bun:"preferences_json,notnull,default:'{}'" json:"preferences_json"`
	DigestTime       string    `bun:"digest_time,notnull,default:'09:00'" json:"digest_time"`
	DigestTimezone   string    `bun:"digest_timezone,notnull,default:''" json:"digest_timezone"`
	DigestConfigured bool      `bun:"digest_configured,notnull,default:false" json:"digest_configured"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// UserWorkspaceQueueReminder stores a person's email reminder choices and the
// current depletion episode for one Workspace. Episode state prevents repeat
// mail until the durable queue has recovered beyond the configured horizon.
type UserWorkspaceQueueReminder struct {
	bun.BaseModel `bun:"table:user_workspace_queue_reminders"`

	UserID              string    `bun:"user_id,pk" json:"user_id"`
	WorkspaceID         string    `bun:"workspace_id,pk" json:"workspace_id"`
	LowRunwayEnabled    bool      `bun:"low_runway_enabled,notnull,default:false" json:"low_runway_enabled"`
	QueueEmptiedEnabled bool      `bun:"queue_emptied_enabled,notnull,default:false" json:"queue_emptied_enabled"`
	RunwayDays          int       `bun:"runway_days,notnull,default:7" json:"runway_days"`
	LowRunwayActive     bool      `bun:"low_runway_active,notnull,default:false" json:"-"`
	QueueEmptiedActive  bool      `bun:"queue_emptied_active,notnull,default:false" json:"-"`
	UpdatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// UserNotificationMute is a temporary overlay on a user's saved optional
// notification preferences. Account Mutes use an empty WorkspaceID; ending or
// expiry never rewrites the underlying channel or frequency choices.
type UserNotificationMute struct {
	bun.BaseModel `bun:"table:user_notification_mutes"`

	ID          string    `bun:",pk" json:"id"`
	UserID      string    `bun:"user_id,notnull" json:"user_id"`
	Scope       string    `bun:",notnull" json:"scope"`
	WorkspaceID string    `bun:"workspace_id,nullzero" json:"workspace_id,omitempty"`
	StartsAt    time.Time `bun:"starts_at,notnull" json:"starts_at"`
	EndsAt      time.Time `bun:"ends_at,notnull" json:"ends_at"`
	EndedAt     time.Time `bun:"ended_at,nullzero" json:"ended_at,omitempty"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// UserNotificationDigestItem is one optional email fact waiting for its
// user's configured daily delivery window. Content is rendered only through
// the same escaped notification-email boundary as immediate mail.
type UserNotificationDigestItem struct {
	bun.BaseModel `bun:"table:user_notification_digest_items"`

	ID                  string    `bun:",pk" json:"id"`
	UserID              string    `bun:"user_id,notnull" json:"user_id"`
	WorkspaceID         string    `bun:"workspace_id,notnull,default:''" json:"workspace_id,omitempty"`
	WorkspaceScopeKnown bool      `bun:"workspace_scope_known,notnull,default:false" json:"workspace_scope_known"`
	Type                string    `bun:",notnull" json:"type"`
	Title               string    `bun:",notnull" json:"title"`
	Body                string    `bun:",notnull,default:''" json:"body"`
	Href                string    `bun:",notnull,default:''" json:"href"`
	DedupKey            string    `bun:"dedup_key,notnull,default:''" json:"-"`
	DeliveryWindowAt    time.Time `bun:"delivery_window_at,notnull" json:"delivery_window_at"`
	DeliveryID          string    `bun:"delivery_id,notnull,default:''" json:"delivery_id,omitempty"`
	DeliveredAt         time.Time `bun:"delivered_at,nullzero" json:"delivered_at,omitempty"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}
