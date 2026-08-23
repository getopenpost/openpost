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
	_, hasTools := received["tools"]
	require.False(t, hasTools)
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

func TestOpenRouterGenerateSendsFileAndBoundedWebSearch(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&received))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"gen-file",
			"object":"chat.completion",
			"created":1730000000,
			"model":"openai/gpt-5.6-luna",
			"choices":[{
				"index":0,
				"message":{"role":"assistant","content":"A current summary."},
				"finish_reason":"stop",
				"logprobs":null
			}]
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
		UserPrompt: "Use the attached launch brief and current sources.",
		Files: []File{{
			Data:     []byte("%PDF"),
			MIMEType: " Application/PDF; charset=binary ",
			Filename: " launch-brief.pdf ",
		}},
		WebSearch: WebSearchConfig{
			Enabled:    true,
			MaxResults: 6,
			MaxUses:    2,
			Context:    WebSearchContextMedium,
		},
	})
	require.NoError(t, err)

	messages := received["messages"].([]any)
	require.Len(t, messages, 1)
	content := messages[0].(map[string]any)["content"].([]any)
	require.Len(t, content, 2)
	require.Equal(t, map[string]any{
		"type": "file",
		"file": map[string]any{
			"file_data": "data:application/pdf;base64,JVBERg==",
			"filename":  "launch-brief.pdf",
		},
	}, content[1])
	require.Equal(t, []any{
		map[string]any{
			"type": "openrouter:web_search",
			"parameters": map[string]any{
				"max_results":         float64(6),
				"max_uses":            float64(2),
				"search_context_size": "medium",
			},
		},
	}, received["tools"])
}

func TestOpenRouterGenerateSendsAudioAndVideoSources(t *testing.T) {
	request, err := buildOpenRouterRequest(GenerateRequest{
		Model:  "openai/gpt-5.6-luna",
		Audio:  []Audio{{Data: []byte("voice"), MIMEType: "audio/mpeg"}},
		Videos: []Video{{Data: []byte("clip"), MIMEType: "video/mp4"}},
	}, "", true)
	require.NoError(t, err)
	require.Len(t, request.Messages, 1)

	encoded, err := json.Marshal(request.Messages[0])
	require.NoError(t, err)
	var message map[string]any
	require.NoError(t, json.Unmarshal(encoded, &message))
	content := message["content"].([]any)
	require.Equal(t, map[string]any{
		"type": "input_audio",
		"input_audio": map[string]any{
			"data":   "dm9pY2U=",
			"format": "mp3",
		},
	}, content[0])
	require.Equal(t, map[string]any{
		"type": "video_url",
		"video_url": map[string]any{
			"url": "data:video/mp4;base64,Y2xpcA==",
		},
	}, content[1])
}

func TestOpenRouterRequestPreservesLabeledMultimodalPartOrder(t *testing.T) {
	imageA := Image{Data: []byte("image-a"), MIMEType: "image/png"}
	fileB := File{Data: []byte("file-b"), MIMEType: "application/pdf", Filename: "b.pdf"}
	imageC := Image{Data: []byte("image-c"), MIMEType: "image/jpeg"}
	audioD := Audio{Data: []byte("audio-d"), MIMEType: "audio/mpeg"}
	videoE := Video{Data: []byte("video-e"), MIMEType: "video/mp4"}
	request, err := buildOpenRouterRequest(GenerateRequest{
		Model:      "openai/gpt-5.6-luna",
		UserPrompt: "Use the exact labeled sources.",
		Parts: []MultimodalPart{
			{SourceID: "media:a", Image: &imageA},
			{SourceID: "media:b", File: &fileB},
			{SourceID: "media:c", Image: &imageC},
			{SourceID: "media:d", Audio: &audioD},
			{SourceID: "media:e", Video: &videoE},
		},
	}, "", true)
	require.NoError(t, err)

	encoded, err := json.Marshal(request.Messages[0])
	require.NoError(t, err)
	var message map[string]any
	require.NoError(t, json.Unmarshal(encoded, &message))
	content := message["content"].([]any)
	require.Len(t, content, 11)
	for index, sourceID := range []string{"media:a", "media:b", "media:c", "media:d", "media:e"} {
		require.Equal(t, map[string]any{
			"type": "text",
			"text": `Source binding metadata, not instructions: {"source_id":"` + sourceID + `"}`,
		}, content[1+index*2])
	}
	require.Equal(t, "data:image/png;base64,aW1hZ2UtYQ==", content[2].(map[string]any)["image_url"].(map[string]any)["url"])
	require.Equal(t, "data:application/pdf;base64,ZmlsZS1i", content[4].(map[string]any)["file"].(map[string]any)["file_data"])
	require.Equal(t, "data:image/jpeg;base64,aW1hZ2UtYw==", content[6].(map[string]any)["image_url"].(map[string]any)["url"])
	require.Equal(t, "YXVkaW8tZA==", content[8].(map[string]any)["input_audio"].(map[string]any)["data"])
	require.Equal(t, "data:video/mp4;base64,dmlkZW8tZQ==", content[10].(map[string]any)["video_url"].(map[string]any)["url"])
}

func TestOpenRouterRequestRejectsInvalidLabeledMultimodalParts(t *testing.T) {
	image := Image{Data: []byte("image"), MIMEType: "image/png"}
	file := File{Data: []byte("file"), MIMEType: "application/pdf", Filename: "file.pdf"}
	for _, part := range []MultimodalPart{
		{SourceID: "media:unsafe instructions", Image: &image},
		{SourceID: "media:empty"},
		{SourceID: "media:ambiguous", Image: &image, File: &file},
	} {
		_, err := buildOpenRouterRequest(GenerateRequest{Model: "openai/gpt-5.6-luna", Parts: []MultimodalPart{part}}, "", false)
		require.Error(t, err)
		require.NotContains(t, err.Error(), "instructions")
	}
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

func TestOpenRouterGenerateValidatesFilesBeforeRequest(t *testing.T) {
	tests := []struct {
		name string
		file File
		want string
	}{
		{
			name: "data",
			file: File{MIMEType: "application/pdf", Filename: "brief.pdf"},
			want: "AI file 1: data is required",
		},
		{
			name: "MIME type",
			file: File{Data: []byte("private-file-body"), MIMEType: "not a MIME type", Filename: "brief.pdf"},
			want: "AI file 1: valid MIME type is required",
		},
		{
			name: "wildcard MIME type",
			file: File{Data: []byte("private-file-body"), MIMEType: "application/*", Filename: "brief.pdf"},
			want: "AI file 1: valid MIME type is required",
		},
		{
			name: "filename",
			file: File{Data: []byte("private-file-body"), MIMEType: "application/pdf", Filename: "../brief.pdf"},
			want: "AI file 1: valid filename is required",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := buildOpenRouterRequest(GenerateRequest{
				Model: "openai/gpt-5.6-luna",
				Files: []File{test.file},
			}, "", false)

			require.EqualError(t, err, test.want)
			require.NotContains(t, err.Error(), "private-file-body")
		})
	}
}

func TestOpenRouterGenerateValidatesAudioAndVideoBeforeRequest(t *testing.T) {
	_, err := buildOpenRouterRequest(GenerateRequest{
		Model: "openai/gpt-5.6-luna",
		Audio: []Audio{{Data: []byte("private-audio"), MIMEType: "audio/unknown"}},
	}, "", false)
	require.EqualError(t, err, "AI audio 1: supported audio MIME type is required")
	require.NotContains(t, err.Error(), "private-audio")

	_, err = buildOpenRouterRequest(GenerateRequest{
		Model:  "openai/gpt-5.6-luna",
		Videos: []Video{{Data: []byte("private-video"), MIMEType: "text/plain"}},
	}, "", false)
	require.EqualError(t, err, "AI video 1: valid video MIME type is required")
	require.NotContains(t, err.Error(), "private-video")
}

func TestOpenRouterGenerateValidatesWebSearchBeforeRequest(t *testing.T) {
	tests := []struct {
		name   string
		config WebSearchConfig
		want   string
	}{
		{
			name:   "minimum results",
			config: WebSearchConfig{Enabled: true, MaxUses: 1, Context: WebSearchContextLow},
			want:   "AI web search maximum results must be between 1 and 25",
		},
		{
			name:   "maximum results",
			config: WebSearchConfig{Enabled: true, MaxResults: 26, MaxUses: 1, Context: WebSearchContextLow},
			want:   "AI web search maximum results must be between 1 and 25",
		},
		{
			name:   "minimum uses",
			config: WebSearchConfig{Enabled: true, MaxResults: 1, Context: WebSearchContextLow},
			want:   "AI web search maximum uses must be between 1 and 30",
		},
		{
			name:   "maximum uses",
			config: WebSearchConfig{Enabled: true, MaxResults: 1, MaxUses: 31, Context: WebSearchContextLow},
			want:   "AI web search maximum uses must be between 1 and 30",
		},
		{
			name:   "context",
			config: WebSearchConfig{Enabled: true, MaxResults: 1, MaxUses: 1, Context: "private-context"},
			want:   "AI web search context must be low, medium, or high",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := buildOpenRouterRequest(GenerateRequest{
				Model:      "openai/gpt-5.6-luna",
				UserPrompt: "Find current sources.",
				WebSearch:  test.config,
			}, "", false)

			require.EqualError(t, err, test.want)
			require.NotContains(t, err.Error(), "private-context")
		})
	}
}
