package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/mastodonapps"
	"github.com/stretchr/testify/require"
)

type providerAvailabilityAdapter struct {
	instanceURL string
}

func (a providerAvailabilityAdapter) GenerateAuthURL(string) (string, map[string]string) {
	return "", nil
}

func (a providerAvailabilityAdapter) ExchangeCode(context.Context, string, map[string]string) (*platform.TokenResult, error) {
	return nil, nil
}

func (a providerAvailabilityAdapter) RefreshCapability() platform.RefreshCapability {
	return platform.RefreshCapability{}
}

func (a providerAvailabilityAdapter) RefreshToken(context.Context, platform.RefreshTokenInput) (*platform.TokenResult, error) {
	return nil, nil
}

func (a providerAvailabilityAdapter) GetProfile(context.Context, string) (*platform.UserProfile, error) {
	return nil, nil
}

func (a providerAvailabilityAdapter) UploadMedia(context.Context, string, string, string, io.Reader) (string, error) {
	return "", nil
}

func (a providerAvailabilityAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (string, error) {
	return "", nil
}

func (a providerAvailabilityAdapter) InstanceURL() string {
	return a.instanceURL
}

func TestListProvidersReportsConfiguredProviders(t *testing.T) {
	t.Parallel()

	e := echo.New()
	api := humaecho.NewWithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
	mastodonAdapter := providerAvailabilityAdapter{instanceURL: "https://masto.pt"}
	handler := &OAuthHandler{
		auth: testAuthenticator{},
		providers: map[string]platform.Adapter{
			"bluesky":                   providerAvailabilityAdapter{},
			"discord":                   providerAvailabilityAdapter{},
			"x":                         providerAvailabilityAdapter{},
			"mastodon:https://masto.pt": mastodonAdapter,
			"mastodon:Personal":         mastodonAdapter,
		},
	}
	handler.ListProviders(api)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/accounts/providers", nil)
	req.Header.Set("Authorization", "Bearer web-token")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	var out []ProviderInfo
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	require.Len(t, out, 10)
	require.Equal(t, "bluesky", out[0].Platform)
	require.Equal(t, providerStatusAvailable, out[0].Status)
	require.True(t, out[0].Configured)
	require.Contains(t, out[0].Capabilities, "MCP workflows")
	require.Equal(t, "discord", out[1].Platform)
	require.Equal(t, providerStatusAvailable, out[1].Status)
	require.True(t, out[1].Configured)
	require.Equal(t, "x", out[2].Platform)
	require.Equal(t, providerStatusAvailable, out[2].Status)
	require.True(t, out[2].Configured)
	require.Equal(t, ProviderInfo{
		Platform:     "mastodon",
		DisplayName:  "Mastodon",
		AuthMode:     "oauth_oob",
		Configured:   true,
		Status:       providerStatusAvailable,
		Description:  "Connect this configured Mastodon instance.",
		Capabilities: coreProviderCapabilities,
		Name:         "Personal",
		InstanceURL:  "https://masto.pt",
	}, out[3])
	require.Equal(t, "linkedin", out[4].Platform)
	require.Equal(t, providerStatusNeedsConfiguration, out[4].Status)
	require.False(t, out[4].Configured)
	require.Equal(t, "threads", out[5].Platform)
	require.Equal(t, providerStatusNeedsConfiguration, out[5].Status)
	require.False(t, out[5].Configured)
	require.Equal(t, "instagram", out[6].Platform)
	require.Equal(t, providerStatusNeedsConfiguration, out[6].Status)
	require.False(t, out[6].Configured)
	require.Equal(t, "facebook", out[7].Platform)
	require.Equal(t, providerStatusNeedsConfiguration, out[7].Status)
	require.Equal(t, "youtube", out[8].Platform)
	require.Equal(t, providerStatusNeedsConfiguration, out[8].Status)
	require.False(t, out[8].Configured)
	require.Equal(t, "tiktok", out[9].Platform)
	require.Equal(t, providerStatusNeedsConfiguration, out[9].Status)
	require.False(t, out[9].Configured)
	require.Equal(t, "OAuth app connection for TikTok videos and photo posts.", out[9].Description)
	require.Contains(t, out[9].Capabilities, "Short videos")
	require.Contains(t, out[9].Capabilities, "Photo posts")
}

func TestListProvidersIncludesUnavailableMastodonPlaceholder(t *testing.T) {
	t.Parallel()

	handler := &OAuthHandler{providers: map[string]platform.Adapter{}}
	out := handler.providerAvailability()

	require.Len(t, out, 10)
	require.Equal(t, ProviderInfo{
		Platform:    "mastodon",
		DisplayName: "Mastodon",
		AuthMode:    "oauth_oob",
		Configured:  false,
		Status:      providerStatusNeedsConfiguration,
		Description: "Configure Mastodon servers or dynamic instance registration before connecting.",
	}, out[3])
}

func TestListProvidersReportsDynamicMastodonAvailable(t *testing.T) {
	t.Parallel()

	handler := &OAuthHandler{
		providers:    map[string]platform.Adapter{},
		mastodonApps: mastodonapps.NewService(nil, nil, mastodonapps.Options{}),
	}
	out := handler.providerAvailability()

	require.Len(t, out, 10)
	require.Equal(t, ProviderInfo{
		Platform:     "mastodon",
		DisplayName:  "Mastodon",
		AuthMode:     "oauth_oob",
		Configured:   true,
		Status:       providerStatusAvailable,
		Description:  "Connect any public Mastodon instance.",
		Capabilities: coreProviderCapabilities,
		Name:         "Custom instance",
	}, out[3])
}
