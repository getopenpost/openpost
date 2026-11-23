package handlers

import (
	"bytes"
	"context"

	"encoding/json"

	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"

	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediaanalysis"

	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/openpost/backend/internal/services/videoprocessing"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestAudioProjectAssetUploadsPersistMetadata(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ extension, mimeType, encoder, codec string }{
		{"webm", "audio/webm", "libopus", "opus"},
		{"wav", "audio/wave", "pcm_s16le", "pcm_s16le"},
	} {
		t.Run(tc.extension, func(t *testing.T) {
			filename := filepath.Join(t.TempDir(), "microphone."+tc.extension)
			output, err := exec.CommandContext(t.Context(), "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.2", "-c:a", tc.encoder, filename).CombinedOutput()
			require.NoError(t, err, string(output))
			content, err := os.ReadFile(filename)
			require.NoError(t, err)
			storage := newFakeDirectUploadStorage()
			srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
			for _, model := range []any{(*models.Organization)(nil), (*models.Job)(nil)} {
				_, err := srv.db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
				require.NoError(t, err)
			}
			_, err = srv.db.NewInsert().Model(&models.Organization{ID: "recording-org", Name: "Recording"}).Exec(t.Context())
			require.NoError(t, err)
			_, err = srv.db.NewUpdate().Model((*models.Workspace)(nil)).Set("organization_id = ?", "recording-org").Where("id = ?", "ws-1").Exec(t.Context())
			require.NoError(t, err)
			processor := videoprocessing.NewService(srv.db, storage, mediaanalysis.FFmpegAnalyzer{})
			srv.handler.SetVideoProcessor(processor)
			assertProcessedAudio := func(result MediaUploadResult) {
				t.Helper()
				require.Equal(t, "processing", result.ProcessingStatus)
				var jobs []models.Job
				require.NoError(t, srv.db.NewSelect().Model(&jobs).Where("type = ?", videoprocessing.JobTypeAnalyze).Scan(t.Context()))
				require.NotEmpty(t, jobs)
				for _, job := range jobs {
					require.NoError(t, processor.HandleJob(t.Context(), job.Type, job.Payload))
				}
				var stored models.MediaAttachment
				require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", result.ID).Scan(t.Context()))
				require.Equal(t, tc.mimeType, stored.MimeType)
				require.Equal(t, "ready", stored.ProcessingStatus)
				require.Equal(t, "ready", stored.AnalysisStatus)
				require.Equal(t, "audio", stored.DominantType)
				require.Equal(t, tc.codec, stored.AudioCodec)
				require.Greater(t, stored.DurationMS, int64(100))
				req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/media/metadata?workspace_id=ws-1&media_ids="+result.ID, nil)
				req.Header.Set("Authorization", "Bearer web-token")
				response := httptest.NewRecorder()
				srv.echo.ServeHTTP(response, req)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var metadata struct {
					Media []MediaMetadataItem `json:"media"`
				}
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &metadata))
				require.Len(t, metadata.Media, 1)
				require.Equal(t, "microphone."+tc.extension, metadata.Media[0].OriginalFilename)
			}
			create := srv.postJSON(t, "/api/v1/video-projects", map[string]any{
				"workspace_id": "ws-1", "name": "Microphone capture", "device_id": "desktop",
				"document": map[string]any{"id": "capture", "timeline": map[string]any{"tracks": []any{}, "items": []any{}}},
			})
			require.Equal(t, http.StatusOK, create.Code, create.Body.String())
			var project VideoProjectResponse
			require.NoError(t, json.Unmarshal(create.Body.Bytes(), &project))
			reserve := func(stableID string) string {
				t.Helper()
				response := srv.postJSON(t, "/api/v1/video-projects/"+project.ID+"/assets", map[string]any{
					"workspace_id": "ws-1", "stable_media_id": stableID, "original_filename": "microphone." + tc.extension,
					"mime_type": tc.mimeType, "size": len(content),
					"preparation": map[string]any{},
				})
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var asset ProjectAssetResponse
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &asset))
				return asset.ID
			}
			assetID := reserve("direct-mic")
			sessionResponse := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
				"workspace_id": "ws-1", "filename": "microphone." + tc.extension, "mime_type": tc.mimeType,
				"size": len(content), "source": "video_editor_source", "asset_kind": "project_asset", "project_asset_id": assetID,
			})
			require.Equal(t, http.StatusOK, sessionResponse.Code, sessionResponse.Body.String())
			var session CreateMediaUploadSessionResponse
			require.NoError(t, json.Unmarshal(sessionResponse.Body.Bytes(), &session))
			mediaID := session.MediaID
			storage.objects[mediaID+"."+tc.extension] = content
			complete := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{"workspace_id": "ws-1"})
			require.Equal(t, http.StatusOK, complete.Code, complete.Body.String())
			var result MediaUploadResult
			require.NoError(t, json.Unmarshal(complete.Body.Bytes(), &result))
			assertProcessedAudio(result)

			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			require.NoError(t, writer.WriteField("workspace_id", "ws-1"))
			require.NoError(t, writer.WriteField("source", "video_editor_source"))
			require.NoError(t, writer.WriteField("asset_kind", "project_asset"))
			require.NoError(t, writer.WriteField("project_asset_id", reserve("multipart-mic")))
			part, err := writer.CreatePart(textproto.MIMEHeader{
				"Content-Disposition": {`form-data; name="file"; filename="microphone.` + tc.extension + `"`},
				"Content-Type":        {tc.mimeType},
			})
			require.NoError(t, err)
			_, err = part.Write(content)
			require.NoError(t, err)
			require.NoError(t, writer.Close())
			req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/upload", &body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			req.Header.Set("Authorization", "Bearer web-token")
			response := httptest.NewRecorder()
			srv.echo.ServeHTTP(response, req)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
			assertProcessedAudio(result)
		})
	}
}

type mediaDirectUploadTestServer struct {
	handler *MediaHandler
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
	saveCalls        int
	deleteCalls      int
}

func (*cancelingUploadStorage) Driver() string { return "canceling" }
func (s *cancelingUploadStorage) Save(ctx context.Context, _ string, _ io.Reader) (string, error) {
	s.saveCalls++
	s.cancel()
	return "", ctx.Err()
}
func (s *cancelingUploadStorage) Delete(ctx context.Context, _ string) error {
	s.deleteCalls++
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
		(*models.VideoProject)(nil),
		(*models.VideoProjectRevision)(nil),
		(*models.VideoProjectMutation)(nil),
		(*models.VideoProjectConflict)(nil),
		(*models.VideoProjectCheckpoint)(nil),
		(*models.ProjectAsset)(nil),
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
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	usageSvc := usage.NewService(db)
	handler := NewMediaHandler(db, storage, nil, authenticator, nil)
	handler.SetUsage(usageSvc)
	handler.SetEntitlement(entitlement)
	handler.RegisterRoutes(api)
	handler.RegisterLegacyRoutes(e)
	NewVideoProjectHandler(db, authenticator, storage).RegisterRoutes(api)

	fakeStorage, _ := storage.(*fakeDirectUploadStorage)
	return &mediaDirectUploadTestServer{echo: e, db: db, storage: fakeStorage, usage: usageSvc, handler: handler}
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

func TestCanceledStreamingUploadReturnsSessionToPending(t *testing.T) {
	t.Parallel()
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
	require.Equal(t, 1, storage.saveCalls, "the canceled write must be attempted exactly once")
	require.Equal(t, 1, storage.deleteCalls, "a rejected streaming write must clean up its partial object")
	require.NoError(t, storage.deleteContextErr)
	var stored models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", media.ID).Scan(t.Context()))
	require.Equal(t, mediaProcessingStatus, stored.ProcessingStatus)
}

func TestValidateBrandFontContent(t *testing.T) {
	t.Parallel()

	validWOFF2, err := os.ReadFile("../../services/themes/testdata/roboto-latin-400-normal.woff2")
	require.NoError(t, err)
	validTTF, err := os.ReadFile("../../memes/catalog/fonts/NotoSans-Bold.ttf")
	require.NoError(t, err)
	require.NoError(t, validateMediaAssetContent("brand_font", "brand.woff2", "font/woff2", validWOFF2))
	require.NoError(t, validateMediaAssetContent("brand_font", "brand.ttf", "font/ttf", validTTF))
	for _, forged := range []struct {
		name, mime string
		bytes      []byte
	}{
		{"brand.woff2", "font/woff2", append([]byte("wOF2"), make([]byte, 48)...)},
		{"brand.ttf", "font/ttf", append([]byte{0, 1, 0, 0}, make([]byte, 48)...)},
		{"brand.otf", "font/otf", append([]byte("OTTO"), make([]byte, 48)...)},
	} {
		require.Error(t, validateMediaAssetContent("brand_font", forged.name, forged.mime, forged.bytes), "magic bytes alone do not make a usable font")
	}
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

func TestProjectAssetUploadStaysOutOfMediaLibraryAndCompletesProject(t *testing.T) {
	t.Parallel()
	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())

	createProject := srv.postJSON(t, "/api/v1/video-projects", map[string]any{
		"workspace_id": "ws-1",
		"name":         "Mobile capture",
		"device_id":    "phone-a",
		"document": map[string]any{
			"id":       "mobile-capture",
			"timeline": map[string]any{"tracks": []any{}, "items": []any{}},
		},
	})
	require.Equal(t, http.StatusOK, createProject.Code, createProject.Body.String())
	var project VideoProjectResponse
	require.NoError(t, json.Unmarshal(createProject.Body.Bytes(), &project))

	reserve := srv.postJSON(t, "/api/v1/video-projects/"+project.ID+"/assets", map[string]any{
		"workspace_id":      "ws-1",
		"stable_media_id":   "capture-1",
		"original_filename": "capture.mp4",
		"mime_type":         "video/mp4",
		"size":              12,
		"device_id":         "phone-a",
		"preparation": map[string]any{
			"source_range":        map[string]any{"start_seconds": 1.25, "end_seconds": 8.5},
			"crop":                map[string]any{"x": 0.1, "y": 0.0, "width": 0.8, "height": 1.0},
			"rotation":            90,
			"gain":                0.75,
			"muted":               false,
			"cover_frame_seconds": 2.5,
		},
	})
	require.Equal(t, http.StatusOK, reserve.Code, reserve.Body.String())
	var asset ProjectAssetResponse
	require.NoError(t, json.Unmarshal(reserve.Body.Bytes(), &asset))
	require.Equal(t, "pending", asset.Status)
	require.Equal(t, "capture-1", asset.StableMediaID)

	loadPending := srv.postJSON(t, "/api/v1/video-projects/"+project.ID+"/assets/"+asset.ID+"/begin-upload", map[string]any{
		"workspace_id": "ws-1",
	})
	require.Equal(t, http.StatusOK, loadPending.Code, loadPending.Body.String())

	sessionResponse := srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{
		"workspace_id":     "ws-1",
		"filename":         "capture.mp4",
		"mime_type":        "video/mp4",
		"size":             12,
		"source":           "camera",
		"asset_kind":       "project_asset",
		"project_asset_id": asset.ID,
	})
	require.Equal(t, http.StatusOK, sessionResponse.Code, sessionResponse.Body.String())
	var session CreateMediaUploadSessionResponse
	require.NoError(t, json.Unmarshal(sessionResponse.Body.Bytes(), &session))
	require.Equal(t, asset.ID, session.ProjectAssetID)
	storage.objects[session.MediaID+".mp4"] = []byte("video bytes!")

	complete := srv.postJSON(t, "/api/v1/media/upload-session/"+session.MediaID+"/complete", map[string]any{"workspace_id": "ws-1"})
	require.Equal(t, http.StatusOK, complete.Code, complete.Body.String())

	var storedAsset models.ProjectAsset
	require.NoError(t, srv.db.NewSelect().Model(&storedAsset).Where("id = ?", asset.ID).Scan(t.Context()))
	require.Equal(t, models.ProjectAssetStatusReady, storedAsset.Status)
	require.Equal(t, session.MediaID, storedAsset.MediaID)

	listReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/media?workspace_id=ws-1", nil)
	listReq.Header.Set("Authorization", "Bearer web-token")
	listResponse := httptest.NewRecorder()
	srv.echo.ServeHTTP(listResponse, listReq)
	require.Equal(t, http.StatusOK, listResponse.Code, listResponse.Body.String())
	var mediaList struct {
		Media []MediaListItem `json:"media"`
	}
	require.NoError(t, json.Unmarshal(listResponse.Body.Bytes(), &mediaList))
	require.Empty(t, mediaList.Media)

	getReq := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/video-projects/"+project.ID+"?workspace_id=ws-1", nil)
	getReq.Header.Set("Authorization", "Bearer web-token")
	getResponse := httptest.NewRecorder()
	srv.echo.ServeHTTP(getResponse, getReq)
	require.Equal(t, http.StatusOK, getResponse.Code, getResponse.Body.String())
	var completeProject VideoProjectResponse
	require.NoError(t, json.Unmarshal(getResponse.Body.Bytes(), &completeProject))
	require.Equal(t, "synced", completeProject.SyncStatus)
}

func TestStreamingMediaRollbackCompletesAfterRequestCancellation(t *testing.T) {
	t.Parallel()
	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	_, err := srv.db.NewCreateTable().Model((*models.MediaProvenance)(nil)).IfNotExists().Exec(t.Context())
	require.NoError(t, err)
	handler := NewMediaHandler(srv.db, storage, nil, testAuthenticator{}, nil)
	ctx, cancel := context.WithCancel(t.Context())
	content := []byte("streamed stock media")
	var created models.MediaAttachment

	_, err = handler.processStreamUpload(
		ctx,
		mediaUploadBytesInput{
			WorkspaceID:      "ws-1",
			Filename:         "streamed.txt",
			DeclaredMimeType: "text/plain",
			Size:             int64(len(content)),
			StockProvenance: &StockMediaProvenance{
				Provider:   "test",
				ExternalID: "asset-1",
			},
			OnCreated: func(media models.MediaAttachment) {
				created = media
				cancel()
			},
		},
		"stock_import",
		"library",
		bytes.NewReader(content),
		int64(len(content)),
	)

	require.ErrorContains(t, err, "failed to save stock media provenance")
	require.NotEmpty(t, created.ID)
	count, countErr := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", created.ID).Count(t.Context())
	require.NoError(t, countErr)
	require.Zero(t, count)
	require.Empty(t, storage.objects)
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
