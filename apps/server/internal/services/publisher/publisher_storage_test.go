package publisher

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
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

func TestUploadRenditionMediaToPlatformReadsFromBlobStorage(t *testing.T) {
	storage := &fakePublisherStorage{body: "stored-media"}
	adapter := &fakePublisherAdapter{}
	service := NewService(nil, nil)
	service.SetStorage(storage)

	got, err := service.uploadRenditionMediaToPlatform(
		context.Background(),
		&models.SocialAccount{Platform: "x", AccountID: "acct-1"},
		adapter,
		"token",
		&models.Rendition{Body: "Launch\nDescription", Profile: models.ContentProfileShortText, SettingsJSON: "{}"},
		models.MediaAttachment{FilePath: "media/example.png", MimeType: "image/png"},
	)

	require.NoError(t, err)
	require.Equal(t, "platform-media-id", got)
	require.Equal(t, []string{"example.png"}, storage.opened)
	require.Equal(t, "stored-media", adapter.uploadedBody)
}

type rangedPublisherStorage struct {
	*fakePublisherStorage
	content []byte
	offsets []int64
}

func (s *rangedPublisherStorage) OpenRange(_ context.Context, _ string, offset int64) (io.ReadCloser, error) {
	s.offsets = append(s.offsets, offset)
	return io.NopCloser(bytes.NewReader(s.content[offset:])), nil
}

func TestPeerTubeResumableUploadReadsStoredMedia(t *testing.T) {
	const chunkSize = 8 * 1024 * 1024
	media := bytes.Repeat([]byte("v"), chunkSize+1)
	storage := &rangedPublisherStorage{fakePublisherStorage: &fakePublisherStorage{}, content: media}
	var uploaded []byte
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/video-channels/demos", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":3,"name":"demos"}`))
	})
	mux.HandleFunc("/api/v1/videos/upload-resumable", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			w.Header().Set("Location", "/api/v1/videos/upload-resumable?upload_id=abc")
			w.WriteHeader(http.StatusCreated)
		case http.MethodPut:
			chunk, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "read upload chunk", http.StatusBadRequest)
				return
			}
			uploaded = append(uploaded, chunk...)
			if len(uploaded) < len(media) {
				w.Header().Set("Range", "bytes=0-"+strconv.Itoa(len(uploaded)-1))
				w.WriteHeader(308)
				return
			}
			_, _ = w.Write([]byte(`{"video":{"uuid":"video-1"}}`))
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	service := NewService(nil, nil)
	service.SetStorage(storage)
	got, err := service.uploadRenditionMediaResumable(
		context.Background(),
		&models.SocialAccount{AccountID: "demos"},
		platform.NewPeerTubeAdapter(server.URL),
		"token",
		&models.Rendition{Title: "Launch demo", SettingsJSON: `{"privacy":"public"}`},
		models.MediaAttachment{FilePath: "media/video.mp4", OriginalFilename: "video.mp4", MimeType: "video/mp4", Size: int64(len(media))},
		platform.ResumableMediaUploadState{},
		func(platform.ResumableMediaUploadState) error { return nil },
	)
	require.NoError(t, err)
	require.Equal(t, "video-1", got)
	require.Equal(t, media, uploaded)
	require.Equal(t, []int64{0, chunkSize}, storage.offsets)
}
