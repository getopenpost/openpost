package migrations

import (
	"bytes"
	"compress/gzip"
	"context"
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

func gzipMigrationSnapshot(t *testing.T, value string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	_, err := writer.Write([]byte(value))
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return buffer.Bytes()
}
