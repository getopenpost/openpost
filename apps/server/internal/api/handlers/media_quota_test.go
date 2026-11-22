package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/openpost/backend/internal/services/publicurl"
	"github.com/openpost/backend/internal/services/usage"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type mediaQuotaTestServer struct {
	echo    *echo.Echo
	db      *bun.DB
	handler *MediaHandler
	usage   *usage.Service
}

type publicMediaVerifierFunc func(context.Context, string) publicurl.Result

type invalidUTF8QueryHook struct {
	found bool
}

func (hook *invalidUTF8QueryHook) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if !utf8.ValidString(event.Query) {
		hook.found = true
	}
	for _, arg := range event.QueryArgs {
		value, ok := arg.(string)
		if ok && !utf8.ValidString(value) {
			hook.found = true
		}
	}
	return ctx
}

func (*invalidUTF8QueryHook) AfterQuery(context.Context, *bun.QueryEvent) {}

func (verify publicMediaVerifierFunc) Verify(ctx context.Context, rawURL string) publicurl.Result {
	return verify(ctx, rawURL)
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
	return &mediaQuotaTestServer{echo: e, db: db, handler: handler, usage: usageSvc}
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

func TestUploadMediaNormalizesInvalidUTF8Filename(t *testing.T) {
	t.Parallel()

	srv := newMediaQuotaTestServer(t, entitlements.NewSelfHostedService())
	queryHook := &invalidUTF8QueryHook{}
	srv.db.AddQueryHook(queryHook)

	boundary := "openpost-invalid-filename"
	body := []byte("--" + boundary + "\r\n" +
		"Content-Disposition: form-data; name=\"workspace_id\"\r\n\r\n" +
		"ws-1\r\n" +
		"--" + boundary + "\r\n" +
		"Content-Disposition: form-data; name=\"file\"; filename=\"earnings \x97 report.txt\"\r\n" +
		"Content-Type: text/plain\r\n\r\n" +
		"results\r\n" +
		"--" + boundary + "--\r\n")
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/upload", bytes.NewReader(body))
	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	req.Header.Set("Authorization", "Bearer web-token")
	resp := httptest.NewRecorder()
	srv.echo.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var filenameHex string
	require.NoError(t, srv.db.NewSelect().
		Table("media_attachments").
		ColumnExpr("HEX(original_filename)").
		Scan(t.Context(), &filenameHex))
	require.Equal(t, "6561726E696E677320EFBFBD207265706F72742E747874", filenameHex)
	require.False(t, queryHook.found, "invalid UTF-8 reached the database boundary")
}

func TestUploadMediaVerifiesPublicURLAfterPersistingRecord(t *testing.T) {
	t.Parallel()

	srv := newMediaQuotaTestServer(t, entitlements.NewSelfHostedService())
	verificationCalled := false
	srv.handler.SetPublicURLVerifier(publicMediaVerifierFunc(func(ctx context.Context, _ string) publicurl.Result {
		verificationCalled = true
		var count int
		require.NoError(t, srv.db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("media_attachments").Scan(ctx, &count))
		require.Equal(t, 1, count)
		return publicurl.Result{
			Ready:      true,
			StatusCode: http.StatusOK,
			CheckedAt:  time.Now().UTC(),
		}
	}))

	resp := srv.upload(t, "ready.txt", []byte("provider-safe"))

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.True(t, verificationCalled)
	var media models.MediaAttachment
	require.NoError(t, srv.db.NewSelect().Model(&media).Scan(t.Context()))
	require.True(t, media.PublicURLReady)
	require.Equal(t, http.StatusOK, media.PublicURLStatus)
}

// Both requests pass the preliminary stored-byte check before either persists.
// Admission must still leave exactly one upload when only one fits.
type synchronizedMediaQuota struct {
	entitlements.Service
	arrived   chan struct{}
	release   chan struct{}
	remaining atomic.Int32
}

func (q *synchronizedMediaQuota) Check(ctx context.Context, req entitlements.Request) (entitlements.Decision, error) {
	decision, err := q.Service.Check(ctx, req)
	if req.Limit == entitlements.LimitMediaBytesStored && q.remaining.Add(-1) >= 0 {
		q.arrived <- struct{}{}
		select {
		case <-q.release:
		case <-ctx.Done():
			return decision, ctx.Err()
		}
	}
	return decision, err
}
func TestUploadMediaConcurrentAdmissionHonorsByteLimits(t *testing.T) {
	t.Parallel()
	for _, limit := range []entitlements.LimitKey{entitlements.LimitMediaBytesStored, entitlements.LimitMediaBytesUploadedMonthly} {
		t.Run(string(limit), func(t *testing.T) {
			quota := &synchronizedMediaQuota{Service: entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{limit: 4}}), arrived: make(chan struct{}, 2), release: make(chan struct{})}
			quota.remaining.Store(2)
			srv := newMediaQuotaTestServer(t, quota)
			srv.db.SetMaxOpenConns(1)
			responses := make(chan *httptest.ResponseRecorder, 2)
			go func() { responses <- srv.upload(t, "first.txt", []byte("1234")) }()
			go func() { responses <- srv.upload(t, "second.txt", []byte("5678")) }()
			<-quota.arrived
			<-quota.arrived
			close(quota.release)
			successful := 0
			for range 2 {
				if (<-responses).Code == http.StatusOK {
					successful++
				}
			}
			require.Equal(t, 1, successful)
			var stored int64
			require.NoError(t, srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).ColumnExpr("COALESCE(SUM(size),0)").Scan(t.Context(), &stored))
			require.Equal(t, int64(4), stored)
			current, err := srv.usage.CurrentMonthly(t.Context(), "ws-1", entitlements.LimitMediaBytesUploadedMonthly, time.Now())
			require.NoError(t, err)
			require.Equal(t, int64(4), current)
		})
	}
}

type countedUploadReader struct {
	reader io.Reader
	read   int64
}

func (r *countedUploadReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.read += int64(n)
	return n, err
}

type repeatedUploadBytes struct{ remaining int64 }

func (r *repeatedUploadBytes) Read(p []byte) (int, error) {
	if r.remaining == 0 {
		return 0, io.EOF
	}
	n := int(min(int64(len(p)), r.remaining))
	for i := range p[:n] {
		p[i] = 'x'
	}
	r.remaining -= int64(n)
	return n, nil
}
func TestLegacyUploadRejectsOverAllowanceBeforeSpoolingFullBody(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name                 string
		declared, authorized bool
	}{{"declared", true, true}, {"streamed", false, true}, {"no authorized workspace", false, false}} {
		t.Run(tc.name, func(t *testing.T) {
			srv := newMediaQuotaTestServer(t, entitlements.NewStaticService(entitlements.PlanSnapshot{Limits: map[entitlements.LimitKey]int64{entitlements.LimitMediaBytesStored: 4}}))
			if !tc.authorized {
				_, err := srv.db.NewDelete().Model((*models.WorkspaceMember)(nil)).Where("user_id = ?", "user-1").Exec(t.Context())
				require.NoError(t, err)
			}
			prefix := "--bounded\r\nContent-Disposition: form-data; name=\"file\"; filename=\"huge.mp4\"\r\nContent-Type: video/mp4\r\n\r\n"
			suffix := "\r\n--bounded\r\nContent-Disposition: form-data; name=\"workspace_id\"\r\n\r\nws-1\r\n--bounded--\r\n"
			body := &countedUploadReader{reader: io.MultiReader(strings.NewReader(prefix), &repeatedUploadBytes{remaining: 100 * 1024 * 1024}, strings.NewReader(suffix))}
			req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/media/upload", body)
			if tc.declared {
				req.ContentLength = int64(len(prefix)+len(suffix)) + 100*1024*1024
			} else {
				req.ContentLength = -1
			}
			req.Header.Set("Content-Type", "multipart/form-data; boundary=bounded")
			req.Header.Set("Authorization", "Bearer web-token")
			resp := httptest.NewRecorder()
			srv.echo.ServeHTTP(resp, req)
			if tc.authorized {
				require.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
			} else {
				require.Equal(t, http.StatusForbidden, resp.Code)
			}
			if tc.declared || !tc.authorized {
				require.Zero(t, body.read)
			} else {
				require.LessOrEqual(t, body.read, MaxBufferedMediaUploadBytes+512*1024+1)
			}
			count, err := srv.db.NewSelect().Model((*models.MediaAttachment)(nil)).Count(t.Context())
			require.NoError(t, err)
			require.Zero(t, count)
		})
	}
}
