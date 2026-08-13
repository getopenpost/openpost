package publisher

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

type fakePublisherStorage struct {
	opened    []string
	body      string
	bodies    map[string]string
	publicURL string
}

func (f *fakePublisherStorage) Driver() string { return "s3" }
func (f *fakePublisherStorage) Save(string, io.Reader) (string, error) {
	return "", nil
}
func (f *fakePublisherStorage) Delete(string) error { return nil }
func (f *fakePublisherStorage) GetURL(id string) string {
	if f.publicURL == "" {
		return ""
	}
	return strings.TrimRight(f.publicURL, "/") + "/" + id
}
func (f *fakePublisherStorage) Open(id string) (io.ReadCloser, error) {
	f.opened = append(f.opened, id)
	body := f.body
	if f.bodies != nil {
		body = f.bodies[id]
	}
	return io.NopCloser(strings.NewReader(body)), nil
}

type fakePublisherAdapter struct {
	uploadedBody    string
	uploadCalls     int
	uploadErr       error
	publishCalls    int
	publishErr      error
	publishErrors   []error
	preFenceErrors  []error
	externalID      string
	externalIDs     []string
	lastRequest     *platform.PublishRequest
	publishRequests []*platform.PublishRequest
}

func (f *fakePublisherAdapter) GenerateAuthURL(string) (string, map[string]string) {
	return "", nil
}
func (f *fakePublisherAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	return nil, nil
}
func (f *fakePublisherAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{}
}
func (f *fakePublisherAdapter) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return nil, nil
}
func (f *fakePublisherAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, nil
}
func (f *fakePublisherAdapter) UploadMedia(_ context.Context, _, _, _ string, reader io.Reader) (string, error) {
	f.uploadCalls++
	body, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	f.uploadedBody = string(body)
	if f.uploadErr != nil {
		return "", f.uploadErr
	}
	return "platform-media-id", nil
}
func (f *fakePublisherAdapter) Publish(_ context.Context, _, _ string, req *platform.PublishRequest) (platform.PublishResult, error) {
	callIndex := f.publishCalls
	f.publishCalls++
	if callIndex < len(f.preFenceErrors) && f.preFenceErrors[callIndex] != nil {
		return platform.PublishResult{}, f.preFenceErrors[callIndex]
	}
	if err := req.BeginWrite(platform.PublishResult{ProviderState: "fake_publish", RetrySafety: platform.PublishRetryNever}); err != nil {
		return platform.PublishResult{}, err
	}
	f.lastRequest = req
	requestCopy := *req
	f.publishRequests = append(f.publishRequests, &requestCopy)
	if callIndex < len(f.publishErrors) && f.publishErrors[callIndex] != nil {
		return platform.PublishResult{}, f.publishErrors[callIndex]
	}
	if f.publishErr != nil {
		return platform.PublishResult{}, f.publishErr
	}
	if callIndex < len(f.externalIDs) && f.externalIDs[callIndex] != "" {
		result := platform.AcceptedPublishResult(f.externalIDs[callIndex])
		return result, req.Checkpoint(result)
	}
	if f.externalID != "" {
		result := platform.AcceptedPublishResult(f.externalID)
		return result, req.Checkpoint(result)
	}
	result := platform.AcceptedPublishResult("external-post-id")
	return result, req.Checkpoint(result)
}

type fakeMetadataPublisherAdapter struct {
	fakePublisherAdapter
	uploadReq             platform.UploadMediaRequest
	uploadedThumbnailBody string
}

func (f *fakeMetadataPublisherAdapter) UploadMediaWithMetadata(_ context.Context, _, _ string, req platform.UploadMediaRequest) (string, error) {
	f.uploadCalls++
	body, err := io.ReadAll(req.Reader)
	if err != nil {
		return "", err
	}
	f.uploadedBody = string(body)
	if req.ThumbnailReader != nil {
		thumbnailBody, err := io.ReadAll(req.ThumbnailReader)
		if err != nil {
			return "", err
		}
		f.uploadedThumbnailBody = string(thumbnailBody)
	}
	req.Reader = nil
	req.ThumbnailReader = nil
	f.uploadReq = req
	return "metadata-media-id", nil
}

var errFakePublishFailed = errors.New("publish failed")

func TestUploadMediaToPlatformReadsFromBlobStorage(t *testing.T) {
	storage := &fakePublisherStorage{body: "stored-media"}
	adapter := &fakePublisherAdapter{}
	service := NewService(nil, nil)
	service.SetStorage(storage)

	got, err := service.uploadMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "x", AccountID: "acct-1"},
		adapter,
		"token",
		models.MediaAttachment{FilePath: "media/example.png", MimeType: "image/png"},
		"Launch\nDescription",
	)

	require.NoError(t, err)
	require.Equal(t, "platform-media-id", got)
	require.Equal(t, []string{"example.png"}, storage.opened)
	require.Equal(t, "stored-media", adapter.uploadedBody)
}

func TestUploadMediaToPlatformUsesPublicURLForTikTok(t *testing.T) {
	storage := &fakePublisherStorage{body: "stored-media"}
	adapter := &fakePublisherAdapter{}
	service := NewService(nil, nil)
	service.SetStorage(storage)
	service.SetPublicMediaURL("https://media.openpost.test/media")

	got, err := service.uploadMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "tiktok", AccountID: "acct-1"},
		adapter,
		"token",
		models.MediaAttachment{ID: "media-1", FilePath: "media/example.mp4", MimeType: "video/mp4"},
		"Launch video",
	)

	require.NoError(t, err)
	require.Equal(t, "https://media.openpost.test/media/media-1.mp4", got)
	require.Empty(t, storage.opened)
	require.Empty(t, adapter.uploadedBody)
}

func TestUploadMediaToPlatformUsesStoragePublicURLWhenMediaBaseIsRelative(t *testing.T) {
	storage := &fakePublisherStorage{publicURL: "https://cdn.openpost.test"}
	service := NewService(nil, nil)
	service.SetStorage(storage)

	got, err := service.uploadMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "threads", AccountID: "acct-1"},
		&fakePublisherAdapter{},
		"token",
		models.MediaAttachment{ID: "media-1", FilePath: "media/image.jpg", MimeType: "image/jpeg"},
		"Launch image",
	)

	require.NoError(t, err)
	require.Equal(t, "https://cdn.openpost.test/media/image.jpg", got)
	require.Empty(t, storage.opened)
}

func TestUploadRenditionMediaToPlatformUsesTikTokFileUploadForUploadMode(t *testing.T) {
	storage := &fakePublisherStorage{body: "stored-video"}
	adapter := &fakeMetadataPublisherAdapter{}
	service := NewService(nil, nil)
	service.SetStorage(storage)
	service.SetPublicMediaURL("https://media.openpost.test/media")

	got, err := service.uploadRenditionMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "tiktok", AccountID: "creator-1"},
		adapter,
		"token",
		&models.Rendition{
			Title:        "Upload title",
			Body:         "Upload body",
			SettingsJSON: `{"content_posting_method":"UPLOAD"}`,
		},
		models.MediaAttachment{ID: "media-1", FilePath: "media/example.mp4", MimeType: "video/mp4", Size: 12, OriginalFilename: "example.mp4"},
	)

	require.NoError(t, err)
	require.Equal(t, "metadata-media-id", got)
	require.Equal(t, []string{"example.mp4"}, storage.opened)
	require.Equal(t, "stored-video", adapter.uploadedBody)
	require.Equal(t, "UPLOAD", adapter.uploadReq.Settings["content_posting_method"])
}

func TestUploadMediaToPlatformUsesPublicURLForFacebook(t *testing.T) {
	storage := &fakePublisherStorage{body: "stored-media"}
	adapter := &fakePublisherAdapter{}
	service := NewService(nil, nil)
	service.SetStorage(storage)
	service.SetPublicMediaURL("https://media.openpost.test/media")

	got, err := service.uploadMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "facebook", AccountID: "acct-1"},
		adapter,
		"token",
		models.MediaAttachment{ID: "media-1", FilePath: "media/example.jpg", MimeType: "image/jpeg"},
		"Launch image",
	)

	require.NoError(t, err)
	require.Equal(t, "https://media.openpost.test/media/media-1.jpg", got)
	require.Empty(t, storage.opened)
	require.Empty(t, adapter.uploadedBody)
}

func TestUploadMediaToPlatformUsesPublicURLForInstagram(t *testing.T) {
	storage := &fakePublisherStorage{body: "stored-media"}
	adapter := &fakePublisherAdapter{}
	service := NewService(nil, nil)
	service.SetStorage(storage)
	service.SetPublicMediaURL("https://media.openpost.test/media")

	got, err := service.uploadMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "instagram", AccountID: "acct-1"},
		adapter,
		"token",
		models.MediaAttachment{ID: "media-1", FilePath: "media/example.jpg", MimeType: "image/jpeg"},
		"Launch image",
	)

	require.NoError(t, err)
	require.Equal(t, "https://media.openpost.test/media/media-1.jpg", got)
	require.Empty(t, storage.opened)
	require.Empty(t, adapter.uploadedBody)
}

func TestUploadMediaToPlatformUsesMetadataUploader(t *testing.T) {
	storage := &fakePublisherStorage{body: "stored-video"}
	adapter := &fakeMetadataPublisherAdapter{}
	service := NewService(nil, nil)
	service.SetStorage(storage)

	got, err := service.uploadMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "youtube", AccountID: "channel-1"},
		adapter,
		"token",
		models.MediaAttachment{ID: "media-1", FilePath: "media/example.mp4", MimeType: "video/mp4", OriginalFilename: "example.mp4"},
		"Launch title\nLonger description",
	)

	require.NoError(t, err)
	require.Equal(t, "metadata-media-id", got)
	require.Equal(t, []string{"example.mp4"}, storage.opened)
	require.Equal(t, "stored-video", adapter.uploadedBody)
	require.Equal(t, "video/mp4", adapter.uploadReq.MimeType)
	require.Equal(t, "example.mp4", adapter.uploadReq.Filename)
	require.Equal(t, "Launch title", adapter.uploadReq.Title)
	require.Equal(t, "Launch title\nLonger description", adapter.uploadReq.Description)
}

func TestUploadRenditionMediaToPlatformAddsThumbnailMedia(t *testing.T) {
	db, err := database.InitDBWithDriver("sqlite", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=private")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	require.NoError(t, database.CreateSchema(db))

	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID:               "thumb-1",
		WorkspaceID:      "ws-1",
		FilePath:         "media/cover.jpg",
		MimeType:         "image/jpeg",
		Size:             11,
		OriginalFilename: "cover.jpg",
	}).Exec(context.Background())
	require.NoError(t, err)

	storage := &fakePublisherStorage{bodies: map[string]string{
		"example.mp4": "stored-video",
		"cover.jpg":   "cover-bytes",
	}}
	adapter := &fakeMetadataPublisherAdapter{}
	service := NewService(db, nil)
	service.SetStorage(storage)

	got, err := service.uploadRenditionMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "youtube", AccountID: "channel-1"},
		adapter,
		"token",
		&models.Rendition{
			Title:        "Launch title",
			Body:         "Launch body",
			SettingsJSON: `{"thumbnail_media_id":"thumb-1"}`,
		},
		models.MediaAttachment{ID: "media-1", FilePath: "media/example.mp4", MimeType: "video/mp4", Size: 12, OriginalFilename: "example.mp4"},
	)

	require.NoError(t, err)
	require.Equal(t, "metadata-media-id", got)
	require.Equal(t, []string{"example.mp4", "cover.jpg"}, storage.opened)
	require.Equal(t, "stored-video", adapter.uploadedBody)
	require.Equal(t, "cover-bytes", adapter.uploadedThumbnailBody)
	require.Equal(t, "thumb-1", adapter.uploadReq.Settings["thumbnail_media_id"])
	require.Equal(t, "image/jpeg", adapter.uploadReq.ThumbnailMimeType)
	require.Equal(t, "cover.jpg", adapter.uploadReq.ThumbnailFilename)
	require.Equal(t, int64(11), adapter.uploadReq.ThumbnailSize)
}
