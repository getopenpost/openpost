package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsDropsLegacySocialAccountActiveIndex(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "CREATE UNIQUE INDEX social_accounts_active_idx ON social_accounts (workspace_id) WHERE is_active = 1")
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))

	accounts := []models.SocialAccount{
		{ID: "acc-1", WorkspaceID: "ws-1", Slug: "x-main", Platform: "x", AccountID: "1", AccessTokenEnc: []byte("token"), IsActive: true},
		{ID: "acc-2", WorkspaceID: "ws-1", Slug: "threads-main", Platform: "threads", AccountID: "2", AccessTokenEnc: []byte("token"), IsActive: true},
	}
	_, err = db.NewInsert().Model(&accounts).Exec(ctx)
	require.NoError(t, err)
}
