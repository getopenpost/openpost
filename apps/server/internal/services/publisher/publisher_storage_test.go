package publisher

import (
	"context"
	"io"
	"strings"
	"testing"

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
func (f *fakePublisherStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (f *fakePublisherStorage) Delete(context.Context, string) error { return nil }
func (f *fakePublisherStorage) GetURL(id string) string {
	if f.publicURL == "" {
		return ""
	}
	return strings.TrimRight(f.publicURL, "/") + "/" + id
}
func (f *fakePublisherStorage) Open(_ context.Context, id string) (io.ReadCloser, error) {
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
	uploadErrors    []error
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
	if f.uploadCalls <= len(f.uploadErrors) && f.uploadErrors[f.uploadCalls-1] != nil {
		return "", f.uploadErrors[f.uploadCalls-1]
	}
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

type capturingDirectPublisher struct {
	platform.Publisher
	media []platform.UploadMediaRequest
}

func (c *capturingDirectPublisher) PublishWithMedia(_ context.Context, _, _ string, _ *platform.PublishRequest, media []platform.UploadMediaRequest) (platform.PublishResult, error) {
	c.media = media
	return platform.PublishResult{}, nil
}

func TestPublishProviderPassesVideoSizeToDirectMediaPublisher(t *testing.T) {
	t.Parallel()
	provider := &capturingDirectPublisher{}
	service := &Service{storage: &fakePublisherStorage{body: "fixture-video"}}

	_, err := service.publishProvider(t.Context(), provider, "token", "account", &platform.PublishRequest{}, []models.MediaAttachment{{
		FilePath: "media/video.mp4", OriginalFilename: "video.mp4", MimeType: "video/mp4", Size: 13,
		Width: 1080, Height: 1920, DurationMS: 46863,
	}})

	require.NoError(t, err)
	require.Len(t, provider.media, 1)
	require.Equal(t, 1080, provider.media[0].Width)
	require.Equal(t, 1920, provider.media[0].Height)
	require.Equal(t, int64(46863), provider.media[0].DurationMS)
}
