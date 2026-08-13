package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpenRouterGenerateSendsPrivateMultimodalRequest(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/api/v1/chat/completions", r.URL.Path)
		require.Equal(t, "Bearer test-api-key", r.Header.Get("Authorization"))
		require.Equal(t, "https://app.example.test", r.Header.Get("HTTP-Referer"))
		require.Equal(t, "OpenPost Test", r.Header.Get("X-Title"))
		require.Contains(t, r.Header.Get("Accept"), "application/json")
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(&received))

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"gen-123",
			"object":"chat.completion",
			"created":1730000000,
			"model":"openai/gpt-5.6-luna-20260709",
			"system_fingerprint":null,
			"choices":[{
				"index":0,
				"message":{"role":"assistant","content":"  A red bicycle beside a brick wall.  "},
				"finish_reason":"stop",
				"logprobs":null
			}],
			"usage":{"prompt_tokens":21,"completion_tokens":9,"total_tokens":30,"cost":0.000012}
		}`))
	}))
	defer server.Close()

	generator, err := NewOpenRouter(OpenRouterConfig{
		APIKey:      " test-api-key ",
		BaseURL:     server.URL + "/api/v1",
		HTTPClient:  server.Client(),
		HTTPReferer: "https://app.example.test",
		XTitle:      "OpenPost Test",
		Provider:    " azure/eu ",
		RequireZDR:  true,
	})
	require.NoError(t, err)

	result, err := generator.Generate(context.Background(), GenerateRequest{
		Model:           "openai/gpt-5.6-luna",
		SystemPrompt:    "Write useful alternative text.",
		UserPrompt:      "Describe the attached images.",
		MaxOutputTokens: 96,
		ReasoningEffort: ReasoningEffortNone,
		Images: []Image{
			{Data: []byte{0xff, 0xd8, 0xff}, MIMEType: "image/jpeg", Detail: ImageDetailLow},
			{Data: []byte("png"), MIMEType: "image/png"},
		},
	})

	require.NoError(t, err)
	require.Equal(t, "A red bicycle beside a brick wall.", result.Text)
	require.Equal(t, "openai/gpt-5.6-luna-20260709", result.Model)
	require.Equal(t, "gen-123", result.RequestID)
	require.Equal(t, int64(21), result.Usage.InputTokens)
	require.Equal(t, int64(9), result.Usage.OutputTokens)
	require.Equal(t, int64(30), result.Usage.TotalTokens)
	require.NotNil(t, result.Usage.CostUSD)
	require.InDelta(t, 0.000012, *result.Usage.CostUSD, 0.0000001)

	require.Equal(t, "openai/gpt-5.6-luna", received["model"])
	require.Equal(t, float64(96), received["max_completion_tokens"])
	require.Equal(t, "none", received["reasoning_effort"])
	require.Equal(t, false, received["stream"])
	require.Equal(t, map[string]any{
		"allow_fallbacks":    false,
		"data_collection":    "deny",
		"only":               []any{"azure/eu"},
		"require_parameters": true,
		"zdr":                true,
	}, received["provider"])

	messages := received["messages"].([]any)
	require.Len(t, messages, 2)
	require.Equal(t, map[string]any{
		"role":    "system",
		"content": "Write useful alternative text.",
	}, messages[0])
	userMessage := messages[1].(map[string]any)
	require.Equal(t, "user", userMessage["role"])
	content := userMessage["content"].([]any)
	require.Equal(t, map[string]any{
		"type": "text",
		"text": "Describe the attached images.",
	}, content[0])
	require.Equal(t, map[string]any{
		"type": "image_url",
		"image_url": map[string]any{
			"url":    "data:image/jpeg;base64,/9j/",
			"detail": "low",
		},
	}, content[1])
	require.Equal(t, map[string]any{
		"type": "image_url",
		"image_url": map[string]any{
			"url":    "data:image/png;base64,cG5n",
			"detail": "low",
		},
	}, content[2])
}

func TestOpenRouterGenerateRejectsEmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"gen-empty",
			"object":"chat.completion",
			"created":1730000000,
			"model":"openai/gpt-5.6-luna",
			"system_fingerprint":null,
			"choices":[]
		}`))
	}))
	defer server.Close()

	generator, err := NewOpenRouter(OpenRouterConfig{
		APIKey:     "test-api-key",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})
	require.NoError(t, err)

	_, err = generator.Generate(context.Background(), GenerateRequest{
		Model:      "openai/gpt-5.6-luna",
		UserPrompt: "Describe the image.",
	})

	require.ErrorIs(t, err, ErrEmptyResponse)
}

func TestOpenRouterGenerateSanitizesProviderErrors(t *testing.T) {
	const privateProviderBody = "do-not-expose-this-provider-body"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":400,"message":"` + privateProviderBody + `"}}`))
	}))
	defer server.Close()

	generator, err := NewOpenRouter(OpenRouterConfig{
		APIKey:     "test-api-key",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})
	require.NoError(t, err)

	_, err = generator.Generate(context.Background(), GenerateRequest{
		Model:      "openai/gpt-5.6-luna",
		UserPrompt: "Describe the image.",
	})

	var providerError *ProviderError
	require.ErrorAs(t, err, &providerError)
	require.Equal(t, http.StatusBadRequest, providerError.StatusCode)
	require.Equal(t, "OpenRouter", providerError.Provider)
	require.NotContains(t, err.Error(), privateProviderBody)
	require.NotContains(t, strings.ToLower(err.Error()), "message")
}

func TestNewOpenRouterRequiresAPIKey(t *testing.T) {
	_, err := NewOpenRouter(OpenRouterConfig{})

	require.EqualError(t, err, "OpenRouter API key is required")
}

func TestOpenRouterGenerateValidatesImageBeforeRequest(t *testing.T) {
	generator, err := NewOpenRouter(OpenRouterConfig{APIKey: "test-api-key"})
	require.NoError(t, err)

	_, err = generator.Generate(context.Background(), GenerateRequest{
		Model:      "openai/gpt-5.6-luna",
		UserPrompt: "Describe the image.",
		Images:     []Image{{Data: []byte("not-an-image"), MIMEType: "text/plain"}},
	})

	require.EqualError(t, err, "AI image 1: valid image MIME type is required")
	var providerError *ProviderError
	require.False(t, errors.As(err, &providerError))
}
