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
	} {
		_, err := db.ExecContext(ctx, statement)
		require.NoError(t, err)
	}

	item := migration{version: 82, name: "082_design_revision_media_references.sql", sql: "SELECT 1;"}
	require.NoError(t, prepareMigration(ctx, db, item))
	for _, table := range []string{
		"design_revision_media_references",
		"design_revision_media_index_state",
	} {
		exists, err := migrationTableExists(ctx, db, table)
		require.NoError(t, err)
		require.True(t, exists)
	}

	_, err = db.ExecContext(ctx, `INSERT INTO workspaces (id) VALUES ('workspace-1')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
		INSERT INTO media_attachments (id, workspace_id)
		VALUES ('design-media', 'workspace-1')
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

	designStats, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, designRevisionMediaBackfillStats{Processed: 2, Batches: 2}, designStats)

	var designReferenceCount int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").
		TableExpr("design_revision_media_references").Scan(ctx, &designReferenceCount))
	require.Equal(t, highCardinalityMediaCount+1, designReferenceCount)

	secondDesignStartup, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, designRevisionMediaBackfillStats{}, secondDesignStartup)

	_, err = db.ExecContext(ctx, `DELETE FROM media_attachments WHERE id = 'design-media'`)
	require.Error(t, err)
}
