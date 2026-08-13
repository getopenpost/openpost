package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesCommunicationsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))
	ctx := context.Background()
	for table, expectedForeignKeys := range map[string]int{
		"engagement_items":              2,
		"conversations":                 1,
		"direct_messages":               1,
		"communication_sync_states":     1,
		"user_notifications":            1,
		"user_notification_preferences": 1,
	} {
		var count int
		require.NoError(t, db.QueryRowContext(
			ctx,
			"SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
			table,
		).Scan(&count))
		require.Equal(t, 1, count, table)

		require.NoError(t, db.QueryRowContext(
			ctx,
			"SELECT COUNT(*) FROM pragma_foreign_key_list(?)",
			table,
		).Scan(&count))
		require.Equal(t, expectedForeignKeys, count, table)
	}
}
