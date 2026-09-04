package migrations

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect"
)

func TestNormalizeMigrationSQLLeavesSQLiteStatementsUnchanged(t *testing.T) {
	t.Parallel()

	raw := `
ALTER TABLE users ADD COLUMN totp_secret_encrypted BLOB;
ALTER TABLE users ADD COLUMN totp_enabled_at DATETIME;
DELETE FROM social_accounts WHERE is_active = 0;
CREATE UNIQUE INDEX social_accounts_active_idx ON social_accounts (workspace_id) WHERE is_active = 1;
`

	require.Equal(t, raw, normalizeMigrationSQL(dialect.SQLite, raw))
}

func TestNormalizeMigrationSQLMakesStatementsPostgresSafe(t *testing.T) {
	t.Parallel()

	raw := `
ALTER TABLE users ADD COLUMN totp_secret_encrypted BLOB;
ALTER TABLE users ADD COLUMN totp_enabled_at DATETIME;
ALTER TABLE social_accounts
  ADD COLUMN granted_scopes TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS already_safe TEXT;
SELECT 'ADD COLUMN stays literal';
-- ADD COLUMN stays a comment
ALTER TABLE media_attachments ADD COLUMN public_url_ready BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE media_attachments ADD COLUMN public_url_public BOOLEAN DEFAULT 1;
DELETE FROM social_accounts WHERE is_active = 0;
CREATE UNIQUE INDEX social_accounts_active_idx ON social_accounts (workspace_id) WHERE is_active = 1 AND slug != '';
`

	got := normalizeMigrationSQL(dialect.PG, raw)

	require.Contains(t, got, "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_encrypted BYTEA")
	require.Contains(t, got, "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ")
	require.Contains(t, got, "ALTER TABLE social_accounts\n  ADD COLUMN IF NOT EXISTS granted_scopes TEXT NOT NULL DEFAULT ''")
	require.Contains(t, got, "ALTER TABLE users ADD COLUMN IF NOT EXISTS already_safe TEXT")
	require.NotContains(t, got, "ADD COLUMN IF NOT EXISTS IF NOT EXISTS")
	require.Contains(t, got, "SELECT 'ADD COLUMN stays literal'")
	require.Contains(t, got, "-- ADD COLUMN stays a comment")
	require.Contains(t, got, "ALTER TABLE media_attachments ADD COLUMN IF NOT EXISTS public_url_ready BOOLEAN NOT NULL DEFAULT FALSE")
	require.Contains(t, got, "ALTER TABLE media_attachments ADD COLUMN IF NOT EXISTS public_url_public BOOLEAN DEFAULT TRUE")
	require.Contains(t, got, "totp_secret_encrypted BYTEA")
	require.Contains(t, got, "totp_enabled_at TIMESTAMPTZ")
	require.Contains(t, got, "is_active = FALSE")
	require.Contains(t, got, "is_active = TRUE AND slug != ''")
	require.NotContains(t, got, " BLOB")
	require.NotContains(t, got, " DATETIME")
	require.NotContains(t, got, "BOOLEAN NOT NULL DEFAULT 0")
	require.NotContains(t, got, "BOOLEAN DEFAULT 1")
	require.NotContains(t, got, "is_active = 0")
	require.NotContains(t, got, "is_active = 1")
}
