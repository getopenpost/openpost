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

type instagramLoginTestAdapter struct {
	selectionTestAdapter
	profileErr error
}

func (a *instagramLoginTestAdapter) ExchangeCode(ctx context.Context, code string, extra map[string]string) (*platform.TokenResult, error) {
	token, err := a.selectionTestAdapter.ExchangeCode(ctx, code, extra)
	if err == nil {
		token.Extra["user_id"] = "instagram-app-scoped-user"
	}
	return token, err
}

func (a *instagramLoginTestAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	if a.profileErr != nil {
		return nil, a.profileErr
	}
	return &platform.UserProfile{
		ID: "instagram-user", Username: "founder", CapabilityState: map[string]string{
			"connection_type": "instagram_login", "instagram_account_type": "creator",
		},
	}, nil
}

func TestInstagramLoginCallbackKeepsChosenMethodAndCanonicalAccount(t *testing.T) {
	db := createHandlerTestDB(t, (*models.WorkspaceMember)(nil), (*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil), (*models.SocialAccount)(nil), (*models.Job)(nil))
	seedOAuthTestWorkspace(t, db)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(t.Context())
	require.NoError(t, err)
	adapter := &instagramLoginTestAdapter{}
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"),
		map[string]platform.Adapter{"instagram:instagram_login": adapter}, testAuthenticator{}, false, "https://app.example")
	handler.SetProviderReadiness(oauthConnectionReadiness(t,
		&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled},
		platform.AppConfig{Provider: "instagram", ConnectionMode: "instagram_login", ClientID: "instagram-app", ClientSecret: "secret", RedirectURI: "https://app.example/callback"}))
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.ListProviders(api)
	handler.GetAuthURL(api)
	handler.Callback(api)
	providers := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/providers", nil, true)
	require.Equal(t, http.StatusOK, providers.Code, providers.Body.String())
	var catalog []ProviderInfo
	require.NoError(t, json.Unmarshal(providers.Body.Bytes(), &catalog))
	foundInstagram := false
	for _, provider := range catalog {
		if provider.Platform == "instagram" {
			foundInstagram = true
			require.True(t, provider.Configured)
			require.Equal(t, []string{"instagram_login"}, provider.ConfiguredConnectionModes)
			require.True(t, provider.ConnectionReadiness["instagram_login"].Connectable)
			require.False(t, provider.ConnectionReadiness["oauth"].Connectable)
		}
	}
	require.True(t, foundInstagram, "Instagram must be present in the provider catalogue")
	response := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/instagram/auth-url?workspace_id=ws-1&connection_mode=instagram_login", nil, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var authorization struct {
		URL string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &authorization))
	parsed, err := url.Parse(authorization.URL)
	require.NoError(t, err)
	// Callback query parameters must not override the method bound to OAuth state.
	callback := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/instagram/callback?code=code&server_name=oauth&state="+url.QueryEscape(parsed.Query().Get("state")), nil, true)
	require.Equal(t, http.StatusTemporaryRedirect, callback.Code, callback.Body.String())
	require.Contains(t, callback.Header().Get("Location"), "account_ids=")
	require.Zero(t, adapter.listCalls, "direct login must not discover Facebook Pages")
	var accounts []models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&accounts).Scan(t.Context()))
	require.Len(t, accounts, 1)
	require.Equal(t, "instagram", accounts[0].Platform)
	require.Empty(t, accounts[0].InstanceURL)
	require.Equal(t, "instagram-user", accounts[0].AccountID)
	var grant models.OAuthGrant
	require.NoError(t, db.NewSelect().Model(&grant).Where("id = ?", accounts[0].OAuthGrantID).Scan(t.Context()))
	require.Equal(t, "instagram-app-scoped-user", grant.ProviderSubject)
	require.Equal(t, "instagram:instagram_login", platform.AccountProviderKey(accounts[0].Platform, accounts[0].InstanceURL, accounts[0].CapabilityState))
}
