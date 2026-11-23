package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"

	"testing"

	"github.com/openpost/backend/internal/ai"
	"github.com/openpost/backend/internal/config"
	"github.com/stretchr/testify/require"
)

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
