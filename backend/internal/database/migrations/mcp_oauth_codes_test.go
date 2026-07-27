package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesMCPOAuthCodesSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, RunMigrations(db))

	var apiTokenSchema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'api_tokens'").Scan(&apiTokenSchema))
	require.Contains(t, apiTokenSchema, "audience TEXT")

	var schema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'mcp_oauth_codes'").Scan(&schema))
	require.Contains(t, schema, "code_hash TEXT NOT NULL UNIQUE")
	require.Contains(t, schema, "client_id TEXT NOT NULL")
	require.Contains(t, schema, "code_challenge_method TEXT NOT NULL")
	require.Contains(t, schema, "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("sqlite_master").
		Where("type = 'index' AND name IN ('mcp_oauth_codes_user_created_idx', 'mcp_oauth_codes_expiry_idx')").
		Scan(ctx, &indexCount))
	require.Equal(t, 2, indexCount)
}
