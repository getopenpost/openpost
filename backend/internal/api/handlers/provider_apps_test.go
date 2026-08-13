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
	"github.com/openpost/backend/internal/api/middleware"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/providerapps"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type providerAppAdminTestServer struct {
	echo      *echo.Echo
	db        *bun.DB
	encryptor *crypto.TokenEncryptor
}

func newProviderAppAdminTestServer(t *testing.T, isAdmin bool, options ...ProviderAppHandlerOption) *providerAppAdminTestServer {
	return newProviderAppAdminTestServerWithAuthenticator(t, isAdmin, browserSessionTestAuthenticator(), options...)
}

func newProviderAppAdminTestServerWithAuthenticator(
	t *testing.T,
	isAdmin bool,
	authenticator middleware.Authenticator,
	options ...ProviderAppHandlerOption,
) *providerAppAdminTestServer {
	t.Helper()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.ProviderApp)(nil))
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		IsAdmin:      isAdmin,
		CreatedAt:    time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	NewProviderAppHandler(providerapps.NewService(db, encryptor), db, authenticator, options...).RegisterRoutes(api)
	return &providerAppAdminTestServer{echo: e, db: db, encryptor: encryptor}
}

func TestProviderAppAdminRejectsBearerAdminTokens(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServerWithAuthenticator(t, true, unboundCLIFullTestAuthenticator())
	requests := []struct {
		method string
		path   string
		body   any
	}{
		{method: http.MethodGet, path: "/api/v1/admin/provider-apps"},
		{method: http.MethodPost, path: "/api/v1/admin/provider-apps", body: map[string]any{"provider": "x", "client_id": "x-client"}},
		{method: http.MethodDelete, path: "/api/v1/admin/provider-apps/missing"},
	}
	for _, request := range requests {
		response := srv.requestJSON(t, request.method, request.path, request.body)
		require.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
		require.Contains(t, response.Body.String(), "browser session")
	}
}

func (s *providerAppAdminTestServer) requestJSON(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	return s.requestJSONWithToken(t, method, path, body, "web-token")
}

func (s *providerAppAdminTestServer) requestJSONWithToken(t *testing.T, method, path string, body any, token string) *httptest.ResponseRecorder {
	t.Helper()

	var payload bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&payload).Encode(body))
	}
	req := httptest.NewRequestWithContext(t.Context(), method, path, &payload)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func TestProviderAppAdminUpsertsEncryptedAppAndListsRedactedRows(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, true)
	secret := "x-secret"
	resp := srv.requestJSON(t, http.MethodPost, "/api/v1/admin/provider-apps", map[string]any{
		"provider":      " X ",
		"client_id":     " x-client ",
		"client_secret": secret,
		"redirect_uri":  " https://app.test/api/v1/accounts/x/callback ",
	})

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	require.NotContains(t, resp.Body.String(), secret)
	var saved SaveProviderAppResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &saved))
	require.False(t, saved.Existed)
	require.True(t, saved.RequiresRestart)
	require.Equal(t, "x", saved.App.Provider)
	require.Equal(t, "x-client", saved.App.ClientID)
	require.True(t, saved.App.SecretConfigured)

	var stored models.ProviderApp
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", saved.App.ID).Scan(context.Background()))
	require.NotEqual(t, []byte(secret), stored.ClientSecretEnc)
	decrypted, err := srv.encryptor.Decrypt(stored.ClientSecretEnc)
	require.NoError(t, err)
	require.Equal(t, secret, decrypted)

	listResp := srv.requestJSON(t, http.MethodGet, "/api/v1/admin/provider-apps", nil)
	require.Equal(t, http.StatusOK, listResp.Code, listResp.Body.String())
	require.NotContains(t, listResp.Body.String(), secret)
	var list []ProviderAppResponse
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &list))
	require.Len(t, list, 1)
	require.Equal(t, saved.App.ID, list[0].ID)
	require.True(t, list[0].SecretConfigured)
}

func TestProviderAppAdminUpdateCanPreserveExistingSecretAndDeactivate(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, true)
	secret := "x-secret"
	createResp := srv.requestJSON(t, http.MethodPost, "/api/v1/admin/provider-apps", map[string]any{
		"provider":      "x",
		"client_id":     "x-client",
		"client_secret": secret,
	})
	require.Equal(t, http.StatusOK, createResp.Code, createResp.Body.String())
	var created SaveProviderAppResponse
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &created))

	updateResp := srv.requestJSON(t, http.MethodPost, "/api/v1/admin/provider-apps", map[string]any{
		"provider":  "x",
		"client_id": "updated-client",
		"is_active": false,
	})
	require.Equal(t, http.StatusOK, updateResp.Code, updateResp.Body.String())
	var updated SaveProviderAppResponse
	require.NoError(t, json.Unmarshal(updateResp.Body.Bytes(), &updated))
	require.True(t, updated.Existed)
	require.Equal(t, created.App.ID, updated.App.ID)
	require.False(t, updated.App.IsActive)

	var stored models.ProviderApp
	require.NoError(t, srv.db.NewSelect().Model(&stored).Where("id = ?", created.App.ID).Scan(context.Background()))
	require.Equal(t, "updated-client", stored.ClientID)
	require.False(t, stored.IsActive)
	decrypted, err := srv.encryptor.Decrypt(stored.ClientSecretEnc)
	require.NoError(t, err)
	require.Equal(t, secret, decrypted)
}

func TestProviderAppAdminRequiresInstanceAdmin(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, false)
	requests := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{name: "list", method: http.MethodGet, path: "/api/v1/admin/provider-apps"},
		{name: "save", method: http.MethodPost, path: "/api/v1/admin/provider-apps", body: map[string]any{"provider": "x", "client_id": "x-client"}},
		{name: "delete", method: http.MethodDelete, path: "/api/v1/admin/provider-apps/missing"},
	}
	for _, request := range requests {
		t.Run(request.name, func(t *testing.T) {
			resp := srv.requestJSON(t, request.method, request.path, request.body)
			require.Equal(t, http.StatusForbidden, resp.Code, resp.Body.String())
			require.Contains(t, resp.Body.String(), "instance admin role required")
		})
	}
}

func TestProviderAppAdminRequiresAuthenticationForEveryRoute(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, true)
	requests := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{name: "list", method: http.MethodGet, path: "/api/v1/admin/provider-apps"},
		{name: "save", method: http.MethodPost, path: "/api/v1/admin/provider-apps", body: map[string]any{"provider": "x", "client_id": "x-client"}},
		{name: "delete", method: http.MethodDelete, path: "/api/v1/admin/provider-apps/missing"},
	}
	for _, request := range requests {
		t.Run(request.name, func(t *testing.T) {
			resp := srv.requestJSONWithToken(t, request.method, request.path, request.body, "")
			require.Equal(t, http.StatusUnauthorized, resp.Code, resp.Body.String())
		})
	}
}

func TestProviderAppAdminRejectsWorkspaceScopedTokens(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.User)(nil), (*models.ProviderApp)(nil))
	_, err := db.NewInsert().Model(&models.User{
		ID:           "user-1",
		Email:        "user@example.com",
		PasswordHash: "hash",
		IsAdmin:      true,
		CreatedAt:    time.Now().UTC(),
	}).Exec(context.Background())
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	NewProviderAppHandler(providerapps.NewService(db, encryptor), db, workspaceTestAuthenticator{
		"scoped-token": {
			UserID: "user-1", Email: "user@example.com", WorkspaceID: "ws-1", SessionID: "browser-session",
		},
	}).RegisterRoutes(api)

	requests := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{name: "list", method: http.MethodGet, path: "/api/v1/admin/provider-apps"},
		{name: "save", method: http.MethodPost, path: "/api/v1/admin/provider-apps", body: map[string]any{"provider": "x", "client_id": "x-client"}},
		{name: "delete", method: http.MethodDelete, path: "/api/v1/admin/provider-apps/missing"},
	}
	for _, request := range requests {
		t.Run(request.name, func(t *testing.T) {
			var payload bytes.Buffer
			if request.body != nil {
				require.NoError(t, json.NewEncoder(&payload).Encode(request.body))
			}
			req := httptest.NewRequestWithContext(t.Context(), request.method, request.path, &payload)
			req.Header.Set("Authorization", "Bearer scoped-token")
			if request.body != nil {
				req.Header.Set("Content-Type", "application/json")
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)

			require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
			require.Contains(t, rec.Body.String(), "unscoped credentials")
		})
	}
}

func TestProviderAppAdminRejectsUnsupportedProvider(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, true)
	for _, provider := range []string{"reddit", "bluesky", "discord"} {
		resp := srv.requestJSON(t, http.MethodPost, "/api/v1/admin/provider-apps", map[string]any{
			"provider":  provider,
			"client_id": provider + "-client",
		})
		require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
		require.Contains(t, resp.Body.String(), "unsupported provider app")
	}

	resp := srv.requestJSON(t, http.MethodPost, "/api/v1/admin/provider-apps", map[string]any{
		"provider": "x", "client_id": "x-client", "instance_url": "https://example.social",
	})
	require.Equal(t, http.StatusBadRequest, resp.Code, resp.Body.String())
	require.Contains(t, resp.Body.String(), "instance_url is only supported for mastodon")
}

func TestProviderAppAdminDeletesRows(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, true)
	createResp := srv.requestJSON(t, http.MethodPost, "/api/v1/admin/provider-apps", map[string]any{
		"provider":  "x",
		"client_id": "x-client",
	})
	require.Equal(t, http.StatusOK, createResp.Code, createResp.Body.String())
	var created SaveProviderAppResponse
	require.NoError(t, json.Unmarshal(createResp.Body.Bytes(), &created))

	deleteResp := srv.requestJSON(t, http.MethodDelete, "/api/v1/admin/provider-apps/"+created.App.ID, nil)
	require.Equal(t, http.StatusOK, deleteResp.Code, deleteResp.Body.String())
	var deleted DeleteProviderAppResponse
	require.NoError(t, json.Unmarshal(deleteResp.Body.Bytes(), &deleted))
	require.True(t, deleted.RequiresRestart)

	listResp := srv.requestJSON(t, http.MethodGet, "/api/v1/admin/provider-apps", nil)
	require.Equal(t, http.StatusOK, listResp.Code, listResp.Body.String())
	var list []ProviderAppResponse
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &list))
	require.Empty(t, list)

	deleteResp = srv.requestJSON(t, http.MethodDelete, "/api/v1/admin/provider-apps/"+created.App.ID, nil)
	require.Equal(t, http.StatusNotFound, deleteResp.Code, deleteResp.Body.String())
}

func TestProviderAppAdminShowsEnvironmentAppsAsLockedAndRejectsOverrides(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, true, WithEnvironmentProviderApps([]platform.AppConfig{{
		Provider: "x", ClientID: "environment-client", ClientSecret: "environment-secret",
		RedirectURI: "https://app.test/api/v1/accounts/x/callback",
	}}))
	listResp := srv.requestJSON(t, http.MethodGet, "/api/v1/admin/provider-apps", nil)
	require.Equal(t, http.StatusOK, listResp.Code, listResp.Body.String())
	require.NotContains(t, listResp.Body.String(), "environment-secret")
	var list []ProviderAppResponse
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &list))
	require.Len(t, list, 1)
	require.Equal(t, "environment", list[0].Source)
	require.False(t, list[0].Editable)
	require.True(t, list[0].SecretConfigured)

	saveResp := srv.requestJSON(t, http.MethodPost, "/api/v1/admin/provider-apps", map[string]any{
		"provider": "x", "client_id": "database-client", "client_secret": "database-secret",
	})
	require.Equal(t, http.StatusConflict, saveResp.Code, saveResp.Body.String())
	require.NotContains(t, saveResp.Body.String(), "database-secret")
}

func TestProviderAppAdminExposesShadowedDatabaseFallbackForDeletion(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, true, WithEnvironmentProviderApps([]platform.AppConfig{{
		Provider: "x", ClientID: "environment-client", ClientSecret: "environment-secret",
	}}))
	secret, err := srv.encryptor.Encrypt("database-secret")
	require.NoError(t, err)
	_, err = srv.db.NewInsert().Model(&models.ProviderApp{
		ID: "database-x", Provider: "x", ClientID: "database-client", ClientSecretEnc: secret,
		IsActive: true, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)

	listResp := srv.requestJSON(t, http.MethodGet, "/api/v1/admin/provider-apps", nil)
	require.Equal(t, http.StatusOK, listResp.Code, listResp.Body.String())
	var list []ProviderAppResponse
	require.NoError(t, json.Unmarshal(listResp.Body.Bytes(), &list))
	require.Len(t, list, 2)
	var fallback ProviderAppResponse
	for _, app := range list {
		if app.Source == "database" {
			fallback = app
		}
	}
	require.True(t, fallback.Shadowed)
	require.False(t, fallback.Editable)
	require.True(t, fallback.Deletable)

	deleteResp := srv.requestJSON(t, http.MethodDelete, "/api/v1/admin/provider-apps/"+fallback.ID, nil)
	require.Equal(t, http.StatusOK, deleteResp.Code, deleteResp.Body.String())
}

func TestProviderAppAdminDerivesDefaultCallbackFromFrontendURL(t *testing.T) {
	t.Parallel()

	srv := newProviderAppAdminTestServer(t, true, WithProviderAppFrontendURL("https://app.test/"))
	resp := srv.requestJSON(t, http.MethodPost, "/api/v1/admin/provider-apps", map[string]any{
		"provider": "youtube", "client_id": "youtube-client", "client_secret": "youtube-secret",
	})
	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var saved SaveProviderAppResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &saved))
	require.Equal(t, "https://app.test/api/v1/accounts/youtube/callback", saved.App.RedirectURI)
}
