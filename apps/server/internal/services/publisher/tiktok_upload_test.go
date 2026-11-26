package publisher

import (
	"context"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

type fakeTikTokMetadataUploader struct {
	fakePublisherAdapter
	metadataCalls int
	publishID     string
}

func (f *fakeTikTokMetadataUploader) UploadMediaWithMetadata(_ context.Context, _, _ string, _ platform.UploadMediaRequest) (string, error) {
	f.metadataCalls++
	if f.publishID != "" {
		return f.publishID, nil
	}
	return "v_inbox_file~v2.42", nil
}

func TestPublisherCachesTikTokVideoFileUploadAcrossRetriesAndReconciliation(t *testing.T) {
	t.Parallel()

	adapter := &fakeTikTokMetadataUploader{publishID: "v_inbox_file~v2.42"}
	srv := newPublisherMediaStateTestServer(t, "tiktok", adapter)
	srv.service.publicMediaURL = "https://media.example/media"

	media := models.MediaAttachment{
		ID: "video-1", WorkspaceID: "ws-1", FilePath: "uploads/video-1.mp4",
		MimeType: "video/mp4", Size: int64(len(srv.storage.body)), ProcessingStatus: "ready",
	}
	publication, rendition, account := srv.seedRenditionWithMedia(t, "pub-tt-video", "rend-tt-video", media)
	account.Platform = "tiktok"
	rendition.Platform = "tiktok"
	rendition.Profile = models.ContentProfileShortVideo
	rendition.SettingsJSON = `{"content_posting_method":"UPLOAD"}`
	_, err := srv.db.NewUpdate().Model(&rendition).Column("platform", "profile", "settings_json").WherePK().Exec(t.Context())
	require.NoError(t, err)

	firstID, err := srv.service.platformMediaIDForRendition(t.Context(), &publication, &rendition, &account, adapter, "access-token", media)
	require.NoError(t, err)
	require.Equal(t, "v_inbox_file~v2.42", firstID)
	require.Equal(t, 1, adapter.metadataCalls)

	// Subsequent retry or reconciliation wake-up must reuse the persisted
	// publish_id instead of uploading the video to TikTok inbox again.
	secondID, err := srv.service.platformMediaIDForRendition(t.Context(), &publication, &rendition, &account, adapter, "access-token", media)
	require.NoError(t, err)
	require.Equal(t, "v_inbox_file~v2.42", secondID)
	require.Equal(t, 1, adapter.metadataCalls)
}

func TestPublisherUsesPublicMediaURLForTikTokPhotoUploadMode(t *testing.T) {
	t.Parallel()

	adapter := &fakeTikTokMetadataUploader{}
	srv := newPublisherMediaStateTestServer(t, "tiktok", adapter)
	srv.service.publicMediaURL = "https://media.example/media"

	media := models.MediaAttachment{
		ID: "photo-1", WorkspaceID: "ws-1", FilePath: "uploads/photo-1.jpg",
		MimeType: "image/jpeg", Size: int64(len(srv.storage.body)), ProcessingStatus: "ready",
	}
	publication, rendition, account := srv.seedRenditionWithMedia(t, "pub-tt-photo", "rend-tt-photo", media)
	account.Platform = "tiktok"
	rendition.Platform = "tiktok"
	rendition.Profile = models.ContentProfileCarousel
	rendition.SettingsJSON = `{"content_posting_method":"UPLOAD"}`
	_, err := srv.db.NewUpdate().Model(&rendition).Column("platform", "profile", "settings_json").WherePK().Exec(t.Context())
	require.NoError(t, err)

	mediaURL, err := srv.service.platformMediaIDForRendition(t.Context(), &publication, &rendition, &account, adapter, "access-token", media)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(mediaURL, "https://media.example/media/photo-1.jpg"), "expected public media URL, got %q", mediaURL)
	require.Equal(t, 0, adapter.metadataCalls, "TikTok photo UPLOAD mode uses PULL_FROM_URL and must not call FILE_UPLOAD")
}
