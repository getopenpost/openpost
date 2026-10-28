package diagnostics

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

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

	// A report the validator accepts, carrying 24 frames at the maximum
	// per-frame lengths, so the sender has to clip for real.
	report := ingestTestReport()
	report.Frames = make([]Frame, 24)
	for i := range report.Frames {
		report.Frames[i] = Frame{Module: strings.Repeat("m", 240), Function: strings.Repeat("f", 160), Line: 1}
	}
	require.NoError(t, ValidateReport(report))
	require.NoError(t, postDiscordReport(t.Context(), server.Client(), server.URL, report))
	require.NotEmpty(t, captured)
	require.Less(t, len(captured), 8<<10)

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
	require.NotContains(t, string(captured), server.URL, "the webhook secret must never be echoed in the payload")

	var decoded discordDiagnosticsPayload
	require.NoError(t, json.Unmarshal(captured, &decoded))
	require.Len(t, decoded.Embeds, 1)
	framesFields := 0
	for _, field := range decoded.Embeds[0].Fields {
		require.LessOrEqual(t, utf8.RuneCountInString(field.Value), 1024, "Discord rejects oversized %s fields", field.Name)
		if field.Name != "Frames" {
			continue
		}
		framesFields++
		require.True(t, strings.HasPrefix(field.Value, "```\n"))
		require.True(t, strings.HasSuffix(field.Value, "\n```"))
	}
	require.Equal(t, 1, framesFields, "frames must stay in one clipped code block")
}
