package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsAddsSocialAccountGrantedScopes(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)

	require.NoError(t, runTestMigrations(t, db))

	var socialAccountSchema string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'social_accounts'").Scan(&socialAccountSchema))
	require.Contains(t, socialAccountSchema, "granted_scopes")
	require.Contains(t, socialAccountSchema, "DEFAULT ''")
}
