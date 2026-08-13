package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesAnalyticsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))

	ctx := context.Background()
	for _, table := range []string{
		"analytics_account_snapshots",
		"analytics_rendition_snapshots",
		"analytics_sync_states",
	} {
		var count int
		require.NoError(t, db.QueryRowContext(
			ctx,
			"SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
			table,
		).Scan(&count))
		require.Equal(t, 1, count, table)
	}
	for table, expected := range map[string]int{
		"analytics_account_snapshots":   1,
		"analytics_rendition_snapshots": 3,
		"analytics_sync_states":         1,
	} {
		var count int
		require.NoError(t, db.QueryRowContext(
			ctx,
			"SELECT COUNT(*) FROM pragma_foreign_key_list(?)",
			table,
		).Scan(&count))
		require.Equal(t, expected, count, table)
	}
}
