package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const (
	tiktokVideoListURL              = "https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,title,video_description,share_url,like_count,comment_count,share_count,view_count"
	tiktokDiscoveryPageSize         = 20
	tiktokDiscoveryMetricSource     = "tiktok_display_api"
	tiktokDiscoveryRequiredScope    = "video.list"
	tiktokDiscoveryCoverageComplete = "TikTok videos in the requested history window are complete. Metrics are limited to lifetime views, likes, comments, and shares returned by TikTok."
	tiktokDiscoveryCoveragePartial  = "More TikTok videos remain in the requested history window. Metrics are limited to lifetime views, likes, comments, and shares returned by TikTok."
)

var tiktokVideoIDPattern = regexp.MustCompile(`^[0-9]{1,32}$`)

type tiktokDiscoveryCursor struct {
	Cursor int64 `json:"cursor"`
}

type tiktokDiscoveryVideo struct {
	ID               string `json:"id"`
	CreateTime       int64  `json:"create_time"`
	Title            string `json:"title"`
	VideoDescription string `json:"video_description"`
	ShareURL         string `json:"share_url"`
	LikeCount        *int64 `json:"like_count"`
	CommentCount     *int64 `json:"comment_count"`
	ShareCount       *int64 `json:"share_count"`
	ViewCount        *int64 `json:"view_count"`
}

func (t *TikTokAdapter) AccountContentDiscoverySupport(AnalyticsAccountContext) AccountContentDiscoverySupport {
	return AccountContentDiscoverySupport{
		Supported:      true,
		RequiredScopes: []string{tiktokDiscoveryRequiredScope},
		MaxPageSize:    tiktokDiscoveryPageSize,
	}
}

func (t *TikTokAdapter) AccountContentDiscoveryReadRequests(AccountContentDiscoveryRequest) int {
	// video.list returns the bounded video fields and basic lifetime counters in
	// one batch. Do not fan out through video/query for each discovered item.
	return 1
}

func (t *TikTokAdapter) DiscoverAccountContent(ctx context.Context, accessToken string, input AccountContentDiscoveryRequest) (AccountContentPage, error) {
	cursor, err := decodeTikTokDiscoveryCursor(input.Cursor)
	if err != nil {
		return AccountContentPage{}, err
	}
	pageSize := min(max(1, input.PageSize), tiktokDiscoveryPageSize)
	payload := map[string]any{"max_count": pageSize}
	if cursor.Cursor > 0 {
		payload["cursor"] = cursor.Cursor
	}
	body, err := DoJSON(ctx, http.MethodPost, tiktokVideoListURL, payload, map[string]string{
		headerAuthorization: bearerPrefix + accessToken,
	})
	if err != nil {
		return AccountContentPage{}, fmt.Errorf("tiktok video list: %w", err)
	}
	var response struct {
		Data struct {
			Videos  []tiktokDiscoveryVideo `json:"videos"`
			Cursor  int64                  `json:"cursor"`
			HasMore bool                   `json:"has_more"`
		} `json:"data"`
		Error tiktokAPIError `json:"error"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return AccountContentPage{}, fmt.Errorf("decoding tiktok video list: %w", err)
	}
	if response.Error.Code != "" && response.Error.Code != "ok" {
		return AccountContentPage{}, tiktokAccountContentDiscoveryError(response.Error.Code)
	}
	return tiktokAccountContentPage(response.Data.Videos, cursor.Cursor, response.Data.Cursor, response.Data.HasMore, input.PublishedAfter, pageSize)
}

func tiktokAccountContentPage(videos []tiktokDiscoveryVideo, requestCursor, responseCursor int64, hasMore bool, publishedAfter time.Time, pageSize int) (AccountContentPage, error) {
	page := AccountContentPage{Coverage: AccountContentCoverage{
		Status:      AccountContentDiscoveryComplete,
		Description: tiktokDiscoveryCoverageComplete,
	}}
	seen := make(map[string]struct{}, min(len(videos), pageSize))
	reachedLowerBound := false
	for _, video := range videos {
		if len(page.Items) >= pageSize {
			break
		}
		videoID := strings.TrimSpace(video.ID)
		if !tiktokVideoIDPattern.MatchString(videoID) || video.CreateTime <= 0 {
			continue
		}
		publishedAt := time.Unix(video.CreateTime, 0).UTC()
		if !publishedAfter.IsZero() && publishedAt.Before(publishedAfter) {
			reachedLowerBound = true
			continue
		}
		if _, duplicate := seen[videoID]; duplicate {
			continue
		}
		seen[videoID] = struct{}{}
		item, err := normalizeTikTokAccountContentItem(video, videoID, publishedAt)
		if err != nil {
			continue
		}
		page.Items = append(page.Items, item)
		if page.BackfillWatermark.IsZero() || publishedAt.Before(page.BackfillWatermark) {
			page.BackfillWatermark = publishedAt
		}
	}
	if tiktokDiscoveryPageComplete(reachedLowerBound, hasMore, requestCursor, responseCursor) {
		return page, nil
	}
	nextCursor, err := encodeTikTokDiscoveryCursor(tiktokDiscoveryCursor{Cursor: responseCursor})
	if err != nil {
		return AccountContentPage{}, err
	}
	page.NextCursor = nextCursor
	page.Coverage.Status = AccountContentDiscoveryPartial
	page.Coverage.Description = tiktokDiscoveryCoveragePartial
	return page, nil
}

func tiktokDiscoveryPageComplete(reachedLowerBound, hasMore bool, requestCursor, responseCursor int64) bool {
	return reachedLowerBound || !hasMore || responseCursor <= 0 || responseCursor == requestCursor
}

func normalizeTikTokAccountContentItem(video tiktokDiscoveryVideo, videoID string, publishedAt time.Time) (AccountContentItem, error) {
	externalURL := strings.TrimSpace(video.ShareURL)
	if externalURL != "" && !IsSafeProviderContentURL(providerTikTok, externalURL) {
		externalURL = ""
	}
	return NormalizeAccountContentItem(providerTikTok, AccountContentItem{
		ProviderContentID: videoID,
		ContentProfile:    "short_video",
		Title:             video.Title,
		Text:              video.VideoDescription,
		ExternalURL:       externalURL,
		PublishedAt:       publishedAt,
		Origin:            AccountContentOriginExternal,
		OriginConfidence:  AccountContentOriginConfidenceExact,
		Measurements:      tiktokDiscoveryMeasurements(video),
	})
}

func tiktokDiscoveryMeasurements(video tiktokDiscoveryVideo) AnalyticsMeasurements {
	measurements := AnalyticsMeasurements{}
	addTikTokDiscoveryMeasurement(measurements, MetricViews, video.ViewCount)
	addTikTokDiscoveryMeasurement(measurements, MetricLikes, video.LikeCount)
	addTikTokDiscoveryMeasurement(measurements, MetricComments, video.CommentCount)
	addTikTokDiscoveryMeasurement(measurements, MetricShares, video.ShareCount)
	return measurements
}

func addTikTokDiscoveryMeasurement(measurements AnalyticsMeasurements, metric string, value *int64) {
	if value == nil || *value < 0 {
		return
	}
	measurements[metric] = AnalyticsMeasurement{
		Value: *value,
		AnalyticsMetricMetadata: AnalyticsMetricMetadata{
			Unit:        AnalyticsMetricUnitCount,
			Aggregation: AnalyticsMetricAggregationLifetimeTotal,
			Source:      tiktokDiscoveryMetricSource,
		},
	}
}

func encodeTikTokDiscoveryCursor(cursor tiktokDiscoveryCursor) (string, error) {
	if cursor.Cursor <= 0 {
		return "", NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return "", fmt.Errorf("encoding tiktok discovery cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func decodeTikTokDiscoveryCursor(raw string) (tiktokDiscoveryCursor, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return tiktokDiscoveryCursor{}, nil
	}
	if len(raw) > 256 {
		return tiktokDiscoveryCursor{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return tiktokDiscoveryCursor{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	var cursor tiktokDiscoveryCursor
	if json.Unmarshal(decoded, &cursor) != nil || cursor.Cursor <= 0 {
		return tiktokDiscoveryCursor{}, NewAccountContentDiscoveryError(AccountContentDiscoveryFailed, "invalid_cursor", 0)
	}
	return cursor, nil
}

func tiktokAccountContentDiscoveryError(code string) error {
	normalized := strings.ToLower(strings.TrimSpace(code))
	status := AccountContentDiscoveryFailed
	switch {
	case strings.Contains(normalized, "scope"),
		strings.Contains(normalized, "access_token"),
		strings.Contains(normalized, "permission"),
		strings.Contains(normalized, "unauthorized"):
		status = AccountContentDiscoveryPermissionRequired
	case strings.Contains(normalized, "rate"),
		strings.Contains(normalized, "too_many"):
		status = AccountContentDiscoveryRateLimited
	}
	return NewAccountContentDiscoveryError(status, code, 0)
}
