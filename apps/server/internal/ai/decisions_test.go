package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpenRouterDecisionProtocol(t *testing.T) {
	for _, tc := range []struct {
		name, answer string
		failed       bool
	}{
		{"yes", `{"type":"noul","noul":0.96}`, false},
		{"missing", `{"type":"noul"}`, true},
		{"wrong type", `{"type":"choice","noul":0.96}`, true},
		{"out of range", `{"type":"noul","noul":2}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				require.Equal(t, "/api/alpha/decisions", r.URL.Path)
				require.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
				var body map[string]any
				require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
				require.Equal(t, "typesafe/jev-1.13", body["model"])
				require.Equal(t, "The upload is broken.", body["state"])
				require.Equal(t, map[string]any{"matched": map[string]any{"type": "noul", "instructions": "Does this report a defect?"}}, body["questions"])
				require.Equal(t, map[string]any{"data_collection": "deny", "require_parameters": true, "zdr": true, "only": []any{"typesafe"}, "allow_fallbacks": false}, body["provider"])
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"decision-1","model":"typesafe/jev-1.13-20260917","answers":{"matched":` + tc.answer + `},"usage":{"input_tokens":80,"output_tokens":4,"cost":0.001}}`))
			}))
			defer server.Close()
			adapter, err := NewOpenRouter(OpenRouterConfig{APIKey: "test-key", BaseURL: server.URL + "/api/v1", RequireZDR: true, Provider: "typesafe"})
			require.NoError(t, err)
			result, err := adapter.Decide(context.Background(), DecisionRequest{Model: "typesafe/jev-1.13", Input: "The upload is broken.", Criteria: "Does this report a defect?"})
			if tc.failed {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				require.Equal(t, 0.96, result.Probability)
			}
			require.Equal(t, "decision-1", result.RequestID)
			require.Equal(t, int64(84), result.Usage.TotalTokens)
			require.Equal(t, 0.001, *result.Usage.CostUSD)
			require.Equal(t, 1, calls)
		})
	}
}

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
