package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/services/mediastore"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newSystemTestServer(t *testing.T, storages ...mediastore.BlobStorage) (*echo.Echo, *bun.DB, *Readiness) {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	readiness := NewReadiness()
	var storage mediastore.BlobStorage
	if len(storages) > 0 {
		storage = storages[0]
	}
	RegisterHealth(api, db, readiness, storage)
	RegisterVersion(api, BuildInfo{Version: "v1.2.3", Revision: "abcdef", Edition: "cloud"})
	t.Cleanup(func() {
		_ = db.Close()
	})
	return e, db, readiness
}

type systemReadinessStorage struct {
	err error
}

func (*systemReadinessStorage) Driver() string { return "s3" }
func (*systemReadinessStorage) Save(context.Context, string, io.Reader) (string, error) {
	return "", nil
}
func (*systemReadinessStorage) Delete(context.Context, string) error { return nil }
func (*systemReadinessStorage) GetURL(string) string                 { return "" }
func (*systemReadinessStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return nil, nil
}
func (s *systemReadinessStorage) CheckReady(context.Context) error { return s.err }

func systemGET(t *testing.T, e *echo.Echo, path string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestSystemEndpointsReportLivenessAndRunningRevision(t *testing.T) {
	t.Parallel()

	e, _, _ := newSystemTestServer(t)

	health := systemGET(t, e, "/api/v1/health")
	require.Equal(t, http.StatusOK, health.Code, health.Body.String())
	var healthOut map[string]any
	require.NoError(t, json.Unmarshal(health.Body.Bytes(), &healthOut))
	require.Equal(t, "ok", healthOut["status"])

	version := systemGET(t, e, "/api/v1/version")
	require.Equal(t, http.StatusOK, version.Code, version.Body.String())
	var versionOut map[string]any
	require.NoError(t, json.Unmarshal(version.Body.Bytes(), &versionOut))
	require.Equal(t, "v1.2.3", versionOut["version"])
	require.Equal(t, "abcdef", versionOut["revision"])
	require.Equal(t, "cloud", versionOut["edition"])
}

func TestReadinessLifecycle(t *testing.T) {
	t.Parallel()

	t.Run("healthy database reports ready", func(t *testing.T) {
		e, _, _ := newSystemTestServer(t)

		resp := systemGET(t, e, "/api/v1/ready")

		require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
		var out map[string]any
		require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
		require.Equal(t, "ready", out["status"])
		require.Equal(t, "ok", out["database"])
	})

	t.Run("closed database fails readiness", func(t *testing.T) {
		e, db, _ := newSystemTestServer(t)
		require.NoError(t, db.Close())

		resp := systemGET(t, e, "/api/v1/ready")

		require.Equal(t, http.StatusServiceUnavailable, resp.Code, resp.Body.String())
		require.Contains(t, resp.Body.String(), "database is not ready")
	})

	t.Run("draining process fails readiness but remains live", func(t *testing.T) {
		e, _, readiness := newSystemTestServer(t)
		readiness.BeginDrain()

		readyResponse := systemGET(t, e, "/api/v1/ready")
		require.Equal(t, http.StatusServiceUnavailable, readyResponse.Code, readyResponse.Body.String())
		require.Contains(t, readyResponse.Body.String(), "process is draining")

		healthResponse := systemGET(t, e, "/api/v1/health")
		require.Equal(t, http.StatusOK, healthResponse.Code, healthResponse.Body.String())
	})
}

func TestReadinessLifecycleObjectStorageAndDrain(t *testing.T) {
	t.Parallel()

	t.Run("unavailable object storage fails readiness", func(t *testing.T) {
		e, _, _ := newSystemTestServer(t, &systemReadinessStorage{err: errors.New("bucket unavailable")})

		resp := systemGET(t, e, "/api/v1/ready")

		require.Equal(t, http.StatusServiceUnavailable, resp.Code, resp.Body.String())
		require.Contains(t, resp.Body.String(), "object storage is not ready")
	})

	t.Run("healthy object storage reports ready", func(t *testing.T) {
		e, _, _ := newSystemTestServer(t, &systemReadinessStorage{})

		resp := systemGET(t, e, "/api/v1/ready")

		require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
		var out map[string]any
		require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
		require.Equal(t, "ok", out["storage"])
	})
}
