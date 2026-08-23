package migrations

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestAINativeComposerMigrationBackfillsVoiceAndEnforcesBuildIdentity(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	_, err = db.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	require.NoError(t, err)

	for _, statement := range []string{
		`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL)`,
		`CREATE TABLE workspaces (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL)`,
		`CREATE TABLE social_accounts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, platform TEXT NOT NULL, UNIQUE (id, workspace_id), FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE)`,
		`CREATE TABLE media_attachments (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE)`,
		`CREATE TABLE publications (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE)`,
		`INSERT INTO users (id, email) VALUES ('user-1', 'owner@example.com')`,
		`INSERT INTO workspaces (id, name) VALUES ('ws-1', 'OpenPost')`,
		`INSERT INTO social_accounts (id, workspace_id, platform) VALUES ('account-1', 'ws-1', 'x')`,
	} {
		_, err = db.ExecContext(ctx, statement)
		require.NoError(t, err)
	}

	raw, err := migrationFiles.ReadFile("109_ai_native_composer.sql")
	require.NoError(t, err)
	sqlText := normalizeMigrationSQL(db.Dialect().Name(), string(raw))
	_, err = db.ExecContext(ctx, sqlText)
	require.NoError(t, err)

	var profile struct {
		ID        string `bun:"id"`
		Name      string `bun:"name"`
		IsDefault bool   `bun:"is_default"`
	}
	err = db.NewRaw("SELECT id, name, is_default FROM voice_profiles WHERE workspace_id = ?", "ws-1").Scan(ctx, &profile)
	require.NoError(t, err)
	require.Equal(t, "ws-1:default-voice", profile.ID)
	require.Equal(t, "OpenPost voice", profile.Name)
	require.True(t, profile.IsDefault)

	_, err = db.ExecContext(ctx, `INSERT INTO voice_profile_account_assignments
		(social_account_id, workspace_id, voice_profile_id) VALUES ('account-1', 'ws-1', 'ws-1:default-voice')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO voice_profile_account_assignments
		(social_account_id, workspace_id, voice_profile_id) VALUES ('missing', 'ws-1', 'ws-1:default-voice')`)
	require.Error(t, err)

	buildInsert := `INSERT INTO publication_builds
		(id, workspace_id, created_by_id, idempotency_key, request_fingerprint, state, phase, request_json, voice_snapshot_json, result_json)
		VALUES (?, 'ws-1', 'user-1', 'key-1', ?, 'queued', 'queued', '{}', '{}', '{}')`
	_, err = db.ExecContext(ctx, buildInsert, "build-1", "fingerprint-1")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, buildInsert, "build-2", "fingerprint-1")
	require.Error(t, err, "one idempotency key must identify one build")

	_, err = db.ExecContext(ctx, sqlText)
	require.NoError(t, err, "migration must be idempotent")
}

func TestAINativeComposerMigrationNormalizesForPostgres(t *testing.T) {
	raw, err := migrationFiles.ReadFile("109_ai_native_composer.sql")
	require.NoError(t, err)
	postgres := normalizeMigrationSQL(dialect.PG, string(raw))
	require.Contains(t, postgres, "voice_profiles")
	require.Contains(t, postgres, "publication_builds")
}
