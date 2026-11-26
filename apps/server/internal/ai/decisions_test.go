package ai

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpenRouterDecisionDoesNotRetryAnUncertainResponse(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"private provider detail"}}`))
	}))
	defer server.Close()
	adapter, err := NewOpenRouter(OpenRouterConfig{APIKey: "test-key", BaseURL: server.URL + "/api/v1"})
	require.NoError(t, err)
	_, err = adapter.Decide(t.Context(), DecisionRequest{Model: "typesafe/jev-1.13", Input: "A report", Criteria: "Is this a bug?"})
	require.Error(t, err)
	require.NotContains(t, err.Error(), "private provider detail")
	require.Equal(t, 1, calls)
}

func TestCompatibleEndpointDecisionDoesNotRetryAnUncertainResponse(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"private gateway detail"}}`))
	}))
	defer server.Close()
	adapter, err := NewOpenRouter(OpenRouterConfig{APIKey: "gateway-key", BaseURL: server.URL + "/gateway/v1", CompatibleEndpoint: true})
	require.NoError(t, err)
	_, err = adapter.Decide(t.Context(), DecisionRequest{Model: "local-classifier", Input: "A report", Criteria: "Is this a bug?"})
	require.Error(t, err)
	require.NotContains(t, err.Error(), "private gateway detail")
	require.Equal(t, 1, calls)
}
