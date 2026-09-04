package passwordmail

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestResendSenderUsesBearerAuthAndIdempotency(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/emails", r.URL.Path)
		require.Equal(t, "Bearer resend-secret", r.Header.Get("Authorization"))
		require.Equal(t, "verify-challenge-1", r.Header.Get("Idempotency-Key"))
		require.NoError(t, json.NewDecoder(r.Body).Decode(&received))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"email-1"}`))
	}))
	defer server.Close()

	sender, err := NewResendSender(ResendConfig{
		APIKey:  "resend-secret",
		From:    "OpenPost <hello@example.com>",
		BaseURL: server.URL,
		Client:  server.Client(),
	})
	require.NoError(t, err)
	require.NoError(t, sender.SendEmailVerification(context.Background(), VerificationMessage{
		Recipient: "person@example.com", Code: "123456",
		ExpiresAt: time.Now().UTC().Add(10 * time.Minute), IdempotencyKey: "verify-challenge-1",
	}))
	require.Equal(t, "Verify your OpenPost email", received["subject"])
	require.Contains(t, received["text"], "123456")
}
