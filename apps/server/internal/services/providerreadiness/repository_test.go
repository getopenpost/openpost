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

func TestRepositoryTelegramAuthorizationUsesVerifiedInstallation(t *testing.T) {
	db := newProviderReadinessRepositoryTestDB(t)
	repository := NewRepository(db)
	now := time.Now().UTC().Truncate(time.Second)
	workspace := &models.Workspace{ID: "telegram-workspace", Name: "Telegram"}
	if _, err := db.NewInsert().Model(workspace).Exec(t.Context()); err != nil {
		t.Fatal(err)
	}
	account := models.SocialAccount{ID: "telegram-account", WorkspaceID: workspace.ID, Platform: "telegram", AccountID: "-100123", Slug: "telegram-test", AccessTokenEnc: []byte{}, IsActive: true, CreatedAt: now}
	if _, err := db.NewInsert().Model(&account).Exec(t.Context()); err != nil {
		t.Fatal(err)
	}
	connection := &models.TelegramConnection{SocialAccountID: account.ID, WorkspaceID: workspace.ID, ChatID: account.AccountID, ChatType: "channel", InstalledAt: now, CoverageStartedAt: now, CoverageKind: "since_installation", PermissionsVerifiedAt: now, CreatedAt: now}
	if _, err := db.NewInsert().Model(connection).Exec(t.Context()); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name    string
		account models.SocialAccount
		want    AuthorizationState
	}{
		{"verified installation without OAuth", account, AuthorizationStateValid},
		{"different workspace", func() models.SocialAccount { a := account; a.WorkspaceID = "other"; return a }(), AuthorizationStateReconnectRequired},
		{"different chat", func() models.SocialAccount { a := account; a.AccountID = "-100456"; return a }(), AuthorizationStateReconnectRequired},
		{"missing installation", func() models.SocialAccount { a := account; a.ID = "missing"; return a }(), AuthorizationStateReconnectRequired},
		{"inactive account", func() models.SocialAccount { a := account; a.IsActive = false; return a }(), AuthorizationStateReconnectRequired},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			evidence, err := repository.AuthorizationForAccount(t.Context(), tt.account, now)
			if err != nil {
				t.Fatal(err)
			}
			if evidence.State != tt.want {
				t.Fatalf("authorization = %s, want %s", evidence.State, tt.want)
			}
		})
	}
	connection.PermissionsVerifiedAt = time.Time{}
	if _, err := db.NewUpdate().Model(connection).Column("permissions_verified_at").WherePK().Exec(t.Context()); err != nil {
		t.Fatal(err)
	}
	evidence, err := repository.AuthorizationForAccount(t.Context(), account, now)
	if err != nil {
		t.Fatal(err)
	}
	if evidence.State != AuthorizationStateReconnectRequired {
		t.Fatalf("unverified installation authorized: %#v", evidence)
	}
}
