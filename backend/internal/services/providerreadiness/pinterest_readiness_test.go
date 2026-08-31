package providerreadiness

import (
	"testing"

	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
)

func TestPinterestTrialAndStaleEvidenceCannotEnableIndependentOperations(t *testing.T) {
	t.Parallel()

	operations := []Operation{OperationDiscover, OperationAnalytics, OperationPublishImmediate}
	for _, operation := range operations {
		operation := operation
		t.Run(string(operation), func(t *testing.T) {
			t.Parallel()
			current := pinterestReadinessInput(t, operation)
			decision := Evaluate(current)
			if !decision.Executable {
				t.Fatalf("current %s evidence was blocked: %#v", operation, decision)
			}
			switch operation {
			case OperationDiscover:
				if !decision.Discoverable || decision.AnalyticsReady || decision.Publishable {
					t.Fatalf("discovery decision widened to another operation: %#v", decision)
				}
			case OperationAnalytics:
				if !decision.AnalyticsReady || decision.Discoverable || decision.Publishable {
					t.Fatalf("analytics decision widened to another operation: %#v", decision)
				}
			case OperationPublishImmediate:
				if !decision.Publishable || decision.Discoverable || decision.AnalyticsReady {
					t.Fatalf("publishing decision widened to another operation: %#v", decision)
				}
			}

			trial := cloneInput(current)
			trial.Approval.State = ApprovalStateTrial
			trial.Approval.Tier = "trial"
			trial.LocalEvidence.ApprovalStateAtTest = ApprovalStateTrial
			trial.LocalEvidence.ApprovalTierAtTest = "trial"
			trial.LiveEvidence.ApprovalStateAtTest = ApprovalStateTrial
			trial.LiveEvidence.ApprovalTierAtTest = "trial"
			trialDecision := Evaluate(trial)
			if trialDecision.Executable || trialDecision.State != EffectiveStateTrialOnly {
				t.Fatalf("trial enabled production %s: %#v", operation, trialDecision)
			}

			stale := cloneInput(current)
			stale.LiveEvidence.ExpiresAt = stale.Now
			staleDecision := Evaluate(stale)
			if staleDecision.Executable || staleDecision.State != EffectiveStateExpiredProof ||
				!hasBlocker(staleDecision.Blockers, BlockerLiveEvidenceExpired) {
				t.Fatalf("stale evidence enabled %s: %#v", operation, staleDecision)
			}
		})
	}
}

func TestPinterestCertificationDoesNotTransferBetweenReadOperations(t *testing.T) {
	t.Parallel()

	discovery := pinterestReadinessInput(t, OperationDiscover)
	analytics := pinterestReadinessInput(t, OperationAnalytics)
	analytics.LocalEvidence = cloneEvidence(discovery.LocalEvidence)
	analytics.LiveEvidence = cloneEvidence(discovery.LiveEvidence)
	decision := Evaluate(analytics)
	if decision.Executable || !hasBlocker(decision.Blockers, BlockerLocalEvidenceMismatch) ||
		!hasBlocker(decision.Blockers, BlockerLiveEvidenceMismatch) {
		t.Fatalf("discovery evidence transferred to analytics: %#v", decision)
	}
	if !Evaluate(discovery).Discoverable {
		t.Fatal("matching discovery evidence was not independently usable")
	}
}

func pinterestReadinessInput(t *testing.T, operation Operation) EvaluationInput {
	t.Helper()
	input := healthyInput()
	input.Subject.Provider = capabilities.ProviderPinterest
	input.Subject.AccountKind = "standard"
	input.Subject.Operation = operation
	input.Subject.PolicyMode = capabilities.ProviderPinterest + "." + string(operation)
	input.Approval.Tier = "standard"

	var contract CertificationContract
	var err error
	if operation.IsPublish() {
		capability, ok := capabilities.Find(capabilities.ProviderPinterest, models.ContentProfileImagePost)
		if !ok {
			t.Fatal("Pinterest image capability is missing")
		}
		input.Subject.OutputProfile = capability.OutputProfile
		input.Subject.PolicyMode = "pinterest.unspecified"
		contract, err = PublicationContract(capability, operation, true, "standard", input.Subject.PolicyMode)
	} else {
		input.Subject.OutputProfile = ""
		contract, err = OperationContract(capabilities.ProviderPinterest, operation, true, "standard")
	}
	if err != nil {
		t.Fatal(err)
	}
	input.Contract = contract
	input.Authorization.GrantedScopes = append([]string(nil), contract.Requirements.RequiredScopes...)

	checks := make([]CheckKind, 0, len(contract.Requirements.RequiredLocalChecks))
	for _, requirement := range contract.Requirements.RequiredLocalChecks {
		checks = append(checks, requirement.Kind)
	}
	input.LocalEvidence = certificationEvidence(input, EvidenceKindLocal, checks)
	input.LiveEvidence = certificationEvidence(input, EvidenceKindLive, checks)
	return input
}
