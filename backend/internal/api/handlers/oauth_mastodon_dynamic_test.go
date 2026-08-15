package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

func TestGetMastodonProviderReturnsConfiguredInstanceURL(t *testing.T) {
	const instanceURL = "https://social.example"
	handler := &OAuthHandler{providers: map[string]platform.Adapter{
		"mastodon:OpenPost E2E": platform.NewMastodonAdapter(
			"client", "secret", "https://openpost.example/callback", instanceURL,
		),
	}}

	adapter, readinessInstanceURL, err := handler.getMastodonProvider(
		context.Background(), "OpenPost E2E", "",
	)

	require.NoError(t, err)
	require.NotNil(t, adapter)
	require.Equal(t, instanceURL, readinessInstanceURL)
}

func TestGetAuthURLRegistersDynamicMastodonInstance(t *testing.T) {
	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.MastodonInstance)(nil),
		(*models.AuthChallenge)(nil),
		(*models.SocialAccount)(nil),
	)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	var registrationCalls int
	instanceServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/api/v1/apps", r.URL.Path)
		require.NoError(t, r.ParseForm())
		require.Equal(t, "OpenPost", r.Form.Get("client_name"))
		require.Equal(t, "urn:ietf:wg:oauth:2.0:oob", r.Form.Get("redirect_uris"))
		require.Equal(t, "read write", r.Form.Get("scopes"))
		registrationCalls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"client_id":"registered-client","client_secret":"registered-secret"}`))
	}))
	defer instanceServer.Close()

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	encryptor := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	providerCatalog := map[string]platform.Adapter{}
	handler := NewOAuthHandler(db, encryptor, providerCatalog, testAuthenticator{}, false, "https://app.openpost.test")
	handler.SetProviderReadiness(oauthDynamicRegistrationReadiness(
		t,
		&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled},
		mastodonProvider,
	))
	registeredProviders := map[string]platform.Adapter{}
	handler.SetProviderRegistrars(func(key string, adapter platform.Adapter) {
		registeredProviders[key] = adapter
	})
	mastodonAppService := mastodonapps.NewService(db, encryptor, mastodonapps.Options{
		RedirectURI: "urn:ietf:wg:oauth:2.0:oob",
		HTTPClient:  instanceServer.Client(),
		Validator: func(_ context.Context, instanceURL *url.URL) error {
			require.Equal(t, "https", instanceURL.Scheme)
			return nil
		},
	})
	handler.SetMastodonAppService(mastodonAppService)
	handler.GetAuthURL(api)

	req := httptest.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"/api/v1/accounts/mastodon/auth-url?workspace_id=ws-1&instance_url="+url.QueryEscape(instanceServer.URL+"/ignored"),
		nil,
	)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var out struct {
		URL string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	authURL, err := url.Parse(out.URL)
	require.NoError(t, err)
	require.Equal(t, "https", authURL.Scheme)
	require.Equal(t, strings.TrimPrefix(instanceServer.URL, "https://"), authURL.Host)
	require.Equal(t, "/oauth/authorize", authURL.Path)
	require.Equal(t, "registered-client", authURL.Query().Get("client_id"))
	require.Equal(t, "urn:ietf:wg:oauth:2.0:oob", authURL.Query().Get("redirect_uri"))
	require.NotEmpty(t, authURL.Query().Get("state"))
	require.Equal(t, 1, registrationCalls)

	var stored models.MastodonInstance
	require.NoError(t, db.NewSelect().Model(&stored).Where("instance_url = ?", instanceServer.URL).Scan(ctx))
	require.Equal(t, "registered-client", stored.ClientID)

	var state models.AuthChallenge
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", authURL.Query().Get("state")).Scan(ctx))
	require.Contains(t, state.Payload, `"server_name":"`+instanceServer.URL+`"`)
	require.Contains(t, registeredProviders, "mastodon:"+instanceServer.URL)
	require.NotContains(t, providerCatalog, "mastodon:"+instanceServer.URL)

	restartedHandler := NewOAuthHandler(db, encryptor, map[string]platform.Adapter{}, testAuthenticator{}, false, "https://app.openpost.test")
	restartedRegistrations := map[string]platform.Adapter{}
	restartedHandler.SetProviderRegistrars(func(key string, adapter platform.Adapter) {
		restartedRegistrations[key] = adapter
	})
	restartedHandler.SetMastodonAppService(mastodonAppService)
	adapter, canonicalURL, err := restartedHandler.getMastodonProvider(ctx, instanceServer.URL, "")
	require.NoError(t, err)
	require.NotNil(t, adapter)
	require.Equal(t, instanceServer.URL, canonicalURL)
	require.Equal(t, 1, registrationCalls)
	require.Same(t, adapter, restartedRegistrations["mastodon:"+instanceServer.URL])
}
