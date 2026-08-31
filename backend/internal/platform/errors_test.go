package platform

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestNewHTTPErrorKeepsOnlySafeProviderMetadata(t *testing.T) {
	headers := http.Header{"Retry-After": []string{"120"}}
	err := NewHTTPError(
		http.StatusTooManyRequests,
		headers,
		[]byte(`{"error":{"code":"rate_limit","error_subcode":4279009,"message":"secret post text and token"}}`),
	)
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, http.StatusTooManyRequests, providerErr.StatusCode)
	require.Equal(t, "rate_limit", providerErr.Code)
	require.Equal(t, "4279009", providerErr.Subcode)
	require.Equal(t, 2*time.Minute, providerErr.RetryAfter)
	require.NotContains(t, providerErr.Error(), "secret post text")
	require.NotContains(t, providerErr.Error(), "token")
}

func TestNewHTTPErrorRejectsUnsafeCodes(t *testing.T) {
	err := NewHTTPError(
		http.StatusBadRequest,
		nil,
		[]byte(`{"code":"contains private post text with spaces"}`),
	)
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Empty(t, providerErr.Code)
	require.Empty(t, providerErr.Subcode)
}

func TestNewHTTPErrorRejectsUnsafeSubcodes(t *testing.T) {
	err := NewHTTPError(
		http.StatusBadRequest,
		nil,
		[]byte(`{"error":{"code":24,"error_subcode":"contains private post text"}}`),
	)
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, "24", providerErr.Code)
	require.Empty(t, providerErr.Subcode)
}
