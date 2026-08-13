package medialifecycle

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/database/migrations"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type lifecycleQueryCounter struct {
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *lifecycleQueryCounter) BeforeQuery(ctx context.Context, _ *bun.QueryEvent) context.Context {
	if counter.enabled.Load() {
		counter.count.Add(1)
	}
	return ctx
}

func (*lifecycleQueryCounter) AfterQuery(context.Context, *bun.QueryEvent) {}

type blockingLifecycleStorage struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
	deletes atomic.Int64
}

func newBlockingLifecycleStorage() *blockingLifecycleStorage {
	return &blockingLifecycleStorage{started: make(chan struct{}), release: make(chan struct{})}
}

func (*blockingLifecycleStorage) Driver() string { return "test" }

func (*blockingLifecycleStorage) Save(string, io.Reader) (string, error) {
	return "", errors.New("unexpected save")
}

func (storage *blockingLifecycleStorage) Delete(string) error {
	storage.deletes.Add(1)
	storage.once.Do(func() { close(storage.started) })
	<-storage.release
	return nil
}

func (*blockingLifecycleStorage) GetURL(string) string { return "" }

func (*blockingLifecycleStorage) Open(string) (io.ReadCloser, error) {
	return nil, errors.New("unexpected open")
}

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
		_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, file_path, retention_class, created_at, last_used_at) VALUES (?, 'workspace-1', ?, ?, ?, ?)", media.id, media.id, media.retention, now, now)
		require.NoError(t, err)
	}
	_, err := db.Exec("INSERT INTO media_tag_assignments (tag_id, media_id) VALUES ('tag-1', 'tagged')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO media_tags (id, workspace_id) VALUES ('tag-1', 'workspace-1')")
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
	_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, file_path, retention_class, created_at) VALUES ('media-1', 'workspace-1', 'media-1', 'library', ?)", time.Now().UTC())
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

func TestManualTrashAllowsFailedPublicationReferences(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	service := NewService(db, nil)
	_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, file_path, retention_class, created_at) VALUES ('media-1', 'workspace-1', 'media-1', 'library', ?)", time.Now().UTC())
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO posts (id, workspace_id, status) VALUES ('post-1', 'workspace-1', 'failed')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO post_media (post_id, media_id) VALUES ('post-1', 'media-1')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO post_variants (id, post_id, media_ids) VALUES ('variant-1', 'post-1', '[\"media-1\"]')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publications (id, workspace_id, status) VALUES ('publication-1', 'workspace-1', 'failed')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publication_segments (id, publication_id) VALUES ('segment-1', 'publication-1')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publication_segment_media (segment_id, media_id) VALUES ('segment-1', 'media-1')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO renditions (id, publication_id, status) VALUES ('rendition-1', 'publication-1', 'ready')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO rendition_media (rendition_id, media_id) VALUES ('rendition-1', 'media-1')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO rendition_segments (id, rendition_id) VALUES ('rendition-segment-1', 'rendition-1')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO rendition_segment_media (rendition_segment_id, media_id) VALUES ('rendition-segment-1', 'media-1')")
	require.NoError(t, err)

	trashed, err := service.TrashManual(context.Background(), "media-1", "workspace-1")
	require.NoError(t, err)
	require.True(t, trashed)
}

func TestManualTrashAllowsTaggedLibraryMedia(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	service := NewService(db, nil)
	_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, file_path, retention_class, created_at) VALUES ('media-1', 'workspace-1', 'media-1', 'library', ?)", time.Now().UTC())
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO media_tag_assignments (tag_id, media_id) VALUES ('tag-1', 'media-1')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO media_tags (id, workspace_id) VALUES ('tag-1', 'workspace-1')")
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
	_, err := db.Exec("INSERT INTO media_attachments (id, workspace_id, file_path, retention_class, created_at) VALUES ('media-1', 'workspace-1', 'media-1', 'library', ?)", now)
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

func TestSweepUsesFixedFourteenDayIdleAndSevenDayTrashPolicy(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	for _, media := range []struct {
		id       string
		lastUsed time.Time
	}{
		{id: "eligible-at-fourteen-days", lastUsed: now.Add(-TemporaryIdleAge)},
		{id: "not-yet-fourteen-days", lastUsed: now.Add(-TemporaryIdleAge + time.Second)},
	} {
		_, err := db.Exec(
			"INSERT INTO media_attachments (id, workspace_id, file_path, retention_class, created_at, last_used_at) VALUES (?, 'workspace-1', ?, ?, ?, ?)",
			media.id, media.id, RetentionTemporary, media.lastUsed, media.lastUsed,
		)
		require.NoError(t, err)
	}
	_, err := db.Exec(
		"INSERT INTO media_attachments (id, workspace_id, file_path, retention_class, created_at, trashed_at, purge_after) VALUES ('purge-at-seven-days', 'workspace-1', 'purge-at-seven-days', ?, ?, ?, ?)",
		RetentionLibrary, now.Add(-TrashRetentionAge), now.Add(-TrashRetentionAge), now,
	)
	require.NoError(t, err)

	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-1", now))

	var eligible, recent models.MediaAttachment
	require.NoError(t, db.NewSelect().Model(&eligible).Where("id = ?", "eligible-at-fourteen-days").Scan(t.Context()))
	require.NoError(t, db.NewSelect().Model(&recent).Where("id = ?", "not-yet-fourteen-days").Scan(t.Context()))
	require.False(t, eligible.TrashedAt.IsZero())
	require.WithinDuration(t, now.Add(TrashRetentionAge), eligible.PurgeAfter, time.Second)
	require.True(t, recent.TrashedAt.IsZero())

	count, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", "purge-at-seven-days").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestSweepProtectsEveryBatchReferenceClass(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	now := time.Now().UTC()
	protected := []string{
		"favorite", "tagged", "collection", "brand-font", "design-reference", "design-revision-reference", "design-cover",
		"design-page-preview", "design-page-export", "template-reference", "template-preview",
		"video-reference", "video-cover", "parent-reference", "post-media", "post-variant",
		"thread-root", "thread-variant", "publication-asset", "segment-media",
		"segment-settings", "segment-media-settings", "rendition-media", "rendition-settings",
		"rendition-segment-media", "rendition-segment-settings", "rendition-segment-media-settings",
		"delivery-relation",
	}
	for _, id := range append(append([]string{}, protected...), "unreferenced") {
		insertLifecycleMedia(t, db, id, RetentionTemporary, now.Add(-TemporaryIdleAge-time.Hour), time.Time{}, time.Time{})
	}
	insertLifecycleMedia(t, db, "lineage-child", RetentionLibrary, now, time.Time{}, time.Time{})
	_, err := db.Exec("UPDATE media_attachments SET parent_media_id = 'parent-reference' WHERE id = 'lineage-child'")
	require.NoError(t, err)
	_, err = db.Exec("UPDATE media_attachments SET is_favorite = TRUE WHERE id = 'favorite'")
	require.NoError(t, err)
	insertLifecycleMedia(t, db, "trashed-active", RetentionLibrary, now.Add(-30*24*time.Hour), now.Add(-8*24*time.Hour), now.Add(-time.Hour))

	statements := []string{
		`INSERT INTO media_tags (id, workspace_id) VALUES ('tag-1', 'workspace-1')`,
		`INSERT INTO media_tag_assignments (tag_id, media_id) VALUES ('tag-1', 'tagged')`,
		`INSERT INTO media_collections (id, workspace_id) VALUES ('collection-1', 'workspace-1')`,
		`INSERT INTO media_collection_items (collection_id, media_id) VALUES ('collection-1', 'collection')`,
		`INSERT INTO brand_kits (id, workspace_id) VALUES ('brand-1', 'workspace-1')`,
		`INSERT INTO brand_fonts (brand_kit_id, media_id) VALUES ('brand-1', 'brand-font')`,
		`INSERT INTO design_documents (id, workspace_id, cover_preview_media_id) VALUES ('design-1', 'workspace-1', 'design-cover')`,
		`INSERT INTO design_media_references (design_document_id, media_id) VALUES ('design-1', 'design-reference')`,
		`INSERT INTO design_revisions (id, design_document_id) VALUES ('design-revision-1', 'design-1')`,
		`INSERT INTO design_revision_media_references (revision_id, media_id) VALUES ('design-revision-1', 'design-revision-reference')`,
		`INSERT INTO design_revision_media_index_state (revision_id) VALUES ('design-revision-1')`,
		`INSERT INTO design_pages (design_document_id, preview_media_id, latest_export_media_id) VALUES ('design-1', 'design-page-preview', 'design-page-export')`,
		`INSERT INTO design_templates (id, workspace_id, preview_media_id) VALUES ('template-1', 'workspace-1', 'template-preview')`,
		`INSERT INTO design_template_media_references (design_template_id, media_id) VALUES ('template-1', 'template-reference')`,
		`INSERT INTO video_projects (id, workspace_id, cover_preview_media_id) VALUES ('video-1', 'workspace-1', 'video-cover')`,
		`INSERT INTO video_project_assets (video_project_id, media_id) VALUES ('video-1', 'video-reference')`,
		`INSERT INTO posts (id, workspace_id, status) VALUES ('post-1', 'workspace-1', 'draft')`,
		`INSERT INTO post_media (post_id, media_id) VALUES ('post-1', 'post-media')`,
		`INSERT INTO post_media (post_id, media_id) VALUES ('post-1', 'trashed-active')`,
		`INSERT INTO post_variants (id, post_id, media_ids) VALUES ('variant-1', 'post-1', '["post-variant"]')`,
		`INSERT INTO thread_drafts (post_id, draft_json) VALUES ('post-1', '__openpost_thread__:{"p":[{"m":["thread-root"]}],"v":{"account":{"post":{"mediaIds":["thread-variant"]}}}}')`,
		`INSERT INTO publications (id, workspace_id, status) VALUES ('publication-1', 'workspace-1', 'draft')`,
		`INSERT INTO publication_assets (publication_id, media_id) VALUES ('publication-1', 'publication-asset')`,
		`INSERT INTO publication_segments (id, publication_id, settings_json) VALUES ('segment-1', 'publication-1', '{"cover_media_id":"segment-settings"}')`,
		`INSERT INTO publication_segment_media (segment_id, media_id, settings_json) VALUES ('segment-1', 'segment-media', '{"thumbnail_media_id":"segment-media-settings"}')`,
		`INSERT INTO renditions (id, publication_id, status, settings_json) VALUES ('rendition-1', 'publication-1', 'draft', '{"cover_media_id":"rendition-settings"}')`,
		`INSERT INTO rendition_media (rendition_id, media_id) VALUES ('rendition-1', 'rendition-media')`,
		`INSERT INTO rendition_segments (id, rendition_id, settings_json) VALUES ('rendition-segment-1', 'rendition-1', '{"caption_media_id":"rendition-segment-settings"}')`,
		`INSERT INTO rendition_segment_media (rendition_segment_id, media_id, settings_json) VALUES ('rendition-segment-1', 'rendition-segment-media', '{"cover_media_id":"rendition-segment-media-settings"}')`,
		`INSERT INTO rendition_media_deliveries (workspace_id, publication_id, rendition_id, media_id) VALUES ('workspace-1', 'publication-1', 'rendition-1', 'rendition-media')`,
		`INSERT INTO rendition_media_delivery_relations (workspace_id, rendition_id, delivery_media_id, related_media_id) VALUES ('workspace-1', 'rendition-1', 'rendition-media', 'delivery-relation')`,
	}
	for _, statement := range statements {
		_, err = db.Exec(statement)
		require.NoError(t, err, statement)
	}

	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-1", now))

	for _, id := range protected {
		var media models.MediaAttachment
		require.NoError(t, db.NewSelect().Model(&media).Where("id = ?", id).Scan(t.Context()), id)
		require.True(t, media.TrashedAt.IsZero(), "%s must remain protected", id)
	}
	var unreferenced, trashedActive models.MediaAttachment
	require.NoError(t, db.NewSelect().Model(&unreferenced).Where("id = ?", "unreferenced").Scan(t.Context()))
	require.False(t, unreferenced.TrashedAt.IsZero())
	require.NoError(t, db.NewSelect().Model(&trashedActive).Where("id = ?", "trashed-active").Scan(t.Context()))
	require.False(t, trashedActive.TrashedAt.IsZero(), "an active reference must block a due purge")
}

func TestSweepReleasesSoftDeletedEditorOwnershipBeforePurge(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	now := time.Now().UTC()
	for _, mediaID := range []string{"deleted-design", "deleted-video", "active-design"} {
		insertLifecycleMedia(
			t,
			db,
			mediaID,
			RetentionLibrary,
			now.Add(-30*24*time.Hour),
			now.Add(-8*24*time.Hour),
			now.Add(-time.Hour),
		)
	}

	statements := []string{
		`INSERT INTO design_documents (id, workspace_id, deleted_at) VALUES ('deleted-design-document', 'workspace-1', current_timestamp)`,
		`INSERT INTO design_revisions (id, design_document_id, kind) VALUES ('deleted-design-revision', 'deleted-design-document', 'checkpoint')`,
		`INSERT INTO design_revision_media_references (revision_id, media_id) VALUES ('deleted-design-revision', 'deleted-design')`,
		`INSERT INTO design_revision_media_index_state (revision_id) VALUES ('deleted-design-revision')`,
		`INSERT INTO design_media_references (design_document_id, media_id) VALUES ('deleted-design-document', 'deleted-design')`,
		`INSERT INTO video_projects (id, workspace_id, deleted_at) VALUES ('deleted-video-project', 'workspace-1', current_timestamp)`,
		`INSERT INTO video_project_revisions (id, video_project_id, kind) VALUES ('deleted-video-revision', 'deleted-video-project', 'checkpoint')`,
		`INSERT INTO video_project_assets (video_project_id, source_id, revision_id, media_id, usage) VALUES ('deleted-video-project', 'deleted-source', 'deleted-video-revision', 'deleted-video', 'revision:deleted-video-revision')`,
		`INSERT INTO video_revision_media_index_state (revision_id) VALUES ('deleted-video-revision')`,
		`INSERT INTO design_documents (id, workspace_id) VALUES ('active-design-document', 'workspace-1')`,
		`INSERT INTO design_revisions (id, design_document_id, kind) VALUES ('active-design-revision', 'active-design-document', 'checkpoint')`,
		`INSERT INTO design_revision_media_references (revision_id, media_id) VALUES ('active-design-revision', 'active-design')`,
		`INSERT INTO design_revision_media_index_state (revision_id) VALUES ('active-design-revision')`,
	}
	for _, statement := range statements {
		_, err := db.Exec(statement)
		require.NoError(t, err, statement)
	}

	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-1", now))

	for _, mediaID := range []string{"deleted-design", "deleted-video"} {
		count, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).
			Where("id = ?", mediaID).
			Count(t.Context())
		require.NoError(t, err)
		require.Zero(t, count, "%s must be purged after its deleted owner releases it", mediaID)
	}
	activeCount, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("id = ?", "active-design").
		Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, activeCount, "an active revision must keep its media protected")
}

func TestSweepPrunesExpiredEditorAutosavesWithoutLaterEditorWrite(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	now := time.Now().UTC()
	for _, mediaID := range []string{"expired-design-media", "expired-video-media"} {
		insertLifecycleMedia(
			t,
			db,
			mediaID,
			RetentionLibrary,
			now.Add(-30*24*time.Hour),
			now.Add(-8*24*time.Hour),
			now.Add(-time.Hour),
		)
	}

	statements := []string{
		`INSERT INTO design_documents (id, workspace_id) VALUES ('expiring-design', 'workspace-1')`,
		`INSERT INTO design_revisions (id, design_document_id, kind, expires_at) VALUES ('expired-design-revision', 'expiring-design', 'autosave', datetime('now', '-1 hour'))`,
		`INSERT INTO design_revision_media_references (revision_id, media_id) VALUES ('expired-design-revision', 'expired-design-media')`,
		`INSERT INTO design_revision_media_index_state (revision_id) VALUES ('expired-design-revision')`,
		`INSERT INTO video_projects (id, workspace_id) VALUES ('expiring-video', 'workspace-1')`,
		`INSERT INTO video_project_revisions (id, video_project_id, kind, expires_at) VALUES ('expired-video-revision', 'expiring-video', 'autosave', datetime('now', '-1 hour'))`,
		`INSERT INTO video_project_assets (video_project_id, source_id, revision_id, media_id, usage) VALUES ('expiring-video', 'expired-video-source', 'expired-video-revision', 'expired-video-media', 'revision:expired-video-revision')`,
		`INSERT INTO video_revision_media_index_state (revision_id) VALUES ('expired-video-revision')`,
	}
	for _, statement := range statements {
		_, err := db.Exec(statement)
		require.NoError(t, err, statement)
	}

	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-1", now))

	for _, tableAndID := range []struct {
		table string
		id    string
	}{
		{table: "design_revisions", id: "expired-design-revision"},
		{table: "video_project_revisions", id: "expired-video-revision"},
		{table: "media_attachments", id: "expired-design-media"},
		{table: "media_attachments", id: "expired-video-media"},
	} {
		count, err := db.NewSelect().Table(tableAndID.table).
			Where("id = ?", tableAndID.id).
			Count(t.Context())
		require.NoError(t, err)
		require.Zero(t, count, "%s %s must be removed by the lifecycle sweep", tableAndID.table, tableAndID.id)
	}
}

func TestSweepAdvancesDeferredRevisionIndexWithoutRestartAndFailsClosed(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	now := time.Now().UTC()
	insertLifecycleMedia(
		t,
		db,
		"deferred-cleanup",
		RetentionLibrary,
		now.Add(-30*24*time.Hour),
		now.Add(-8*24*time.Hour),
		now.Add(-time.Hour),
	)
	_, err := db.Exec("INSERT INTO design_documents (id, workspace_id) VALUES ('backfill-design', 'workspace-1')")
	require.NoError(t, err)
	snapshot := gzipLifecycleSnapshot(t, []byte(`{"pages":[]}`))
	for index := range 101 {
		_, err = db.Exec(
			"INSERT INTO design_revisions (id, design_document_id, kind, snapshot) VALUES (?, 'backfill-design', 'checkpoint', ?)",
			fmt.Sprintf("backfill-revision-%03d", index),
			snapshot,
		)
		require.NoError(t, err)
	}

	service := NewService(db, nil)
	err = service.Sweep(t.Context(), "workspace-1", now)
	require.ErrorContains(t, err, "editor revision media indexing is still in progress")
	markerCount, countErr := db.NewSelect().Table("design_revision_media_index_state").Count(t.Context())
	require.NoError(t, countErr)
	require.Equal(t, 100, markerCount, "one sweep must advance only one bounded backfill batch")
	mediaCount, countErr := db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("id = ?", "deferred-cleanup").
		Count(t.Context())
	require.NoError(t, countErr)
	require.Equal(t, 1, mediaCount, "cleanup must fail closed while any revision remains unindexed")

	require.NoError(t, service.Sweep(t.Context(), "workspace-1", now))
	markerCount, countErr = db.NewSelect().Table("design_revision_media_index_state").Count(t.Context())
	require.NoError(t, countErr)
	require.Equal(t, 101, markerCount, "a later in-process sweep must finish the deferred work without a restart")
	mediaCount, countErr = db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("id = ?", "deferred-cleanup").
		Count(t.Context())
	require.NoError(t, countErr)
	require.Zero(t, mediaCount, "cleanup must resume once indexing is complete")
}

func TestSweepScopesDeferredRevisionIndexToWorkspace(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	now := time.Now().UTC()
	_, err := db.Exec(
		`INSERT INTO media_attachments
		 (id, workspace_id, file_path, retention_class, created_at, last_used_at, trashed_at, purge_after)
		 VALUES ('workspace-b-cleanup', 'workspace-b', 'workspace-b-cleanup', ?, ?, ?, ?, ?)`,
		RetentionLibrary,
		now.Add(-30*24*time.Hour),
		now.Add(-30*24*time.Hour),
		now.Add(-8*24*time.Hour),
		now.Add(-time.Hour),
	)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO design_documents (id, workspace_id) VALUES
		('workspace-a-design', 'workspace-a'),
		('workspace-b-design', 'workspace-b')`)
	require.NoError(t, err)
	snapshot := gzipLifecycleSnapshot(t, []byte(`{"pages":[]}`))
	for index := range 101 {
		_, err = db.Exec(
			"INSERT INTO design_revisions (id, design_document_id, kind, snapshot) VALUES (?, 'workspace-a-design', 'checkpoint', ?)",
			fmt.Sprintf("a-revision-%03d", index),
			snapshot,
		)
		require.NoError(t, err)
	}
	_, err = db.Exec(
		"INSERT INTO design_revisions (id, design_document_id, kind, snapshot) VALUES ('z-workspace-b-revision', 'workspace-b-design', 'checkpoint', ?)",
		snapshot,
	)
	require.NoError(t, err)

	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-b", now))

	pendingA, err := migrations.WorkspaceEditorRevisionMediaBackfillPending(
		t.Context(),
		db,
		"workspace-a",
	)
	require.NoError(t, err)
	require.True(t, pendingA, "workspace A must remain pending after workspace B advances independently")
	pendingB, err := migrations.WorkspaceEditorRevisionMediaBackfillPending(
		t.Context(),
		db,
		"workspace-b",
	)
	require.NoError(t, err)
	require.False(t, pendingB)
	markerCount, err := db.NewSelect().Table("design_revision_media_index_state").Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, markerCount, "workspace B's single revision must be the only row advanced")
	mediaCount, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).
		Where("id = ?", "workspace-b-cleanup").
		Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, mediaCount, "workspace B cleanup must not wait behind workspace A's backlog")
}

func TestSweepFailsClosedOnUndecodableWorkspaceReferences(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		setup func(*testing.T, *bun.DB)
	}{
		{
			name: "post variant",
			setup: func(t *testing.T, db *bun.DB) {
				_, err := db.Exec("INSERT INTO posts (id, workspace_id, status) VALUES ('post-1', 'workspace-1', 'draft')")
				require.NoError(t, err)
				_, err = db.Exec("INSERT INTO post_variants (id, post_id, media_ids) VALUES ('variant-1', 'post-1', 'not-json')")
				require.NoError(t, err)
			},
		},
		{
			name: "thread draft",
			setup: func(t *testing.T, db *bun.DB) {
				_, err := db.Exec("INSERT INTO posts (id, workspace_id, status) VALUES ('post-1', 'workspace-1', 'draft')")
				require.NoError(t, err)
				_, err = db.Exec("INSERT INTO thread_drafts (post_id, draft_json) VALUES ('post-1', '__openpost_thread__:{bad')")
				require.NoError(t, err)
			},
		},
		{
			name: "active publication settings",
			setup: func(t *testing.T, db *bun.DB) {
				_, err := db.Exec("INSERT INTO publications (id, workspace_id, status) VALUES ('publication-1', 'workspace-1', 'draft')")
				require.NoError(t, err)
				_, err = db.Exec("INSERT INTO renditions (id, publication_id, status, settings_json) VALUES ('rendition-1', 'publication-1', 'draft', 'not-json')")
				require.NoError(t, err)
			},
		},
		{
			name: "historical publication settings",
			setup: func(t *testing.T, db *bun.DB) {
				_, err := db.Exec("INSERT INTO publications (id, workspace_id, status) VALUES ('publication-1', 'workspace-1', 'failed')")
				require.NoError(t, err)
				_, err = db.Exec("INSERT INTO renditions (id, publication_id, status, settings_json) VALUES ('rendition-1', 'publication-1', 'failed', 'not-json')")
				require.NoError(t, err)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			db := newMediaLifecycleTestDB(t)
			now := time.Now().UTC()
			insertLifecycleMedia(t, db, "candidate", RetentionTemporary, now.Add(-TemporaryIdleAge-time.Hour), time.Time{}, time.Time{})
			test.setup(t, db)

			err := NewService(db, nil).Sweep(t.Context(), "workspace-1", now)
			require.ErrorContains(t, err, "decode")

			var media models.MediaAttachment
			require.NoError(t, db.NewSelect().Model(&media).Where("id = ?", "candidate").Scan(t.Context()))
			require.True(t, media.TrashedAt.IsZero(), "the entire lifecycle transaction must roll back")
		})
	}
}

func TestSweepRewritesHistoricalJSONBeforePurge(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	now := time.Now().UTC()
	insertLifecycleMedia(t, db, "purge", RetentionLibrary, now.Add(-30*24*time.Hour), now.Add(-8*24*time.Hour), now.Add(-time.Hour))
	insertLifecycleMedia(t, db, "keep", RetentionLibrary, now, time.Time{}, time.Time{})
	draft := `__openpost_thread__:{"p":[{"m":["purge","keep"]}],"v":{"account":{"post":{"mediaIds":["purge","keep"]}}}}`
	_, err := db.Exec("INSERT INTO posts (id, workspace_id, status, content) VALUES ('post-1', 'workspace-1', 'failed', ?)", draft)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO post_variants (id, post_id, media_ids) VALUES ('variant-1', 'post-1', '[\"purge\",\"keep\"]')")
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO thread_drafts (post_id, draft_json) VALUES ('post-1', ?)", draft)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publications (id, workspace_id, status) VALUES ('publication-failed', 'workspace-1', 'failed')")
	require.NoError(t, err)
	settings := `{"cover_media_id":"purge","nested":{"thumbnail_media_id":"keep"},"privacy":"private"}`
	_, err = db.Exec("INSERT INTO publication_segments (id, publication_id, settings_json) VALUES ('segment-settings', 'publication-failed', ?)", settings)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO publication_segment_media (segment_id, media_id, settings_json) VALUES ('segment-settings', 'keep', ?)", settings)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO renditions (id, publication_id, status, settings_json) VALUES ('rendition-settings', 'publication-failed', 'failed', ?)", settings)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO rendition_segments (id, rendition_id, settings_json) VALUES ('rendition-segment-settings', 'rendition-settings', ?)", settings)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO rendition_segment_media (rendition_segment_id, media_id, settings_json) VALUES ('rendition-segment-settings', 'keep', ?)", settings)
	require.NoError(t, err)

	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-1", now))

	count, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", "purge").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)

	var variantPayload, threadPayload, legacyPayload string
	require.NoError(t, db.NewSelect().Table("post_variants").Column("media_ids").Where("id = ?", "variant-1").Scan(t.Context(), &variantPayload))
	require.NoError(t, db.NewSelect().Table("thread_drafts").Column("draft_json").Where("post_id = ?", "post-1").Scan(t.Context(), &threadPayload))
	require.NoError(t, db.NewSelect().Table("posts").Column("content").Where("id = ?", "post-1").Scan(t.Context(), &legacyPayload))
	variantIDs, err := decodeStringArray(variantPayload)
	require.NoError(t, err)
	require.Equal(t, []string{"keep"}, variantIDs)
	for _, payload := range []string{threadPayload, legacyPayload} {
		ids, decodeErr := threadDraftMediaIDs(payload)
		require.NoError(t, decodeErr)
		require.Equal(t, []string{"keep"}, ids)
		require.NotContains(t, payload, "purge")
	}
	for _, query := range []string{
		`SELECT settings_json FROM publication_segments WHERE id = 'segment-settings'`,
		`SELECT settings_json FROM publication_segment_media WHERE segment_id = 'segment-settings' AND media_id = 'keep'`,
		`SELECT settings_json FROM renditions WHERE id = 'rendition-settings'`,
		`SELECT settings_json FROM rendition_segments WHERE id = 'rendition-segment-settings'`,
		`SELECT settings_json FROM rendition_segment_media WHERE rendition_segment_id = 'rendition-segment-settings' AND media_id = 'keep'`,
	} {
		var updatedSettings string
		require.NoError(t, db.NewRaw(query).Scan(t.Context(), &updatedSettings))
		require.JSONEq(t, `{"nested":{"thumbnail_media_id":"keep"},"privacy":"private"}`, updatedSettings)
	}
}

func TestSweepCommitsBeforeDeletingSQLiteStorageObjects(t *testing.T) {
	t.Parallel()

	assertSweepCommitsBeforeDeletingStorageObjects(t, newMediaLifecycleTestDB(t))
}

func TestConcurrentSQLiteSweepsDoNotDoublePurge(t *testing.T) {
	t.Parallel()

	db := newMediaLifecycleTestDB(t)
	now := time.Now().UTC()
	insertLifecycleMedia(t, db, "due", RetentionLibrary, now.Add(-30*24*time.Hour), now.Add(-8*24*time.Hour), now.Add(-time.Hour))
	start := make(chan struct{})
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			<-start
			errs <- NewService(db, nil).Sweep(context.Background(), "workspace-1", now)
		}()
	}
	close(start)
	require.NoError(t, <-errs)
	require.NoError(t, <-errs)

	count, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", "due").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestSweepQueryBudgetDoesNotScaleWithCandidateCount(t *testing.T) {
	t.Parallel()

	trashSingle := measureSweepQueryCount(t, 1, false)
	trashVolume := measureSweepQueryCount(t, 200, false)
	purgeSingle := measureSweepQueryCount(t, 1, true)
	purgeVolume := measureSweepQueryCount(t, 200, true)
	t.Logf(
		"media lifecycle sweep used trash=%d/%d and purge=%d/%d query hooks for 1/200 candidates",
		trashSingle,
		trashVolume,
		purgeSingle,
		purgeVolume,
	)
	require.Equal(t, trashSingle, trashVolume, "trash query volume must be constant within one lifecycle batch")
	require.Equal(t, purgeSingle, purgeVolume, "purge query volume must be constant within one lifecycle batch")
	require.LessOrEqual(t, trashVolume, int64(14))
	require.LessOrEqual(t, purgeVolume, int64(22))
}

func measureSweepQueryCount(t *testing.T, candidates int, purge bool) int64 {
	t.Helper()
	db := newMediaLifecycleTestDB(t)
	counter := &lifecycleQueryCounter{}
	db.AddQueryHook(counter)
	now := time.Now().UTC()
	for index := range candidates {
		id := fmt.Sprintf("candidate-%03d", index)
		if purge {
			insertLifecycleMedia(t, db, id, RetentionLibrary, now.Add(-30*24*time.Hour), now.Add(-8*24*time.Hour), now.Add(-time.Hour))
		} else {
			insertLifecycleMedia(t, db, id, RetentionTemporary, now.Add(-TemporaryIdleAge-time.Hour), time.Time{}, time.Time{})
		}
	}

	counter.enabled.Store(true)
	require.NoError(t, NewService(db, nil).Sweep(t.Context(), "workspace-1", now))
	counter.enabled.Store(false)
	return counter.count.Load()
}

func insertLifecycleMedia(
	t *testing.T,
	db *bun.DB,
	id, retention string,
	lastUsed, trashedAt, purgeAfter time.Time,
) {
	t.Helper()
	createdAt := lastUsed
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	_, err := db.Exec(
		`INSERT INTO media_attachments
		 (id, workspace_id, file_path, retention_class, created_at, last_used_at, trashed_at, purge_after)
		 VALUES (?, 'workspace-1', ?, ?, ?, ?, ?, ?)`,
		id, id, retention, createdAt, nullableLifecycleTime(lastUsed), nullableLifecycleTime(trashedAt), nullableLifecycleTime(purgeAfter),
	)
	require.NoError(t, err)
}

func nullableLifecycleTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

func gzipLifecycleSnapshot(t *testing.T, data []byte) []byte {
	t.Helper()
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	_, err := writer.Write(data)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return compressed.Bytes()
}

func assertSweepCommitsBeforeDeletingStorageObjects(t *testing.T, db *bun.DB) {
	t.Helper()
	now := time.Now().UTC()
	insertLifecycleMedia(t, db, "due-storage", RetentionLibrary, now.Add(-30*24*time.Hour), now.Add(-8*24*time.Hour), now.Add(-time.Hour))
	storage := newBlockingLifecycleStorage()
	released := false
	defer func() {
		if !released {
			close(storage.release)
		}
	}()
	done := make(chan error, 1)
	go func() {
		done <- NewService(db, storage).Sweep(context.Background(), "workspace-1", now)
	}()
	select {
	case <-storage.started:
	case <-time.After(3 * time.Second):
		t.Fatal("storage deletion did not start")
	}

	writeCtx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	_, err := db.ExecContext(
		writeCtx,
		"INSERT INTO media_attachments (id, workspace_id, file_path, retention_class, created_at) VALUES ('db-write-after-commit', 'workspace-1', 'db-write-after-commit', ?, ?)",
		RetentionLibrary,
		now,
	)
	require.NoError(t, err, "storage deletion must not retain a database transaction or connection")
	close(storage.release)
	released = true
	require.NoError(t, <-done)
	require.Equal(t, int64(1), storage.deletes.Load())

	count, err := db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", "due-storage").Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func newMediaLifecycleTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	_, err = db.Exec("PRAGMA foreign_keys=ON")
	require.NoError(t, err)
	createMediaLifecycleTestTables(t, db)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func createMediaLifecycleTestTables(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.NewCreateTable().Model((*models.MediaAttachment)(nil)).Exec(t.Context())
	require.NoError(t, err)
	statements := []string{
		`CREATE TABLE media_tags (id TEXT PRIMARY KEY, workspace_id TEXT)`,
		`CREATE TABLE media_tag_assignments (tag_id TEXT, media_id TEXT)`,
		`CREATE TABLE media_collections (id TEXT PRIMARY KEY, workspace_id TEXT)`,
		`CREATE TABLE media_collection_items (collection_id TEXT, media_id TEXT)`,
		`CREATE TABLE brand_kits (id TEXT PRIMARY KEY, workspace_id TEXT)`,
		`CREATE TABLE brand_fonts (brand_kit_id TEXT, media_id TEXT)`,
		`CREATE TABLE design_documents (id TEXT PRIMARY KEY, workspace_id TEXT, cover_preview_media_id TEXT, deleted_at TIMESTAMP NULL)`,
		`CREATE TABLE design_media_references (
			design_document_id TEXT NOT NULL, design_page_id TEXT NOT NULL DEFAULT '',
			media_id TEXT NOT NULL, usage TEXT NOT NULL DEFAULT 'layer',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (design_document_id, design_page_id, media_id),
			FOREIGN KEY (design_document_id) REFERENCES design_documents(id) ON DELETE CASCADE,
			FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT
		)`,
		`CREATE TABLE design_revisions (
			id TEXT PRIMARY KEY, design_document_id TEXT, snapshot BLOB,
			kind TEXT NOT NULL DEFAULT 'autosave', expires_at TIMESTAMP,
			FOREIGN KEY (design_document_id) REFERENCES design_documents(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE design_revision_media_references (
			revision_id TEXT NOT NULL, media_id TEXT NOT NULL,
			usage TEXT NOT NULL DEFAULT 'snapshot',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (revision_id, media_id),
			FOREIGN KEY (revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE,
			FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT
		)`,
		`CREATE TABLE design_revision_media_index_state (
			revision_id TEXT PRIMARY KEY,
			media_count INTEGER NOT NULL DEFAULT 0,
			missing_media_count INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'complete',
			failure_code TEXT NOT NULL DEFAULT '',
			processed_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			FOREIGN KEY (revision_id) REFERENCES design_revisions(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE design_template_media_references (design_template_id TEXT, media_id TEXT)`,
		`CREATE TABLE video_projects (id TEXT PRIMARY KEY, workspace_id TEXT, cover_preview_media_id TEXT, deleted_at TIMESTAMP NULL)`,
		`CREATE TABLE video_project_revisions (
			id TEXT PRIMARY KEY, video_project_id TEXT, snapshot BLOB,
			kind TEXT NOT NULL DEFAULT 'autosave', expires_at TIMESTAMP,
			FOREIGN KEY (video_project_id) REFERENCES video_projects(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE video_project_assets (
			video_project_id TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT '', revision_id TEXT,
			media_id TEXT NOT NULL, usage TEXT NOT NULL DEFAULT 'source',
			created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			PRIMARY KEY (video_project_id, source_id),
			FOREIGN KEY (video_project_id) REFERENCES video_projects(id) ON DELETE CASCADE,
			FOREIGN KEY (revision_id) REFERENCES video_project_revisions(id) ON DELETE CASCADE,
			FOREIGN KEY (media_id) REFERENCES media_attachments(id) ON DELETE RESTRICT
		)`,
		`CREATE TABLE video_revision_media_index_state (
			revision_id TEXT PRIMARY KEY,
			media_count INTEGER NOT NULL DEFAULT 0,
			missing_media_count INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'complete',
			failure_code TEXT NOT NULL DEFAULT '',
			processed_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
			FOREIGN KEY (revision_id) REFERENCES video_project_revisions(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE design_pages (design_document_id TEXT, preview_media_id TEXT, latest_export_media_id TEXT)`,
		`CREATE TABLE design_templates (id TEXT PRIMARY KEY, workspace_id TEXT, preview_media_id TEXT)`,
		`CREATE TABLE posts (id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT, content TEXT NOT NULL DEFAULT '')`,
		`CREATE TABLE post_media (post_id TEXT, media_id TEXT)`,
		`CREATE TABLE post_variants (id TEXT, post_id TEXT, media_ids TEXT)`,
		`CREATE TABLE thread_drafts (post_id TEXT PRIMARY KEY, draft_json TEXT NOT NULL)`,
		`CREATE TABLE publications (id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT)`,
		`CREATE TABLE publication_assets (publication_id TEXT, media_id TEXT)`,
		`CREATE TABLE publication_segments (id TEXT PRIMARY KEY, publication_id TEXT, settings_json TEXT NOT NULL DEFAULT '{}')`,
		`CREATE TABLE publication_segment_media (segment_id TEXT, media_id TEXT, settings_json TEXT NOT NULL DEFAULT '{}')`,
		`CREATE TABLE renditions (id TEXT PRIMARY KEY, publication_id TEXT, status TEXT, settings_json TEXT NOT NULL DEFAULT '{}')`,
		`CREATE TABLE rendition_media (rendition_id TEXT, media_id TEXT)`,
		`CREATE TABLE rendition_segments (id TEXT PRIMARY KEY, rendition_id TEXT, settings_json TEXT NOT NULL DEFAULT '{}')`,
		`CREATE TABLE rendition_segment_media (rendition_segment_id TEXT, media_id TEXT, settings_json TEXT NOT NULL DEFAULT '{}')`,
		`CREATE TABLE rendition_media_deliveries (workspace_id TEXT, publication_id TEXT, rendition_id TEXT, media_id TEXT)`,
		`CREATE TABLE rendition_media_delivery_relations (workspace_id TEXT, rendition_id TEXT, delivery_media_id TEXT, related_media_id TEXT)`,
	}
	for _, statement := range statements {
		_, err = db.Exec(statement)
		require.NoError(t, err)
	}
}
