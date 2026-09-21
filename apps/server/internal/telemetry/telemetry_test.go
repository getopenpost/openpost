package telemetry

import (
	"context"
	"testing"
	"time"

	posthog "github.com/posthog/posthog-go"
	"github.com/stretchr/testify/require"
)

// supportedPublicProviders is the independently specified catalogue used to
// pin telemetry validation parity: every entry must validate, and no
// unsupported value (notably reddit) may sneak back in. The authoritative
// owner of this list is the platform package's PublicProviders catalogue.
var supportedPublicProviders = []string{
	"bluesky", "discord", "facebook", "instagram", "lemmy", "linkedin",
	"mastodon", "peertube", "piefed", "pinterest", "pixelfed", "telegram",
	"threads", "tiktok", "x", "youtube",
}

func TestTelemetryAcceptsEverySupportedPublicProvider(t *testing.T) {
	t.Parallel()

	for _, provider := range supportedPublicProviders {
		t.Run(provider, func(t *testing.T) {
			t.Parallel()
			recorder := &MemoryRecorder{}
			require.NoError(t, recorder.Capture(context.Background(), Event{
				Name: EventDestinationConnected,
				Properties: map[string]any{
					"platform": provider, "account_count": 1,
				},
			}))
			require.NoError(t, recorder.Capture(context.Background(), Event{
				Name: EventRenditionPublished,
				Properties: map[string]any{
					"publication_id": "publication-1", "rendition_id": "rendition-1",
					"platform": provider, "profile": "short_text",
				},
			}))
			require.NoError(t, recorder.Capture(context.Background(), Event{
				Name: EventRenditionFailed,
				Properties: map[string]any{
					"publication_id": "publication-1", "rendition_id": "rendition-1",
					"platform": provider, "profile": "short_text",
					"error_kind": "provider", "error_code": "rate_limited",
				},
			}))
			require.Len(t, recorder.Events, 3)
		})
	}
}

func TestTelemetryRejectsUnknownProvidersAndSensitiveValues(t *testing.T) {
	t.Parallel()
	recorder := &MemoryRecorder{}
	for _, provider := range []string{
		"reddit", "https://instance.example/users/alice", "person@example.com",
	} {
		require.Error(t, recorder.Capture(context.Background(), Event{
			Name: EventDestinationConnected,
			Properties: map[string]any{
				"platform": provider, "account_count": 1,
			},
		}))
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

type failingTelemetryRecorder struct{ MemoryRecorder }

func (r *failingTelemetryRecorder) Capture(context.Context, Event) error {
	return context.DeadlineExceeded
}

func TestValidationRejectionsAreCountedWithoutPayloadContent(t *testing.T) {
	before := RejectedEventCount()
	recorder := &MemoryRecorder{}
	require.Error(t, recorder.Capture(context.Background(), Event{
		Name: EventDestinationConnected,
		Properties: map[string]any{
			"platform": "reddit", "account_count": 1,
		},
	}))
	require.GreaterOrEqual(t, RejectedEventCount(), before+1)
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
