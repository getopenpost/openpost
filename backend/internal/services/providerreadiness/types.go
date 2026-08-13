// Package providerreadiness derives one fail-closed provider decision from
// configuration, approval, authorization, certification, and runtime-control
// evidence. It deliberately keeps those facts separate: an installed adapter
// is implementation evidence, not proof that a provider or format is ready.
package providerreadiness

import "time"

type ConfigurationState string

const (
	ConfigurationStateUnknown    ConfigurationState = "unknown"
	ConfigurationStateMissing    ConfigurationState = "missing"
	ConfigurationStateDynamic    ConfigurationState = "dynamic_registration"
	ConfigurationStateConfigured ConfigurationState = "configured"
)

type ConfigurationSource string

const (
	ConfigurationSourceUnknown     ConfigurationSource = "unknown"
	ConfigurationSourceBuiltIn     ConfigurationSource = "built_in"
	ConfigurationSourceEnvironment ConfigurationSource = "environment"
	ConfigurationSourceDatabase    ConfigurationSource = "database"
	ConfigurationSourceDynamic     ConfigurationSource = "dynamic"
)

type DeploymentEnvironment string

const (
	DeploymentEnvironmentUnknown    DeploymentEnvironment = "unknown"
	DeploymentEnvironmentLocal      DeploymentEnvironment = "local"
	DeploymentEnvironmentStaging    DeploymentEnvironment = "staging"
	DeploymentEnvironmentProduction DeploymentEnvironment = "production"
)

type ProviderEnvironment string

const (
	ProviderEnvironmentUnknown     ProviderEnvironment = "unknown"
	ProviderEnvironmentDevelopment ProviderEnvironment = "development"
	ProviderEnvironmentSandbox     ProviderEnvironment = "sandbox"
	ProviderEnvironmentProduction  ProviderEnvironment = "production"
)

type Operation string

const (
	OperationConnect          Operation = "connect"
	OperationPublishImmediate Operation = "publish_immediate"
	OperationPublishScheduled Operation = "publish_scheduled"
	OperationRefresh          Operation = "refresh"
	OperationRevoke           Operation = "revoke"
)

func (o Operation) IsPublish() bool {
	return o == OperationPublishImmediate || o == OperationPublishScheduled
}

type ExecutionIntent string

const (
	ExecutionIntentProduction        ExecutionIntent = "production"
	ExecutionIntentCertificationTest ExecutionIntent = "certification_test"
)

type ApprovalState string

const (
	ApprovalStateUnknown     ApprovalState = "unknown"
	ApprovalStateNotRequired ApprovalState = "not_required"
	ApprovalStatePending     ApprovalState = "pending"
	ApprovalStateTrial       ApprovalState = "trial"
	ApprovalStateApproved    ApprovalState = "approved"
	ApprovalStateRestricted  ApprovalState = "restricted"
	ApprovalStateRevoked     ApprovalState = "revoked"
)

type AuthorizationState string

const (
	AuthorizationStateUnknown           AuthorizationState = "unknown"
	AuthorizationStateNotApplicable     AuthorizationState = "not_applicable"
	AuthorizationStateValid             AuthorizationState = "valid"
	AuthorizationStateReconnectRequired AuthorizationState = "reconnect_required"
)

type PolicyState string

const (
	PolicyStateUnknown    PolicyState = "unknown"
	PolicyStateAllowed    PolicyState = "allowed"
	PolicyStateRestricted PolicyState = "restricted"
)

type RuntimeControlState string

const (
	RuntimeControlStateUnknown  RuntimeControlState = "unknown"
	RuntimeControlStateEnabled  RuntimeControlState = "enabled"
	RuntimeControlStateDegraded RuntimeControlState = "degraded"
	RuntimeControlStateDisabled RuntimeControlState = "disabled"
)

type EvidenceKind string

const (
	EvidenceKindLocal EvidenceKind = "local"
	EvidenceKindLive  EvidenceKind = "live"
)

type EvidenceState string

const (
	EvidenceStateMissing  EvidenceState = "missing"
	EvidenceStateCurrent  EvidenceState = "current"
	EvidenceStateExpired  EvidenceState = "expired"
	EvidenceStateMismatch EvidenceState = "mismatch"
	EvidenceStateFailed   EvidenceState = "failed"
)

type CheckKind string

const (
	CheckConnect          CheckKind = "connect"
	CheckAuthorization    CheckKind = "authorization"
	CheckPublishImmediate CheckKind = "publish_immediate"
	CheckPublishScheduled CheckKind = "publish_scheduled"
	CheckFinalResult      CheckKind = "final_result"
	CheckRefresh          CheckKind = "refresh"
	CheckRevoke           CheckKind = "revoke"
)

type CheckOutcome string

const (
	CheckOutcomePassed        CheckOutcome = "passed"
	CheckOutcomeFailed        CheckOutcome = "failed"
	CheckOutcomeNotApplicable CheckOutcome = "not_applicable"
)

type CheckRequirement struct {
	Kind               CheckKind `json:"kind"`
	AllowNotApplicable bool      `json:"allow_not_applicable"`
}

type EffectiveState string

const (
	EffectiveStateUnsupported         EffectiveState = "unsupported"
	EffectiveStateDisabled            EffectiveState = "disabled"
	EffectiveStateNeedsConfiguration  EffectiveState = "needs_configuration"
	EffectiveStateReconnectRequired   EffectiveState = "reconnect_required"
	EffectiveStateDegraded            EffectiveState = "degraded"
	EffectiveStateApprovalRequired    EffectiveState = "approval_required"
	EffectiveStateTrialOnly           EffectiveState = "trial_only"
	EffectiveStatePolicyRestricted    EffectiveState = "policy_restricted"
	EffectiveStateCertificationNeeded EffectiveState = "certification_required"
	EffectiveStateExpiredProof        EffectiveState = "expired_proof"
	EffectiveStateHealthy             EffectiveState = "healthy"
)

type Subject struct {
	Provider              string                `json:"provider"`
	AppFingerprint        string                `json:"app_fingerprint"`
	DeploymentEnvironment DeploymentEnvironment `json:"deployment_environment"`
	ProviderEnvironment   ProviderEnvironment   `json:"provider_environment"`
	InstanceFingerprint   string                `json:"instance_fingerprint,omitempty"`
	AccountKind           string                `json:"account_kind,omitempty"`
	OutputProfile         string                `json:"output_profile,omitempty"`
	Operation             Operation             `json:"operation"`
	PolicyMode            string                `json:"policy_mode,omitempty"`
}

type ConfigurationEvidence struct {
	State          ConfigurationState  `json:"state"`
	Source         ConfigurationSource `json:"source"`
	AppFingerprint string              `json:"app_fingerprint,omitempty"`
}

type ApprovalEvidence struct {
	State      ApprovalState `json:"state"`
	Tier       string        `json:"tier,omitempty"`
	SourceURL  string        `json:"source_url,omitempty"`
	ReviewedAt time.Time     `json:"reviewed_at,omitempty"`
	ExpiresAt  time.Time     `json:"expires_at,omitempty"`
}

type AuthorizationEvidence struct {
	State         AuthorizationState `json:"state"`
	GrantedScopes []string           `json:"granted_scopes,omitempty"`
	ValidatedAt   time.Time          `json:"validated_at,omitempty"`
	ExpiresAt     time.Time          `json:"expires_at,omitempty"`
	ReasonCode    string             `json:"reason_code,omitempty"`
}

type PolicyEvidence struct {
	State      PolicyState `json:"state"`
	ReasonCode string      `json:"reason_code,omitempty"`
}

type RuntimeControl struct {
	State      RuntimeControlState `json:"state"`
	ReasonCode string              `json:"reason_code,omitempty"`
	ExpiresAt  time.Time           `json:"expires_at,omitempty"`
}

type CheckResult struct {
	Kind                CheckKind    `json:"kind"`
	Outcome             CheckOutcome `json:"outcome"`
	ErrorClass          string       `json:"error_class,omitempty"`
	NotApplicableReason string       `json:"not_applicable_reason,omitempty"`
	ExternalRefHash     string       `json:"external_ref_hash,omitempty"`
	CompletedAt         time.Time    `json:"completed_at"`
}

type CertificationEvidence struct {
	ID                   string        `json:"id"`
	Kind                 EvidenceKind  `json:"kind"`
	Subject              Subject       `json:"subject"`
	AccountReferenceHash string        `json:"account_reference_hash,omitempty"`
	TestedRevision       string        `json:"tested_revision"`
	ContractDigest       string        `json:"contract_digest"`
	TestedAt             time.Time     `json:"tested_at"`
	ExpiresAt            time.Time     `json:"expires_at"`
	ApprovalStateAtTest  ApprovalState `json:"approval_state_at_test"`
	ApprovalTierAtTest   string        `json:"approval_tier_at_test,omitempty"`
	RequiredScopes       []string      `json:"required_scopes,omitempty"`
	GrantedScopes        []string      `json:"granted_scopes,omitempty"`
	Checks               []CheckResult `json:"checks"`
	OperatorRef          string        `json:"operator_ref"`
}

type Requirements struct {
	RequireConfiguration         bool               `json:"require_configuration"`
	RequireProductionDeployment  bool               `json:"require_production_deployment"`
	RequireProductionProviderApp bool               `json:"require_production_provider_app"`
	RequireExactRevision         bool               `json:"require_exact_revision"`
	RequireApproval              bool               `json:"require_approval"`
	RequireAuthorization         bool               `json:"require_authorization"`
	RequireLocalEvidence         bool               `json:"require_local_evidence"`
	RequireLiveEvidence          bool               `json:"require_live_evidence"`
	AllowTrialExecution          bool               `json:"allow_trial_execution"`
	RequiredScopes               []string           `json:"required_scopes,omitempty"`
	RequiredLocalChecks          []CheckRequirement `json:"required_local_checks,omitempty"`
	RequiredLiveChecks           []CheckRequirement `json:"required_live_checks,omitempty"`
}

// CertificationContract binds readiness evidence to the provider capability
// and policy implementation that was actually tested. Its digest changes when
// any execution requirement or either caller-supplied source digest changes.
type CertificationContract struct {
	SchemaVersion    int          `json:"schema_version"`
	CapabilityDigest string       `json:"capability_digest"`
	PolicyDigest     string       `json:"policy_digest"`
	Requirements     Requirements `json:"requirements"`
}

type EvaluationInput struct {
	Now                         time.Time              `json:"now"`
	Implemented                 bool                   `json:"implemented"`
	Subject                     Subject                `json:"subject"`
	CurrentAccountReferenceHash string                 `json:"current_account_reference_hash,omitempty"`
	Intent                      ExecutionIntent        `json:"intent"`
	CurrentRevision             string                 `json:"current_revision"`
	Contract                    CertificationContract  `json:"contract"`
	Configuration               ConfigurationEvidence  `json:"configuration"`
	Approval                    ApprovalEvidence       `json:"approval"`
	Authorization               AuthorizationEvidence  `json:"authorization"`
	Policy                      PolicyEvidence         `json:"policy"`
	Control                     RuntimeControl         `json:"control"`
	LocalEvidence               *CertificationEvidence `json:"local_evidence,omitempty"`
	LiveEvidence                *CertificationEvidence `json:"live_evidence,omitempty"`
}

// ApprovalReview is the immutable ledger envelope around one approval fact.
// Provider app and instance identities are fingerprints, never raw client IDs,
// secrets, or provider URLs.
type ApprovalReview struct {
	ID                  string
	Provider            string
	AppFingerprint      string
	ProviderEnvironment ProviderEnvironment
	InstanceFingerprint string
	Evidence            ApprovalEvidence
	OperatorRef         string
	CreatedAt           time.Time
}

// RuntimeControlSelector supports provider-wide and increasingly specific
// control events. Empty fields are wildcards except Provider, which is always
// required.
type RuntimeControlSelector struct {
	Provider              string                `json:"provider"`
	AppFingerprint        string                `json:"app_fingerprint,omitempty"`
	DeploymentEnvironment DeploymentEnvironment `json:"deployment_environment,omitempty"`
	ProviderEnvironment   ProviderEnvironment   `json:"provider_environment,omitempty"`
	InstanceFingerprint   string                `json:"instance_fingerprint,omitempty"`
	AccountKind           string                `json:"account_kind,omitempty"`
	OutputProfile         string                `json:"output_profile,omitempty"`
	Operation             Operation             `json:"operation,omitempty"`
	PolicyMode            string                `json:"policy_mode,omitempty"`
}

type RuntimeControlEvent struct {
	ID          string
	Selector    RuntimeControlSelector
	Control     RuntimeControl
	StartsAt    time.Time
	OperatorRef string
	CreatedAt   time.Time
}

// DecisionRequest contains current runtime facts. Approval, certification, and
// control facts are deliberately absent because Service resolves them from the
// append-only ledger.
type DecisionRequest struct {
	Implemented                 bool
	Subject                     Subject
	CurrentAccountReferenceHash string
	Intent                      ExecutionIntent
	CurrentRevision             string
	Contract                    CertificationContract
	Configuration               ConfigurationEvidence
	Authorization               AuthorizationEvidence
	Policy                      PolicyEvidence
}

type BlockerCode string

const (
	BlockerUnsupported           BlockerCode = "unsupported"
	BlockerInvalidSubject        BlockerCode = "invalid_subject"
	BlockerInvalidEvaluation     BlockerCode = "invalid_evaluation"
	BlockerDisabled              BlockerCode = "disabled"
	BlockerUnknownRuntimeControl BlockerCode = "unknown_runtime_control"
	BlockerDegraded              BlockerCode = "degraded"
	BlockerMissingConfiguration  BlockerCode = "missing_configuration"
	BlockerConfigurationMismatch BlockerCode = "configuration_mismatch"
	BlockerWrongDeployment       BlockerCode = "wrong_deployment_environment"
	BlockerWrongProviderApp      BlockerCode = "wrong_provider_environment"
	BlockerApprovalRequired      BlockerCode = "approval_required"
	BlockerApprovalExpired       BlockerCode = "approval_expired"
	BlockerTrialOnly             BlockerCode = "trial_only"
	BlockerPolicyRestricted      BlockerCode = "policy_restricted"
	BlockerUnknownPolicy         BlockerCode = "unknown_policy"
	BlockerReconnectRequired     BlockerCode = "reconnect_required"
	BlockerAuthorizationExpired  BlockerCode = "authorization_expired"
	BlockerMissingScope          BlockerCode = "missing_scope"
	BlockerLocalEvidenceMissing  BlockerCode = "local_evidence_missing"
	BlockerLocalEvidenceExpired  BlockerCode = "local_evidence_expired"
	BlockerLocalEvidenceMismatch BlockerCode = "local_evidence_mismatch"
	BlockerLocalEvidenceFailed   BlockerCode = "local_evidence_failed"
	BlockerLiveEvidenceMissing   BlockerCode = "live_evidence_missing"
	BlockerLiveEvidenceExpired   BlockerCode = "live_evidence_expired"
	BlockerLiveEvidenceMismatch  BlockerCode = "live_evidence_mismatch"
	BlockerLiveEvidenceFailed    BlockerCode = "live_evidence_failed"
	BlockerReadinessUnavailable  BlockerCode = "readiness_evidence_unavailable"
)

type Blocker struct {
	Code   BlockerCode `json:"code"`
	Detail string      `json:"detail,omitempty"`
}

type Facts struct {
	Configuration     ConfigurationState  `json:"configuration"`
	LocalTest         EvidenceState       `json:"local_test"`
	LiveCertification EvidenceState       `json:"live_certification"`
	Approval          ApprovalState       `json:"approval"`
	Authorization     AuthorizationState  `json:"authorization"`
	Control           RuntimeControlState `json:"control"`
	Policy            PolicyState         `json:"policy"`
}

type Decision struct {
	State          EffectiveState `json:"state"`
	ContractDigest string         `json:"contract_digest,omitempty"`
	Executable     bool           `json:"executable"`
	Connectable    bool           `json:"connectable"`
	Publishable    bool           `json:"publishable"`
	Advertisable   bool           `json:"advertisable"`
	Facts          Facts          `json:"facts"`
	Blockers       []Blocker      `json:"blockers,omitempty"`
}
