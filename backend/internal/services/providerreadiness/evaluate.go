package providerreadiness

import (
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

var (
	gitRevisionPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
	digestPattern      = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	providerPattern    = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)*$`)
	safeIDPattern      = regexp.MustCompile(`^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$`)
)

// Evaluate projects independent provider-readiness facts into one fail-closed
// decision. Callers must evaluate the exact subject they intend to execute;
// evidence for a different account kind, output profile, operation, provider
// app, instance, or policy mode never transfers implicitly.
func Evaluate(input EvaluationInput) Decision {
	contractDigest, _ := input.Contract.Digest()
	requirements := input.Contract.Requirements
	localState := evaluateEvidence(input.LocalEvidence, EvidenceKindLocal, input, requirements.RequiredLocalChecks, contractDigest)
	liveState := evaluateEvidence(input.LiveEvidence, EvidenceKindLive, input, requirements.RequiredLiveChecks, contractDigest)

	facts := Facts{
		Configuration:     effectiveConfigurationState(input.Configuration),
		LocalTest:         localState,
		LiveCertification: liveState,
		Approval:          effectiveApprovalState(input.Approval, input.Now),
		Authorization:     effectiveAuthorizationState(input.Authorization, input.Now),
		Control:           effectiveControlState(input.Control, input.Now),
		Policy:            effectivePolicyState(input.Policy),
	}
	groups := collectBlockers(input, localState, liveState)
	state, blockers := selectState(groups)
	executable := len(blockers) == 0

	decision := Decision{
		State:          state,
		ContractDigest: contractDigest,
		Executable:     executable,
		Connectable:    executable && input.Subject.Operation == OperationConnect,
		Publishable:    executable && input.Subject.Operation.IsPublish(),
		Facts:          facts,
		Blockers:       blockers,
	}
	decision.Advertisable = isAdvertisable(input, decision)
	return decision
}

// MostRestrictive returns the decision whose effective state has the highest
// fail-closed precedence. It lets aggregate catalog views remain consistent
// with exact subject decisions without reimplementing state ordering.
func MostRestrictive(decisions ...Decision) Decision {
	if len(decisions) == 0 {
		return Decision{State: EffectiveStateDegraded, Blockers: []Blocker{{Code: BlockerReadinessUnavailable}}}
	}
	worst := decisions[0]
	for _, candidate := range decisions[1:] {
		if effectiveStateRank(candidate.State) < effectiveStateRank(worst.State) {
			worst = candidate
		}
	}
	return worst
}

func effectiveStateRank(state EffectiveState) int {
	states := []EffectiveState{
		EffectiveStateUnsupported,
		EffectiveStateDisabled,
		EffectiveStateNeedsConfiguration,
		EffectiveStateReconnectRequired,
		EffectiveStateDegraded,
		EffectiveStateApprovalRequired,
		EffectiveStateTrialOnly,
		EffectiveStatePolicyRestricted,
		EffectiveStateExpiredProof,
		EffectiveStateCertificationNeeded,
		EffectiveStateHealthy,
	}
	for index, candidate := range states {
		if candidate == state {
			return index
		}
	}
	return 4
}

type blockerGroups struct {
	unsupported   []Blocker
	invalid       []Blocker
	disabled      []Blocker
	configuration []Blocker
	reconnect     []Blocker
	degraded      []Blocker
	approval      []Blocker
	trial         []Blocker
	policy        []Blocker
	expiredProof  []Blocker
	missingProof  []Blocker
}

func collectBlockers(input EvaluationInput, localState, liveState EvidenceState) blockerGroups {
	var groups blockerGroups
	if !input.Implemented {
		groups.unsupported = append(groups.unsupported, blocker(BlockerUnsupported))
		return groups
	}

	groups.invalid = validationBlockers(input)
	groups = addControlBlockers(groups, input)
	groups = addConfigurationBlockers(groups, input)
	groups = addAuthorizationBlockers(groups, input)
	groups = addApprovalBlockers(groups, input)
	groups = addPolicyBlockers(groups, input)
	groups = addEvidenceBlockers(groups, input, localState, liveState)
	return groups
}

func addControlBlockers(groups blockerGroups, input EvaluationInput) blockerGroups {
	switch effectiveControlState(input.Control, input.Now) {
	case RuntimeControlStateDisabled:
		groups.disabled = append(groups.disabled, blocker(BlockerDisabled))
	case RuntimeControlStateDegraded:
		groups.degraded = append(groups.degraded, blocker(BlockerDegraded))
	case RuntimeControlStateUnknown:
		groups.degraded = append(groups.degraded, blocker(BlockerUnknownRuntimeControl))
	}
	return groups
}

func addConfigurationBlockers(groups blockerGroups, input EvaluationInput) blockerGroups {
	requirements := input.Contract.Requirements
	if requirements.RequireConfiguration {
		switch input.Configuration.State {
		case ConfigurationStateConfigured:
			if input.Configuration.AppFingerprint != input.Subject.AppFingerprint {
				groups.configuration = append(groups.configuration, blocker(BlockerConfigurationMismatch))
			}
		case ConfigurationStateDynamic:
			if input.Subject.Operation != OperationConnect || input.Subject.InstanceFingerprint != "" ||
				input.Configuration.AppFingerprint != input.Subject.AppFingerprint {
				groups.configuration = append(groups.configuration, blocker(BlockerConfigurationMismatch))
			}
		default:
			groups.configuration = append(groups.configuration, blocker(BlockerMissingConfiguration))
		}
	}
	if requirements.RequireProductionDeployment && input.Subject.DeploymentEnvironment != DeploymentEnvironmentProduction {
		groups.configuration = append(groups.configuration, blocker(BlockerWrongDeployment))
	}
	if requirements.RequireProductionProviderApp && input.Subject.ProviderEnvironment != ProviderEnvironmentProduction {
		groups.configuration = append(groups.configuration, blocker(BlockerWrongProviderApp))
	}
	return groups
}

func addAuthorizationBlockers(groups blockerGroups, input EvaluationInput) blockerGroups {
	requirements := input.Contract.Requirements
	requireAuthorization := requirements.RequireAuthorization || len(requirements.RequiredScopes) > 0
	if !requireAuthorization {
		return groups
	}

	switch effectiveAuthorizationState(input.Authorization, input.Now) {
	case AuthorizationStateValid:
		for _, requiredScope := range requirements.RequiredScopes {
			if !slices.Contains(input.Authorization.GrantedScopes, requiredScope) {
				groups.reconnect = append(groups.reconnect, blockerWithDetail(BlockerMissingScope, requiredScope))
			}
		}
	default:
		code := BlockerReconnectRequired
		if !input.Authorization.ExpiresAt.IsZero() && !input.Authorization.ExpiresAt.After(input.Now) {
			code = BlockerAuthorizationExpired
		}
		groups.reconnect = append(groups.reconnect, blocker(code))
	}
	return groups
}

func addApprovalBlockers(groups blockerGroups, input EvaluationInput) blockerGroups {
	state := effectiveApprovalState(input.Approval, input.Now)
	switch state {
	case ApprovalStateApproved:
		return groups
	case ApprovalStateNotRequired:
		if !input.Contract.Requirements.RequireApproval {
			return groups
		}
	case ApprovalStateUnknown:
		if !input.Contract.Requirements.RequireApproval {
			return groups
		}
	case ApprovalStateTrial:
		if input.Intent == ExecutionIntentCertificationTest && input.Contract.Requirements.AllowTrialExecution {
			return groups
		}
		groups.trial = append(groups.trial, blocker(BlockerTrialOnly))
		return groups
	case ApprovalStateRestricted, ApprovalStateRevoked:
		groups.policy = append(groups.policy, blocker(BlockerPolicyRestricted))
		return groups
	}

	code := BlockerApprovalRequired
	if approvalReviewExpired(input.Approval, input.Now) {
		code = BlockerApprovalExpired
	}
	groups.approval = append(groups.approval, blocker(code))
	return groups
}

func addPolicyBlockers(groups blockerGroups, input EvaluationInput) blockerGroups {
	switch input.Policy.State {
	case PolicyStateRestricted:
		groups.policy = append(groups.policy, blocker(BlockerPolicyRestricted))
	case PolicyStateUnknown:
		groups.policy = append(groups.policy, blocker(BlockerUnknownPolicy))
	}
	return groups
}

func addEvidenceBlockers(groups blockerGroups, input EvaluationInput, localState, liveState EvidenceState) blockerGroups {
	if input.Intent == ExecutionIntentCertificationTest {
		return groups
	}
	if input.Contract.Requirements.RequireLocalEvidence {
		groups = addEvidenceStateBlocker(groups, EvidenceKindLocal, localState)
	}
	if input.Contract.Requirements.RequireLiveEvidence {
		groups = addEvidenceStateBlocker(groups, EvidenceKindLive, liveState)
	}
	return groups
}

func addEvidenceStateBlocker(groups blockerGroups, kind EvidenceKind, state EvidenceState) blockerGroups {
	if state == EvidenceStateCurrent {
		return groups
	}

	code := evidenceBlockerCode(kind, state)
	if state == EvidenceStateExpired {
		groups.expiredProof = append(groups.expiredProof, blocker(code))
	} else {
		groups.missingProof = append(groups.missingProof, blocker(code))
	}
	return groups
}

func evidenceBlockerCode(kind EvidenceKind, state EvidenceState) BlockerCode {
	if kind == EvidenceKindLocal {
		switch state {
		case EvidenceStateExpired:
			return BlockerLocalEvidenceExpired
		case EvidenceStateMismatch:
			return BlockerLocalEvidenceMismatch
		case EvidenceStateFailed:
			return BlockerLocalEvidenceFailed
		default:
			return BlockerLocalEvidenceMissing
		}
	}

	switch state {
	case EvidenceStateExpired:
		return BlockerLiveEvidenceExpired
	case EvidenceStateMismatch:
		return BlockerLiveEvidenceMismatch
	case EvidenceStateFailed:
		return BlockerLiveEvidenceFailed
	default:
		return BlockerLiveEvidenceMissing
	}
}

func selectState(groups blockerGroups) (EffectiveState, []Blocker) {
	rules := []struct {
		state    EffectiveState
		blockers []Blocker
	}{
		{EffectiveStateUnsupported, groups.unsupported},
		{EffectiveStateDisabled, groups.disabled},
		{EffectiveStateNeedsConfiguration, groups.configuration},
		{EffectiveStateReconnectRequired, groups.reconnect},
		{EffectiveStateDegraded, groups.invalid},
		{EffectiveStateDegraded, groups.degraded},
		{EffectiveStateApprovalRequired, groups.approval},
		{EffectiveStateTrialOnly, groups.trial},
		{EffectiveStatePolicyRestricted, groups.policy},
		{EffectiveStateExpiredProof, groups.expiredProof},
		{EffectiveStateCertificationNeeded, groups.missingProof},
	}

	all := make([]Blocker, 0)
	state := EffectiveStateHealthy
	for _, rule := range rules {
		if len(rule.blockers) == 0 {
			continue
		}
		if len(all) == 0 {
			state = rule.state
		}
		all = append(all, rule.blockers...)
	}
	return state, all
}

func validationBlockers(input EvaluationInput) []Blocker {
	var result []Blocker
	if !validSubject(input.Subject) {
		result = append(result, blocker(BlockerInvalidSubject))
	}
	if input.Now.IsZero() || !validIntent(input.Intent) || !validContractForSubject(input.Contract, input.Subject) {
		result = append(result, blocker(BlockerInvalidEvaluation))
	}
	if input.Subject.Operation.IsPublish() && !digestPattern.MatchString(input.CurrentAccountReferenceHash) {
		result = append(result, blocker(BlockerInvalidEvaluation))
	}
	if !validFactEvidence(input) {
		result = append(result, blocker(BlockerInvalidEvaluation))
	}
	if evidenceRelevant(input) && !gitRevisionPattern.MatchString(input.CurrentRevision) {
		result = append(result, blocker(BlockerInvalidEvaluation))
	}
	return result
}

func validSubject(subject Subject) bool {
	return validSubjectIdentity(subject) &&
		validDeploymentEnvironment(subject.DeploymentEnvironment) &&
		validProviderEnvironment(subject.ProviderEnvironment) &&
		validOperation(subject.Operation) &&
		validSubjectProfile(subject)
}

func validSubjectIdentity(subject Subject) bool {
	return providerPattern.MatchString(subject.Provider) &&
		digestPattern.MatchString(subject.AppFingerprint) &&
		(subject.InstanceFingerprint == "" || digestPattern.MatchString(subject.InstanceFingerprint))
}

func validSubjectProfile(subject Subject) bool {
	if !providerPattern.MatchString(subject.PolicyMode) {
		return false
	}
	if subject.AccountKind != "" && !providerPattern.MatchString(subject.AccountKind) {
		return false
	}
	if subject.OutputProfile != "" && !providerPattern.MatchString(subject.OutputProfile) {
		return false
	}
	return !subject.Operation.IsPublish() || (subject.AccountKind != "" && subject.OutputProfile != "")
}

func validFactEvidence(input EvaluationInput) bool {
	if !validConfigurationState(input.Configuration.State) ||
		!validApprovalEvidence(input.Approval, input.Now) ||
		!validAuthorizationEvidence(input.Authorization, input.Now) ||
		!validPolicyState(input.Policy.State) ||
		!validRuntimeControlState(input.Control.State) {
		return false
	}
	if input.Configuration.State == ConfigurationStateConfigured || input.Configuration.State == ConfigurationStateDynamic {
		return validConfigurationSource(input.Configuration.Source) &&
			digestPattern.MatchString(input.Configuration.AppFingerprint)
	}
	return input.Configuration.Source == ConfigurationSourceUnknown && input.Configuration.AppFingerprint == ""
}

func validApprovalEvidence(approval ApprovalEvidence, now time.Time) bool {
	if !validApprovalState(approval.State) || !validOptionalSafeCode(approval.Tier) {
		return false
	}
	reviewedState := approval.State == ApprovalStateApproved || approval.State == ApprovalStateTrial || approval.State == ApprovalStateNotRequired
	if !reviewedState {
		return approval.SourceURL == "" || validSafeURL(approval.SourceURL)
	}
	if approval.ReviewedAt.IsZero() || approval.ReviewedAt.After(now) || approval.ExpiresAt.IsZero() || !approval.ExpiresAt.After(approval.ReviewedAt) {
		return false
	}
	if approval.State == ApprovalStateNotRequired && approval.Tier != string(ApprovalStateNotRequired) {
		return false
	}
	return approval.Tier != "" && validSafeURL(approval.SourceURL)
}

func validAuthorizationEvidence(authorization AuthorizationEvidence, now time.Time) bool {
	if !validAuthorizationState(authorization.State) || !validUniqueScopes(authorization.GrantedScopes) || !validOptionalSafeCode(authorization.ReasonCode) {
		return false
	}
	if authorization.State != AuthorizationStateValid {
		return true
	}
	if authorization.ValidatedAt.IsZero() || authorization.ValidatedAt.After(now) {
		return false
	}
	return authorization.ExpiresAt.IsZero() || authorization.ExpiresAt.After(authorization.ValidatedAt)
}

func validSafeURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return false
	}
	for key, values := range parsed.Query() {
		if key != "hl" && key != "locale" && key != "view" {
			return false
		}
		if len(values) != 1 || !safeIDPattern.MatchString(values[0]) {
			return false
		}
	}
	return true
}

func validOptionalSafeCode(value string) bool {
	return value == "" || providerPattern.MatchString(value)
}

func validRequirements(requirements Requirements) bool {
	return validUniqueScopes(requirements.RequiredScopes) &&
		validUniqueChecks(requirements.RequiredLocalChecks) &&
		validUniqueChecks(requirements.RequiredLiveChecks)
}

func validContractForSubject(contract CertificationContract, subject Subject) bool {
	if _, err := contract.Digest(); err != nil {
		return false
	}
	requirements := contract.Requirements
	return validContractRelationships(requirements) &&
		validPublicationContract(requirements, subject.Operation) &&
		validEvidenceRequirementShape(requirements.RequireLocalEvidence, requirements.RequiredLocalChecks, subject.Operation) &&
		validEvidenceRequirementShape(requirements.RequireLiveEvidence, requirements.RequiredLiveChecks, subject.Operation)
}

func validPublicationContract(requirements Requirements, operation Operation) bool {
	if !operation.IsPublish() {
		return true
	}
	if !requirements.RequireConfiguration || !requirements.RequireAuthorization {
		return false
	}
	managedProduction := requirements.RequireProductionDeployment || requirements.RequireProductionProviderApp
	return !managedProduction || (requirements.RequireProductionDeployment &&
		requirements.RequireProductionProviderApp &&
		requirements.RequireLocalEvidence && requirements.RequireLiveEvidence)
}

func validContractRelationships(requirements Requirements) bool {
	if requirements.RequireLiveEvidence && !requirements.RequireLocalEvidence {
		return false
	}
	if requirements.RequireExactRevision && !requirements.RequireLocalEvidence && !requirements.RequireLiveEvidence {
		return false
	}
	if requirements.AllowTrialExecution && !requirements.RequireApproval {
		return false
	}
	if requirements.RequireProductionProviderApp && !requirements.RequireConfiguration {
		return false
	}
	return true
}

func validEvidenceRequirementShape(required bool, checks []CheckRequirement, operation Operation) bool {
	return required == (len(checks) > 0) && (!required || containsRequiredChecks(checks, operation))
}

func containsRequiredChecks(requirements []CheckRequirement, operation Operation) bool {
	requiredKinds := []CheckKind{CheckConnect, CheckAuthorization}
	switch operation {
	case OperationPublishImmediate:
		requiredKinds = append(requiredKinds, CheckPublishImmediate, CheckFinalResult, CheckRefresh, CheckRevoke)
	case OperationPublishScheduled:
		requiredKinds = append(requiredKinds, CheckPublishScheduled, CheckFinalResult, CheckRefresh, CheckRevoke)
	case OperationRefresh:
		requiredKinds = append(requiredKinds, CheckRefresh)
	case OperationRevoke:
		requiredKinds = append(requiredKinds, CheckRevoke)
	}
	for _, kind := range requiredKinds {
		if !hasCheckRequirement(requirements, kind) {
			return false
		}
	}
	return true
}

func hasCheckRequirement(requirements []CheckRequirement, kind CheckKind) bool {
	for _, requirement := range requirements {
		if requirement.Kind == kind {
			return true
		}
	}
	return false
}

func evidenceRelevant(input EvaluationInput) bool {
	return input.Contract.Requirements.RequireLocalEvidence || input.Contract.Requirements.RequireLiveEvidence ||
		input.LocalEvidence != nil || input.LiveEvidence != nil
}

func evaluateEvidence(evidence *CertificationEvidence, kind EvidenceKind, input EvaluationInput, requiredChecks []CheckRequirement, contractDigest string) EvidenceState {
	if evidence == nil {
		return EvidenceStateMissing
	}
	if !validEvidenceStructure(evidence, kind, input, requiredChecks, contractDigest) {
		return EvidenceStateMismatch
	}
	if !evidence.ExpiresAt.After(input.Now) {
		return EvidenceStateExpired
	}
	if hasFailedCheck(evidence.Checks, requiredChecks) {
		return EvidenceStateFailed
	}
	return EvidenceStateCurrent
}

func validEvidenceStructure(evidence *CertificationEvidence, kind EvidenceKind, input EvaluationInput, requiredChecks []CheckRequirement, contractDigest string) bool {
	return validEvidenceIdentity(evidence, kind, input, contractDigest) &&
		validEvidenceTiming(evidence, input) &&
		validEvidenceApproval(evidence, input) &&
		validEvidenceScopes(evidence, input) &&
		validEvidenceChecks(evidence.Checks, requiredChecks, evidence.TestedAt, input.Now)
}

func validEvidenceIdentity(evidence *CertificationEvidence, kind EvidenceKind, input EvaluationInput, contractDigest string) bool {
	if !safeIDPattern.MatchString(evidence.ID) || !safeIDPattern.MatchString(evidence.OperatorRef) || evidence.Kind != kind {
		return false
	}
	if evidence.Subject != input.Subject || !gitRevisionPattern.MatchString(evidence.TestedRevision) {
		return false
	}
	if input.Contract.Requirements.RequireExactRevision && evidence.TestedRevision != input.CurrentRevision {
		return false
	}
	if evidence.AccountReferenceHash != "" && !digestPattern.MatchString(evidence.AccountReferenceHash) {
		return false
	}
	if kind == EvidenceKindLive && evidence.AccountReferenceHash == "" {
		return false
	}
	if kind == EvidenceKindLive && evidence.AccountReferenceHash != input.CurrentAccountReferenceHash {
		return false
	}
	return contractDigest != "" && evidence.ContractDigest == contractDigest
}

func validEvidenceTiming(evidence *CertificationEvidence, input EvaluationInput) bool {
	if evidence.TestedAt.IsZero() || evidence.ExpiresAt.IsZero() || evidence.TestedAt.After(input.Now) || !evidence.ExpiresAt.After(evidence.TestedAt) {
		return false
	}
	return input.Approval.ReviewedAt.IsZero() || !evidence.TestedAt.Before(input.Approval.ReviewedAt)
}

func validEvidenceApproval(evidence *CertificationEvidence, input EvaluationInput) bool {
	return evidence.ApprovalStateAtTest == effectiveApprovalState(input.Approval, input.Now) &&
		evidence.ApprovalTierAtTest == input.Approval.Tier
}

func validEvidenceScopes(evidence *CertificationEvidence, input EvaluationInput) bool {
	return validUniqueScopes(evidence.RequiredScopes) &&
		validUniqueScopes(evidence.GrantedScopes) &&
		sameStringSet(evidence.RequiredScopes, input.Contract.Requirements.RequiredScopes) &&
		containsAll(evidence.GrantedScopes, evidence.RequiredScopes) &&
		sameStringSet(evidence.GrantedScopes, input.Authorization.GrantedScopes)
}

func validEvidenceChecks(checks []CheckResult, required []CheckRequirement, testedAt, now time.Time) bool {
	seen := make(map[CheckKind]struct{}, len(checks))
	for _, check := range checks {
		if !validCheckResult(check) {
			return false
		}
		if _, duplicate := seen[check.Kind]; duplicate {
			return false
		}
		seen[check.Kind] = struct{}{}
		if check.CompletedAt.IsZero() || check.CompletedAt.Before(testedAt) || check.CompletedAt.After(now) {
			return false
		}
	}
	for _, requiredCheck := range required {
		if _, ok := seen[requiredCheck.Kind]; !ok {
			return false
		}
	}
	return true
}

func validCheckResult(check CheckResult) bool {
	if !validCheckKind(check.Kind) || !validCheckOutcome(check.Outcome) {
		return false
	}
	if check.ExternalRefHash != "" && !digestPattern.MatchString(check.ExternalRefHash) {
		return false
	}
	switch check.Outcome {
	case CheckOutcomePassed:
		if check.ErrorClass != "" || check.NotApplicableReason != "" {
			return false
		}
		return !checkRequiresExternalReference(check.Kind) || check.ExternalRefHash != ""
	case CheckOutcomeFailed:
		return providerPattern.MatchString(check.ErrorClass) && check.NotApplicableReason == ""
	case CheckOutcomeNotApplicable:
		return check.ErrorClass == "" && providerPattern.MatchString(check.NotApplicableReason)
	default:
		return false
	}
}

func hasFailedCheck(checks []CheckResult, required []CheckRequirement) bool {
	requiredSet := make(map[CheckKind]CheckRequirement, len(required))
	for _, requirement := range required {
		requiredSet[requirement.Kind] = requirement
	}
	for _, check := range checks {
		if check.Outcome == CheckOutcomeFailed {
			return true
		}
		requirement, isRequired := requiredSet[check.Kind]
		if isRequired && check.Outcome != CheckOutcomePassed && (check.Outcome != CheckOutcomeNotApplicable || !requirement.AllowNotApplicable) {
			return true
		}
	}
	return false
}

func effectiveApprovalState(approval ApprovalEvidence, now time.Time) ApprovalState {
	if !validApprovalState(approval.State) {
		return ApprovalStateUnknown
	}
	if approvalReviewExpired(approval, now) {
		return ApprovalStateUnknown
	}
	return approval.State
}

func approvalReviewExpired(approval ApprovalEvidence, now time.Time) bool {
	reviewedState := approval.State == ApprovalStateApproved || approval.State == ApprovalStateTrial || approval.State == ApprovalStateNotRequired
	return reviewedState && !approval.ExpiresAt.IsZero() && !approval.ExpiresAt.After(now)
}

func effectiveAuthorizationState(authorization AuthorizationEvidence, now time.Time) AuthorizationState {
	if !validAuthorizationState(authorization.State) {
		return AuthorizationStateUnknown
	}
	if authorization.State == AuthorizationStateValid && !authorization.ExpiresAt.IsZero() && !authorization.ExpiresAt.After(now) {
		return AuthorizationStateReconnectRequired
	}
	return authorization.State
}

func effectiveControlState(control RuntimeControl, now time.Time) RuntimeControlState {
	if !validRuntimeControlState(control.State) {
		return RuntimeControlStateUnknown
	}
	if !control.ExpiresAt.IsZero() && !control.ExpiresAt.After(now) {
		return RuntimeControlStateUnknown
	}
	return control.State
}

func effectiveConfigurationState(configuration ConfigurationEvidence) ConfigurationState {
	if !validConfigurationState(configuration.State) {
		return ConfigurationStateUnknown
	}
	return configuration.State
}

func effectivePolicyState(policy PolicyEvidence) PolicyState {
	if !validPolicyState(policy.State) {
		return PolicyStateUnknown
	}
	return policy.State
}

func isAdvertisable(input EvaluationInput, decision Decision) bool {
	if !decision.Executable || !decision.Publishable || input.Intent != ExecutionIntentProduction {
		return false
	}
	if input.Subject.DeploymentEnvironment != DeploymentEnvironmentProduction || input.Subject.ProviderEnvironment != ProviderEnvironmentProduction {
		return false
	}
	if input.Configuration.State != ConfigurationStateConfigured || input.Control.State != RuntimeControlStateEnabled || input.Policy.State != PolicyStateAllowed {
		return false
	}
	if input.Approval.State != ApprovalStateApproved && input.Approval.State != ApprovalStateNotRequired {
		return false
	}
	requirements := input.Contract.Requirements
	if !validPublicationContract(requirements, input.Subject.Operation) {
		return false
	}
	return decision.Facts.LocalTest == EvidenceStateCurrent && decision.Facts.LiveCertification == EvidenceStateCurrent
}

func sameStringSet(left, right []string) bool {
	return len(left) == len(right) && containsAll(left, right) && containsAll(right, left)
}

func containsAll(haystack, needles []string) bool {
	for _, needle := range needles {
		if !slices.Contains(haystack, needle) {
			return false
		}
	}
	return true
}

func validUniqueScopes(scopes []string) bool {
	seen := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		if strings.TrimSpace(scope) != scope || scope == "" || len(scope) > 256 || strings.ContainsAny(scope, "\t\r\n") {
			return false
		}
		if _, duplicate := seen[scope]; duplicate {
			return false
		}
		seen[scope] = struct{}{}
	}
	return true
}

func validUniqueChecks(checks []CheckRequirement) bool {
	seen := make(map[CheckKind]struct{}, len(checks))
	for _, check := range checks {
		if !validCheckKind(check.Kind) || (check.AllowNotApplicable && check.Kind != CheckRefresh && check.Kind != CheckRevoke) {
			return false
		}
		if _, duplicate := seen[check.Kind]; duplicate {
			return false
		}
		seen[check.Kind] = struct{}{}
	}
	return true
}

func validDeploymentEnvironment(environment DeploymentEnvironment) bool {
	return environment == DeploymentEnvironmentLocal || environment == DeploymentEnvironmentStaging || environment == DeploymentEnvironmentProduction
}

func validProviderEnvironment(environment ProviderEnvironment) bool {
	return environment == ProviderEnvironmentDevelopment || environment == ProviderEnvironmentSandbox || environment == ProviderEnvironmentProduction
}

func validOperation(operation Operation) bool {
	return operation == OperationConnect || operation == OperationPublishImmediate || operation == OperationPublishScheduled || operation == OperationRefresh || operation == OperationRevoke
}

func validIntent(intent ExecutionIntent) bool {
	return intent == ExecutionIntentProduction || intent == ExecutionIntentCertificationTest
}

func validConfigurationSource(source ConfigurationSource) bool {
	return source == ConfigurationSourceBuiltIn || source == ConfigurationSourceEnvironment || source == ConfigurationSourceDatabase || source == ConfigurationSourceDynamic
}

func validConfigurationState(state ConfigurationState) bool {
	return state == ConfigurationStateUnknown || state == ConfigurationStateMissing ||
		state == ConfigurationStateDynamic || state == ConfigurationStateConfigured
}

func checkRequiresExternalReference(kind CheckKind) bool {
	return kind == CheckPublishImmediate || kind == CheckPublishScheduled || kind == CheckFinalResult
}

func validApprovalState(state ApprovalState) bool {
	return state == ApprovalStateUnknown || state == ApprovalStateNotRequired || state == ApprovalStatePending || state == ApprovalStateTrial || state == ApprovalStateApproved || state == ApprovalStateRestricted || state == ApprovalStateRevoked
}

func validAuthorizationState(state AuthorizationState) bool {
	return state == AuthorizationStateUnknown || state == AuthorizationStateNotApplicable || state == AuthorizationStateValid || state == AuthorizationStateReconnectRequired
}

func validPolicyState(state PolicyState) bool {
	return state == PolicyStateUnknown || state == PolicyStateAllowed || state == PolicyStateRestricted
}

func validRuntimeControlState(state RuntimeControlState) bool {
	return state == RuntimeControlStateUnknown || state == RuntimeControlStateEnabled || state == RuntimeControlStateDegraded || state == RuntimeControlStateDisabled
}

func validCheckKind(kind CheckKind) bool {
	return kind == CheckConnect || kind == CheckAuthorization || kind == CheckPublishImmediate || kind == CheckPublishScheduled || kind == CheckFinalResult || kind == CheckRefresh || kind == CheckRevoke
}

func validCheckOutcome(outcome CheckOutcome) bool {
	return outcome == CheckOutcomePassed || outcome == CheckOutcomeFailed || outcome == CheckOutcomeNotApplicable
}

func blocker(code BlockerCode) Blocker {
	return Blocker{Code: code}
}

func blockerWithDetail(code BlockerCode, detail string) Blocker {
	return Blocker{Code: code, Detail: detail}
}
