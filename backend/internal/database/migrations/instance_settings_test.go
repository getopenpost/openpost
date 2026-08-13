package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsCreatesEncryptedInstanceSettingsSchema(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()
	require.NoError(t, runTestMigrations(t, db))

	row := db.QueryRowContext(ctx, "SELECT sql FROM sqlite_master WHERE name = 'instance_settings'")
	var schema string
	require.NoError(t, row.Scan(&schema))
	require.Contains(t, schema, "key TEXT PRIMARY KEY")
	require.Contains(t, schema, "value_encrypted BLOB NOT NULL")
	require.Contains(t, schema, "REFERENCES users(id) ON DELETE SET NULL")

	_, err := db.ExecContext(ctx, "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)", "admin-1", "admin@example.com", "hash")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "INSERT INTO instance_settings (key, value_encrypted, updated_by_id) VALUES (?, ?, ?)", "OPENPOST_FEEDBACK_ENABLED", []byte("ciphertext"), "admin-1")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, "DELETE FROM users WHERE id = ?", "admin-1")
	require.NoError(t, err)

	var updatedBy *string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT updated_by_id FROM instance_settings WHERE key = ?", "OPENPOST_FEEDBACK_ENABLED").Scan(&updatedBy))
	require.Nil(t, updatedBy)
}
