package platform

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMetaCommentCollectionPreservesRecoveryClassification(t *testing.T) {
	original := httpClient
	t.Cleanup(func() { httpClient = original })
	for _, provider := range []struct {
		name    string
		adapter CommentAdapter
	}{
		{"facebook", NewFacebookAdapter("", "", "")},
		{"instagram", NewInstagramAdapter("", "", "")},
		{"threads", NewThreadsAdapter("", "", "")},
	} {
		for _, response := range []struct {
			name       string
			status     int
			body       string
			wantStatus int
			wantCode   string
		}{
			{"permission", 400, `{"error":{"message":"private provider detail","code":200,"fbtrace_id":"trace-safe"}}`, 403, "meta:permission:200"},
			{"expired token", 400, `{"error":{"message":"private token detail","code":190,"error_subcode":463}}`, 401, "meta:token_expired:190"},
			{"embedded permission", 200, `{"error":{"message":"private provider detail","code":10}}`, 403, "meta:permission:10"},
			{"rate limit", 400, `{"error":{"code":4,"message":"private rate detail"}}`, 429, "meta:rate_limit:4"},
			{"unavailable", 503, `{"error":{"code":2,"message":"private outage detail"}}`, 503, "meta:transient:2"},
		} {
			t.Run(provider.name+"/"+response.name, func(t *testing.T) {
				calls := 0
				httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					calls++
					return jsonResponseWithStatus(req, response.status, response.body), nil
				})}
				_, err := provider.adapter.ListComments(context.Background(), "secret-token", "account", "post")
				var failure *HTTPError
				require.ErrorAs(t, err, &failure)
				require.Equal(t, response.wantStatus, failure.StatusCode)
				require.Equal(t, response.wantCode, failure.Code)
				require.NotContains(t, err.Error(), "private")
				require.NotContains(t, err.Error(), "secret-token")
				require.Equal(t, 1, calls, "read failure must not add an adapter retry loop")
			})
		}
	}
}
