package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func (f *FacebookAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{
		Account: true,
		Content: true,
	}
}

func (f *FacebookAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	query := url.Values{
		"fields":              {"followers_count,fan_count"},
		oauthParamAccessToken: {accessToken},
	}
	body, err := DoRequest(ctx, http.MethodGet, f.graphURL(input.AccountID)+"?"+query.Encode(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("facebook account analytics: %w", err)
	}
	var response struct {
		FollowersCount *int64 `json:"followers_count"`
		FanCount       *int64 `json:"fan_count"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding facebook account analytics: %w", err)
	}
	values := AnalyticsValues{}
	if response.FollowersCount != nil {
		values[MetricFollowers] = *response.FollowersCount
	} else if response.FanCount != nil {
		values[MetricFollowers] = *response.FanCount
	}
	return values, nil
}

func (f *FacebookAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	total := AnalyticsValues{}
	for _, externalID := range uniqueNonEmpty(input.ExternalIDs) {
		edge, metrics, feedPost := facebookContentInsightRequest(input, externalID)
		if feedPost {
			if err := f.fetchFacebookFeedEngagement(ctx, accessToken, externalID, total); err != nil {
				return nil, err
			}
		}
		response, err := fetchMetaInsightsWithPeriod(ctx, f.graphURL(externalID+"/"+edge), accessToken, metrics, "lifetime")
		if err != nil {
			return nil, fmt.Errorf("facebook content insights: %w", err)
		}
		addMetaInsights(total, response)
	}
	return total, nil
}

func facebookContentInsightRequest(input ContentAnalyticsRequest, externalID string) (string, []string, bool) {
	if input.Profile == "story" || input.OutputProfile == "facebook.story" {
		return "insights", []string{
			"page_story_impressions_by_story_id",
			"page_story_impressions_by_story_id_unique",
			"story_interaction",
			"pages_fb_story_thread_lightweight_reactions",
			"pages_fb_story_replies",
			"pages_fb_story_shares",
		}, false
	}
	if strings.Contains(externalID, "_") {
		return "insights", []string{
			"post_media_view",
			"post_total_media_view_unique",
			"post_reactions_like_total",
			"post_clicks",
		}, true
	}
	return "video_insights", []string{
		"fb_reels_total_plays",
		"post_video_likes_by_reaction_type",
		"post_video_social_actions",
	}, false
}

func (f *FacebookAdapter) fetchFacebookFeedEngagement(ctx context.Context, accessToken, externalID string, total AnalyticsValues) error {
	query := url.Values{
		"fields":              {"reactions.limit(0).summary(true),comments.limit(0).summary(true),shares"},
		oauthParamAccessToken: {accessToken},
	}
	body, err := DoRequest(ctx, http.MethodGet, f.graphURL(externalID)+"?"+query.Encode(), nil, nil)
	if err != nil {
		return fmt.Errorf("facebook content analytics: %w", err)
	}
	var response struct {
		Reactions struct {
			Summary struct {
				TotalCount *int64 `json:"total_count"`
			} `json:"summary"`
		} `json:"reactions"`
		Comments struct {
			Summary struct {
				TotalCount *int64 `json:"total_count"`
			} `json:"summary"`
		} `json:"comments"`
		Shares struct {
			Count *int64 `json:"count"`
		} `json:"shares"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return fmt.Errorf("decoding facebook content analytics: %w", err)
	}
	addOptionalMetric(total, MetricLikes, response.Reactions.Summary.TotalCount)
	addOptionalMetric(total, MetricComments, response.Comments.Summary.TotalCount)
	addOptionalMetric(total, MetricShares, response.Shares.Count)
	return nil
}

func (i *InstagramAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{
		Account:               true,
		Content:               true,
		ContentRequiredScopes: []string{"instagram_manage_insights"},
	}
}

func (i *InstagramAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	query := url.Values{
		"fields":              {"followers_count,media_count"},
		oauthParamAccessToken: {accessToken},
	}
	body, err := DoRequest(ctx, http.MethodGet, i.graphURL(input.AccountID)+"?"+query.Encode(), nil, nil)
	if err != nil {
		return nil, fmt.Errorf("instagram account analytics: %w", err)
	}
	var response struct {
		FollowersCount *int64 `json:"followers_count"`
		MediaCount     *int64 `json:"media_count"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding instagram account analytics: %w", err)
	}
	values := AnalyticsValues{}
	addOptionalMetric(values, MetricFollowers, response.FollowersCount)
	addOptionalMetric(values, MetricPosts, response.MediaCount)
	return values, nil
}

func (i *InstagramAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	total := AnalyticsValues{}
	for _, externalID := range uniqueNonEmpty(input.ExternalIDs) {
		baseQuery := url.Values{
			"fields":              {"like_count,comments_count"},
			oauthParamAccessToken: {accessToken},
		}
		body, err := DoRequest(ctx, http.MethodGet, i.graphURL(externalID)+"?"+baseQuery.Encode(), nil, nil)
		if err != nil {
			return nil, fmt.Errorf("instagram content analytics: %w", err)
		}
		var base struct {
			LikeCount     *int64 `json:"like_count"`
			CommentsCount *int64 `json:"comments_count"`
		}
		if err := json.Unmarshal(body, &base); err != nil {
			return nil, fmt.Errorf("decoding instagram content analytics: %w", err)
		}
		addOptionalMetric(total, MetricLikes, base.LikeCount)
		addOptionalMetric(total, MetricComments, base.CommentsCount)

		response, err := fetchMetaInsights(
			ctx,
			i.graphURL(externalID+"/insights"),
			accessToken,
			[]string{"views", "reach", "saved", "shares"},
		)
		if err != nil {
			return nil, fmt.Errorf("instagram content insights: %w", err)
		}
		addMetaInsights(total, response)
	}
	return total, nil
}

func (t *ThreadsAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{
		Account:               true,
		Content:               true,
		AccountRequiredScopes: []string{"threads_manage_insights"},
		ContentRequiredScopes: []string{"threads_manage_insights"},
	}
}

func (t *ThreadsAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsValues, error) {
	response, err := fetchMetaInsights(
		ctx,
		"https://graph.threads.net/v1.0/"+url.PathEscape(input.AccountID)+"/threads_insights",
		accessToken,
		[]string{"followers_count"},
	)
	if err != nil {
		return nil, fmt.Errorf("threads account analytics: %w", err)
	}
	values := AnalyticsValues{}
	addMetaInsights(values, response)
	return values, nil
}

func (t *ThreadsAdapter) FetchContentAnalytics(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	total := AnalyticsValues{}
	for _, externalID := range uniqueNonEmpty(input.ExternalIDs) {
		response, err := fetchMetaInsights(
			ctx,
			"https://graph.threads.net/v1.0/"+url.PathEscape(externalID)+"/insights",
			accessToken,
			[]string{"views", "likes", "replies", "reposts", "quotes", "shares"},
		)
		if err != nil {
			return nil, fmt.Errorf("threads content analytics: %w", err)
		}
		addMetaInsights(total, response)
	}
	subtractOwnReplies(total, input.OwnReplyCount)
	return total, nil
}

type metaInsightsResponse struct {
	Data []struct {
		Name   string `json:"name"`
		Values []struct {
			Value json.RawMessage `json:"value"`
		} `json:"values"`
		TotalValue struct {
			Value json.RawMessage `json:"value"`
		} `json:"total_value"`
	} `json:"data"`
}

func fetchMetaInsights(
	ctx context.Context,
	endpoint string,
	accessToken string,
	metrics []string,
) (metaInsightsResponse, error) {
	return fetchMetaInsightsWithPeriod(ctx, endpoint, accessToken, metrics, "")
}

func fetchMetaInsightsWithPeriod(
	ctx context.Context,
	endpoint string,
	accessToken string,
	metrics []string,
	period string,
) (metaInsightsResponse, error) {
	response, err := requestMetaInsights(ctx, endpoint, accessToken, metrics, period)
	if err == nil || len(metrics) < 2 || !isBadRequest(err) {
		return response, err
	}

	// Meta insight availability varies by content type. Retry the batch one
	// metric at a time so one unsupported counter does not hide valid ones.
	combined := metaInsightsResponse{}
	for _, metric := range metrics {
		item, itemErr := requestMetaInsights(ctx, endpoint, accessToken, []string{metric}, period)
		if itemErr != nil {
			if isBadRequest(itemErr) {
				continue
			}
			return metaInsightsResponse{}, itemErr
		}
		combined.Data = append(combined.Data, item.Data...)
	}
	return combined, nil
}

func requestMetaInsights(
	ctx context.Context,
	endpoint string,
	accessToken string,
	metrics []string,
	period string,
) (metaInsightsResponse, error) {
	query := url.Values{
		"metric":              {strings.Join(metrics, ",")},
		oauthParamAccessToken: {accessToken},
	}
	if period != "" {
		query.Set("period", period)
	}
	body, err := DoRequest(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil, nil)
	if err != nil {
		return metaInsightsResponse{}, err
	}
	var response metaInsightsResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return metaInsightsResponse{}, fmt.Errorf("decoding insights: %w", err)
	}
	return response, nil
}

func isBadRequest(err error) bool {
	var providerErr *HTTPError
	return errors.As(err, &providerErr) && providerErr.StatusCode == http.StatusBadRequest
}

func addMetaInsights(target AnalyticsValues, response metaInsightsResponse) {
	for _, item := range response.Data {
		raw := item.TotalValue.Value
		if len(raw) == 0 && len(item.Values) > 0 {
			raw = item.Values[len(item.Values)-1].Value
		}
		value, ok := analyticsInt(raw)
		if !ok {
			continue
		}
		switch item.Name {
		case "followers_count":
			target[MetricFollowers] += value
		case "views", "plays", "fb_reels_total_plays":
			target[MetricViews] += value
		case "impressions", "post_media_view", "page_story_impressions_by_story_id":
			target[MetricImpressions] += value
		case "reach", "post_total_media_view_unique", "page_story_impressions_by_story_id_unique":
			target[MetricReach] += value
		case "likes", "post_reactions_like_total":
			target[MetricLikes] += value
		case "comments", "replies", "pages_fb_story_replies":
			target[MetricComments] += value
		case "reposts":
			target[MetricReposts] += value
		case "quotes":
			target[MetricQuotes] += value
		case "shares", "pages_fb_story_shares":
			target[MetricShares] += value
		case "saved":
			target[MetricSaves] += value
		case "post_clicks":
			target[MetricClicks] += value
		case "pages_fb_story_thread_lightweight_reactions", "post_video_likes_by_reaction_type":
			target[MetricReactions] += value
		case "story_interaction", "post_video_social_actions":
			target[MetricEngagements] += value
		}
	}
}

func analyticsInt(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	var integer int64
	if json.Unmarshal(raw, &integer) == nil {
		return integer, true
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		value, err := strconv.ParseInt(text, 10, 64)
		return value, err == nil
	}
	var composite any
	if json.Unmarshal(raw, &composite) == nil {
		return analyticsCompositeTotal(composite)
	}
	return 0, false
}

func analyticsCompositeTotal(value any) (int64, bool) {
	switch item := value.(type) {
	case float64:
		return int64(item), true
	case string:
		parsed, err := strconv.ParseInt(item, 10, 64)
		return parsed, err == nil
	case []any:
		var total int64
		measured := false
		for _, child := range item {
			value, ok := analyticsCompositeTotal(child)
			if ok {
				total += value
				measured = true
			}
		}
		return total, measured
	case map[string]any:
		var total int64
		measured := false
		for _, child := range item {
			value, ok := analyticsCompositeTotal(child)
			if ok {
				total += value
				measured = true
			}
		}
		return total, measured
	default:
		return 0, false
	}
}

func uniqueNonEmpty(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func subtractOwnReplies(values AnalyticsValues, count int) {
	if count <= 0 {
		return
	}
	comments, measured := values[MetricComments]
	if !measured {
		return
	}
	values[MetricComments] = max(0, comments-int64(count))
}

func addOptionalMetric(values AnalyticsValues, metric string, value *int64) {
	if value != nil {
		values[metric] += *value
	}
}
