package medialifecycle

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestVideoProjectRetentionDeletesExpiredStateAndProtectsReferencedMedia(t *testing.T) {
	db := newVideoProjectLifecycleTestDB(t)
	now := time.Date(2026, time.September, 6, 10, 0, 0, 0, time.UTC)
	expiredAt := now.Add(-time.Minute)
	activeProjects := []models.VideoProject{
		{ID: "expired", WorkspaceID: "workspace", Name: "Expired", HeadRevision: 2, DocumentJSON: `{}`, SyncStatus: models.VideoProjectSyncSynced, CreatedByUserID: "user", UpdatedByUserID: "user", TrashedAt: now.Add(-31 * 24 * time.Hour), RetentionExpiresAt: expiredAt},
		{ID: "active", WorkspaceID: "workspace", Name: "Active", HeadRevision: 2, DocumentJSON: `{}`, SyncStatus: models.VideoProjectSyncSynced, CreatedByUserID: "user", UpdatedByUserID: "user"},
	}
	_, err := db.NewInsert().Model(&activeProjects).Exec(t.Context())
	require.NoError(t, err)

	media := []models.MediaAttachment{
		{ID: "orphan", WorkspaceID: "workspace", FilePath: "orphan.mp4", AssetKind: "project_asset"},
		{ID: "shared", WorkspaceID: "workspace", FilePath: "shared.mp4", AssetKind: "project_asset"},
		{ID: "library", WorkspaceID: "workspace", FilePath: "library.mp4", AssetKind: "library"},
	}
	_, err = db.NewInsert().Model(&media).Exec(t.Context())
	require.NoError(t, err)

	assets := []models.ProjectAsset{
		{ID: "expired-orphan", ProjectID: "expired", WorkspaceID: "workspace", MediaID: "orphan", StableMediaID: "orphan", OriginalFilename: "orphan.mp4", MimeType: "video/mp4", Size: 1, Status: models.ProjectAssetStatusReady, UploadedByUserID: "user"},
		{ID: "expired-shared", ProjectID: "expired", WorkspaceID: "workspace", MediaID: "shared", StableMediaID: "shared-expired", OriginalFilename: "shared.mp4", MimeType: "video/mp4", Size: 1, Status: models.ProjectAssetStatusReady, UploadedByUserID: "user"},
		{ID: "active-shared", ProjectID: "active", WorkspaceID: "workspace", MediaID: "shared", StableMediaID: "shared-active", OriginalFilename: "shared.mp4", MimeType: "video/mp4", Size: 1, Status: models.ProjectAssetStatusReady, UploadedByUserID: "user"},
		{ID: "expired-library", ProjectID: "expired", WorkspaceID: "workspace", MediaID: "library", StableMediaID: "library", OriginalFilename: "library.mp4", MimeType: "video/mp4", Size: 1, Status: models.ProjectAssetStatusReady, UploadedByUserID: "user"},
	}
	_, err = db.NewInsert().Model(&assets).Exec(t.Context())
	require.NoError(t, err)

	revisions := []models.VideoProjectRevision{
		{ID: "expired-project-revision", ProjectID: "expired", Revision: 2, Kind: "autosave", DocumentJSON: `{}`, TouchedTargetsJSON: `[]`, AuthorUserID: "user", ExpiresAt: expiredAt},
		{ID: "expired-active-revision", ProjectID: "active", Revision: 1, Kind: "autosave", DocumentJSON: `{}`, TouchedTargetsJSON: `[]`, AuthorUserID: "user", ExpiresAt: expiredAt},
		{ID: "retained-active-revision", ProjectID: "active", Revision: 2, Kind: "autosave", DocumentJSON: `{}`, TouchedTargetsJSON: `[]`, AuthorUserID: "user"},
	}
	_, err = db.NewInsert().Model(&revisions).Exec(t.Context())
	require.NoError(t, err)

	err = db.RunInTx(t.Context(), &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		return pruneExpiredVideoProjectState(ctx, tx, "workspace", now)
	})
	require.NoError(t, err)

	require.False(t, rowExists(t, db, (*models.VideoProject)(nil), "id = ?", "expired"))
	require.True(t, rowExists(t, db, (*models.VideoProject)(nil), "id = ?", "active"))
	require.False(t, rowExists(t, db, (*models.VideoProjectRevision)(nil), "id = ?", "expired-active-revision"))
	require.True(t, rowExists(t, db, (*models.VideoProjectRevision)(nil), "id = ?", "retained-active-revision"))
	require.False(t, rowExists(t, db, (*models.ProjectAsset)(nil), "project_id = ?", "expired"))

	requireMediaTrashState(t, db, "orphan", now, true)
	requireMediaTrashState(t, db, "shared", now, false)
	requireMediaTrashState(t, db, "library", now, false)
}

func newVideoProjectLifecycleTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file:video-project-lifecycle?mode=memory&cache=shared")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{
		(*models.MediaAttachment)(nil),
		(*models.VideoProject)(nil),
		(*models.VideoProjectRevision)(nil),
		(*models.VideoProjectMutation)(nil),
		(*models.VideoProjectConflict)(nil),
		(*models.VideoProjectCheckpoint)(nil),
		(*models.ProjectAsset)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	return db
}

func rowExists(t *testing.T, db *bun.DB, model any, query string, args ...any) bool {
	t.Helper()
	exists, err := db.NewSelect().Model(model).Where(query, args...).Exists(t.Context())
	require.NoError(t, err)
	return exists
}

func requireMediaTrashState(t *testing.T, db *bun.DB, mediaID string, now time.Time, trashed bool) {
	t.Helper()
	var media models.MediaAttachment
	require.NoError(t, db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(t.Context()))
	if !trashed {
		require.True(t, media.TrashedAt.IsZero())
		return
	}
	require.True(t, media.TrashedAt.Equal(now))
	require.True(t, media.PurgeAfter.Equal(now))
	require.Equal(t, TrashReasonExpired, media.TrashReason)
}
