package handlers

import (
	"context"
	"encoding/json"
	"io"
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

type directOAuthTestAdapter struct {
	tokenUserID string
	profileID   string
}

func (a *directOAuthTestAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	return "https://provider.example/oauth?state=" + url.QueryEscape(state), nil
}

func (a *directOAuthTestAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	token := &platform.TokenResult{AccessToken: "access-token", TokenType: "Bearer"}
	if a.tokenUserID != "" {
		token.Extra = map[string]string{"user_id": a.tokenUserID}
	}
	return token, nil
}

func (a *directOAuthTestAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{}
}

func (a *directOAuthTestAdapter) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return nil, nil
}

func (a *directOAuthTestAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	profileID := a.profileID
	if profileID == "" {
		profileID = "provider-user"
	}
	return &platform.UserProfile{
		ID:        profileID,
		Username:  "openpost",
		AvatarURL: "https://cdn.provider.example/openpost.jpg",
	}, nil
}

func TestThreadsOAuthCallbackRejectsTokenAndProfileIdentityMismatch(t *testing.T) {
	t.Parallel()

	e, state, db := newOAuthCallbackRedirectTestServer(t, "threads", &directOAuthTestAdapter{
		tokenUserID: "token-user",
		profileID:   "profile-user",
	})
	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/threads/callback?code=provider-code&state="+url.QueryEscape(state), nil, false)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(t, "https://app.openpost.test/settings?oauth_status=failed&tab=accounts&workspace_id=ws-1", result.Header.Get("Location"))

	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func (a *directOAuthTestAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}

func (a *directOAuthTestAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func TestOAuthCallbackAccountSelectionRedirectsExposeFinalLocationHeader(t *testing.T) {
	t.Parallel()

	for _, providerName := range []string{"facebook", "instagram"} {
		t.Run(providerName, func(t *testing.T) {
			t.Parallel()

			e, state, _ := newOAuthCallbackRedirectTestServer(t, providerName, &selectionTestAdapter{})

			rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/"+providerName+"/callback?code=provider-code&state="+url.QueryEscape(state), nil, false)
			result := rec.Result()
			t.Cleanup(func() { _ = result.Body.Close() })

			require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
			location := result.Header.Get("Location")
			require.NotEmpty(t, location)
			require.Contains(t, location, "https://app.openpost.test/accounts/callback")
			require.Contains(t, location, "status=selection_required")
			require.Contains(t, location, "platform="+providerName)
			require.NotContains(t, location, "access_token")
			require.NotContains(t, location, "provider-code")
		})
	}
}

func TestOAuthCallbackDirectSuccessRedirectsToScopedComposer(t *testing.T) {
	t.Parallel()

	e, state, db := newOAuthCallbackRedirectTestServer(t, "threads", &directOAuthTestAdapter{
		tokenUserID: "provider-user",
		profileID:   "provider-user",
	})
	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/threads/callback?code=provider-code&state="+url.QueryEscape(state), nil, false)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	location, err := url.Parse(result.Header.Get("Location"))
	require.NoError(t, err)
	require.Equal(t, "https://app.openpost.test/", location.Scheme+"://"+location.Host+location.Path)
	require.Equal(t, "ws-1", location.Query().Get("workspace_id"))
	require.NotEmpty(t, location.Query().Get("account_ids"))
	require.Empty(t, location.Query().Get("connected"))
	require.NotContains(t, location.RawQuery, "provider-code")
	require.NotContains(t, location.RawQuery, "token")

	var account models.SocialAccount
	require.NoError(t, db.NewSelect().Model(&account).Where("account_id = ?", "provider-user").Scan(t.Context()))
	require.Equal(t, "https://cdn.provider.example/openpost.jpg", account.AccountAvatarURL)
}

func TestOAuthCallbackReauthorizationOfInactiveDestinationReturnsToAccounts(t *testing.T) {
	t.Parallel()

	e, state, db := newOAuthCallbackRedirectTestServer(t, "threads", &directOAuthTestAdapter{})
	_, err := db.NewInsert().Model(&models.SocialAccount{
		ID:             "inactive-destination",
		WorkspaceID:    "ws-1",
		Slug:           "openpost",
		Platform:       "threads",
		AccountID:      "provider-user",
		AccessTokenEnc: []byte("legacy-token"),
		IsActive:       false,
	}).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceFirstConnection{
		WorkspaceID: "ws-1",
		AccountID:   "inactive-destination",
	}).Exec(t.Context())
	require.NoError(t, err)

	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/threads/callback?code=provider-code&state="+url.QueryEscape(state), nil, false)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(t, "https://app.openpost.test/settings?tab=accounts", result.Header.Get("Location"))
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
	require.Equal(t, "https://app.openpost.test/settings?oauth_status=cancelled&tab=accounts", result.Header.Get("Location"))
}

func TestOAuthCallbackProviderCancellationPreservesWorkspaceScope(t *testing.T) {
	t.Parallel()

	e, state, _ := newOAuthCallbackRedirectTestServer(t, "threads", &directOAuthTestAdapter{})
	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/threads/callback?error=access_denied&state="+url.QueryEscape(state), nil, false)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(t, "https://app.openpost.test/settings?oauth_status=cancelled&tab=accounts&workspace_id=ws-1", result.Header.Get("Location"))
}

func TestXOAuthCallbackDenialPreservesWorkspaceScope(t *testing.T) {
	t.Parallel()

	db := createHandlerTestDB(t, (*models.XOAuthRequestToken)(nil))
	_, err := db.NewInsert().Model(&models.XOAuthRequestToken{
		RequestToken:  "denied-token",
		RequestSecret: "request-secret",
		WorkspaceID:   "ws-1",
		UserID:        "user-1",
	}).Exec(t.Context())
	require.NoError(t, err)

	xAdapter := platform.NewXAdapter("client-id", "client-secret", "https://app.openpost.test/api/v1/accounts/x/callback")
	xAdapter.SetRequestStore(newXRequestStore(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")))
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), map[string]platform.Adapter{
		"x": xAdapter,
	}, testAuthenticator{}, false, "https://app.openpost.test")
	handler.Callback(api)

	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/x/callback?denied=denied-token", nil, false)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(t, "https://app.openpost.test/settings?oauth_status=cancelled&tab=accounts&workspace_id=ws-1", result.Header.Get("Location"))
}

func newOAuthCallbackRedirectTestServer(t *testing.T, providerName string, adapter platform.Adapter) (*echo.Echo, string, *bun.DB) {
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
	}, testAuthenticator{}, false, "https://app.openpost.test")
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

	return e, state, db
}
