package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const tiktokVideoQueryURL = "https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count"

func (t *TikTokAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{
		Account:               true,
		Content:               true,
		AccountRequiredScopes: []string{"user.info.stats"},
		ContentRequiredScopes: []string{"video.list"},
	}
}

func (t *TikTokAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, _ AccountAnalyticsRequest) (AnalyticsValues, error) {
	endpoint := "https://open.tiktokapis.com/v2/user/info/?fields=open_id,follower_count,following_count,likes_count,video_count"
	body, err := DoRequest(ctx, http.MethodGet, endpoint, nil, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return nil, fmt.Errorf("tiktok account analytics: %w", err)
	}
	var response struct {
		Data struct {
			User struct {
				FollowerCount  *int64 `json:"follower_count"`
				FollowingCount *int64 `json:"following_count"`
				LikesCount     *int64 `json:"likes_count"`
				VideoCount     *int64 `json:"video_count"`
			} `json:"user"`
		} `json:"data"`
		Error tiktokAPIError `json:"error"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding tiktok account analytics: %w", err)
	}
	if response.Error.Code != "" && response.Error.Code != "ok" {
		return nil, tiktokAnalyticsError(response.Error.Code)
	}
	values := AnalyticsValues{}
	addOptionalMetric(values, MetricFollowers, response.Data.User.FollowerCount)
	addOptionalMetric(values, MetricFollowing, response.Data.User.FollowingCount)
	addOptionalMetric(values, MetricLikes, response.Data.User.LikesCount)
	addOptionalMetric(values, MetricPosts, response.Data.User.VideoCount)
	return values, nil
}

func (t *TikTokAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	ids := uniqueNonEmpty(input.ExternalIDs)
	if len(ids) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "missing_external_id")
	}
	total := AnalyticsValues{}
	found := 0
	for start := 0; start < len(ids); start += 20 {
		end := min(start+20, len(ids))
		body, err := DoJSON(ctx, http.MethodPost, tiktokVideoQueryURL, map[string]any{
			"filters": map[string]any{"video_ids": ids[start:end]},
		}, map[string]string{
			headerAuthorization: bearerPrefix + accessToken,
		})
		if err != nil {
			return nil, fmt.Errorf("tiktok content analytics: %w", err)
		}
		var response struct {
			Data struct {
				Videos []struct {
					LikeCount    *int64 `json:"like_count"`
					CommentCount *int64 `json:"comment_count"`
					ShareCount   *int64 `json:"share_count"`
					ViewCount    *int64 `json:"view_count"`
				} `json:"videos"`
			} `json:"data"`
			Error tiktokAPIError `json:"error"`
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return nil, fmt.Errorf("decoding tiktok content analytics: %w", err)
		}
		if response.Error.Code != "" && response.Error.Code != "ok" {
			return nil, tiktokAnalyticsError(response.Error.Code)
		}
		found += len(response.Data.Videos)
		for _, video := range response.Data.Videos {
			addOptionalMetric(total, MetricLikes, video.LikeCount)
			addOptionalMetric(total, MetricComments, video.CommentCount)
			addOptionalMetric(total, MetricShares, video.ShareCount)
			addOptionalMetric(total, MetricViews, video.ViewCount)
		}
	}
	if found == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "content_not_found")
	}
	return total, nil
}

func tiktokAnalyticsError(code string) error {
	normalized := strings.ToLower(strings.TrimSpace(code))
	status := AnalyticsStatusFailed
	switch {
	case strings.Contains(normalized, "scope"),
		strings.Contains(normalized, "access_token"),
		strings.Contains(normalized, "permission"):
		status = AnalyticsStatusPermissionRequired
	case strings.Contains(normalized, "rate"),
		strings.Contains(normalized, "too_many"):
		status = AnalyticsStatusRateLimited
	case strings.Contains(normalized, "not_found"):
		status = AnalyticsStatusNotFound
	}
	return NewAnalyticsError(status, code)
}

const (
	youtubeAnalyticsAPIBaseURL   = "https://youtubeanalytics.googleapis.com/v2"
	youtubeAnalyticsReadScope    = "https://www.googleapis.com/auth/yt-analytics.readonly"
	youtubeAnalyticsMetricSource = "youtube_analytics_api"
)

var youtubeAnalyticsReportMetrics = []string{
	"views",
	"estimatedMinutesWatched",
	"averageViewDuration",
	"averageViewPercentage",
	"subscribersGained",
	"subscribersLost",
	"likes",
	"comments",
	"shares",
}

func (y *YouTubeAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{
		Account:               true,
		Content:               true,
		AccountRequiredScopes: []string{youtubeAnalyticsReadScope},
		ContentRequiredScopes: []string{youtubeAnalyticsReadScope},
	}
}

func (y *YouTubeAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	query := url.Values{
		"part": {"statistics"},
		"id":   {input.AccountID},
	}
	body, err := DoRequest(ctx, http.MethodGet, youtubeAPIBaseURL+"/channels?"+query.Encode(), nil, bearerHeaders(accessToken))
	if err != nil {
		return nil, fmt.Errorf("youtube account analytics: %w", err)
	}
	var response struct {
		Items []struct {
			Statistics struct {
				SubscriberCount string `json:"subscriberCount"`
				VideoCount      string `json:"videoCount"`
				ViewCount       string `json:"viewCount"`
			} `json:"statistics"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding youtube account analytics: %w", err)
	}
	if len(response.Items) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "channel_not_found")
	}
	values := AnalyticsValues{}
	addStringMetric(values, MetricFollowers, response.Items[0].Statistics.SubscriberCount)
	addStringMetric(values, MetricPosts, response.Items[0].Statistics.VideoCount)
	addStringMetric(values, MetricViews, response.Items[0].Statistics.ViewCount)
	return values, nil
}

func (y *YouTubeAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	ids := uniqueNonEmpty(input.ExternalIDs)
	if len(ids) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "missing_external_id")
	}
	total := AnalyticsValues{}
	found := 0
	for start := 0; start < len(ids); start += 50 {
		end := min(start+50, len(ids))
		query := url.Values{
			"part": {"statistics"},
			"id":   {strings.Join(ids[start:end], ",")},
		}
		body, err := DoRequest(ctx, http.MethodGet, youtubeAPIBaseURL+"/videos?"+query.Encode(), nil, bearerHeaders(accessToken))
		if err != nil {
			return nil, fmt.Errorf("youtube content analytics: %w", err)
		}
		var response struct {
			Items []struct {
				Statistics struct {
					ViewCount    string `json:"viewCount"`
					LikeCount    string `json:"likeCount"`
					CommentCount string `json:"commentCount"`
				} `json:"statistics"`
			} `json:"items"`
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return nil, fmt.Errorf("decoding youtube content analytics: %w", err)
		}
		found += len(response.Items)
		for _, video := range response.Items {
			addStringMetric(total, MetricViews, video.Statistics.ViewCount)
			addStringMetric(total, MetricLikes, video.Statistics.LikeCount)
			addStringMetric(total, MetricComments, video.Statistics.CommentCount)
		}
	}
	if found == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "content_not_found")
	}
	return total, nil
}

func (y *YouTubeAdapter) FetchAccountAnalyticsMeasurements(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsMeasurements, error) {
	lifetime, err := y.FetchAccountAnalytics(ctx, accessToken, input)
	if err != nil {
		return nil, err
	}
	measurements := youtubeLifetimeMeasurements(lifetime, AnalyticsMetricSubjectAccount)
	report, err := y.fetchYouTubeAnalyticsReport(ctx, accessToken, input.ReportingPeriodStart, input.ReportingPeriodEnd, nil)
	if err != nil {
		return nil, err
	}
	addAnalyticsMeasurements(measurements, report)
	return measurements, nil
}

func (y *YouTubeAdapter) FetchContentAnalyticsMeasurements(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsMeasurements, error) {
	lifetime, err := y.FetchContentAnalytics(ctx, accessToken, input)
	if err != nil {
		return nil, err
	}
	measurements := youtubeLifetimeMeasurements(lifetime, AnalyticsMetricSubjectContent)
	report, err := y.fetchYouTubeAnalyticsReport(ctx, accessToken, input.ReportingPeriodStart, input.ReportingPeriodEnd, uniqueNonEmpty(input.ExternalIDs))
	if err != nil {
		return nil, err
	}
	addAnalyticsMeasurements(measurements, report)
	return measurements, nil
}

func youtubeLifetimeMeasurements(values AnalyticsValues, subject string) AnalyticsMeasurements {
	measurements := make(AnalyticsMeasurements, len(values))
	for metric, value := range values {
		aggregation := AnalyticsMetricAggregationLifetimeTotal
		if subject == AnalyticsMetricSubjectAccount && (metric == MetricFollowers || metric == MetricPosts) {
			aggregation = AnalyticsMetricAggregationCurrentSnapshot
		}
		measurements[metric] = AnalyticsMeasurement{
			Value: value,
			AnalyticsMetricMetadata: AnalyticsMetricMetadata{
				Unit:        AnalyticsMetricUnitCount,
				Aggregation: aggregation,
				Source:      youtubeDataAPIMetricSource,
			},
		}
	}
	return measurements
}

func addAnalyticsMeasurements(target, source AnalyticsMeasurements) {
	for metric, measurement := range source {
		target[metric] = measurement
	}
}

func (y *YouTubeAdapter) fetchYouTubeAnalyticsReport(
	ctx context.Context,
	accessToken string,
	start, end time.Time,
	videoIDs []string,
) (AnalyticsMeasurements, error) {
	start = start.UTC()
	end = end.UTC()
	if start.IsZero() || end.IsZero() || !start.Before(end) {
		return nil, NewAnalyticsError(AnalyticsStatusFailed, "invalid_reporting_period")
	}
	query := url.Values{
		"ids":       {"channel==MINE"},
		"startDate": {start.Format(time.DateOnly)},
		"endDate":   {end.Format(time.DateOnly)},
		"metrics":   {strings.Join(youtubeAnalyticsReportMetrics, ",")},
	}
	if len(videoIDs) > 0 {
		query.Set("filters", "video=="+strings.Join(videoIDs, ","))
	}
	response, err := doYouTubeRequest(ctx, http.MethodGet, youtubeAnalyticsAPIBaseURL+"/reports?"+query.Encode(), nil, bearerHeaders(accessToken))
	if err != nil {
		return nil, fmt.Errorf("youtube analytics report: %w", err)
	}
	if response.statusCode < http.StatusOK || response.statusCode >= http.StatusMultipleChoices {
		return nil, youtubeAnalyticsError(response)
	}
	measurements, err := decodeYouTubeAnalyticsReport(response.body, start, end)
	if err != nil {
		return nil, fmt.Errorf("decoding youtube analytics report: %w", err)
	}
	return measurements, nil
}

type youtubeAnalyticsReportResponse struct {
	ColumnHeaders []struct {
		Name string `json:"name"`
	} `json:"columnHeaders"`
	Rows [][]json.RawMessage `json:"rows"`
}

func decodeYouTubeAnalyticsReport(body []byte, start, end time.Time) (AnalyticsMeasurements, error) {
	var report youtubeAnalyticsReportResponse
	if err := json.Unmarshal(body, &report); err != nil {
		return nil, err
	}
	measurements := AnalyticsMeasurements{}
	if len(report.Rows) == 0 {
		return measurements, nil
	}
	row := report.Rows[0]
	for column, header := range report.ColumnHeaders {
		if column >= len(row) || string(row[column]) == "null" {
			continue
		}
		value, err := strconv.ParseFloat(strings.Trim(string(row[column]), `"`), 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		metric, normalized, unit, aggregation, ok := normalizeYouTubeAnalyticsMetric(header.Name, value)
		if !ok {
			continue
		}
		periodStart, periodEnd := start, end
		measurements[metric] = AnalyticsMeasurement{
			Value: normalized,
			AnalyticsMetricMetadata: AnalyticsMetricMetadata{
				Unit:        unit,
				Aggregation: aggregation,
				Source:      youtubeAnalyticsMetricSource,
				PeriodStart: &periodStart,
				PeriodEnd:   &periodEnd,
			},
		}
	}
	return measurements, nil
}

func normalizeYouTubeAnalyticsMetric(name string, value float64) (string, int64, AnalyticsMetricUnit, AnalyticsMetricAggregation, bool) {
	metric := ""
	multiplier := float64(1)
	unit := AnalyticsMetricUnitCount
	aggregation := AnalyticsMetricAggregationReportingPeriodTotal
	switch name {
	case "views":
		metric = MetricReportViews
	case "estimatedMinutesWatched":
		metric = MetricEstimatedWatchTime
		multiplier = 60_000
		unit = AnalyticsMetricUnitMilliseconds
	case "averageViewDuration":
		metric = MetricAverageViewDuration
		multiplier = 1_000
		unit = AnalyticsMetricUnitMilliseconds
		aggregation = AnalyticsMetricAggregationReportingPeriodAverage
	case "averageViewPercentage":
		metric = MetricAverageViewPercentage
		multiplier = 100
		unit = AnalyticsMetricUnitBasisPoints
		aggregation = AnalyticsMetricAggregationReportingPeriodAverage
	case "subscribersGained":
		metric = MetricSubscribersGained
	case "subscribersLost":
		metric = MetricSubscribersLost
	case "likes":
		metric = MetricReportLikes
	case "comments":
		metric = MetricReportComments
	case "shares":
		metric = MetricReportShares
	default:
		return "", 0, "", "", false
	}
	return metric, int64(math.Round(value * multiplier)), unit, aggregation, true
}

func youtubeAnalyticsError(response *youtubeHTTPResponse) error {
	code := strings.TrimSpace(youtubeErrorReason(response.body))
	if !safeProviderCode.MatchString(code) {
		code = "provider_request_failed"
	}
	status := AnalyticsStatusFailed
	switch response.statusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		status = AnalyticsStatusPermissionRequired
	case http.StatusTooManyRequests:
		status = AnalyticsStatusRateLimited
	case http.StatusNotFound:
		status = AnalyticsStatusNotFound
	}
	return NewAnalyticsError(status, code)
}

func addStringMetric(values AnalyticsValues, metric, raw string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return
	}
	count, err := strconv.ParseInt(raw, 10, 64)
	if err == nil {
		values[metric] += count
	}
}
