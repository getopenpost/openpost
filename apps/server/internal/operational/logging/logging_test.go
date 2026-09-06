package logging

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLoggerWritesOneStructuredRecordWithReleaseAndCorrelationEvidence(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, "openpost", "0123456789abcdef")

	logger.Info(
		"http_request",
		"request_id", "request-123",
		"method", "GET",
		"route", "/api/v1/version",
		"status", 200,
		"latency_ms", 4,
	)

	record := decodeRecord(t, output.Bytes())
	require.Equal(t, "INFO", record["severity"])
	require.Equal(t, "http_request", record["event"])
	require.Equal(t, "openpost", record["service"])
	require.Equal(t, "0123456789abcdef", record["revision"])
	require.Equal(t, "request-123", record["request_id"])
	require.Equal(t, float64(200), record["status"])
	_, err := time.Parse(time.RFC3339Nano, record["timestamp"].(string))
	require.NoError(t, err)
	require.Equal(t, 1, bytes.Count(output.Bytes(), []byte("\n")))
}

func TestLoggerRedactsStructuredAndLegacyCredentials(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, "openpost", "revision-123")

	logger.Info(
		"provider_error",
		"authorization", "Bearer structured-auth-secret",
		"callback_url", "https://alice:password@example.com/callback?code=callback-secret#fragment",
		"error", "request failed token=message-token-secret",
	)
	_, err := logger.LegacyWriter().Write([]byte(
		"delivery failed Authorization: Bearer legacy-auth-secret database_url=postgres://db:password@example.com/openpost?sslkey=database-secret\n",
	))
	require.NoError(t, err)

	contents := output.String()
	for _, secret := range []string{
		"structured-auth-secret",
		"password",
		"callback-secret",
		"fragment",
		"message-token-secret",
		"legacy-auth-secret",
		"database-secret",
	} {
		require.NotContains(t, contents, secret)
	}
	require.Contains(t, contents, redactedValue)
	records := decodeRecords(t, output.Bytes())
	require.Equal(t, redactedValue, records[0]["authorization"])
	require.Equal(t, "https://example.com/callback", records[0]["callback_url"])
	require.Equal(t, "legacy_log", records[1]["event"])
}

func decodeRecord(t *testing.T, encoded []byte) map[string]any {
	t.Helper()
	records := decodeRecords(t, encoded)
	require.Len(t, records, 1)
	return records[0]
}

func decodeRecords(t *testing.T, encoded []byte) []map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	var records []map[string]any
	for decoder.More() {
		var record map[string]any
		require.NoError(t, decoder.Decode(&record))
		records = append(records, record)
	}
	return records
}
