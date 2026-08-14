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
	DeprecatedMediaCleanupDays int       `bun:"media_cleanup_days,default:14" json:"-"`
	RandomDelayMinutes         int       `bun:",default:0" json:"random_delay_minutes"`   // ±N minutes natural posting
	DraftGapMinutes            int       `bun:",default:60" json:"draft_gap_minutes"`     // Minimum gap when spilling past configured schedule slots
	SlotStartHour              int       `bun:",default:5" json:"slot_start_hour"`        // 0-23
	SlotEndHour                int       `bun:",default:23" json:"slot_end_hour"`         // 0-23
	SlotIntervalMinutes        int       `bun:",default:15" json:"slot_interval_minutes"` // 1-180
	CreatedAt                  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type User struct {
	bun.BaseModel `bun:"table:users"`

	ID                          string    `bun:",pk" json:"id"`
	Email                       string    `bun:",unique,notnull" json:"email"`
	Username                    string    `bun:",notnull,default:''" json:"username"`
	DisplayName                 string    `json:"display_name"`
	AvatarURL                   string    `json:"avatar_url"`
	AvatarObjectKey             string    `json:"-"`
	PublicProfile               bool      `bun:"public_profile_enabled,notnull,default:false" json:"public_profile_enabled"`
	PublicProfileVisibilityJSON string    `bun:"public_profile_visibility_json,notnull,default:'null'" json:"-"`
	ComposerExperience          string    `bun:"composer_experience,notnull,default:'specialized'" json:"composer_experience"`
	PasswordHash                string    `bun:",nullzero" json:"-"`
	IsAdmin                     bool      `bun:",notnull,default:false" json:"is_admin"`
	IsBreakGlass                bool      `bun:"is_break_glass,notnull,default:false" json:"is_break_glass"`
	TOTPSecretEnc               []byte    `bun:"totp_secret_encrypted" json:"-"`
	TOTPEnabledAt               time.Time `bun:",nullzero" json:"totp_enabled_at"`
	PasskeyEnabledAt            time.Time `bun:",nullzero" json:"passkey_enabled_at"`
	TermsVersion                string    `bun:"terms_version,notnull,default:''" json:"terms_version"`
	PrivacyVersion              string    `bun:"privacy_version,notnull,default:''" json:"privacy_version"`
	LegalAcceptedAt             time.Time `bun:"legal_accepted_at,nullzero" json:"legal_accepted_at"`
	EmailVerifiedAt             time.Time `bun:"email_verified_at,nullzero" json:"email_verified_at"`
	CreatedAt                   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type EmailVerificationChallenge struct {
	bun.BaseModel `bun:"table:email_verification_challenges"`

	ID         string    `bun:",pk" json:"id"`
	UserID     string    `bun:"user_id,notnull" json:"user_id"`
	CodeHash   string    `bun:"code_hash,notnull" json:"-"`
	Attempts   int       `bun:",notnull,default:0" json:"attempts"`
	ExpiresAt  time.Time `bun:"expires_at,notnull" json:"expires_at"`
	SentAt     time.Time `bun:"sent_at,nullzero" json:"sent_at"`
	ConsumedAt time.Time `bun:"consumed_at,nullzero" json:"consumed_at"`
	CreatedAt  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// EmailChangeChallenge keeps the current address authoritative until a
// replacement address has been verified. Only a keyed code digest is stored;
// raw verification codes are returned to the delivery boundary once.
type EmailChangeChallenge struct {
	bun.BaseModel `bun:"table:email_change_challenges"`

	ID         string    `bun:",pk" json:"id"`
	UserID     string    `bun:"user_id,notnull" json:"user_id"`
	OldEmail   string    `bun:"old_email,notnull" json:"old_email"`
	NewEmail   string    `bun:"new_email,notnull" json:"new_email"`
	CodeHash   string    `bun:"code_hash,notnull" json:"-"`
	Attempts   int       `bun:",notnull,default:0" json:"attempts"`
	ExpiresAt  time.Time `bun:"expires_at,notnull" json:"expires_at"`
	SentAt     time.Time `bun:"sent_at,nullzero" json:"sent_at"`
	ConsumedAt time.Time `bun:"consumed_at,nullzero" json:"consumed_at"`
	CanceledAt time.Time `bun:"canceled_at,nullzero" json:"canceled_at"`
	CreatedAt  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type PasswordResetToken struct {
	bun.BaseModel `bun:"table:password_reset_tokens"`

	ID        string    `bun:",pk" json:"id"`
	UserID    string    `bun:",notnull" json:"user_id"`
	TokenHash string    `bun:",unique,notnull" json:"-"`
	ExpiresAt time.Time `bun:",notnull" json:"expires_at"`
	UsedAt    time.Time `bun:",nullzero" json:"used_at"`
	CreatedAt time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type UserPasskey struct {
	bun.BaseModel `bun:"table:user_passkeys"`

	ID             string    `bun:",pk" json:"id"`
	UserID         string    `bun:",notnull" json:"user_id"`
	Name           string    `bun:",notnull" json:"name"`
	CredentialID   []byte    `bun:",notnull,unique" json:"-"`
	CredentialJSON string    `bun:"credential_json,notnull" json:"-"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	LastUsedAt     time.Time `bun:",nullzero" json:"last_used_at"`
}

// UserMFARecoveryCode stores only a digest of a high-entropy recovery code.
// Codes belong to a batch and are removed when that batch is replaced or TOTP
// is disabled, keeping storage bounded without retaining plaintext values.
type UserMFARecoveryCode struct {
	bun.BaseModel `bun:"table:user_mfa_recovery_codes"`

	ID        string    `bun:",pk" json:"id"`
	UserID    string    `bun:"user_id,notnull" json:"user_id"`
	BatchID   string    `bun:"batch_id,notnull" json:"batch_id"`
	CodeHash  string    `bun:"code_hash,notnull" json:"-"`
	UsedAt    time.Time `bun:"used_at,nullzero" json:"used_at"`
	CreatedAt time.Time `bun:"created_at,nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type UserSession struct {
	bun.BaseModel `bun:"table:user_sessions"`

	ID         string    `bun:",pk" json:"id"`
	UserID     string    `bun:",notnull" json:"user_id"`
	UserAgent  string    `json:"user_agent"`
	IPAddress  string    `json:"ip_address"`
	ExpiresAt  time.Time `bun:",notnull" json:"expires_at"`
	LastUsedAt time.Time `bun:",nullzero" json:"last_used_at"`
	RevokedAt  time.Time `bun:",nullzero" json:"revoked_at"`
	CreatedAt  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type UserImpersonationGrant struct {
	bun.BaseModel `bun:"table:user_impersonation_grants"`

	ID                string    `bun:",pk" json:"id"`
	TokenHash         string    `bun:",unique,notnull" json:"-"`
	AdminUserID       string    `bun:",notnull" json:"admin_user_id"`
	TargetUserID      string    `bun:",notnull" json:"target_user_id"`
	ExpiresAt         time.Time `bun:",notnull" json:"expires_at"`
	UsedAt            time.Time `bun:",nullzero" json:"used_at"`
	CreatedIPAddress  string    `bun:"created_ip_address" json:"created_ip_address"`
	CreatedUserAgent  string    `bun:"created_user_agent" json:"created_user_agent"`
	ConsumedIPAddress string    `bun:"consumed_ip_address" json:"consumed_ip_address"`
	ConsumedUserAgent string    `bun:"consumed_user_agent" json:"consumed_user_agent"`
	CreatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// UserImpersonationGrantOrganization freezes the Organizations whose data an
// impersonated user could access when an instance administrator creates a grant.
type UserImpersonationGrantOrganization struct {
	bun.BaseModel `bun:"table:user_impersonation_grant_organizations"`

	GrantID        string `bun:"grant_id,pk"`
	OrganizationID string `bun:"organization_id,pk"`
}

type IdentityProvider struct {
	bun.BaseModel `bun:"table:identity_providers"`

	ID                   string    `bun:",pk" json:"id"`
	OrganizationID       string    `bun:"organization_id,nullzero" json:"organization_id,omitempty"`
	Source               string    `bun:",notnull,default:'database'" json:"source"`
	Issuer               string    `bun:",notnull" json:"issuer"`
	Name                 string    `bun:",notnull" json:"name"`
	ClientID             string    `bun:"client_id,notnull" json:"client_id"`
	ClientSecretEnc      []byte    `bun:"client_secret_encrypted" json:"-"`
	Scopes               string    `bun:",notnull,default:'openid profile email'" json:"scopes"`
	EmailClaim           string    `bun:"email_claim,notnull,default:'email'" json:"email_claim"`
	NameClaim            string    `bun:"name_claim,notnull,default:'name'" json:"name_claim"`
	PictureClaim         string    `bun:"picture_claim,notnull,default:'picture'" json:"picture_claim"`
	UseUserInfo          bool      `bun:"use_userinfo,notnull" json:"use_userinfo"`
	RequireVerifiedEmail bool      `bun:"require_verified_email,notnull" json:"require_verified_email"`
	JITEnabled           bool      `bun:"jit_enabled,notnull" json:"jit_enabled"`
	IsActive             bool      `bun:"is_active,notnull" json:"is_active"`
	HealthStatus         string    `bun:"health_status,notnull,default:'unchecked'" json:"health_status"`
	HealthMessage        string    `bun:"health_message,notnull,default:''" json:"health_message"`
	LastCheckedAt        time.Time `bun:"last_checked_at,nullzero" json:"last_checked_at,omitempty"`
	CreatedByUserID      string    `bun:"created_by_user_id,nullzero" json:"created_by_user_id,omitempty"`
	CreatedAt            time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt            time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type UserIdentity struct {
	bun.BaseModel `bun:"table:user_identities"`

	ID          string    `bun:",pk" json:"id"`
	ProviderID  string    `bun:"provider_id,notnull" json:"provider_id"`
	Subject     string    `bun:",notnull" json:"subject"`
	UserID      string    `bun:"user_id,notnull" json:"user_id"`
	LinkedEmail string    `bun:"linked_email,notnull,default:''" json:"linked_email,omitempty"`
	LinkedName  string    `bun:"linked_name,notnull,default:''" json:"linked_name,omitempty"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	LastLoginAt time.Time `bun:"last_login_at,nullzero" json:"last_login_at,omitempty"`
}

type OIDCAuthRequest struct {
	bun.BaseModel `bun:"table:oidc_auth_requests"`

	ID                 string    `bun:",pk" json:"id"`
	ProviderID         string    `bun:"provider_id,notnull" json:"provider_id"`
	UserID             string    `bun:"user_id,nullzero" json:"user_id,omitempty"`
	SessionID          string    `bun:"session_id,nullzero" json:"session_id,omitempty"`
	OrganizationID     string    `bun:"organization_id,nullzero" json:"organization_id,omitempty"`
	StateHash          string    `bun:"state_hash,unique,notnull" json:"-"`
	NonceHash          string    `bun:"nonce_hash,notnull" json:"-"`
	BrowserBindingHash string    `bun:"browser_binding_hash,notnull" json:"-"`
	PKCEVerifierEnc    []byte    `bun:"pkce_verifier_encrypted,notnull" json:"-"`
	Intent             string    `bun:",notnull" json:"intent"`
	ReauthAction       string    `bun:"reauth_action,notnull,default:''" json:"reauth_action,omitempty"`
	ReturnPath         string    `bun:"return_path,notnull,default:'/'" json:"return_path"`
	Native             bool      `bun:",notnull,default:false" json:"native"`
	ExpiresAt          time.Time `bun:",notnull" json:"expires_at"`
	ConsumedAt         time.Time `bun:",nullzero" json:"consumed_at,omitempty"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type OrganizationSSOPolicy struct {
	bun.BaseModel `bun:"table:organization_sso_policies"`

	OrganizationID          string    `bun:"organization_id,pk" json:"organization_id"`
	Mode                    string    `bun:",notnull,default:'disabled'" json:"mode"`
	ProviderIDs             string    `bun:"provider_ids,notnull,default:'[]'" json:"-"`
	AssuranceMaxAgeSeconds  int       `bun:"assurance_max_age_seconds,notnull,default:43200" json:"assurance_max_age_seconds"`
	PasswordLoginAllowed    bool      `bun:"password_login_allowed,notnull" json:"password_login_allowed"`
	APITokenMode            string    `bun:"api_token_mode,notnull,default:'scoped'" json:"api_token_mode"`
	MaxTokenLifetimeSeconds int       `bun:"max_token_lifetime_seconds,notnull,default:2592000" json:"max_token_lifetime_seconds"`
	RequireTokenReauth      bool      `bun:"require_token_reauth,notnull" json:"require_token_reauth"`
	UpdatedByUserID         string    `bun:"updated_by_user_id,nullzero" json:"updated_by_user_id,omitempty"`
	CreatedAt               time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt               time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type IdentityProviderDomain struct {
	bun.BaseModel `bun:"table:identity_provider_domains"`

	ID               string    `bun:",pk" json:"id"`
	ProviderID       string    `bun:"provider_id,notnull" json:"provider_id"`
	OrganizationID   string    `bun:"organization_id,notnull" json:"organization_id"`
	Domain           string    `bun:",notnull" json:"domain"`
	VerificationHash string    `bun:"verification_hash,notnull" json:"-"`
	VerifiedAt       time.Time `bun:"verified_at,nullzero" json:"verified_at,omitempty"`
	CreatedByUserID  string    `bun:"created_by_user_id,notnull" json:"created_by_user_id"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type SessionIdentityAssurance struct {
	bun.BaseModel `bun:"table:session_identity_assurances"`

	SessionID   string    `bun:"session_id,pk" json:"session_id"`
	ProviderID  string    `bun:"provider_id,pk" json:"provider_id"`
	UserID      string    `bun:"user_id,notnull" json:"user_id"`
	AuthTime    time.Time `bun:"auth_time,notnull" json:"auth_time"`
	ExpiresAt   time.Time `bun:"expires_at,notnull" json:"expires_at"`
	ACR         string    `bun:"acr,notnull,default:''" json:"acr,omitempty"`
	AMR         string    `bun:"amr,notnull,default:'[]'" json:"-"`
	UpstreamSID string    `bun:"upstream_sid,notnull,default:''" json:"-"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type ReauthGrant struct {
	bun.BaseModel `bun:"table:reauth_grants"`

	ID         string    `bun:",pk" json:"id"`
	TokenHash  string    `bun:"token_hash,unique,notnull" json:"-"`
	UserID     string    `bun:"user_id,notnull" json:"user_id"`
	SessionID  string    `bun:"session_id,notnull" json:"session_id"`
	Action     string    `bun:",notnull" json:"action"`
	Method     string    `bun:",notnull" json:"method"`
	ProviderID string    `bun:"provider_id,nullzero" json:"provider_id,omitempty"`
	ExpiresAt  time.Time `bun:",notnull" json:"expires_at"`
	ConsumedAt time.Time `bun:",nullzero" json:"consumed_at,omitempty"`
	CreatedAt  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type OIDCNativeHandoff struct {
	bun.BaseModel `bun:"table:oidc_native_handoffs"`

	ID             string    `bun:",pk" json:"id"`
	CodeHash       string    `bun:"code_hash,unique,notnull" json:"-"`
	UserID         string    `bun:"user_id,notnull" json:"user_id"`
	SessionID      string    `bun:"session_id,notnull" json:"session_id"`
	Purpose        string    `bun:",notnull,default:'login'" json:"purpose"`
	Action         string    `bun:",notnull,default:''" json:"action,omitempty"`
	TokenEncrypted []byte    `bun:"token_encrypted,notnull" json:"-"`
	ExpiresAt      time.Time `bun:",notnull" json:"expires_at"`
	ConsumedAt     time.Time `bun:",nullzero" json:"consumed_at,omitempty"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type OIDCLogoutEvent struct {
	bun.BaseModel `bun:"table:oidc_logout_events"`

	ProviderID string    `bun:"provider_id,pk" json:"provider_id"`
	TokenHash  string    `bun:"token_hash,pk" json:"-"`
	ExpiresAt  time.Time `bun:",notnull" json:"expires_at"`
	CreatedAt  time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type IdentityAuditEvent struct {
	bun.BaseModel `bun:"table:identity_audit_events"`

	ID             string    `bun:",pk" json:"id"`
	OrganizationID string    `bun:"organization_id,nullzero" json:"organization_id,omitempty"`
	ProviderID     string    `bun:"provider_id,nullzero" json:"provider_id,omitempty"`
	ActorUserID    string    `bun:"actor_user_id,nullzero" json:"actor_user_id,omitempty"`
	SubjectUserID  string    `bun:"subject_user_id,nullzero" json:"subject_user_id,omitempty"`
	Action         string    `bun:",notnull" json:"action"`
	Detail         string    `bun:",notnull,default:''" json:"detail,omitempty"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type AuthChallenge struct {
	bun.BaseModel `bun:"table:auth_challenges"`

	ID        string    `bun:",pk" json:"id"`
	UserID    string    `bun:",notnull" json:"user_id"`
	Type      string    `bun:",notnull" json:"type"`
	Payload   string    `bun:",notnull" json:"payload"`
	ExpiresAt time.Time `bun:",notnull" json:"expires_at"`
	CreatedAt time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type APIToken struct {
	bun.BaseModel `bun:"table:api_tokens"`

	ID                 string    `bun:",pk" json:"id"`
	UserID             string    `bun:",notnull" json:"user_id"`
	Name               string    `bun:",notnull" json:"name"`
	ClientID           string    `bun:"client_id,notnull,default:''" json:"client_id,omitempty"`
	TokenHash          string    `bun:",unique,notnull" json:"-"`
	TokenPrefix        string    `bun:",notnull" json:"token_prefix"`
	Scope              string    `bun:",notnull,default:'cli:full'" json:"scope"`
	WorkspaceID        string    `json:"workspace_id"`
	OrganizationID     string    `bun:"organization_id,nullzero" json:"organization_id,omitempty"`
	IdentityProviderID string    `bun:"identity_provider_id,nullzero" json:"identity_provider_id,omitempty"`
	AssuredAt          time.Time `bun:"assured_at,nullzero" json:"assured_at,omitempty"`
	Audience           string    `json:"audience"`
	ExpiresAt          time.Time `bun:",nullzero" json:"expires_at"`
	LastUsedAt         time.Time `bun:",nullzero" json:"last_used_at"`
	RevokedAt          time.Time `bun:",nullzero" json:"revoked_at"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type MCPOAuthCode struct {
	bun.BaseModel `bun:"table:mcp_oauth_codes"`

	ID                  string    `bun:",pk" json:"id"`
	CodeHash            string    `bun:",unique,notnull" json:"-"`
	UserID              string    `bun:",notnull" json:"user_id"`
	ClientID            string    `bun:",notnull" json:"client_id"`
	ClientName          string    `json:"client_name"`
	RedirectURI         string    `bun:",notnull" json:"redirect_uri"`
	Scope               string    `bun:",notnull,default:'mcp:full'" json:"scope"`
	WorkspaceID         string    `json:"workspace_id"`
	OrganizationID      string    `bun:"organization_id,nullzero" json:"organization_id,omitempty"`
	IdentityProviderID  string    `bun:"identity_provider_id,nullzero" json:"identity_provider_id,omitempty"`
	AssuredAt           time.Time `bun:"assured_at,nullzero" json:"assured_at,omitempty"`
	TokenExpiresAt      time.Time `bun:"token_expires_at,nullzero" json:"token_expires_at,omitempty"`
	Resource            string    `json:"resource"`
	CodeChallenge       string    `bun:",notnull" json:"code_challenge"`
	CodeChallengeMethod string    `bun:",notnull" json:"code_challenge_method"`
	ExpiresAt           time.Time `bun:",notnull" json:"expires_at"`
	ConsumedAt          time.Time `bun:",nullzero" json:"consumed_at"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type CLIAuthSession struct {
	bun.BaseModel `bun:"table:cli_auth_sessions"`

	ID                 string    `bun:",pk" json:"id"`
	UserID             string    `json:"user_id"`
	DeviceCodeHash     string    `bun:",unique,notnull" json:"-"`
	UserCodeHash       string    `bun:",unique,notnull" json:"-"`
	ClientName         string    `bun:",notnull" json:"client_name"`
	ClientVersion      string    `json:"client_version"`
	ClientOS           string    `json:"client_os"`
	RequestedScopes    string    `bun:",notnull,default:'cli:full'" json:"requested_scopes"`
	WorkspaceID        string    `bun:"workspace_id,nullzero" json:"workspace_id,omitempty"`
	OrganizationID     string    `bun:"organization_id,nullzero" json:"organization_id,omitempty"`
	IdentityProviderID string    `bun:"identity_provider_id,nullzero" json:"identity_provider_id,omitempty"`
	AssuredAt          time.Time `bun:"assured_at,nullzero" json:"assured_at,omitempty"`
	TokenExpiresAt     time.Time `bun:"token_expires_at,nullzero" json:"token_expires_at,omitempty"`
	Status             string    `bun:",notnull,default:'pending'" json:"status"`
	IntervalSeconds    int       `bun:",notnull,default:5" json:"interval_seconds"`
	ExpiresAt          time.Time `bun:",notnull" json:"expires_at"`
	LastPolledAt       time.Time `bun:",nullzero" json:"last_polled_at"`
	ApprovedAt         time.Time `bun:",nullzero" json:"approved_at"`
	DeniedAt           time.Time `bun:",nullzero" json:"denied_at"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type WorkspaceMember struct {
	bun.BaseModel `bun:"table:workspace_members"`

	WorkspaceID   string    `bun:",pk" json:"workspace_id"`
	UserID        string    `bun:",pk" json:"user_id"`
	Role          string    `bun:",notnull" json:"role"` // 'admin', 'editor', 'viewer'
	Status        string    `bun:",notnull,default:'active'" json:"status"`
	CreatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
	DeactivatedAt time.Time `bun:"deactivated_at,nullzero" json:"deactivated_at,omitempty"`
}

type WorkspaceInvitation struct {
	bun.BaseModel `bun:"table:workspace_invitations"`

	ID                     string    `bun:",pk" json:"id"`
	WorkspaceID            string    `bun:",notnull" json:"workspace_id"`
	Email                  string    `bun:",notnull" json:"email"`
	Role                   string    `bun:",notnull,default:'editor'" json:"role"`
	InvitedByUserID        string    `bun:",notnull" json:"invited_by_user_id"`
	AcceptedByUserID       string    `bun:",nullzero" json:"accepted_by_user_id"`
	TokenHash              string    `bun:",unique,notnull" json:"-"`
	ExpiresAt              time.Time `bun:",notnull" json:"expires_at"`
	AcceptedAt             time.Time `bun:",nullzero" json:"accepted_at"`
	RevokedAt              time.Time `bun:",nullzero" json:"revoked_at"`
	LastSentAt             time.Time `bun:"last_sent_at,nullzero" json:"last_sent_at"`
	EmailDeliveryStatus    string    `bun:"email_delivery_status,notnull,default:'unavailable'" json:"email_delivery_status"`
	EmailDeliveryJobID     string    `bun:"email_delivery_job_id,notnull,default:''" json:"-"`
	EmailDeliveryUpdatedAt time.Time `bun:"email_delivery_updated_at,nullzero" json:"email_delivery_updated_at,omitempty"`
	CreatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// WorkspaceInvitationDeliveryEvent is redacted callback evidence. It records
// only provider event identity and OpenPost delivery references, never an
// address, invitation secret, provider payload, or response body.
type WorkspaceInvitationDeliveryEvent struct {
	bun.BaseModel `bun:"table:workspace_invitation_delivery_events"`

	EventID      string    `bun:"event_id,pk" json:"event_id"`
	InvitationID string    `bun:"invitation_id,notnull" json:"invitation_id"`
	DeliveryID   string    `bun:"delivery_id,notnull" json:"delivery_id"`
	Outcome      string    `bun:",notnull" json:"outcome"`
	OccurredAt   time.Time `bun:"occurred_at,notnull" json:"occurred_at"`
	CreatedAt    time.Time `bun:"created_at,nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// WorkspaceInvitationResend is short-lived domain state for durable,
// per-administrator resend throttling. It is separate from audit evidence so
// audit retention and projection cannot change invitation behavior.
type WorkspaceInvitationResend struct {
	bun.BaseModel `bun:"table:workspace_invitation_resends"`

	ID           string    `bun:",pk" json:"id"`
	InvitationID string    `bun:"invitation_id,notnull" json:"invitation_id"`
	ActorUserID  string    `bun:"actor_user_id,notnull" json:"actor_user_id"`
	ResentAt     time.Time `bun:"resent_at,notnull" json:"resent_at"`
}

type WorkspaceAccessAuditEvent struct {
	bun.BaseModel `bun:"table:workspace_access_audit_events"`

	ID             string    `bun:",pk" json:"id"`
	WorkspaceID    string    `bun:"workspace_id,notnull" json:"workspace_id"`
	ActorUserID    string    `bun:"actor_user_id,nullzero" json:"actor_user_id,omitempty"`
	SubjectUserID  string    `bun:"subject_user_id,nullzero" json:"subject_user_id,omitempty"`
	InvitationID   string    `bun:"invitation_id,nullzero" json:"invitation_id,omitempty"`
	SubjectEmail   string    `bun:"subject_email,notnull,default:''" json:"subject_email,omitempty"`
	Action         string    `bun:",notnull" json:"action"`
	PreviousRole   string    `bun:"previous_role,notnull,default:''" json:"previous_role,omitempty"`
	Role           string    `bun:",notnull,default:''" json:"role,omitempty"`
	PreviousStatus string    `bun:"previous_status,notnull,default:''" json:"previous_status,omitempty"`
	Status         string    `bun:",notnull,default:''" json:"status,omitempty"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// WorkspaceLifecycleAuditEvent retains permission-safe evidence after the
// Workspace and its content have been permanently removed.
type WorkspaceLifecycleAuditEvent struct {
	bun.BaseModel `bun:"table:workspace_lifecycle_audit_events"`

	ID             string    `bun:",pk" json:"id"`
	OrganizationID string    `bun:"organization_id,notnull" json:"organization_id"`
	WorkspaceID    string    `bun:"workspace_id,notnull" json:"workspace_id"`
	WorkspaceName  string    `bun:"workspace_name,notnull" json:"workspace_name"`
	ActorUserID    string    `bun:"actor_user_id,nullzero" json:"actor_user_id,omitempty"`
	Action         string    `bun:",notnull" json:"action"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type UsageCounter struct {
	bun.BaseModel `bun:"table:usage_counters"`

	WorkspaceID string    `bun:",pk" json:"workspace_id"`
	Metric      string    `bun:",pk" json:"metric"`
	PeriodStart time.Time `bun:",pk" json:"period_start"`
	Value       int64     `bun:",notnull,default:0" json:"value"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// ProviderUsageEvent is an immutable estimate of a confirmed successful hosted
// provider request. OperationKey makes one confirmed request idempotent without
// retaining post text, provider responses, or credentials.
type ProviderUsageEvent struct {
	bun.BaseModel `bun:"table:provider_usage_events"`

	ID               string    `bun:",pk" json:"id"`
	WorkspaceID      string    `bun:",notnull" json:"workspace_id"`
	Provider         string    `bun:",notnull" json:"provider"`
	Operation        string    `bun:",notnull" json:"operation"`
	OperationKey     string    `bun:",notnull,unique" json:"operation_key"`
	Units            int64     `bun:",notnull" json:"units"`
	UnitCostMicrousd int64     `bun:",notnull" json:"unit_cost_microusd"`
	CostMicrousd     int64     `bun:",notnull" json:"cost_microusd"`
	OccurredAt       time.Time `bun:",notnull" json:"occurred_at"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// ProviderUsageReservation holds the bounded cost exposure for an in-flight or
// ambiguous provider request. It is mutable operational state, not billable
// usage, and is removed after a confirmed success or definite failure.
type ProviderUsageReservation struct {
	bun.BaseModel `bun:"table:provider_usage_reservations"`

	OperationKey     string    `bun:",pk" json:"operation_key"`
	WorkspaceID      string    `bun:",notnull" json:"workspace_id"`
	Provider         string    `bun:",notnull" json:"provider"`
	Operation        string    `bun:",notnull" json:"operation"`
	State            string    `bun:",notnull" json:"state"`
	Units            int64     `bun:",notnull" json:"units"`
	UnitCostMicrousd int64     `bun:",notnull" json:"unit_cost_microusd"`
	CostMicrousd     int64     `bun:",notnull" json:"cost_microusd"`
	OccurredAt       time.Time `bun:",notnull" json:"occurred_at"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// ProviderUsagePeriodCounter is a monthly projection of immutable confirmed
// usage events plus active reservations. It can be rebuilt from both sources.
type ProviderUsagePeriodCounter struct {
	bun.BaseModel `bun:"table:provider_usage_period_counters"`

	WorkspaceID        string    `bun:",pk" json:"workspace_id"`
	PeriodStart        time.Time `bun:",pk" json:"period_start"`
	Provider           string    `bun:",pk" json:"provider"`
	Operation          string    `bun:",pk" json:"operation"`
	EventCount         int64     `bun:",notnull,default:0" json:"event_count"`
	Units              int64     `bun:",notnull,default:0" json:"units"`
	CostMicrousd       int64     `bun:",notnull,default:0" json:"cost_microusd"`
	ReservedEventCount int64     `bun:",notnull,default:0" json:"reserved_event_count"`
	ReservedUnits      int64     `bun:",notnull,default:0" json:"reserved_units"`
	ReservedMicrousd   int64     `bun:"reserved_cost_microusd,notnull,default:0" json:"reserved_cost_microusd"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

const BillingProviderPaddle = "paddle"

type BillingSubscription struct {
	bun.BaseModel `bun:"table:billing_subscriptions"`

	OrganizationID         string    `bun:",pk" json:"organization_id"`
	WorkspaceID            string    `json:"workspace_id,omitempty"`
	Provider               string    `bun:",notnull,default:'paddle'" json:"provider"`
	ProviderCustomerID     string    `bun:",notnull" json:"provider_customer_id"`
	ProviderSubscriptionID string    `bun:",notnull,unique" json:"provider_subscription_id"`
	ProviderProductID      string    `json:"provider_product_id"`
	ProviderPriceID        string    `json:"provider_price_id"`
	Status                 string    `bun:",notnull" json:"status"`
	PlanID                 string    `bun:",notnull,default:''" json:"plan_id"`
	EntitlementSnapshot    string    `bun:",notnull,default:'{}'" json:"entitlement_snapshot"`
	CurrentPeriodEnd       time.Time `bun:",nullzero" json:"current_period_end"`
	CancelAtPeriodEnd      bool      `bun:",notnull,default:false" json:"cancel_at_period_end"`
	ProviderUpdatedAt      time.Time `bun:",nullzero" json:"provider_updated_at"`
	PastDueSince           time.Time `bun:",nullzero" json:"past_due_since"`
	RawPayload             string    `bun:",notnull,default:'{}'" json:"raw_payload"`
	CreatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type BillingWebhookEvent struct {
	bun.BaseModel `bun:"table:billing_webhook_events"`

	EventID     string    `bun:",pk" json:"event_id"`
	Provider    string    `bun:",notnull,default:'paddle'" json:"provider"`
	EventType   string    `bun:",notnull" json:"event_type"`
	OccurredAt  time.Time `bun:",nullzero" json:"occurred_at"`
	ProcessedAt time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"processed_at"`
}

type BillingCheckoutAttempt struct {
	bun.BaseModel `bun:"table:billing_checkout_attempts"`

	CheckoutAttemptID      string    `bun:",pk" json:"checkout_attempt_id"`
	OrganizationID         string    `bun:",notnull" json:"organization_id"`
	WorkspaceID            string    `json:"workspace_id,omitempty"`
	UserID                 string    `json:"user_id,omitempty"`
	Provider               string    `bun:",notnull,default:'paddle'" json:"provider"`
	ProviderPriceID        string    `bun:",notnull" json:"provider_price_id"`
	ProviderSubscriptionID string    `json:"provider_subscription_id,omitempty"`
	PlanID                 string    `bun:",notnull" json:"plan_id"`
	BillingPeriod          string    `bun:",notnull" json:"billing_period"`
	ConfirmationKey        string    `bun:"confirmation_key,notnull,default:''" json:"-"`
	ReturnPath             string    `bun:"return_path,notnull,default:''" json:"-"`
	Status                 string    `bun:",notnull,default:'created'" json:"status"`
	ReturnConsumedAt       time.Time `bun:"return_consumed_at,nullzero" json:"-"`
	CreatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt              time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type BillingCustomer struct {
	bun.BaseModel `bun:"table:billing_customers"`

	Provider           string    `bun:",pk,notnull" json:"provider"`
	ProviderCustomerID string    `bun:",pk,notnull" json:"provider_customer_id"`
	Email              string    `bun:",notnull,default:''" json:"email"`
	Name               string    `bun:",notnull,default:''" json:"name"`
	RawPayload         string    `bun:",notnull,default:'{}'" json:"raw_payload"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type MCPToolCall struct {
	bun.BaseModel `bun:"table:mcp_tool_calls"`

	ID                string    `bun:",pk" json:"id"`
	UserID            string    `bun:",notnull" json:"user_id"`
	WorkspaceID       string    `bun:",nullzero" json:"workspace_id"`
	ClientID          string    `bun:",nullzero" json:"client_id"`
	ClientName        string    `json:"client_name"`
	ClientScope       string    `json:"client_scope"`
	ClientTokenPrefix string    `json:"client_token_prefix"`
	ToolName          string    `bun:",notnull" json:"tool_name"`
	Status            string    `bun:",notnull" json:"status"`
	ErrorMessage      string    `json:"error_message"`
	DurationMs        int64     `bun:",notnull,default:0" json:"duration_ms"`
	CreatedAt         time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type MastodonInstance struct {
	bun.BaseModel `bun:"table:mastodon_instances"`

	ID                 string    `bun:",pk" json:"id"`
	InstanceURL        string    `bun:",unique,notnull" json:"instance_url"`
	Host               string    `bun:",notnull" json:"host"`
	ClientID           string    `bun:",notnull" json:"client_id"`
	ClientSecretEnc    []byte    `bun:"client_secret_encrypted,notnull" json:"-"`
	RedirectURI        string    `bun:",notnull" json:"redirect_uri"`
	Scopes             string    `bun:",notnull,default:'read write'" json:"scopes"`
	RegistrationStatus string    `bun:",notnull,default:'registered'" json:"registration_status"`
	LastVerifiedAt     time.Time `bun:",nullzero" json:"last_verified_at"`
	BlockedAt          time.Time `bun:",nullzero" json:"blocked_at"`
	BlockReason        string    `json:"block_reason"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type ProviderApp struct {
	bun.BaseModel `bun:"table:provider_apps"`

	ID              string    `bun:",pk" json:"id"`
	Provider        string    `bun:",notnull" json:"provider"`
	Name            string    `bun:",notnull,default:''" json:"name"`
	ClientID        string    `bun:",notnull,default:''" json:"client_id"`
	ClientSecretEnc []byte    `bun:"client_secret_encrypted" json:"-"`
	RedirectURI     string    `bun:",notnull,default:''" json:"redirect_uri"`
	InstanceURL     string    `bun:",notnull,default:''" json:"instance_url"`
	IsActive        bool      `bun:",notnull,default:true" json:"is_active"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// ProviderApprovalReview is an append-only operator review of the approval
// boundary for one effective provider application. App and instance values are
// one-way fingerprints so credentials and provider URLs never enter the
// readiness ledger.
type ProviderApprovalReview struct {
	bun.BaseModel `bun:"table:provider_approval_reviews"`

	ID                  string    `bun:",pk" json:"id"`
	Provider            string    `bun:",notnull" json:"provider"`
	AppFingerprint      string    `bun:"app_fingerprint,notnull" json:"app_fingerprint"`
	ProviderEnvironment string    `bun:"provider_environment,notnull" json:"provider_environment"`
	InstanceFingerprint string    `bun:"instance_fingerprint,notnull,default:''" json:"instance_fingerprint,omitempty"`
	ApprovalState       string    `bun:"approval_state,notnull" json:"approval_state"`
	ApprovalTier        string    `bun:"approval_tier,notnull" json:"approval_tier"`
	SourceURL           string    `bun:"source_url,notnull" json:"source_url"`
	ReviewedAt          time.Time `bun:"reviewed_at,notnull" json:"reviewed_at"`
	ExpiresAt           time.Time `bun:"expires_at,notnull" json:"expires_at"`
	OperatorRef         string    `bun:"operator_ref,notnull" json:"-"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// ProviderCertificationRun is one immutable local or live execution proof for
// an exact provider subject and certification contract. The related check rows
// contain only normalized results and one-way external references.
type ProviderCertificationRun struct {
	bun.BaseModel `bun:"table:provider_certification_runs"`

	ID                    string    `bun:",pk" json:"id"`
	ApprovalReviewID      string    `bun:"approval_review_id,notnull" json:"approval_review_id"`
	EvidenceKind          string    `bun:"evidence_kind,notnull" json:"evidence_kind"`
	SubjectDigest         string    `bun:"subject_digest,notnull" json:"subject_digest"`
	Provider              string    `bun:",notnull" json:"provider"`
	AppFingerprint        string    `bun:"app_fingerprint,notnull" json:"app_fingerprint"`
	DeploymentEnvironment string    `bun:"deployment_environment,notnull" json:"deployment_environment"`
	ProviderEnvironment   string    `bun:"provider_environment,notnull" json:"provider_environment"`
	InstanceFingerprint   string    `bun:"instance_fingerprint,notnull,default:''" json:"instance_fingerprint,omitempty"`
	AccountKind           string    `bun:"account_kind,notnull,default:''" json:"account_kind,omitempty"`
	AccountReferenceHash  string    `bun:"account_reference_hash,notnull,default:''" json:"-"`
	OutputProfile         string    `bun:"output_profile,notnull,default:''" json:"output_profile,omitempty"`
	Operation             string    `bun:",notnull" json:"operation"`
	PolicyMode            string    `bun:"policy_mode,notnull" json:"policy_mode"`
	TestedRevision        string    `bun:"tested_revision,notnull" json:"tested_revision"`
	ContractDigest        string    `bun:"contract_digest,notnull" json:"contract_digest"`
	ApprovalStateAtTest   string    `bun:"approval_state_at_test,notnull" json:"approval_state_at_test"`
	ApprovalTierAtTest    string    `bun:"approval_tier_at_test,notnull" json:"approval_tier_at_test"`
	RequiredScopesJSON    string    `bun:"required_scopes_json,notnull" json:"-"`
	GrantedScopesJSON     string    `bun:"granted_scopes_json,notnull" json:"-"`
	OperatorRef           string    `bun:"operator_ref,notnull" json:"-"`
	TestedAt              time.Time `bun:"tested_at,notnull" json:"tested_at"`
	ExpiresAt             time.Time `bun:"expires_at,notnull" json:"expires_at"`
	CreatedAt             time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type ProviderCertificationCheck struct {
	bun.BaseModel `bun:"table:provider_certification_checks"`

	ID                    string    `bun:",pk" json:"id"`
	CertificationRunID    string    `bun:"certification_run_id,notnull" json:"certification_run_id"`
	Kind                  string    `bun:",notnull" json:"kind"`
	Outcome               string    `bun:",notnull" json:"outcome"`
	ErrorClass            string    `bun:"error_class,notnull,default:''" json:"error_class,omitempty"`
	NotApplicableReason   string    `bun:"not_applicable_reason,notnull,default:''" json:"not_applicable_reason,omitempty"`
	ExternalReferenceHash string    `bun:"external_reference_hash,notnull,default:''" json:"-"`
	CompletedAt           time.Time `bun:"completed_at,notnull" json:"completed_at"`
	CreatedAt             time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// ProviderRuntimeControlEvent is an append-only kill-switch event. Empty
// selector fields are deliberate wildcards; the readiness service resolves all
// matching scopes and applies the most restrictive current state.
type ProviderRuntimeControlEvent struct {
	bun.BaseModel `bun:"table:provider_runtime_control_events"`

	ID                    string    `bun:",pk" json:"id"`
	Provider              string    `bun:",notnull" json:"provider"`
	AppFingerprint        string    `bun:"app_fingerprint,notnull,default:''" json:"app_fingerprint,omitempty"`
	DeploymentEnvironment string    `bun:"deployment_environment,notnull,default:''" json:"deployment_environment,omitempty"`
	ProviderEnvironment   string    `bun:"provider_environment,notnull,default:''" json:"provider_environment,omitempty"`
	InstanceFingerprint   string    `bun:"instance_fingerprint,notnull,default:''" json:"instance_fingerprint,omitempty"`
	AccountKind           string    `bun:"account_kind,notnull,default:''" json:"account_kind,omitempty"`
	OutputProfile         string    `bun:"output_profile,notnull,default:''" json:"output_profile,omitempty"`
	Operation             string    `bun:",notnull,default:''" json:"operation,omitempty"`
	PolicyMode            string    `bun:"policy_mode,notnull,default:''" json:"policy_mode,omitempty"`
	State                 string    `bun:",notnull" json:"state"`
	ReasonCode            string    `bun:"reason_code,notnull" json:"reason_code"`
	StartsAt              time.Time `bun:"starts_at,notnull" json:"starts_at"`
	ExpiresAt             time.Time `bun:"expires_at,nullzero" json:"expires_at,omitempty"`
	OperatorRef           string    `bun:"operator_ref,notnull" json:"-"`
	CreatedAt             time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// InstanceSetting stores an administrator-managed override for an optional
// runtime setting. Values are encrypted even when they are not secrets so the
// table never becomes a second plaintext environment file.
type InstanceSetting struct {
	bun.BaseModel `bun:"table:instance_settings"`

	Key            string    `bun:",pk" json:"key"`
	ValueEncrypted []byte    `bun:"value_encrypted,notnull" json:"-"`
	UpdatedByID    string    `bun:"updated_by_id,nullzero" json:"updated_by_id,omitempty"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// OAuthGrant is one provider authorization. Destination accounts reference a
// grant instead of owning credential copies so token rotation and revocation
// have one atomic consistency boundary.
type OAuthGrant struct {
	bun.BaseModel `bun:"table:oauth_grants"`

	ID                    string    `bun:",pk" json:"id"`
	WorkspaceID           string    `bun:",notnull" json:"workspace_id"`
	Provider              string    `bun:",notnull" json:"provider"`
	ProviderProjectID     string    `bun:"provider_project_id,notnull,default:''" json:"provider_project_id,omitempty"`
	ProviderSubject       string    `bun:"provider_subject,notnull,default:''" json:"provider_subject,omitempty"`
	InstanceURL           string    `bun:"instance_url,notnull,default:''" json:"instance_url,omitempty"`
	AccessTokenEnc        []byte    `bun:"access_token_encrypted,notnull" json:"-"`
	RefreshTokenEnc       []byte    `bun:"refresh_token_encrypted" json:"-"`
	AccessTokenExpiresAt  time.Time `bun:"access_token_expires_at,nullzero" json:"access_token_expires_at,omitempty"`
	RefreshTokenExpiresAt time.Time `bun:"refresh_token_expires_at,nullzero" json:"refresh_token_expires_at,omitempty"`
	GrantedScopes         string    `bun:"granted_scopes,notnull,default:''" json:"granted_scopes,omitempty"`
	TokenType             string    `bun:"token_type,notnull,default:''" json:"token_type,omitempty"`
	TokenVersion          int64     `bun:"token_version,notnull,default:1" json:"token_version"`
	ExecutionMode         string    `bun:"execution_mode,notnull,default:'user_oauth'" json:"execution_mode"`
	AuthorizationEvidence string    `bun:"authorization_evidence_json,notnull,default:'{}'" json:"-"`
	ConsentedByID         string    `bun:"consented_by_id,notnull,default:''" json:"consented_by_id,omitempty"`
	ConsentedAt           time.Time `bun:"consented_at,nullzero" json:"consented_at,omitempty"`
	ValidatedAt           time.Time `bun:"validated_at,nullzero" json:"validated_at,omitempty"`
	ValidationStatus      string    `bun:"validation_status,notnull,default:'valid'" json:"validation_status"`
	RefreshLeaseOwner     string    `bun:"refresh_lease_owner,notnull,default:''" json:"-"`
	RefreshLeaseExpiresAt time.Time `bun:"refresh_lease_expires_at,nullzero" json:"-"`
	LastRefreshStartedAt  time.Time `bun:"last_refresh_started_at,nullzero" json:"-"`
	LastRefreshFinishedAt time.Time `bun:"last_refresh_finished_at,nullzero" json:"-"`
	LastRefreshError      string    `bun:"last_refresh_error,notnull,default:''" json:"-"`
	RevokedByID           string    `bun:"revoked_by_id,notnull,default:''" json:"revoked_by_id,omitempty"`
	RevocationReason      string    `bun:"revocation_reason,notnull,default:''" json:"revocation_reason,omitempty"`
	RevokedAt             time.Time `bun:"revoked_at,nullzero" json:"revoked_at,omitempty"`
	CreatedAt             time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt             time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type SocialAccount struct {
	bun.BaseModel `bun:"table:social_accounts"`

	ID               string `bun:",pk" json:"id"`
	WorkspaceID      string `bun:",notnull" json:"workspace_id"`
	Slug             string `bun:",notnull" json:"slug"`
	Platform         string `bun:",notnull" json:"platform"` // 'x', 'threads', 'linkedin', 'mastodon', 'bluesky', 'instagram', 'facebook', 'youtube', 'tiktok'
	AccountID        string `bun:",notnull" json:"account_id"`
	AccountUsername  string `json:"account_username"`
	AccountAvatarURL string `json:"account_avatar_url"`
	InstanceURL      string `json:"instance_url"` // Used for Mastodon domains and Bluesky PDS
	OAuthGrantID     string `bun:"oauth_grant_id,notnull,default:''" json:"oauth_grant_id,omitempty"`

	// Deprecated credential mirrors remain only for rolling migration and old
	// test fixtures. Runtime credential reads and writes use OAuthGrant.
	AccessTokenEnc      []byte    `bun:"access_token_encrypted,notnull" json:"-"`
	RefreshTokenEnc     []byte    `bun:"refresh_token_encrypted" json:"-"`
	TokenExpiresAt      time.Time `json:"token_expires_at"`
	GrantedScopes       string    `bun:"granted_scopes,notnull,default:''" json:"granted_scopes,omitempty"`
	CapabilityState     string    `bun:"capability_state_json,notnull,default:'{}'" json:"-"`
	CapabilityCheckedAt time.Time `bun:"capability_checked_at,nullzero" json:"-"`

	IsActive     bool      `bun:",default:true" json:"is_active"`
	ErrorMessage string    `json:"error_message"`
	CreatedAt    time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	ClaimedFirst bool      `bun:"-" json:"-"`
}

type WorkspaceFirstConnection struct {
	bun.BaseModel `bun:"table:workspace_first_connections"`

	WorkspaceID string    `bun:",pk" json:"workspace_id"`
	AccountID   string    `bun:",notnull" json:"account_id"`
	OriginKey   string    `bun:",notnull,default:''" json:"-"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type WorkspaceFirstComposition struct {
	bun.BaseModel `bun:"table:workspace_first_compositions"`

	WorkspaceID string    `bun:",pk" json:"workspace_id"`
	Signal      string    `bun:",notnull" json:"signal"`
	OriginKey   string    `bun:",notnull,default:''" json:"-"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type WorkspaceActivation struct {
	bun.BaseModel `bun:"table:workspace_activations"`

	ID            string    `bun:",pk" json:"id"`
	WorkspaceID   string    `bun:",unique,notnull" json:"workspace_id"`
	PublicationID string    `bun:",notnull" json:"publication_id"`
	CreatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type ProductAnalyticsEvent struct {
	bun.BaseModel `bun:"table:product_analytics_events"`

	ID          string    `bun:",pk" json:"id"`
	WorkspaceID string    `bun:",notnull" json:"workspace_id"`
	Name        string    `bun:",notnull" json:"name"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type XOAuthRequestToken struct {
	bun.BaseModel `bun:"table:x_oauth_request_tokens"`

	RequestToken    string    `bun:",pk" json:"request_token"`
	RequestSecret   string    `bun:",notnull" json:"-"`
	WorkspaceID     string    `bun:",notnull" json:"workspace_id"`
	UserID          string    `bun:",notnull" json:"user_id"`
	ExecutionIntent string    `bun:"execution_intent,notnull,default:''" json:"-"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type OAuthAccountSelection struct {
	bun.BaseModel `bun:"table:oauth_account_selections"`

	ID              string    `bun:",pk" json:"id"`
	UserID          string    `bun:",notnull" json:"user_id"`
	WorkspaceID     string    `bun:",notnull" json:"workspace_id"`
	Platform        string    `bun:",notnull" json:"platform"`
	InstanceURL     string    `json:"instance_url"`
	ExecutionIntent string    `bun:"execution_intent,notnull,default:''" json:"-"`
	AccessTokenEnc  []byte    `bun:"access_token_encrypted,notnull" json:"-"`
	RefreshTokenEnc []byte    `bun:"refresh_token_encrypted" json:"-"`
	TokenType       string    `json:"token_type"`
	TokenExpiresAt  time.Time `json:"token_expires_at"`
	TokenExtraJSON  string    `bun:"token_extra_json,notnull,default:'{}'" json:"-"`
	OptionsJSON     string    `bun:"options_json,notnull,default:'[]'" json:"-"`
	ExpiresAt       time.Time `bun:",notnull" json:"expires_at"`
	ConsumedAt      time.Time `bun:",nullzero" json:"consumed_at"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type OAuthAccountSelectionReservation struct {
	bun.BaseModel `bun:"table:oauth_account_selection_reservations"`

	SelectionID string    `bun:",pk" json:"selection_id"`
	ReservedAt  time.Time `bun:",notnull" json:"reserved_at"`
}

// Publication is the user's canonical unit of intent: one idea, launch,
// update, or announcement that can produce platform-specific posts.
type Publication struct {
	bun.BaseModel `bun:"table:publications"`

	ID              string    `bun:",pk" json:"id"`
	WorkspaceID     string    `bun:",notnull" json:"workspace_id"`
	CreatedByID     string    `bun:"created_by,notnull" json:"created_by"`
	Title           string    `bun:",notnull" json:"title"`
	Intent          string    `bun:"intent,notnull,default:'post'" json:"intent"`
	CreationPreset  string    `bun:"creation_preset,notnull,default:'post'" json:"creation_preset"`
	SocialSetID     string    `bun:"social_set_id,notnull,default:''" json:"social_set_id,omitempty"`
	ContentProfile  string    `bun:"content_profile,notnull,default:'short_text'" json:"content_profile"`
	SourceText      string    `bun:"source_text,notnull,default:''" json:"source_text"`
	SourceContent   string    `bun:"source_content,notnull" json:"source_content"` // legacy mirror until old post flows are removed
	SourceURL       string    `bun:"source_url" json:"source_url"`
	Goal            string    `json:"goal"`
	Audience        string    `json:"audience"`
	Status          string    `bun:",notnull,default:'draft'" json:"status"`
	Revision        int       `bun:",notnull,default:1" json:"revision"`
	ScheduledAt     time.Time `bun:"scheduled_at,nullzero" json:"scheduled_at"`
	ActualRunAt     time.Time `bun:"actual_run_at,nullzero" json:"actual_run_at"`
	MetadataJSON    string    `bun:"metadata_json,notnull,default:'{}'" json:"metadata_json"`
	ReleasePlanJSON string    `bun:"release_plan_json,notnull,default:'{}'" json:"release_plan_json"` // legacy mirror until old post flows are removed
	RepostOverride  string    `bun:"repost_override_json,notnull,default:'{}'" json:"repost_override_json"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
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

// SocialSetAccount stores stable membership plus an optional destination-format
// default. It never changes renditions already snapshotted into a publication.
type SocialSetAccount struct {
	bun.BaseModel `bun:"table:social_set_accounts"`

	SocialSetID          string    `bun:"social_set_id,pk" json:"social_set_id"`
	SocialAccountID      string    `bun:"social_account_id,pk" json:"social_account_id"`
	DisplayOrder         int       `bun:"display_order,notnull,default:0" json:"display_order"`
	DefaultOutputProfile string    `bun:"default_output_profile,notnull,default:''" json:"default_output_profile,omitempty"`
	CreatedAt            time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

// RepostPolicy is a workspace-owned rule that turns a published rendition into
// a native provider repost after its time and engagement gates are satisfied.
type RepostPolicy struct {
	bun.BaseModel `bun:"table:repost_policies"`

	ID                      string    `bun:",pk" json:"id"`
	WorkspaceID             string    `bun:"workspace_id,notnull" json:"workspace_id"`
	Name                    string    `bun:",notnull" json:"name"`
	Enabled                 bool      `bun:",notnull,default:true" json:"enabled"`
	DelaySeconds            int       `bun:"delay_seconds,notnull,default:86400" json:"delay_seconds"`
	EvaluationWindowSeconds int       `bun:"evaluation_window_seconds,notnull,default:604800" json:"evaluation_window_seconds"`
	ThresholdMode           string    `bun:"threshold_mode,notnull,default:'all'" json:"threshold_mode"`
	MinLikes                int64     `bun:"min_likes,notnull,default:0" json:"min_likes"`
	MinComments             int64     `bun:"min_comments,notnull,default:0" json:"min_comments"`
	MinReposts              int64     `bun:"min_reposts,notnull,default:0" json:"min_reposts"`
	MinViews                int64     `bun:"min_views,notnull,default:0" json:"min_views"`
	RequirePlateau          bool      `bun:"require_plateau,notnull,default:false" json:"require_plateau"`
	PlateauChecks           int       `bun:"plateau_checks,notnull,default:2" json:"plateau_checks"`
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

	SegmentID    string `bun:"segment_id,pk" json:"segment_id"`
	MediaID      string `bun:"media_id,pk" json:"media_id"`
	DisplayOrder int    `bun:"display_order,notnull,default:0" json:"display_order"`
	SettingsJSON string `bun:"settings_json,notnull,default:'{}'" json:"settings_json"`
}

type Rendition struct {
	bun.BaseModel `bun:"table:renditions"`

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

// AnalyticsAccountSnapshot is an immutable provider measurement. MetricsJSON
// contains only normalized counters; provider responses and tokens are never
// retained.
type AnalyticsAccountSnapshot struct {
	bun.BaseModel `bun:"table:analytics_account_snapshots"`

	ID              string    `bun:",pk" json:"id"`
	WorkspaceID     string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SocialAccountID string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform        string    `bun:",notnull" json:"platform"`
	MetricsJSON     string    `bun:"metrics_json,notnull,default:'{}'" json:"metrics_json"`
	CaptureKey      string    `bun:"capture_key,notnull,default:''" json:"-"`
	CapturedAt      time.Time `bun:"captured_at,notnull" json:"captured_at"`
}

// AnalyticsRenditionSnapshot stores aggregate metrics for one provider
// rendition. Thread segment counters are normalized into the rendition total.
type AnalyticsRenditionSnapshot struct {
	bun.BaseModel `bun:"table:analytics_rendition_snapshots"`

	ID              string    `bun:",pk" json:"id"`
	WorkspaceID     string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID   string    `bun:"publication_id,notnull" json:"publication_id"`
	RenditionID     string    `bun:"rendition_id,notnull" json:"rendition_id"`
	SocialAccountID string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform        string    `bun:",notnull" json:"platform"`
	MetricsJSON     string    `bun:"metrics_json,notnull,default:'{}'" json:"metrics_json"`
	CaptureKey      string    `bun:"capture_key,notnull,default:''" json:"-"`
	CapturedAt      time.Time `bun:"captured_at,notnull" json:"captured_at"`
}

// AnalyticsSyncState is the latest collection state for an account or
// rendition. SubjectID is namespaced by SubjectType through the primary ID.
type AnalyticsSyncState struct {
	bun.BaseModel `bun:"table:analytics_sync_states"`

	ID              string    `bun:",pk" json:"id"`
	WorkspaceID     string    `bun:"workspace_id,notnull" json:"workspace_id"`
	SubjectType     string    `bun:"subject_type,notnull" json:"subject_type"`
	SubjectID       string    `bun:"subject_id,notnull" json:"subject_id"`
	SocialAccountID string    `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform        string    `bun:",notnull" json:"platform"`
	Status          string    `bun:",notnull,default:'pending'" json:"status"`
	ErrorCode       string    `bun:"error_code,notnull,default:''" json:"error_code"`
	ErrorMessage    string    `bun:"error_message,notnull,default:''" json:"error_message"`
	MetricsJSON     string    `bun:"metrics_json,notnull,default:'{}'" json:"metrics_json"`
	LastAttemptedAt time.Time `bun:"last_attempted_at,nullzero" json:"last_attempted_at"`
	LastSuccessAt   time.Time `bun:"last_success_at,nullzero" json:"last_success_at"`
	NextSyncAt      time.Time `bun:"next_sync_at,nullzero" json:"next_sync_at"`
	UnchangedStreak int       `bun:"unchanged_streak,notnull,default:0" json:"unchanged_streak"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

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
	bun.BaseModel `bun:"table:engagement_items"`

	ID                   string                 `bun:",pk" json:"id"`
	WorkspaceID          string                 `bun:"workspace_id,notnull" json:"workspace_id"`
	RenditionID          string                 `bun:"rendition_id,notnull" json:"rendition_id"`
	SocialAccountID      string                 `bun:"social_account_id,notnull" json:"social_account_id"`
	Platform             string                 `bun:",notnull" json:"platform"`
	RemoteID             string                 `bun:"remote_id,notnull" json:"remote_id"`
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

	ID              string    `bun:",pk" json:"id"`
	WorkspaceID     string    `bun:"workspace_id,notnull" json:"workspace_id"`
	ConversationID  string    `bun:"conversation_id,notnull" json:"conversation_id"`
	RemoteMessageID string    `bun:"remote_message_id,notnull,default:''" json:"remote_message_id"`
	Direction       string    `bun:",notnull" json:"direction"`
	AuthorRemoteID  string    `bun:"author_remote_id,notnull,default:''" json:"author_remote_id"`
	Body            string    `bun:",notnull,default:''" json:"body"`
	AttachmentsJSON string    `bun:"attachments_json,notnull,default:'[]'" json:"attachments_json"`
	SendStatus      string    `bun:"send_status,notnull,default:'received'" json:"send_status"`
	ErrorMessage    string    `bun:"error_message,notnull,default:''" json:"error_message"`
	RemoteCreatedAt time.Time `bun:"remote_created_at,nullzero" json:"remote_created_at"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// CommunicationSyncState is the latest safe cursor and collection state for
// one engagement or messaging subject.
type CommunicationSyncState struct {
	bun.BaseModel `bun:"table:communication_sync_states"`

	ID               string    `bun:",pk" json:"id"`
	WorkspaceID      string    `bun:"workspace_id,notnull" json:"workspace_id"`
	Capability       string    `bun:",notnull" json:"capability"`
	SubjectType      string    `bun:"subject_type,notnull" json:"subject_type"`
	SubjectID        string    `bun:"subject_id,notnull" json:"subject_id"`
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
	ReadAt      time.Time            `bun:"read_at,nullzero" json:"read_at"`
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

type PublicationLifecycleEvent struct {
	bun.BaseModel `bun:"table:publication_lifecycle_events"`

	ID             string    `bun:",pk" json:"id"`
	WorkspaceID    string    `bun:"workspace_id,notnull" json:"workspace_id"`
	PublicationID  string    `bun:"publication_id,notnull" json:"publication_id"`
	RenditionID    string    `bun:"rendition_id,notnull,default:''" json:"rendition_id"`
	Type           string    `bun:"type,notnull" json:"type"`
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
	ScheduledAt        time.Time `json:"scheduled_at"`
	PublishedAt        time.Time `json:"published_at"`
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
	VideoProjectID     string    `bun:"video_project_id,notnull,default:''" json:"video_project_id,omitempty"`
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

// VideoProject is the small cloud-synced head for a local-first OpenPost Video Editor
// project. Source bytes remain normal Media library assets and are linked
// through VideoProjectAsset.
type VideoProject struct {
	bun.BaseModel `bun:"table:video_projects"`

	ID                  string    `bun:",pk" json:"id"`
	WorkspaceID         string    `bun:",notnull" json:"workspace_id"`
	CreatedByID         string    `bun:"created_by_id,notnull" json:"created_by_id"`
	Title               string    `bun:",notnull" json:"title"`
	SchemaVersion       int       `bun:"schema_version,notnull,default:1" json:"schema_version"`
	Revision            int       `bun:",notnull,default:1" json:"revision"`
	DocumentJSON        string    `bun:"document_json,notnull" json:"-"`
	DurationMS          int64     `bun:"duration_ms,notnull,default:0" json:"duration_ms"`
	CoverPreviewMediaID string    `bun:"cover_preview_media_id,nullzero" json:"cover_preview_media_id,omitempty"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
	DeletedAt           time.Time `bun:",nullzero" json:"deleted_at,omitempty"`
}

type VideoProjectAsset struct {
	bun.BaseModel `bun:"table:video_project_assets"`

	VideoProjectID string    `bun:"video_project_id,pk" json:"video_project_id"`
	SourceID       string    `bun:"source_id,pk" json:"source_id"`
	RevisionID     string    `bun:"revision_id,nullzero" json:"revision_id,omitempty"`
	MediaID        string    `bun:"media_id,notnull" json:"media_id"`
	Usage          string    `bun:",notnull,default:'source'" json:"usage"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type VideoProjectRevision struct {
	bun.BaseModel `bun:"table:video_project_revisions"`

	ID             string    `bun:",pk" json:"id"`
	VideoProjectID string    `bun:"video_project_id,notnull" json:"video_project_id"`
	Revision       int       `bun:",notnull" json:"revision"`
	Kind           string    `bun:",notnull" json:"kind"`
	Name           string    `bun:",notnull,default:''" json:"name"`
	Snapshot       []byte    `bun:",notnull" json:"-"`
	CreatedByID    string    `bun:"created_by_id,notnull" json:"created_by_id"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	ExpiresAt      time.Time `bun:",nullzero" json:"expires_at,omitempty"`
}

type VideoRevisionMediaIndexState struct {
	bun.BaseModel `bun:"table:video_revision_media_index_state"`

	RevisionID        string    `bun:"revision_id,pk" json:"revision_id"`
	MediaCount        int       `bun:"media_count,notnull,default:0" json:"media_count"`
	MissingMediaCount int       `bun:"missing_media_count,notnull,default:0" json:"missing_media_count"`
	Status            string    `bun:",notnull,default:'complete'" json:"status"`
	FailureCode       string    `bun:"failure_code,notnull,default:''" json:"failure_code,omitempty"`
	ProcessedAt       time.Time `bun:"processed_at,nullzero,notnull,default:current_timestamp" json:"processed_at"`
}

type VideoReturnToken struct {
	bun.BaseModel `bun:"table:video_return_tokens"`

	ID              string    `bun:",pk" json:"id"`
	TokenHash       string    `bun:",notnull,unique" json:"-"`
	WorkspaceID     string    `bun:",notnull" json:"workspace_id"`
	UserID          string    `bun:",notnull" json:"user_id"`
	ReturnURL       string    `bun:",notnull" json:"return_url"`
	Purpose         string    `bun:",notnull" json:"purpose"`
	ConstraintsJSON string    `bun:"constraints_json,notnull" json:"constraints_json"`
	ResultJSON      string    `bun:"result_json,notnull" json:"result_json"`
	ProjectID       string    `bun:"project_id,notnull,default:''" json:"project_id"`
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

	ID          string    `bun:",pk" json:"id"`
	Type        string    `bun:",notnull" json:"type"` // 'publish_post', 'refresh_token', 'media_cleanup', 'storage_delete'
	ScopeID     string    `bun:"scope_id,notnull,default:''" json:"scope_id,omitempty"`
	DedupeKey   string    `bun:"dedupe_key,notnull,default:''" json:"dedupe_key,omitempty"`
	Payload     string    `bun:",notnull" json:"payload"`
	Status      string    `bun:",default:'pending'" json:"status"` // 'pending', 'processing', 'completed', 'failed'
	RunAt       time.Time `bun:",notnull" json:"run_at"`
	Attempts    int       `bun:",default:0" json:"attempts"`
	MaxAttempts int       `bun:",default:3" json:"max_attempts"`
	LastError   string    `json:"last_error"`
	LockedAt    time.Time `json:"locked_at"`
	LockedBy    string    `json:"locked_by"`
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
// (`frontend/src/lib/components/compose/draft-utils.ts`):
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

// Prompt represents a writing prompt for content inspiration.
type Prompt struct {
	bun.BaseModel `bun:"table:prompts"`

	ID          string    `bun:",pk" json:"id"`
	WorkspaceID string    `json:"workspace_id"` // null = global prompt
	UserID      string    `json:"user_id"`      // null = workspace/global prompt
	Text        string    `bun:",notnull" json:"text"`
	Example     string    `bun:",notnull,default:''" json:"example"`
	Category    string    `bun:",notnull" json:"category"`
	IsBuiltIn   bool      `bun:",default:false" json:"is_built_in"`
	CreatedAt   time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}
