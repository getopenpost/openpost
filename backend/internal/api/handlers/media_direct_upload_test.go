package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type mediaDirectUploadTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	storage *fakeDirectUploadStorage
	usage   *usage.Service
}

type fakeDirectUploadStorage struct {
	objects   map[string][]byte
	deleted   []string
	lastInput mediastore.DirectUploadInput
	sessions  int
}

type cancelingUploadStorage struct {
	cancel           context.CancelFunc
	deleteContextErr error
}

func (*cancelingUploadStorage) Driver() string { return "canceling" }
func (s *cancelingUploadStorage) Save(ctx context.Context, _ string, _ io.Reader) (string, error) {
	s.cancel()
	return "", ctx.Err()
}
func (s *cancelingUploadStorage) Delete(ctx context.Context, _ string) error {
	s.deleteContextErr = ctx.Err()
	return nil
}
func (*cancelingUploadStorage) GetURL(string) string { return "" }
func (*cancelingUploadStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return nil, errMediaNotFoundForTest{}
}

func newFakeDirectUploadStorage() *fakeDirectUploadStorage {
	return &fakeDirectUploadStorage{objects: map[string][]byte{}}
}

func (s *fakeDirectUploadStorage) Driver() string {
	return "s3"
}

func (s *fakeDirectUploadStorage) Save(_ context.Context, id string, reader io.Reader) (string, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return "", err
	}
	s.objects[id] = data
	return id, nil
}

func (s *fakeDirectUploadStorage) Delete(_ context.Context, id string) error {
	delete(s.objects, id)
	s.deleted = append(s.deleted, id)
	return nil
}

func (s *fakeDirectUploadStorage) GetURL(id string) string {
	return "https://media.openpost.test/" + id
}

func (s *fakeDirectUploadStorage) Open(_ context.Context, id string) (io.ReadCloser, error) {
	data, ok := s.objects[id]
	if !ok {
		return nil, errMediaNotFoundForTest{}
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (s *fakeDirectUploadStorage) CreateDirectUploadSession(_ context.Context, input mediastore.DirectUploadInput) (*mediastore.DirectUploadSession, error) {
	s.sessions++
	s.lastInput = input
	return &mediastore.DirectUploadSession{
		Method: http.MethodPut,
		URL:    "https://uploads.openpost.test/" + input.Key,
		Headers: map[string]string{
			"Content-Type": input.ContentType,
		},
		Key:       input.Key,
		ExpiresAt: time.Now().UTC().Add(input.ExpiresIn),
	}, nil
}

type errMediaNotFoundForTest struct{}

func (errMediaNotFoundForTest) Error() string {
	return "media not found"
}

func newMediaDirectUploadTestServer(t *testing.T, storage mediastore.BlobStorage, entitlement entitlements.Service) *mediaDirectUploadTestServer {
	return newMediaDirectUploadTestServerWithAuthenticator(t, storage, entitlement, testAuthenticator{})
}

func newMediaDirectUploadTestServerWithAuthenticator(
	t *testing.T,
	storage mediastore.BlobStorage,
	entitlement entitlements.Service,
	authenticator middleware.Authenticator,
) *mediaDirectUploadTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.MediaAttachment)(nil),
		(*models.UsageCounter)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	usageSvc := usage.NewService(db)
	handler := NewMediaHandler(db, storage, nil, authenticator, nil)
	handler.SetUsage(usageSvc)
	handler.SetEntitlement(entitlement)
	handler.RegisterRoutes(api)
	handler.RegisterLegacyRoutes(e)

	fakeStorage, _ := storage.(*fakeDirectUploadStorage)
	return &mediaDirectUploadTestServer{echo: e, db: db, storage: fakeStorage, usage: usageSvc}
}

type mutableMediaScopeAuthenticator struct {
	scope       string
	workspaceID string
}

func (a *mutableMediaScopeAuthenticator) AuthenticateBearer(
	_ context.Context,
	_ string,
) (*middleware.Principal, error) {
	return &middleware.Principal{
		UserID:      "user-1",
		Email:       "user@example.com",
		Scope:       a.scope,
		WorkspaceID: a.workspaceID,
		TokenID:     "scoped-token",
	}, nil
}

func (s *mediaDirectUploadTestServer) postJSON(t *testing.T, path string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestCreateMediaUploadSessionSupportsLocalStreaming(t *testing.T) {
	t.Parallel()

	srv := newMediaDirectUploadTestServer(t, mediastore.NewLocalStorage(t.TempDir(), "/media"), entitlements.NewSelfHostedService())

	resp := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id": "ws-1",
		"filename":     "launch.png",
		"mime_type":    "image/png",
		"size":         12,
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	mediaID := out["media_id"].(string)
	upload := out["upload"].(map[string]any)
	require.Equal(t, http.MethodPut, upload["method"])
	require.Equal(t, "/api/v1/media/upload-session/"+mediaID+"/content", upload["url"])
}

func TestCanceledStreamingUploadReturnsSessionToPending(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	storage := &cancelingUploadStorage{cancel: cancel}
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	media := &models.MediaAttachment{
		ID:               "canceled-stream",
		WorkspaceID:      "ws-1",
		FilePath:         "canceled-stream.txt",
		StorageType:      storage.Driver(),
		MimeType:         "text/plain",
		ProcessingStatus: mediaProcessingStatus,
		Size:             7,
		OriginalFilename: "canceled-stream.txt",
		CreatedAt:        time.Now().UTC(),
	}
	_, err := srv.db.NewInsert().Model(media).Exec(t.Context())
	require.NoError(t, err)
	req := httptest.NewRequestWithContext(ctx, http.MethodPut, "/api/v1/media/upload-session/"+media.ID+"/content", bytes.NewBufferString("content"))
	req.Header.Set("Authorization", "Bearer web-token")
	recorder := httptest.NewRecorder()

	srv.echo.ServeHTTP(recorder, req)

	require.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
	require.NoError(t, storage.deleteContextErr)
	var stored models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", media.ID).Scan(t.Context()))
	require.Equal(t, mediaProcessingStatus, stored.ProcessingStatus)
}

func TestCreateMediaUploadSessionIdempotencyReplaysTheReservedTarget(t *testing.T) {
	t.Parallel()

	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	createIdempotencyRecordTable(t, srv.db)
	body := map[string]any{
		"workspace_id": "ws-1",
		"filename":     "launch.png",
		"mime_type":    "image/png",
		"size":         12,
	}
	create := func() *httptest.ResponseRecorder {
		var payload bytes.Buffer
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/upload-session", &payload)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer web-token")
		req.Header.Set("Idempotency-Key", "workflow-item-7")
		rec := httptest.NewRecorder()
		srv.echo.ServeHTTP(rec, req)
		return rec
	}

	first := create()
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	replay := create()
	require.Equal(t, http.StatusOK, replay.Code, replay.Body.String())
	require.JSONEq(t, first.Body.String(), replay.Body.String())
	require.Equal(t, 1, storage.sessions)
	mediaCount, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Equal(t, 1, mediaCount)
}

type zeroMediaReader struct{}

func (zeroMediaReader) Read(buffer []byte) (int, error) {
	clear(buffer)
	return len(buffer), nil
}

func TestLocalMediaUploadSessionStreamsVideoPastBufferedLimit(t *testing.T) {
	mediaPath := t.TempDir()
	srv := newMediaDirectUploadTestServer(t, mediastore.NewLocalStorage(mediaPath, "/media"), entitlements.NewSelfHostedService())
	size := MaxBufferedMediaUploadBytes + 1

	createResp := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id": "ws-1",
		"filename":     "launch.mp4",
		"mime_type":    "video/mp4",
		"size":         size,
	})
	require.Equal(t, http.StatusOK, createResp.Code, createResp.Body.String())
	var created map[string]any
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &created))
	mediaID := created["media_id"].(string)
	uploadPath := created["upload"].(map[string]any)["url"].(string)

	uploadReq := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPut,
		uploadPath,
		io.LimitReader(zeroMediaReader{}, size),
	)
	uploadReq.ContentLength = size
	uploadReq.Header.Set("Content-Type", "video/mp4")
	uploadReq.Header.Set("Authorization", "Bearer web-token")
	uploadResp := httptest.NewRecorder()
	srv.echo.ServeHTTP(uploadResp, uploadReq)
	require.Equal(t, http.StatusNoContent, uploadResp.Code, uploadResp.Body.String())

	completeResp := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{
		"workspace_id": "ws-1",
	})
	require.Equal(t, http.StatusOK, completeResp.Code, completeResp.Body.String())
	var completed MediaUploadResult
	require.NoError(t, json.Unmarshal(completeResp.Body.Bytes(), &completed))
	require.Equal(t, size, completed.Size)

	var media models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(t.Context()))
	require.Equal(t, mediaReadyStatus, media.ProcessingStatus)
	require.Equal(t, size, media.Size)
	require.Equal(t, "video/mp4", media.MimeType)
	require.FileExists(t, media.FilePath)
}

func TestAPIWriteScopeCompletesBoundLocalMediaUploadSession(t *testing.T) {
	content := []byte("scoped upload")
	authenticator := &mutableMediaScopeAuthenticator{
		scope:       apitokens.ScopeAPIWrite,
		workspaceID: "ws-1",
	}
	srv := newMediaDirectUploadTestServerWithAuthenticator(
		t,
		mediastore.NewLocalStorage(t.TempDir(), "/media"),
		entitlements.NewSelfHostedService(),
		authenticator,
	)

	createResp := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id": "ws-1",
		"filename":     "scoped.txt",
		"mime_type":    "text/plain",
		"size":         len(content),
	})
	require.Equal(t, http.StatusOK, createResp.Code, createResp.Body.String())
	var created map[string]any
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &created))
	mediaID := created["media_id"].(string)
	uploadPath := created["upload"].(map[string]any)["url"].(string)

	upload := func() *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, uploadPath, bytes.NewReader(content))
		req.Header.Set("Content-Type", "text/plain")
		req.Header.Set("Authorization", "Bearer scoped-token")
		rec := httptest.NewRecorder()
		srv.echo.ServeHTTP(rec, req)
		return rec
	}

	authenticator.scope = apitokens.ScopeAPIRead
	require.Equal(t, http.StatusForbidden, upload().Code)

	authenticator.scope = apitokens.ScopeAPIWrite
	authenticator.workspaceID = "ws-2"
	require.Equal(t, http.StatusForbidden, upload().Code)

	authenticator.workspaceID = "ws-1"
	require.Equal(t, http.StatusNoContent, upload().Code)

	completeResp := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{
		"workspace_id": "ws-1",
	})
	require.Equal(t, http.StatusOK, completeResp.Code, completeResp.Body.String())
	var completed MediaUploadResult
	require.NoError(t, json.Unmarshal(completeResp.Body.Bytes(), &completed))
	require.Equal(t, mediaID, completed.ID)
	require.Equal(t, int64(len(content)), completed.Size)
}

func TestAPIWriteScopeRejectsUncataloguedLegacyMediaRoutes(t *testing.T) {
	authenticator := &mutableMediaScopeAuthenticator{
		scope:       apitokens.ScopeAPIWrite,
		workspaceID: "ws-1",
	}
	srv := newMediaDirectUploadTestServerWithAuthenticator(
		t,
		mediastore.NewLocalStorage(t.TempDir(), "/media"),
		entitlements.NewSelfHostedService(),
		authenticator,
	)

	for _, request := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/v1/media/upload"},
		{method: http.MethodPost, path: "/api/v1/media/batch-upload"},
		{method: http.MethodGet, path: "/api/v1/media/metadata"},
	} {
		req := httptest.NewRequestWithContext(t.Context(), request.method, request.path, nil)
		req.Header.Set("Authorization", "Bearer scoped-token")
		rec := httptest.NewRecorder()
		srv.echo.ServeHTTP(rec, req)
		require.Equal(t, http.StatusForbidden, rec.Code, "%s %s", request.method, request.path)
	}
}

func TestValidateBrandFontContent(t *testing.T) {
	t.Parallel()

	validWOFF2 := append([]byte{'w', 'O', 'F', '2'}, make([]byte, 24)...)
	validTTF := append([]byte{0x00, 0x01, 0x00, 0x00}, make([]byte, 24)...)
	validOTF := append([]byte{'O', 'T', 'T', 'O'}, make([]byte, 24)...)
	require.NoError(t, validateMediaAssetContent("brand_font", "brand.woff2", "font/woff2", validWOFF2))
	require.NoError(t, validateMediaAssetContent("brand_font", "brand.ttf", "font/ttf", validTTF))
	require.NoError(t, validateMediaAssetContent("brand_font", "brand.otf", "font/otf", validOTF))
	require.ErrorContains(
		t,
		validateMediaAssetContent("brand_font", "brand.woff2", "font/woff2", []byte("not-a-font")),
		"valid WOFF2",
	)
	require.ErrorContains(
		t,
		validateMediaAssetContent("brand_font", "brand.ttf", "font/woff2", validTTF),
		"MIME type",
	)
	require.ErrorContains(
		t,
		validateMediaAssetContent("brand_font", "brand.woff", "font/woff", validWOFF2),
		".woff2, .ttf, or .otf",
	)
	require.NoError(t, validateMediaAssetContent("library", "notes.txt", "text/plain", []byte("notes")))
}

func TestValidateMediaAssetContentRejectsSVG(t *testing.T) {
	t.Parallel()

	svg := []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"></svg>`)
	for _, testCase := range []struct {
		name     string
		filename string
		mimeType string
		content  []byte
	}{
		{name: "mime type", filename: "mark", mimeType: "image/svg+xml", content: svg},
		{name: "extension", filename: "mark.svg", mimeType: "application/octet-stream", content: svg},
		{name: "content", filename: "mark", mimeType: "application/octet-stream", content: svg},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			require.ErrorContains(
				t,
				validateMediaAssetContent("library", testCase.filename, testCase.mimeType, testCase.content),
				"could not be processed",
			)
		})
	}
}

func TestCreateMediaUploadSessionReservesPendingMedia(t *testing.T) {
	t.Parallel()

	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())

	resp := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id": "ws-1",
		"filename":     "folder/launch.png",
		"mime_type":    "image/png",
		"size":         12,
		"alt_text":     "Launch card",
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	mediaID := out["media_id"].(string)
	upload := out["upload"].(map[string]any)
	require.Equal(t, http.MethodPut, upload["method"])
	require.Equal(t, "https://uploads.openpost.test/"+mediaID+".png", upload["url"])
	require.Equal(t, "/api/v1/media/upload-session/"+mediaID+"/complete", out["complete_url"])
	require.Equal(t, "image/png", upload["headers"].(map[string]any)["Content-Type"])
	require.Equal(t, mediaID+".png", storage.lastInput.Key)
	require.Equal(t, int64(12), storage.lastInput.Size)

	var media models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(context.Background()))
	require.Equal(t, "ws-1", media.WorkspaceID)
	require.Equal(t, mediaID+".png", media.FilePath)
	require.Equal(t, "s3", media.StorageType)
	require.Equal(t, mediaProcessingStatus, media.ProcessingStatus)
	require.Equal(t, int64(12), media.Size)
	require.Equal(t, "launch.png", media.OriginalFilename)
	require.Equal(t, "pending:"+mediaID, media.FileHash)
	require.Equal(t, "Launch card", media.AltText)
}

func TestCreateMediaUploadSessionAppliesTypeSpecificSizeLimits(t *testing.T) {
	t.Parallel()

	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())

	videoResp := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id": "ws-1",
		"filename":     "launch.mp4",
		"mime_type":    "video/mp4",
		"size":         MaxMediaUploadBytes,
	})
	require.Equal(t, http.StatusOK, videoResp.Code, videoResp.Body.String())
	var videoSession map[string]any
	require.NoError(t, json.Unmarshal(videoResp.Body.Bytes(), &videoSession))
	videoID := videoSession["media_id"].(string)
	require.Equal(
		t,
		"/api/v1/media/upload-session/"+videoID+"/content",
		videoSession["upload"].(map[string]any)["url"],
	)

	oversizeVideoResp := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id": "ws-1",
		"filename":     "launch.mp4",
		"mime_type":    "video/mp4",
		"size":         MaxMediaUploadBytes + 1,
	})
	require.Equal(t, http.StatusBadRequest, oversizeVideoResp.Code, oversizeVideoResp.Body.String())
	require.Contains(t, oversizeVideoResp.Body.String(), "16 GiB")

	oversizeImageResp := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id": "ws-1",
		"filename":     "launch.png",
		"mime_type":    "image/png",
		"size":         MaxBufferedMediaUploadBytes + 1,
	})
	require.Equal(t, http.StatusBadRequest, oversizeImageResp.Code, oversizeImageResp.Body.String())
	require.Contains(t, oversizeImageResp.Body.String(), "50MB")
}

func TestMediaUploadSessionTTLScalesForLargeVideos(t *testing.T) {
	require.Equal(t, MediaUploadSessionTTL, mediaUploadSessionTTL(12))
	require.Greater(t, mediaUploadSessionTTL(MaxDirectMediaUploadBytes), time.Hour)
	require.Greater(t, mediaUploadSessionTTL(MaxMediaUploadBytes), 4*time.Hour)
	require.LessOrEqual(t, mediaUploadSessionTTL(MaxMediaUploadBytes), maxMediaUploadSessionTTL)
}

func TestCompleteMediaUploadSessionFinalizesUploadedObject(t *testing.T) {
	t.Parallel()

	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	mediaID := srv.createUploadSessionWithAlt(t, "copy.txt", "text/plain", 12, "Direct upload alt")
	storage.objects[mediaID+".txt"] = []byte("hello direct")

	resp := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{
		"workspace_id": "ws-1",
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out MediaUploadResult
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, mediaID, out.ID)
	require.Equal(t, int64(12), out.Size)
	require.False(t, out.Deduped)
	require.Equal(t, "/media/"+mediaID, out.URL)
	require.Equal(t, "Direct upload alt", out.AltText)
	require.Equal(t, "copy.txt", out.OriginalFilename)

	var media models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(context.Background()))
	require.Equal(t, mediaReadyStatus, media.ProcessingStatus)
	require.Equal(t, "text/plain; charset=utf-8", media.MimeType)
	require.Equal(t, int64(12), media.Size)

	hash := sha256.Sum256([]byte("hello direct"))
	require.Equal(t, hex.EncodeToString(hash[:]), media.FileHash)
	current, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitMediaBytesUploadedMonthly, time.Now())
	require.NoError(t, err)
	require.Equal(t, int64(12), current)
}

func TestCompleteMediaUploadSessionRetryDoesNotRecountQueuedVideo(t *testing.T) {
	t.Parallel()

	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	mediaID := srv.createUploadSession(t, "clip.mp4", "video/mp4", 12)
	storage.objects[mediaID+".mp4"] = []byte("video bytes!")

	first := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{
		"workspace_id": "ws-1",
	})
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())
	_, err := srv.db.NewUpdate().
		Model((*models.MediaAttachment)(nil)).
		Set("processing_status = ?", mediaProcessingStatus).
		Set("analysis_status = ?", "pending").
		Where("id = ?", mediaID).
		Exec(context.Background())
	require.NoError(t, err)

	retry := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{
		"workspace_id": "ws-1",
	})
	require.Equal(t, http.StatusOK, retry.Code, retry.Body.String())
	var out MediaUploadResult
	require.NoError(t, json.Unmarshal(retry.Body.Bytes(), &out))
	require.Equal(t, mediaProcessingStatus, out.ProcessingStatus)
	require.Equal(t, "pending", out.AnalysisStatus)

	current, err := srv.usage.CurrentMonthly(
		context.Background(),
		"ws-1",
		entitlements.LimitMediaBytesUploadedMonthly,
		time.Now(),
	)
	require.NoError(t, err)
	require.Equal(t, int64(12), current)
}

func TestCompleteMediaUploadSessionDedupesExistingMedia(t *testing.T) {
	t.Parallel()

	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	content := []byte("same media")
	hash := sha256.Sum256(content)
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "existing-media",
		WorkspaceID:      "ws-1",
		FilePath:         "existing.txt",
		StorageType:      "s3",
		MimeType:         "text/plain",
		ProcessingStatus: mediaReadyStatus,
		Size:             int64(len(content)),
		OriginalFilename: "existing.txt",
		AltText:          "Existing alt",
		FileHash:         hex.EncodeToString(hash[:]),
		CreatedAt:        time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)
	mediaID := srv.createUploadSession(t, "dupe.txt", "text/plain", int64(len(content)))
	storage.objects[mediaID+".txt"] = content

	resp := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{
		"workspace_id": "ws-1",
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out MediaUploadResult
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "existing-media", out.ID)
	require.True(t, out.Deduped)
	require.Equal(t, "Existing alt", out.AltText)
	require.Equal(t, "existing.txt", out.OriginalFilename)
	require.Contains(t, storage.deleted, mediaID+".txt")
	pendingCount, err := srv.db.NewSelect().
		Model((*models.MediaAttachment)(nil)).
		Where("id = ?", mediaID).
		Count(context.Background())
	require.NoError(t, err)
	require.Equal(t, 0, pendingCount)
	current, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitMediaBytesUploadedMonthly, time.Now())
	require.NoError(t, err)
	require.Equal(t, int64(0), current)
}

func TestMediaRollbackCompletesAfterRequestCancellation(t *testing.T) {
	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	media := &models.MediaAttachment{
		ID:               "rollback-media",
		WorkspaceID:      "ws-1",
		FilePath:         "rollback-media.txt",
		StorageType:      "s3",
		MimeType:         "text/plain",
		ProcessingStatus: mediaReadyStatus,
		Size:             7,
		OriginalFilename: "rollback-media.txt",
		CreatedAt:        time.Now().UTC(),
	}
	_, err := srv.db.NewInsert().Model(media).Exec(t.Context())
	require.NoError(t, err)
	storage.objects[media.FilePath] = []byte("content")
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	handler := NewMediaHandler(srv.db, storage, nil, testAuthenticator{}, nil)

	require.NoError(t, handler.rollbackMediaRecord(ctx, media))
	count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", media.ID).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	require.NotContains(t, storage.objects, media.FilePath)
}

func (s *mediaDirectUploadTestServer) createUploadSession(t *testing.T, filename string, mimeType string, size int64) string {
	return s.createUploadSessionWithAlt(t, filename, mimeType, size, "")
}

func (s *mediaDirectUploadTestServer) createUploadSessionWithAlt(t *testing.T, filename string, mimeType string, size int64, altText string) string {
	t.Helper()

	resp := s.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id": "ws-1",
		"filename":     filename,
		"mime_type":    mimeType,
		"size":         size,
		"alt_text":     altText,
	})
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	return out["media_id"].(string)
}
