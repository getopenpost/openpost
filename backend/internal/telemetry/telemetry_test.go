package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

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
