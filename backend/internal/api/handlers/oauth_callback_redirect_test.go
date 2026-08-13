package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

func TestOAuthCallbackAccountSelectionRedirectsExposeFinalLocationHeader(t *testing.T) {
	t.Parallel()

	for _, providerName := range []string{"facebook", "instagram"} {
		t.Run(providerName, func(t *testing.T) {
			t.Parallel()

			e, state := newOAuthCallbackRedirectTestServer(t, providerName, &selectionTestAdapter{}, "https://app.openpost.test")

			rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/"+providerName+"/callback?code=provider-code&state="+url.QueryEscape(state), nil, false)
			result := rec.Result()
			t.Cleanup(func() { _ = result.Body.Close() })

			require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
			location := result.Header.Get("Location")
			require.NotEmpty(t, location)
			require.Contains(t, location, "https://app.openpost.test/accounts/callback")
			require.Contains(t, location, "status=selection_required")
			require.Contains(t, location, "platform="+providerName)
		})
	}
}

func TestOAuthCallbackErrorRedirectExposesFinalLocationHeader(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t)
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), nil, testAuthenticator{}, false, "https://app.openpost.test")
	handler.Callback(api)

	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/threads/callback?error=access_denied&error_description=Nope", nil, false)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(t, "https://app.openpost.test/settings?tab=accounts&error=access_denied%3A+Nope", result.Header.Get("Location"))
}

func newOAuthCallbackRedirectTestServer(t *testing.T, providerName string, adapter platform.Adapter, frontendURL string) (*echo.Echo, string) {
	t.Helper()

	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), map[string]platform.Adapter{
		providerName: adapter,
	}, testAuthenticator{}, false, frontendURL)
	handler.SetProviderReadiness(oauthConnectionReadiness(
		t,
		&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled},
		platform.AppConfig{Provider: providerName, ClientID: providerName + "-app"},
	))
	handler.GetAuthURL(api)
	handler.Callback(api)

	authURLResp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/"+providerName+"/auth-url?workspace_id=ws-1", nil, true)
	require.Equal(t, http.StatusOK, authURLResp.Code, authURLResp.Body.String())
	var authURLBody struct {
		URL string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(authURLResp.Body.Bytes(), &authURLBody))
	parsedAuthURL, err := url.Parse(authURLBody.URL)
	require.NoError(t, err)
	state := parsedAuthURL.Query().Get("state")
	require.NotEmpty(t, state)

	return e, state
}
