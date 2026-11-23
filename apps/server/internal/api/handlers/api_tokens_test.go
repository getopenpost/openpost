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
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
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
			ExpiresAt   string `json:"expires_at"`
			Status      string `json:"status"`
		} `json:"item"`
	}
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.NotEmpty(t, out.Token)
	require.Equal(t, "mcp:full", out.Item.Scope)
	require.Equal(t, "ws-1", out.Item.WorkspaceID)
	require.NotEmpty(t, out.Item.ExpiresAt)
	require.Equal(t, "active", out.Item.Status)

	var stored models.APIToken
	require.NoError(t, db.NewSelect().Model(&stored).Where("name = ?", "Scoped MCP").Scan(ctx))
	require.Equal(t, "ws-1", stored.WorkspaceID)
}

func TestAPITokenHandlerCreatesListsAndRevokesNeverExpiringToken(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.APIToken)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAPITokenHandler(apitokens.NewService(db), testAuthenticator{}, db).RegisterRoutes(api)

	ambiguous := apiTokenRequest(t, e, map[string]any{
		"name": "Ambiguous", "scope": "api:read", "never_expires": true,
		"expires_at": time.Now().UTC().Add(time.Hour),
	})
	require.Equal(t, http.StatusBadRequest, ambiguous.Code, ambiguous.Body.String())

	created := apiTokenRequest(t, e, map[string]any{
		"name": "Home server", "scope": "api:read", "never_expires": true,
	})
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
	var out struct {
		Token string         `json:"token"`
		Item  map[string]any `json:"item"`
	}
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &out))
	require.NotEmpty(t, out.Token)
	require.NotContains(t, out.Item, "expires_at", "a token without an expiry must not report one")
	require.Equal(t, "active", out.Item["status"])
	tokenID, ok := out.Item["id"].(string)
	require.True(t, ok)

	var tokens []models.APIToken
	require.NoError(t, db.NewSelect().Model(&tokens).Scan(t.Context()))
	require.Len(t, tokens, 1, "the ambiguous request must not create a token")
	require.True(t, tokens[0].ExpiresAt.IsZero())

	list := apiTokenMethodRequest(t, e, http.MethodGet, "/api/v1/api-tokens", "web-token")
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	var listed []map[string]any
	require.NoError(t, json.Unmarshal(list.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	require.NotContains(t, listed[0], "expires_at")
	require.Equal(t, "active", listed[0]["status"])

	revoke := apiTokenMethodRequest(t, e, http.MethodDelete, "/api/v1/api-tokens/"+tokenID, "web-token")
	require.Equal(t, http.StatusOK, revoke.Code, revoke.Body.String())
	_, err = apitokens.NewService(db).ValidateToken(t.Context(), out.Token)
	require.ErrorIs(t, err, apitokens.ErrRevokedToken)
}

func TestWorkspaceBoundCLITokenRetainsAccountLevelTokenManagement(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.APIToken)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.APIToken{
		ID: "target-token", UserID: "user-1", Name: "Target", TokenHash: "target-hash",
		TokenPrefix: "target", Scope: apitokens.ScopeAPIRead, ExpiresAt: time.Now().UTC().Add(time.Hour),
	}).Exec(t.Context())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAPITokenHandler(apitokens.NewService(db), mcpScopeAuthenticator{
		"bound-cli-token": {
			UserID: "user-1", Email: "user@example.com", Scope: apitokens.ScopeCLI,
			WorkspaceID: "ws-1", TokenID: "caller-token",
		},
	}, db).RegisterRoutes(api)

	_, err = db.NewUpdate().Model((*models.APIToken)(nil)).
		Set("expires_at = ?", time.Now().UTC().Add(-time.Minute)).Where("id = ?", "target-token").Exec(t.Context())
	require.NoError(t, err)
	list := apiTokenMethodRequest(t, e, http.MethodGet, "/api/v1/api-tokens", "bound-cli-token")
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	var listed []APITokenResponse
	require.NoError(t, json.Unmarshal(list.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	require.Equal(t, "target-token", listed[0].ID)
	require.Equal(t, "expired", listed[0].Status)

	revoke := apiTokenMethodRequest(
		t, e, http.MethodDelete, "/api/v1/api-tokens/target-token", "bound-cli-token",
	)
	require.Equal(t, http.StatusOK, revoke.Code, revoke.Body.String())

	var stored models.APIToken
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", "target-token").Scan(t.Context()))
	require.False(t, stored.RevokedAt.IsZero())
	list = apiTokenMethodRequest(t, e, http.MethodGet, "/api/v1/api-tokens", "bound-cli-token")
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	require.NoError(t, json.Unmarshal(list.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	require.Equal(t, "target-token", listed[0].ID)
	require.Equal(t, "revoked", listed[0].Status)
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

func apiTokenMethodRequest(
	t *testing.T,
	e *echo.Echo,
	method,
	path,
	token string,
) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}
