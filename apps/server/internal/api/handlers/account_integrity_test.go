package handlers

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/testdb"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func createHandlerTestDB(t testing.TB, modelsToCreate ...interface{}) *bun.DB {
	t.Helper()
	return testdb.NewSQLiteBase(t, modelsToCreate...)
}

func seedHandlerAccount(t *testing.T, db *bun.DB, id, platform string) {
	t.Helper()
	for _, model := range []any{
		(*models.SocialAccount)(nil), (*models.MediaAttachment)(nil), (*models.RenditionMedia)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: id, WorkspaceID: "workspace-1", Slug: id, Platform: platform,
		AccountID: id, AccessTokenEnc: []byte("ciphertext"), IsActive: true,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func seedHandlerRendition(t *testing.T, db *bun.DB, id, publicationID, accountID, platform, body, status string) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.Rendition{
		ID: id, PublicationID: publicationID, SocialAccountID: accountID,
		Platform: platform, Profile: models.ContentProfileShortText,
		Body: body, SettingsJSON: "{}", Status: status,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func TestPublicationHandlerLoadAccountsRejectsInactiveAccounts(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.SocialAccount)(nil))
	handler := &PublicationHandler{db: db}
	ctx := context.Background()

	accounts := []models.SocialAccount{
		{ID: "active-account", WorkspaceID: "ws-1", Platform: "x", AccountID: "1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "inactive-account", WorkspaceID: "ws-1", Platform: "x", AccountID: "2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err := db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).Where("id = ?", "inactive-account").Exec(ctx)
	require.NoError(t, err)

	loaded, err := handler.loadAccounts(ctx, "ws-1", []string{"active-account"})
	require.NoError(t, err)
	require.Contains(t, loaded, "active-account")
	_, err = handler.loadAccounts(ctx, "ws-1", []string{"inactive-account"})
	require.Error(t, err)
}

// seedHandlerWorkspace stores the workspace whose settings scheduling and review gates read.
func seedHandlerWorkspace(t testing.TB, db *bun.DB) {
	t.Helper()
	_, err := db.NewCreateTable().Model((*models.Workspace)(nil)).IfNotExists().Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Workspace"}).Exec(context.Background())
	require.NoError(t, err)
}
