package providerreadiness

import (
	"strings"

	"time"
)

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
