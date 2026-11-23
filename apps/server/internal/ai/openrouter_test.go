package ai

import (
	"context"
	"encoding/json"

	"net/http"
	"net/http/httptest"

	"testing"

	"github.com/stretchr/testify/require"
)

func TestCompatibleEndpointGenerate(t *testing.T) {
	var received map[string]any
	var headers http.Header
	var path string
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		path = r.URL.Path
		headers = r.Header.Clone()
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Error(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"gateway-1","model":"local-vision","choices":[{"message":{"role":"assistant","content":"A bicycle."}}],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}`))
	}))
	defer server.Close()
	generator, err := NewOpenRouter(OpenRouterConfig{
		APIKey: "gateway-key", BaseURL: server.URL + "/gateway/v1/", CompatibleEndpoint: true,
		Provider: "azure/eu", RequireZDR: true, HTTPReferer: "https://app.example.test", XTitle: "OpenPost",
	})
	require.NoError(t, err)
	items := map[string]any{"type": "array", "minItems": 2, "maxItems": 3, "description": "Captions.", "items": map[string]any{"type": "string", "maxLength": 100}}
	schema := map[string]any{"type": "object", "properties": map[string]any{"captions": map[string]any{"anyOf": []any{items, map[string]any{"type": "null"}}}}}
	result, err := generator.Generate(context.Background(), GenerateRequest{
		Model: "local-vision", UserPrompt: "Describe this image.",
		Images:         []Image{{Data: []byte("image"), MIMEType: "image/jpeg"}},
		ResponseSchema: &JSONSchema{Name: "caption", Schema: schema},
	})
	require.NoError(t, err)
	require.Equal(t, "/gateway/v1/chat/completions", path)
	require.Equal(t, "Bearer gateway-key", headers.Get("Authorization"))
	require.Empty(t, headers.Get("HTTP-Referer"))
	require.Empty(t, headers.Get("X-Title"))
	require.NotContains(t, received, "provider")
	require.Equal(t, "local-vision", received["model"])
	format := received["response_format"].(map[string]any)["json_schema"].(map[string]any)
	properties := format["schema"].(map[string]any)["properties"].(map[string]any)
	sentItems := properties["captions"].(map[string]any)["anyOf"].([]any)[0].(map[string]any)
	require.NotContains(t, sentItems, "minItems")
	require.NotContains(t, sentItems, "maxItems")
	require.Equal(t, "Captions. Use at least 2 items. Use at most 3 items.", sentItems["description"])
	require.Equal(t, float64(100), sentItems["items"].(map[string]any)["maxLength"])
	require.Equal(t, 3, items["maxItems"])
	require.Equal(t, "A bicycle.", result.Text)
	require.Equal(t, "gateway-1", result.RequestID)
	require.Equal(t, int64(15), result.Usage.TotalTokens)
	_, err = generator.Generate(context.Background(), GenerateRequest{
		Model: "local-vision", UserPrompt: "Search the web.",
		WebSearch: WebSearchConfig{Enabled: true, MaxResults: 1, MaxUses: 1, MaxTotalResults: 1, MaxCharactersPerResult: 100, Context: WebSearchContextLow},
	})
	require.ErrorContains(t, err, "web search requires the default OpenRouter endpoint")
	require.Equal(t, 1, calls)
}
