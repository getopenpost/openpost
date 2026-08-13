package migrations

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestDesignRevisionMediaReferencesBackfillProtectsSnapshotMedia(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-1", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "workspace-2", Name: "Other workspace"}).Exec(ctx)
	require.NoError(t, err)
	media := []models.MediaAttachment{
		{ID: "media-cover", WorkspaceID: "workspace-1", FilePath: "cover.webp", MimeType: "image/webp", FileHash: "cover"},
		{ID: "media-layer", WorkspaceID: "workspace-1", FilePath: "layer.webp", MimeType: "image/webp", FileHash: "layer"},
		{ID: "media-font", WorkspaceID: "workspace-1", FilePath: "font.woff2", MimeType: "font/woff2", FileHash: "font"},
		{ID: "media-cross-workspace", WorkspaceID: "workspace-2", FilePath: "other.webp", MimeType: "image/webp", FileHash: "other"},
	}
	_, err = db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DesignDocument{
		ID: "design-1", WorkspaceID: "workspace-1", CreatedByID: "user-1",
		Title: "Design", WidthPX: 1080, HeightPX: 1080,
	}).Exec(ctx)
	require.NoError(t, err)
	snapshot := gzipMigrationSnapshot(t, `{
		"snapshot_version": 1,
		"cover_preview_media_id": "media-cover",
		"document": {"pages": [{"layers": [
			{"image": {"media_id": "media-layer"}},
			{"text": {"font_asset_id": "media-font"}},
			{"image": {"media_id": "media-cross-workspace"}}
		]}]}
	}`)
	_, err = db.NewInsert().Model(&models.DesignRevision{
		ID: "revision-1", DesignDocumentID: "design-1", Revision: 1,
		Kind: "checkpoint", Snapshot: snapshot, CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DesignRevision{
		ID: "revision-2", DesignDocumentID: "design-1", Revision: 2,
		Kind: "checkpoint", Snapshot: gzipMigrationSnapshot(t, `{"snapshot_version":1,"document":{"pages":[]}}`),
		CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DesignRevision{
		ID: "revision-3", DesignDocumentID: "design-1", Revision: 3,
		Kind: "checkpoint", Snapshot: []byte("not a gzip snapshot"),
		CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	batch, err := backfillDesignRevisionMediaReferencesBatch(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, 1, batch.Processed)
	require.Equal(t, 1, batch.RejectedMedia)
	stateCount, err := db.NewSelect().Model((*models.DesignRevisionMediaIndexState)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, stateCount, "the first bounded batch is a durable resume point")
	stats, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, designRevisionMediaBackfillStats{Processed: 2, Batches: 2, Failed: 1}, stats)
	secondStartup, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, designRevisionMediaBackfillStats{}, secondStartup)
	stateCount, err = db.NewSelect().Model((*models.DesignRevisionMediaIndexState)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 3, stateCount, "zero-media and corrupt revisions receive processed markers")
	var invalidState models.DesignRevisionMediaIndexState
	require.NoError(t, db.NewSelect().Model(&invalidState).
		Where("revision_id = ?", "revision-3").Scan(ctx))
	require.Equal(t, "invalid", invalidState.Status)
	require.Equal(t, "invalid_compression", invalidState.FailureCode)
	var indexedState models.DesignRevisionMediaIndexState
	require.NoError(t, db.NewSelect().Model(&indexedState).
		Where("revision_id = ?", "revision-1").Scan(ctx))
	require.Equal(t, 1, indexedState.MissingMediaCount)
	var refs []models.DesignRevisionMediaReference
	require.NoError(t, db.NewSelect().Model(&refs).OrderExpr("media_id ASC").Scan(ctx))
	require.Equal(t, []string{"media-cover", "media-font", "media-layer"}, []string{
		refs[0].MediaID,
		refs[1].MediaID,
		refs[2].MediaID,
	})
	for _, ref := range refs {
		require.NotEqual(t, "media-cross-workspace", ref.MediaID)
	}
	_, err = db.NewDelete().Model((*models.MediaAttachment)(nil)).
		Where("id = ?", "media-layer").Exec(ctx)
	require.Error(t, err)

	_, err = db.NewDelete().Model((*models.DesignRevision)(nil)).
		Where("id = ?", "revision-1").Exec(ctx)
	require.NoError(t, err)
	count, err := db.NewSelect().Model((*models.DesignRevisionMediaReference)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	_, err = db.NewDelete().Model((*models.MediaAttachment)(nil)).
		Where("id = ?", "media-layer").Exec(ctx)
	require.NoError(t, err)
}

func TestDesignRevisionMediaBackfillAcceptsLiveMaximumSnapshotRange(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "large-workspace", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID: "large-media", WorkspaceID: "large-workspace", FilePath: "large.webp",
		MimeType: "image/webp", FileHash: "large-media-hash",
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DesignDocument{
		ID: "large-design", WorkspaceID: "large-workspace", CreatedByID: "user-1",
		Title: "Large", WidthPX: 1080, HeightPX: 1080,
	}).Exec(ctx)
	require.NoError(t, err)
	largeSnapshot := `{"media_id":"large-media","padding":"` + strings.Repeat("x", (6<<20)+1) + `"}`
	_, err = db.NewInsert().Model(&models.DesignRevision{
		ID: "large-revision", DesignDocumentID: "large-design", Revision: 1,
		Kind: "checkpoint", Snapshot: gzipMigrationSnapshot(t, largeSnapshot),
		CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	batch, err := backfillDesignRevisionMediaReferencesBatch(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, 1, batch.Processed)
	require.Zero(t, batch.Failed)
	count, err := db.NewSelect().Model((*models.DesignRevisionMediaReference)(nil)).
		Where("revision_id = ? AND media_id = ?", "large-revision", "large-media").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestDesignRevisionMediaBackfillChunksHighCardinalitySnapshots(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "many-workspace", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	const mediaCount = 1_205
	media := make([]models.MediaAttachment, 0, mediaCount)
	var snapshot strings.Builder
	snapshot.WriteString(`{"items":[`)
	for index := range mediaCount {
		mediaID := fmt.Sprintf("many-media-%04d", index)
		media = append(media, models.MediaAttachment{
			ID: mediaID, WorkspaceID: "many-workspace", FilePath: mediaID,
			MimeType: "image/webp", FileHash: "hash-" + mediaID,
		})
		if index > 0 {
			snapshot.WriteByte(',')
		}
		snapshot.WriteString(`{"media_id":"` + mediaID + `"}`)
	}
	snapshot.WriteString(`]}`)
	for start := 0; start < len(media); start += 100 {
		end := min(start+100, len(media))
		chunk := media[start:end]
		_, err = db.NewInsert().Model(&chunk).Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.DesignDocument{
		ID: "many-design", WorkspaceID: "many-workspace", CreatedByID: "user-1",
		Title: "Many", WidthPX: 1080, HeightPX: 1080,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DesignRevision{
		ID: "many-revision", DesignDocumentID: "many-design", Revision: 1,
		Kind: "checkpoint", Snapshot: gzipMigrationSnapshot(t, snapshot.String()),
		CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	batch, err := backfillDesignRevisionMediaReferencesBatch(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, 1, batch.Processed)
	require.Zero(t, batch.RejectedMedia)
	count, err := db.NewSelect().Model((*models.DesignRevisionMediaReference)(nil)).
		Where("revision_id = ?", "many-revision").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, mediaCount, count)
}

func TestDesignRevisionMediaBackfillDefersAndResumesWithoutRescanningOneStartup(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "bounded-workspace", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.DesignDocument{
		ID: "bounded-design", WorkspaceID: "bounded-workspace", CreatedByID: "user-1",
		Title: "Bounded", WidthPX: 1080, HeightPX: 1080,
	}).Exec(ctx)
	require.NoError(t, err)
	revisions := make([]models.DesignRevision, 0, revisionMediaBackfillMaxBatchesPerStartup+1)
	for index := 0; index <= revisionMediaBackfillMaxBatchesPerStartup; index++ {
		revisions = append(revisions, models.DesignRevision{
			ID: fmt.Sprintf("bounded-revision-%02d", index), DesignDocumentID: "bounded-design",
			Revision: index + 1, Kind: "checkpoint",
			Snapshot:    gzipMigrationSnapshot(t, `{"pages":[]}`),
			CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
		})
	}
	_, err = db.NewInsert().Model(&revisions).Exec(ctx)
	require.NoError(t, err)

	firstStartup, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, revisionMediaBackfillMaxBatchesPerStartup, firstStartup.Processed)
	require.Equal(t, revisionMediaBackfillMaxBatchesPerStartup, firstStartup.Batches)
	require.True(t, firstStartup.Deferred)
	secondStartup, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, 1, secondStartup.Processed)
	require.Equal(t, 1, secondStartup.Batches)
	require.False(t, secondStartup.Deferred)
	constantStartup, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, designRevisionMediaBackfillStats{}, constantStartup)
}

func TestDesignRevisionMediaReferencePreparationSkipsPartialStudioSchema(t *testing.T) {
	t.Parallel()
	db := newPostVariantsTestDB(t)
	ctx := context.Background()
	require.NoError(t, ensureDesignRevisionMediaReferenceSchema(ctx, db))
	exists, err := migrationTableExists(ctx, db, "design_revision_media_references")
	require.NoError(t, err)
	require.False(t, exists)
	designStats, err := backfillDesignRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, designRevisionMediaBackfillStats{}, designStats)
	videoStats, err := backfillVideoRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, videoRevisionMediaBackfillStats{}, videoStats)
}

func TestMigration82PreparationCreatesRevisionMediaOwnershipSchema(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	for _, model := range []interface{}{
		(*models.DesignDocument)(nil),
		(*models.DesignRevision)(nil),
		(*models.VideoProject)(nil),
		(*models.VideoProjectAsset)(nil),
		(*models.VideoProjectRevision)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}

	item := migration{
		version: 82,
		name:    "082_design_revision_media_references.sql",
		sql:     "SELECT 1;",
	}
	require.NoError(t, prepareMigration(ctx, db, item))

	for _, table := range []string{
		"design_revision_media_references",
		"design_revision_media_index_state",
		"video_revision_media_index_state",
	} {
		exists, err := migrationTableExists(ctx, db, table)
		require.NoError(t, err)
		require.True(t, exists, "%s must exist before migration SQL and finalization", table)
	}
}

func gzipMigrationSnapshot(t *testing.T, value string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	_, err := writer.Write([]byte(value))
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return buffer.Bytes()
}
