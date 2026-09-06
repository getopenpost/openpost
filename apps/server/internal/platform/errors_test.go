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

func TestNewHTTPErrorKeepsBoundedProviderDiagnostics(t *testing.T) {
	err := NewHTTPError(
		http.StatusBadRequest,
		nil,
		[]byte(`{"error":{"code":1,"message":"An unknown error occurred.","fbtrace_id":"A1b2C3d4"}}`),
	)
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Equal(t, "An unknown error occurred.", providerErr.Message)
	require.Equal(t, "A1b2C3d4", providerErr.TraceID)
	require.Equal(t, `trace_id=A1b2C3d4 message="An unknown error occurred."`, ProviderErrorDiagnostic(err))
	require.NotContains(t, providerErr.Error(), providerErr.Message)
}

func TestNewHTTPErrorDropsUnsafeProviderDiagnostics(t *testing.T) {
	err := NewHTTPError(
		http.StatusBadRequest,
		nil,
		[]byte(`{"error":{"code":1,"message":"access_token=private-token","fbtrace_id":"not a safe trace id"}}`),
	)
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Empty(t, providerErr.Message)
	require.Empty(t, providerErr.TraceID)
	require.Empty(t, ProviderErrorDiagnostic(err))
}

func TestNewHTTPErrorRejectsUnsafeCodes(t *testing.T) {
	tests := []struct {
		name        string
		payload     string
		wantCode    string
		wantSubcode string
	}{
		{
			name:        "free-text code is dropped",
			payload:     `{"code":"contains private post text with spaces"}`,
			wantCode:    "",
			wantSubcode: "",
		},
		{
			name:        "numeric code survives but free-text subcode is dropped",
			payload:     `{"error":{"code":24,"error_subcode":"contains private post text"}}`,
			wantCode:    "24",
			wantSubcode: "",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := NewHTTPError(http.StatusBadRequest, nil, []byte(test.payload))
			var providerErr *HTTPError
			require.ErrorAs(t, err, &providerErr)
			require.Equal(t, test.wantCode, providerErr.Code)
			require.Equal(t, test.wantSubcode, providerErr.Subcode)
		})
	}
}
