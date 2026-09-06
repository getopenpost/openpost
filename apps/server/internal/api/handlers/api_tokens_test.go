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

func TestAPITokenHandlerRejectsMissingNameAndUnsafeExpiry(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t,
		(*models.Workspace)(nil),
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.APIToken)(nil),
	)
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAPITokenHandler(apitokens.NewService(db), testAuthenticator{}, db).RegisterRoutes(api)

	missingName := apiTokenRequest(t, e, map[string]any{"scope": "api:read"})
	require.Equal(t, http.StatusUnprocessableEntity, missingName.Code, missingName.Body.String())

	pastExpiry := apiTokenRequest(t, e, map[string]any{
		"name": "Expired", "scope": "api:read", "expires_at": time.Now().UTC().Add(-time.Hour),
	})
	require.Equal(t, http.StatusBadRequest, pastExpiry.Code, pastExpiry.Body.String())
}

func TestAPITokenHandlerAlignsOmittedNullAndCustomExpiry(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.APIToken)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user@example.com", PasswordHash: "hash", CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAPITokenHandler(apitokens.NewService(db), testAuthenticator{}, db).RegisterRoutes(api)

	before := time.Now().UTC()
	for _, request := range []map[string]any{
		{"name": "Omitted", "scope": "api:read"},
		{"name": "Null", "scope": "api:read", "expires_at": nil},
	} {
		response := apiTokenRequest(t, e, request)
		require.Equal(t, http.StatusCreated, response.Code, response.Body.String())
	}
	custom := before.Add(30 * 24 * time.Hour)
	response := apiTokenRequest(t, e, map[string]any{
		"name": "Custom", "scope": "api:write", "expires_at": custom,
	})
	require.Equal(t, http.StatusCreated, response.Code, response.Body.String())

	var tokens []models.APIToken
	require.NoError(t, db.NewSelect().Model(&tokens).Order("name ASC").Scan(t.Context()))
	require.Len(t, tokens, 3)
	for _, token := range tokens {
		if token.Name == "Custom" {
			require.WithinDuration(t, custom, token.ExpiresAt, time.Second)
			continue
		}
		require.WithinDuration(t, before.Add(apitokens.DefaultExpiration), token.ExpiresAt, 5*time.Second)
	}
}

func TestAPITokenResponseDistinguishesExpiredAndRevoked(t *testing.T) {
	now := time.Now().UTC()
	expired := apiTokenResponse(models.APIToken{ExpiresAt: now.Add(-time.Minute)})
	require.Equal(t, "expired", expired.Status)
	revoked := apiTokenResponse(models.APIToken{ExpiresAt: now.Add(time.Hour), RevokedAt: now})
	require.Equal(t, "revoked", revoked.Status)
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
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewAPITokenHandler(apitokens.NewService(db), mcpScopeAuthenticator{
		"bound-cli-token": {
			UserID: "user-1", Email: "user@example.com", Scope: apitokens.ScopeCLI,
			WorkspaceID: "ws-1", TokenID: "caller-token",
		},
	}, db).RegisterRoutes(api)

	list := apiTokenMethodRequest(t, e, http.MethodGet, "/api/v1/api-tokens", "bound-cli-token")
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	require.Contains(t, list.Body.String(), "target-token")

	revoke := apiTokenMethodRequest(
		t, e, http.MethodDelete, "/api/v1/api-tokens/target-token", "bound-cli-token",
	)
	require.Equal(t, http.StatusOK, revoke.Code, revoke.Body.String())

	var stored models.APIToken
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", "target-token").Scan(t.Context()))
	require.False(t, stored.RevokedAt.IsZero())
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
