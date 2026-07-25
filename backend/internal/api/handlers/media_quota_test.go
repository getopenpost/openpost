package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type mediaQuotaTestServer struct {
	echo  *echo.Echo
	db    *bun.DB
	usage *usage.Service
}

func newMediaQuotaTestServer(t *testing.T, entitlement entitlements.Service) *mediaQuotaTestServer {
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

	storage := mediastore.NewLocalStorage(t.TempDir(), "/media")
	usageSvc := usage.NewService(db)
	handler := NewMediaHandler(db, storage, nil, testAuthenticator{}, nil)
	handler.SetEntitlement(entitlement)
	handler.SetUsage(usageSvc)

	e := echo.New()
	handler.RegisterLegacyRoutes(e)
	return &mediaQuotaTestServer{echo: e, db: db, usage: usageSvc}
}

func (s *mediaQuotaTestServer) upload(t *testing.T, filename string, content []byte) *httptest.ResponseRecorder {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("workspace_id", "ws-1"))
	part, err := writer.CreateFormFile("file", filename)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/upload", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestUploadMediaRejectsMonthlyUploadQuota(t *testing.T) {
	t.Parallel()

	srv := newMediaQuotaTestServer(t, entitlements.NewStaticService(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitMediaBytesUploadedMonthly: 3,
		},
	}))

	resp := srv.upload(t, "quota.txt", []byte("1234"))

	require.Equal(t, http.StatusBadRequest, resp.Code)
	require.Contains(t, resp.Body.String(), "media_bytes_uploaded_monthly limit exceeded")
	var count int
	require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("media_attachments").Scan(context.Background(), &count))
	require.Equal(t, 0, count)
}

func TestUploadMediaRejectsStoredBytesQuota(t *testing.T) {
	t.Parallel()

	srv := newMediaQuotaTestServer(t, entitlements.NewStaticService(entitlements.PlanSnapshot{
		Limits: map[entitlements.LimitKey]int64{
			entitlements.LimitMediaBytesStored: 5,
		},
	}))
	_, err := srv.db.NewInsert().Model(&models.MediaAttachment{
		ID:               "existing",
		WorkspaceID:      "ws-1",
		FilePath:         "existing.txt",
		StorageType:      "local",
		MimeType:         "text/plain",
		ProcessingStatus: "ready",
		Size:             4,
		OriginalFilename: "existing.txt",
		FileHash:         "existing-hash",
		CreatedAt:        time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.upload(t, "quota.txt", []byte("12"))

	require.Equal(t, http.StatusBadRequest, resp.Code)
	require.Contains(t, resp.Body.String(), "media_bytes_stored limit exceeded")
}

func TestUploadMediaIncrementsMonthlyUsageAfterSuccessfulUpload(t *testing.T) {
	t.Parallel()

	srv := newMediaQuotaTestServer(t, entitlements.NewSelfHostedService())

	resp := srv.upload(t, "ok.txt", []byte("1234"))

	require.Equal(t, http.StatusOK, resp.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, false, out["deduped"])

	current, err := srv.usage.CurrentMonthly(context.Background(), "ws-1", entitlements.LimitMediaBytesUploadedMonthly, time.Now())
	require.NoError(t, err)
	require.Equal(t, int64(4), current)
}
