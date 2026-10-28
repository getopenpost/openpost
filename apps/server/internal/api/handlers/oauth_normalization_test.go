package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/accountfeatures"
	"github.com/openpost/backend/internal/services/crypto"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
)

func newNormServer(t *testing.T, providers map[string]platform.Adapter) (*echo.Echo, *OAuthHandler) {
	t.Helper()
	ctx := context.Background()
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
		(*models.AccountFeature)(nil),
		(*models.OAuthGrant)(nil),
		(*models.WorkspaceFirstConnection)(nil),
		(*models.OAuthAccountSelectionReservation)(nil),
	)
	seedOAuthTestWorkspace(t, db)
	_, err := db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	if providers == nil {
		providers = map[string]platform.Adapter{}
	}
	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	enc := crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef")
	handler := NewOAuthHandler(db, enc, providers, testAuthenticator{}, false, "https://app.openpost.test")
	af := accountfeatures.NewService(db, providers, nil)
	handler.SetAccountFeaturesService(af)
	apps := make([]platform.AppConfig, 0, len(providers))
	for p := range providers {
		key := p
		if len(p) > 8 && p[:8] == "mastodon" {
			key = "mastodon"
		}
		apps = append(apps, platform.AppConfig{Provider: key, ClientID: key + "-app"})
	}
	if len(apps) == 0 {
		apps = []platform.AppConfig{{Provider: "threads", ClientID: "threads-app"}}
	}
	handler.SetProviderReadiness(oauthConnectionReadiness(t, &oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled}, apps...))
	handler.GetAuthURL(api)
	handler.Callback(api)
	handler.ExchangeCode(api)
	handler.BlueskyLogin(api)
	handler.DiscordWebhookLogin(api)
	handler.GetAccountSelection(api)
	handler.CompleteAccountSelection(api)
	return e, handler
}

func doNormCallback(t *testing.T, e *echo.Echo) *http.Response {
	t.Helper()
	const provider = "threads"
	q := "/api/v1/accounts/" + provider + "/auth-url?workspace_id=ws-1"
	authResp := oauthSelectionRequest(t, e, http.MethodGet, q, nil, true)
	require.Equal(t, http.StatusOK, authResp.Code, authResp.Body.String())
	var body struct {
		URL string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(authResp.Body.Bytes(), &body))
	u, _ := url.Parse(body.URL)
	state := u.Query().Get("state")
	require.NotEmpty(t, state)
	cb := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/"+provider+"/callback?code=code&state="+url.QueryEscape(state), nil, true)
	return cb.Result()
}

type normMessagingAdapter struct {
	support platform.MessagingSupport
}

func (m *normMessagingAdapter) EngagementSupport() platform.EngagementSupport {
	return platform.EngagementSupport{}
}
func (m *normMessagingAdapter) AnalyticsSupport() platform.AnalyticsSupport {
	return platform.AnalyticsSupport{}
}
func (m *normMessagingAdapter) MessagingSupport() platform.MessagingSupport { return m.support }
func (m *normMessagingAdapter) FetchMessages(_ context.Context, _ string, _ platform.FetchMessagesRequest) (platform.FetchMessagesResult, error) {
	return platform.FetchMessagesResult{}, nil
}
func (m *normMessagingAdapter) SendMessage(_ context.Context, _ string, _ platform.SendMessageRequest) (platform.SendMessageResult, error) {
	return platform.SendMessageResult{}, nil
}
func (m *normMessagingAdapter) GenerateAuthURL(state string) (string, map[string]string) {
	return "https://provider.example/oauth?state=" + url.QueryEscape(state), nil
}
func (m *normMessagingAdapter) ExchangeCode(_ context.Context, _ string, _ map[string]string) (*platform.TokenResult, error) {
	return &platform.TokenResult{AccessToken: "access-token", TokenType: "Bearer"}, nil
}
func (m *normMessagingAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{}
}
func (m *normMessagingAdapter) RefreshToken(_ context.Context, _ platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return nil, nil
}
func (m *normMessagingAdapter) GetProfile(_ context.Context, _ string) (*platform.UserProfile, error) {
	return &platform.UserProfile{ID: "provider-user", Username: "openpost"}, nil
}
func (m *normMessagingAdapter) UploadMedia(_ context.Context, _, _, _ string, _ io.Reader) (string, error) {
	return "", nil
}
func (m *normMessagingAdapter) Publish(_ context.Context, _, _ string, _ *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func TestBlueskyLoginUsesSessionIdentityWhenActorProfileIsUnavailable(t *testing.T) {
	const pdsURL = "https://pds.example"

	e, handler := newNormServer(t, map[string]platform.Adapter{
		"bluesky": &loginSessionFixture{BlueskyAdapter: platform.NewBlueskyAdapter(pdsURL), did: "did:plc:creator"},
	})
	handler.setBlueskyPDSResolver(func(context.Context, string) (string, string, error) {
		return "", "", nil
	})
	response := oauthSelectionRequest(t, e, http.MethodPost, "/api/v1/accounts/bluesky/login", map[string]string{
		"workspace_id": "ws-1",
		"handle":       "submitted.bsky.social",
		"app_password": "app-password",
	}, true)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	var account models.SocialAccount
	require.NoError(t, handler.db.NewSelect().Model(&account).Where("account_id = ?", "did:plc:creator").Scan(t.Context()))
	require.Equal(t, "canonical.bsky.social", account.AccountUsername)
	require.Equal(t, pdsURL, account.InstanceURL)
	require.Empty(t, account.AccountAvatarURL)

	var grant models.OAuthGrant
	require.NoError(t, handler.db.NewSelect().Model(&grant).Where("id = ?", account.OAuthGrantID).Scan(t.Context()))
	require.Equal(t, pdsURL, grant.ProviderProjectID)
	require.Equal(t, pdsURL, grant.InstanceURL)
	require.JSONEq(t, `{"exchange":"create_session","pds_url":"`+pdsURL+`","protocol":"atproto","source":"account_connection"}`, grant.AuthorizationEvidence)
}

func TestOAuthProviderMapReturnsSnapshot(t *testing.T) {
	adapter := platform.NewBlueskyAdapter("")
	handler := NewOAuthHandler(nil, nil, map[string]platform.Adapter{"bluesky": adapter}, nil, false, "")
	snapshot := handler.ProviderMap()

	handler.registerProvider("bluesky:https://pds.example", platform.NewBlueskyAdapter("https://pds.example"))
	delete(snapshot, "bluesky")

	_, originalStillRegistered := handler.provider("bluesky")
	require.True(t, originalStillRegistered)
	require.NotContains(t, snapshot, "bluesky:https://pds.example")
}

// A hostile PDS must not be able to claim a DID the handle does not resolve to.
func TestBlueskyLoginRejectsPDSAssertingAnotherDID(t *testing.T) {
	const pdsURL = "https://pds.example"

	e, handler := newNormServer(t, map[string]platform.Adapter{"bluesky": platform.NewBlueskyAdapter("https://bsky.social")})
	handler.setBlueskyPDSResolver(func(context.Context, string) (string, string, error) {
		return pdsURL, "did:plc:creator", nil
	})
	handler.blueskyAdapter = func(pds string) blueskyLoginProvider {
		return &loginSessionFixture{BlueskyAdapter: platform.NewBlueskyAdapter(pds), did: "did:plc:impostor"}
	}

	response := oauthSelectionRequest(t, e, http.MethodPost, "/api/v1/accounts/bluesky/login", map[string]string{
		"workspace_id": "ws-1",
		"handle":       "victim.example",
		"app_password": "app-password",
	}, true)
	require.Equal(t, http.StatusInternalServerError, response.Code)
	require.Contains(t, response.Body.String(), "bluesky login failed")
	require.NotContains(t, response.Body.String(), pdsURL)

	count, err := handler.db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

// A resolution failure must fail the login instead of falling back to the
// configured PDS, which may not hold the account's repository.
func TestBlueskyLoginFailsWhenPDSResolutionErrors(t *testing.T) {
	e, handler := newNormServer(t, map[string]platform.Adapter{"bluesky": platform.NewBlueskyAdapter("https://bsky.social")})
	handler.setBlueskyPDSResolver(func(context.Context, string) (string, string, error) {
		return "", "", errors.New("plc.directory is unreachable")
	})
	response := oauthSelectionRequest(t, e, http.MethodPost, "/api/v1/accounts/bluesky/login", map[string]string{
		"workspace_id": "ws-1",
		"handle":       "alice.example",
		"app_password": "app-password",
	}, true)
	require.Equal(t, http.StatusBadGateway, response.Code, response.Body.String())
	require.NotContains(t, response.Body.String(), "plc.directory")

	count, err := handler.db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestNormComposerRedirectContainsOnlyContinuationData(t *testing.T) {
	t.Parallel()
	providers := map[string]platform.Adapter{
		"threads": &normMessagingAdapter{support: platform.MessagingSupport{Enabled: true}},
	}
	e, _ := newNormServer(t, providers)
	resp := doNormCallback(t, e)
	defer resp.Body.Close()
	require.Equal(t, http.StatusTemporaryRedirect, resp.StatusCode)
	loc := resp.Header.Get("Location")
	require.NotContains(t, loc, "access_token")
	u, err := url.Parse(loc)
	require.NoError(t, err)
	require.Equal(t, "/", u.Path)
	require.Equal(t, "ws-1", u.Query().Get("workspace_id"))
	require.NotEmpty(t, u.Query().Get("account_ids"))
	require.Empty(t, u.Query().Get("new_account_ids"))
	require.Empty(t, u.Query().Get("open_fresh_composer"))
	require.NotContains(t, loc, "code")
}

type loginSessionFixture struct {
	*platform.BlueskyAdapter
	did string
}

func (a *loginSessionFixture) CreateSession(context.Context, string, string) (string, string, string, string, int, error) {
	return a.did, "canonical.bsky.social", "access-token", "refresh-token", 3600, nil
}
func (a *loginSessionFixture) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, errors.New("profile unavailable")
}
