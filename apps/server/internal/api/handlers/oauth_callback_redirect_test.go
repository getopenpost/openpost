package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"testing"
	"time"

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
	exchangeErr error
}

func (a *directOAuthTestAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	return "https://provider.example/oauth?state=" + url.QueryEscape(state), nil
}

func (a *directOAuthTestAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	if a.exchangeErr != nil {
		return nil, a.exchangeErr
	}
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

func TestOAuthCallbackFailuresPreserveSafeDiagnostics(t *testing.T) {
	// The wrapper deliberately contains credentials. Only typed provider metadata
	// may cross the redirect or log boundary.
	cause := fmt.Errorf("access_token=secret-token code=secret-code: %w", &platform.HTTPError{
		StatusCode: 400, Code: "100", Subcode: "33", TraceID: "trace-safe",
	})
	for _, tc := range []struct {
		name, reason, mode, diagnostic string
		adapter                        platform.Adapter
	}{
		{"exchange", "token_exchange_failed", "", "HTTP 400; code=100; subcode=33; trace=trace-safe", &directOAuthTestAdapter{exchangeErr: cause}},
		{"profile", "profile_fetch_failed", "instagram_login", "HTTP 400; code=100; subcode=33; trace=trace-safe", &instagramLoginTestAdapter{profileErr: cause}},
		{"selection", "account_selection_failed", "", "HTTP 400; code=100; subcode=33; trace=trace-safe", &selectionTestAdapter{listErr: cause}},
		{"invalid profile", "profile_fetch_failed", "instagram_login", "profile=invalid_response", &instagramLoginTestAdapter{profileErr: platform.ErrInstagramLoginInvalidProfile}},
		{"invalid user ID", "profile_fetch_failed", "instagram_login", "profile=invalid_user_id", &instagramLoginTestAdapter{profileErr: platform.ErrInstagramLoginInvalidUserID}},
		{"personal account", "profile_fetch_failed", "instagram_login", "profile=professional_account_required", &instagramLoginTestAdapter{profileErr: platform.ErrInstagramLoginProfessionalAccount}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var logs bytes.Buffer
			previous := log.Writer()
			log.SetOutput(&logs)
			t.Cleanup(func() { log.SetOutput(previous) })
			e, state, db := newOAuthCallbackRedirectTestServer(t, "instagram", tc.adapter, tc.mode)
			rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/instagram/callback?code=secret-code&state="+url.QueryEscape(state), nil, true)
			require.Equal(t, http.StatusTemporaryRedirect, rec.Code)
			location, err := url.Parse(rec.Header().Get("Location"))
			require.NoError(t, err)
			require.Equal(t, "ws-1", location.Query().Get("workspace_id"))
			require.Equal(t, tc.reason, location.Query().Get("oauth_reason"))
			require.Equal(t, tc.diagnostic, location.Query().Get("oauth_diagnostic"))
			require.Contains(t, logs.String(), tc.reason)
			require.Contains(t, logs.String(), tc.diagnostic)
			for _, secret := range []string{"secret-token", "secret-code"} {
				require.NotContains(t, rec.Header().Get("Location")+logs.String(), secret)
			}
			for _, model := range []any{(*models.SocialAccount)(nil), (*models.OAuthAccountSelection)(nil)} {
				count, err := db.NewSelect().Model(model).Count(t.Context())
				require.NoError(t, err)
				require.Zero(t, count)
			}
		})
	}
}

func TestThreadsOAuthCallbackRejectsTokenAndProfileIdentityMismatch(t *testing.T) {
	t.Parallel()

	e, state, db := newOAuthCallbackRedirectTestServer(t, "threads", &directOAuthTestAdapter{
		tokenUserID: "token-user",
		profileID:   "profile-user",
	})
	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/threads/callback?code=provider-code&state="+url.QueryEscape(state), nil, true)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(t, "https://app.openpost.test/settings?oauth_reason=identity_mismatch&oauth_status=failed&tab=accounts&workspace_id=ws-1", result.Header.Get("Location"))

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

func TestFacebookOAuthCallbackExplainsMissingManageablePages(t *testing.T) {
	t.Parallel()

	e, state, _ := newOAuthCallbackRedirectTestServer(t, "facebook", &selectionTestAdapter{
		listErr: platform.ErrNoFacebookPages,
	})

	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/facebook/callback?code=provider-code&state="+url.QueryEscape(state), nil, true)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(
		t,
		"https://app.openpost.test/settings?oauth_reason=facebook_no_pages&oauth_status=failed&tab=accounts&workspace_id=ws-1",
		result.Header.Get("Location"),
	)
}

func TestInstagramOAuthCallbackExplainsMissingPageLinkedAccount(t *testing.T) {
	t.Parallel()

	e, state, _ := newOAuthCallbackRedirectTestServer(t, "instagram", &selectionTestAdapter{
		listErr: platform.ErrNoInstagramProfessionalAccount,
	})
	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/instagram/callback?code=provider-code&state="+url.QueryEscape(state), nil, true)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(t,
		"https://app.openpost.test/settings?oauth_reason=instagram_no_page_linked_account&oauth_status=failed&tab=accounts&workspace_id=ws-1",
		result.Header.Get("Location"),
	)
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

	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/threads/callback?code=provider-code&state="+url.QueryEscape(state), nil, true)
	result := rec.Result()
	t.Cleanup(func() { _ = result.Body.Close() })

	require.Equal(t, http.StatusTemporaryRedirect, result.StatusCode)
	require.Equal(t, "https://app.openpost.test/settings?tab=accounts", result.Header.Get("Location"))
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

func newOAuthCallbackRedirectTestServer(t *testing.T, providerName string, adapter platform.Adapter, modes ...string) (*echo.Echo, string, *bun.DB) {
	t.Helper()

	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	seedOAuthTestWorkspace(t, db)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	providerKey := providerName
	providerConfig := platform.AppConfig{Provider: providerName, ClientID: providerName + "-app"}
	authParams := url.Values{"workspace_id": {"ws-1"}}
	if len(modes) > 0 && modes[0] != "" {
		providerConfig.ConnectionMode = modes[0]
		providerConfig.ClientSecret = "client-secret"
		providerConfig.RedirectURI = "https://app.openpost.test/api/v1/accounts/" + providerName + "/callback"
		providerKey += ":" + modes[0]
		authParams.Set("connection_mode", modes[0])
	}
	if providerName == "discord" {
		providerKey = "discord:bot"
		providerConfig = platform.AppConfig{
			Provider: "discord", ConnectionMode: platform.ConnectionModeBot,
			ClientID: "discord-app", ClientSecret: "client-secret", BotToken: "bot-token",
			RedirectURI: "https://app.openpost.test/api/v1/accounts/discord/callback",
		}
	}
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), map[string]platform.Adapter{
		providerKey: adapter,
	}, testAuthenticator{}, false, "https://app.openpost.test")
	handler.SetProviderReadiness(oauthConnectionReadiness(
		t,
		&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled, approved: true},
		providerConfig,
	))
	handler.GetAuthURL(api)
	handler.Callback(api)

	authURLResp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/"+providerName+"/auth-url?"+authParams.Encode(), nil, true)
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

func TestOAuthCallbackCannotConnectWithoutInitiatingActor(t *testing.T) {
	e, state, db := newOAuthCallbackRedirectTestServer(t, "threads", &directOAuthTestAdapter{})
	rec := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/threads/callback?code=provider-code&state="+url.QueryEscape(state), nil, false)
	require.Contains(t, rec.Header().Get("Location"), "oauth_status=failed")
	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func seedOAuthTestWorkspace(t *testing.T, db *bun.DB) {
	const workspaceID = "ws-1"
	t.Helper()
	for _, model := range []any{(*models.Organization)(nil), (*models.Workspace)(nil)} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(t.Context())
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	organizationID := "oauth-org-" + workspaceID
	_, err := db.NewInsert().Model(&models.Organization{ID: organizationID, Name: "OAuth", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now}).On("CONFLICT DO NOTHING").Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Workspace{ID: workspaceID, OrganizationID: organizationID, Name: "OAuth", CreatedAt: now}).On("CONFLICT DO NOTHING").Exec(t.Context())
	require.NoError(t, err)
}
