package providerreadiness

import (
	"strings"
	"testing"
	"time"
)

func TestEvaluateHealthyLiveCertifiedPublication(t *testing.T) {
	t.Parallel()

	input := healthyInput()
	decision := Evaluate(input)

	if decision.State != EffectiveStateHealthy {
		t.Fatalf("state = %q, want %q; blockers = %#v", decision.State, EffectiveStateHealthy, decision.Blockers)
	}
	if !decision.Executable || !decision.Publishable || decision.Connectable || !decision.Advertisable {
		t.Fatalf("unexpected decision flags: %#v", decision)
	}
	if decision.Facts.Configuration != ConfigurationStateConfigured ||
		decision.Facts.LocalTest != EvidenceStateCurrent ||
		decision.Facts.LiveCertification != EvidenceStateCurrent {
		t.Fatalf("unexpected facts: %#v", decision.Facts)
	}
}

func TestEvaluateFailClosedStatePrecedence(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		mutate      func(*EvaluationInput)
		wantState   EffectiveState
		wantBlocker BlockerCode
	}{
		{
			name: "unsupported beats all runtime facts",
			mutate: func(input *EvaluationInput) {
				input.Implemented = false
				input.Control.State = RuntimeControlStateDisabled
			},
			wantState: EffectiveStateUnsupported, wantBlocker: BlockerUnsupported,
		},
		{
			name: "invalid exact subject",
			mutate: func(input *EvaluationInput) {
				input.Subject.PolicyMode = ""
			},
			wantState: EffectiveStateDegraded, wantBlocker: BlockerInvalidSubject,
		},
		{
			name: "disabled beats missing configuration",
			mutate: func(input *EvaluationInput) {
				input.Control.State = RuntimeControlStateDisabled
				input.Configuration.State = ConfigurationStateMissing
				input.Configuration.Source = ConfigurationSourceUnknown
				input.Configuration.AppFingerprint = ""
			},
			wantState: EffectiveStateDisabled, wantBlocker: BlockerDisabled,
		},
		{
			name: "explicit disable remains the highest runtime gate",
			mutate: func(input *EvaluationInput) {
				input.Control.State = RuntimeControlStateDisabled
				input.Policy.State = PolicyState("invalid")
			},
			wantState: EffectiveStateDisabled, wantBlocker: BlockerDisabled,
		},
		{
			name: "missing configuration",
			mutate: func(input *EvaluationInput) {
				input.Configuration.State = ConfigurationStateMissing
				input.Configuration.Source = ConfigurationSourceUnknown
				input.Configuration.AppFingerprint = ""
			},
			wantState: EffectiveStateNeedsConfiguration, wantBlocker: BlockerMissingConfiguration,
		},
		{
			name: "configured fingerprint must match runtime subject",
			mutate: func(input *EvaluationInput) {
				input.Configuration.AppFingerprint = "sha256:" + strings.Repeat("e", 64)
			},
			wantState: EffectiveStateNeedsConfiguration, wantBlocker: BlockerConfigurationMismatch,
		},
		{
			name: "expired per-account authorization",
			mutate: func(input *EvaluationInput) {
				input.Authorization.ExpiresAt = input.Now
			},
			wantState: EffectiveStateReconnectRequired, wantBlocker: BlockerAuthorizationExpired,
		},
		{
			name: "missing exact account scope",
			mutate: func(input *EvaluationInput) {
				input.Authorization.GrantedScopes = []string{"users.read"}
			},
			wantState: EffectiveStateReconnectRequired, wantBlocker: BlockerMissingScope,
		},
		{
			name: "empty grant cannot skip required scopes",
			mutate: func(input *EvaluationInput) {
				input.Authorization.GrantedScopes = nil
			},
			wantState: EffectiveStateReconnectRequired, wantBlocker: BlockerMissingScope,
		},
		{
			name: "degraded runtime control",
			mutate: func(input *EvaluationInput) {
				input.Control.State = RuntimeControlStateDegraded
			},
			wantState: EffectiveStateDegraded, wantBlocker: BlockerDegraded,
		},
		{
			name: "expired runtime control fails closed",
			mutate: func(input *EvaluationInput) {
				input.Control.ExpiresAt = input.Now
			},
			wantState: EffectiveStateDegraded, wantBlocker: BlockerUnknownRuntimeControl,
		},
		{
			name: "approval pending",
			mutate: func(input *EvaluationInput) {
				input.Approval.State = ApprovalStatePending
			},
			wantState: EffectiveStateApprovalRequired, wantBlocker: BlockerApprovalRequired,
		},
		{
			name: "approval review expired",
			mutate: func(input *EvaluationInput) {
				input.Approval.ExpiresAt = input.Now
			},
			wantState: EffectiveStateApprovalRequired, wantBlocker: BlockerApprovalExpired,
		},
		{
			name: "trial cannot publish as production",
			mutate: func(input *EvaluationInput) {
				input.Approval.State = ApprovalStateTrial
				input.Contract.Requirements.AllowTrialExecution = true
			},
			wantState: EffectiveStateTrialOnly, wantBlocker: BlockerTrialOnly,
		},
		{
			name: "policy restriction",
			mutate: func(input *EvaluationInput) {
				input.Policy.State = PolicyStateRestricted
			},
			wantState: EffectiveStatePolicyRestricted, wantBlocker: BlockerPolicyRestricted,
		},
		{
			name: "expired proof",
			mutate: func(input *EvaluationInput) {
				input.LiveEvidence.ExpiresAt = input.Now
			},
			wantState: EffectiveStateExpiredProof, wantBlocker: BlockerLiveEvidenceExpired,
		},
		{
			name: "missing proof",
			mutate: func(input *EvaluationInput) {
				input.LiveEvidence = nil
			},
			wantState: EffectiveStateCertificationNeeded, wantBlocker: BlockerLiveEvidenceMissing,
		},
		{
			name: "subject mismatch does not transfer certification",
			mutate: func(input *EvaluationInput) {
				input.LiveEvidence.Subject.OutputProfile = "video"
			},
			wantState: EffectiveStateCertificationNeeded, wantBlocker: BlockerLiveEvidenceMismatch,
		},
		{
			name: "provider policy mismatch does not transfer certification",
			mutate: func(input *EvaluationInput) {
				input.Subject.PolicyMode = "x.restricted"
			},
			wantState: EffectiveStateCertificationNeeded, wantBlocker: BlockerLiveEvidenceMismatch,
		},
		{
			name: "failed required check",
			mutate: func(input *EvaluationInput) {
				input.LiveEvidence.Checks[2].Outcome = CheckOutcomeFailed
				input.LiveEvidence.Checks[2].ErrorClass = "provider_rejected"
			},
			wantState: EffectiveStateCertificationNeeded, wantBlocker: BlockerLiveEvidenceFailed,
		},
		{
			name: "not-applicable cannot satisfy a required check",
			mutate: func(input *EvaluationInput) {
				input.LiveEvidence.Checks[2].Outcome = CheckOutcomeNotApplicable
				input.LiveEvidence.Checks[2].NotApplicableReason = "not_supported"
			},
			wantState: EffectiveStateCertificationNeeded, wantBlocker: BlockerLiveEvidenceFailed,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			input := cloneInput(healthyInput())
			test.mutate(&input)

			decision := Evaluate(input)
			if decision.State != test.wantState {
				t.Fatalf("state = %q, want %q; blockers = %#v", decision.State, test.wantState, decision.Blockers)
			}
			if decision.Executable || decision.Publishable || decision.Advertisable {
				t.Fatalf("blocked decision exposes executable flags: %#v", decision)
			}
			if !hasBlocker(decision.Blockers, test.wantBlocker) {
				t.Fatalf("blockers = %#v, want %q", decision.Blockers, test.wantBlocker)
			}
		})
	}
}

func TestEvaluateCertificationIntentBypassesOnlyPriorProof(t *testing.T) {
	t.Parallel()

	input := healthyInput()
	input.Intent = ExecutionIntentCertificationTest
	input.LocalEvidence = nil
	input.LiveEvidence = nil
	decision := Evaluate(input)
	if decision.State != EffectiveStateHealthy || !decision.Executable || decision.Advertisable {
		t.Fatalf("certification test should bypass prior proof without creating a claim: %#v", decision)
	}

	input.Authorization.State = AuthorizationStateReconnectRequired
	decision = Evaluate(input)
	if decision.State != EffectiveStateReconnectRequired || decision.Executable {
		t.Fatalf("certification test bypassed authorization: %#v", decision)
	}

	input = healthyInput()
	input.Intent = ExecutionIntentCertificationTest
	input.LocalEvidence = nil
	input.LiveEvidence = nil
	input.Approval.State = ApprovalStateTrial
	input.Contract.Requirements.AllowTrialExecution = true
	decision = Evaluate(input)
	if decision.State != EffectiveStateHealthy || !decision.Executable || decision.Advertisable {
		t.Fatalf("explicit trial certification should execute without becoming a claim: %#v", decision)
	}
}

func TestEvaluateSelfHostedExecutionDoesNotBecomeAPublicClaim(t *testing.T) {
	t.Parallel()

	input := healthyInput()
	input.Subject.DeploymentEnvironment = DeploymentEnvironmentLocal
	input.Subject.ProviderEnvironment = ProviderEnvironmentDevelopment
	input.Contract.Requirements.RequireProductionDeployment = false
	input.Contract.Requirements.RequireProductionProviderApp = false
	input.Contract.Requirements.RequireApproval = false
	input.Contract.Requirements.RequireLocalEvidence = false
	input.Contract.Requirements.RequireLiveEvidence = false
	input.Contract.Requirements.RequiredLocalChecks = nil
	input.Contract.Requirements.RequiredLiveChecks = nil
	input.Approval = ApprovalEvidence{State: ApprovalStateUnknown}
	input.LocalEvidence = nil
	input.LiveEvidence = nil

	decision := Evaluate(input)
	if decision.State != EffectiveStateHealthy || !decision.Executable || !decision.Publishable || decision.Advertisable {
		t.Fatalf("self-hosted execution should stay usable without becoming a public claim: %#v", decision)
	}
}

func TestEvaluateAllowsExplicitlyInapplicableLifecycleChecks(t *testing.T) {
	t.Parallel()

	input := healthyInput()
	for _, evidence := range []*CertificationEvidence{input.LocalEvidence, input.LiveEvidence} {
		for index := range evidence.Checks {
			if evidence.Checks[index].Kind != CheckRefresh && evidence.Checks[index].Kind != CheckRevoke {
				continue
			}
			evidence.Checks[index].Outcome = CheckOutcomeNotApplicable
			evidence.Checks[index].NotApplicableReason = "provider_managed_lifecycle"
		}
	}
	decision := Evaluate(input)
	if decision.State != EffectiveStateHealthy || !decision.Executable || !decision.Advertisable {
		t.Fatalf("explicit lifecycle applicability should remain certifiable: %#v", decision)
	}
}

func TestEvaluateContractCompatibilityAndExactRevision(t *testing.T) {
	t.Parallel()

	input := healthyInput()
	if input.LiveEvidence.TestedRevision == input.CurrentRevision {
		t.Fatal("fixture must prove a prior revision with an unchanged contract digest")
	}
	if decision := Evaluate(input); decision.State != EffectiveStateHealthy {
		t.Fatalf("matching contract digest should keep compatible evidence current: %#v", decision)
	}

	input = cloneInput(input)
	input.Contract.Requirements.RequireExactRevision = true
	refreshEvidenceContractDigests(&input)
	decision := Evaluate(input)
	if decision.State != EffectiveStateCertificationNeeded || !hasBlocker(decision.Blockers, BlockerLocalEvidenceMismatch) {
		t.Fatalf("exact-revision requirement did not invalidate prior proof: %#v", decision)
	}

	input = healthyInput()
	input.Contract.CapabilityDigest = "sha256:" + strings.Repeat("d", 64)
	decision = Evaluate(input)
	if decision.State != EffectiveStateCertificationNeeded || !hasBlocker(decision.Blockers, BlockerLiveEvidenceMismatch) {
		t.Fatalf("contract change did not invalidate evidence: %#v", decision)
	}
}

func TestEvaluateConnectProjectionNeverCreatesPublicClaim(t *testing.T) {
	t.Parallel()

	input := healthyInput()
	input.Subject.Operation = OperationConnect
	input.Subject.AccountKind = ""
	input.Subject.OutputProfile = ""
	input.Contract.Requirements.RequireAuthorization = false
	input.Contract.Requirements.RequireLocalEvidence = false
	input.Contract.Requirements.RequireLiveEvidence = false
	input.Contract.Requirements.RequiredScopes = nil
	input.Contract.Requirements.RequiredLocalChecks = nil
	input.Contract.Requirements.RequiredLiveChecks = nil
	input.LocalEvidence = nil
	input.LiveEvidence = nil

	decision := Evaluate(input)
	if decision.State != EffectiveStateHealthy || !decision.Executable || !decision.Connectable || decision.Publishable || decision.Advertisable {
		t.Fatalf("unexpected connect decision: %#v", decision)
	}
}

func TestEvaluateRejectsEmptyLiveAccountAndProviderResultProof(t *testing.T) {
	t.Parallel()

	input := cloneInput(healthyInput())
	input.LiveEvidence.AccountReferenceHash = ""
	decision := Evaluate(input)
	if decision.Executable || decision.State != EffectiveStateCertificationNeeded ||
		!hasBlocker(decision.Blockers, BlockerLiveEvidenceMismatch) {
		t.Fatalf("empty live test-account reference was accepted: %#v", decision)
	}

	input = cloneInput(healthyInput())
	for index := range input.LiveEvidence.Checks {
		if input.LiveEvidence.Checks[index].Kind == CheckFinalResult {
			input.LiveEvidence.Checks[index].ExternalRefHash = ""
		}
	}
	decision = Evaluate(input)
	if decision.Executable || decision.State != EffectiveStateCertificationNeeded ||
		!hasBlocker(decision.Blockers, BlockerLiveEvidenceMismatch) {
		t.Fatalf("empty final provider result reference was accepted: %#v", decision)
	}
}

func TestEvaluateDoesNotTransferLiveProofBetweenAccounts(t *testing.T) {
	t.Parallel()

	input := cloneInput(healthyInput())
	input.CurrentAccountReferenceHash = "sha256:" + strings.Repeat("9", 64)
	decision := Evaluate(input)
	if decision.Executable || decision.State != EffectiveStateCertificationNeeded ||
		!hasBlocker(decision.Blockers, BlockerLiveEvidenceMismatch) {
		t.Fatalf("account A live proof authorized account B: %#v", decision)
	}
}

func TestEvaluateRejectsMalformedFactsAndIncompleteContracts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		mutate func(*EvaluationInput)
	}{
		{
			name: "unknown runtime state",
			mutate: func(input *EvaluationInput) {
				input.Control.State = RuntimeControlState("bypassed")
			},
		},
		{
			name: "approved without review evidence",
			mutate: func(input *EvaluationInput) {
				input.Approval.SourceURL = ""
			},
		},
		{
			name: "valid authorization without validation time",
			mutate: func(input *EvaluationInput) {
				input.Authorization.ValidatedAt = time.Time{}
			},
		},
		{
			name: "invalid source digest even without proof lookup",
			mutate: func(input *EvaluationInput) {
				input.Contract.PolicyDigest = "main"
			},
		},
		{
			name: "live evidence cannot skip local evidence",
			mutate: func(input *EvaluationInput) {
				input.Contract.Requirements.RequireLocalEvidence = false
				input.Contract.Requirements.RequiredLocalChecks = nil
			},
		},
		{
			name: "production publication cannot opt out of live proof",
			mutate: func(input *EvaluationInput) {
				input.Contract.Requirements.RequireLiveEvidence = false
				input.Contract.Requirements.RequiredLiveChecks = nil
				input.LiveEvidence = nil
			},
		},
		{
			name: "publication proof requires final outcome",
			mutate: func(input *EvaluationInput) {
				input.Contract.Requirements.RequiredLiveChecks = input.Contract.Requirements.RequiredLiveChecks[:3]
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			input := cloneInput(healthyInput())
			test.mutate(&input)
			decision := Evaluate(input)
			if decision.State != EffectiveStateDegraded || decision.Executable || !hasBlocker(decision.Blockers, BlockerInvalidEvaluation) {
				t.Fatalf("malformed input did not fail closed: %#v", decision)
			}
		})
	}
}

func healthyInput() EvaluationInput {
	now := time.Date(2026, time.August, 9, 12, 0, 0, 0, time.UTC)
	subject := Subject{
		Provider:              "x",
		AppFingerprint:        "sha256:" + strings.Repeat("a", 64),
		DeploymentEnvironment: DeploymentEnvironmentProduction,
		ProviderEnvironment:   ProviderEnvironmentProduction,
		AccountKind:           "standard",
		OutputProfile:         "text",
		Operation:             OperationPublishImmediate,
		PolicyMode:            "x.standard",
	}
	requiredChecks := []CheckKind{
		CheckConnect,
		CheckAuthorization,
		CheckPublishImmediate,
		CheckFinalResult,
		CheckRefresh,
		CheckRevoke,
	}
	checkRequirements := make([]CheckRequirement, 0, len(requiredChecks))
	for _, kind := range requiredChecks {
		checkRequirements = append(checkRequirements, CheckRequirement{
			Kind:               kind,
			AllowNotApplicable: kind == CheckRefresh || kind == CheckRevoke,
		})
	}
	input := EvaluationInput{
		Now:                         now,
		Implemented:                 true,
		Subject:                     subject,
		CurrentAccountReferenceHash: "sha256:" + strings.Repeat("f", 64),
		Intent:                      ExecutionIntentProduction,
		CurrentRevision:             strings.Repeat("b", 40),
		Configuration: ConfigurationEvidence{
			State:          ConfigurationStateConfigured,
			Source:         ConfigurationSourceEnvironment,
			AppFingerprint: subject.AppFingerprint,
		},
		Approval: ApprovalEvidence{
			State:      ApprovalStateApproved,
			Tier:       "standard",
			SourceURL:  "https://docs.x.com/x-api/overview",
			ReviewedAt: now.Add(-48 * time.Hour),
			ExpiresAt:  now.Add(90 * 24 * time.Hour),
		},
		Authorization: AuthorizationEvidence{
			State:         AuthorizationStateValid,
			GrantedScopes: []string{"tweet.write", "users.read"},
			ValidatedAt:   now.Add(-time.Hour),
			ExpiresAt:     now.Add(24 * time.Hour),
		},
		Policy:  PolicyEvidence{State: PolicyStateAllowed},
		Control: RuntimeControl{State: RuntimeControlStateEnabled},
		Contract: CertificationContract{
			SchemaVersion:    CertificationContractSchemaVersion,
			CapabilityDigest: "sha256:" + strings.Repeat("c", 64),
			PolicyDigest:     "sha256:" + strings.Repeat("d", 64),
			Requirements: Requirements{
				RequireConfiguration:         true,
				RequireProductionDeployment:  true,
				RequireProductionProviderApp: true,
				RequireApproval:              true,
				RequireAuthorization:         true,
				RequireLocalEvidence:         true,
				RequireLiveEvidence:          true,
				RequiredScopes:               []string{"tweet.write", "users.read"},
				RequiredLocalChecks:          append([]CheckRequirement(nil), checkRequirements...),
				RequiredLiveChecks:           append([]CheckRequirement(nil), checkRequirements...),
			},
		},
	}
	input.LocalEvidence = certificationEvidence(input, EvidenceKindLocal, requiredChecks)
	input.LiveEvidence = certificationEvidence(input, EvidenceKindLive, requiredChecks)
	return input
}

func certificationEvidence(input EvaluationInput, kind EvidenceKind, checks []CheckKind) *CertificationEvidence {
	contractDigest, err := input.Contract.Digest()
	if err != nil {
		panic(err)
	}
	results := make([]CheckResult, 0, len(checks))
	for _, kind := range checks {
		externalRef := ""
		if checkRequiresExternalReference(kind) {
			externalRef = "sha256:" + strings.Repeat("e", 64)
		}
		results = append(results, CheckResult{
			Kind:            kind,
			Outcome:         CheckOutcomePassed,
			ExternalRefHash: externalRef,
			CompletedAt:     input.Now.Add(-23 * time.Hour),
		})
	}
	evidence := &CertificationEvidence{
		ID:                  string(kind) + "-certification",
		Kind:                kind,
		Subject:             input.Subject,
		TestedRevision:      strings.Repeat("a", 40),
		ContractDigest:      contractDigest,
		TestedAt:            input.Now.Add(-24 * time.Hour),
		ExpiresAt:           input.Now.Add(30 * 24 * time.Hour),
		ApprovalStateAtTest: input.Approval.State,
		ApprovalTierAtTest:  input.Approval.Tier,
		RequiredScopes:      append([]string(nil), input.Contract.Requirements.RequiredScopes...),
		GrantedScopes:       append([]string(nil), input.Authorization.GrantedScopes...),
		Checks:              results,
		OperatorRef:         "operator-1",
	}
	if kind == EvidenceKindLive {
		evidence.AccountReferenceHash = "sha256:" + strings.Repeat("f", 64)
	}
	return evidence
}

func cloneInput(input EvaluationInput) EvaluationInput {
	input.Authorization.GrantedScopes = append([]string(nil), input.Authorization.GrantedScopes...)
	input.Contract.Requirements.RequiredScopes = append([]string(nil), input.Contract.Requirements.RequiredScopes...)
	input.Contract.Requirements.RequiredLocalChecks = append([]CheckRequirement(nil), input.Contract.Requirements.RequiredLocalChecks...)
	input.Contract.Requirements.RequiredLiveChecks = append([]CheckRequirement(nil), input.Contract.Requirements.RequiredLiveChecks...)
	input.LocalEvidence = cloneEvidence(input.LocalEvidence)
	input.LiveEvidence = cloneEvidence(input.LiveEvidence)
	return input
}

func cloneEvidence(evidence *CertificationEvidence) *CertificationEvidence {
	if evidence == nil {
		return nil
	}
	copy := *evidence
	copy.RequiredScopes = append([]string(nil), evidence.RequiredScopes...)
	copy.GrantedScopes = append([]string(nil), evidence.GrantedScopes...)
	copy.Checks = append([]CheckResult(nil), evidence.Checks...)
	return &copy
}

func hasBlocker(blockers []Blocker, code BlockerCode) bool {
	for _, blocker := range blockers {
		if blocker.Code == code {
			return true
		}
	}
	return false
}

func refreshEvidenceContractDigests(input *EvaluationInput) {
	digest, err := input.Contract.Digest()
	if err != nil {
		panic(err)
	}
	if input.LocalEvidence != nil {
		input.LocalEvidence.ContractDigest = digest
	}
	if input.LiveEvidence != nil {
		input.LiveEvidence.ContractDigest = digest
	}
}
