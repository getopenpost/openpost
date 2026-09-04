package providerreadiness

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

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

func certificationHasOutcome(checks []CheckResult, kind CheckKind, outcome CheckOutcome) bool {
	for _, check := range checks {
		if check.Kind == kind && check.Outcome == outcome {
			return true
		}
	}
	return false
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
