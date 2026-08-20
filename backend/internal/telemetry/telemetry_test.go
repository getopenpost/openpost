package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	posthog "github.com/posthog/posthog-go"
	"github.com/stretchr/testify/require"
)

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

func TestRequestContextPropagatesIdentityWithoutRawRequestMetadata(t *testing.T) {
	recorder := &postHogRecorder{}
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "https://app.example.test/publications/secret?token=secret", nil)
	request.Header.Set("X-PostHog-Distinct-ID", "user-1")
	request.Header.Set("X-PostHog-Session-ID", "session-1")

	wrapped := recorder.WrapHTTP(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
		requestContext, ok := posthog.RequestContextFromContext(request.Context())
		require.True(t, ok)
		require.Equal(t, "user-1", requestContext.DistinctId)
		require.Equal(t, "session-1", requestContext.SessionId)
		require.Empty(t, requestContext.Properties)
	}))
	wrapped.ServeHTTP(httptest.NewRecorder(), request)
}

func TestEnabledTelemetryRequiresCompleteRuntimeConfiguration(t *testing.T) {
	_, err := New(Config{Enabled: true})
	require.ErrorContains(t, err, "project token")

	_, err = New(Config{Enabled: true, ProjectToken: "phc_test"})
	require.ErrorContains(t, err, "server endpoint")

	_, err = New(Config{Enabled: true, ProjectToken: "phc_test", Endpoint: "https://eu.i.posthog.com"})
	require.ErrorContains(t, err, "browser endpoint")
}

func TestMemoryRecorderPreservesApplicationEventContract(t *testing.T) {
	recorder := &MemoryRecorder{}
	require.NoError(t, recorder.Capture(context.Background(), Event{
		Name:        EventPublicationQueued,
		DistinctID:  "user-1",
		WorkspaceID: "workspace-1",
		Properties:  map[string]any{"publication_id": "publication-1"},
	}))
	require.Len(t, recorder.Events, 1)
	require.Equal(t, "user-1", recorder.Events[0].DistinctID)
	require.Equal(t, "publication-1", recorder.Events[0].Properties["publication_id"])
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

func TestGrowthTelemetryAcceptsOnlySharedBuckets(t *testing.T) {
	recorder := &MemoryRecorder{}
	require.NoError(t, recorder.Capture(t.Context(), Event{
		Name: EventGrowthRecommendationDismissed,
		Properties: map[string]any{
			"platform": "bluesky", "mutual_count_bucket": "4-6", "rank_bucket": "4-6",
		},
	}))
	require.Error(t, recorder.Capture(t.Context(), Event{
		Name: EventGrowthRecommendationDismissed,
		Properties: map[string]any{
			"platform": "bluesky", "mutual_count_bucket": "3-5", "rank_bucket": "4-6",
		},
	}))
	require.Error(t, recorder.Capture(t.Context(), Event{
		Name: EventGrowthFollowRequested,
		Properties: map[string]any{
			"platform": "bluesky", "mutual_count_bucket": "4-6", "rank_bucket": "0",
		},
	}))
	require.Len(t, recorder.Events, 1)
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

func TestExceptionMessagePreservesPostHogPayloadAndOpenPostContext(t *testing.T) {
	timestamp := time.Date(2026, time.August, 11, 17, 0, 0, 0, time.UTC)
	message := newExceptionMessage(Exception{
		Title:       "Publication failed",
		Description: "provider returned an error",
		DistinctID:  "user-1",
		WorkspaceID: "workspace-1",
		Properties:  map[string]any{"route_template": "/api/v1/publications/{id}"},
	}, Config{
		Environment: "production",
		Edition:     "cloud",
		Version:     "v3.9.0",
		Revision:    "abc123",
	}, timestamp)

	require.Equal(t, timestamp, message.Timestamp)
	require.Equal(t, "user-1", message.DistinctId)
	require.Len(t, message.ExceptionList, 1)
	require.Equal(t, "Publication failed", message.ExceptionList[0].Type)
	require.Equal(t, "provider returned an error", message.ExceptionList[0].Value)
	require.NotNil(t, message.ExceptionList[0].Stacktrace)
	require.Equal(t, "/api/v1/publications/{id}", message.Properties["route_template"])
	require.Equal(t, "workspace-1", message.Properties["workspace_id"])
	require.Equal(t, "backend", message.Properties["surface"])
	require.Equal(t, "production", message.Properties["environment"])
	require.Equal(t, "cloud", message.Properties["edition"])
	require.Equal(t, "v3.9.0", message.Properties["version"])
	require.Equal(t, "abc123", message.Properties["revision"])
	require.Equal(t, "openpost", message.Properties["service"])
	require.Equal(t, false, message.Properties["$process_person_profile"])
}
