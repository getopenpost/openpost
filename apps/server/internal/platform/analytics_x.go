package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const xAnalyticsCreditsRetryAfter = 24 * time.Hour

type xAnalyticsProviderError struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

func (x *XAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{Account: true, Content: true}
}

func (x *XAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	query := url.Values{"user.fields": {"public_metrics"}}
	endpoint := strings.TrimRight(x.apiBaseURL, "/") + "/2/users/" + url.PathEscape(input.AccountID) + "?" + query.Encode()
	body, err := x.doSignedRequest(ctx, accessToken, http.MethodGet, endpoint, nil, nil)
	if err != nil {
		return nil, xAnalyticsRequestError("x account analytics", err)
	}
	var response struct {
		Data *struct {
			PublicMetrics map[string]int64 `json:"public_metrics"`
		} `json:"data"`
		Errors []xAnalyticsProviderError `json:"errors"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding x account analytics: %w", err)
	}
	if len(response.Errors) > 0 {
		return nil, NewAnalyticsError(AnalyticsStatusFailed, "partial_response")
	}
	if response.Data == nil {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "account_not_found")
	}
	return mapXMetrics(response.Data.PublicMetrics), nil
}

func (x *XAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	ids := uniqueNonEmpty(input.ExternalIDs)
	if len(ids) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "missing_external_id")
	}
	total := AnalyticsValues{}
	found := 0
	for start := 0; start < len(ids); start += 100 {
		end := min(start+100, len(ids))
		query := url.Values{
			"ids":          {strings.Join(ids[start:end], ",")},
			"tweet.fields": {"public_metrics"},
		}
		endpoint := strings.TrimRight(x.apiBaseURL, "/") + "/2/tweets?" + query.Encode()
		body, err := x.doSignedRequest(ctx, accessToken, http.MethodGet, endpoint, nil, nil)
		if err != nil {
			return nil, xAnalyticsRequestError("x content analytics", err)
		}
		var response struct {
			Data []struct {
				PublicMetrics map[string]int64 `json:"public_metrics"`
			} `json:"data"`
			Errors []xAnalyticsProviderError `json:"errors"`
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return nil, fmt.Errorf("decoding x content analytics: %w", err)
		}
		if len(response.Data) == 0 && len(response.Errors) > 0 {
			return nil, NewAnalyticsError(AnalyticsStatusNotFound, "content_not_found")
		}
		if len(response.Errors) > 0 || len(response.Data) != end-start {
			return nil, NewAnalyticsError(AnalyticsStatusFailed, "partial_response")
		}
		found += len(response.Data)
		for _, tweet := range response.Data {
			AddAnalyticsValues(total, mapXMetrics(tweet.PublicMetrics))
		}
	}
	if found == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "content_not_found")
	}
	subtractOwnReplies(total, input.OwnReplyCount)
	return total, nil
}

func xAnalyticsRequestError(operation string, err error) error {
	var httpErr *HTTPError
	if errors.As(err, &httpErr) && httpErr.StatusCode == http.StatusPaymentRequired {
		return fmt.Errorf("%s: %w", operation, &AnalyticsError{
			Status:     AnalyticsStatusRateLimited,
			Code:       "credits_depleted",
			RetryAfter: xAnalyticsCreditsRetryAfter,
		})
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func mapXMetrics(metrics map[string]int64) AnalyticsValues {
	values := AnalyticsValues{}
	for providerMetric, value := range metrics {
		switch providerMetric {
		case "followers_count":
			values[MetricFollowers] = value
		case "following_count":
			values[MetricFollowing] = value
		case "tweet_count":
			values[MetricPosts] = value
		case "like_count":
			values[MetricLikes] = value
		case "reply_count":
			values[MetricComments] = value
		case "retweet_count":
			values[MetricReposts] = value
		case "quote_count":
			values[MetricQuotes] = value
		case "impression_count":
			values[MetricImpressions] = value
		case "bookmark_count":
			values[MetricSaves] = value
		}
	}
	return values
}
