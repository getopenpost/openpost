package handlers

import (
	"bytes"
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
	"github.com/openpost/backend/internal/services/apitokens"
	"github.com/stretchr/testify/require"
)

func TestAPITokenHandlerCreatesWorkspaceScopedToken(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAPITokenHandler(apitokens.NewService(db), testAuthenticator{}, db).RegisterRoutes(api)

	resp := apiTokenRequest(t, e, map[string]any{
		"name":         "Scoped MCP",
		"scope":        "mcp:full",
		"workspace_id": "ws-1",
	})
	require.Equal(t, http.StatusCreated, resp.Code, resp.Body.String())

	var out struct {
		Token string `json:"token"`
		Item  struct {
			Scope       string `json:"scope"`
			WorkspaceID string `json:"workspace_id"`
		} `json:"item"`
	}
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.NotEmpty(t, out.Token)
	require.Equal(t, "mcp:full", out.Item.Scope)
	require.Equal(t, "ws-1", out.Item.WorkspaceID)

	var stored models.APIToken
	require.NoError(t, db.NewSelect().Model(&stored).Where("name = ?", "Scoped MCP").Scan(ctx))
	require.Equal(t, "ws-1", stored.WorkspaceID)
}

func TestAPITokenHandlerRejectsInaccessibleWorkspaceScope(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAPITokenHandler(apitokens.NewService(db), testAuthenticator{}, db).RegisterRoutes(api)

	resp := apiTokenRequest(t, e, map[string]any{
		"name":         "Bad Scope",
		"scope":        "mcp:full",
		"workspace_id": "ws-missing",
	})
	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
}

func TestAPITokenHandlerScopedCallerCannotMintUnscopedToken(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAPITokenHandler(apitokens.NewService(db), mcpScopeAuthenticator{
		"scoped-token": {
			UserID:      "user-1",
			Email:       "user@example.com",
			Scope:       "mcp:full",
			WorkspaceID: "ws-1",
		},
	}, db).RegisterRoutes(api)

	resp := apiTokenRequestWithToken(t, e, "scoped-token", map[string]any{
		"name":  "Child token",
		"scope": "mcp:full",
	})
	require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "not authorized for this API resource")
}

func apiTokenRequest(t *testing.T, e *echo.Echo, body map[string]any) *httptest.ResponseRecorder {
	return apiTokenRequestWithToken(t, e, "web-token", body)
}

func apiTokenRequestWithToken(t *testing.T, e *echo.Echo, token string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()

	var payload bytes.Buffer
	require.NoError(t, json.NewEncoder(&payload).Encode(body))
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/api-tokens", &payload)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
