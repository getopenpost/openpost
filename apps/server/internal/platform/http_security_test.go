package platform

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDefaultProviderHTTPRejectsPrivateNetwork(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { requests++; _, _ = w.Write([]byte(`{}`)) }))
	defer server.Close()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, server.URL, nil)
	require.NoError(t, err)
	resp, err := newDefaultHTTPClient().Do(req)
	if resp != nil {
		_ = resp.Body.Close()
	}
	require.Error(t, err)
	require.Zero(t, requests)
}

// Local provider fixtures explicitly replace the existing shared client seam.
// Tests using it run sequentially. Production uses the guarded transport.
func newProviderTestServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	original := httpClient
	httpClient = server.Client()
	t.Cleanup(func() { httpClient = original })
	return server
}

func TestProviderRedirectDoesNotForwardCredentialsToAnotherOrigin(t *testing.T) {
	for _, header := range []string{"Authorization", "X-API-Key", "X-Custom-Secret"} {
		t.Run(header, func(t *testing.T) {
			client := newDefaultHTTPClient()
			requests := 0
			client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
				requests++
				if requests > 1 {
					return jsonResponse(req, `{}`), nil
				}
				return &http.Response{StatusCode: http.StatusFound, Header: http.Header{"Location": {"https://1.1.1.1/steal"}}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
			})
			req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "https://8.8.8.8/api", nil)
			require.NoError(t, err)
			req.Header.Set(header, "synthetic-secret")
			resp, err := client.Do(req)
			if resp != nil {
				_ = resp.Body.Close()
			}
			require.ErrorContains(t, err, "redirect changed origin")
			require.Equal(t, 1, requests)
		})
	}
}

func TestProviderRedirectDoesNotReplayLoginBodyToAnotherOrigin(t *testing.T) {
	client := newDefaultHTTPClient()
	requests := 0
	client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		if requests > 1 {
			return jsonResponse(req, `{}`), nil
		}
		return &http.Response{StatusCode: http.StatusTemporaryRedirect, Header: http.Header{"Location": {"https://1.1.1.1/steal"}}, Body: io.NopCloser(strings.NewReader("")), Request: req}, nil
	})
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, "https://8.8.8.8/login", strings.NewReader(`{"password":"secret"}`))
	require.NoError(t, err)
	resp, err := client.Do(req)
	if resp != nil {
		_ = resp.Body.Close()
	}
	require.ErrorContains(t, err, "redirect changed origin")
	require.Equal(t, 1, requests)
}
