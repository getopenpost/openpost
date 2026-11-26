package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

const anthropicGrammarRejection = `{"error":{"message":"The compiled grammar is too large, which would cause performance issues.","type":"invalid_request_error","code":400}}`

func writerSchema() *JSONSchema {
	ids := make([]string, 40)
	for index := range ids {
		ids[index] = fmt.Sprintf("template-%d", index)
	}
	return &JSONSchema{Name: "options_writer", Schema: map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"template_id", "body"},
		"properties": map[string]any{
			"template_id": map[string]any{"type": "string", "enum": ids},
			"body":        map[string]any{"type": "string", "minLength": 3, "maxLength": 280},
		},
	}}
}

func TestCompatibleEndpointRetriesRejectedStrictSchemaAsPlainJSON(t *testing.T) {
	var formats []string
	var prompts []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages       []struct{ Content any } `json:"messages"`
			ResponseFormat struct {
				Type       string         `json:"type"`
				JSONSchema map[string]any `json:"json_schema"`
			} `json:"response_format"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		formats = append(formats, body.ResponseFormat.Type)
		prompts = append(prompts, fmt.Sprint(body.Messages[0].Content))
		w.Header().Set("Content-Type", "application/json")
		if body.ResponseFormat.Type == "json_schema" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(anthropicGrammarRejection))
			return
		}
		_, _ = w.Write([]byte(`{"id":"gen-2","model":"claude-haiku-5-5","choices":[{"message":{"role":"assistant","content":"{\"body\":\"ok\"}"}}],"usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}`))
	}))
	defer server.Close()
	generator, err := NewOpenRouter(OpenRouterConfig{APIKey: "gateway-key", BaseURL: server.URL + "/v1", CompatibleEndpoint: true})
	require.NoError(t, err)

	result, err := generator.Generate(t.Context(), GenerateRequest{Model: "claude-haiku-5-5", SystemPrompt: "Write.", UserPrompt: "Go.", ResponseSchema: writerSchema()})
	require.NoError(t, err)
	require.Equal(t, `{"body":"ok"}`, result.Text)
	require.Equal(t, int64(14), result.Usage.TotalTokens)
	require.Equal(t, "gen-2", result.RequestID)
	require.Equal(t, []string{"json_schema", "json_object"}, formats)
	require.Contains(t, prompts[1], "JSON Schema")
	require.Contains(t, prompts[1], `"body"`)
}

func TestCompatibleEndpointStrictSchemaStaysSmall(t *testing.T) {
	var sent map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&sent))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"{}"}}]}`))
	}))
	defer server.Close()
	generator, err := NewOpenRouter(OpenRouterConfig{APIKey: "gateway-key", BaseURL: server.URL + "/v1", CompatibleEndpoint: true})
	require.NoError(t, err)
	_, err = generator.Generate(t.Context(), GenerateRequest{Model: "m", UserPrompt: "Go.", ResponseSchema: writerSchema()})
	require.NoError(t, err)

	encoded, err := json.Marshal(sent["response_format"])
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "template-1")
	require.NotContains(t, string(encoded), "maxLength")
	require.NotContains(t, string(encoded), "minLength")
	require.True(t, strings.Contains(string(encoded), "Use at most 280 characters."))
}

func TestDefaultEndpointKeepsStrictSchemaAndReportsRejection(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(anthropicGrammarRejection))
	}))
	defer server.Close()
	generator, err := NewOpenRouter(OpenRouterConfig{APIKey: "test-key", BaseURL: server.URL + "/api/v1", MaxRetries: 1})
	require.NoError(t, err)

	_, err = generator.Generate(t.Context(), GenerateRequest{Model: "m", UserPrompt: "Go.", ResponseSchema: writerSchema()})
	var providerError *ProviderError
	require.ErrorAs(t, err, &providerError)
	require.Equal(t, http.StatusBadRequest, providerError.StatusCode)
	require.Contains(t, providerError.Detail, "compiled grammar is too large")
	require.NotContains(t, err.Error(), "grammar")
	require.Equal(t, 1, calls)
}
