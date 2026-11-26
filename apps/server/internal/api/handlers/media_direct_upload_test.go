package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
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
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediaanalysis"
	"github.com/openpost/backend/internal/services/medialifecycle"
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

func TestAPIWriteScopeCompletesBoundLocalMediaUploadSession(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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

func TestDirectUploadAdmissionHidesDatabaseFailures(t *testing.T) {
	t.Parallel()
	for _, operation := range []string{"reserve", "complete"} {
		t.Run(operation, func(t *testing.T) {
			storage := newFakeDirectUploadStorage()
			srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
			mediaID := ""
			if operation == "complete" {
				mediaID = srv.createUploadSession(t, "copy.txt", "text/plain", 12)
				storage.objects[mediaID+".txt"] = []byte("hello direct")
			}
			_, err := srv.db.ExecContext(t.Context(), "CREATE TRIGGER fail_media_admission BEFORE UPDATE OF name ON workspaces BEGIN SELECT RAISE(ABORT, 'private media admission database detail'); END")
			require.NoError(t, err)
			var response *httptest.ResponseRecorder
			if operation == "reserve" {
				response = srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{"workspace_id": "ws-1", "filename": "copy.txt", "mime_type": "text/plain", "size": 12})
			} else {
				response = srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{"workspace_id": "ws-1"})
			}
			require.Equal(t, http.StatusInternalServerError, response.Code, response.Body.String())
			require.NotContains(t, response.Body.String(), "private media admission database detail")
		})
	}
}

func TestInvalidSignedUploadRetainsAccountingUntilCapabilityExpiry(t *testing.T) {
	t.Parallel()
	base := newMCPTestServer(t)
	for _, model := range []any{(*models.VideoProjectRevision)(nil), (*models.VideoProjectMutation)(nil), (*models.VideoProjectCheckpoint)(nil), (*models.VideoProjectConflict)(nil)} {
		_, err := base.db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	storage := newFakeDirectUploadStorage()
	handler := NewMediaHandler(base.db, storage, nil, testAuthenticator{}, nil)
	handler.SetEntitlement(entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{entitlements.LimitMediaBytesStored: 13}}))
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Tombstone", "1"))
	handler.RegisterRoutes(api)
	srv := &mediaDirectUploadTestServer{echo: e, db: base.db, storage: storage, handler: handler, usage: usage.NewService(base.db)}
	mediaID := srv.createUploadSession(t, "copy.png", "image/png", 12)
	key := mediaID + ".png"
	storage.objects[key] = []byte("<svg></svg>!")
	response := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{"workspace_id": "ws-1"})
	require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
	var failed models.MediaAttachment
	require.NoError(t, base.db.NewSelect().Model(&failed).Where("id = ?", mediaID).Scan(t.Context()))
	require.Equal(t, mediaFailedStatus, failed.ProcessingStatus)
	stored, err := medialifecycle.StoredBytes(t.Context(), base.db, "ws-1", "")
	require.NoError(t, err)
	require.Equal(t, int64(12), stored)
	sessionsBefore := storage.sessions
	response = srv.postJSON(t, "/api/v1/media/upload-session", map[string]any{"workspace_id": "ws-1", "filename": "more.txt", "mime_type": "text/plain", "size": 2})
	require.Equal(t, http.StatusBadRequest, response.Code)
	require.Equal(t, sessionsBefore, storage.sessions)
	response = srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{"workspace_id": "ws-1"})
	require.Equal(t, http.StatusBadRequest, response.Code)
	// The already issued S3 capability can PUT again despite the application failure.
	storage.objects[key] = []byte("hello direct")
	lifecycle := medialifecycle.NewService(base.db, nil)
	require.NoError(t, lifecycle.Sweep(t.Context(), "ws-1", failed.CreatedAt.Add(time.Hour)))
	exists, err := base.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", mediaID).Exists(t.Context())
	require.NoError(t, err)
	require.True(t, exists)
	require.NoError(t, lifecycle.Sweep(t.Context(), "ws-1", failed.CreatedAt.Add(25*time.Hour)))
	exists, err = base.db.NewSelect().Model((*models.MediaAttachment)(nil)).Where("id = ?", mediaID).Exists(t.Context())
	require.NoError(t, err)
	require.False(t, exists)
	var jobs []models.Job
	require.NoError(t, base.db.NewSelect().Model(&jobs).Where("type = ?", "storage_delete").Scan(t.Context()))
	durableKeys := make([]string, 0, len(jobs))
	for _, job := range jobs {
		var payload struct {
			Keys []string `json:"keys"`
		}
		require.NoError(t, json.Unmarshal([]byte(job.Payload), &payload))
		durableKeys = append(durableKeys, payload.Keys...)
		require.Greater(t, job.MaxAttempts, 1)
	}
	require.Contains(t, durableKeys, key, "late PUT must retain a retryable object cleanup receipt")
}

func TestStreamingImageUploadPersistsDimensionsBeforeReady(t *testing.T) {
	t.Parallel()

	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 23, 17))))
	content := encoded.Bytes()
	mediaID := srv.createUploadSession(t, "gallery.png", "image/png", int64(len(content)))
	storage.objects[mediaID+".png"] = content

	resp := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{
		"workspace_id": "ws-1",
	})
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var completed MediaUploadResult
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &completed))
	require.Equal(t, 23, completed.Width)
	require.Equal(t, 17, completed.Height)

	var media models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&media).Where("id = ?", mediaID).Scan(t.Context()))
	require.Equal(t, mediaReadyStatus, media.ProcessingStatus)
	require.Equal(t, 23, media.Width)
	require.Equal(t, 17, media.Height)
}

func TestCompleteMediaUploadSessionRepairsLegacyDeduplicatedImageDimensions(t *testing.T) {
	t.Parallel()
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 23, 17))))
	// A PNG-compressed ICO: 6-byte header, one 16-byte directory entry, payload.
	icon := make([]byte, 22, 22+encoded.Len())
	binary.LittleEndian.PutUint16(icon[2:4], 1)
	binary.LittleEndian.PutUint16(icon[4:6], 1)
	icon[6], icon[7] = 23, 17
	binary.LittleEndian.PutUint16(icon[10:12], 1)
	binary.LittleEndian.PutUint16(icon[12:14], 32)
	binary.LittleEndian.PutUint32(icon[14:18], uint32(encoded.Len()))
	binary.LittleEndian.PutUint32(icon[18:22], 22)
	icon = append(icon, encoded.Bytes()...)
	for _, test := range []struct {
		ext, mimeType string
		content       []byte
	}{
		{"png", "image/png", encoded.Bytes()},
		{"ico", "image/x-icon", icon},
	} {
		t.Run(test.mimeType, func(t *testing.T) {
			t.Parallel()
			assertLegacyDuplicateDimensionsRepaired(t, test.ext, test.mimeType, test.content)
		})
	}
}

func assertLegacyDuplicateDimensionsRepaired(t *testing.T, ext, mimeType string, content []byte) {
	t.Helper()
	storage := newFakeDirectUploadStorage()
	srv := newMediaDirectUploadTestServer(t, storage, entitlements.NewSelfHostedService())
	hash := sha256.Sum256(content)

	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "legacy-gallery-image",
		WorkspaceID:      "ws-1",
		FilePath:         "legacy-gallery-image." + ext,
		StorageType:      "s3",
		MimeType:         mimeType,
		ProcessingStatus: mediaReadyStatus,
		Size:             int64(len(content)),
		OriginalFilename: "legacy-gallery-image." + ext,
		FileHash:         hex.EncodeToString(hash[:]),
		CreatedAt:        time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	storage.objects["legacy-gallery-image."+ext] = content

	mediaID := srv.createUploadSession(t, "gallery."+ext, mimeType, int64(len(content)))
	storage.objects[mediaID+"."+ext] = content
	response := srv.postJSON(t, "/api/v1/media/upload-session/"+mediaID+"/complete", map[string]any{
		"workspace_id": "ws-1",
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var result MediaUploadResult
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &result))
	require.True(t, result.Deduped)
	require.Equal(t, "legacy-gallery-image", result.ID)
	require.Equal(t, 23, result.Width)
	require.Equal(t, 17, result.Height)

	var stored models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&stored).
		Where("id = ?", "legacy-gallery-image").Scan(t.Context()))
	require.Equal(t, 23, stored.Width)
	require.Equal(t, 17, stored.Height)
	require.Equal(t, mediaReadyStatus, stored.ProcessingStatus)
	require.Contains(t, storage.deleted, mediaID+"."+ext)
}
