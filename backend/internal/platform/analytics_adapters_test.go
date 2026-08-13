package platform

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
	content, err = facebook.FetchContentAnalytics(ctx, "token", ContentAnalyticsRequest{ExternalIDs: []string{"post"}})
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

func TestXAnalyticsUsesPublicMetricsAndKeepsMetricKindsDistinct(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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

func TestLinkedInAnalyticsSupportsMembersAndOrganizationPages(t *testing.T) {
	t.Setenv("LINKEDIN_API_VERSION", "202606")
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		require.Equal(t, "Bearer linkedin-token", req.Header.Get("Authorization"))
		require.Equal(t, "202606", req.Header.Get("Linkedin-Version"))
		switch {
		case req.URL.Path == "/rest/memberFollowersCount":
			require.Equal(t, "me", req.URL.Query().Get("q"))
			return jsonResponse(req, `{"elements":[{"memberFollowersCount":120}]}`), nil
		case strings.HasPrefix(req.URL.Path, "/rest/networkSizes/"):
			require.Equal(t, "CompanyFollowedByMember", req.URL.Query().Get("edgeType"))
			return jsonResponse(req, `{"firstDegreeSize":450}`), nil
		case req.URL.Path == "/rest/memberCreatorPostAnalytics":
			counts := map[string]int64{
				"IMPRESSION": 200, "MEMBERS_REACHED": 150, "REACTION": 8,
				"COMMENT": 3, "RESHARE": 2, "POST_SAVE": 4, "LINK_CLICKS": 6,
			}
			require.Equal(t, "entity", req.URL.Query().Get("q"))
			require.Equal(t, "urn:li:share:123", req.URL.Query().Get("entity"))
			return jsonResponse(req, fmt.Sprintf(
				`{"elements":[{"count":%d}]}`,
				counts[req.URL.Query().Get("queryType")],
			)), nil
		case req.URL.Path == "/rest/organizationalEntityShareStatistics":
			require.Equal(t, "urn:li:organization:42", req.URL.Query().Get("organizationalEntity"))
			require.Contains(t, req.URL.Query().Get("shares"), "urn:li:share:456")
			return jsonResponse(req, `{"elements":[{"totalShareStatistics":{"clickCount":9,"commentCount":4,"impressionCount":500,"likeCount":12,"shareCount":3,"uniqueImpressionsCount":350}}]}`), nil
		default:
			t.Fatalf("unexpected LinkedIn analytics request %s", req.URL.String())
			return nil, nil
		}
	})}

	adapter := NewLinkedInAdapter("", "", "", false, true)
	memberSupport := adapter.AnalyticsSupportForAccount(AnalyticsAccountContext{
		AccountID:       "urn:li:person:member",
		CapabilityState: map[string]string{"linkedin_account_type": "person"},
	})
	require.Equal(t, []string{linkedinScopeMemberProfileAnalytics}, memberSupport.AccountRequiredScopes)
	require.Equal(t, []string{linkedinScopeMemberPostAnalytics}, memberSupport.ContentRequiredScopes)
	organizationSupport := adapter.AnalyticsSupportForAccount(AnalyticsAccountContext{
		AccountID:       "urn:li:organization:42",
		CapabilityState: map[string]string{"linkedin_account_type": "organization"},
	})
	require.Equal(t, []string{linkedinScopeOrganizationAdmin}, organizationSupport.AccountRequiredScopes)

	memberAccount, err := adapter.FetchAccountAnalytics(
		context.Background(),
		"linkedin-token",
		AccountAnalyticsRequest{
			AccountID:       "urn:li:person:member",
			CapabilityState: map[string]string{"linkedin_account_type": "person"},
		},
	)
	require.NoError(t, err)
	require.Equal(t, int64(120), memberAccount[MetricFollowers])
	organizationAccount, err := adapter.FetchAccountAnalytics(
		context.Background(),
		"linkedin-token",
		AccountAnalyticsRequest{
			AccountID:       "urn:li:organization:42",
			CapabilityState: map[string]string{"linkedin_account_type": "organization"},
		},
	)
	require.NoError(t, err)
	require.Equal(t, int64(450), organizationAccount[MetricFollowers])

	memberContent, err := adapter.FetchContentAnalytics(
		context.Background(),
		"linkedin-token",
		ContentAnalyticsRequest{
			AccountID:   "urn:li:person:member",
			ExternalIDs: []string{"urn:li:share:123"},
		},
	)
	require.NoError(t, err)
	require.Equal(t, int64(200), memberContent[MetricImpressions])
	require.Equal(t, int64(150), memberContent[MetricReach])
	require.Equal(t, int64(8), memberContent[MetricLikes])
	require.Equal(t, int64(6), memberContent[MetricClicks])

	organizationContent, err := adapter.FetchContentAnalytics(
		context.Background(),
		"linkedin-token",
		ContentAnalyticsRequest{
			AccountID:   "urn:li:organization:42",
			ExternalIDs: []string{"urn:li:share:456"},
		},
	)
	require.NoError(t, err)
	require.Equal(t, int64(500), organizationContent[MetricImpressions])
	require.Equal(t, int64(350), organizationContent[MetricReach])
	require.Equal(t, int64(12), organizationContent[MetricLikes])
}

func TestInstagramAnalyticsFallsBackWhenOneInsightMetricIsUnsupported(t *testing.T) {
	originalClient := httpClient
	defer func() { httpClient = originalClient }()

	httpClient = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(req.URL.Path, "/insights") {
			return jsonResponse(req, `{"like_count":3,"comments_count":1}`), nil
		}
		metric := req.URL.Query().Get("metric")
		switch metric {
		case "views":
			return jsonResponse(req, `{"data":[{"name":"views","values":[{"value":120}]}]}`), nil
		case "saved":
			return jsonResponse(req, `{"data":[{"name":"saved","values":[{"value":4}]}]}`), nil
		default:
			return &http.Response{
				StatusCode: http.StatusBadRequest,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"error":{"message":"unsupported metric"}}`)),
				Request:    req,
			}, nil
		}
	})}

	values, err := NewInstagramAdapter("", "", "").FetchContentAnalytics(
		context.Background(),
		"token",
		ContentAnalyticsRequest{ExternalIDs: []string{"post"}},
	)
	require.NoError(t, err)
	require.Equal(t, int64(3), values[MetricLikes])
	require.Equal(t, int64(120), values[MetricViews])
	require.Equal(t, int64(4), values[MetricSaves])
	require.NotContains(t, values, MetricReach)
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
