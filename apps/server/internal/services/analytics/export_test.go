package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestExportDailyFilteringDoesNotInventMeasurements(t *testing.T) {
	t.Parallel()
	trends := TrendSeries{
		Engagement: []DailyBreakdownPoint{{Date: "2026-10-01", Value: 3, Items: []DailyBreakdownItem{{Platform: "bluesky", Value: 3}}}},
		Views:      []DailyBreakdownPoint{{Date: "2026-10-01", Value: 12, Items: []DailyBreakdownItem{{Platform: "youtube", Value: 12}}}},
	}
	table := exportDailyTable(trends, exportScope{platforms: map[string]bool{"bluesky": true}})
	require.Equal(t, [][]any{{"2026-10-01", nil, int64(3), nil, nil}}, table.Rows)
}

func TestExportGroupedTableDoesNotSumAverages(t *testing.T) {
	t.Parallel()
	metadata := map[string]platform.AnalyticsMetricMetadata{"average_view_percentage": {Unit: platform.AnalyticsMetricUnitBasisPoints, Aggregation: platform.AnalyticsMetricAggregationReportingPeriodAverage}}
	content := []ContentOverview{
		{Platform: "youtube", Metrics: platform.AnalyticsValues{"average_view_percentage": 8000}, MetricMetadata: metadata},
		{Platform: "youtube", Metrics: platform.AnalyticsValues{"average_view_percentage": 8000}, MetricMetadata: metadata},
	}
	table := exportGroupedTable(content, []string{"average_view_percentage"}, ExportGroupPlatform, time.UTC)
	require.Equal(t, [][]any{{"youtube", 2, nil, nil, nil}}, table.Rows, "an average cannot be summed or averaged without its weights")
	posts := exportPostsTable(content, []string{"average_view_percentage"}, time.UTC)
	require.Equal(t, int64(8000), posts.Rows[0][7], "per-post source values remain available")
}

func TestExportEngagementRequiresCompatibleProjection(t *testing.T) {
	t.Parallel()
	content := []ContentOverview{
		{Platform: "facebook", MetricAvailability: "available", Metrics: platform.AnalyticsValues{"views": 10, "reactions": 3, "engagements": 999}, MetricMetadata: map[string]platform.AnalyticsMetricMetadata{"views": {Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal}, "reactions": {Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal}}},
		{Platform: "facebook", MetricAvailability: "available", Metrics: platform.AnalyticsValues{"likes": 0}, MetricMetadata: map[string]platform.AnalyticsMetricMetadata{"likes": {Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal}}},
	}
	posts := exportPostsTable(content, nil, time.UTC)
	require.Nil(t, posts.Rows[0][6], "an unsupported aggregate engagement projection is not a measured zero")
	require.Equal(t, int64(0), posts.Rows[1][6], "compatible measured zero remains zero")
	grouped := exportGroupedTable(content, nil, ExportGroupPlatform, time.UTC)
	require.Equal(t, int64(0), grouped.Rows[0][2], "only compatible lifetime engagement contributes")
}
