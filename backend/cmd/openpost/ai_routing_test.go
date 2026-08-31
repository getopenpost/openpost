package main

import (
	"context"
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
		OpenRouterAPIKey:    "test-key",
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
