package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humaecho"
	"github.com/labstack/echo/v4"
	"github.com/openpost/backend/internal/diagnostics"
	"github.com/stretchr/testify/require"
)

func newIngestTestAPI(ingester *diagnostics.Ingester) *echo.Echo {
	e := echo.New()
	group := e.Group("/api/v1")
	api := humaecho.NewWithGroup(e, group, huma.DefaultConfig("Test", "1.0.0"))
	NewIngestHandler(ingester).RegisterRoutes(api)
	return e
}

func ingestTestBody(t *testing.T) []byte {
	t.Helper()
	now := time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)
	body, err := json.Marshal(diagnostics.Report{
		InstallationID: "abcdef0123456789abcdef0123456789",
		Version:        "4.32.0",
		Revision:       "abc123",
		Surface:        diagnostics.SurfaceBackend,
		Operation:      "/api/v1/publications",
		ErrorCode:      diagnostics.CodeAPI5xx,
		HTTPStatus:     http.StatusInternalServerError,
		DBDriver:       "sqlite",
		StorageDriver:  "local",
		FirstSeen:      now,
		LastSeen:       now,
	})
	require.NoError(t, err)
	return body
}

func TestIngestHandlerDisabledWithoutReceiver(t *testing.T) {
	e := newIngestTestAPI(diagnostics.NewIngester(diagnostics.IngestConfig{}))
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/diagnostics/ingest", bytes.NewReader(ingestTestBody(t)))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	e.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
}

func TestIngestHandlerAcceptsAnonymousValidReport(t *testing.T) {
	e := newIngestTestAPI(diagnostics.NewIngester(diagnostics.IngestConfig{
		Enabled:           true,
		DiscordWebhookURL: "https://discord.example/hooks",
	}))
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/diagnostics/ingest", bytes.NewReader(ingestTestBody(t)))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	e.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	require.Contains(t, recorder.Body.String(), `"accepted":true`)
}

func TestIngestHandlerRejectsInvalidReport(t *testing.T) {
	e := newIngestTestAPI(diagnostics.NewIngester(diagnostics.IngestConfig{
		Enabled:           true,
		DiscordWebhookURL: "https://discord.example/hooks",
	}))
	post := func(body string) int {
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/diagnostics/ingest", bytes.NewBufferString(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		e.ServeHTTP(recorder, request)
		return recorder.Code
	}
	// Missing installation_id fails schema validation.
	require.Equal(t, http.StatusUnprocessableEntity, post(`{"surface":"backend","operation":"boom","error_code":"api_5xx"}`))
	// Unknown error codes fail report validation.
	require.Equal(t, http.StatusBadRequest, post(`{"installation_id":"abcdef0123456789abcdef0123456789","version":"4.32.0","revision":"abc123","surface":"backend","operation":"boom","error_code":"whatever happened"}`))
	require.Equal(t, http.StatusUnprocessableEntity, post(`{"installation_id":"abcdef0123456789abcdef0123456789","version":"4.32.0","surface":"backend","operation":"boom","error_code":"api_5xx","error_kind":"private message and token=secret"}`))
}

func TestIngestHandlerForwardsDiagnosticContext(t *testing.T) {
	received := make(chan string, 1)
	webhook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		encoded, _ := json.Marshal(payload)
		received <- string(encoded)
	}))
	defer webhook.Close()
	e := newIngestTestAPI(diagnostics.NewIngester(diagnostics.IngestConfig{
		Enabled: true, DiscordWebhookURL: webhook.URL,
	}))
	var body map[string]any
	require.NoError(t, json.Unmarshal(ingestTestBody(t), &body))
	body["error_kind"] = "deadline_exceeded"
	body["http_method"] = "GET"
	body["frames"] = []diagnostics.Frame{{Module: "_app/immutable/nodes/editor.js", Function: "browser", Line: 120, Column: 8}}
	encoded, err := json.Marshal(body)
	require.NoError(t, err)
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/diagnostics/ingest", bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	select {
	case payload := <-received:
		require.Contains(t, payload, "deadline_exceeded")
		require.Contains(t, payload, `"value":"GET"`)
		require.Contains(t, payload, "_app/immutable/nodes/editor.js:120:8")
	case <-time.After(time.Second):
		t.Fatal("accepted diagnostic context never reached the local webhook")
	}
}

func TestIngestHandlerEnforcesQuota(t *testing.T) {
	e := newIngestTestAPI(diagnostics.NewIngester(diagnostics.IngestConfig{
		Enabled:           true,
		DiscordWebhookURL: "https://discord.example/hooks",
		PerMinute:         1,
	}))
	post := func() int {
		request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/diagnostics/ingest", bytes.NewReader(ingestTestBody(t)))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		e.ServeHTTP(recorder, request)
		return recorder.Code
	}
	require.Equal(t, http.StatusOK, post())
	require.Equal(t, http.StatusTooManyRequests, post())
}
