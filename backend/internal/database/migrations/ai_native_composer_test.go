package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"testing/fstest"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
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
	require.Equal(t, "default:ws-1", profile.ID)
	require.Equal(t, "OpenPost", profile.Name)
	require.True(t, profile.IsDefault)

	_, err = db.ExecContext(ctx, `INSERT INTO voice_profile_account_assignments
		(social_account_id, workspace_id, voice_profile_id) VALUES ('account-1', 'ws-1', 'default:ws-1')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO voice_profile_account_assignments
		(social_account_id, workspace_id, voice_profile_id) VALUES ('missing', 'ws-1', 'default:ws-1')`)
	require.Error(t, err)

	buildInsert := `INSERT INTO publication_builds
		(id, workspace_id, created_by_id, idempotency_key, request_fingerprint, state, phase, request_json, voice_snapshot_json, result_json)
		VALUES (?, 'ws-1', 'user-1', 'key-1', ?, 'queued', 'queued', '{}', '{}', '{}')`
	_, err = db.ExecContext(ctx, buildInsert, "build-1", "fingerprint-1")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, buildInsert, "build-2", "fingerprint-1")
	require.Error(t, err, "one idempotency key must identify one build")

	_, err = db.ExecContext(ctx, `INSERT INTO media_attachments (id, workspace_id) VALUES ('media-1', 'ws-1')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO publication_build_assets (build_id, media_id) VALUES ('build-1', 'media-1')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `DELETE FROM media_attachments WHERE id = 'media-1'`)
	require.Error(t, err, "migration 109 used the original restrictive source-history foreign key")

	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).IfNotExists().Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&SchemaMigration{Version: 109, AppliedAt: time.Now().Unix()}).Exec(ctx)
	require.NoError(t, err)
	hardeningMigrations := fstest.MapFS{
		"110_ai_native_composer_hardening.sql": &fstest.MapFile{Data: []byte("SELECT 1;")},
	}
	require.NoError(t, runMigrations(db, hardeningMigrations))

	leaseTokenPresent, err := migrationColumnExists(ctx, db, "publication_builds", "lease_token")
	require.NoError(t, err)
	require.True(t, leaseTokenPresent)
	leaseExpiryPresent, err := migrationColumnExists(ctx, db, "publication_builds", "lease_expires_at")
	require.NoError(t, err)
	require.True(t, leaseExpiryPresent)
	var assetCount int
	err = db.NewRaw(`SELECT COUNT(*) FROM publication_build_assets WHERE media_id = 'media-1'`).Scan(ctx, &assetCount)
	require.NoError(t, err)
	require.Equal(t, 1, assetCount, "hardening must preserve source history rows")
	_, err = db.ExecContext(ctx, `DELETE FROM media_attachments WHERE id = 'media-1'`)
	require.NoError(t, err, "hardened source history must not block media deletion")
	err = db.NewRaw(`SELECT COUNT(*) FROM publication_build_assets WHERE media_id = 'media-1'`).Scan(ctx, &assetCount)
	require.NoError(t, err)
	require.Zero(t, assetCount)
	require.NoError(t, runMigrations(db, hardeningMigrations), "hardening migration replay must be a no-op")

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

func TestAINativeComposerHardeningPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	schema := fmt.Sprintf("ai_native_composer_110_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)

	ctx := t.Context()
	_, err = db.ExecContext(ctx, `
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
	`)
	require.NoError(t, err)
	raw, err := migrationFiles.ReadFile("109_ai_native_composer.sql")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, normalizeMigrationSQL(db.Dialect().Name(), string(raw)))
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO publication_builds (
			id, workspace_id, created_by_id, idempotency_key, request_fingerprint,
			state, phase, request_json, voice_snapshot_json, result_json
		) VALUES ('build-1', 'ws-1', 'user-1', 'key-1', 'fingerprint-1', 'queued', 'queued', '{}', '{}', '{}');
		INSERT INTO media_attachments (id, workspace_id) VALUES ('media-1', 'ws-1');
		INSERT INTO publication_build_assets (build_id, media_id) VALUES ('build-1', 'media-1');
		CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL);
		INSERT INTO schema_migrations (version, applied_at) VALUES (109, 1);
	`)
	require.NoError(t, err)

	hardeningMigrations := fstest.MapFS{
		"110_ai_native_composer_hardening.sql": &fstest.MapFile{Data: []byte("SELECT 1;")},
	}
	require.NoError(t, runMigrations(db, hardeningMigrations))
	leaseTokenPresent, err := migrationColumnExists(ctx, db, "publication_builds", "lease_token")
	require.NoError(t, err)
	require.True(t, leaseTokenPresent)
	_, err = db.ExecContext(ctx, `DELETE FROM media_attachments WHERE id = 'media-1'`)
	require.NoError(t, err)
	var assetCount int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM publication_build_assets`).Scan(ctx, &assetCount))
	require.Zero(t, assetCount)
}
