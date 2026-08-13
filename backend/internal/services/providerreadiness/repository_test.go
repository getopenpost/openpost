package providerreadiness

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

func TestRepositoryAppendsAndResolvesExactCertificationFacts(t *testing.T) {
	db := newProviderReadinessRepositoryTestDB(t)
	repository := NewRepository(db)
	input := healthyInput()
	review := approvalReviewFixture(input)
	if err := repository.AppendApprovalReview(t.Context(), review); err != nil {
		t.Fatal(err)
	}
	if err := repository.AppendCertification(t.Context(), review.ID, *input.LocalEvidence); err != nil {
		t.Fatal(err)
	}
	if err := repository.AppendCertification(t.Context(), review.ID, *input.LiveEvidence); err != nil {
		t.Fatal(err)
	}
	if err := repository.AppendRuntimeControl(t.Context(), RuntimeControlEvent{
		ID:          "control-enabled",
		Selector:    RuntimeControlSelector{Provider: input.Subject.Provider},
		Control:     RuntimeControl{State: RuntimeControlStateEnabled, ReasonCode: "certification_enabled"},
		StartsAt:    input.Now.Add(-time.Hour),
		OperatorRef: "operator:sha256:reviewer",
		CreatedAt:   input.Now,
	}); err != nil {
		t.Fatal(err)
	}

	gotReview, err := repository.LatestApprovalReview(t.Context(), input.Subject)
	if err != nil {
		t.Fatal(err)
	}
	if gotReview.ID != review.ID || gotReview.Evidence.State != ApprovalStateApproved {
		t.Fatalf("unexpected approval review: %#v", gotReview)
	}
	live, err := repository.LatestCertification(
		t.Context(), input.Subject, EvidenceKindLive, input.CurrentAccountReferenceHash,
	)
	if err != nil {
		t.Fatal(err)
	}
	if live.ID != input.LiveEvidence.ID || live.Subject != input.Subject || len(live.Checks) != len(input.LiveEvidence.Checks) {
		t.Fatalf("unexpected certification: %#v", live)
	}
	control, err := repository.EffectiveRuntimeControl(t.Context(), input.Subject, input.Now)
	if err != nil {
		t.Fatal(err)
	}
	if control.State != RuntimeControlStateEnabled {
		t.Fatalf("control = %#v, want enabled", control)
	}

	otherSubject := input.Subject
	otherSubject.OutputProfile = "video"
	if _, err := repository.LatestCertification(t.Context(), otherSubject, EvidenceKindLive, input.CurrentAccountReferenceHash); !errors.Is(err, ErrLedgerFactNotFound) {
		t.Fatalf("other subject lookup error = %v, want ErrLedgerFactNotFound", err)
	}
}

func TestRepositoryAuthorizationRequiresTheAccountsExactGrantOwner(t *testing.T) {
	db := newProviderReadinessRepositoryTestDB(t)
	repository := NewRepository(db)
	now := time.Now().UTC()
	workspaces := []models.Workspace{
		{ID: "workspace-a", Name: "Workspace A"},
		{ID: "workspace-b", Name: "Workspace B"},
	}
	if _, err := db.NewInsert().Model(&workspaces).Exec(t.Context()); err != nil {
		t.Fatal(err)
	}
	grant := &models.OAuthGrant{
		ID: "grant-1", WorkspaceID: "workspace-a", Provider: "x",
		AccessTokenEnc: []byte("encrypted"), GrantedScopes: "tweet.write",
		ValidationStatus: "valid", ValidatedAt: now.Add(-time.Minute),
	}
	if _, err := db.NewInsert().Model(grant).Exec(t.Context()); err != nil {
		t.Fatal(err)
	}
	account := models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-b", Platform: "x",
		OAuthGrantID: grant.ID, IsActive: true,
	}
	evidence, err := repository.AuthorizationForAccount(t.Context(), account, now)
	if err != nil {
		t.Fatal(err)
	}
	if evidence.State != AuthorizationStateReconnectRequired {
		t.Fatalf("cross-workspace grant authorized account: %#v", evidence)
	}
}

func TestRepositoryConcurrentControlsResolveTheLatestEvent(t *testing.T) {
	db := newProviderReadinessRepositoryTestDB(t)
	repository := NewRepository(db)
	input := healthyInput()
	const eventCount = 24
	start := make(chan struct{})
	errorsByIndex := make([]error, eventCount)
	var wait sync.WaitGroup
	for index := 0; index < eventCount; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			<-start
			state := RuntimeControlStateEnabled
			if index == eventCount-1 {
				state = RuntimeControlStateDisabled
			}
			errorsByIndex[index] = repository.AppendRuntimeControl(context.Background(), RuntimeControlEvent{
				ID:       fmt.Sprintf("control-concurrent-%02d", index),
				Selector: RuntimeControlSelector{Provider: input.Subject.Provider},
				Control: RuntimeControl{
					State: state, ReasonCode: fmt.Sprintf("concurrent_%02d", index),
				},
				StartsAt: input.Now.Add(-time.Hour), OperatorRef: "operator:sha256:reviewer",
				CreatedAt: input.Now.Add(time.Duration(index) * time.Second),
			})
		}(index)
	}
	close(start)
	wait.Wait()
	for index, err := range errorsByIndex {
		if err != nil {
			t.Fatalf("append control %d: %v", index, err)
		}
	}
	control, err := repository.EffectiveRuntimeControl(t.Context(), input.Subject, input.Now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if control.State != RuntimeControlStateDisabled || control.ReasonCode != "concurrent_23" {
		t.Fatalf("effective control = %#v, want latest disabled event", control)
	}
}

func TestRepositoryLatestFailedRunSupersedesOlderPassingProof(t *testing.T) {
	db := newProviderReadinessRepositoryTestDB(t)
	repository := NewRepository(db)
	input := healthyInput()
	review := approvalReviewFixture(input)
	if err := repository.AppendApprovalReview(t.Context(), review); err != nil {
		t.Fatal(err)
	}
	if err := repository.AppendCertification(t.Context(), review.ID, *input.LiveEvidence); err != nil {
		t.Fatal(err)
	}

	failed := *input.LiveEvidence
	failed.ID = "live-certification-failed-later"
	failed.TestedAt = input.Now.Add(-30 * time.Minute)
	failed.ExpiresAt = input.Now.Add(24 * time.Hour)
	failed.Checks = append([]CheckResult(nil), input.LiveEvidence.Checks...)
	for index := range failed.Checks {
		failed.Checks[index].CompletedAt = input.Now.Add(-20 * time.Minute)
	}
	failed.Checks[2].Outcome = CheckOutcomeFailed
	failed.Checks[2].ErrorClass = "provider_rejected"
	if err := repository.AppendCertification(t.Context(), review.ID, failed); err != nil {
		t.Fatal(err)
	}

	got, err := repository.LatestCertification(
		t.Context(), input.Subject, EvidenceKindLive, input.CurrentAccountReferenceHash,
	)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != failed.ID || !certificationHasOutcome(got.Checks, CheckPublishImmediate, CheckOutcomeFailed) {
		t.Fatalf("latest certification = %#v, want later failure", got)
	}
}

func TestRepositoryLatestLiveCertificationIsolatedByAccountReference(t *testing.T) {
	db := newProviderReadinessRepositoryTestDB(t)
	repository := NewRepository(db)
	input := healthyInput()
	review := approvalReviewFixture(input)
	if err := repository.AppendApprovalReview(t.Context(), review); err != nil {
		t.Fatal(err)
	}

	accountA := *input.LiveEvidence
	accountA.ID = "live-account-a"
	accountA.AccountReferenceHash = "sha256:" + strings.Repeat("a", 64)
	accountA.TestedAt = input.Now.Add(-2 * time.Hour)
	accountA.ExpiresAt = input.Now.Add(24 * time.Hour)
	accountA.Checks = append([]CheckResult(nil), input.LiveEvidence.Checks...)
	for index := range accountA.Checks {
		accountA.Checks[index].CompletedAt = accountA.TestedAt.Add(time.Minute)
	}
	if err := repository.AppendCertification(t.Context(), review.ID, accountA); err != nil {
		t.Fatal(err)
	}

	accountB := accountA
	accountB.ID = "live-account-b-newer"
	accountB.AccountReferenceHash = "sha256:" + strings.Repeat("b", 64)
	accountB.TestedAt = input.Now.Add(-time.Hour)
	accountB.Checks = append([]CheckResult(nil), accountA.Checks...)
	for index := range accountB.Checks {
		accountB.Checks[index].CompletedAt = accountB.TestedAt.Add(time.Minute)
	}
	if err := repository.AppendCertification(t.Context(), review.ID, accountB); err != nil {
		t.Fatal(err)
	}

	gotA, err := repository.LatestCertification(
		t.Context(), input.Subject, EvidenceKindLive, accountA.AccountReferenceHash,
	)
	if err != nil {
		t.Fatal(err)
	}
	if gotA.ID != accountA.ID {
		t.Fatalf("newer account B evidence masked account A: got %s", gotA.ID)
	}
	gotB, err := repository.LatestCertification(
		t.Context(), input.Subject, EvidenceKindLive, accountB.AccountReferenceHash,
	)
	if err != nil {
		t.Fatal(err)
	}
	if gotB.ID != accountB.ID {
		t.Fatalf("account B evidence lookup got %s", gotB.ID)
	}

	for name, fixture := range map[string]struct {
		hash     string
		evidence *CertificationEvidence
	}{
		"account-a": {hash: accountA.AccountReferenceHash, evidence: gotA},
		"account-b": {hash: accountB.AccountReferenceHash, evidence: gotB},
	} {
		candidate := cloneInput(input)
		candidate.CurrentAccountReferenceHash = fixture.hash
		candidate.LiveEvidence = fixture.evidence
		decision := Evaluate(candidate)
		if !decision.Publishable {
			t.Fatalf("%s current proof was invalidated by another account: %#v", name, decision)
		}
	}
}

func certificationHasOutcome(checks []CheckResult, kind CheckKind, outcome CheckOutcome) bool {
	for _, check := range checks {
		if check.Kind == kind && check.Outcome == outcome {
			return true
		}
	}
	return false
}

func TestRepositoryResolvesLatestEventPerScopeThenMostRestrictiveScope(t *testing.T) {
	db := newProviderReadinessRepositoryTestDB(t)
	repository := NewRepository(db)
	input := healthyInput()
	events := []RuntimeControlEvent{
		{
			ID: "control-global-enabled", Selector: RuntimeControlSelector{Provider: input.Subject.Provider},
			Control:  RuntimeControl{State: RuntimeControlStateEnabled, ReasonCode: "operator_enabled"},
			StartsAt: input.Now.Add(-time.Hour), OperatorRef: "operator:sha256:reviewer", CreatedAt: input.Now.Add(-10 * time.Minute),
		},
		{
			ID: "control-profile-disabled", Selector: RuntimeControlSelector{Provider: input.Subject.Provider, OutputProfile: input.Subject.OutputProfile},
			Control:  RuntimeControl{State: RuntimeControlStateDisabled, ReasonCode: "provider_incident"},
			StartsAt: input.Now.Add(-time.Hour), OperatorRef: "operator:sha256:reviewer", CreatedAt: input.Now.Add(-5 * time.Minute),
		},
	}
	for _, event := range events {
		if err := repository.AppendRuntimeControl(t.Context(), event); err != nil {
			t.Fatal(err)
		}
	}
	control, err := repository.EffectiveRuntimeControl(t.Context(), input.Subject, input.Now)
	if err != nil {
		t.Fatal(err)
	}
	if control.State != RuntimeControlStateDisabled {
		t.Fatalf("control = %#v, want disabled", control)
	}

	if err := repository.AppendRuntimeControl(t.Context(), RuntimeControlEvent{
		ID: "control-profile-reenabled", Selector: RuntimeControlSelector{Provider: input.Subject.Provider, OutputProfile: input.Subject.OutputProfile},
		Control:  RuntimeControl{State: RuntimeControlStateEnabled, ReasonCode: "incident_resolved"},
		StartsAt: input.Now.Add(-time.Hour), OperatorRef: "operator:sha256:reviewer", CreatedAt: input.Now.Add(-time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	control, err = repository.EffectiveRuntimeControl(t.Context(), input.Subject, input.Now)
	if err != nil {
		t.Fatal(err)
	}
	if control.State != RuntimeControlStateEnabled {
		t.Fatalf("control = %#v, want latest scope event to re-enable", control)
	}
}

func approvalReviewFixture(input EvaluationInput) ApprovalReview {
	return ApprovalReview{
		ID:                  "approval-review-1",
		Provider:            input.Subject.Provider,
		AppFingerprint:      input.Subject.AppFingerprint,
		ProviderEnvironment: input.Subject.ProviderEnvironment,
		InstanceFingerprint: input.Subject.InstanceFingerprint,
		Evidence:            input.Approval,
		OperatorRef:         "operator:sha256:reviewer",
		CreatedAt:           input.Now,
	}
}

func newProviderReadinessRepositoryTestDB(t *testing.T) *bun.DB {
	t.Helper()
	dsn := "file:" + filepath.Join(t.TempDir(), "provider-readiness.db") + "?mode=rwc"
	db, err := database.InitDB(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.CreateSchema(db); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	return db
}
