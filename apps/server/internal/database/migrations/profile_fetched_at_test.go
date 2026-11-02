package migrations

import (
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"testing"
	"time"
)

func TestProfileFetchedAtMigration(t *testing.T) {
	exerciseProfileFetchedAtMigration(t, newMigrationsTestDB(t))
}
func TestProfileFetchedAtMigrationPostgres(t *testing.T) {
	exerciseProfileFetchedAtMigration(t, newPostgresMigrationTestDB(t))
}
func exerciseProfileFetchedAtMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	require.NoError(t, RunMigrations(db))
	_, err := db.ExecContext(t.Context(), `INSERT INTO workspaces(id,name) VALUES('profile-ws','Profile')`)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `INSERT INTO social_accounts(id,workspace_id,slug,platform,account_id,account_username,access_token_encrypted) VALUES('profile-account','profile-ws','profile','youtube','channel','Existing',?)`, []byte{0})
	require.NoError(t, err)
	var unknown bool
	var name string
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT profile_fetched_at IS NULL,account_username FROM social_accounts WHERE id='profile-account'`).Scan(&unknown, &name))
	require.True(t, unknown, "migrations must not invent a successful fetch date")
	require.Equal(t, "Existing", name)
	fetched := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	_, err = db.ExecContext(t.Context(), `UPDATE social_accounts SET profile_fetched_at=? WHERE id='profile-account'`, fetched)
	require.NoError(t, err)
	var got time.Time
	require.NoError(t, db.QueryRowContext(t.Context(), `SELECT profile_fetched_at FROM social_accounts WHERE id='profile-account'`).Scan(&got))
	require.Equal(t, fetched, got)
}
