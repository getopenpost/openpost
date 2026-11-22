package models

import (
	"time"

	"github.com/uptrace/bun"
)

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

// BillingGrantingProviders are the providers whose active subscriptions grant
// plan entitlements. Administrator overrides grant exactly like paid plans.
var BillingGrantingProviders = []string{BillingProviderPaddle, BillingProviderAdmin}

type MastodonInstance struct {
	bun.BaseModel `bun:"table:mastodon_instances"`

	ID                 string    `bun:",pk" json:"id"`
	Provider           string    `bun:",notnull,default:'mastodon'" json:"provider"`
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

	ID               string    `bun:",pk" json:"id"`
	Provider         string    `bun:",notnull" json:"provider"`
	ConnectionMode   string    `bun:"connection_mode,notnull,default:''" json:"connection_mode"`
	Name             string    `bun:",notnull,default:''" json:"name"`
	ClientID         string    `bun:",notnull,default:''" json:"client_id"`
	ClientSecretEnc  []byte    `bun:"client_secret_encrypted" json:"-"`
	RedirectURI      string    `bun:",notnull,default:''" json:"redirect_uri"`
	InstanceURL      string    `bun:",notnull,default:''" json:"instance_url"`
	BotTokenEnc      []byte    `bun:"bot_token_encrypted" json:"-"`
	BotUsername      string    `bun:"bot_username,notnull,default:''" json:"bot_username"`
	WebhookSecretEnc []byte    `bun:"webhook_secret_encrypted" json:"-"`
	IsActive         bool      `bun:",notnull,default:true" json:"is_active"`
	CreatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt        time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
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

// AIPromptOverride stores one instance-wide administrator replacement for a
// code-owned AI prompt. The prompt catalogue remains source-controlled, so a
// missing row always means "use the current built-in prompt".
type AIPromptOverride struct {
	bun.BaseModel `bun:"table:ai_prompt_overrides"`

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

	ID               string    `bun:",pk" json:"id"`
	WorkspaceID      string    `bun:",notnull" json:"workspace_id"`
	Slug             string    `bun:",notnull" json:"slug"`
	Alias            string    `bun:",notnull,default:''" json:"alias,omitempty"`
	Platform         string    `bun:",notnull" json:"platform"` // 'x', 'threads', 'linkedin', 'mastodon', 'bluesky', 'instagram', 'facebook', 'youtube', 'tiktok'
	AccountID        string    `bun:",notnull" json:"account_id"`
	AccountUsername  string    `json:"account_username"`
	AccountAvatarURL string    `json:"account_avatar_url"`
	ProfileFetchedAt time.Time `bun:"profile_fetched_at,nullzero" json:"-"`
	InstanceURL      string    `json:"instance_url"` // Used for Mastodon domains and Bluesky PDS
	OAuthGrantID     string    `bun:"oauth_grant_id,notnull,default:''" json:"oauth_grant_id,omitempty"`

	// Deprecated credential mirrors remain only for rolling migration and old
	// test fixtures. Runtime credential reads and writes use OAuthGrant.
	AccessTokenEnc      []byte    `bun:"access_token_encrypted,notnull" json:"-"`
	RefreshTokenEnc     []byte    `bun:"refresh_token_encrypted" json:"-"`
	TokenExpiresAt      time.Time `bun:"token_expires_at,nullzero" json:"token_expires_at"`
	GrantedScopes       string    `bun:"granted_scopes,notnull,default:''" json:"granted_scopes,omitempty"`
	CapabilityState     string    `bun:"capability_state_json,notnull,default:'{}'" json:"-"`
	CapabilityCheckedAt time.Time `bun:"capability_checked_at,nullzero" json:"-"`
	PreflightCheckedAt  time.Time `bun:"preflight_checked_at,nullzero" json:"-"`
	PreflightSuccessAt  time.Time `bun:"preflight_success_at,nullzero" json:"-"`
	PreflightWarnedAt   time.Time `bun:"preflight_warned_at,nullzero" json:"-"`
	PreflightFailure    string    `bun:"preflight_failure,notnull,default:''" json:"-"`
	// CredentialFailureGeneration counts healthy-to-failing credential
	// transitions. Producers claim it atomically so one credential break
	// notifies the reconnect-capable recipients once per generation.
	CredentialFailureGeneration int64 `bun:"credential_failure_generation,notnull,default:0" json:"-"`

	IsActive        bool      `bun:",default:true" json:"is_active"`
	ErrorMessage    string    `json:"error_message"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	ClaimedFirst    bool      `bun:"-" json:"-"`
	IsNewlyInserted bool      `bun:"-" json:"-"`
}

// ProviderInstallation identifies one built-in provider application or one
// operator-installed connector. Endpoint and secret material stay in the
// operator configuration file and are never persisted here.
type ProviderInstallation struct {
	bun.BaseModel `bun:"table:provider_installations"`

	ID                    string    `bun:",pk" json:"id"`
	Kind                  string    `bun:",notnull" json:"kind"`
	ProviderID            string    `bun:"provider_id,notnull" json:"provider_id"`
	DisplayName           string    `bun:"display_name,notnull" json:"display_name"`
	Description           string    `bun:",notnull,default:''" json:"description,omitempty"`
	ProtocolVersion       string    `bun:"protocol_version,notnull,default:''" json:"protocol_version,omitempty"`
	ImplementationVersion string    `bun:"implementation_version,notnull,default:''" json:"implementation_version,omitempty"`
	CapabilityRevision    string    `bun:"capability_revision,notnull,default:''" json:"capability_revision,omitempty"`
	ManifestJSON          string    `bun:"manifest_json,notnull,default:'{}'" json:"-"`
	ConfigFingerprint     string    `bun:"config_fingerprint,notnull,default:''" json:"-"`
	Status                string    `bun:",notnull" json:"status"`
	StatusDetail          string    `bun:"status_detail,notnull,default:''" json:"status_detail,omitempty"`
	Required              bool      `bun:",notnull,default:false" json:"required"`
	LastSeenAt            time.Time `bun:"last_seen_at,nullzero" json:"last_seen_at,omitempty"`
	CreatedAt             time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt             time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// ProviderAccountBinding separates an OpenPost account from the installation
// that executes its provider calls. ConnectionRef is opaque and contains no
// destination credential material.
type ProviderAccountBinding struct {
	bun.BaseModel `bun:"table:provider_account_bindings"`

	SocialAccountID    string    `bun:"social_account_id,pk" json:"social_account_id"`
	WorkspaceID        string    `bun:"workspace_id,notnull" json:"workspace_id"`
	InstallationID     string    `bun:"installation_id,notnull" json:"installation_id"`
	ConnectionRef      string    `bun:"connection_ref,notnull,default:''" json:"-"`
	ExternalAccountID  string    `bun:"external_account_id,notnull" json:"external_account_id"`
	CapabilityRevision string    `bun:"capability_revision,notnull,default:''" json:"capability_revision,omitempty"`
	CreatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt          time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
}

// ConnectorConnectionSession lets OpenPost complete or diagnose a connection
// without giving the browser direct access to a connector.
type ConnectorConnectionSession struct {
	bun.BaseModel `bun:"table:connector_connection_sessions"`

	ID             string    `bun:",pk" json:"id"`
	WorkspaceID    string    `bun:"workspace_id,notnull" json:"workspace_id"`
	InstallationID string    `bun:"installation_id,notnull" json:"installation_id"`
	State          string    `bun:",notnull" json:"state"`
	ConnectionRef  string    `bun:"connection_ref,notnull,default:''" json:"-"`
	AccountsJSON   string    `bun:"accounts_json,notnull,default:'[]'" json:"-"`
	ErrorKind      string    `bun:"error_kind,notnull,default:''" json:"error_kind,omitempty"`
	ExpiresAt      time.Time `bun:"expires_at,notnull" json:"expires_at"`
	CreatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt      time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
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

// BotConnectionNonce stores only a digest of a signed, single-use bot
// connection credential. The credential itself is returned once and is never
// persisted.
type BotConnectionNonce struct {
	bun.BaseModel `bun:"table:bot_connection_nonces"`

	ID                       string    `bun:",pk" json:"id"`
	Provider                 string    `bun:",notnull" json:"provider"`
	WorkspaceID              string    `bun:"workspace_id,notnull" json:"workspace_id"`
	CreatedByUserID          string    `bun:"created_by_user_id,notnull" json:"created_by_user_id"`
	NonceHash                string    `bun:"nonce_hash,notnull" json:"-"`
	ExpectedSubjectReference string    `bun:"expected_subject_reference,notnull,default:''" json:"-"`
	ExpiresAt                time.Time `bun:"expires_at,notnull" json:"expires_at"`
	ConsumedAt               time.Time `bun:"consumed_at,nullzero" json:"consumed_at,omitempty"`
	CreatedAt                time.Time `bun:"created_at,notnull" json:"created_at"`
}

// BotIngressEvent is the bounded provider-neutral projection retained from a
// verified bot webhook. It intentionally has no raw payload or header fields.
type BotIngressEvent struct {
	bun.BaseModel `bun:"table:bot_ingress_events"`

	ID                 string    `bun:",pk" json:"id"`
	Provider           string    `bun:",notnull" json:"provider"`
	ProviderEventID    string    `bun:"provider_event_id,notnull" json:"provider_event_id"`
	Kind               string    `bun:",notnull" json:"kind"`
	WorkspaceID        string    `bun:"workspace_id,nullzero" json:"workspace_id,omitempty"`
	SocialAccountID    string    `bun:"social_account_id,notnull,default:''" json:"social_account_id,omitempty"`
	ConnectionNonceID  string    `bun:"connection_nonce_id,notnull,default:''" json:"connection_nonce_id,omitempty"`
	SubjectReference   string    `bun:"subject_reference,notnull,default:''" json:"subject_reference,omitempty"`
	ParentReference    string    `bun:"parent_reference,notnull,default:''" json:"parent_reference,omitempty"`
	ContentProfile     string    `bun:"content_profile,notnull,default:''" json:"content_profile,omitempty"`
	ContentText        string    `bun:"content_text,notnull,default:''" json:"content_text,omitempty"`
	MetricsJSON        string    `bun:"metrics_json,notnull,default:'{}'" json:"metrics_json,omitempty"`
	OccurredAt         time.Time `bun:"occurred_at,notnull" json:"occurred_at"`
	ProcessedAt        time.Time `bun:"processed_at,nullzero" json:"processed_at,omitempty"`
	SafeErrorCode      string    `bun:"safe_error_code,notnull,default:''" json:"safe_error_code,omitempty"`
	ProcessingAttempts int       `bun:"processing_attempts,notnull,default:0" json:"processing_attempts"`
	CreatedAt          time.Time `bun:"created_at,notnull" json:"created_at"`
}

// TelegramChatInstallation retains authenticated bot-membership timing before
// a chat is bound to a Workspace. It contains no conversation or credential data.
type TelegramChatInstallation struct {
	bun.BaseModel `bun:"table:telegram_chat_installations"`

	ChatID           string    `bun:"chat_id,pk" json:"chat_id"`
	ChatType         string    `bun:"chat_type,notnull" json:"chat_type"`
	MembershipStatus string    `bun:"membership_status,notnull" json:"membership_status"`
	InstalledAt      time.Time `bun:"installed_at,nullzero" json:"installed_at,omitempty"`
	UpdatedAt        time.Time `bun:"updated_at,notnull" json:"updated_at"`
}

// TelegramConnection records the destination identity and truthful observation
// boundary established by a bot connection. Bot credentials remain instance-owned.
type TelegramConnection struct {
	bun.BaseModel `bun:"table:telegram_connections"`

	SocialAccountID       string    `bun:"social_account_id,pk" json:"social_account_id"`
	WorkspaceID           string    `bun:"workspace_id,notnull" json:"workspace_id"`
	ChatID                string    `bun:"chat_id,unique,notnull" json:"chat_id"`
	ChatType              string    `bun:"chat_type,notnull" json:"chat_type"`
	InstalledAt           time.Time `bun:"installed_at,notnull" json:"installed_at"`
	CoverageStartedAt     time.Time `bun:"coverage_started_at,notnull" json:"coverage_started_at"`
	CoverageKind          string    `bun:"coverage_kind,notnull" json:"coverage_kind"`
	PermissionsVerifiedAt time.Time `bun:"permissions_verified_at,notnull" json:"permissions_verified_at"`
	CreatedAt             time.Time `bun:"created_at,notnull" json:"created_at"`
}

// TelegramPublishReceipt is one ordered message outcome for a Rendition. Rows
// are prepared before provider calls so restarts can distinguish a safe
// continuation from an ambiguous write. No content or credentials are stored.
type TelegramPublishReceipt struct {
	bun.BaseModel `bun:"table:telegram_publish_receipts"`

	ID             string    `bun:",pk" json:"id"`
	OperationID    string    `bun:"operation_id,notnull" json:"operation_id"`
	RenditionID    string    `bun:"rendition_id,notnull" json:"rendition_id"`
	RequestIndex   int       `bun:"request_index,notnull" json:"request_index"`
	MessageIndex   int       `bun:"message_index,notnull" json:"message_index"`
	RequestKind    string    `bun:"request_kind,notnull" json:"request_kind"`
	Status         string    `bun:",notnull" json:"status"`
	MessageID      string    `bun:"message_id,notnull,default:''" json:"message_id,omitempty"`
	SafeErrorCode  string    `bun:"safe_error_code,notnull,default:''" json:"safe_error_code,omitempty"`
	SendingStarted time.Time `bun:"sending_started_at,nullzero" json:"sending_started_at,omitempty"`
	AcceptedAt     time.Time `bun:"accepted_at,nullzero" json:"accepted_at,omitempty"`
	CreatedAt      time.Time `bun:"created_at,notnull" json:"created_at"`
	UpdatedAt      time.Time `bun:"updated_at,notnull" json:"updated_at"`
}

type AccountFeature struct {
	bun.BaseModel `bun:"table:account_features"`

	SocialAccountID string    `bun:"social_account_id,pk" json:"social_account_id"`
	WorkspaceID     string    `bun:"workspace_id,notnull" json:"workspace_id"`
	Feature         string    `bun:",pk" json:"feature"`
	Enabled         bool      `bun:",notnull" json:"enabled"`
	DecidedByUserID string    `bun:"decided_by_user_id,notnull,default:''" json:"decided_by_user_id"`
	Source          string    `bun:",notnull,default:''" json:"source"`
	DecidedAt       time.Time `bun:"decided_at,notnull" json:"decided_at"`
	CreatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"created_at"`
	UpdatedAt       time.Time `bun:",nullzero,notnull,default:current_timestamp" json:"updated_at"`
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
