package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
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

func (y *YouTubeAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{
		Account: true,
		Content: true,
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

func (l *LinkedInAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{
		Account:            false,
		Content:            false,
		AccountUnavailable: "LinkedIn does not expose personal profile analytics to this connection type.",
		ContentUnavailable: "LinkedIn member post analytics require restricted read access that OpenPost cannot request by default.",
	}
}

func (l *LinkedInAdapter) FetchAccountAnalytics(context.Context, string, AccountAnalyticsRequest) (AnalyticsValues, error) {
	return nil, NewAnalyticsError(AnalyticsStatusUnsupported, "linkedin_personal_analytics")
}

func (l *LinkedInAdapter) FetchContentAnalytics(context.Context, string, ContentAnalyticsRequest) (AnalyticsValues, error) {
	return nil, NewAnalyticsError(AnalyticsStatusUnsupported, "linkedin_member_post_analytics")
}
