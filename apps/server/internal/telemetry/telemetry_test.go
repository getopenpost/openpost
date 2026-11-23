package telemetry

import (
	"context"
	"testing"

	posthog "github.com/posthog/posthog-go"
	"github.com/stretchr/testify/require"
)

func TestFirstCompositionEventRejectsContentAndIdentity(t *testing.T) {
	t.Parallel()
	recorder := &MemoryRecorder{}
	for name, properties := range map[string]map[string]any{
		"authored content": {"signal": "private draft text"},
		"content URL":      {"signal": "https://example.com/private.jpg"},
		"origin key":       {"signal": "text", "origin_key": "origin-signal-0001"},
		"workspace ID":     {"signal": "text", "workspace_id": "ws-secret"},
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, recorder.Capture(context.Background(), Event{
				Name: EventFirstCompositionStarted, DistinctID: "user-1", WorkspaceID: "workspace-1",
				Properties: properties,
			}))
		})
	}
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
