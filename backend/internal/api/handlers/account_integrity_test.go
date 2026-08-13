package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func createHandlerTestDB(t *testing.T, modelsToCreate ...interface{}) *bun.DB {
	t.Helper()

	testName := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	dsn := fmt.Sprintf("file:%s_%s?mode=memory&cache=shared", testName, uuid.NewString())
	sqldb, err := sql.Open("sqlite3", dsn)
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	_, err = db.NewCreateTable().
		Model((*models.OAuthGrant)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	_, err = db.NewCreateTable().
		Model((*models.DraftRevisionChange)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	editorModels := []interface{}{
		(*models.Post)(nil),
		(*models.PostDestination)(nil),
		(*models.PostMedia)(nil),
		(*models.PostVariant)(nil),
		(*models.ThreadDraft)(nil),
		(*models.PublicationSegment)(nil),
		(*models.PublicationSegmentMedia)(nil),
		(*models.Rendition)(nil),
		(*models.RenditionSegment)(nil),
		(*models.RenditionSegmentMedia)(nil),
		(*models.PublicationLifecycleEvent)(nil),
		(*models.PublicationAuthorization)(nil),
		(*models.ProviderWriteAttempt)(nil),
	}
	for _, model := range editorModels {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	for _, model := range modelsToCreate {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}

	return db
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

func TestPostHandlerValidateAccountsBelongToWorkspaceRejectsInactiveAccounts(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.SocialAccount)(nil))
	handler := &PostHandler{db: db}
	ctx := context.Background()

	accounts := []models.SocialAccount{
		{ID: "active-account", WorkspaceID: "ws-1", Platform: "x", AccountID: "1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "inactive-account", WorkspaceID: "ws-1", Platform: "x", AccountID: "2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err := db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).Set("is_active = ?", false).Where("id = ?", "inactive-account").Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, handler.validateAccountsBelongToWorkspace(ctx, "ws-1", []string{"active-account"}))
	require.Error(t, handler.validateAccountsBelongToWorkspace(ctx, "ws-1", []string{"inactive-account"}))
}
