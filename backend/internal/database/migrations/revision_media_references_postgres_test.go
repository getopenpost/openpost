package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestRevisionMediaReferencesMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	ctx := context.Background()
	adminSQLDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	adminDB := bun.NewDB(adminSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, adminDB.Close()) })
	require.NoError(t, adminDB.PingContext(ctx))

	schema := fmt.Sprintf("revision_media_082_%d", time.Now().UnixNano())
	_, err := adminDB.ExecContext(ctx, `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := adminDB.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})

	scopedSQLDB := sql.OpenDB(pgdriver.NewConnector(
		pgdriver.WithDSN(dsn),
		pgdriver.WithConnParams(map[string]any{"search_path": schema}),
	))
	scopedSQLDB.SetMaxOpenConns(1)
	db := bun.NewDB(scopedSQLDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(ctx))

	for _, statement := range []string{
		`CREATE TABLE workspaces (id TEXT PRIMARY KEY)`,
		`CREATE TABLE media_attachments (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE design_documents (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE design_revisions (
			id TEXT PRIMARY KEY,
			design_document_id TEXT NOT NULL REFERENCES design_documents(id) ON DELETE CASCADE,
			snapshot BYTEA NOT NULL
		)`,
		`CREATE TABLE video_projects (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE video_project_assets (
			video_project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
			source_id TEXT NOT NULL,
			media_id TEXT NOT NULL REFERENCES media_attachments(id) ON DELETE RESTRICT,
			usage TEXT NOT NULL DEFAULT 'source',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (video_project_id, source_id)
		)`,
		`CREATE TABLE video_project_revisions (
			id TEXT PRIMARY KEY,
			video_project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
			snapshot BYTEA NOT NULL
		)`,
	} {
		_, err := db.ExecContext(ctx, statement)
		require.NoError(t, err)
	}

	item := migration{version: 82, name: "082_design_revision_media_references.sql", sql: "SELECT 1;"}
	require.NoError(t, prepareMigration(ctx, db, item))
	for _, table := range []string{
		"design_revision_media_references",
		"design_revision_media_index_state",
		"video_revision_media_index_state",
	} {
		exists, err := migrationTableExists(ctx, db, table)
		require.NoError(t, err)
		require.True(t, exists)
	}
	revisionColumnPresent, err := migrationColumnExists(ctx, db, "video_project_assets", "revision_id")
	require.NoError(t, err)
	require.True(t, revisionColumnPresent)

	_, err = db.ExecContext(ctx, `INSERT INTO workspaces (id) VALUES ('workspace-1')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO media_attachments (id, workspace_id)
		VALUES ('design-media', 'workspace-1'), ('video-media', 'workspace-1')
	`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO design_documents (id, workspace_id) VALUES ('design-1', 'workspace-1')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO design_revisions (id, design_document_id, snapshot) VALUES (?, ?, ?)`,
		"design-revision-1", "design-1", gzipMigrationSnapshot(t, `{"media_id":"design-media"}`))
	require.NoError(t, err)
	const highCardinalityMediaCount = 605
	var mediaInsert strings.Builder
	mediaInsert.WriteString(`INSERT INTO media_attachments (id, workspace_id) VALUES `)
	mediaArgs := make([]any, 0, highCardinalityMediaCount*2)
	var highCardinalitySnapshot strings.Builder
	highCardinalitySnapshot.WriteString(`{"items":[`)
	for index := range highCardinalityMediaCount {
		if index > 0 {
			mediaInsert.WriteByte(',')
			highCardinalitySnapshot.WriteByte(',')
		}
		mediaInsert.WriteString(`(?, ?)`)
		mediaID := fmt.Sprintf("pg-many-media-%04d", index)
		mediaArgs = append(mediaArgs, mediaID, "workspace-1")
		highCardinalitySnapshot.WriteString(`{"media_id":"` + mediaID + `"}`)
	}
	mediaInsert.WriteByte(';')
	highCardinalitySnapshot.WriteString(`]}`)
	_, err = db.ExecContext(ctx, mediaInsert.String(), mediaArgs...)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO design_revisions (id, design_document_id, snapshot) VALUES (?, ?, ?)`,
		"design-revision-many", "design-1", gzipMigrationSnapshot(t, highCardinalitySnapshot.String()))
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO video_projects (id, workspace_id) VALUES ('video-1', 'workspace-1')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO video_project_revisions (id, video_project_id, snapshot) VALUES (?, ?, ?)`,
		"video-revision-1", "video-1", gzipMigrationSnapshot(t, `{"document":{"sources":{"source":{"locator":{"media_id":"video-media"}}}}}`))
	require.NoError(t, err)

	designStats, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, designRevisionMediaBackfillStats{Processed: 2, Batches: 2}, designStats)
	videoStats, err := backfillVideoRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, videoRevisionMediaBackfillStats{Processed: 1, Batches: 1}, videoStats)

	var designReferenceCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").
		TableExpr("design_revision_media_references").Scan(ctx, &designReferenceCount))
	require.Equal(t, highCardinalityMediaCount+1, designReferenceCount)
	var videoReferenceCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").
		TableExpr("video_project_assets").
		Where("usage = ?", "revision:video-revision-1").Scan(ctx, &videoReferenceCount))
	require.Equal(t, 1, videoReferenceCount)

	secondDesignStartup, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, designRevisionMediaBackfillStats{}, secondDesignStartup)
	secondVideoStartup, err := backfillVideoRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, videoRevisionMediaBackfillStats{}, secondVideoStartup)

	_, err = db.ExecContext(ctx, `DELETE FROM media_attachments WHERE id = 'design-media'`)
	require.Error(t, err)
	_, err = db.ExecContext(ctx, `DELETE FROM media_attachments WHERE id = 'video-media'`)
	require.Error(t, err)
	_, err = db.ExecContext(ctx, `DELETE FROM video_project_revisions WHERE id = 'video-revision-1'`)
	require.NoError(t, err)
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").
		TableExpr("video_project_assets").Scan(ctx, &videoReferenceCount))
	require.Zero(t, videoReferenceCount, "revision deletion must cascade historical video media pins")
	_, err = db.ExecContext(ctx, `DELETE FROM media_attachments WHERE id = 'video-media'`)
	require.NoError(t, err)
}
