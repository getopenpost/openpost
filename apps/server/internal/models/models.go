package models

import (
	"time"

	"github.com/uptrace/bun"
)

// Post status values stored in the `posts.status` column.
const (
	PostStatusDraft      = "draft"
	PostStatusScheduled  = "scheduled"
	PostStatusPublishing = "publishing"
	PostStatusPublished  = "published"
	PostStatusFailed     = "failed"
)

// Publication status values stored in the `publications.status` column.
const (
	PublicationStatusDraft      = "draft"
	PublicationStatusReady      = "ready"
	PublicationStatusScheduled  = "scheduled"
	PublicationStatusPublishing = "publishing"
	PublicationStatusPublished  = "published"
	PublicationStatusFailed     = "failed"
)

// Content profile values stored in publications.content_profile and
// renditions.profile.
const (
	ContentProfileShortText  = "short_text"
	ContentProfileThread     = "thread"
	ContentProfileLinkShare  = "link_share"
	ContentProfileImagePost  = "image_post"
	ContentProfileCarousel   = "carousel"
	ContentProfileStory      = "story"
	ContentProfileShortVideo = "short_video"
	ContentProfileLongVideo  = "long_video"
)

// Publishing intent values describe what the user wants to create. Provider
// output profiles and media shape are resolved separately.
const (
	PublishingIntentPost       = "post"
	PublishingIntentThread     = "thread"
	PublishingIntentStory      = "story"
	PublishingIntentShortVideo = "short_video"
	PublishingIntentVideo      = "video"
)

// Rendition status values stored in renditions.status.
const (
	RenditionStatusDraft      = "draft"
	RenditionStatusReady      = "ready"
	RenditionStatusScheduled  = "scheduled"
	RenditionStatusPublishing = "publishing"
	RenditionStatusPublished  = "published"
	RenditionStatusFailed     = "failed"
)

// Workspace role values stored in the `workspace_members.role` column.
const (
	WorkspaceRoleAdmin  = "admin"
	WorkspaceRoleEditor = "editor"
	// WorkspaceRoleClient may connect accounts and decide approvals, but may
	// not author or change content. It is the role for the person who owns the
	// accounts and the reputation without working in the product.
	WorkspaceRoleClient = "client"
	WorkspaceRoleViewer = "viewer"

	WorkspaceMemberStatusActive   = "active"
	WorkspaceMemberStatusInactive = "inactive"
)

// Organization role values stored in the `organization_members.role` column.
const (
	OrganizationRoleOwner  = "owner"
	OrganizationRoleAdmin  = "admin"
	OrganizationRoleMember = "member"
)

// Organization SSO modes stored in organization_sso_policies.mode.
const (
	OrganizationSSOModeDisabled = "disabled"
	OrganizationSSOModeOptional = "optional"
	OrganizationSSOModeRequired = "required"
)

// Organization API-token policies stored in
// organization_sso_policies.api_token_mode.
const (
	OrganizationSSOTokensScoped = "scoped"
	OrganizationSSOTokensDeny   = "deny"
)

// OIDC authorization request intents.
const (
	OIDCIntentLogin  = "login"
	OIDCIntentSignup = "signup"
	OIDCIntentLink   = "link"
	OIDCIntentReauth = "reauth"
)

type Organization struct {
	bun.BaseModel `bun:"table:organizations"`

	ID          string    `bun:",pk" json:"id"`
	Name        string    `bun:",notnull" json:"name"`
	CreatedByID string    `bun:"created_by,notnull" json:"created_by"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type OrganizationMember struct {
	bun.BaseModel `bun:"table:organization_members"`

	OrganizationID string    `bun:",pk" json:"organization_id"`
	UserID         string    `bun:",pk" json:"user_id"`
	Role           string    `bun:",notnull" json:"role"` // 'owner', 'admin', 'member'
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type OrganizationInvitation struct {
	bun.BaseModel `bun:"table:organization_invitations"`

	ID                 string    `bun:",pk" json:"id"`
	OrganizationID     string    `bun:",notnull" json:"organization_id"`
	Email              string    `bun:",notnull" json:"email"`
	Role               string    `bun:",notnull,default:'member'" json:"role"`
	InvitedByUserID    string    `bun:",notnull" json:"invited_by_user_id"`
	AcceptedByUserID   string    `bun:",nullzero" json:"accepted_by_user_id"`
	DefaultWorkspaceID string    `bun:",nullzero" json:"default_workspace_id"`
	TokenHash          string    `bun:",unique,notnull" json:"-"`
	ExpiresAt          time.Time `bun:",notnull" json:"expires_at"`
	AcceptedAt         time.Time `bun:",nullzero" json:"accepted_at"`
	RevokedAt          time.Time `bun:",nullzero" json:"revoked_at"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// OrganizationOwnershipTransfer keeps the current Owner authoritative until
// the nominated Organization member accepts the single-use action.
type OrganizationOwnershipTransfer struct {
	bun.BaseModel `bun:"table:organization_ownership_transfers"`

	ID               string    `bun:",pk" json:"id"`
	OrganizationID   string    `bun:"organization_id,notnull" json:"organization_id"`
	PriorOwnerUserID string    `bun:"prior_owner_user_id,notnull" json:"prior_owner_user_id"`
	NomineeUserID    string    `bun:"nominee_user_id,notnull" json:"nominee_user_id"`
	Status           string    `bun:",notnull,default:'pending'" json:"status"`
	ExpiresAt        time.Time `bun:"expires_at,notnull" json:"expires_at"`
	AcceptedAt       time.Time `bun:"accepted_at,nullzero" json:"accepted_at,omitempty"`
	DeclinedAt       time.Time `bun:"declined_at,nullzero" json:"declined_at,omitempty"`
	RevokedAt        time.Time `bun:"revoked_at,nullzero" json:"revoked_at,omitempty"`
	ExpiredAt        time.Time `bun:"expired_at,nullzero" json:"expired_at,omitempty"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// OrganizationOwnershipAuditEvent is permission-safe, domain-owned evidence
// for an ownership transfer. Transfer and nominee IDs preserve the affected
// subject without retaining acceptance tokens, links, or email addresses.
type OrganizationOwnershipAuditEvent struct {
	bun.BaseModel `bun:"table:organization_ownership_audit_events"`

	ID             string    `bun:",pk" json:"id"`
	OrganizationID string    `bun:"organization_id,notnull" json:"organization_id"`
	TransferID     string    `bun:"transfer_id,notnull" json:"transfer_id"`
	ActorUserID    string    `bun:"actor_user_id,nullzero" json:"actor_user_id,omitempty"`
	NomineeUserID  string    `bun:"nominee_user_id,nullzero" json:"nominee_user_id,omitempty"`
	Action         string    `bun:",notnull" json:"action"`
	Result         string    `bun:",notnull" json:"result"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type Workspace struct {
	bun.BaseModel `bun:"table:workspaces"`

	ID             string `bun:",pk" json:"id"`
	OrganizationID string `bun:"organization_id" json:"organization_id"`
	Name           string `bun:",notnull" json:"name"`
	AvatarURL      string `bun:"avatar_url" json:"avatar_url"`
	Color          string `bun:",notnull,default:'#f97316'" json:"color"`
	Timezone       string `bun:",default:'UTC'" json:"timezone"`
	WeekStart      int    `bun:",default:1" json:"week_start"` // 0=Sunday, 1=Monday
	// DeprecatedMediaCleanupDays is a database tombstone for pre-fixed-policy
	// installations. Runtime cleanup is always governed by medialifecycle's
	// 14-day inactivity policy; this value is never read or exposed.
	DeprecatedMediaCleanupDays int `bun:"media_cleanup_days,default:14" json:"-"`
	// DeprecatedDraftGapMinutes is a tombstone for the removed queue-spillover
	// setting. The queue is strictly slot-based; when today's slots are full
	// the next slot is on the next day.
	DeprecatedDraftGapMinutes int `bun:"draft_gap_minutes,default:60" json:"-"`
	RandomDelayMinutes        int `bun:",default:0" json:"random_delay_minutes"`   // ±N minutes natural posting
	SlotStartHour             int `bun:",default:5" json:"slot_start_hour"`        // 0-23
	SlotEndHour               int `bun:",default:23" json:"slot_end_hour"`         // 0-23
	SlotIntervalMinutes       int `bun:",default:15" json:"slot_interval_minutes"` // 1-180
	// RequireClientReview blocks every provider write until an assigned Client approves the current version.
	RequireClientReview bool      `bun:"require_client_review,notnull,default:false" json:"require_client_review"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type SavedMention struct {
	bun.BaseModel `bun:"table:saved_mentions"`
	ID            string    `bun:",pk"`
	WorkspaceID   string    `bun:"workspace_id,notnull"`
	Name          string    `bun:"name,notnull"`
	NameKey       string    `bun:"name_key,notnull"`
	ProfileJSON   string    `bun:"profile_json,notnull"`
	UpdatedAt     time.Time `bun:"updated_at,notnull,default:current_timestamp"`
}

type ProviderUserResolution struct {
	bun.BaseModel  `bun:"table:provider_user_resolutions"`
	ID             string    `bun:",pk"`
	WorkspaceID    string    `bun:"workspace_id,notnull"`
	Provider       string    `bun:"provider,notnull"`
	Handle         string    `bun:"handle,notnull"`
	ProviderUserID string    `bun:"provider_user_id,notnull"`
	ResolvedAt     time.Time `bun:"resolved_at,notnull"`
	CreatedAt      time.Time `bun:"created_at,notnull,default:current_timestamp"`
	UpdatedAt      time.Time `bun:"updated_at,notnull,default:current_timestamp"`
}
