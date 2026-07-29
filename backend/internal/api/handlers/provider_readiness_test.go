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
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestProviderReadinessReportsConfigurationAccountsAndMediaHealth(t *testing.T) {
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
	require.Equal(t, "degraded", instagram.PublicMediaHealth.Status)
	require.Contains(t, instagram.BlockingIssues, "public_url_unreachable")

	youtube := findReadinessProvider(t, out.Providers, "youtube")
	require.Equal(t, "missing", youtube.ConfiguredAppState)
	require.Contains(t, youtube.BlockingIssues, "provider_app_missing")
	require.Contains(t, youtube.AppReviewWarnings, "Unaudited Google projects can force uploads private.")

	x := findReadinessProvider(t, out.Providers, "x")
	require.Equal(t, "configured", x.ConfiguredAppState)
	require.NotContains(t, x.BlockingIssues, "provider_app_missing")

	tiktok := findReadinessProvider(t, out.Providers, "tiktok")
	require.Equal(t, []string{"user.info.basic", "video.upload"}, tiktok.GrantedScopes)
	require.Contains(t, tiktok.BlockingIssues, "missing_scope")
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
		(*models.ProviderApp)(nil),
		(*models.MediaAttachment)(nil),
	)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Readiness"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{WorkspaceID: "ws-1", UserID: "user-1", Role: models.WorkspaceRoleAdmin}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.ProviderApp{ID: "instagram-app", Provider: "instagram", Name: "Instagram", ClientID: "client", IsActive: true}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "ig-1", WorkspaceID: "ws-1", Slug: "ig", Platform: "instagram", AccountID: "ig", AccessTokenEnc: []byte("token"), IsActive: true}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{ID: "tt-1", WorkspaceID: "ws-1", Slug: "tt", Platform: "tiktok", AccountID: "tt", AccessTokenEnc: []byte("token"), GrantedScopes: "video.upload user.info.basic", IsActive: true}).Exec(ctx)
	require.NoError(t, err)
	checkedAt := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.MediaAttachment{
		ID:                 "video-1",
		WorkspaceID:        "ws-1",
		FilePath:           "video.mp4",
		MimeType:           "video/mp4",
		Size:               1024,
		OriginalFilename:   "video.mp4",
		FileHash:           "hash-video-1",
		PublicURLReady:     false,
		PublicURLCheckedAt: checkedAt,
		PublicURLStatus:    403,
		PublicURLError:     "403 forbidden",
	}).Exec(ctx)
	require.NoError(t, err)

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	NewProviderReadinessHandler(db, testAuthenticator{}, map[string]platform.Adapter{
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
