package logging

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

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

func TestLoggerRedactsJWTsAndOAuthSecretsViaSlog(t *testing.T) {
	var output bytes.Buffer
	logger := New(&output, "openpost", "revision-456")

	fakeJWT := strings.Join([]string{"eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ1c2VyLTEyMyJ9", "signaturepart12345"}, ".")
	logger.Slog().Warn(
		"oauth_exchange_failed",
		"client_secret", "super-client-secret",
		"accessJwt", "bsky-access-jwt-secret",
		"refreshJwt", "bsky-refresh-jwt-secret",
		"detail", "fb_exchange_token=meta-short-secret refresh_token=ref-secret bearer="+fakeJWT,
	)

	contents := output.String()
	for _, secret := range []string{
		"super-client-secret",
		"bsky-access-jwt-secret",
		"bsky-refresh-jwt-secret",
		"meta-short-secret",
		"ref-secret",
		fakeJWT,
	} {
		require.NotContains(t, contents, secret)
	}
	records := decodeRecords(t, output.Bytes())
	require.Len(t, records, 1)
	require.Equal(t, redactedValue, records[0]["client_secret"])
	require.Equal(t, redactedValue, records[0]["accessJwt"])
	require.Equal(t, redactedValue, records[0]["refreshJwt"])
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
