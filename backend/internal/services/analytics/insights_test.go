package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestContentInsightsRejectMixedProviderReportingPeriods(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	firstStart, firstEnd := now.Add(-7*24*time.Hour), now
	secondStart, secondEnd := now.Add(-30*24*time.Hour), now
	firstMetadata := map[string]platform.AnalyticsMetricMetadata{
		platform.MetricLikes: reportingEngagementMetadata("provider-a", firstStart, firstEnd),
	}
	secondMetadata := map[string]platform.AnalyticsMetricMetadata{
		platform.MetricLikes: reportingEngagementMetadata("provider-b", secondStart, secondEnd),
	}
	content := []ContentOverview{
		insightTestContent("first", "external", "account-a", "provider-a", now.Add(-time.Hour), 20, firstMetadata),
		insightTestContent("second", "external", "account-b", "provider-b", now.Add(-2*time.Hour), 10, secondMetadata),
	}

	for _, insight := range buildContentInsights(content, now.Add(-30*24*time.Hour), now) {
		require.Equal(t, InsightStatusInsufficientData, insight.Status)
		require.Equal(t, InsightReasonIncompatibleSemantics, insight.Reason)
		require.Equal(t, 2, insight.MeasuredCount)
		require.Nil(t, insight.Value)
		require.Nil(t, insight.Content)
	}
}

func insightTestContent(id, source, accountID, provider string, publishedAt time.Time, engagement int64, metadata map[string]platform.AnalyticsMetricMetadata) ContentOverview {
	reference := ContentReference{Type: source}
	if source == "external" {
		reference.AccountContentID = id
	} else {
		reference.PublicationID = "publication-" + id
		reference.RenditionID = id
	}
	metrics := platform.AnalyticsValues{}
	if metadata != nil {
		metrics[platform.MetricLikes] = engagement
	}
	return ContentOverview{
		Reference: reference, Source: source, Title: id, Excerpt: id, Platform: provider,
		AccountID: accountID, Username: accountID, PublishedAt: publishedAt, CollectedAt: publishedAt.Add(time.Hour),
		Metrics: metrics, MetricMetadata: metadata,
	}
}

func reportingEngagementMetadata(source string, start, end time.Time) platform.AnalyticsMetricMetadata {
	return platform.AnalyticsMetricMetadata{
		Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationReportingPeriodTotal,
		Source: source, PeriodStart: &start, PeriodEnd: &end,
	}
}
