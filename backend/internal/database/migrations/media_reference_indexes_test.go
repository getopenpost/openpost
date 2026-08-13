package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
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

const postMediaProtectionPlanSQL = `
	WITH candidate_media(media_id) AS (
		VALUES ('media-00001'), ('media-00002'), ('media-00003'), ('media-00004'), ('media-00005')
	), batch_scope(workspace_id) AS (VALUES ('workspace-1'))
	SELECT post_media.media_id
	FROM post_media
	JOIN posts post ON post.id = post_media.post_id
	JOIN candidate_media candidate ON candidate.media_id = post_media.media_id
	WHERE post.workspace_id = (SELECT workspace_id FROM batch_scope)
	  AND post.status NOT IN ('published', 'failed')`

func TestMediaReferenceIndexesMigrationSQLite(t *testing.T) {
	for _, populated := range []bool{false, true} {
		name := "fresh"
		if populated {
			name = "populated"
		}
		t.Run(name, func(t *testing.T) {
			sqlDB, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			db := bun.NewDB(sqlDB, sqlitedialect.New())
			t.Cleanup(func() { require.NoError(t, db.Close()) })

			createMediaReferenceIndexFixtures(t, db, populated)
			if populated {
				preMigrationPlan := explainSQLiteQueryPlan(t, db, postMediaProtectionPlanSQL)
				require.NotContains(t, preMigrationPlan, "post_media_media_idx")
			}
			applyMediaReferenceIndexesMigration(t, db)
			assertMediaReferenceIndex(t, db)

			if populated {
				postMigrationPlan := explainSQLiteQueryPlan(t, db, postMediaProtectionPlanSQL)
				require.Contains(t, postMigrationPlan, "USING INDEX post_media_media_idx (media_id=?)")
				assertPostMediaFixturesPreserved(t, db)
			}
		})
	}
}

func TestMediaReferenceIndexesMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	for _, populated := range []bool{false, true} {
		name := "fresh"
		if populated {
			name = "populated"
		}
		t.Run(name, func(t *testing.T) {
			schema := fmt.Sprintf("media_reference_indexes_078_%d", time.Now().UnixNano())
			_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
			require.NoError(t, err)
			t.Cleanup(func() {
				_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
				require.NoError(t, cleanupErr)
			})
			_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
			require.NoError(t, err)

			createMediaReferenceIndexFixtures(t, db, populated)
			if populated {
				preMigrationPlan := explainPostgresQueryPlan(t, db, postMediaProtectionPlanSQL)
				require.NotContains(t, preMigrationPlan, "post_media_media_idx")
			}
			applyMediaReferenceIndexesMigration(t, db)
			assertMediaReferenceIndex(t, db)

			if populated {
				postMigrationPlan := explainPostgresQueryPlan(t, db, postMediaProtectionPlanSQL)
				require.Contains(t, postMigrationPlan, "post_media_media_idx")
				assertPostMediaFixturesPreserved(t, db)
			}
		})
	}
}

func createMediaReferenceIndexFixtures(t *testing.T, db *bun.DB, populated bool) {
	t.Helper()
	ctx := t.Context()
	_, err := db.ExecContext(ctx, `
		CREATE TABLE schema_migrations (version BIGINT PRIMARY KEY, applied_at BIGINT NOT NULL);
		CREATE TABLE posts (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			status TEXT NOT NULL
		);
		CREATE TABLE post_media (
			post_id TEXT NOT NULL,
			media_id TEXT NOT NULL,
			display_order INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (post_id, media_id)
		);
	`)
	require.NoError(t, err)
	if !populated {
		return
	}

	switch db.Dialect().Name() {
	case dialect.SQLite:
		_, err = db.ExecContext(ctx, `
			WITH RECURSIVE sequence(value) AS (
				VALUES (1)
				UNION ALL
				SELECT value + 1 FROM sequence WHERE value < 50000
			)
			INSERT INTO posts (id, workspace_id, status)
			SELECT printf('post-%05d', value),
			       CASE WHEN value <= 25000 THEN 'workspace-1' ELSE 'workspace-2' END,
			       'draft'
			FROM sequence;
			INSERT INTO post_media (post_id, media_id, display_order)
			SELECT id, replace(id, 'post-', 'media-'), 0 FROM posts;
			ANALYZE;
		`)
	case dialect.PG:
		_, err = db.ExecContext(ctx, `
			INSERT INTO posts (id, workspace_id, status)
			SELECT 'post-' || lpad(value::text, 5, '0'),
			       CASE WHEN value <= 25000 THEN 'workspace-1' ELSE 'workspace-2' END,
			       'draft'
			FROM generate_series(1, 50000) AS sequence(value);
			INSERT INTO post_media (post_id, media_id, display_order)
			SELECT id, replace(id, 'post-', 'media-'), 0 FROM posts;
			ANALYZE posts;
			ANALYZE post_media;
		`)
	default:
		t.Fatalf("unsupported database dialect %s", db.Dialect().Name())
	}
	require.NoError(t, err)
}

func applyMediaReferenceIndexesMigration(t *testing.T, db *bun.DB) {
	t.Helper()
	raw, err := migrationFiles.ReadFile("078_media_reference_indexes.sql")
	require.NoError(t, err)
	item := migration{
		version: 78,
		name:    "078_media_reference_indexes.sql",
		sql:     normalizeMigrationSQL(db.Dialect().Name(), string(raw)),
	}
	require.NoError(t, runMigration(t.Context(), db, item))
	_, err = db.ExecContext(t.Context(), "ANALYZE post_media")
	require.NoError(t, err)
}

func assertMediaReferenceIndex(t *testing.T, db *bun.DB) {
	t.Helper()
	var count int
	switch db.Dialect().Name() {
	case dialect.SQLite:
		require.NoError(t, db.NewSelect().
			ColumnExpr("COUNT(*)").
			TableExpr("sqlite_master").
			Where("type = 'index' AND name = 'post_media_media_idx'").
			Scan(t.Context(), &count))
	case dialect.PG:
		require.NoError(t, db.NewSelect().
			ColumnExpr("COUNT(*)").
			TableExpr("pg_indexes").
			Where("schemaname = current_schema() AND indexname = 'post_media_media_idx'").
			Scan(t.Context(), &count))
	default:
		t.Fatalf("unsupported database dialect %s", db.Dialect().Name())
	}
	require.Equal(t, 1, count)
}

func explainSQLiteQueryPlan(t *testing.T, db *bun.DB, query string) string {
	t.Helper()
	type planRow struct {
		ID      int    `bun:"id"`
		Parent  int    `bun:"parent"`
		NotUsed int    `bun:"notused"`
		Detail  string `bun:"detail"`
	}
	var rows []planRow
	require.NoError(t, db.NewRaw("EXPLAIN QUERY PLAN "+query).Scan(t.Context(), &rows))
	details := make([]string, 0, len(rows))
	for _, row := range rows {
		details = append(details, row.Detail)
	}
	return strings.Join(details, "\n")
}

func explainPostgresQueryPlan(t *testing.T, db *bun.DB, query string) string {
	t.Helper()
	var rows []string
	require.NoError(t, db.NewRaw("EXPLAIN (COSTS OFF) "+query).Scan(t.Context(), &rows))
	return strings.Join(rows, "\n")
}

func assertPostMediaFixturesPreserved(t *testing.T, db *bun.DB) {
	t.Helper()
	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("post_media").Scan(t.Context(), &count))
	require.Equal(t, 50000, count)
}
