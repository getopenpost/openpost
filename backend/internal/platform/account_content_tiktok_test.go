package platform

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTikTokAccountContentDiscoverySupportIsOptionalAndBounded(t *testing.T) {
	adapter := NewTikTokAdapter("", "", "")
	support := adapter.AccountContentDiscoverySupport(AnalyticsAccountContext{
		GrantedScopes: "user.info.basic video.list",
	})

	require.True(t, support.Supported)
	require.Equal(t, []string{"video.list"}, support.RequiredScopes)
	require.Equal(t, 20, support.MaxPageSize)
	require.Equal(t, 1, adapter.AccountContentDiscoveryReadRequests(AccountContentDiscoveryRequest{}))
	_, batchFanout := any(adapter).(AccountContentBatchMeasurer)
	require.False(t, batchFanout, "video.list already returns one page of item metrics")
}

func TestTikTokDiscoversBoundedPaginatedVideosWithInlineMetrics(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	historyStart := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	longTitle := strings.Repeat("T", AccountContentMaxTitleCharacters+1)
	longDescription := strings.Repeat("d", AccountContentMaxTextCharacters+1)
	firstResponse, err := json.Marshal(map[string]any{
		"data": map[string]any{
			"cursor": int64(12345), "has_more": true,
			"videos": []map[string]any{
				{
					"id": "7511111111111111111", "create_time": historyStart.Add(48 * time.Hour).Unix(),
					"title": longTitle, "video_description": longDescription,
					"share_url":  "https://www.tiktok.com/@openpost/video/7511111111111111111",
					"view_count": int64(100), "like_count": int64(0), "share_count": int64(4),
				},
				{"id": "not-a-stable-video-id", "create_time": historyStart.Add(47 * time.Hour).Unix()},
				{"id": "7511111111111111111", "create_time": historyStart.Add(48 * time.Hour).Unix(), "view_count": int64(999)},
			},
		},
		"error": map[string]any{"code": "ok"},
	})
	require.NoError(t, err)
	secondResponse, err := json.Marshal(map[string]any{
		"data": map[string]any{
			"cursor": int64(67890), "has_more": true,
			"videos": []map[string]any{
				{
					"id": "7522222222222222222", "create_time": historyStart.Unix(),
					"title": "At history bound", "video_description": "safe item, unsafe URL omitted",
					"share_url":     "https://attacker.example/video/7522222222222222222",
					"comment_count": int64(2),
				},
				{"id": "7533333333333333333", "create_time": historyStart.Add(-time.Second).Unix()},
			},
		},
		"error": map[string]any{"code": "ok"},
	})
	require.NoError(t, err)

	requests := 0
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests++
		require.Equal(t, http.MethodPost, req.Method)
		require.Equal(t, tiktokVideoListURL, req.URL.String())
		require.Equal(t, bearerPrefix+"access-token", req.Header.Get(headerAuthorization))
		body, readErr := io.ReadAll(req.Body)
		require.NoError(t, readErr)
		var payload map[string]any
		require.NoError(t, json.Unmarshal(body, &payload))
		require.Equal(t, float64(2), payload["max_count"])
		switch requests {
		case 1:
			require.NotContains(t, payload, "cursor")
			return jsonResponse(req, string(firstResponse)), nil
		case 2:
			require.Equal(t, float64(12345), payload["cursor"])
			return jsonResponse(req, string(secondResponse)), nil
		default:
			t.Fatalf("discovery exceeded its bounded request count: %d", requests)
			return nil, nil
		}
	})}

	adapter := NewTikTokAdapter("", "", "")
	first, err := adapter.DiscoverAccountContent(t.Context(), "access-token", AccountContentDiscoveryRequest{
		AccountID: "creator-1", PublishedAfter: historyStart, PageSize: 2,
	})
	require.NoError(t, err)
	require.Len(t, first.Items, 1, "invalid and duplicate provider IDs must not create extra items")
	require.Equal(t, "7511111111111111111", first.Items[0].ProviderContentID)
	require.Equal(t, "short_video", first.Items[0].ContentProfile)
	require.Equal(t, AccountContentMaxTitleCharacters, len([]rune(first.Items[0].Title)))
	require.Equal(t, AccountContentMaxTextCharacters, len([]rune(first.Items[0].Text)))
	require.Equal(t, "https://www.tiktok.com/@openpost/video/7511111111111111111", first.Items[0].ExternalURL)
	require.Equal(t, historyStart.Add(48*time.Hour), first.Items[0].PublishedAt)
	require.NotEmpty(t, first.NextCursor)
	require.NotEqual(t, "12345", first.NextCursor, "provider pagination must remain opaque outside the adapter")
	require.Equal(t, AccountContentDiscoveryPartial, first.Coverage.Status)
	require.Contains(t, first.Coverage.Description, "limited to lifetime views, likes, comments, and shares")

	measurements := first.Items[0].Measurements
	require.Equal(t, int64(100), measurements[MetricViews].Value)
	require.Equal(t, int64(0), measurements[MetricLikes].Value, "a measured zero remains a measurement")
	require.Equal(t, int64(4), measurements[MetricShares].Value)
	_, commentMeasured := measurements[MetricComments]
	require.False(t, commentMeasured, "a skipped provider metric must remain unavailable, not become zero")
	_, deepMetricInvented := measurements[MetricSaves]
	require.False(t, deepMetricInvented, "TikTok discovery must not invent unsupported deep metrics")
	metadata := measurements[MetricViews].AnalyticsMetricMetadata
	require.Equal(t, AnalyticsMetricUnitCount, metadata.Unit)
	require.Equal(t, AnalyticsMetricAggregationLifetimeTotal, metadata.Aggregation)
	require.Equal(t, tiktokDiscoveryMetricSource, metadata.Source)

	second, err := adapter.DiscoverAccountContent(t.Context(), "access-token", AccountContentDiscoveryRequest{
		AccountID: "creator-1", Cursor: first.NextCursor, PublishedAfter: historyStart, PageSize: 2,
	})
	require.NoError(t, err)
	require.Len(t, second.Items, 1)
	require.Equal(t, "7522222222222222222", second.Items[0].ProviderContentID)
	require.Empty(t, second.Items[0].ExternalURL, "unsafe provider URLs must not cross the discovery boundary")
	require.Equal(t, historyStart, second.Items[0].PublishedAt)
	require.Empty(t, second.NextCursor, "the lower history bound must stop provider pagination")
	require.Equal(t, AccountContentDiscoveryComplete, second.Coverage.Status)
	require.Equal(t, 2, requests, "two bounded pages must use exactly two provider requests")
}

func TestTikTokDiscoveryRejectsInvalidCursorBeforeProviderRead(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		t.Fatalf("invalid cursor must not reach TikTok: %s", req.URL.String())
		return nil, nil
	})}

	_, err := NewTikTokAdapter("", "", "").DiscoverAccountContent(t.Context(), "access-token", AccountContentDiscoveryRequest{
		Cursor: "not-an-opaque-cursor", PageSize: 20,
	})
	require.Error(t, err)
	var discoveryErr *AccountContentDiscoveryError
	require.ErrorAs(t, err, &discoveryErr)
	require.Equal(t, "invalid_cursor", discoveryErr.Code)
}

func TestTikTokDiscoveryClassifiesProviderScopeErrorSafely(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return jsonResponse(req, `{"data":{},"error":{"code":"scope_not_authorized","message":"secret provider detail","log_id":"secret-log"}}`), nil
	})}

	_, err := NewTikTokAdapter("", "", "").DiscoverAccountContent(t.Context(), "access-token", AccountContentDiscoveryRequest{PageSize: 20})
	require.Error(t, err)
	var discoveryErr *AccountContentDiscoveryError
	require.ErrorAs(t, err, &discoveryErr)
	require.Equal(t, AccountContentDiscoveryPermissionRequired, discoveryErr.Status)
	require.Equal(t, "scope_not_authorized", discoveryErr.Code)
	require.NotContains(t, err.Error(), "secret provider detail")
	require.NotContains(t, err.Error(), "secret-log")
}
