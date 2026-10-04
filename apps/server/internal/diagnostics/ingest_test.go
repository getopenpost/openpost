package diagnostics

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const ingestTestInstallationID = "abcdef0123456789abcdef0123456789"

func ingestTestReport() Report {
	return Report{
		InstallationID:  ingestTestInstallationID,
		Surface:         SurfaceBackend,
		Operation:       "/api/v1/publications",
		ErrorCode:       CodeAPI5xx,
		HTTPStatus:      500,
		OccurrenceCount: 3,
		FirstSeen:       time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC),
		LastSeen:        time.Date(2026, 9, 14, 10, 5, 0, 0, time.UTC),
		Frames:          []Frame{{Module: "app/handler", Function: "Serve", Line: 42}},
	}
}

func TestIngesterRejectsWhenDisabled(t *testing.T) {
	ingester := NewIngester(IngestConfig{})
	require.False(t, ingester.IngestEnabled())
	require.False(t, ingester.Accept(ingestTestReport()))

	webhookless := NewIngester(IngestConfig{Enabled: true})
	require.False(t, webhookless.IngestEnabled())
	require.False(t, webhookless.Accept(ingestTestReport()))
}

func TestIngesterForwardsAcceptedReportToConfiguredWebhook(t *testing.T) {
	received := make(chan []byte, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "cannot read report", http.StatusBadRequest)
			return
		}
		received <- body
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)
	ingester := NewIngester(IngestConfig{Enabled: true, DiscordWebhookURL: server.URL, HTTPClient: server.Client()})
	require.True(t, ingester.IngestEnabled())
	require.True(t, ingester.Accept(ingestTestReport()))
	ingester.ForwardAsync(ingestTestReport())
	select {
	case body := <-received:
		require.Contains(t, string(body), CodeAPI5xx)
	case <-time.After(time.Second):
		t.Fatal("accepted diagnostics report did not reach the configured webhook")
	}
}

func TestIngesterRejectsInvalidReport(t *testing.T) {
	ingester := NewIngester(IngestConfig{Enabled: true, DiscordWebhookURL: "https://discord.example/hooks"})
	bad := ingestTestReport()
	bad.ErrorCode = "free form text"
	require.False(t, ingester.Accept(bad))

	leaky := ingestTestReport()
	leaky.Operation = "https://customer.example/secret?token=abc"
	require.False(t, ingester.Accept(leaky))
}

func TestIngesterEnforcesQuotas(t *testing.T) {
	ingester := NewIngester(IngestConfig{
		Enabled:                true,
		DiscordWebhookURL:      "https://discord.example/hooks",
		PerMinute:              2,
		PerInstallationPerHour: 3,
	})
	require.True(t, ingester.Accept(ingestTestReport()))
	require.True(t, ingester.Accept(ingestTestReport()))
	require.False(t, ingester.Accept(ingestTestReport()), "global per-minute cap")

	roomy := NewIngester(IngestConfig{
		Enabled:                true,
		DiscordWebhookURL:      "https://discord.example/hooks",
		PerMinute:              100,
		PerInstallationPerHour: 2,
	})
	require.True(t, roomy.Accept(ingestTestReport()))
	require.True(t, roomy.Accept(ingestTestReport()))
	require.False(t, roomy.Accept(ingestTestReport()), "per-installation hourly cap")
}

func TestPostDiscordReportDeliversBoundedPayload(t *testing.T) {
	var captured []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		captured = body
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(server.Close)

	report := ingestTestReport()
	report.Operation = strings.Repeat("a", 500)
	require.NoError(t, postDiscordReport(t.Context(), server.Client(), server.URL, report))
	require.NotEmpty(t, captured)
	require.Less(t, len(captured), 16<<10)

	var payload map[string]any
	require.NoError(t, json.Unmarshal(captured, &payload))
	embeds, ok := payload["embeds"].([]any)
	require.True(t, ok)
	require.Len(t, embeds, 1)
	embed, ok := embeds[0].(map[string]any)
	require.True(t, ok)
	require.Equal(t, CodeAPI5xx, embed["title"])
	serialized, err := json.Marshal(embed)
	require.NoError(t, err)
	require.NotContains(t, string(serialized), "discord.example")
}

func TestFormatDiscordPayloadClipsFields(t *testing.T) {
	report := ingestTestReport()
	report.Frames = []Frame{{Module: strings.Repeat("m", 500), Function: "Serve", Line: 1}}
	body, err := FormatDiscordPayload(report)
	require.NoError(t, err)
	require.Less(t, len(body), 8<<10)
}
