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

func TestProviderWriteAttemptMigrationSQLite(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.ExecContext(t.Context(), "PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	exerciseProviderWriteAttemptMigration(t, db)
}

func TestProviderWriteAttemptMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	schema := fmt.Sprintf("provider_write_attempts_076_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	exerciseProviderWriteAttemptMigration(t, db)
}

func exerciseProviderWriteAttemptMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL);
		CREATE TABLE workspaces (id TEXT PRIMARY KEY);
		CREATE TABLE publications (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
		CREATE TABLE social_accounts (
			id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, platform TEXT NOT NULL
		);
		CREATE TABLE renditions (
			id TEXT PRIMARY KEY, publication_id TEXT NOT NULL,
			social_account_id TEXT NOT NULL, platform TEXT NOT NULL
		);
		CREATE TABLE publication_authorizations (
			id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, publication_id TEXT NOT NULL,
			rendition_id TEXT NOT NULL, social_account_id TEXT NOT NULL, target_key TEXT NOT NULL
		);
		INSERT INTO workspaces (id) VALUES ('workspace-1'), ('workspace-2');
		INSERT INTO publications (id, workspace_id) VALUES ('publication-1', 'workspace-1');
		INSERT INTO social_accounts (id, workspace_id, platform) VALUES
			('account-1', 'workspace-1', 'x'), ('account-2', 'workspace-2', 'x');
		INSERT INTO renditions (id, publication_id, social_account_id, platform)
		VALUES ('rendition-1', 'publication-1', 'account-1', 'x');
		INSERT INTO publication_authorizations (
			id, workspace_id, publication_id, rendition_id, social_account_id, target_key
		) VALUES (
			'authorization-1', 'workspace-1', 'publication-1', 'rendition-1', 'account-1', 'x'
		);
	`)
	require.NoError(t, err)

	raw, err := migrationFiles.ReadFile("076_provider_write_attempts.sql")
	require.NoError(t, err)
	item := migration{version: 76, name: "076_provider_write_attempts.sql", sql: normalizeMigrationSQL(db.Dialect().Name(), string(raw))}
	require.NoError(t, prepareMigration(ctx, db, item))
	require.NoError(t, runMigration(ctx, db, item))
	require.NoError(t, ensureProviderWriteAttemptSchema(ctx, db))

	insertProviderWriteAttemptFixture(t, db, "attempt-1", "operation-1", "prepared", "workspace-1", "account-1", "authorization-1", "publication-1", "rendition-1", "x")
	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_write_attempts (
			id, operation_id, attempt_number, workspace_id, social_account_id,
			target_key, provider, operation, payload_fingerprint, status,
			submission_state, retry_safety
		) VALUES (
			'attempt-cross-workspace', 'operation-cross', 1, 'workspace-1', 'account-2',
			'x', 'x', 'publish', 'sha256:payload', 'prepared', 'not_sent', 'safe'
		)`)
	require.Error(t, err, "account ownership must match the attempt workspace")

	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_write_attempts (
			id, operation_id, attempt_number, authorization_id, workspace_id,
			publication_id, rendition_id, social_account_id, target_key, provider,
			operation, payload_fingerprint, status, submission_state, retry_safety
		) VALUES (
			'attempt-wrong-receipt', 'operation-wrong-receipt', 1, 'authorization-1',
			'workspace-1', 'publication-1', 'rendition-1', 'account-1', 'mastodon', 'x',
			'publish', 'sha256:payload', 'prepared', 'not_sent', 'safe'
		)`)
	require.Error(t, err, "the attempt target must match its immutable authorization receipt")

	_, err = db.ExecContext(ctx, `
		INSERT INTO provider_write_attempts (
			id, operation_id, attempt_number, workspace_id, social_account_id,
			target_key, provider, operation, payload_fingerprint, status,
			submission_state, retry_safety
		) VALUES (
			'attempt-duplicate-active', 'operation-1', 2, 'workspace-1', 'account-1',
			'x', 'x', 'publish', 'sha256:payload', 'prepared', 'not_sent', 'safe'
		)`)
	require.Error(t, err, "only one active sender may own an operation")

	_, err = db.ExecContext(ctx, "UPDATE provider_write_attempts SET status = 'accepted', submission_state = 'accepted' WHERE id = 'attempt-1'")
	require.NoError(t, err)
	insertProviderWriteAttemptFixture(t, db, "attempt-2", "operation-1", "prepared", "workspace-1", "account-1", "authorization-1", "publication-1", "rendition-1", "x")
}

func insertProviderWriteAttemptFixture(
	t *testing.T,
	db *bun.DB,
	id, operationID, status, workspaceID, accountID, authorizationID, publicationID, renditionID, targetKey string,
) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `
		INSERT INTO provider_write_attempts (
			id, operation_id, attempt_number, authorization_id, workspace_id,
			publication_id, rendition_id, social_account_id, target_key, provider,
			operation, payload_fingerprint, status, submission_state, retry_safety
		) VALUES (?, ?, CASE WHEN ? = 'attempt-2' THEN 2 ELSE 1 END, ?, ?, ?, ?, ?, ?, 'x',
			'publish', 'sha256:payload', ?, 'not_sent', 'safe')
	`, id, operationID, id, authorizationID, workspaceID, publicationID, renditionID, accountID, targetKey, status)
	require.NoError(t, err)
}
