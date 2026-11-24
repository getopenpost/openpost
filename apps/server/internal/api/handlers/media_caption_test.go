package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/imagecaption"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type captionerFunc func(context.Context, imagecaption.Input) (imagecaption.Result, error)

func (f captionerFunc) Caption(ctx context.Context, input imagecaption.Input) (imagecaption.Result, error) {
	return f(ctx, input)
}

type recordingCaptionStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	opens   []string
}

func (s *recordingCaptionStorage) Driver() string { return "test" }

func (s *recordingCaptionStorage) Save(_ context.Context, id string, reader io.Reader) (string, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.objects == nil {
		s.objects = make(map[string][]byte)
	}
	s.objects[id] = data
	return id, nil
}

func (s *recordingCaptionStorage) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, id)
	return nil
}

func (s *recordingCaptionStorage) GetURL(id string) string { return "/media/" + id }

func (s *recordingCaptionStorage) Open(_ context.Context, id string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.opens = append(s.opens, id)
	data, ok := s.objects[id]
	if !ok {
		return nil, errors.New("object not found")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (s *recordingCaptionStorage) openedKeys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.opens...)
}

type mediaCaptionTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	storage *recordingCaptionStorage
}

func newMediaCaptionTestServer(t *testing.T, captioner imagecaption.Captioner) *mediaCaptionTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.MediaAttachment)(nil),
	)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(t.Context())
	require.NoError(t, err)

	storage := &recordingCaptionStorage{objects: map[string][]byte{
		"md-image-1.jpg": []byte("bounded-medium-thumbnail"),
		"image-1.png":    []byte("original-image-must-not-be-opened"),
	}}
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewMediaHandler(db, storage, nil, testAuthenticator{}, nil)
	handler.RegisterImageCaptionRoutes(api, captioner)

	return &mediaCaptionTestServer{echo: e, db: db, storage: storage}
}

func (s *mediaCaptionTestServer) insertMedia(t *testing.T, media models.MediaAttachment) {
	t.Helper()
	if media.WorkspaceID == "" {
		media.WorkspaceID = "ws-1"
	}
	if media.FilePath == "" {
		media.FilePath = "image-1.png"
	}
	if media.MimeType == "" {
		media.MimeType = "image/png"
	}
	if media.ProcessingStatus == "" {
		media.ProcessingStatus = mediaReadyStatus
	}
	if media.ThumbnailsJSON == "" {
		media.ThumbnailsJSON = `{"md":"md-image-1.jpg"}`
	}
	_, err := s.db.NewInsert().Model(&media).Exec(t.Context())
	require.NoError(t, err)
}

func (s *mediaCaptionTestServer) generate(t *testing.T, mediaID, locale string, postContext ...string) *httptest.ResponseRecorder {
	t.Helper()

	body := bytes.NewBuffer(nil)
	payload := map[string]string{"locale": locale}
	if len(postContext) > 0 {
		payload["post_context"] = postContext[0]
	}
	require.NoError(t, json.NewEncoder(body).Encode(payload))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/"+mediaID+"/alt-text/generate", body)
	req.Header.Set("Authorization", "Bearer web-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestGenerateMediaAltTextMapsProviderRateLimitWithoutExposingDetails(t *testing.T) {
	t.Parallel()

	srv := newMediaCaptionTestServer(t, captionerFunc(func(_ context.Context, _ imagecaption.Input) (imagecaption.Result, error) {
		return imagecaption.Result{}, &ai.ProviderError{Provider: "openrouter", StatusCode: http.StatusTooManyRequests}
	}))
	srv.insertMedia(t, models.MediaAttachment{ID: "image-1"})

	response := srv.generate(t, "image-1", "en")
	require.Equal(t, http.StatusTooManyRequests, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), "rate limited")
	require.NotContains(t, response.Body.String(), "openrouter")
}

func TestGenerateMediaAltTextFailsClosedWhenMediumThumbnailIsMissing(t *testing.T) {
	t.Parallel()

	providerCalls := 0
	srv := newMediaCaptionTestServer(t, captionerFunc(func(_ context.Context, _ imagecaption.Input) (imagecaption.Result, error) {
		providerCalls++
		return imagecaption.Result{AltText: "Generated"}, nil
	}))
	srv.insertMedia(t, models.MediaAttachment{ID: "image-1", ThumbnailsJSON: `{}`})

	response := srv.generate(t, "image-1", "en")
	require.Equal(t, http.StatusServiceUnavailable, response.Code, response.Body.String())
	require.Contains(t, response.Body.String(), "preview is unavailable")
	require.Zero(t, providerCalls)
	require.Empty(t, srv.storage.openedKeys())
}

var _ mediastore.BlobStorage = (*recordingCaptionStorage)(nil)
