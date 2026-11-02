package platform

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAnalyticsAdaptersNormalizeProviderMetrics(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()
	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{}`
		switch {
		case req.URL.Host == "mastodon.example" && strings.Contains(req.URL.Path, "/accounts/"):
			body = `{"followers_count":12,"following_count":3,"statuses_count":8}`
		case req.URL.Host == "mastodon.example" && strings.Contains(req.URL.Path, "/statuses/"):
			body = `{"favourites_count":5,"reblogs_count":4,"replies_count":3}`
		case req.URL.Host == "public.api.bsky.app" && strings.Contains(req.URL.Path, "getProfile"):
			body = `{"followersCount":20,"followsCount":7,"postsCount":9}`
		case req.URL.Host == "public.api.bsky.app" && strings.Contains(req.URL.Path, "getPosts"):
			body = `{"posts":[{"likeCount":8,"repostCount":3,"quoteCount":2,"replyCount":4}]}`
		case req.URL.Host == "graph.facebook.com" && strings.Contains(req.URL.RawQuery, "followers_count"):
			body = `{"followers_count":100,"fan_count":90,"media_count":12}`
		case req.URL.Host == "graph.facebook.com" && strings.HasSuffix(req.URL.Path, "/insights"):
			body = `{"data":[{"name":"views","values":[{"value":70}]},{"name":"reach","values":[{"value":50}]},{"name":"saved","values":[{"value":4}]},{"name":"shares","values":[{"value":2}]}]}`
		case req.URL.Host == "graph.facebook.com" && strings.Contains(req.URL.RawQuery, "like_count"):
			body = `{"like_count":11,"comments_count":3}`
		case req.URL.Host == "graph.facebook.com":
			body = `{"reactions":{"summary":{"total_count":9}},"comments":{"summary":{"total_count":4}},"shares":{"count":2}}`
		case req.URL.Host == "graph.threads.net" && strings.Contains(req.URL.Path, "threads_insights"):
			body = `{"data":[{"name":"followers_count","total_value":{"value":44}}]}`
		case req.URL.Host == "graph.threads.net":
			body = `{"data":[{"name":"views","values":[{"value":80}]},{"name":"likes","values":[{"value":7}]},{"name":"replies","values":[{"value":3}]}]}`
		case req.URL.Host == "open.tiktokapis.com" && strings.Contains(req.URL.Path, "/user/info/"):
			body = `{"data":{"user":{"follower_count":55,"following_count":6,"likes_count":70,"video_count":8}},"error":{"code":"ok"}}`
		case req.URL.Host == "open.tiktokapis.com":
			body = `{"data":{"videos":[{"like_count":6,"comment_count":2,"share_count":1,"view_count":90}]},"error":{"code":"ok"}}`
		case req.URL.Host == "www.googleapis.com" && strings.Contains(req.URL.Path, "/channels"):
			body = `{"items":[{"statistics":{"subscriberCount":"66","videoCount":"7","viewCount":"900"}}]}`
		case req.URL.Host == "www.googleapis.com" && strings.Contains(req.URL.Path, "/videos"):
			body = `{"items":[{"statistics":{"viewCount":"120","likeCount":"10","commentCount":"3"}}]}`
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    req,
		}, nil
	})}

	ctx := context.Background()
	mastodon := NewMastodonAdapter("", "", "", "https://mastodon.example")
	account, err := mastodon.FetchAccountAnalytics(ctx, "token", AccountAnalyticsRequest{AccountID: "a"})
	require.NoError(t, err)
	require.Equal(t, int64(12), account[MetricFollowers])
	content, err := mastodon.FetchContentAnalytics(ctx, "token", ContentAnalyticsRequest{ExternalIDs: []string{"1", "2"}, OwnReplyCount: 1})
	require.NoError(t, err)
	require.Equal(t, int64(5), content[MetricComments])

	bluesky := NewBlueskyAdapter("")
	account, err = bluesky.FetchAccountAnalytics(ctx, "", AccountAnalyticsRequest{AccountID: "did:plc:test"})
	require.NoError(t, err)
	require.Equal(t, int64(20), account[MetricFollowers])
	content, err = bluesky.FetchContentAnalytics(ctx, "", ContentAnalyticsRequest{
		ExternalIDs:   []string{`{"uri":"at://did:plc:test/app.bsky.feed.post/1","cid":"x"}`},
		OwnReplyCount: 1,
	})
	require.NoError(t, err)
	require.Equal(t, int64(3), content[MetricComments])
	require.Equal(t, int64(2), content[MetricQuotes])

	facebook := NewFacebookAdapter("", "", "")
	account, err = facebook.FetchAccountAnalytics(ctx, "token", AccountAnalyticsRequest{AccountID: "page"})
	require.NoError(t, err)
	require.Equal(t, int64(100), account[MetricFollowers])
	content, err = facebook.FetchContentAnalytics(ctx, "token", ContentAnalyticsRequest{ExternalIDs: []string{"page_post"}})
	require.NoError(t, err)
	require.Equal(t, int64(9), content[MetricLikes])

	instagram := NewInstagramAdapter("", "", "")
	account, err = instagram.FetchAccountAnalytics(ctx, "token", AccountAnalyticsRequest{AccountID: "person"})
	require.NoError(t, err)
	require.Equal(t, int64(12), account[MetricPosts])
	content, err = instagram.FetchContentAnalytics(ctx, "token", ContentAnalyticsRequest{ExternalIDs: []string{"post"}})
	require.NoError(t, err)
	require.Equal(t, int64(11), content[MetricLikes])
	require.Equal(t, int64(70), content[MetricViews])
	require.Equal(t, int64(4), content[MetricSaves])

	threads := NewThreadsAdapter("", "", "")
	account, err = threads.FetchAccountAnalytics(ctx, "token", AccountAnalyticsRequest{AccountID: "person"})
	require.NoError(t, err)
	require.Equal(t, int64(44), account[MetricFollowers])
	content, err = threads.FetchContentAnalytics(ctx, "token", ContentAnalyticsRequest{ExternalIDs: []string{"post"}, OwnReplyCount: 1})
	require.NoError(t, err)
	require.Equal(t, int64(2), content[MetricComments])
	require.Equal(t, int64(80), content[MetricViews])

	tiktok := NewTikTokAdapter("", "", "")
	account, err = tiktok.FetchAccountAnalytics(ctx, "token", AccountAnalyticsRequest{})
	require.NoError(t, err)
	require.Equal(t, int64(55), account[MetricFollowers])
	content, err = tiktok.FetchContentAnalytics(ctx, "token", ContentAnalyticsRequest{ExternalIDs: []string{"video"}})
	require.NoError(t, err)
	require.Equal(t, int64(90), content[MetricViews])

	youtube := NewYouTubeAdapter("", "", "")
	account, err = youtube.FetchAccountAnalytics(ctx, "token", AccountAnalyticsRequest{AccountID: "channel"})
	require.NoError(t, err)
	require.Equal(t, int64(66), account[MetricFollowers])
	content, err = youtube.FetchContentAnalytics(ctx, "token", ContentAnalyticsRequest{ExternalIDs: []string{"video"}})
	require.NoError(t, err)
	require.Equal(t, int64(120), content[MetricViews])

	linkedin := NewLinkedInAdapter("", "", "", false)
	require.False(t, linkedin.AnalyticsSupport().Content)
}

func TestFacebookContentAnalyticsUsesGraphNodeSpecificInsights(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	tests := []struct {
		name          string
		externalID    string
		profile       string
		outputProfile string
		wantPath      string
		wantMetrics   []string
		response      string
		want          AnalyticsValues
	}{
		{
			name: "story", externalID: "story-1", profile: "story", outputProfile: "facebook.story",
			wantPath:    "/v25.0/story-1/insights",
			wantMetrics: []string{"page_story_impressions_by_story_id", "page_story_impressions_by_story_id_unique", "story_interaction", "pages_fb_story_thread_lightweight_reactions", "pages_fb_story_replies", "pages_fb_story_shares"},
			response:    `{"data":[{"name":"page_story_impressions_by_story_id","values":[{"value":100}]},{"name":"page_story_impressions_by_story_id_unique","values":[{"value":70}]},{"name":"pages_fb_story_replies","values":[{"value":4}]},{"name":"pages_fb_story_shares","values":[{"value":2}]}]}`,
			want:        AnalyticsValues{MetricImpressions: 100, MetricReach: 70, MetricComments: 4, MetricShares: 2},
		},
		{
			name: "video", externalID: "video-1", profile: "short_video", outputProfile: "facebook.reel",
			wantPath:    "/v25.0/video-1/video_insights",
			wantMetrics: []string{"fb_reels_total_plays", "post_video_likes_by_reaction_type", "post_video_social_actions"},
			response:    `{"data":[{"name":"fb_reels_total_plays","values":[{"value":120}]},{"name":"post_video_likes_by_reaction_type","values":[{"value":{"LIKE":8,"LOVE":3}}]},{"name":"post_video_social_actions","values":[{"value":{"COMMENT":4,"SHARE":2}}]}]}`,
			want:        AnalyticsValues{MetricViews: 120, MetricReactions: 11, MetricEngagements: 6},
		},
		{
			name: "regular video", externalID: "video-2", profile: "long_video", outputProfile: "facebook.video",
			wantPath:    "/v25.0/video-2/video_insights",
			wantMetrics: []string{"total_video_views", "post_video_likes_by_reaction_type", "post_video_social_actions"},
			response:    `{"data":[{"name":"total_video_views","values":[{"value":95}]},{"name":"post_video_likes_by_reaction_type","values":[{"value":{"LIKE":5}}]},{"name":"post_video_social_actions","values":[{"value":{"COMMENT":2}}]}]}`,
			want:        AnalyticsValues{MetricViews: 95, MetricReactions: 5, MetricEngagements: 2},
		},
		{
			name: "feed post", externalID: "page-1_post-1", profile: "short_text",
			wantPath:    "/v25.0/page-1_post-1/insights",
			wantMetrics: []string{"post_media_view", "post_total_media_view_unique", "post_reactions_like_total", "post_clicks"},
			response:    `{"data":[{"name":"post_media_view","values":[{"value":90}]},{"name":"post_total_media_view_unique","values":[{"value":60}]},{"name":"post_reactions_like_total","values":[{"value":7}]},{"name":"post_clicks","values":[{"value":5}]}]}`,
			want:        AnalyticsValues{MetricImpressions: 90, MetricReach: 60, MetricLikes: 16, MetricComments: 4, MetricShares: 2, MetricClicks: 5},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if test.name == "feed post" && req.URL.Path == "/v25.0/page-1_post-1" {
					return jsonResponse(req, `{"reactions":{"summary":{"total_count":9}},"comments":{"summary":{"total_count":4}},"shares":{"count":2}}`), nil
				}
				if req.URL.Path != test.wantPath {
					t.Fatalf("unexpected path %s", req.URL.Path)
				}
				if req.URL.Query().Get("period") != "lifetime" {
					t.Fatalf("expected lifetime period, got %q", req.URL.Query().Get("period"))
				}
				for _, metric := range test.wantMetrics {
					if !strings.Contains(req.URL.Query().Get("metric"), metric) {
						t.Fatalf("missing metric %s in %s", metric, req.URL.RawQuery)
					}
				}
				return jsonResponse(req, test.response), nil
			})}

			values, err := NewFacebookAdapter("", "", "").FetchContentAnalytics(t.Context(), "token", ContentAnalyticsRequest{
				ExternalIDs: []string{test.externalID}, Profile: test.profile, OutputProfile: test.outputProfile,
			})
			if err != nil {
				t.Fatalf("FetchContentAnalytics returned error: %v", err)
			}
			require.Equal(t, test.want, values)
		})
	}
}

func TestXAnalyticsUsesPublicMetricsAndKeepsMetricKindsDistinct(t *testing.T) {
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(req.URL.Path, "/users/") {
			_, _ = w.Write([]byte(`{"data":{"public_metrics":{"followers_count":30,"following_count":4,"tweet_count":10}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"public_metrics":{"like_count":8,"reply_count":3,"retweet_count":2,"quote_count":1,"impression_count":100,"bookmark_count":4}}]}`))
	}))
	defer server.Close()

	adapter := NewXAdapter("consumer", "secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL

	account, err := adapter.FetchAccountAnalytics(context.Background(), "access|secret", AccountAnalyticsRequest{AccountID: "user"})
	require.NoError(t, err)
	require.Equal(t, int64(30), account[MetricFollowers])

	content, err := adapter.FetchContentAnalytics(context.Background(), "access|secret", ContentAnalyticsRequest{ExternalIDs: []string{"tweet"}, OwnReplyCount: 1})
	require.NoError(t, err)
	require.Equal(t, int64(2), content[MetricComments])
	require.Equal(t, int64(2), content[MetricReposts])
	require.Equal(t, int64(1), content[MetricQuotes])
	require.Equal(t, int64(100), content[MetricImpressions])
	require.Equal(t, int64(4), content[MetricSaves])
}

func TestXAnalyticsRejectsPartialContentResponses(t *testing.T) {
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"public_metrics":{"like_count":8}}],"errors":[{"type":"https://api.x.com/2/problems/resource-not-found","title":"Not Found"}]}`))
	}))
	defer server.Close()

	adapter := NewXAdapter("consumer", "secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL

	_, err := adapter.FetchContentAnalytics(context.Background(), "access|secret", ContentAnalyticsRequest{ExternalIDs: []string{"tweet-1", "tweet-2"}})
	require.Error(t, err)
	var analyticsErr *AnalyticsError
	require.ErrorAs(t, err, &analyticsErr)
	require.Equal(t, AnalyticsStatusFailed, analyticsErr.Status)
	require.Equal(t, "partial_response", analyticsErr.Code)
}

func TestXAnalyticsBacksOffWhenCreditsAreDepleted(t *testing.T) {
	server := newProviderTestServer(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"title":"Credits depleted"}`))
	}))
	defer server.Close()

	adapter := NewXAdapter("consumer", "secret", "")
	defer close(adapter.cleanupDone)
	adapter.apiBaseURL = server.URL

	_, err := adapter.FetchAccountAnalytics(context.Background(), "access|secret", AccountAnalyticsRequest{AccountID: "user"})
	require.Error(t, err)
	var analyticsErr *AnalyticsError
	require.ErrorAs(t, err, &analyticsErr)
	require.Equal(t, AnalyticsStatusRateLimited, analyticsErr.Status)
	require.Equal(t, "credits_depleted", analyticsErr.Code)
	require.Equal(t, 24*time.Hour, analyticsErr.RetryAfter)
}

func TestAnalyticsHelpersKeepMissingMetricsDistinctFromMeasuredZero(t *testing.T) {
	values := AnalyticsValues{}
	addStringMetric(values, MetricFollowers, "")
	addStringMetric(values, MetricViews, "not-a-number")
	subtractOwnReplies(values, 1)

	require.NotContains(t, values, MetricFollowers)
	require.NotContains(t, values, MetricViews)
	require.NotContains(t, values, MetricComments)

	values[MetricComments] = 0
	subtractOwnReplies(values, 1)
	require.Contains(t, values, MetricComments)
	require.Zero(t, values[MetricComments])
}

func TestMetaInsightFallbackPreservesProviderFailures(t *testing.T) {
	for _, tc := range []struct {
		name                string
		status              int
		body, code, subcode string
		wantStatus          int
	}{
		{"permission", 400, `{"error":{"code":200}}`, "meta:permission:200", "", 403},
		{"token", 400, `{"error":{"code":190}}`, "meta:token_expired:190", "", 401},
		{"rate limit", 400, `{"error":{"code":4}}`, "meta:rate_limit:4", "", 429},
		{"unavailable object", 400, `{"error":{"code":100,"error_subcode":33}}`, "meta:nonexistent:100:33", "33", 400},
		{"unknown", 400, `{}`, "", "", 400},
		{"forbidden", 403, `{"error":{"code":100}}`, "meta:100", "", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			originalClient := httpClient
			t.Cleanup(func() { httpClient = originalClient })
			calls := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				return jsonResponseWithStatus(req, tc.status, tc.body), nil
			})}
			_, err := fetchMetaInsightsWithPeriod(t.Context(), "https://graph.facebook.com/post/insights", "token", []string{"views", "reach"}, "lifetime")
			var providerErr *HTTPError
			require.ErrorAs(t, err, &providerErr)
			require.Equal(t, tc.code, providerErr.Code)
			require.Equal(t, tc.subcode, providerErr.Subcode)
			require.Equal(t, tc.wantStatus, providerErr.StatusCode)
			require.Equal(t, 1, calls)
		})
	}
}

func TestMetaInsightFallbackKeepsSupportedMetricsAndRejectsEntirelyInvalidRequests(t *testing.T) {
	for _, supported := range []bool{false, true} {
		t.Run(fmt.Sprint(supported), func(t *testing.T) {
			originalClient := httpClient
			t.Cleanup(func() { httpClient = originalClient })
			calls := 0
			httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				if supported && req.URL.Query().Get("metric") == "reach" {
					return jsonResponse(req, `{"data":[{"name":"reach","values":[{"value":7}]}]}`), nil
				}
				return jsonResponseWithStatus(req, http.StatusBadRequest, `{"error":{"code":100}}`), nil
			})}
			response, err := fetchMetaInsightsWithPeriod(t.Context(), "https://graph.facebook.com/post/insights", "token", []string{"views", "reach"}, "lifetime")
			require.Equal(t, 3, calls)
			if supported {
				require.NoError(t, err)
				require.Len(t, response.Data, 1)
				require.Equal(t, "reach", response.Data[0].Name)
			} else {
				var providerErr *HTTPError
				require.ErrorAs(t, err, &providerErr)
				require.Equal(t, "100", providerErr.Code)
			}
		})
	}
}
