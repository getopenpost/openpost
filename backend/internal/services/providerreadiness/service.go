package providerreadiness

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
)

type ServiceOptions struct {
	Now                          func() time.Time
	DisabledProviders            []string
	DynamicRegistrationProviders []string
	DefaultControl               RuntimeControlState
	Configurations               *ConfigurationCatalog
	ManagedProduction            bool
	EnforceCertification         bool
	CurrentRevision              string
}

type Service struct {
	ledger               Ledger
	authorizations       AuthorizationSource
	now                  func() time.Time
	disabledProviders    map[string]struct{}
	implemented          map[string]struct{}
	dynamicRegistration  map[string]struct{}
	defaultControl       RuntimeControlState
	configurations       *ConfigurationCatalog
	managedProduction    bool
	enforceCertification bool
	currentRevision      string
	deployment           DeploymentEnvironment
	providerEnv          ProviderEnvironment
}

func NewService(ledger Ledger, options ServiceOptions) *Service {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	disabled := make(map[string]struct{}, len(options.DisabledProviders))
	for _, provider := range options.DisabledProviders {
		if providerPattern.MatchString(provider) {
			disabled[provider] = struct{}{}
		}
	}
	implemented := make(map[string]struct{})
	for _, capability := range capabilities.All() {
		implemented[capability.Provider] = struct{}{}
	}
	dynamicRegistration := make(map[string]struct{}, len(options.DynamicRegistrationProviders))
	for _, provider := range options.DynamicRegistrationProviders {
		provider = strings.ToLower(strings.TrimSpace(provider))
		if _, ok := implemented[provider]; ok {
			dynamicRegistration[provider] = struct{}{}
		}
	}
	defaultControl := options.DefaultControl
	if defaultControl != RuntimeControlStateEnabled {
		defaultControl = RuntimeControlStateUnknown
	}
	deployment := DeploymentEnvironmentLocal
	providerEnv := ProviderEnvironmentDevelopment
	if options.ManagedProduction {
		deployment = DeploymentEnvironmentProduction
		providerEnv = ProviderEnvironmentProduction
	}
	service := &Service{
		ledger:               ledger,
		now:                  now,
		disabledProviders:    disabled,
		implemented:          implemented,
		dynamicRegistration:  dynamicRegistration,
		defaultControl:       defaultControl,
		configurations:       options.Configurations,
		managedProduction:    options.ManagedProduction,
		enforceCertification: options.EnforceCertification,
		currentRevision:      strings.TrimSpace(options.CurrentRevision),
		deployment:           deployment,
		providerEnv:          providerEnv,
	}
	service.authorizations, _ = ledger.(AuthorizationSource)
	return service
}

// WithLedger returns a request-scoped copy that reads authorization and
// readiness facts through the supplied database boundary. Scheduling uses it
// with the same transaction that locks and snapshots the publication.
func (s *Service) WithLedger(ledger Ledger) *Service {
	if s == nil {
		return nil
	}
	clone := *s
	clone.ledger = ledger
	clone.authorizations, _ = ledger.(AuthorizationSource)
	return &clone
}

type PublicationDecisionInput struct {
	Provider                    string
	InstanceURL                 string
	AccountKind                 string
	CurrentAccountReferenceHash string
	Capability                  capabilities.Capability
	Operation                   Operation
	Intent                      ExecutionIntent
	PolicyMode                  string
	Authorization               AuthorizationEvidence
}

type CertificationContext struct {
	Subject              Subject
	AccountReferenceHash string
	Contract             CertificationContract
	Authorization        AuthorizationEvidence
}

// ResolveCertificationContext derives the immutable certification subject
// from the exact stored account and current runtime. Callers cannot supply
// app identity, account kind, account reference, scopes, or contract digests.
func (s *Service) ResolveCertificationContext(
	ctx context.Context,
	account models.SocialAccount,
	outputProfile string,
	operation Operation,
	settings map[string]any,
	claimedPolicyMode string,
) (CertificationContext, error) {
	if s == nil || s.authorizations == nil {
		return CertificationContext{}, errors.New("provider readiness authorization source is unavailable")
	}
	if !operation.IsPublish() {
		return CertificationContext{}, errors.New("provider certification operation is invalid")
	}
	capability, found := capabilities.FindOutput(account.Platform, strings.TrimSpace(outputProfile))
	if !found || !s.isPublicationImplemented(account.Platform, capability.OutputProfile) {
		return CertificationContext{}, errors.New("provider certification output profile is not implemented")
	}
	configuration := s.resolveConfiguration(account.Platform, account.InstanceURL)
	if configuration.Evidence.State != ConfigurationStateConfigured {
		return CertificationContext{}, errors.New("provider certification account is not exactly configured")
	}
	policyMode := PublicationPolicyMode(account, capability, settings)
	if claimedPolicyMode = strings.TrimSpace(claimedPolicyMode); claimedPolicyMode != "" && claimedPolicyMode != policyMode {
		return CertificationContext{}, errors.New("provider certification policy mode does not match the account settings")
	}
	accountKind := AccountKind(account)
	contract, err := PublicationContract(capability, operation, s.managedProduction, accountKind, policyMode)
	if err != nil {
		return CertificationContext{}, err
	}
	authorization, err := s.authorizations.AuthorizationForAccount(ctx, account, s.currentTime())
	if err != nil {
		return CertificationContext{}, err
	}
	if authorization.State != AuthorizationStateValid {
		return CertificationContext{}, errors.New("provider certification account authorization is not valid")
	}
	for _, requiredScope := range contract.Requirements.RequiredScopes {
		if !slices.Contains(authorization.GrantedScopes, requiredScope) {
			return CertificationContext{}, fmt.Errorf("provider certification account is missing required scope %s", requiredScope)
		}
	}
	accountReferenceHash, err := AccountReferenceHash(account)
	if err != nil {
		return CertificationContext{}, err
	}
	return CertificationContext{
		Subject:              s.subject(configuration, accountKind, capability.OutputProfile, operation, policyMode),
		AccountReferenceHash: accountReferenceHash,
		Contract:             contract, Authorization: authorization,
	}, nil
}

func (s *Service) ApprovalReviewByID(ctx context.Context, id string) (*ApprovalReview, error) {
	if s == nil || s.ledger == nil {
		return nil, errors.New("provider readiness ledger is unavailable")
	}
	return s.ledger.ApprovalReviewByID(ctx, id)
}

func (s *Service) CurrentRevision() string {
	return s.revision()
}

func (s *Service) DecideConnection(ctx context.Context, provider, instanceURL string, intent ExecutionIntent) Decision {
	configuration := s.resolveConnectionConfiguration(provider, instanceURL)
	contract, _ := ConnectionContract(provider, s != nil && s.enforceCertification)
	return s.Decide(ctx, DecisionRequest{
		Implemented:     s.isImplemented(provider),
		Subject:         s.subject(configuration, "", "", OperationConnect, "default"),
		Intent:          intent,
		CurrentRevision: s.revision(),
		Contract:        contract,
		Configuration:   configuration.Evidence,
		Authorization:   AuthorizationEvidence{State: AuthorizationStateNotApplicable},
		Policy:          PolicyEvidence{State: PolicyStateAllowed},
	})
}

func (s *Service) DecidePublication(ctx context.Context, input PublicationDecisionInput) Decision {
	return s.decidePublication(ctx, input, nil)
}

// DecideAccountPublication resolves the canonical OAuth grant and then applies
// the same projection used by scheduling, workers, REST, MCP, and CLI views.
func (s *Service) DecideAccountPublication(
	ctx context.Context,
	account models.SocialAccount,
	capability capabilities.Capability,
	operation Operation,
	intent ExecutionIntent,
	policyMode string,
) Decision {
	accountReferenceHash, referenceErr := AccountReferenceHash(account)
	if s == nil || s.authorizations == nil {
		return s.decidePublication(ctx, PublicationDecisionInput{
			Provider: account.Platform, InstanceURL: account.InstanceURL,
			AccountKind: AccountKind(account), Capability: capability,
			Operation: operation, Intent: intent, PolicyMode: policyMode,
			CurrentAccountReferenceHash: accountReferenceHash,
		}, errors.Join(errors.New("provider authorization source is unavailable"), referenceErr))
	}
	authorization, err := s.authorizations.AuthorizationForAccount(ctx, account, s.currentTime())
	err = errors.Join(err, referenceErr)
	return s.decidePublication(ctx, PublicationDecisionInput{
		Provider: account.Platform, InstanceURL: account.InstanceURL,
		AccountKind: AccountKind(account), Capability: capability,
		Operation: operation, Intent: intent, PolicyMode: policyMode,
		CurrentAccountReferenceHash: accountReferenceHash, Authorization: authorization,
	}, err)
}

func (s *Service) decidePublication(ctx context.Context, input PublicationDecisionInput, authorizationErr error) Decision {
	configuration := s.resolveConfiguration(input.Provider, input.InstanceURL)
	outputProfile := strings.TrimSpace(input.Capability.OutputProfile)
	if outputProfile == "" {
		outputProfile = strings.TrimSpace(input.Capability.Profile)
	}
	accountKind := strings.TrimSpace(input.AccountKind)
	if accountKind == "" {
		accountKind = "standard"
	}
	policyMode := normalizedPolicyToken(input.PolicyMode, input.Provider+".unspecified")
	contract, _ := PublicationContract(
		input.Capability,
		input.Operation,
		s != nil && s.enforceCertification,
		accountKind,
		policyMode,
	)
	request := DecisionRequest{
		Implemented:                 s.isPublicationImplemented(input.Provider, outputProfile),
		Subject:                     s.subject(configuration, accountKind, outputProfile, input.Operation, policyMode),
		CurrentAccountReferenceHash: input.CurrentAccountReferenceHash,
		Intent:                      input.Intent,
		CurrentRevision:             s.revision(),
		Contract:                    contract,
		Configuration:               configuration.Evidence,
		Authorization:               input.Authorization,
		Policy:                      PolicyEvidence{State: PolicyStateAllowed},
	}
	if authorizationErr != nil {
		return unavailableDecision(request, s.currentTime())
	}
	return s.Decide(ctx, request)
}

// RegisterRuntimeApp adds a dynamically discovered provider application to the
// same catalog used by all readiness decisions.
func (s *Service) RegisterRuntimeApp(app RuntimeApp) error {
	if s == nil || s.configurations == nil {
		return errors.New("provider configuration catalog is unavailable")
	}
	return s.configurations.Register(app)
}

func (s *Service) ProviderEnvironment() ProviderEnvironment {
	if s == nil {
		return ProviderEnvironmentUnknown
	}
	return s.providerEnv
}

func (s *Service) Configuration(provider, instanceURL string) RuntimeConfiguration {
	return s.resolveConfiguration(provider, instanceURL)
}

func (s *Service) resolveConfiguration(provider, instanceURL string) RuntimeConfiguration {
	providerEnv := ProviderEnvironmentDevelopment
	if s != nil {
		providerEnv = s.providerEnv
	}
	if s == nil || s.configurations == nil {
		return (*ConfigurationCatalog)(nil).Resolve(provider, instanceURL, providerEnv)
	}
	return s.configurations.Resolve(provider, instanceURL, providerEnv)
}

func (s *Service) resolveConnectionConfiguration(provider, instanceURL string) RuntimeConfiguration {
	configuration := s.resolveConfiguration(provider, instanceURL)
	provider = strings.ToLower(strings.TrimSpace(provider))
	if configuration.Evidence.State != ConfigurationStateMissing || strings.TrimSpace(instanceURL) != "" {
		return configuration
	}
	if s == nil {
		return configuration
	}
	if _, ok := s.dynamicRegistration[provider]; !ok {
		return configuration
	}
	fingerprint, _ := digestJSON(struct {
		Provider string `json:"provider"`
		Mode     string `json:"mode"`
	}{Provider: provider, Mode: "dynamic_registration"})
	configuration.AppFingerprint = fingerprint
	configuration.Evidence = ConfigurationEvidence{
		State: ConfigurationStateDynamic, Source: ConfigurationSourceDynamic,
		AppFingerprint: fingerprint,
	}
	return configuration
}

func (s *Service) isImplemented(provider string) bool {
	if s == nil {
		return false
	}
	_, ok := s.implemented[strings.ToLower(strings.TrimSpace(provider))]
	return ok
}

func (s *Service) isPublicationImplemented(provider, outputProfile string) bool {
	if !s.isImplemented(provider) || strings.TrimSpace(outputProfile) == "" {
		return false
	}
	capability, ok := capabilities.FindOutput(provider, outputProfile)
	return ok && capability.Provider == provider
}

func (s *Service) subject(
	configuration RuntimeConfiguration,
	accountKind, outputProfile string,
	operation Operation,
	policyMode string,
) Subject {
	deployment := DeploymentEnvironmentLocal
	if s != nil {
		deployment = s.deployment
	}
	return Subject{
		Provider:              configuration.Provider,
		AppFingerprint:        configuration.AppFingerprint,
		DeploymentEnvironment: deployment,
		ProviderEnvironment:   configuration.ProviderEnvironment,
		InstanceFingerprint:   configuration.InstanceFingerprint,
		AccountKind:           accountKind,
		OutputProfile:         outputProfile,
		Operation:             operation,
		PolicyMode:            policyMode,
	}
}

func (s *Service) revision() string {
	if s == nil {
		return "unknown"
	}
	return s.currentRevision
}

// Decide resolves approval, local/live certification, and runtime controls from
// one repository before calling the pure projection. Repository failures become
// an explicit blocked decision; callers never need to choose between an error
// path and a safe result.
func (s *Service) Decide(ctx context.Context, request DecisionRequest) Decision {
	now := s.currentTime()
	if s == nil || s.ledger == nil {
		return unavailableDecision(request, now)
	}
	if _, disabled := s.disabledProviders[request.Subject.Provider]; disabled {
		return Evaluate(evaluationInput(request, now, ApprovalEvidence{
			State: ApprovalStateUnknown,
		}, RuntimeControl{
			State:      RuntimeControlStateDisabled,
			ReasonCode: "environment_disabled",
		}, nil, nil))
	}
	approval, err := s.ledger.LatestApprovalReview(ctx, request.Subject)
	if err != nil && !errors.Is(err, ErrLedgerFactNotFound) {
		return unavailableDecision(request, now)
	}
	approvalEvidence := ApprovalEvidence{State: ApprovalStateUnknown}
	if approval != nil {
		approvalEvidence = approval.Evidence
	}

	control, err := s.ledger.EffectiveRuntimeControl(ctx, request.Subject, now)
	if err != nil {
		if !errors.Is(err, ErrLedgerFactNotFound) {
			return unavailableDecision(request, now)
		}
		control = RuntimeControl{State: s.defaultControl}
	}

	var local *CertificationEvidence
	if request.Contract.Requirements.RequireLocalEvidence {
		local, err = s.ledger.LatestCertification(ctx, request.Subject, EvidenceKindLocal, "")
		if err != nil && !errors.Is(err, ErrLedgerFactNotFound) {
			return unavailableDecision(request, now)
		}
	}
	var live *CertificationEvidence
	if request.Contract.Requirements.RequireLiveEvidence {
		live, err = s.ledger.LatestCertification(
			ctx, request.Subject, EvidenceKindLive, request.CurrentAccountReferenceHash,
		)
		if err != nil && !errors.Is(err, ErrLedgerFactNotFound) {
			return unavailableDecision(request, now)
		}
	}

	return Evaluate(evaluationInput(request, now, approvalEvidence, control, local, live))
}

func (s *Service) Require(ctx context.Context, request DecisionRequest) (Decision, error) {
	decision := s.Decide(ctx, request)
	if decision.Executable {
		return decision, nil
	}
	return decision, &NotReadyError{Decision: decision}
}

func (s *Service) AppendApprovalReview(ctx context.Context, review ApprovalReview) error {
	if s == nil || s.ledger == nil {
		return errors.New("provider readiness ledger is unavailable")
	}
	return s.ledger.AppendApprovalReview(ctx, review)
}

func (s *Service) AppendCertification(ctx context.Context, approvalReviewID string, evidence CertificationEvidence) error {
	if s == nil || s.ledger == nil {
		return errors.New("provider readiness ledger is unavailable")
	}
	if err := s.validateCertificationContract(evidence); err != nil {
		return err
	}
	return s.ledger.AppendCertification(ctx, approvalReviewID, evidence)
}

func (s *Service) validateCertificationContract(evidence CertificationEvidence) error {
	if evidence.Subject.DeploymentEnvironment != s.deployment ||
		s.configurations == nil || !s.configurations.ContainsSubject(evidence.Subject) {
		return errors.New("provider certification subject is not configured in this runtime")
	}
	if !evidence.Subject.Operation.IsPublish() {
		return errors.New("provider certification operation is not supported")
	}
	capability, ok := capabilities.FindOutput(evidence.Subject.Provider, evidence.Subject.OutputProfile)
	if !ok {
		return errors.New("provider certification output profile is not implemented")
	}
	contract, err := PublicationContract(
		capability,
		evidence.Subject.Operation,
		s.managedProduction,
		evidence.Subject.AccountKind,
		evidence.Subject.PolicyMode,
	)
	if err != nil {
		return errors.New("provider certification contract is invalid")
	}
	digest, err := contract.Digest()
	if err != nil || digest != evidence.ContractDigest ||
		!sameStringSet(contract.Requirements.RequiredScopes, evidence.RequiredScopes) {
		return errors.New("provider certification contract does not match the current runtime")
	}
	requiredChecks := contract.Requirements.RequiredLocalChecks
	if evidence.Kind == EvidenceKindLive {
		requiredChecks = contract.Requirements.RequiredLiveChecks
	}
	if !certificationChecksMatchContract(evidence.Checks, requiredChecks, evidence.TestedAt, s.currentTime()) {
		return errors.New("provider certification checks do not match the current contract")
	}
	return nil
}

func certificationChecksMatchContract(
	checks []CheckResult,
	required []CheckRequirement,
	testedAt, now time.Time,
) bool {
	if len(checks) != len(required) || !validEvidenceChecks(checks, required, testedAt, now) {
		return false
	}
	requirements := make(map[CheckKind]CheckRequirement, len(required))
	for _, requirement := range required {
		requirements[requirement.Kind] = requirement
	}
	for _, check := range checks {
		requirement, ok := requirements[check.Kind]
		if !ok || (check.Outcome == CheckOutcomeNotApplicable && !requirement.AllowNotApplicable) {
			return false
		}
	}
	return true
}

func (s *Service) AppendRuntimeControl(ctx context.Context, event RuntimeControlEvent) error {
	if s == nil || s.ledger == nil {
		return errors.New("provider readiness ledger is unavailable")
	}
	return s.ledger.AppendRuntimeControl(ctx, event)
}

type NotReadyError struct {
	Decision Decision
}

func (e *NotReadyError) Error() string {
	if e == nil {
		return "provider operation is not ready"
	}
	return fmt.Sprintf("provider operation is not ready: %s", e.Decision.State)
}

func evaluationInput(
	request DecisionRequest,
	now time.Time,
	approval ApprovalEvidence,
	control RuntimeControl,
	local, live *CertificationEvidence,
) EvaluationInput {
	return EvaluationInput{
		Now:                         now,
		Implemented:                 request.Implemented,
		Subject:                     request.Subject,
		CurrentAccountReferenceHash: request.CurrentAccountReferenceHash,
		Intent:                      request.Intent,
		CurrentRevision:             request.CurrentRevision,
		Contract:                    request.Contract,
		Configuration:               request.Configuration,
		Approval:                    approval,
		Authorization:               request.Authorization,
		Policy:                      request.Policy,
		Control:                     control,
		LocalEvidence:               local,
		LiveEvidence:                live,
	}
}

func unavailableDecision(request DecisionRequest, now time.Time) Decision {
	contractDigest, _ := request.Contract.Digest()
	return Decision{
		State:          EffectiveStateDegraded,
		ContractDigest: contractDigest,
		Facts: Facts{
			Configuration:     effectiveConfigurationState(request.Configuration),
			LocalTest:         EvidenceStateMissing,
			LiveCertification: EvidenceStateMissing,
			Approval:          ApprovalStateUnknown,
			Authorization:     effectiveAuthorizationState(request.Authorization, now),
			Control:           RuntimeControlStateUnknown,
			Policy:            effectivePolicyState(request.Policy),
		},
		Blockers: []Blocker{{Code: BlockerReadinessUnavailable}},
	}
}

// UnavailableDecision is the only safe projection when a production entry
// point has not been wired to the readiness service. It keeps constructors and
// tests from turning dependency injection into an authorization bypass.
func UnavailableDecision(Operation) Decision {
	decision := Decision{
		State: EffectiveStateDegraded,
		Facts: Facts{
			Configuration: ConfigurationStateUnknown, LocalTest: EvidenceStateMissing,
			LiveCertification: EvidenceStateMissing, Approval: ApprovalStateUnknown,
			Authorization: AuthorizationStateUnknown, Control: RuntimeControlStateUnknown,
			Policy: PolicyStateUnknown,
		},
		Blockers: []Blocker{{Code: BlockerReadinessUnavailable}},
	}
	decision.Connectable = false
	decision.Publishable = false
	return decision
}

func (s *Service) currentTime() time.Time {
	if s == nil || s.now == nil {
		return time.Now().UTC()
	}
	return s.now().UTC()
}
