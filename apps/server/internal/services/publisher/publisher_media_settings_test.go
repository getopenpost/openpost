package publisher

import (
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/stretchr/testify/require"
)

func TestPublicationVideoCoverWithNullableMediaSettings(t *testing.T) {
	for _, tc := range []struct {
		name, settings string
		timestamp      int
	}{
		{"null_with_cover", "null", 1000},
		{"object_with_cover", "{}", 1000},
		{"null_without_cover", "null", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			adapter := &fakePublisherAdapter{}
			srv := newPublisherLifecycleTestServer(t, adapter)
			srv.service.SetStorage(&fakePublisherStorage{body: "fixture-video"})
			ctx := t.Context()
			for _, model := range []any{(*models.RenditionMediaDelivery)(nil), (*models.RenditionMediaDeliveryRelation)(nil), (*models.PublicationSegmentMedia)(nil)} {
				_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
				require.NoError(t, err)
			}
			_, err := srv.db.NewInsert().Model(&models.PublicationSegment{
				ID: "source-cover", PublicationID: "publication-1", Body: "Video", SettingsJSON: "{}",
			}).Exec(ctx)
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.RenditionSegment{
				ID: "segment-cover", RenditionID: "rendition-1", PublicationSegmentID: "source-cover",
				Body: "Video", SettingsJSON: "{}", Status: models.RenditionStatusDraft,
			}).Exec(ctx)
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.MediaAttachment{
				ID: "video-cover", WorkspaceID: "ws-1", OriginalFilename: "video.mp4", FilePath: "media/video.mp4",
				MimeType: "video/mp4", Size: 13, ProcessingStatus: "ready",
			}).Exec(ctx)
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.RenditionSegmentMedia{
				RenditionSegmentID: "segment-cover", MediaID: "video-cover", Role: "attachment",
				SettingsJSON: tc.settings, ThumbnailTimestampMS: tc.timestamp,
			}).Exec(ctx)
			require.NoError(t, err)
			_, err = srv.db.NewInsert().Model(&models.RenditionMedia{RenditionID: "rendition-1", MediaID: "video-cover", Role: "attachment"}).Exec(ctx)
			require.NoError(t, err)
			jobCtx, payload := srv.authorizedPublicationJob(t)
			var panicValue any
			var publishErr error
			func() {
				defer func() { panicValue = recover() }()
				publishErr = srv.service.HandlePublishPublicationJob(jobCtx, payload)
			}()
			var publication models.Publication
			var rendition models.Rendition
			var segment models.RenditionSegment
			require.NoError(t, srv.db.NewSelect().Model(&publication).Where("id = ?", "publication-1").Scan(ctx))
			require.NoError(t, srv.db.NewSelect().Model(&rendition).Where("id = ?", "rendition-1").Scan(ctx))
			require.NoError(t, srv.db.NewSelect().Model(&segment).Where("id = ?", "segment-cover").Scan(ctx))
			uploadEvents, err := srv.db.NewSelect().Model((*models.PublicationLifecycleEvent)(nil)).Where("type = ?", lifecycle.EventUploadStarted).Count(ctx)
			require.NoError(t, err)
			require.Nil(t, panicValue, "publishing must not panic")
			require.NoError(t, publishErr)
			require.Equal(t, models.PublicationStatusPublished, publication.Status)
			require.Equal(t, models.RenditionStatusPublished, rendition.Status)
			require.Equal(t, models.RenditionStatusPublished, segment.Status)
			require.Equal(t, 1, adapter.publishCalls)
			if tc.timestamp > 0 {
				require.Equal(t, tc.timestamp, adapter.lastRequest.MediaSettings[0]["thumbnail_timestamp_ms"])
			}
			require.EqualValues(t, 1, uploadEvents)
		})
	}
}
