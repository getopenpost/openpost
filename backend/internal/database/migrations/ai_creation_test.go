package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestAICreationMigrationBackfillsVoiceAndKeepsBuildSourcesDisposable(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, exerciseAICreationMigration(t.Context(), db))
}

func TestAICreationMigrationOnPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	schema := fmt.Sprintf("ai_creation_113_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	require.NoError(t, exerciseAICreationMigration(t.Context(), db))
}

func exerciseAICreationMigration(ctx context.Context, db *bun.DB) error {
	if db.Dialect().Name() == dialect.SQLite {
		if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
			return err
		}
	}
	bootstrap := `
		CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);
		CREATE TABLE workspaces (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL);
		CREATE TABLE social_accounts (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			platform TEXT NOT NULL,
			UNIQUE (id, workspace_id),
			FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
		);
		CREATE TABLE media_attachments (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
		);
		CREATE TABLE publications (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
		);
		INSERT INTO users (id, email) VALUES ('user-1', 'owner@example.com');
		INSERT INTO workspaces (id, name) VALUES ('ws-1', 'OpenPost');
		INSERT INTO social_accounts (id, workspace_id, platform) VALUES ('account-1', 'ws-1', 'x');
	`
	if _, err := db.ExecContext(ctx, bootstrap); err != nil {
		return err
	}
	raw, err := migrationFiles.ReadFile("113_ai_creation.sql")
	if err != nil {
		return err
	}
	migrationSQL := normalizeMigrationSQL(db.Dialect().Name(), string(raw))
	if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
		return err
	}

	var profile struct {
		ID        string `bun:"id"`
		Name      string `bun:"name"`
		IsDefault bool   `bun:"is_default"`
	}
	if err := db.NewRaw("SELECT id, name, is_default FROM voice_profiles WHERE workspace_id = ?", "ws-1").Scan(ctx, &profile); err != nil {
		return err
	}
	if profile.ID != "default:ws-1" || profile.Name != "OpenPost" || !profile.IsDefault {
		return fmt.Errorf("unexpected default Voice Profile: %+v", profile)
	}

	if _, err := db.ExecContext(ctx, `INSERT INTO voice_profile_account_assignments
		(social_account_id, workspace_id, voice_profile_id) VALUES ('account-1', 'ws-1', 'default:ws-1')`); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO voice_profile_account_assignments
		(social_account_id, workspace_id, voice_profile_id) VALUES ('missing', 'ws-1', 'default:ws-1')`); err == nil {
		return fmt.Errorf("assignment accepted a missing social account")
	}

	buildInsert := `INSERT INTO publication_builds
		(id, workspace_id, created_by_id, idempotency_key, request_fingerprint, state, phase, request_json)
		VALUES ('build-1', 'ws-1', 'user-1', 'stable-key', 'fingerprint-1', 'queued', 'queued', '{}')`
	if _, err := db.ExecContext(ctx, buildInsert); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `UPDATE publication_builds
		SET lease_token = 'lease-1', lease_expires_at = CURRENT_TIMESTAMP WHERE id = 'build-1'`); err != nil {
		return fmt.Errorf("record build lease: %w", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO publication_builds
		(id, workspace_id, created_by_id, idempotency_key, request_fingerprint, state, phase, request_json)
		VALUES ('build-2', 'ws-1', 'user-1', 'stable-key', 'fingerprint-2', 'queued', 'queued', '{}')`); err == nil {
		return fmt.Errorf("duplicate build idempotency key was accepted")
	}

	if _, err := db.ExecContext(ctx, `INSERT INTO media_attachments (id, workspace_id) VALUES ('media-1', 'ws-1')`); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO publication_build_assets (build_id, media_id) VALUES ('build-1', 'media-1')`); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM media_attachments WHERE id = 'media-1'`); err != nil {
		return fmt.Errorf("delete disposable build source: %w", err)
	}
	var assetCount int
	if err := db.NewRaw(`SELECT COUNT(*) FROM publication_build_assets WHERE media_id = 'media-1'`).Scan(ctx, &assetCount); err != nil {
		return err
	}
	if assetCount != 0 {
		return fmt.Errorf("deleted media left %d publication build asset rows", assetCount)
	}
	_, err = db.ExecContext(ctx, migrationSQL)
	return err
}
