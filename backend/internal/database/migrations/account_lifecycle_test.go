package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsAddsAccountLifecycleSchema(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := context.Background()

	_, err := db.NewCreateTable().Model((*models.User)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, runTestMigrations(t, db))

	var userSchema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'users'").Scan(&userSchema))
	require.Contains(t, userSchema, "terms_version")
	require.Contains(t, userSchema, "privacy_version")
	require.Contains(t, userSchema, "legal_accepted_at")

	var resetSchema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'password_reset_tokens'").Scan(&resetSchema))
	require.Contains(t, resetSchema, "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE")
	require.Contains(t, resetSchema, "token_hash TEXT NOT NULL UNIQUE")
}
