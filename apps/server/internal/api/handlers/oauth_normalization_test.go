package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

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
	cb := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/"+provider+"/callback?code=code&state="+url.QueryEscape(state), nil, false)
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

func TestNormRoutesNewAccountWithSupportedFeaturesToComposer(t *testing.T) {
	t.Parallel()
	providers := map[string]platform.Adapter{
		"threads": &normMessagingAdapter{support: platform.MessagingSupport{Enabled: true}},
	}
	e, _ := newNormServer(t, providers)
	resp := doNormCallback(t, e)
	defer resp.Body.Close()
	require.Equal(t, http.StatusTemporaryRedirect, resp.StatusCode)
	loc := resp.Header.Get("Location")
	u, _ := url.Parse(loc)
	require.Equal(t, "/", u.Path)
	require.Equal(t, "ws-1", u.Query().Get("workspace_id"))
	require.NotEmpty(t, u.Query().Get("account_ids"))
	require.NotContains(t, loc, "access_token")
}

func TestBlueskyLoginUsesSessionIdentityWhenActorProfileIsUnavailable(t *testing.T) {
	payload, err := json.Marshal(map[string]int64{"exp": time.Now().Add(time.Hour).Unix()})
	require.NoError(t, err)
	accessJWT := "e30." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"

	pds := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/xrpc/com.atproto.server.createSession":
			_, _ = io.WriteString(w, `{"did":"did:plc:creator","handle":"canonical.bsky.social","accessJwt":"`+accessJWT+`","refreshJwt":"refresh-token"}`)
		case "/xrpc/com.atproto.server.getSession":
			_, _ = io.WriteString(w, `{"did":"did:plc:creator","handle":"canonical.bsky.social"}`)
		case "/xrpc/app.bsky.actor.getProfile":
			http.Error(w, `{"error":"ProfileNotFound","message":"Profile not found"}`, http.StatusServiceUnavailable)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(pds.Close)

	e, handler := newNormServer(t, map[string]platform.Adapter{
		"bluesky": platform.NewBlueskyAdapter(pds.URL),
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
	require.Empty(t, account.AccountAvatarURL)
}

func TestNormReactivatedAccountReturnsToSettings(t *testing.T) {
	t.Parallel()
	providers := map[string]platform.Adapter{
		"threads": &normMessagingAdapter{support: platform.MessagingSupport{Enabled: true}},
	}
	e, h := newNormServer(t, providers)
	ctx := context.Background()
	_, err := h.db.NewInsert().Model(&models.SocialAccount{
		ID: "existing-id", WorkspaceID: "ws-1", Slug: "threads-existing", Platform: "threads", AccountID: "provider-user", IsActive: false, AccessTokenEnc: []byte("tok"),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = h.db.NewInsert().Model(&models.WorkspaceFirstConnection{WorkspaceID: "ws-1", AccountID: "existing-id"}).Exec(ctx)
	require.NoError(t, err)

	resp := doNormCallback(t, e)
	defer resp.Body.Close()
	require.NotContains(t, resp.Header.Get("Location"), "/accounts/setup")
	require.Equal(t, "https://app.openpost.test/settings?tab=accounts", resp.Header.Get("Location"))
}

func TestNormComposerRedirectContainsOnlyContinuationData(t *testing.T) {
	t.Parallel()
	providers := map[string]platform.Adapter{
		"threads": &normMessagingAdapter{support: platform.MessagingSupport{Enabled: true}},
	}
	e, _ := newNormServer(t, providers)
	resp := doNormCallback(t, e)
	defer resp.Body.Close()
	loc := resp.Header.Get("Location")
	u, _ := url.Parse(loc)
	require.Equal(t, "/", u.Path)
	require.Equal(t, "ws-1", u.Query().Get("workspace_id"))
	require.NotEmpty(t, u.Query().Get("account_ids"))
	require.Empty(t, u.Query().Get("new_account_ids"))
	require.Empty(t, u.Query().Get("open_fresh_composer"))
	require.NotContains(t, loc, "code")
}
