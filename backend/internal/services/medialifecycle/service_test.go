package medialifecycle

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestNormalizeRetentionPromotesOrganizedMedia(t *testing.T) {
	t.Parallel()

	value, err := NormalizeRetention(RetentionTemporary, "library", true)
	require.NoError(t, err)
	require.Equal(t, RetentionLibrary, value)

	value, err = NormalizeRetention(RetentionTemporary, "design_preview", false)
	require.NoError(t, err)
	require.Equal(t, RetentionLibrary, value)
}

func TestPublishedPublicationTrashesOnlyUnprotectedTemporaryMedia(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	service := NewService(db, nil)
	now := time.Now().UTC()
	for _, media := range []struct{ id, retention string }{
		{id: "temporary", retention: RetentionTemporary},
		{id: "tagged", retention: RetentionTemporary},
		{id: "library", retention: RetentionLibrary},
	} {
		_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, retention_class, created_at, last_used_at) VALUES (?, 'workspace-1', ?, ?, ?)", media.id, media.retention, now, now)
		require.NoError(t, err)
	}
	_, err := db.Exec("INSERT INTO media_tag_assignments (tag_id, media_id) VALUES ('tag-1', 'tagged')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publications (id, workspace_id, status) VALUES ('publication-1', 'workspace-1', 'published')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publication_segments (id, publication_id) VALUES ('segment-1', 'publication-1')")
	require.NoError(t, err)
	for _, mediaID := range []string{"temporary", "tagged", "library"} {
		_, err = db.Exec("INSERT INTO publication_segment_media (segment_id, media_id) VALUES ('segment-1', ?)", mediaID)
		require.NoError(t, err)
	}

	require.NoError(t, service.TrashTemporaryForPublication(context.Background(), "publication-1"))

	var media []struct {
		ID          string    `bun:"id"`
		TrashedAt   time.Time `bun:"trashed_at"`
		TrashReason string    `bun:"trash_reason"`
	}
	require.NoError(t, db.NewSelect().Table("media_attachments").Column("id", "trashed_at", "trash_reason").Order("id").Scan(context.Background(), &media))
	states := make(map[string]struct {
		ID          string    `bun:"id"`
		TrashedAt   time.Time `bun:"trashed_at"`
		TrashReason string    `bun:"trash_reason"`
	}, len(media))
	for _, item := range media {
		states[item.ID] = item
	}
	require.False(t, states["temporary"].TrashedAt.IsZero())
	require.Equal(t, TrashReasonPublished, states["temporary"].TrashReason)
	require.True(t, states["tagged"].TrashedAt.IsZero())
	require.True(t, states["library"].TrashedAt.IsZero())
}

func TestManualTrashBlocksActivePublicationReference(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	service := NewService(db, nil)
	_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, retention_class, created_at) VALUES ('media-1', 'workspace-1', 'library', ?)", time.Now().UTC())
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publications (id, workspace_id, status) VALUES ('publication-1', 'workspace-1', 'scheduled')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publication_segments (id, publication_id) VALUES ('segment-1', 'publication-1')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publication_segment_media (segment_id, media_id) VALUES ('segment-1', 'media-1')")
	require.NoError(t, err)

	trashed, err := service.TrashManual(context.Background(), "media-1", "workspace-1")
	require.NoError(t, err)
	require.False(t, trashed)
}

func TestManualTrashAllowsTaggedLibraryMedia(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	service := NewService(db, nil)
	_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, retention_class, created_at) VALUES ('media-1', 'workspace-1', 'library', ?)", time.Now().UTC())
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO media_tag_assignments (tag_id, media_id) VALUES ('tag-1', 'media-1')")
	require.NoError(t, err)

	trashed, err := service.TrashManual(context.Background(), "media-1", "workspace-1")
	require.NoError(t, err)
	require.True(t, trashed)
}

func TestManualTrashIgnoresSoftDeletedEditorProjects(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	service := NewService(db, nil)
	now := time.Now().UTC()
	_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, retention_class, created_at) VALUES ('media-1', 'workspace-1', 'library', ?)", now)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO design_documents (id, workspace_id, cover_preview_media_id, deleted_at) VALUES ('design-1', 'workspace-1', 'media-1', ?)", now)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO design_pages (design_document_id, preview_media_id, latest_export_media_id) VALUES ('design-1', 'media-1', 'media-1')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO design_media_references (design_document_id, media_id) VALUES ('design-1', 'media-1')")
	require.NoError(t, err)

	trashed, err := service.TrashManual(context.Background(), "media-1", "workspace-1")
	require.NoError(t, err)
	require.True(t, trashed)
}

func newMediaLifecycleTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	statements := []string{
		`CREATE TABLE media_attachments (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, retention_class TEXT NOT NULL DEFAULT 'library', is_favorite BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP NOT NULL, last_used_at TIMESTAMP NULL, trashed_at TIMESTAMP NULL, purge_after TIMESTAMP NULL, trash_reason TEXT NOT NULL DEFAULT '')`,
		`CREATE TABLE media_tag_assignments (tag_id TEXT, media_id TEXT)`,
		`CREATE TABLE brand_assets (media_id TEXT)`, `CREATE TABLE brand_fonts (media_id TEXT)`,
		`CREATE TABLE design_media_references (design_document_id TEXT, media_id TEXT)`, `CREATE TABLE design_template_media_references (media_id TEXT)`,
		`CREATE TABLE video_project_assets (video_project_id TEXT, media_id TEXT)`,
		`CREATE TABLE design_documents (id TEXT PRIMARY KEY, workspace_id TEXT, cover_preview_media_id TEXT, deleted_at TIMESTAMP NULL)`,
		`CREATE TABLE design_pages (design_document_id TEXT, preview_media_id TEXT, latest_export_media_id TEXT)`,
		`CREATE TABLE design_templates (preview_media_id TEXT)`,
		`CREATE TABLE video_projects (id TEXT PRIMARY KEY, cover_preview_media_id TEXT, deleted_at TIMESTAMP NULL)`,
		`CREATE TABLE posts (id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT)`,
		`CREATE TABLE post_media (post_id TEXT, media_id TEXT)`,
		`CREATE TABLE post_variants (id TEXT, post_id TEXT, media_ids TEXT)`,
		`CREATE TABLE publications (id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT)`,
		`CREATE TABLE publication_segments (id TEXT PRIMARY KEY, publication_id TEXT)`,
		`CREATE TABLE publication_segment_media (segment_id TEXT, media_id TEXT)`,
		`CREATE TABLE renditions (id TEXT PRIMARY KEY, publication_id TEXT, status TEXT)`,
		`CREATE TABLE rendition_media (rendition_id TEXT, media_id TEXT)`,
		`CREATE TABLE rendition_segments (id TEXT PRIMARY KEY, rendition_id TEXT)`,
		`CREATE TABLE rendition_segment_media (rendition_segment_id TEXT, media_id TEXT)`,
	}
	for _, statement := range statements {
		_, err = db.Exec(statement)
		require.NoError(t, err)
	}
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}
