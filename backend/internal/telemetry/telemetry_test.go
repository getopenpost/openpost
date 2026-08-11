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
