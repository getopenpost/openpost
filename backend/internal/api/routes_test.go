package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	_ "github.com/mattn/go-sqlite3"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func newSystemTestServer(t *testing.T) (*echo.Echo, *bun.DB) {
	t.Helper()

	sqldb, err := sql.Open("sqlite3", "file:"+t.Name()+"?mode=memory&cache=private")
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	RegisterHealth(api, db)
	t.Cleanup(func() {
		_ = db.Close()
	})
	return e, db
}

func systemGET(t *testing.T, e *echo.Echo, path string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestHealthCheckReturnsLivenessOnly(t *testing.T) {
	t.Parallel()

	e, _ := newSystemTestServer(t)

	resp := systemGET(t, e, "/api/v1/health")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "ok", out["status"])
}

func TestReadinessCheckProbesDatabase(t *testing.T) {
	t.Parallel()

	e, _ := newSystemTestServer(t)

	resp := systemGET(t, e, "/api/v1/ready")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Equal(t, "ready", out["status"])
	require.Equal(t, "ok", out["database"])
}

func TestReadinessCheckFailsWhenDatabaseIsClosed(t *testing.T) {
	t.Parallel()

	e, db := newSystemTestServer(t)
	require.NoError(t, db.Close())

	resp := systemGET(t, e, "/api/v1/ready")

	require.Equal(t, http.StatusServiceUnavailable, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "database is not ready")
}
