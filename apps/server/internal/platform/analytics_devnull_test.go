package platform

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func devNullAnalyticsAdapter(t *testing.T, baseURL string) AnalyticsAdapter {
	t.Helper()
	adapter, ok := any(NewDevNullAdapter(baseURL)).(AnalyticsAdapter)
	require.True(t, ok, "dev/null must expose the public reporting interface")
	return adapter
}

func TestDevNullPublicAccountAnalyticsPreservesMissingAndZero(t *testing.T) {
	calls := 0
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		require.Equal(t, "/api/v1/users/octocat", r.URL.Path)
		require.Empty(t, r.Header.Get("Authorization"))
		require.Equal(t, http.MethodGet, r.Method)
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": "user-id", "handle": "octocat", "commits_count": 12, "followers_count": 0}}))
	}))
	defer server.Close()
	adapter := devNullAnalyticsAdapter(t, server.URL)
	require.Equal(t, AnalyticsSupport{Account: true, Content: true}, adapter.AnalyticsSupport())
	values, err := adapter.FetchAccountAnalytics(t.Context(), "octocat\nprivate-key-never-transmitted", AccountAnalyticsRequest{AccountID: "user-id"})
	require.NoError(t, err)
	require.Equal(t, AnalyticsValues{MetricFollowers: 0, MetricPosts: 12}, values)
	require.Equal(t, 1, calls)
	meta, ok := LegacyAnalyticsMetricMetadata(AnalyticsMetricSubjectAccount, MetricFollowers, "devnull")
	require.True(t, ok)
	require.Equal(t, AnalyticsMetricAggregationCurrentSnapshot, meta.Aggregation)
}

func TestDevNullPublicContentAnalyticsDoesNotReportPartialThreads(t *testing.T) {
	const first = "01a181b9-5c35-738d-8b66-a5159a3e1f0b"
	const missing = "01a181b9-5c35-738d-8b66-a5159a3e1f0c"
	calls := 0
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path == "/api/v1/commits/"+first {
			_, _ = w.Write([]byte(`{"data":{"id":"` + first + `","stars_count":4}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	values, err := devNullAnalyticsAdapter(t, server.URL).FetchContentAnalytics(t.Context(), "", ContentAnalyticsRequest{ExternalIDs: []string{first, missing}})
	require.Nil(t, values)
	var unavailable *AnalyticsError
	require.ErrorAs(t, err, &unavailable)
	require.Equal(t, AnalyticsStatusNotFound, unavailable.Status)
	require.Equal(t, 2, calls)
}
