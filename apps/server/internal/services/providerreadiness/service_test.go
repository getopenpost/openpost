package providerreadiness

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestServiceFailsClosedWhenLedgerIsMissingOrUnavailable(t *testing.T) {
	t.Parallel()
	input := healthyInput()

	missing := NewService(&fakeLedger{
		approvalErr: ErrLedgerFactNotFound,
		controlErr:  ErrLedgerFactNotFound,
		localErr:    ErrLedgerFactNotFound,
		liveErr:     ErrLedgerFactNotFound,
	}, ServiceOptions{Now: func() time.Time { return input.Now }})
	decision := missing.Decide(t.Context(), decisionRequest(input))
	if decision.State != EffectiveStateDegraded || decision.Executable || decision.Advertisable {
		t.Fatalf("missing ledger facts did not fail closed: %#v", decision)
	}
	if !hasBlocker(decision.Blockers, BlockerUnknownRuntimeControl) || !hasBlocker(decision.Blockers, BlockerLiveEvidenceMissing) {
		t.Fatalf("missing facts were not reported: %#v", decision.Blockers)
	}

	unavailable := NewService(&fakeLedger{approvalErr: errors.New("database unavailable")}, ServiceOptions{
		Now: func() time.Time { return input.Now },
	})
	decision = unavailable.Decide(t.Context(), decisionRequest(input))
	if decision.State != EffectiveStateDegraded || decision.Executable || len(decision.Blockers) != 1 ||
		decision.Blockers[0].Code != BlockerReadinessUnavailable {
		t.Fatalf("repository failure did not return one safe degraded decision: %#v", decision)
	}
	if _, err := unavailable.Require(t.Context(), decisionRequest(input)); err == nil {
		t.Fatal("Require accepted a repository failure")
	}
}

func decisionRequest(input EvaluationInput) DecisionRequest {
	return DecisionRequest{
		Implemented:                 input.Implemented,
		Subject:                     input.Subject,
		CurrentAccountReferenceHash: input.CurrentAccountReferenceHash,
		Intent:                      input.Intent,
		CurrentRevision:             input.CurrentRevision,
		Contract:                    input.Contract,
		Configuration:               input.Configuration,
		Authorization:               input.Authorization,
		Policy:                      input.Policy,
	}
}

type fakeLedger struct {
	approval              *ApprovalReview
	approvalErr           error
	control               RuntimeControl
	controls              map[Operation]RuntimeControl
	controlErr            error
	local                 *CertificationEvidence
	localErr              error
	live                  *CertificationEvidence
	liveErr               error
	reads                 int
	approvalReads         int
	localReads            int
	liveReads             int
	controlReads          int
	appendedCertification *CertificationEvidence
}

func (f *fakeLedger) LatestApprovalReview(context.Context, Subject) (*ApprovalReview, error) {
	f.reads++
	f.approvalReads++
	return f.approval, f.approvalErr
}

func (f *fakeLedger) ApprovalReviewByID(context.Context, string) (*ApprovalReview, error) {
	return f.approval, f.approvalErr
}

func (f *fakeLedger) LatestCertification(_ context.Context, _ Subject, kind EvidenceKind, _ string) (*CertificationEvidence, error) {
	f.reads++
	if kind == EvidenceKindLocal {
		f.localReads++
		return f.local, f.localErr
	}
	f.liveReads++
	return f.live, f.liveErr
}

func (f *fakeLedger) EffectiveRuntimeControl(_ context.Context, subject Subject, _ time.Time) (RuntimeControl, error) {
	f.reads++
	f.controlReads++
	if control, ok := f.controls[subject.Operation]; ok {
		return control, f.controlErr
	}
	return f.control, f.controlErr
}

func (*fakeLedger) AppendApprovalReview(context.Context, ApprovalReview) error {
	return errors.New("not implemented")
}

func (f *fakeLedger) AppendCertification(_ context.Context, _ string, evidence CertificationEvidence) error {
	f.appendedCertification = &evidence
	return nil
}

func (*fakeLedger) AppendRuntimeControl(context.Context, RuntimeControlEvent) error {
	return errors.New("not implemented")
}
