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
	"github.com/openpost/backend/internal/services/providerreadiness"
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

func (a providerAvailabilityAdapter) Publish(context.Context, string, string, *platform.PublishRequest) (platform.PublishResult, error) {
	return platform.PublishResult{}, nil
}

func (a providerAvailabilityAdapter) InstanceURL() string {
	return a.instanceURL
}

func TestTelegramConnectionAvailabilityFollowsReadiness(t *testing.T) {
	t.Parallel()
	for _, approved := range []bool{false, true} {
		t.Run(map[bool]string{false: "review missing", true: "review current"}[approved], func(t *testing.T) {
			e := echo.New()
			api := humaecho.NewV4WithGroup(e, e.Group("/api/v1"), huma.DefaultConfig("Test", "1.0.0"))
			handler := &OAuthHandler{auth: testAuthenticator{}}
			handler.readiness = oauthConnectionReadiness(t,
				&oauthReadinessLedger{control: providerreadiness.RuntimeControlStateEnabled, approved: approved},
				platform.AppConfig{Provider: "telegram", ConnectionMode: "bot", BotToken: "test-token", BotUsername: "test_bot", WebhookSecret: "test-secret"},
			)
			handler.ListProviders(api)
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/accounts/providers", nil)
			req.Header.Set("Authorization", "Bearer web-token")
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			require.Equal(t, http.StatusOK, rec.Code)
			var providers []ProviderInfo
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &providers))
			for _, provider := range providers {
				if provider.Platform != "telegram" {
					continue
				}
				require.Equal(t, approved, provider.Configured)
				require.Equal(t, approved, provider.Readiness.Connectable)
				require.NotEqual(t, providerStatusPlanned, provider.Status)
				return
			}
			t.Fatal("Telegram missing from account providers")
		})
	}
}
