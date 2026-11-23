package handlers

import (
	"context"

	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type mcpActivityTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newMCPActivityTestServer(t *testing.T) *mcpActivityTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.MCPToolCall)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-2", Name: "Other"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewMCPActivityHandler(db, testAuthenticator{}).RegisterRoutes(api)
	return &mcpActivityTestServer{echo: e, db: db}
}

func TestListMCPActivityRejectsForeignWorkspace(t *testing.T) {
	t.Parallel()

	srv := newMCPActivityTestServer(t)

	resp := srv.getJSON(t, "/api/v1/mcp/activity?workspace_id=ws-2", "web-token")

	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "workspace not accessible")
}

func (s *mcpActivityTestServer) getJSON(t *testing.T, path string, token string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}
