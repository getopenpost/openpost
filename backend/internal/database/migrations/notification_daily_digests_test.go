package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestNotificationDailyDigestMigrationCreatesPreferenceAndBatchState(t *testing.T) {
	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))
	ctx := context.Background()

	for _, column := range []string{"digest_time", "digest_timezone", "digest_configured"} {
		var count int
		require.NoError(t, db.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM pragma_table_info('user_notification_preferences') WHERE name = ?", column,
		).Scan(&count))
		require.Equal(t, 1, count, column)
	}
	var tableCount int
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'user_notification_digest_items'",
	).Scan(&tableCount))
	require.Equal(t, 1, tableCount)
	var deliveryColumnCount int
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM pragma_table_info('user_notification_digest_items') WHERE name = 'delivery_id'",
	).Scan(&deliveryColumnCount))
	require.Equal(t, 1, deliveryColumnCount)

	_, err := db.NewInsert().Model(&models.User{ID: "digest-user", Email: "digest@example.com"}).Exec(ctx)
	require.NoError(t, err)
	preference := &models.UserNotificationPreference{UserID: "digest-user", PreferencesJSON: `{}`}
	_, err = db.NewInsert().Model(preference).Exec(ctx)
	require.NoError(t, err)
	var stored models.UserNotificationPreference
	require.NoError(t, db.NewSelect().Model(&stored).Where("user_id = ?", "digest-user").Scan(ctx))
	require.Equal(t, "09:00", stored.DigestTime)
	require.Empty(t, stored.DigestTimezone)
	require.False(t, stored.DigestConfigured)
}
