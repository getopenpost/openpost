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
	"github.com/uptrace/bun"
)

const fediverseOAuthTestInstance = "https://social.example"

type invalidProfileMastodonAdapter struct {
	*readinessMastodonAdapter
}

func (*invalidProfileMastodonAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	return "https://social.example/oauth/authorize?state=" + url.QueryEscape(state), nil
}

func (a *invalidProfileMastodonAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	a.profileCalls++
	return nil, &platform.HTTPError{StatusCode: http.StatusUnauthorized, Code: "invalid_token"}
}

func newFediverseOAuthProfileFailureServer(t *testing.T, provider string) (*echo.Echo, *invalidProfileMastodonAdapter, *bun.DB) {
	t.Helper()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	seedOAuthTestWorkspace(t, db)
	insertOAuthReadinessWorkspaceMember(t, db)

	adapter := &invalidProfileMastodonAdapter{readinessMastodonAdapter: &readinessMastodonAdapter{}}
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), map[string]platform.Adapter{
		provider + ":" + fediverseOAuthTestInstance: adapter,
	}, testAuthenticator{}, false, "https://app.openpost.test")
	handler.SetProviderReadiness(oauthConnectionReadiness(t,
		&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled, approved: true},
		platform.AppConfig{Provider: provider, ClientID: provider + "-app", InstanceURL: fediverseOAuthTestInstance},
	))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.GetAuthURL(api)
	handler.Callback(api)
	handler.ExchangeCode(api)
	return e, adapter, db
}

func TestFediverseOAuthCallbackRejectsProfileLookupFailure(t *testing.T) {
	for _, provider := range []string{mastodonProvider, pixelfedProvider} {
		t.Run(provider, func(t *testing.T) {
			t.Parallel()
			e, adapter, db := newFediverseOAuthProfileFailureServer(t, provider)
			started := oauthSelectionRequest(t, e, http.MethodGet,
				"/api/v1/accounts/"+provider+"/auth-url?workspace_id=ws-1&server_name="+url.QueryEscape(fediverseOAuthTestInstance), nil, true)
			require.Equal(t, http.StatusOK, started.Code, started.Body.String())
			var body struct {
				URL string `json:"url"`
			}
			require.NoError(t, json.Unmarshal(started.Body.Bytes(), &body))
			authURL, err := url.Parse(body.URL)
			require.NoError(t, err)
			state := authURL.Query().Get("state")
			require.NotEmpty(t, state)

			callback := oauthSelectionRequest(t, e, http.MethodGet,
				"/api/v1/accounts/"+provider+"/callback?code=provider-code&state="+url.QueryEscape(state), nil, true)
			require.Equal(t, http.StatusTemporaryRedirect, callback.Code)
			require.Contains(t, callback.Header().Get("Location"), "oauth_reason=profile_fetch_failed")
			require.Equal(t, 1, adapter.profileCalls)
			assertFediverseOAuthFailureSavedNothing(t, db)
		})
	}
}

func TestFediverseOOBExchangeRejectsProfileLookupFailure(t *testing.T) {
	for _, provider := range []string{mastodonProvider, pixelfedProvider} {
		t.Run(provider, func(t *testing.T) {
			e, adapter, db := newFediverseOAuthProfileFailureServer(t, provider)
			resp := oauthSelectionRequest(t, e, http.MethodPost, "/api/v1/accounts/"+provider+"/exchange", map[string]string{
				"workspace_id": "ws-1",
				"server_name":  fediverseOAuthTestInstance,
				"instance_url": "",
				"code":         "provider-code",
				"intent":       "production",
			}, true)
			require.Equal(t, http.StatusInternalServerError, resp.Code, resp.Body.String())
			require.Equal(t, 1, adapter.profileCalls)
			assertFediverseOAuthFailureSavedNothing(t, db)
		})
	}
}

func assertFediverseOAuthFailureSavedNothing(t *testing.T, db *bun.DB) {
	t.Helper()
	accountCount, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, accountCount)
	grantCount, err := db.NewSelect().Model((*models.OAuthGrant)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, grantCount)
}
