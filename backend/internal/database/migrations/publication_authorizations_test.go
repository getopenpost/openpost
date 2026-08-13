package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestPublicationAuthorizationMigrationSQLite(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.ExecContext(t.Context(), "PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	exercisePublicationAuthorizationMigration(t, db)
}

func TestPublicationAuthorizationMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	schema := fmt.Sprintf("publication_authorizations_075_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	exercisePublicationAuthorizationMigration(t, db)
}

func exercisePublicationAuthorizationMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL);
		CREATE TABLE workspaces (id TEXT PRIMARY KEY);
		CREATE TABLE publications (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			created_by TEXT NOT NULL,
			revision INTEGER NOT NULL DEFAULT 1
		);
		CREATE TABLE api_tokens (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			token_hash TEXT NOT NULL,
			token_prefix TEXT NOT NULL,
			scope TEXT NOT NULL
		);
		INSERT INTO workspaces (id) VALUES ('workspace-1'), ('workspace-other');
		INSERT INTO publications (id, workspace_id, created_by, revision)
		VALUES ('publication-1', 'workspace-1', 'user-1', 3);
	`)
	require.NoError(t, err)

	raw, err := migrationFiles.ReadFile("075_publication_authorizations.sql")
	require.NoError(t, err)
	item := migration{version: 75, name: "075_publication_authorizations.sql", sql: normalizeMigrationSQL(db.Dialect().Name(), string(raw))}
	require.NoError(t, prepareMigration(ctx, db, item))
	require.NoError(t, runMigration(ctx, db, item))
	require.NoError(t, ensurePublicationAuthorizationSchema(ctx, db))
	require.NoError(t, ensurePublicationAuthorizationSchema(ctx, db), "finalization must remain idempotent")

	clientColumn, err := migrationColumnExists(ctx, db, "api_tokens", "client_id")
	require.NoError(t, err)
	require.True(t, clientColumn)

	now := time.Now().UTC().Truncate(time.Microsecond)
	insertPublicationAuthorizationFixture(t, db, "authorization-1", "workspace-1", "scheduled", now)
	_, err = db.ExecContext(ctx, "UPDATE publication_authorizations SET policy_mode = 'retry' WHERE id = 'authorization-1'")
	require.ErrorContains(t, err, "immutable")

	_, err = db.ExecContext(ctx, `
		INSERT INTO publication_authorizations (
			id, batch_id, job_id, workspace_id, publication_id, rendition_id,
			action, actor_origin, actor_user_id, actor_session_id,
			publication_revision, social_account_id, target_key, scheduled_at,
			content_hash, media_hash, settings_hash, policy_mode, confirmed_at, created_at
		) VALUES (
			'authorization-cross-workspace', 'batch-cross', 'job-cross', 'workspace-other',
			'publication-1', 'rendition-1', 'publish', 'browser', 'user-1', 'session-1',
			3, 'account-1', 'mastodon:https://social.example', ?,
			'sha256:content', 'sha256:media', 'sha256:settings', 'scheduled', ?, ?
		)`, now, now, now)
	require.Error(t, err, "publication and receipt workspaces must match")

	_, err = db.ExecContext(ctx, `
		INSERT INTO publication_authorizations (
			id, batch_id, job_id, workspace_id, publication_id, rendition_id,
			action, actor_origin, actor_user_id, actor_token_id,
			publication_revision, social_account_id, target_key, scheduled_at,
			content_hash, media_hash, settings_hash, policy_mode, confirmed_at, created_at
		) VALUES (
			'authorization-invalid-policy', 'batch-invalid', 'job-invalid', 'workspace-1',
			'publication-1', 'rendition-1', 'publish', 'api', 'user-1', 'token-1',
			3, 'account-1', 'x', ?, 'sha256:content', 'sha256:media', 'sha256:settings',
			'approve_everything', ?, ?
		)`, now, now, now)
	require.Error(t, err, "policy modes must be allowlisted")

	_, err = db.ExecContext(ctx, "DELETE FROM publication_authorizations WHERE id = 'authorization-1'")
	require.NoError(t, err, "privacy deletion must remain possible")
}

func insertPublicationAuthorizationFixture(t *testing.T, db *bun.DB, id, workspaceID, policy string, now time.Time) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `
		INSERT INTO publication_authorizations (
			id, batch_id, job_id, workspace_id, publication_id, rendition_id,
			action, actor_origin, actor_user_id, actor_session_id,
			publication_revision, social_account_id, target_key, scheduled_at,
			content_hash, media_hash, settings_hash, policy_mode, confirmed_at, created_at
		) VALUES (?, 'batch-1', 'job-1', ?, 'publication-1', 'rendition-1',
			'publish', 'browser', 'user-1', 'session-1', 3, 'account-1',
			'mastodon:https://social.example', ?, 'sha256:content', 'sha256:media',
			'sha256:settings', ?, ?, ?)
	`, id, workspaceID, now, policy, now, now)
	require.NoError(t, err)
}
