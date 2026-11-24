package connectors

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestStoreSavesConnectorAccountsAndBindingsAtomically(t *testing.T) {
	t.Parallel()

	db := newConnectorStoreDB(t)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Organization"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ProviderInstallation{
		ID: "directus-main", Kind: "connector", ProviderID: "io.directus.items",
		DisplayName: "Directus", CapabilityRevision: "directus-items-v1", Status: InstallationStatusAvailable,
	}).Exec(ctx)
	require.NoError(t, err)
	store := NewStore(db)
	session, err := store.BeginConnection(ctx, "workspace-1", "directus-main", time.Hour)
	require.NoError(t, err)

	accounts, err := store.SaveConnectionAccounts(ctx, session.ID, ConnectionResponse{
		State: "complete", ConnectionRef: "directus/posts",
		Accounts: []ConnectionAccount{{ID: "posts", Username: "Editorial Posts", AvatarURL: "https://cms.example/avatar.png"}},
	})
	require.NoError(t, err)
	require.Len(t, accounts, 1)
	require.True(t, accounts[0].IsNewlyInserted)
	require.True(t, accounts[0].ClaimedFirst)
	require.Equal(t, "io.directus.items", accounts[0].Platform)
	require.Equal(t, "editorial-posts", accounts[0].Slug)
	require.Empty(t, accounts[0].OAuthGrantID)

	binding, err := store.BindingForAccount(ctx, "workspace-1", accounts[0].ID)
	require.NoError(t, err)
	require.Equal(t, "directus-main", binding.InstallationID)
	require.Equal(t, "directus/posts", binding.ConnectionRef)
	require.Equal(t, "directus-items-v1", binding.CapabilityRevision)

	var completed models.ConnectorConnectionSession
	require.NoError(t, db.NewSelect().Model(&completed).Where("id = ?", session.ID).Scan(ctx))
	require.Equal(t, "complete", completed.State)

	// A failed binding write must roll back the account rows saved earlier in
	// the same transaction instead of leaving a partial connector connection.
	failingSession, err := store.BeginConnection(ctx, "workspace-1", "directus-main", time.Hour)
	require.NoError(t, err)
	_, err = db.NewRaw(`CREATE TRIGGER reject_provider_account_binding
		BEFORE INSERT ON provider_account_bindings
		BEGIN SELECT RAISE(FAIL, 'binding insert blocked'); END`).Exec(ctx)
	require.NoError(t, err)

	_, err = store.SaveConnectionAccounts(ctx, failingSession.ID, ConnectionResponse{
		State: "complete", ConnectionRef: "directus/posts",
		Accounts: []ConnectionAccount{
			{ID: "pages", Username: "Editorial Pages"},
			{ID: "reels", Username: "Editorial Reels"},
		},
	})
	require.ErrorContains(t, err, "binding insert blocked")

	rolledBackAccounts, err := db.NewSelect().Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ? AND account_id IN (?)", "workspace-1", bun.List([]string{"pages", "reels"})).
		Count(ctx)
	require.NoError(t, err)
	require.Zero(t, rolledBackAccounts, "a failed binding write must not leave connector accounts")
	rolledBackBindings, err := db.NewSelect().Model((*models.ProviderAccountBinding)(nil)).
		Where("workspace_id = ? AND external_account_id IN (?)", "workspace-1", bun.List([]string{"pages", "reels"})).
		Count(ctx)
	require.NoError(t, err)
	require.Zero(t, rolledBackBindings, "a failed binding write must not leave bindings")
	remainingAccounts, err := db.NewSelect().Model((*models.SocialAccount)(nil)).
		Where("workspace_id = ?", "workspace-1").
		Count(ctx)
	require.NoError(t, err)
	require.EqualValues(t, 1, remainingAccounts, "the earlier committed connection must survive the rollback")
	var pending models.ConnectorConnectionSession
	require.NoError(t, db.NewSelect().Model(&pending).Where("id = ?", failingSession.ID).Scan(ctx))
	require.Equal(t, "pending", pending.State, "a failed transaction must not complete the connection session")
}

func newConnectorStoreDB(t *testing.T) *bun.DB {
	t.Helper()
	db, err := testdb.Open("file:" + t.Name() + "?mode=memory&cache=shared")
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestValidateManifestFailsClosedForUnknownProtocolAndControls(t *testing.T) {
	t.Parallel()

	manifest := validManifest()
	manifest.ProtocolVersion = "2.0"
	require.ErrorContains(t, ValidateManifest(&manifest), "unsupported connector protocol")

	manifest = validManifest()
	manifest.Publishing.OutputProfiles[0].Settings = []SettingDefinition{{
		Key: "status", Label: "Status", Control: "connector_html",
	}}
	require.ErrorContains(t, ValidateManifest(&manifest), "unsupported control")
}

func validManifest() Manifest {
	return Manifest{
		ProtocolVersion:       "1.0",
		ImplementationVersion: "0.1.0",
		Provider: ProviderDescriptor{
			ID:          "io.directus.items",
			DisplayName: "Directus",
		},
		CapabilityRevision: "directus-items-v1",
		Connection:         ConnectionDescriptor{Modes: []string{"preconfigured"}},
		Publishing: PublishingDescriptor{OutputProfiles: []OutputProfile{{
			ID:          "directus.item",
			DisplayName: "Create Directus item",
			Profile:     "short_text",
			Intents:     []string{"post"},
			Content:     TextConstraint{Required: true, MaxLength: 100_000},
			Media:       MediaConstraint{MinItems: 0, MaxItems: 0},
		}}},
		Operations: OperationDescriptor{Polling: true},
	}
}

func TestLoadConfigRejectsInlineSecretsAndUnknownFields(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "connectors.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
  "version": 1,
  "installations": [{
    "id": "directus-main",
    "endpoint": {
      "mode": "public_https",
      "base_url": "https://connector.example.com"
    },
    "auth": {
      "bearer_token": "must-not-be-inline"
    }
  }]
}`), 0o600))

	_, err := LoadConfig(configPath)
	require.ErrorContains(t, err, "unknown field")
}

func TestLoadConfigRejectsRelativeSecretFiles(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "connectors.json")
	require.NoError(t, os.WriteFile(configPath, []byte(`{
  "version": 1,
  "installations": [{
    "id": "directus-main",
    "endpoint": {"mode": "public_https", "base_url": "https://connector.example.com"},
    "auth": {"bearer_token_file": "relative-token"}
  }]
}`), 0o600))

	_, err := LoadConfig(configPath)
	require.ErrorContains(t, err, "must be an absolute path")
}
