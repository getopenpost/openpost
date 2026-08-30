package videoprocessing

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestAnalyzeJobPersistsMetadataAndPoster(t *testing.T) {
	ctx := context.Background()
	db, err := database.InitDBWithDriver("sqlite", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))

	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	savedPath, err := storage.Save(t.Context(), "video-1.mov", strings.NewReader("source-video"))
	require.NoError(t, err)
	require.NoError(t, insertVideoFixture(ctx, db, savedPath))

	service := NewService(db, storage, mediaanalysis.FakeAnalyzer{Result: mediaanalysis.Result{
		Width:           1080,
		Height:          1920,
		DurationMS:      62_400,
		FrameRate:       29.97,
		AspectRatio:     "9:16",
		ContainerFormat: "mov",
		VideoCodec:      "hevc",
		VideoProfile:    "Main",
		AudioCodec:      "aac",
		PixelFormat:     "yuv420p",
		ColorSpace:      "bt709",
		BitRate:         4_000_000,
		AudioChannels:   2,
		PosterContent:   []byte("poster-image"),
		AnalysisStatus:  mediaanalysis.AnalysisStatusReady,
	}})

	require.NoError(t, service.EnqueueAnalysis(ctx, "video-1"))
	require.NoError(t, service.EnqueueAnalysis(ctx, "video-1"))

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeAnalyze).Scan(ctx))
	require.Len(t, jobs, 1)
	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))

	var media models.MediaAttachment
	require.NoError(t, db.NewSelect().Model(&media).Where("id = ?", "video-1").Scan(ctx))
	require.Equal(t, statusReady, media.ProcessingStatus)
	require.Equal(t, 100, media.ProcessingProgress)
	require.Equal(t, mediaanalysis.AnalysisStatusReady, media.AnalysisStatus)
	require.Equal(t, 1080, media.Width)
	require.Equal(t, 1920, media.Height)
	require.Equal(t, int64(62_400), media.DurationMS)
	require.Equal(t, "mov", media.ContainerFormat)
	require.Equal(t, "hevc", media.VideoCodec)
	require.Equal(t, "video-1.poster.jpg", media.ThumbnailObjectKey)

	poster, err := storage.Open(t.Context(), media.ThumbnailObjectKey)
	require.NoError(t, err)
	defer poster.Close()
	content, err := io.ReadAll(poster)
	require.NoError(t, err)
	require.Equal(t, []byte("poster-image"), content)
}

func insertVideoFixture(ctx context.Context, db *bun.DB, savedPath string) error {
	now := time.Now().UTC()
	if _, err := db.NewInsert().Model(&models.Organization{ID: "org-1", Name: "Video", CreatedAt: now, UpdatedAt: now}).Exec(ctx); err != nil {
		return err
	}
	if _, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", OrganizationID: "org-1", Name: "Launch"}).Exec(ctx); err != nil {
		return err
	}
	_, err := db.NewInsert().Model(&models.MediaAttachment{
		ID:                 "video-1",
		WorkspaceID:        "ws-1",
		FilePath:           savedPath,
		StorageType:        "local",
		MimeType:           "video/quicktime",
		ProcessingStatus:   statusPending,
		ProcessingProgress: 0,
		Size:               12,
		OriginalFilename:   "launch.mov",
		FileHash:           "hash",
		AnalysisStatus:     mediaanalysis.AnalysisStatusPending,
	}).Exec(ctx)
	return err
}
