package platform

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGoogleOAuthReauthenticationSubtype(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusOK} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			stubGoogleBusinessClient(t, func(req *http.Request) (*http.Response, error) {
				resp := jsonResponse(req, `{"error":"invalid_grant","error_subtype":"invalid_rapt","error_description":"private provider detail"}`)
				resp.StatusCode = status
				return resp, nil
			})
			_, err := exchangeGoogleOAuthToken(t.Context(), map[string]string{"grant_type": "refresh_token"}, "refresh")
			var providerErr *HTTPError
			require.True(t, errors.As(err, &providerErr))
			require.Equal(t, "google:invalid_rapt", providerErr.Code)
			require.Equal(t, http.StatusUnauthorized, providerErr.StatusCode)
			require.NotContains(t, err.Error(), "private provider detail")
		})
	}
}
