package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesRepostAutomationSchema(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, RunMigrations(db))

	for table, foreignKeys := range map[string]int{
		"repost_policies":        3,
		"repost_policy_accounts": 2,
		"repost_account_grants":  5,
		"repost_executions":      6,
	} {
		var count int
		require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", table).Scan(&count))
		require.Equal(t, 1, count, table)
		require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM pragma_foreign_key_list(?)", table).Scan(&count))
		require.Equal(t, foreignKeys, count, table)
	}

	var publicationSchema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'publications'").Scan(&publicationSchema))
	require.Contains(t, publicationSchema, "repost_override_json")
	require.NoError(t, RunMigrations(db))
}
