package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestVideoEditorMigrationsPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	ctx := context.Background()
	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(ctx))

	schema := fmt.Sprintf("video_editor_%d", time.Now().UnixNano())
	_, err := db.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(ctx, `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)

	_, err = db.ExecContext(ctx, `
		CREATE TABLE workspaces (id TEXT PRIMARY KEY);
		CREATE TABLE users (id TEXT PRIMARY KEY);
		CREATE TABLE media_attachments (id TEXT PRIMARY KEY);
	`)
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*SchemaMigration)(nil)).Exec(ctx)
	require.NoError(t, err)

	for _, candidate := range []struct {
		version int64
		name    string
	}{
		{version: 53, name: "053_video_studio.sql"},
		{version: 54, name: "054_video_studio_hardening.sql"},
	} {
		content, readErr := migrationFiles.ReadFile(candidate.name)
		require.NoError(t, readErr)
		item := migration{
			version: candidate.version,
			name:    candidate.name,
			sql:     normalizeMigrationSQL(db.Dialect().Name(), string(content)),
		}
		require.NoError(t, prepareMigration(ctx, db, item))
		require.NoError(t, runMigration(ctx, db, item))
	}

	var tableCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("information_schema.tables").
		Where("table_schema = ?", schema).
		Where("table_name IN (?)", bun.List([]string{
			"video_projects",
			"video_project_assets",
			"video_project_revisions",
			"video_return_tokens",
			"media_provenance",
			"stock_search_cache",
		})).
		Scan(ctx, &tableCount))
	require.Equal(t, 6, tableCount)

	var projectColumnCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("information_schema.columns").
		Where("table_schema = ? AND table_name = ? AND column_name = ?", schema, "media_attachments", "video_project_id").
		Scan(ctx, &projectColumnCount))
	require.Equal(t, 1, projectColumnCount)

	var indexCount int
	require.NoError(t, db.NewSelect().
		ColumnExpr("COUNT(*)").
		TableExpr("pg_indexes").
		Where("schemaname = ?", schema).
		Where("indexname IN (?)", bun.List([]string{
			"video_projects_workspace_revision_idx",
			"video_project_revisions_project_expiry_idx",
			"video_return_tokens_project_idx",
		})).
		Scan(ctx, &indexCount))
	require.Equal(t, 3, indexCount)
}
