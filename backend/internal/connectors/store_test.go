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
}

func newConnectorStoreDB(t *testing.T) *bun.DB {
	t.Helper()
	db, err := database.InitDB("file:" + t.Name() + "?mode=memory&cache=shared")
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	return db
}
