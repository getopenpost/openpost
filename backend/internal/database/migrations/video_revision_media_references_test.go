package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestVideoRevisionMediaReferencesBackfillProtectsHistoricalSnapshotMedia(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	require.NoError(t, runTestMigrations(t, db))
	_, err := db.NewInsert().Model(&models.Workspace{ID: "video-workspace-1", Name: "Workspace"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "video-workspace-2", Name: "Other workspace"}).Exec(ctx)
	require.NoError(t, err)
	media := []models.MediaAttachment{
		{ID: "video-media-cover", WorkspaceID: "video-workspace-1", FilePath: "cover.webp", MimeType: "image/webp", FileHash: "video-cover"},
		{ID: "video-media-source", WorkspaceID: "video-workspace-1", FilePath: "source.mp4", MimeType: "video/mp4", FileHash: "video-source"},
		{ID: "video-media-cross-workspace", WorkspaceID: "video-workspace-2", FilePath: "other.mp4", MimeType: "video/mp4", FileHash: "video-other"},
	}
	_, err = db.NewInsert().Model(&media).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.VideoProject{
		ID: "video-project-1", WorkspaceID: "video-workspace-1", CreatedByID: "user-1",
		Title: "Video", SchemaVersion: 1, Revision: 3, DocumentJSON: `{}`,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.VideoProjectRevision{
		{
			ID: "video-revision-1", VideoProjectID: "video-project-1", Revision: 1,
			Kind: "checkpoint", CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
			Snapshot: gzipMigrationSnapshot(t, `{
				"snapshot_version": 1,
				"cover_preview_media_id": "video-media-cover",
				"document": {"sources": {
					"source-1": {"locator": {"type": "openpost-media", "media_id": "video-media-source"}},
					"source-2": {"locator": {"type": "openpost-media", "media_id": "video-media-cross-workspace"}}
				}}
			}`),
		},
		{
			ID: "video-revision-2", VideoProjectID: "video-project-1", Revision: 2,
			Kind: "checkpoint", CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
			Snapshot: gzipMigrationSnapshot(t, `{"snapshot_version":1,"document":{"sources":{}}}`),
		},
		{
			ID: "video-revision-3", VideoProjectID: "video-project-1", Revision: 3,
			Kind: "checkpoint", CreatedByID: "user-1", CreatedAt: time.Now().UTC(),
			Snapshot: []byte("not a gzip snapshot"),
		},
	}).Exec(ctx)
	require.NoError(t, err)

	batch, err := backfillVideoRevisionMediaReferencesBatch(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, videoRevisionMediaBackfillBatchResult{
		Processed:     1,
		RejectedMedia: 1,
		LastID:        "video-revision-1",
	}, batch)
	stateCount, err := db.NewSelect().Model((*models.VideoRevisionMediaIndexState)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, stateCount, "the first bounded batch is a durable resume point")

	stats, err := backfillVideoRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, videoRevisionMediaBackfillStats{Processed: 2, Batches: 2, Failed: 1}, stats)
	secondStartup, err := backfillVideoRevisionMediaReferencesWithStats(ctx, db, 1)
	require.NoError(t, err)
	require.Equal(t, videoRevisionMediaBackfillStats{}, secondStartup)

	stateCount, err = db.NewSelect().Model((*models.VideoRevisionMediaIndexState)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 3, stateCount, "zero-media and corrupt revisions receive processed markers")
	var indexedState models.VideoRevisionMediaIndexState
	require.NoError(t, db.NewSelect().Model(&indexedState).
		Where("revision_id = ?", "video-revision-1").Scan(ctx))
	require.Equal(t, 2, indexedState.MediaCount)
	require.Equal(t, 1, indexedState.MissingMediaCount)
	var invalidState models.VideoRevisionMediaIndexState
	require.NoError(t, db.NewSelect().Model(&invalidState).
		Where("revision_id = ?", "video-revision-3").Scan(ctx))
	require.Equal(t, "invalid", invalidState.Status)
	require.Equal(t, "invalid_compression", invalidState.FailureCode)

	var assets []models.VideoProjectAsset
	require.NoError(t, db.NewSelect().Model(&assets).
		Where("video_project_id = ? AND usage = ?", "video-project-1", "revision:video-revision-1").
		OrderExpr("media_id ASC").Scan(ctx))
	require.Len(t, assets, 2)
	require.Equal(t, []string{"video-media-cover", "video-media-source"}, []string{
		assets[0].MediaID,
		assets[1].MediaID,
	})
	_, err = db.NewDelete().Model((*models.MediaAttachment)(nil)).
		Where("id = ?", "video-media-source").Exec(ctx)
	require.Error(t, err, "historical revision ownership must protect media from cleanup")

	_, err = db.NewDelete().Model((*models.VideoProjectRevision)(nil)).
		Where("id = ?", "video-revision-1").Exec(ctx)
	require.NoError(t, err)
	assetCount, err := db.NewSelect().Model((*models.VideoProjectAsset)(nil)).
		Where("video_project_id = ? AND usage = ?", "video-project-1", "revision:video-revision-1").Count(ctx)
	require.NoError(t, err)
	require.Zero(t, assetCount, "revision deletion must cascade its media ownership rows")
	_, err = db.NewDelete().Model((*models.MediaAttachment)(nil)).
		Where("id = ?", "video-media-source").Exec(ctx)
	require.NoError(t, err)
}
