package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/config"
	"github.com/stretchr/testify/require"
)

func TestContentOpenRouterRetriesPastLegacyFiveSecondBudget(t *testing.T) {
	const upstreamRecoveryDelay = 5500 * time.Millisecond
	var requests atomic.Int32
	started := time.Now()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		if time.Since(started) < upstreamRecoveryDelay {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"generation-after-recovery",
			"object":"chat.completion",
			"created":1730000000,
			"model":"openai/gpt-5.6-luna",
			"choices":[{
				"index":0,
				"message":{"role":"assistant","content":"recovered"},
				"finish_reason":"stop"
			}]
		}`))
	}))
	t.Cleanup(server.Close)

	_, contentConfig := openRouterConfigs(&config.Config{
		AIAPIKey:            "test-key",
		ContentAIProvider:   "azure/eu",
		ContentAIRequireZDR: true,
	})
	contentConfig.BaseURL = server.URL
	contentConfig.HTTPClient = server.Client()
	generator, err := ai.NewOpenRouter(contentConfig)
	require.NoError(t, err)

	requestContext, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	t.Cleanup(cancel)
	result, err := generator.Generate(requestContext, ai.GenerateRequest{
		Model:      "openai/gpt-5.6-luna",
		UserPrompt: "Return one word.",
	})

	require.NoError(t, err)
	require.Equal(t, "recovered", result.Text)
	require.Greater(t, requests.Load(), int32(1))
}

func TestConfiguredGatewayRoutesCaptionAndContent(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		require.Equal(t, "/proxy/v1/chat/completions", r.URL.Path)
		require.Equal(t, "Bearer gateway-key", r.Header.Get("Authorization"))
		require.Empty(t, r.Header.Get("HTTP-Referer"))
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.NotContains(t, body, "provider")
		require.Equal(t, "gateway-model", body["model"])
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"generated"}}]}`))
	}))
	defer server.Close()
	t.Setenv("OPENPOST_AI_BASE_URL", server.URL+"/proxy/v1")
	t.Setenv("OPENPOST_AI_API_KEY", "gateway-key")
	cfg := config.Load()
	image, content := openRouterConfigs(cfg)
	for _, routing := range []ai.OpenRouterConfig{image, content} {
		generator, err := ai.NewOpenRouter(routing)
		require.NoError(t, err)
		result, err := generator.Generate(t.Context(), ai.GenerateRequest{Model: "gateway-model", UserPrompt: "Write a caption."})
		require.NoError(t, err)
		require.Equal(t, "generated", result.Text)
	}
	require.Equal(t, 2, calls)
}
