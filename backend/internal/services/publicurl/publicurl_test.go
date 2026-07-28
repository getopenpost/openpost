package publicurl

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHTTPVerifierAcceptsHTTPSReachableMedia(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodHead, r.Method)
		w.Header().Set("Content-Type", "video/mp4")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	verifier := HTTPVerifier{Client: server.Client()}
	got := verifier.Verify(context.Background(), server.URL+"/video.mp4")

	require.True(t, got.Ready)
	require.Equal(t, http.StatusOK, got.StatusCode)
	require.Empty(t, got.Error)
}

func TestHTTPVerifierRejectsNonHTTPSURL(t *testing.T) {
	got := (HTTPVerifier{}).Verify(context.Background(), "http://example.com/video.mp4")

	require.False(t, got.Ready)
	require.Equal(t, MediaURLConfigurationError, got.Error)
}

func TestHTTPVerifierReportsHTTPFailure(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	verifier := HTTPVerifier{Client: server.Client()}
	got := verifier.Verify(context.Background(), server.URL+"/private.mp4")

	require.False(t, got.Ready)
	require.Equal(t, http.StatusForbidden, got.StatusCode)
	require.Contains(t, got.Error, "403")
}
