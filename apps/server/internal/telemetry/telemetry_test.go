package telemetry

import (
	"context"
	"testing"

	posthog "github.com/posthog/posthog-go"
	"github.com/stretchr/testify/require"
)

func TestTelemetryRejectsUnknownProvidersAndSensitiveValues(t *testing.T) {
	// The rejection count is process-global. Keep this test serial so another
	// test's rejection cannot satisfy the counter assertion.
	recorder := &MemoryRecorder{}
	for _, provider := range []string{
		"reddit", "https://instance.example/users/alice", "person@example.com",
	} {
		before := RejectedEventCount()
		require.Error(t, recorder.Capture(context.Background(), Event{
			Name: EventDestinationConnected,
			Properties: map[string]any{
				"platform": provider, "account_count": 1,
			},
		}))
		require.GreaterOrEqual(t, RejectedEventCount(), before+1)
	}
	require.Error(t, recorder.Capture(context.Background(), Event{
		Name: EventDestinationConnected,
		Properties: map[string]any{
			"platform": 7, "account_count": 1,
		},
	}))
	require.Error(t, recorder.Capture(context.Background(), Event{
		Name: EventDestinationConnected,
		Properties: map[string]any{
			"platform": "mastodon", "account_count": 1,
			"access_token": "provider-token",
		},
	}))
	require.Empty(t, recorder.Events)
}

func TestDisabledTelemetryExposesNoBrowserCredentials(t *testing.T) {
	recorder, err := New(Config{
		Enabled:         false,
		ProjectToken:    "phc_should_not_leak",
		BrowserEndpoint: "https://example.test/ingest",
		Environment:     "selfhost",
		Edition:         "selfhost",
	})
	require.NoError(t, err)
	require.False(t, recorder.Enabled())
	require.Equal(t, BrowserConfig{
		Enabled:     false,
		Environment: "selfhost",
		Edition:     "selfhost",
	}, recorder.PublicConfig())
}

func TestTelemetryContractRejectsUnknownEventsAndProperties(t *testing.T) {
	recorder := &MemoryRecorder{}
	require.Error(t, recorder.Capture(context.Background(), Event{Name: "unknown event"}))
	for name, properties := range map[string]map[string]any{
		"authored content":        {"content": "private draft"},
		"identity":                {"email": "person@example.com"},
		"token":                   {"access_token": "provider-token"},
		"secret URL":              {"return_url": "https://example.test/callback?code=secret"},
		"raw provider identifier": {"provider_account_id": "provider-user-123"},
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, recorder.Capture(context.Background(), Event{
				Name: EventWorkspaceActivated, Properties: properties,
			}))
		})
	}
	require.Empty(t, recorder.Events)
}

func TestTelemetryContractRejectsSensitiveAllowedValues(t *testing.T) {
	recorder := &MemoryRecorder{}
	require.Error(t, recorder.Capture(context.Background(), Event{
		Name: EventSignupCompleted, DistinctID: "person@example.com",
	}))
	require.Error(t, recorder.Capture(context.Background(), Event{
		Name: EventBillingCheckoutCreated,
		Properties: map[string]any{
			"checkout_id":     "https://billing.example/return?token=secret",
			"organization_id": "organization-1",
			"plan_id":         "founder",
			"billing_period":  "monthly",
			"provider":        "paddle",
		},
	}))
	for name, event := range map[string]Event{
		"authored content":        {Name: EventPlanConfirmed, Properties: map[string]any{"plan_id": "private draft", "billing_period": "monthly"}},
		"identity":                {Name: EventDestinationConnected, Properties: map[string]any{"platform": "person@example.com", "account_count": 1}},
		"token":                   {Name: EventPlanConfirmed, Properties: map[string]any{"plan_id": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature", "billing_period": "monthly"}},
		"raw provider identifier": {Name: EventDestinationConnected, Properties: map[string]any{"platform": "provider-user-123", "account_count": 1}},
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, recorder.Capture(context.Background(), event))
		})
	}
	require.Empty(t, recorder.Events)
}

func TestBrowserIdentityCanBeAliasedToTheAuthoritativeUser(t *testing.T) {
	anonymousID := "0198a123-4567-7abc-8def-0123456789ab"
	ctx := posthog.WithFreshRequestContext(t.Context(), posthog.RequestContext{DistinctId: anonymousID})
	require.Equal(t, anonymousID, BrowserDistinctID(ctx))
	recorder := &MemoryRecorder{}
	require.NoError(t, recorder.Alias(ctx, "user-1", BrowserDistinctID(ctx)))
	require.Equal(t, []IdentityAlias{{DistinctID: "user-1", Alias: anonymousID}}, recorder.Aliases)
	for _, unsafe := range []string{"provider-user-123", "private draft", "opaqueTokenValue123456789", "person@example.com"} {
		require.Error(t, recorder.Alias(ctx, "user-1", unsafe))
	}
}
