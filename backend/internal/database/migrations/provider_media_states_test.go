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
	"github.com/uptrace/bun/dialect"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestRenditionMediaDeliveryMigrationSQLite(t *testing.T) {
	for _, populated := range []bool{false, true} {
		populated := populated
		name := "fresh"
		if populated {
			name = "populated_upgrade"
		}
		t.Run(name, func(t *testing.T) {
			db := newProviderMediaSQLiteDB(t)
			createLegacyProviderMediaFixture(t, db, populated, false)
			applyProviderMediaDeliveryMigration(t, db)
			assertProviderMediaDeliveryMigration(t, db, populated)
		})
	}
}

func TestRenditionMediaDeliveryMigrationReplacesBrokenSQLiteOwnerFK(t *testing.T) {
	db := newProviderMediaSQLiteDB(t)
	createLegacyProviderMediaFixture(t, db, false, true)
	seedProviderMediaOwners(t, db)

	_, err := db.ExecContext(t.Context(), `INSERT INTO provider_media_states (
		post_id, rendition_id, social_account_id, media_id, platform,
		platform_media_id, status
	) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"rendition-1", "rendition-1", "account-1", "media-1", "youtube", "video-1", "ready")
	require.ErrorContains(t, err, "FOREIGN KEY constraint failed")

	applyProviderMediaDeliveryMigration(t, db)
	_, err = db.ExecContext(t.Context(), `INSERT INTO rendition_media_deliveries (
		workspace_id, publication_id, rendition_id, social_account_id, media_id,
		platform, provider_media_id, status, retry_classification
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"workspace-1", "publication-1", "rendition-1", "account-1", "media-1",
		"youtube", "video-1", "ready", "none")
	require.NoError(t, err, "the exact rendition-owned row must no longer be forced through posts.id")
}

func TestRenditionMediaDeliveryMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	for _, populated := range []bool{false, true} {
		populated := populated
		name := "fresh"
		if populated {
			name = "populated_upgrade"
		}
		t.Run(name, func(t *testing.T) {
			sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
			sqlDB.SetMaxOpenConns(1)
			db := bun.NewDB(sqlDB, pgdialect.New())
			t.Cleanup(func() { require.NoError(t, db.Close()) })
			require.NoError(t, db.PingContext(t.Context()))

			schema := fmt.Sprintf("provider_media_074_%d", time.Now().UnixNano())
			_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
			require.NoError(t, err)
			t.Cleanup(func() {
				_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
				require.NoError(t, cleanupErr)
			})
			_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
			require.NoError(t, err)

			createLegacyProviderMediaFixture(t, db, populated, false)
			applyProviderMediaDeliveryMigration(t, db)
			assertProviderMediaDeliveryMigration(t, db, populated)
		})
	}
}

func newProviderMediaSQLiteDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	_, err = db.ExecContext(t.Context(), "PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func createLegacyProviderMediaFixture(t *testing.T, db *bun.DB, populated, brokenPostFK bool) {
	t.Helper()
	ctx := t.Context()
	_, err := db.NewCreateTable().Model((*SchemaMigration)(nil)).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		CREATE TABLE workspaces (id TEXT PRIMARY KEY);
		CREATE TABLE posts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
		CREATE TABLE publications (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
		CREATE TABLE social_accounts (
			id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, platform TEXT NOT NULL
		);
		CREATE TABLE media_attachments (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
		CREATE TABLE renditions (
			id TEXT PRIMARY KEY, publication_id TEXT NOT NULL,
			social_account_id TEXT NOT NULL, platform TEXT NOT NULL
		);
		CREATE TABLE rendition_media (
			rendition_id TEXT NOT NULL, media_id TEXT NOT NULL,
			PRIMARY KEY (rendition_id, media_id)
		);
	`)
	require.NoError(t, err)
	fk := ""
	if brokenPostFK {
		fk = ", FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE"
	}
	_, err = db.ExecContext(ctx, `CREATE TABLE provider_media_states (
		post_id TEXT NOT NULL,
		social_account_id TEXT NOT NULL,
		media_id TEXT NOT NULL,
		platform TEXT NOT NULL,
		platform_media_id TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'ready',
		error_message TEXT,
		created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
		updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
		rendition_id TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (post_id, social_account_id, media_id)`+fk+`
	)`)
	require.NoError(t, err)
	if !populated {
		return
	}
	seedProviderMediaOwners(t, db)
	_, err = db.ExecContext(ctx, `INSERT INTO provider_media_states (
		post_id, rendition_id, social_account_id, media_id, platform,
		platform_media_id, status
	) VALUES
		('post-1', '', 'account-1', 'media-1', 'youtube', 'legacy-media-1', 'ready'),
		('rendition-1', 'rendition-1', 'account-1', 'media-1', 'youtube', 'video-1', 'ready'),
		('rendition-1', 'rendition-1', 'account-other', 'media-other', 'youtube', 'wrong-owner', 'ready')`)
	require.NoError(t, err)
}

func seedProviderMediaOwners(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `
		INSERT INTO workspaces (id) VALUES ('workspace-1'), ('workspace-other');
		INSERT INTO posts (id, workspace_id) VALUES ('post-1', 'workspace-1');
		INSERT INTO publications (id, workspace_id) VALUES ('publication-1', 'workspace-1');
		INSERT INTO social_accounts (id, workspace_id, platform) VALUES
			('account-1', 'workspace-1', 'youtube'),
			('account-other', 'workspace-other', 'youtube');
		INSERT INTO media_attachments (id, workspace_id) VALUES
			('media-1', 'workspace-1'),
			('media-other', 'workspace-other');
		INSERT INTO renditions (id, publication_id, social_account_id, platform) VALUES
			('rendition-1', 'publication-1', 'account-1', 'youtube');
		INSERT INTO rendition_media (rendition_id, media_id) VALUES ('rendition-1', 'media-1');
	`)
	require.NoError(t, err)
}

func applyProviderMediaDeliveryMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	content, err := migrationFiles.ReadFile("074_rendition_media_deliveries.sql")
	require.NoError(t, err)
	item := migration{
		version: 74,
		name:    "074_rendition_media_deliveries.sql",
		sql:     normalizeMigrationSQL(db.Dialect().Name(), string(content)),
	}
	require.NoError(t, runMigration(t.Context(), db, item))
}

func assertProviderMediaDeliveryMigration(t *testing.T, db *bun.DB, populated bool) {
	t.Helper()
	ctx := t.Context()
	var oldTableCount int
	if db.Dialect().Name() == dialect.SQLite {
		require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("sqlite_master").
			Where("type = 'table' AND name = ?", "provider_media_states").Scan(ctx, &oldTableCount))
	} else {
		require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("information_schema.tables").
			Where("table_schema = current_schema()").
			Where("table_name = ?", "provider_media_states").Scan(ctx, &oldTableCount))
	}
	require.Zero(t, oldTableCount)

	var postCount, renditionCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("post_media_deliveries").Scan(ctx, &postCount))
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("rendition_media_deliveries").Scan(ctx, &renditionCount))
	if !populated {
		require.Zero(t, postCount)
		require.Zero(t, renditionCount)
		return
	}
	require.Equal(t, 1, postCount)
	require.Equal(t, 1, renditionCount, "the corrupt cross-workspace row must not migrate")

	var providerMediaID string
	require.NoError(t, db.NewSelect().Column("provider_media_id").TableExpr("rendition_media_deliveries").
		Where("rendition_id = ? AND media_id = ?", "rendition-1", "media-1").Scan(ctx, &providerMediaID))
	require.Equal(t, "video-1", providerMediaID)

	_, err := db.ExecContext(ctx, `UPDATE rendition_media_deliveries
		SET social_account_id = ? WHERE rendition_id = ? AND media_id = ?`,
		"account-other", "rendition-1", "media-1")
	require.Error(t, err, "the database must reject a delivery assigned to another account/workspace")

	_, err = db.ExecContext(ctx, `INSERT INTO rendition_media_delivery_relations (
		workspace_id, rendition_id, delivery_media_id, role, related_media_id
	) VALUES (?, ?, ?, ?, ?)`, "workspace-1", "rendition-1", "media-1", "thumbnail", "media-other")
	require.Error(t, err, "the database must reject related media from another workspace")
	_, err = db.ExecContext(ctx, `INSERT INTO rendition_media_delivery_relations (
		workspace_id, rendition_id, delivery_media_id, role, related_media_id
	) VALUES (?, ?, ?, ?, ?)`, "workspace-1", "rendition-1", "media-1", "thumbnail", "media-1")
	require.NoError(t, err)
}
