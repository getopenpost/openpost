package migrations

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRunMigrationsAddsPromptExampleColumnToLegacyTable(t *testing.T) {
	t.Parallel()

	db := newMigrationsTestDB(t)
	ctx := context.Background()

	// Simulate a database created before prompts gained the example column:
	// the bootstrap table exists without it, and existing rows carry no example.
	_, err := db.ExecContext(ctx, `CREATE TABLE prompts (
		id TEXT PRIMARY KEY,
		workspace_id TEXT,
		user_id TEXT,
		text TEXT NOT NULL,
		category TEXT NOT NULL,
		is_built_in BOOLEAN NOT NULL DEFAULT false,
		created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
	)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO prompts (id, text, category, is_built_in)
		VALUES ('builtin-001', 'share a take', 'Bold & Provoking', true)`)
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))

	present, err := migrationColumnExists(ctx, db, "prompts", "example")
	require.NoError(t, err)
	require.True(t, present)

	var example string
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT example FROM prompts WHERE id = 'builtin-001'").Scan(&example))
	require.Equal(t, "", example, "legacy rows default to an empty example")

	// Re-running the migration must stay idempotent.
	require.NoError(t, runTestMigrations(t, db))
}

func TestRunMigrationsCreatesPromptsTableWithExampleColumn(t *testing.T) {
	t.Parallel()

	// Migration regression tests use a minimal schema without the prompts
	// base table; the migration must still leave a usable prompts table.
	db := newMigrationsTestDB(t)
	ctx := context.Background()

	require.NoError(t, runTestMigrations(t, db))

	present, err := migrationColumnExists(ctx, db, "prompts", "example")
	require.NoError(t, err)
	require.True(t, present)

	_, err = db.ExecContext(ctx, `INSERT INTO prompts (id, text, example, category, is_built_in)
		VALUES ('builtin-001', 'share a take', 'Here is a full example post.', 'Bold & Provoking', true)`)
	require.NoError(t, err)
}
