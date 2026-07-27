package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsAddsAPITokenWorkspaceScope(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	var apiTokenSchema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'api_tokens'").Scan(&apiTokenSchema))
	require.Contains(t, apiTokenSchema, "workspace_id TEXT")

	var oauthCodeSchema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'mcp_oauth_codes'").Scan(&oauthCodeSchema))
	require.Contains(t, oauthCodeSchema, "workspace_id TEXT")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('api_tokens_workspace_id_idx', 'mcp_oauth_codes_workspace_id_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}
