package discordwebhook

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func testServer(t *testing.T, status int, body string, contentType *string, received *map[string]any) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if contentType != nil {
			*contentType = r.Header.Get("Content-Type")
		}
		if received != nil {
			*received = map[string]any{}
			require.NoError(t, json.NewDecoder(r.Body).Decode(received))
		} else {
			_, _ = io.Copy(io.Discard, r.Body)
		}
		w.WriteHeader(status)
		if body != "" {
			_, _ = w.Write([]byte(body))
		}
	}))
	t.Cleanup(server.Close)
	return server
}

// countReader reports how many body bytes the sender consumed.
type countReader struct {
	remaining int
	read      *int
}

func (r *countReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.EOF
	}
	n := min(len(p), r.remaining)
	r.remaining -= n
	*r.read += n
	for i := range n {
		p[i] = 'x'
	}
	return n, nil
}

func (r *countReader) Close() error { return nil }

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSendPostsJSONPayload(t *testing.T) {
	var contentType string
	var received map[string]any
	server := testServer(t, http.StatusNoContent, "", &contentType, &received)
	require.NoError(t, Send(t.Context(), server.Client(), server.URL, map[string]any{
		"username": "OpenPost waitlist",
	}))
	require.Equal(t, "application/json", contentType)
	require.Equal(t, "OpenPost waitlist", received["username"])
}

func TestSendDrainsResponseToBoundedSize(t *testing.T) {
	var drained int
	client := &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{
			Status:     "204 No Content",
			StatusCode: http.StatusNoContent,
			Body:       &countReader{remaining: 1 << 20, read: &drained},
		}, nil
	})}
	require.NoError(t, Send(context.Background(), client, "https://discord.com/api/webhooks/id/token", map[string]any{}))
	require.Positive(t, drained)
	require.LessOrEqual(t, drained, MaxDrainBytes)
}

func TestSendErrorOmitsWebhookURL(t *testing.T) {
	const webhookURL = "https://discord.com/api/webhooks/id/secret-token-abc123"
	server := testServer(t, http.StatusInternalServerError, strings.Repeat("failure", 10_000), nil, nil)
	err := Send(t.Context(), server.Client(), webhookURL, map[string]any{})
	require.Error(t, err)
	require.NotContains(t, err.Error(), "secret-token-abc123")
	require.NotContains(t, err.Error(), webhookURL)

	leaky := &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return nil, fmt.Errorf(`Post "%s": connection refused`, webhookURL)
	})}
	err = Send(context.Background(), leaky, webhookURL, map[string]any{})
	require.Error(t, err)
	require.NotContains(t, err.Error(), "secret-token-abc123")
	require.NotContains(t, err.Error(), webhookURL)
}

func TestSendRejectsNon2xx(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusNotFound, http.StatusMultipleChoices} {
		server := testServer(t, status, "", nil, nil)
		err := Send(t.Context(), server.Client(), server.URL, map[string]any{})
		require.Error(t, err, "status %d", status)
	}
}
