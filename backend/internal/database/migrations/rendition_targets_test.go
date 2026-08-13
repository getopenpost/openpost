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

func TestRenditionTargetsMigrationSQLite(t *testing.T) {
	sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	exerciseRenditionTargetsMigration(t, db)
}

func TestRenditionTargetsMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))
	schema := fmt.Sprintf("rendition_targets_088_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	exerciseRenditionTargetsMigration(t, db)
}

func exerciseRenditionTargetsMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	ctx := t.Context()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL);
		CREATE TABLE social_accounts (id TEXT PRIMARY KEY, instance_url TEXT NOT NULL DEFAULT '');
		CREATE TABLE renditions (
			id TEXT PRIMARY KEY,
			publication_id TEXT NOT NULL,
			social_account_id TEXT NOT NULL,
			platform TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'draft'
		);
		CREATE UNIQUE INDEX renditions_publication_account_idx
			ON renditions (publication_id, social_account_id);
		INSERT INTO social_accounts (id, instance_url)
		VALUES ('mastodon-account', 'https://social.example'), ('pinterest-account', '');
		INSERT INTO renditions (id, publication_id, social_account_id, platform)
		VALUES
			('mastodon-rendition', 'publication-1', 'mastodon-account', 'mastodon'),
			('pinterest-rendition', 'publication-1', 'pinterest-account', 'pinterest');
	`)
	require.NoError(t, err)

	raw, err := migrationFiles.ReadFile("088_rendition_targets.sql")
	require.NoError(t, err)
	item := migration{version: 88, name: "088_rendition_targets.sql", sql: normalizeMigrationSQL(db.Dialect().Name(), string(raw))}
	require.NoError(t, runMigration(ctx, db, item))

	var keys []string
	require.NoError(t, db.NewSelect().Table("renditions").Column("target_key").Order("id ASC").Scan(ctx, &keys))
	require.Equal(t, []string{"mastodon:https://social.example", "pinterest"}, keys)

	_, err = db.ExecContext(ctx, `INSERT INTO renditions
		(id, publication_id, social_account_id, platform, target_key)
		VALUES ('board-1', 'publication-1', 'pinterest-account', 'pinterest', 'pinterest:board:1')`)
	require.NoError(t, err, "one account may own multiple explicit targets")
	_, err = db.ExecContext(ctx, `INSERT INTO renditions
		(id, publication_id, social_account_id, platform, target_key)
		VALUES ('board-duplicate', 'publication-1', 'pinterest-account', 'pinterest', 'pinterest:board:1')`)
	require.Error(t, err, "the same target may appear only once per publication and account")
}
