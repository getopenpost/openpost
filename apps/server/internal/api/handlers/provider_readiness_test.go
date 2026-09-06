package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestProviderReadinessReportsOnlyAuthoritativePerSubjectDecisions(t *testing.T) {
	srv := newProviderReadinessTestServer(t)

	resp := srv.get(t, "/api/v1/provider-readiness?workspace_id=ws-1")

	require.Equal(t, http.StatusOK, resp.Code, resp.Body.String())
	var out struct {
		Providers []ProviderReadinessItem `json:"providers"`
	}
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &out))
	require.NotEmpty(t, out.Providers)

	instagram := findReadinessProvider(t, out.Providers, "instagram")
	require.Equal(t, "configured", instagram.ConfiguredAppState)
	require.Equal(t, 1, instagram.ConnectedAccounts)
	require.NotEmpty(t, instagram.Profiles)

	youtube := findReadinessProvider(t, out.Providers, "youtube")
	require.Equal(t, "missing", youtube.ConfiguredAppState)
	require.Contains(t, youtube.BlockingIssues, "missing_configuration")

	x := findReadinessProvider(t, out.Providers, "x")
	require.Equal(t, "configured", x.ConfiguredAppState)
	require.Equal(t, 1, x.ConnectedAccounts)
	require.NotEmpty(t, x.Profiles)
	for _, profile := range x.Profiles {
		require.Equal(t, "x-active", profile.SocialAccountID)
		require.Equal(t, providerreadiness.EffectiveStateHealthy, profile.Immediate.State)
		require.Equal(t, providerreadiness.EffectiveStateHealthy, profile.Scheduled.State)
	}

	var raw map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &raw))
	providers := raw["providers"].([]any)
	first := providers[0].(map[string]any)
	require.NotContains(t, first, "granted_scopes")
	require.NotContains(t, first, "public_media_health")
	require.NotContains(t, first, "supported_profiles")
	require.NotContains(t, first, "next_actions")
	require.NotContains(t, first, "app_review_warnings")
}

type providerReadinessTestServer struct {
	echo *echo.Echo
	db   *bun.DB
}

func newProviderReadinessTestServer(t *testing.T) *providerReadinessTestServer {
	t.Helper()

	db := createHandlerTestDB(
		t,
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.SocialAccount)(nil),
		(*models.OAuthGrant)(nil),
		(*models.ProviderApprovalReview)(nil),
		(*models.ProviderCertificationRun)(nil),
		(*models.ProviderCertificationCheck)(nil),
		(*models.ProviderRuntimeControlEvent)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Readiness"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "ig-1", WorkspaceID: "ws-1", Slug: "ig", Platform: "instagram", AccountID: "ig", AccessTokenEnc: []byte("token"), IsActive: true}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "tt-1", WorkspaceID: "ws-1", Slug: "tt", Platform: "tiktok", AccountID: "tt", AccessTokenEnc: []byte("token"), GrantedScopes: "video.upload user.info.basic", IsActive: true}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "x-inactive", WorkspaceID: "ws-1", Slug: "x-inactive", Platform: "x",
		AccountID: "x-inactive", AccessTokenEnc: []byte("token"), IsActive: false,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.SocialAccount)(nil)).
		Set("is_active = ?", false).
		Where("id = ?", "x-inactive").
		Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.OAuthGrant{
		ID: "x-grant", WorkspaceID: "ws-1", Provider: "x", AccessTokenEnc: []byte("token"),
		ValidationStatus: "valid", ValidatedAt: now, AccessTokenExpiresAt: now.Add(time.Hour),
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "x-active", WorkspaceID: "ws-1", Slug: "x-active", Platform: "x",
		AccountID: "x-active", AccessTokenEnc: []byte("token"), OAuthGrantID: "x-grant", IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	catalog, err := providerreadiness.NewConfigurationCatalog(providerreadiness.RuntimeApps([]platform.AppConfig{
		{Provider: "instagram", ClientID: "instagram-client", RedirectURI: "https://openpost.test/instagram/callback"},
		{Provider: "x", ClientID: "x-client", RedirectURI: "https://openpost.test/x/callback"},
	}, providerreadiness.ConfigurationSourceEnvironment, providerreadiness.ProviderEnvironmentDevelopment))
	require.NoError(t, err)
	service := providerreadiness.NewService(providerreadiness.NewRepository(db), providerreadiness.ServiceOptions{
		Configurations: catalog, DefaultControl: providerreadiness.RuntimeControlStateEnabled,
		DynamicRegistrationProviders: []string{"mastodon"},
	})

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewProviderReadinessHandler(db, testAuthenticator{}, service, map[string]platform.Adapter{
		"x": providerAvailabilityAdapter{},
	}).RegisterRoutes(api)
	return &providerReadinessTestServer{echo: e, db: db}
}

func (s *providerReadinessTestServer) get(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	return rec
}

func findReadinessProvider(t *testing.T, providers []ProviderReadinessItem, provider string) ProviderReadinessItem {
	t.Helper()
	for _, item := range providers {
		if item.Provider == provider {
			return item
		}
	}
	require.Failf(t, "missing provider", "provider %s not found in %#v", provider, providers)
	return ProviderReadinessItem{}
}
