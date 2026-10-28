package telemetry

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/posthog/posthog-go"
	"github.com/stretchr/testify/require"
)

func TestHTTPContextClassifiesProtocolWithoutKeepingRequestMetadata(t *testing.T) {
	recorder := &postHogRecorder{}
	for _, path := range []string{"/api/v1/mcp?token=private", "/mcp"} {
		t.Run(path, func(t *testing.T) {
			calls := 0
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, nil)
			request.Header.Set("User-Agent", "Claude-Code/1.0 private-client-details")
			recorder.WrapHTTP(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				calls++
				require.Equal(t, "mcp", RequestClient(r.Context()))
				metadata, ok := posthog.RequestContextFromContext(r.Context())
				require.True(t, ok)
				require.Empty(t, metadata.Properties)
			})).ServeHTTP(httptest.NewRecorder(), request)
			require.Equal(t, 1, calls, "the wrapper must forward this path to the next handler exactly once")
		})
	}
}
