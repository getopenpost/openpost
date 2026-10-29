package analytics

import (
	"sort"

	"github.com/openpost/backend/internal/platform"
)

func projectedVisibility(item ContentOverview) *ContentVisibility {
	metrics := []string{platform.MetricImpressions, platform.MetricViews}
	if item.Platform == "youtube" {
		metrics = []string{platform.MetricViews}
	}
	for _, metric := range metrics {
		if value, ok := compatibleCountMetricValue(item.Metrics, item.MetricMetadata, metric, platform.AnalyticsMetricAggregationLifetimeTotal); ok {
			basis := "content_views"
			if metric == platform.MetricImpressions {
				basis = "post_displays"
			} else if item.Platform == "youtube" {
				basis = "video_views"
			}
			return &ContentVisibility{Value: value, Metric: metric, Basis: basis}
		}
	}
	return nil
}

func addVisibility(summary *MetricSummary, visibility *ContentVisibility) {
	if visibility != nil {
		summary.Value += visibility.Value
		summary.Measured++
	}
}

func buildVisibilityBreakdown(content []ContentOverview) []VisibilityBreakdown {
	groups := map[string]*VisibilityBreakdown{}
	for _, item := range content {
		if item.Visibility == nil {
			continue
		}
		v := item.Visibility
		key := item.Platform + ":" + v.Metric + ":" + v.Basis
		if groups[key] == nil {
			groups[key] = &VisibilityBreakdown{Platform: item.Platform, Metric: v.Metric, Basis: v.Basis}
		}
		groups[key].Value += v.Value
		groups[key].Measured++
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]VisibilityBreakdown, 0, len(keys))
	for _, key := range keys {
		result = append(result, *groups[key])
	}
	return result
}

func buildAccountPerformance(content []ContentOverview, accounts []AccountOverview, accountID string) []AccountPerformance {
	byID := map[string]*AccountPerformance{}
	publications := map[string]map[string]bool{}
	for _, account := range accounts {
		if accountID != "" && account.ID != accountID {
			continue
		}
		row := &AccountPerformance{AccountID: account.ID, Platform: account.Platform, Username: account.Username, AvatarURL: account.AvatarURL, Status: account.Status, FollowerDelta: account.FollowerDelta}
		if value, ok := compatibleCountMetricValue(account.Metrics, account.MetricMetadata, platform.MetricFollowers, platform.AnalyticsMetricAggregationCurrentSnapshot); ok {
			row.Followers = &value
		}
		byID[account.ID] = row
	}
	for _, item := range content {
		row := byID[item.AccountID]
		if row == nil {
			row = &AccountPerformance{AccountID: item.AccountID, Platform: item.Platform, Username: item.Username, Status: "inactive"}
			byID[item.AccountID] = row
		}
		row.Published++
		if publications[item.AccountID] == nil {
			publications[item.AccountID] = map[string]bool{}
		}
		publications[item.AccountID][item.PublicationID] = true
		addVisibility(&row.Visibility, item.Visibility)
		values := compatibleContentValues(item.Metrics, item.MetricMetadata)
		if platform.HasEngagementMetric(values) {
			row.Engagement.Value += platform.EngagementTotal(values)
			row.Engagement.Measured++
		}
	}
	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	result := make([]AccountPerformance, 0, len(ids))
	for _, id := range ids {
		row := byID[id]
		row.PublicationCount = len(publications[id])
		result = append(result, *row)
	}
	sort.SliceStable(result, func(i, j int) bool { return accountPerformanceBefore(result[i], result[j]) })
	return result
}

func accountPerformanceBefore(left, right AccountPerformance) bool {
	if (left.Visibility.Measured > 0) != (right.Visibility.Measured > 0) {
		return left.Visibility.Measured > 0
	}
	if left.Visibility.Value != right.Visibility.Value {
		return left.Visibility.Value > right.Visibility.Value
	}
	if (left.Engagement.Measured > 0) != (right.Engagement.Measured > 0) {
		return left.Engagement.Measured > 0
	}
	if left.Engagement.Value != right.Engagement.Value {
		return left.Engagement.Value > right.Engagement.Value
	}
	if left.Platform != right.Platform {
		return left.Platform < right.Platform
	}
	if left.Username != right.Username {
		return left.Username < right.Username
	}
	return left.AccountID < right.AccountID
}

func contentMetricKnown(item ContentOverview, order string) bool {
	switch order {
	case "visibility":
		return item.Visibility != nil
	case "views":
		_, ok := compatibleCountMetricValue(item.Metrics, item.MetricMetadata, platform.MetricViews, platform.AnalyticsMetricAggregationLifetimeTotal)
		return ok
	case "newest":
		return true
	default:
		return platform.HasEngagementMetric(compatibleContentValues(item.Metrics, item.MetricMetadata))
	}
}

func buildHighlights(content []ContentOverview, order string) []ContentOverview {
	result := []ContentOverview{}
	seen := map[string]bool{}
	for _, item := range content {
		if !contentMetricKnown(item, order) || seen[item.PublicationID] {
			continue
		}
		seen[item.PublicationID] = true
		result = append(result, item)
		if len(result) == 5 {
			break
		}
	}
	return result
}

func projectContentVisibility(content []ContentOverview) {
	for i := range content {
		content[i].Visibility = projectedVisibility(content[i])
	}
}

func applyPublicationVisibility(publications []PublicationOverview, population []ContentOverview) {
	byID := map[string]MetricSummary{}
	for _, item := range population {
		summary := byID[item.PublicationID]
		addVisibility(&summary, item.Visibility)
		byID[item.PublicationID] = summary
	}
	for i := range publications {
		publications[i].Visibility = byID[publications[i].PublicationID]
	}
}
