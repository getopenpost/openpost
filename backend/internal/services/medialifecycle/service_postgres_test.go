package medialifecycle

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

func TestSweepPostgresBatchSafetyAndPostCommitStorage(t *testing.T) {
	dsn := os.Getenv("OPENPOST_TEST_POSTGRES_URL")
	if dsn == "" {
		t.Skip("OPENPOST_TEST_POSTGRES_URL is not configured")
	}

	sqlDB := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, db.PingContext(t.Context()))

	schema := fmt.Sprintf("media_lifecycle_%d", time.Now().UnixNano())
	_, err := db.ExecContext(t.Context(), `CREATE SCHEMA "`+schema+`"`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, cleanupErr := db.ExecContext(context.Background(), `DROP SCHEMA IF EXISTS "`+schema+`" CASCADE`)
		require.NoError(t, cleanupErr)
	})
	_, err = db.ExecContext(t.Context(), `SET search_path TO "`+schema+`"`)
	require.NoError(t, err)
	createMediaLifecycleTestTables(t, db)

	now := time.Now().UTC()
	insertLifecycleMedia(t, db, "protected", RetentionTemporary, now.Add(-TemporaryIdleAge-time.Hour), time.Time{}, time.Time{})
	insertLifecycleMedia(t, db, "unreferenced", RetentionTemporary, now.Add(-TemporaryIdleAge-time.Hour), time.Time{}, time.Time{})
	_, err = db.Exec("INSERT INTO posts (id, workspace_id, status) VALUES ('post-1', 'workspace-1', 'draft')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO post_variants (id, post_id, media_ids) VALUES ('variant-1', 'post-1', '[\"protected\"]')")
	require.NoError(t, err)

	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-1", now))

	var protected, unreferenced models.MediaAttachment
	require.NoError(t, db.NewSelect().Model(&protected).Where("id = ?", "protected").Scan(t.Context()))
	require.NoError(t, db.NewSelect().Model(&unreferenced).Where("id = ?", "unreferenced").Scan(t.Context()))
	require.True(t, protected.TrashedAt.IsZero())
	require.False(t, unreferenced.TrashedAt.IsZero())

	insertLifecycleMedia(t, db, "historical-purge", RetentionLibrary, now.Add(-30*24*time.Hour), now.Add(-8*24*time.Hour), now.Add(-time.Hour))
	_, err = db.Exec("INSERT INTO posts (id, workspace_id, status) VALUES ('post-failed', 'workspace-1', 'failed')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO post_variants (id, post_id, media_ids) VALUES ('variant-failed', 'post-failed', '[\"historical-purge\"]')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publications (id, workspace_id, status) VALUES ('publication-failed', 'workspace-1', 'failed')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publication_segments (id, publication_id) VALUES ('segment-failed', 'publication-failed')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publication_segment_media (segment_id, media_id, settings_json) VALUES ('segment-failed', 'protected', '{\"cover_media_id\":\"historical-purge\"}')")
	require.NoError(t, err)
	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-1", now))

	count, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", "historical-purge").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	var payload string
	require.NoError(t, db.NewSelect().Table("post_variants").Column("media_ids").Where("id = ?", "variant-failed").Scan(t.Context(), &payload))
	require.JSONEq(t, `[]`, payload)
	require.NoError(t, db.NewSelect().Table("publication_segment_media").Column("settings_json").Where("segment_id = ?", "segment-failed").Scan(t.Context(), &payload))
	require.JSONEq(t, `{}`, payload)

	assertSweepCommitsBeforeDeletingStorageObjects(t, db)
}
