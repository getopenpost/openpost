package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sync"
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

type oauthReadinessLedger struct {
	mu      sync.RWMutex
	control providerreadiness.RuntimeControlState
}

func (l *oauthReadinessLedger) setControl(state providerreadiness.RuntimeControlState) {
	l.mu.Lock()
	l.control = state
	l.mu.Unlock()
}

func (*oauthReadinessLedger) LatestApprovalReview(context.Context, providerreadiness.Subject) (*providerreadiness.ApprovalReview, error) {
	return nil, providerreadiness.ErrLedgerFactNotFound
}

func (*oauthReadinessLedger) ApprovalReviewByID(context.Context, string) (*providerreadiness.ApprovalReview, error) {
	return nil, providerreadiness.ErrLedgerFactNotFound
}

func (*oauthReadinessLedger) LatestCertification(context.Context, providerreadiness.Subject, providerreadiness.EvidenceKind, string) (*providerreadiness.CertificationEvidence, error) {
	return nil, providerreadiness.ErrLedgerFactNotFound
}

func (l *oauthReadinessLedger) EffectiveRuntimeControl(context.Context, providerreadiness.Subject, time.Time) (providerreadiness.RuntimeControl, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return providerreadiness.RuntimeControl{State: l.control, ReasonCode: "oauth_test_control"}, nil
}

func (*oauthReadinessLedger) AppendApprovalReview(context.Context, providerreadiness.ApprovalReview) error {
	return nil
}

func (*oauthReadinessLedger) AppendCertification(context.Context, string, providerreadiness.CertificationEvidence) error {
	return nil
}

func (*oauthReadinessLedger) AppendRuntimeControl(context.Context, providerreadiness.RuntimeControlEvent) error {
	return nil
}

func (*oauthReadinessLedger) AuthorizationForAccount(
	_ context.Context,
	account models.SocialAccount,
	now time.Time,
) (providerreadiness.AuthorizationEvidence, error) {
	if !account.IsActive {
		return providerreadiness.AuthorizationEvidence{
			State: providerreadiness.AuthorizationStateReconnectRequired,
		}, nil
	}
	return providerreadiness.AuthorizationEvidence{
		State: providerreadiness.AuthorizationStateValid,
		GrantedScopes: []string{
			"pages_manage_posts", "pages_read_engagement",
			"instagram_basic", "instagram_content_publish",
			"https://www.googleapis.com/auth/youtube",
			"https://www.googleapis.com/auth/youtube.upload",
			"user.info.basic", "video.upload", "video.publish",
			"w_member_social", "w_organization_social",
			"threads_basic", "threads_content_publish",
		},
		ValidatedAt: now.Add(-time.Minute), ExpiresAt: now.Add(time.Hour),
	}, nil
}

func oauthConnectionReadiness(
	t *testing.T,
	ledger *oauthReadinessLedger,
	apps ...platform.AppConfig,
) *providerreadiness.Service {
	t.Helper()
	catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.RuntimeApps(
		apps,
		providerreadiness.ConfigurationSourceEnvironment,
		providerreadiness.ProviderEnvironmentDevelopment,
	))
	require.NoError(t, err)
	return providerreadiness.NewService(ledger, providerreadiness.ServiceOptions{
		Configurations: catalog,
		DefaultControl: providerreadiness.RuntimeControlStateEnabled,
	})
}

func oauthDynamicRegistrationReadiness(
	t *testing.T,
	ledger *oauthReadinessLedger,
	providers ...string,
) *providerreadiness.Service {
	t.Helper()
	catalog, err := providerreadiness.NewConfigurationCatalog()
	require.NoError(t, err)
	return providerreadiness.NewService(ledger, providerreadiness.ServiceOptions{
		Configurations:               catalog,
		DynamicRegistrationProviders: providers,
		DefaultControl:               providerreadiness.RuntimeControlStateEnabled,
	})
}

func permissiveProviderReadiness(t *testing.T) *providerreadiness.Service {
	t.Helper()
	apps := make([]platform.AppConfig, 0, 9)
	for _, provider := range []string{
		"bluesky", "discord", "x", "linkedin", "threads",
		"instagram", "facebook", "youtube", "tiktok",
	} {
		apps = append(apps, platform.AppConfig{Provider: provider, ClientID: provider + "-test-app"})
	}
	catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.RuntimeApps(
		apps,
		providerreadiness.ConfigurationSourceEnvironment,
		providerreadiness.ProviderEnvironmentDevelopment,
	))
	require.NoError(t, err)
	return providerreadiness.NewService(
		&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled},
		providerreadiness.ServiceOptions{
			Configurations:               catalog,
			DynamicRegistrationProviders: []string{mastodonProvider},
			DefaultControl:               providerreadiness.RuntimeControlStateEnabled,
		},
	)
}

func mcpProviderReadiness(t *testing.T) *providerreadiness.Service {
	t.Helper()
	catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.RuntimeApps(
		[]platform.AppConfig{
			{Provider: "bluesky", ClientID: "bluesky-test-app"},
			{Provider: "x", ClientID: "x-test-app"},
		},
		providerreadiness.ConfigurationSourceEnvironment,
		providerreadiness.ProviderEnvironmentDevelopment,
	))
	require.NoError(t, err)
	return providerreadiness.NewService(
		&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled},
		providerreadiness.ServiceOptions{
			Configurations:               catalog,
			DynamicRegistrationProviders: []string{mastodonProvider},
			DefaultControl:               providerreadiness.RuntimeControlStateEnabled,
		},
	)
}

func insertOAuthReadinessWorkspaceMember(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Role:        models.WorkspaceRoleAdmin,
	}).Exec(t.Context())
	require.NoError(t, err)
}

func TestOAuthCallbackRechecksReadinessBeforeTokenExchange(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	insertOAuthReadinessWorkspaceMember(t, db)

	ledger := &oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled}
	adapter := &selectionTestAdapter{}
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), map[string]platform.Adapter{
		"facebook": adapter,
	}, testAuthenticator{}, false, "https://app.openpost.test")
	handler.SetProviderReadiness(oauthConnectionReadiness(t, ledger, platform.AppConfig{
		Provider: "facebook", ClientID: "facebook-app",
		RedirectURI: "https://app.openpost.test/api/v1/accounts/facebook/callback",
	}))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.GetAuthURL(api)
	handler.Callback(api)

	authURLResp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/facebook/auth-url?workspace_id=ws-1", nil, true)
	require.Equal(t, http.StatusOK, authURLResp.Code, authURLResp.Body.String())
	var authURLBody struct {
		URL string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(authURLResp.Body.Bytes(), &authURLBody))
	parsed, err := url.Parse(authURLBody.URL)
	require.NoError(t, err)
	state := parsed.Query().Get("state")
	require.NotEmpty(t, state)

	ledger.setControl(providerreadiness.RuntimeControlStateDisabled)
	callbackResp := oauthSelectionRequest(
		t, e, http.MethodGet,
		"/api/v1/accounts/facebook/callback?code=provider-code&state="+url.QueryEscape(state),
		nil, false,
	)
	require.Equal(t, http.StatusTemporaryRedirect, callbackResp.Code, callbackResp.Body.String())
	require.Contains(t, callbackResp.Header().Get("Location"), "provider+operation+is+not+ready")
	require.Zero(t, adapter.exchangeCalls, "disabled callback must not call the provider token endpoint")
	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	pendingCount, err := db.NewSelect().Model((*models.OAuthAccountSelection)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, pendingCount)
}

func TestXRequestStorePreservesConnectionIntent(t *testing.T) {
	db := createHandlerTestDB(t, (*models.XOAuthRequestToken)(nil))
	store := newXRequestStore(db)
	now := time.Now().UTC()
	require.NoError(t, store.Save(
		"request-token", "request-secret", "ws-1", "user-1",
		string(providerreadiness.ExecutionIntentCertificationTest), now,
	))

	meta, found, err := store.Consume("request-token", time.Minute)
	require.NoError(t, err)
	require.True(t, found)
	require.Equal(t, "ws-1", meta.WorkspaceID)
	require.Equal(t, "user-1", meta.UserID)
	require.Equal(t, string(providerreadiness.ExecutionIntentCertificationTest), meta.ExecutionIntent)
}

func TestOAuthCallbackReprovesCertificationInitiatorRole(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.User)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	_, err := db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "admin@example.com", IsAdmin: true, CreatedAt: time.Now().UTC(),
	}).Exec(t.Context())
	require.NoError(t, err)
	insertOAuthReadinessWorkspaceMember(t, db)

	ledger := &oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled}
	adapter := &selectionTestAdapter{}
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), map[string]platform.Adapter{
		"facebook": adapter,
	}, testAuthenticator{}, false, "https://app.openpost.test")
	handler.SetProviderReadiness(oauthConnectionReadiness(t, ledger, platform.AppConfig{
		Provider: "facebook", ClientID: "facebook-app",
		RedirectURI: "https://app.openpost.test/api/v1/accounts/facebook/callback",
	}))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.GetAuthURL(api)
	handler.Callback(api)
	authURLResp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/facebook/auth-url?workspace_id=ws-1&intent=certification_test", nil, true)
	require.Equal(t, http.StatusOK, authURLResp.Code, authURLResp.Body.String())
	var authURLBody struct {
		URL string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(authURLResp.Body.Bytes(), &authURLBody))
	parsed, err := url.Parse(authURLBody.URL)
	require.NoError(t, err)
	state := parsed.Query().Get("state")
	require.NotEmpty(t, state)
	_, err = db.NewUpdate().Model((*models.User)(nil)).Set("is_admin = ?", false).Where("id = ?", "user-1").Exec(t.Context())
	require.NoError(t, err)

	callbackResp := oauthSelectionRequest(
		t, e, http.MethodGet,
		"/api/v1/accounts/facebook/callback?code=provider-code&state="+url.QueryEscape(state),
		nil, false,
	)
	require.Equal(t, http.StatusTemporaryRedirect, callbackResp.Code, callbackResp.Body.String())
	require.Contains(t, callbackResp.Header().Get("Location"), "current+instance+administrator")
	require.Zero(t, adapter.exchangeCalls)
}

type readinessMastodonAdapter struct {
	exchangeCalls int
	profileCalls  int
	afterExchange func()
}

func (*readinessMastodonAdapter) InstanceURL() string { return "https://social.example" }

func (*readinessMastodonAdapter) GenerateAuthURL(string) (string, map[string]string) {
	return "https://social.example/oauth/authorize", nil
}

func (a *readinessMastodonAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	a.exchangeCalls++
	if a.afterExchange != nil {
		a.afterExchange()
	}
	return &platform.TokenResult{AccessToken: "mastodon-token", TokenType: "Bearer"}, nil
}

func (*readinessMastodonAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{}
}

func (*readinessMastodonAdapter) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return nil, nil
}

func (a *readinessMastodonAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	a.profileCalls++
	return &platform.UserProfile{ID: "mastodon-user", Username: "mastodon-user"}, nil
}

func (*readinessMastodonAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}

func (*readinessMastodonAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func TestMastodonOOBRechecksReadinessAfterTokenExchangeBeforeSave(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	insertOAuthReadinessWorkspaceMember(t, db)

	ledger := &oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled}
	adapter := &readinessMastodonAdapter{afterExchange: func() {
		ledger.setControl(providerreadiness.RuntimeControlStateDisabled)
	}}
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), map[string]platform.Adapter{
		"mastodon:https://social.example": adapter,
	}, testAuthenticator{}, false, "https://app.openpost.test")
	handler.SetProviderReadiness(oauthConnectionReadiness(t, ledger, platform.AppConfig{
		Provider: "mastodon", ClientID: "mastodon-app",
		RedirectURI: "https://app.openpost.test/api/v1/accounts/mastodon/callback",
		InstanceURL: "https://social.example",
	}))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.ExchangeCode(api)
	resp := oauthSelectionRequest(t, e, http.MethodPost, "/api/v1/accounts/mastodon/exchange", map[string]string{
		"workspace_id": "ws-1",
		"server_name":  "https://social.example",
		"instance_url": "",
		"code":         "provider-code",
		"intent":       "production",
	}, true)
	require.Equal(t, http.StatusConflict, resp.Code, resp.Body.String())
	require.Equal(t, 1, adapter.exchangeCalls)
	require.Zero(t, adapter.profileCalls, "disabled OOB completion must stop before another provider call")
	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
}

func TestDelayedOAuthSelectionRechecksAfterProviderCallBeforeSave(t *testing.T) {
	db := createHandlerTestDB(t,
		(*models.WorkspaceMember)(nil),
		(*models.AuthChallenge)(nil),
		(*models.OAuthAccountSelection)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
	)
	insertOAuthReadinessWorkspaceMember(t, db)

	ledger := &oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled}
	adapter := &selectionTestAdapter{onSelect: func() {
		ledger.setControl(providerreadiness.RuntimeControlStateDisabled)
	}}
	handler := NewOAuthHandler(db, crypto.NewTokenEncryptor("0123456789abcdef0123456789abcdef"), map[string]platform.Adapter{
		"facebook": adapter,
	}, testAuthenticator{}, false, "https://app.openpost.test")
	handler.SetProviderReadiness(oauthConnectionReadiness(t, ledger, platform.AppConfig{
		Provider: "facebook", ClientID: "facebook-app",
		RedirectURI: "https://app.openpost.test/api/v1/accounts/facebook/callback",
	}))

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	handler.GetAuthURL(api)
	handler.Callback(api)
	handler.CompleteAccountSelection(api)
	authURLResp := oauthSelectionRequest(t, e, http.MethodGet, "/api/v1/accounts/facebook/auth-url?workspace_id=ws-1", nil, true)
	require.Equal(t, http.StatusOK, authURLResp.Code, authURLResp.Body.String())
	var authURLBody struct {
		URL string `json:"url"`
	}
	require.NoError(t, json.Unmarshal(authURLResp.Body.Bytes(), &authURLBody))
	parsed, err := url.Parse(authURLBody.URL)
	require.NoError(t, err)
	callbackResp := oauthSelectionRequest(
		t, e, http.MethodGet,
		"/api/v1/accounts/facebook/callback?code=provider-code&state="+url.QueryEscape(parsed.Query().Get("state")),
		nil, false,
	)
	require.Equal(t, http.StatusTemporaryRedirect, callbackResp.Code, callbackResp.Body.String())
	callbackURL, err := url.Parse(callbackResp.Header().Get("Location"))
	require.NoError(t, err)
	connectionID := callbackURL.Query().Get("connection_id")
	require.NotEmpty(t, connectionID)

	completeResp := oauthSelectionRequest(t, e, http.MethodPost, "/api/v1/accounts/selections/"+connectionID+"/complete", map[string]string{
		"selection_id": "page-2",
	}, true)
	require.Equal(t, http.StatusConflict, completeResp.Code, completeResp.Body.String())
	require.Equal(t, 1, adapter.selectCalls)
	count, err := db.NewSelect().Model((*models.SocialAccount)(nil)).Count(t.Context())
	require.NoError(t, err)
	require.Zero(t, count)
	var pending models.OAuthAccountSelection
	require.NoError(t, db.NewSelect().Model(&pending).Where("id = ?", connectionID).Scan(t.Context()))
	require.Zero(t, pending.ConsumedAt)
}
