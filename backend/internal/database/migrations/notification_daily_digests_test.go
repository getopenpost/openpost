package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestNotificationDailyDigestMigrationAppliesPreferenceDefaults(t *testing.T) {
	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))
	ctx := context.Background()

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
