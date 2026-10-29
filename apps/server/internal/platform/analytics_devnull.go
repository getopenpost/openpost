package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/google/uuid"
)

// The unsigned public API exposes profile counts and approved commit stars and
// replies. It does not expose views, reach, or private/pending activity.
func (d *DevNullAdapter) AnalyticsSupport() AnalyticsSupport {
	return AnalyticsSupport{Account: true, Content: true}
}

func (d *DevNullAdapter) FetchAccountAnalytics(ctx context.Context, accessToken string, _ AccountAnalyticsRequest) (AnalyticsValues, error) {
	username, _, err := splitDevNullCredential(accessToken)
	if err != nil {
		return nil, err
	}
	if err := validateDevNullUsername(username); err != nil {
		return nil, err
	}
	body, err := DoRequest(ctx, http.MethodGet, d.BaseURL()+"/api/v1/users/"+url.PathEscape(username), nil, nil)
	if err != nil {
		return nil, devNullAnalyticsReadError(err)
	}
	var response struct {
		Data struct {
			ID        string `json:"id"`
			Followers *int64 `json:"followers_count"`
			Following *int64 `json:"following_count"`
			Commits   *int64 `json:"commits_count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decoding dev/null account analytics: %w", err)
	}
	if response.Data.ID == "" {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "devnull_profile_not_found")
	}
	values := AnalyticsValues{}
	addOptionalMetric(values, MetricFollowers, response.Data.Followers)
	addOptionalMetric(values, MetricFollowing, response.Data.Following)
	addOptionalMetric(values, MetricPosts, response.Data.Commits)
	return values, nil
}

func (d *DevNullAdapter) FetchContentAnalytics(ctx context.Context, _ string, input ContentAnalyticsRequest) (AnalyticsValues, error) {
	ids := make([]string, 0, len(input.ExternalIDs))
	for _, reference := range input.ExternalIDs {
		if id := d.analyticsCommitID(reference); id != "" {
			ids = append(ids, id)
		}
	}
	ids = uniqueNonEmpty(ids)
	if len(ids) == 0 {
		return nil, NewAnalyticsError(AnalyticsStatusNotFound, "devnull_commit_reference_missing")
	}
	values := AnalyticsValues{}
	starsComplete, repliesComplete := true, true
	for _, id := range ids {
		body, err := DoRequest(ctx, http.MethodGet, d.BaseURL()+"/api/v1/commits/"+url.PathEscape(id), nil, nil)
		if err != nil {
			return nil, devNullAnalyticsReadError(err)
		}
		var response struct {
			Data struct {
				ID      string `json:"id"`
				Stars   *int64 `json:"stars_count"`
				Replies *int64 `json:"replies_count"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &response); err != nil {
			return nil, fmt.Errorf("decoding dev/null content analytics: %w", err)
		}
		if response.Data.ID != id {
			return nil, NewAnalyticsError(AnalyticsStatusNotFound, "devnull_commit_not_found")
		}
		starsComplete = starsComplete && response.Data.Stars != nil
		repliesComplete = repliesComplete && response.Data.Replies != nil
		addOptionalMetric(values, MetricLikes, response.Data.Stars)
		addOptionalMetric(values, MetricComments, response.Data.Replies)
	}
	// A thread metric is measured only when every commit supplied its counter.
	if !starsComplete {
		delete(values, MetricLikes)
	}
	if !repliesComplete {
		delete(values, MetricComments)
	}
	subtractOwnReplies(values, input.OwnReplyCount)
	return values, nil
}

func (d *DevNullAdapter) analyticsCommitID(reference string) string {
	reference = strings.TrimSpace(reference)
	if parsed, err := uuid.Parse(reference); err == nil {
		return parsed.String()
	}
	target, err := url.Parse(reference)
	base, baseErr := url.Parse(d.BaseURL())
	if err != nil || baseErr != nil || target.Scheme != base.Scheme || target.Host != base.Host || path.Base(path.Dir(target.Path)) != "commits" {
		return ""
	}
	id, err := uuid.Parse(path.Base(target.Path))
	if err != nil {
		return ""
	}
	return id.String()
}

func devNullAnalyticsReadError(err error) error {
	if upstream, ok := asDevNullHTTPError(err); ok && upstream.StatusCode == http.StatusNotFound {
		return NewAnalyticsError(AnalyticsStatusNotFound, "devnull_public_resource_not_found")
	}
	return fmt.Errorf("dev/null analytics: %w", normalizeDevNullError(err))
}

var _ AnalyticsAdapter = (*DevNullAdapter)(nil)
