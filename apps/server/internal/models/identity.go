package models

import (
	"time"

	"github.com/uptrace/bun"
)

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
	CreatedByUserID  string    `bun:"created_by_user_id,nullzero" json:"created_by_user_id,omitempty"`
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
	InstallationID     string    `bun:"installation_id,notnull,default:''" json:"installation_id,omitempty"`
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

type ExternalApplication struct {
	bun.BaseModel `bun:"table:external_applications"`

	ID               string    `bun:",pk" json:"id"`
	ClientID         string    `bun:"client_id,unique,notnull" json:"client_id"`
	Name             string    `bun:",notnull" json:"name"`
	ClientType       string    `bun:"client_type,notnull" json:"client_type"`
	ClientSecretHash string    `bun:"client_secret_hash,notnull,default:''" json:"-"`
	RedirectURIsJSON string    `bun:"redirect_uris_json,notnull" json:"-"`
	AllowedScopes    string    `bun:"allowed_scopes,notnull" json:"allowed_scopes"`
	CreatedByUserID  string    `bun:"created_by_user_id,nullzero" json:"created_by_user_id,omitempty"`
	RevokedAt        time.Time `bun:"revoked_at,nullzero" json:"revoked_at,omitempty"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type ExternalAppInstallation struct {
	bun.BaseModel `bun:"table:external_app_installations"`

	ID            string    `bun:",pk" json:"id"`
	ApplicationID string    `bun:"application_id,notnull" json:"application_id"`
	SponsorUserID string    `bun:"sponsor_user_id,notnull" json:"sponsor_user_id"`
	Scopes        string    `bun:",notnull" json:"scopes"`
	TokenFamilyID string    `bun:"token_family_id,notnull" json:"-"`
	RevokedAt     time.Time `bun:"revoked_at,nullzero" json:"revoked_at,omitempty"`
	CreatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt     time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type ExternalAppWorkspaceGrant struct {
	bun.BaseModel `bun:"table:external_app_workspace_grants"`

	InstallationID      string    `bun:"installation_id,pk" json:"installation_id"`
	WorkspaceID         string    `bun:"workspace_id,pk" json:"workspace_id"`
	AllCurrentAccounts  bool      `bun:"all_current_accounts,notnull,default:false" json:"all_current_accounts"`
	OrganizationID      string    `bun:"organization_id,notnull,default:''" json:"organization_id,omitempty"`
	IdentityProviderID  string    `bun:"identity_provider_id,notnull,default:''" json:"identity_provider_id,omitempty"`
	AssuredAt           time.Time `bun:"assured_at,nullzero" json:"assured_at,omitempty"`
	CredentialExpiresAt time.Time `bun:"credential_expires_at,nullzero" json:"credential_expires_at,omitempty"`
	RevokedAt           time.Time `bun:"revoked_at,nullzero" json:"revoked_at,omitempty"`
	CreatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt           time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

type ExternalAppAccountGrant struct {
	bun.BaseModel `bun:"table:external_app_account_grants"`

	InstallationID  string    `bun:"installation_id,pk" json:"installation_id"`
	WorkspaceID     string    `bun:"workspace_id,pk" json:"workspace_id"`
	SocialAccountID string    `bun:"social_account_id,pk" json:"social_account_id"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type ExternalOAuthCode struct {
	bun.BaseModel `bun:"table:external_oauth_codes"`

	ID             string    `bun:",pk" json:"id"`
	CodeHash       string    `bun:"code_hash,unique,notnull" json:"-"`
	InstallationID string    `bun:"installation_id,notnull" json:"installation_id"`
	ClientID       string    `bun:"client_id,notnull" json:"client_id"`
	RedirectURI    string    `bun:"redirect_uri,notnull" json:"redirect_uri"`
	Resource       string    `bun:",notnull" json:"resource"`
	CodeChallenge  string    `bun:"code_challenge,notnull" json:"-"`
	ExpiresAt      time.Time `bun:"expires_at,notnull" json:"expires_at"`
	ConsumedAt     time.Time `bun:"consumed_at,nullzero" json:"consumed_at,omitempty"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type ExternalRefreshToken struct {
	bun.BaseModel `bun:"table:external_refresh_tokens"`

	ID             string    `bun:",pk" json:"id"`
	TokenHash      string    `bun:"token_hash,unique,notnull" json:"-"`
	TokenPrefix    string    `bun:"token_prefix,notnull" json:"token_prefix"`
	InstallationID string    `bun:"installation_id,notnull" json:"installation_id"`
	FamilyID       string    `bun:"family_id,notnull" json:"-"`
	ExpiresAt      time.Time `bun:"expires_at,notnull" json:"expires_at"`
	UsedAt         time.Time `bun:"used_at,nullzero" json:"used_at,omitempty"`
	RevokedAt      time.Time `bun:"revoked_at,nullzero" json:"revoked_at,omitempty"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type ExternalWebhookSubscription struct {
	bun.BaseModel `bun:"table:external_webhook_subscriptions"`

	ID              string    `bun:",pk" json:"id"`
	InstallationID  string    `bun:"installation_id,notnull" json:"installation_id"`
	WorkspaceID     string    `bun:"workspace_id,notnull" json:"workspace_id"`
	URL             string    `bun:",notnull" json:"url"`
	SecretHash      string    `bun:"secret_hash,notnull" json:"-"`
	SecretEncrypted []byte    `bun:"secret_encrypted,notnull" json:"-"`
	EventTypes      string    `bun:"event_types,notnull" json:"event_types"`
	RevokedAt       time.Time `bun:"revoked_at,nullzero" json:"revoked_at,omitempty"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}

type ExternalWebhookDelivery struct {
	bun.BaseModel `bun:"table:external_webhook_deliveries"`

	ID             string    `bun:",pk" json:"id"`
	SubscriptionID string    `bun:"subscription_id,notnull,unique:subscription_event" json:"subscription_id"`
	EventID        string    `bun:"event_id,notnull,unique:subscription_event" json:"event_id"`
	EventType      string    `bun:"event_type,notnull" json:"event_type"`
	PayloadJSON    string    `bun:"payload_json,notnull" json:"payload_json"`
	Status         string    `bun:",notnull,default:'pending'" json:"status"`
	AttemptCount   int       `bun:"attempt_count,notnull,default:0" json:"attempt_count"`
	ResponseStatus int       `bun:"response_status,notnull,default:0" json:"response_status"`
	LastError      string    `bun:"last_error,notnull,default:''" json:"last_error,omitempty"`
	DeliveredAt    time.Time `bun:"delivered_at,nullzero" json:"delivered_at,omitempty"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
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

type MCPMediaUploadTicket struct {
	bun.BaseModel `bun:"table:mcp_media_upload_tickets"`

	ID          string    `bun:",pk" json:"id"`
	TicketHash  string    `bun:"ticket_hash,unique,notnull" json:"-"`
	WorkspaceID string    `bun:"workspace_id,notnull" json:"workspace_id"`
	UserID      string    `bun:"user_id,notnull" json:"user_id"`
	SessionID   string    `bun:"session_id,nullzero" json:"session_id,omitempty"`
	TokenID     string    `bun:"token_id,nullzero" json:"token_id,omitempty"`
	ClientID    string    `bun:"client_id,nullzero" json:"client_id,omitempty"`
	Filename    string    `bun:"filename,notnull" json:"filename"`
	MimeType    string    `bun:"mime_type,nullzero" json:"mime_type,omitempty"`
	Size        int64     `bun:"size,notnull" json:"size"`
	AltText     string    `bun:"alt_text,nullzero" json:"alt_text,omitempty"`
	ExpiresAt   time.Time `bun:"expires_at,notnull" json:"expires_at"`
	ConsumedAt  time.Time `bun:"consumed_at,nullzero" json:"consumed_at,omitempty"`
	CreatedAt   time.Time `bun:"created_at,nullzero,notnull,default:current_timestamp" json:"created_at"`
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

// OrganizationLifecycleAuditEvent survives Organization removal and contains
// only the minimum permission-safe evidence needed by instance administrators.
type OrganizationLifecycleAuditEvent struct {
	bun.BaseModel `bun:"table:organization_lifecycle_audit_events"`

	ID               string    `bun:",pk" json:"id"`
	OrganizationID   string    `bun:"organization_id,notnull" json:"organization_id"`
	OrganizationName string    `bun:"organization_name,notnull" json:"organization_name"`
	WorkspaceCount   int       `bun:"workspace_count,notnull" json:"workspace_count"`
	BillingState     string    `bun:"billing_state,notnull,default:'none'" json:"billing_state"`
	ActorUserID      string    `bun:"actor_user_id,nullzero" json:"actor_user_id,omitempty"`
	Action           string    `bun:",notnull" json:"action"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
}
