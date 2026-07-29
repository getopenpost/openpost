package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesOAuthAccountSelectionsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'oauth_account_selections'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "access_token_encrypted BLOB NOT NULL")
	require.Contains(t, schema, "options_json TEXT NOT NULL DEFAULT '[]'")
	require.Contains(t, schema, "consumed_at TIMESTAMP")
	require.Contains(t, schema, "FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('oauth_account_selections_user_idx', 'oauth_account_selections_workspace_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}

func TestRunMigrationsOAuthAccountSelectionsUsable(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-selection", Name: "Selection"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OAuthAccountSelection{
		ID:             "selection-1",
		UserID:         "user-1",
		WorkspaceID:    "ws-selection",
		Platform:       "facebook",
		AccessTokenEnc: []byte("encrypted-token"),
		OptionsJSON:    `[{"id":"page-1","display_name":"Main Page"}]`,
		ExpiresAt:      time.Now().UTC().Add(time.Minute),
	}).Exec(ctx)
	require.NoError(t, err)

	var stored models.OAuthAccountSelection
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", "selection-1").Scan(ctx))
	require.Equal(t, "facebook", stored.Platform)
	require.Contains(t, stored.OptionsJSON, "Main Page")
}
