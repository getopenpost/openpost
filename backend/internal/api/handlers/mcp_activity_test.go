package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewMCPActivityHandler(db, testAuthenticator{}).RegisterRoutes(api)
	return &mcpActivityTestServer{echo: e, db: db}
}

func TestListMCPActivityFiltersAuthenticatedUserAndWorkspace(t *testing.T) {
	t.Parallel()

	srv := newMCPActivityTestServer(t)
	now := time.Date(2026, 6, 30, 16, 0, 0, 0, time.UTC)
	calls := []models.MCPToolCall{
		{ID: "call-old", UserID: "user-1", WorkspaceID: "ws-1", ToolName: "list_workspaces", Status: "success", DurationMs: 12, CreatedAt: now.Add(-time.Hour)},
		{ID: "call-new", UserID: "user-1", WorkspaceID: "ws-1", ClientID: "token-chatgpt", ClientName: "ChatGPT App", ClientScope: "mcp:full", ClientTokenPrefix: "abcd1234", ToolName: "create_post", Status: "error", ErrorMessage: "workspace not accessible", DurationMs: 40, CreatedAt: now},
		{ID: "call-other-workspace", UserID: "user-1", WorkspaceID: "ws-2", ToolName: "suggest_slots", Status: "success", DurationMs: 8, CreatedAt: now.Add(time.Minute)},
		{ID: "call-other-user", UserID: "user-2", WorkspaceID: "ws-1", ToolName: "list_posts", Status: "success", DurationMs: 5, CreatedAt: now.Add(2 * time.Minute)},
	}
	_, err := srv.db.NewInsert().Model(&calls).Exec(context.Background())
	require.NoError(t, err)

	resp := srv.getJSON(t, "/api/v1/mcp/activity?workspace_id=ws-1&limit=10", "web-token")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out []map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.Len(t, out, 2)
	require.Equal(t, "call-new", out[0]["id"])
	require.Equal(t, "create_post", out[0]["tool_name"])
	require.Equal(t, "error", out[0]["status"])
	require.Equal(t, "token-chatgpt", out[0]["client_id"])
	require.Equal(t, "ChatGPT App", out[0]["client_name"])
	require.Equal(t, "mcp:full", out[0]["client_scope"])
	require.Equal(t, "abcd1234", out[0]["client_token_prefix"])
	require.Equal(t, "workspace not accessible", out[0]["error_message"])
	require.Equal(t, float64(40), out[0]["duration_ms"])
	require.Equal(t, "2026-06-30T16:00:00Z", out[0]["created_at"])
	require.Equal(t, "call-old", out[1]["id"])
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
