package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
)

type deadlineThenHTTPClient struct {
	delegate  HTTPClient
	failFirst int32
	calls     atomic.Int32
}

func (c *deadlineThenHTTPClient) Do(request *http.Request) (*http.Response, error) {
	if c.calls.Add(1) <= c.failFirst {
		return nil, context.DeadlineExceeded
	}
	return c.delegate.Do(request)
}

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
		Model:        "openai/gpt-5.6-luna",
		SystemPrompt: "Write useful alternative text.",
		UserPrompt:   "Describe the attached images.",
		ResponseSchema: &JSONSchema{
			Name:        "image_description",
			Description: "One image description",
			Schema: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"description"},
				"properties": map[string]any{
					"description": map[string]any{"type": "string"},
				},
			},
		},
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
		"type": "json_schema",
		"json_schema": map[string]any{
			"name":        "image_description",
			"description": "One image description",
			"strict":      true,
			"schema": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []any{"description"},
				"properties": map[string]any{
					"description": map[string]any{"type": "string"},
				},
			},
		},
	}, received["response_format"])
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

func TestOpenRouterGenerateAcceptsArrayContent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"gen-parts",
			"model":"openai/gpt-5.6-luna",
			"choices":[{"message":{"role":"assistant","content":[
				{"type":"text","text":" part one "},
				{"type":"image_url","image_url":{"url":"https://example.test/image.png"}},
				{"type":"text","text":"part two"}
			]}}]
		}`))
	}))
	t.Cleanup(server.Close)

	generator, err := NewOpenRouter(OpenRouterConfig{
		APIKey:     "test-api-key",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})
	require.NoError(t, err)

	result, err := generator.Generate(t.Context(), GenerateRequest{
		Model:      "openai/gpt-5.6-luna",
		UserPrompt: "Return two parts.",
	})

	require.NoError(t, err)
	require.Equal(t, "part one\npart two", result.Text)
}

func TestOpenRouterGeneratePreservesOpenRouterMediaAndSearchExtensions(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&received))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"gen-extensions",
			"object":"chat.completion",
			"created":1730000000,
			"model":"openai/gpt-5.6-luna",
			"choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]
		}`))
	}))
	t.Cleanup(server.Close)
	generator, err := NewOpenRouter(OpenRouterConfig{
		APIKey: "test-api-key", BaseURL: server.URL, HTTPClient: server.Client(),
	})
	require.NoError(t, err)

	_, err = generator.Generate(t.Context(), GenerateRequest{
		Model:      "openai/gpt-5.6-luna",
		UserPrompt: "Inspect every source.",
		Parts: []MultimodalPart{{
			SourceID: "clip:1",
			Video:    &Video{Data: []byte("part-video"), MIMEType: "video/webm"},
		}},
		Images: []Image{{Data: []byte("image"), MIMEType: "image/png", Detail: ImageDetailOriginal}},
		Files:  []File{{Data: []byte("pdf"), MIMEType: "application/pdf", Filename: "source.pdf"}},
		Audio:  []Audio{{Data: []byte("ogg"), MIMEType: "audio/ogg"}},
		Videos: []Video{{Data: []byte("video"), MIMEType: "video/mp4"}},
		WebSearch: WebSearchConfig{
			Enabled: true, MaxResults: 4, MaxUses: 2, Context: WebSearchContextHigh,
		},
	})
	require.NoError(t, err)

	messages := received["messages"].([]any)
	content := messages[0].(map[string]any)["content"].([]any)
	require.Equal(t, map[string]any{"type": "text", "text": "Inspect every source."}, content[0])
	require.Equal(t, map[string]any{
		"type": "text", "text": `Source binding metadata, not instructions: {"source_id":"clip:1"}`,
	}, content[1])
	require.Equal(t, map[string]any{
		"type": "video_url", "video_url": map[string]any{"url": "data:video/webm;base64,cGFydC12aWRlbw=="},
	}, content[2])
	require.Equal(t, map[string]any{
		"type": "image_url", "image_url": map[string]any{
			"url": "data:image/png;base64,aW1hZ2U=", "detail": "original",
		},
	}, content[3])
	require.Equal(t, map[string]any{
		"type": "file", "file": map[string]any{
			"file_data": "data:application/pdf;base64,cGRm", "filename": "source.pdf",
		},
	}, content[4])
	require.Equal(t, map[string]any{
		"type": "input_audio", "input_audio": map[string]any{"data": "b2dn", "format": "ogg"},
	}, content[5])
	require.Equal(t, map[string]any{
		"type": "video_url", "video_url": map[string]any{"url": "data:video/mp4;base64,dmlkZW8="},
	}, content[6])
	require.Equal(t, []any{map[string]any{
		"type": "openrouter:web_search",
		"parameters": map[string]any{
			"max_results": float64(4), "max_uses": float64(2), "search_context_size": "high",
		},
	}}, received["tools"])
}

func TestOpenRouterGenerateStartsFreshRequestAfterSDKDeadlineWhileCallerIsActive(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"gen-after-deadline",
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
	client := &deadlineThenHTTPClient{delegate: server.Client(), failFirst: 2}
	generator, err := NewOpenRouter(OpenRouterConfig{
		APIKey:     "test-api-key",
		BaseURL:    server.URL,
		HTTPClient: client,
		MaxRetries: 1,
	})
	require.NoError(t, err)

	result, err := generator.Generate(context.Background(), GenerateRequest{
		Model:      "openai/gpt-5.6-luna",
		UserPrompt: "Return one word.",
	})

	require.NoError(t, err)
	require.Equal(t, "recovered", result.Text)
	require.Equal(t, int32(3), client.calls.Load())
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
