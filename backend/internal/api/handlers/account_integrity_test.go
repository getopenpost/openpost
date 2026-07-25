package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func createHandlerTestDB(t *testing.T, modelsToCreate ...interface{}) *bun.DB {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name()))
	require.NoError(t, err)

	db := bun.NewDB(sqldb, sqlitedialect.New())
	_, err = db.NewCreateTable().
		Model((*models.DraftRevisionChange)(nil)).
		IfNotExists().
		Exec(context.Background())
	require.NoError(t, err)
	for _, model := range modelsToCreate {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}

	return db
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
