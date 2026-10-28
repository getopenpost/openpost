package connectors

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestStoreSyncsOnlySanitizedConnectorDescriptors(t *testing.T) {
	t.Parallel()

	db := newConnectorStoreDB(t)
	registry := &Registry{entries: map[string]RegistryEntry{
		"directus-main": {
			InstallationID: "directus-main", Required: false,
			ConfigFingerprint: "sha256:configuration",
			Manifest:          validManifest(), Available: true, Status: InstallationStatusAvailable,
		},
	}, clients: map[string]*Client{}}
	store := NewStore(db)
	require.NoError(t, store.SyncRegistry(context.Background(), registry))

	var installation models.ProviderInstallation
	require.NoError(t, db.NewSelect().Model(&installation).Where("id = ?", "directus-main").Scan(context.Background()))
	require.Equal(t, "connector", installation.Kind)
	require.Equal(t, "io.directus.items", installation.ProviderID)
	require.Equal(t, "sha256:configuration", installation.ConfigFingerprint)
	require.NotContains(t, installation.ManifestJSON, "connector-secret")
	var manifest Manifest
	require.NoError(t, json.Unmarshal([]byte(installation.ManifestJSON), &manifest))
	require.Equal(t, "Directus", manifest.Provider.DisplayName)
}

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
	require.Equal(t, 1, remainingAccounts, "the earlier committed connection must survive the rollback")
	var pending models.ConnectorConnectionSession
	require.NoError(t, db.NewSelect().Model(&pending).Where("id = ?", failingSession.ID).Scan(ctx))
	require.Equal(t, "pending", pending.State, "a failed transaction must not complete the connection session")
}

func newConnectorStoreDB(t *testing.T) *bun.DB {
	t.Helper()
	db, err := database.InitDB("file:" + t.Name() + "?mode=memory&cache=shared")
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	return db
}
