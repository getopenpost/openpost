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

func seedHandlerAccount(t *testing.T, db *bun.DB, id string) {
	t.Helper()
	for _, model := range []any{
		(*models.SocialAccount)(nil), (*models.MediaAttachment)(nil), (*models.RenditionMedia)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID: id, WorkspaceID: "workspace-1", Slug: id, Platform: "x",
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

// seedHandlerWorkspace stores the workspace whose settings scheduling and review gates read.
func seedHandlerWorkspace(t testing.TB, db *bun.DB) {
	t.Helper()
	_, err := db.NewCreateTable().Model((*models.Workspace)(nil)).IfNotExists().Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Workspace"}).Exec(context.Background())
	require.NoError(t, err)
}
