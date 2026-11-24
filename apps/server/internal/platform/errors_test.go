package platform

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewHTTPErrorDropsUnsafeProviderDiagnostics(t *testing.T) {
	t.Parallel()
	err := NewHTTPError(
		http.StatusBadRequest,
		nil,
		[]byte(`{"error":{"code":1,"message":"access_token=private-token","fbtrace_id":"not a safe trace id"}}`),
	)
	var providerErr *HTTPError
	require.ErrorAs(t, err, &providerErr)
	require.Empty(t, providerErr.TraceID)
	require.Empty(t, ProviderErrorDiagnostic(err))
}

func TestNewHTTPErrorRejectsUnsafeCodes(t *testing.T) {
	t.Parallel()
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
