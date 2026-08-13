package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsAddsSocialAccountCapabilityState(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, runTestMigrations(t, db))

	var socialAccountSchema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'social_accounts'").Scan(&socialAccountSchema))
	require.Contains(t, socialAccountSchema, "capability_state_json")
	require.Contains(t, socialAccountSchema, "capability_checked_at")

	account := models.SocialAccount{
		ID:             "x-account",
		WorkspaceID:    "workspace-1",
		Slug:           "x-account",
		Platform:       "x",
		AccountID:      "x-user",
		AccessTokenEnc: []byte("encrypted"),
		IsActive:       true,
	}
	_, err := db.NewInsert().Model(&account).Exec(ctx)
	require.NoError(t, err)

	var capabilityState string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT capability_state_json FROM social_accounts WHERE id = ?", account.ID).Scan(&capabilityState))
	require.Equal(t, "{}", capabilityState)
}
