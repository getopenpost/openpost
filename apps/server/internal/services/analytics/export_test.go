package analytics

import (
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestBuildExportDailyPreservesMeasuredZeroChanges(t *testing.T) {
	for _, backend := range []string{"sqlite", "postgres"} {
		t.Run(backend, func(t *testing.T) {
			db := analyticsSnapshotTestDB(t, backend,
				(*models.Publication)(nil), (*models.Rendition)(nil), (*models.SocialAccount)(nil),
				(*models.AnalyticsSyncState)(nil), (*models.AnalyticsAccountSnapshot)(nil))
			now := time.Date(2026, 10, 14, 13, 0, 0, 0, time.UTC)
			for _, row := range []any{
				&models.SocialAccount{ID: "account", WorkspaceID: "workspace", Platform: "test", AccountUsername: "person", IsActive: true, AccessTokenEnc: []byte("fixture-token")},
				&models.Publication{ID: "post", WorkspaceID: "workspace", CreatedByID: "user", Status: models.PublicationStatusPublished, ActualRunAt: now.AddDate(0, 0, -30)},
				&models.Rendition{ID: "rendition", PublicationID: "post", SocialAccountID: "account", Platform: "test", Status: models.RenditionStatusPublished},
			} {
				_, err := db.NewInsert().Model(row).Exec(t.Context())
				require.NoError(t, err)
			}
			const compatible = `{"likes":{"unit":"count","aggregation":"lifetime_total"},"views":{"unit":"count","aggregation":"lifetime_total"}}`
			for i, snapshot := range []struct{ values, metadata string }{
				{`{"likes":3,"views":10}`, compatible},
				{`{"likes":3,"views":10}`, compatible},
				{`{"views":10}`, compatible},
				{`{"likes":0,"views":20}`, `{"likes":{"unit":"count","aggregation":"lifetime_total"},"views":{"unit":"milliseconds","aggregation":"lifetime_total"}}`},
				{`{"likes":0,"views":20}`, compatible},
			} {
				at := time.Date(2026, 10, 10+i, 12, 0, 0, 0, time.UTC)
				_, err := db.NewInsert().Model(&models.AnalyticsRenditionSnapshot{
					ID: fmt.Sprintf("content-%d", i), WorkspaceID: "workspace", PublicationID: "post", RenditionID: "rendition", SocialAccountID: "account", Platform: "test",
					CapturedAt: at, MetricsJSON: snapshot.values, MetricMetadataJSON: snapshot.metadata,
				}).Exec(t.Context())
				require.NoError(t, err)
				if i == 0 || i == 1 || i == 3 {
					_, err = db.NewInsert().Model(&models.AnalyticsAccountSnapshot{
						ID: fmt.Sprintf("account-%d", i), WorkspaceID: "workspace", SocialAccountID: "account", Platform: "test", CapturedAt: at,
						MetricsJSON: `{"followers":100}`, MetricMetadataJSON: `{"followers":{"unit":"count","aggregation":"current_snapshot"}}`,
					}).Exec(t.Context())
					require.NoError(t, err)
				}
			}
			service := NewService(db, nil)
			service.now = func() time.Time { return now }
			export, err := service.BuildExport(t.Context(), "workspace", ExportOptions{Days: 7})
			require.NoError(t, err)
			require.Equal(t, []string{"Date", "Follower change", "Engagement", "Views", "Visibility"}, export.Daily.Columns)
			require.Equal(t, [][]any{
				{"2026-10-11", int64(0), int64(0), int64(0), int64(0)},
				{"2026-10-12", nil, nil, int64(0), int64(0)},
				{"2026-10-13", int64(0), nil, nil, nil},
				{"2026-10-14", nil, int64(0), nil, nil},
			}, export.Daily.Rows, "unchanged measured counts are zero; absent or incomparable measurements stay blank")
		})
	}
}

func TestExportGroupKeyFollowsTimezone(t *testing.T) {
	rome, err := time.LoadLocation("Europe/Rome")
	require.NoError(t, err)
	// 23:30 UTC on Sunday 4 Oct is already Monday 5 Oct in Rome.
	item := ContentOverview{PublishedAt: time.Date(2026, time.October, 4, 23, 30, 0, 0, time.UTC)}

	day, _ := exportGroupKey(item, ExportGroupDay, time.UTC)
	require.Equal(t, "2026-10-04", day)
	day, _ = exportGroupKey(item, ExportGroupDay, rome)
	require.Equal(t, "2026-10-05", day)

	week, _ := exportGroupKey(item, ExportGroupWeek, time.UTC)
	require.Equal(t, "2026-09-28", week, "weeks start on Monday")
	week, _ = exportGroupKey(item, ExportGroupWeek, rome)
	require.Equal(t, "2026-10-05", week)

	month, _ := exportGroupKey(item, ExportGroupMonth, rome)
	require.Equal(t, "2026-10", month)
}

func TestExportGroupedTableKeepsUnmeasuredMetricsEmpty(t *testing.T) {
	published := time.Date(2026, time.October, 1, 10, 0, 0, 0, time.UTC)
	content := []ContentOverview{
		{Platform: "x", PublishedAt: published, MetricAvailability: "available", Engagement: 10, Metrics: platform.AnalyticsValues{"views": 100, "impressions": 200, "likes": 0, "comments": 10}},
		{Platform: "x", PublishedAt: published, MetricAvailability: "available", Engagement: 5, Metrics: platform.AnalyticsValues{"views": 50, "impressions": 75, "likes": 0, "comments": 5}},
		{Platform: "bluesky", PublishedAt: published, MetricAvailability: "pending"},
		{Platform: "threads", PublishedAt: published, MetricAvailability: "available", Metrics: platform.AnalyticsValues{"views": 7}},
		{Platform: "youtube", PublishedAt: published, MetricAvailability: "available", Metrics: platform.AnalyticsValues{"views": 11, "impressions": 999}},
		{Platform: "youtube", PublishedAt: published, MetricAvailability: "available", Metrics: platform.AnalyticsValues{"views": 0}},
	}

	for i := range content {
		content[i].MetricMetadata = legacyMetricMetadata(content[i].Metrics, platform.AnalyticsMetricSubjectContent, content[i].Platform)
	}
	projectContentVisibility(content)
	require.Contains(t, measuredContentMetrics(content), "visibility")
	require.NotContains(t, measuredContentMetrics([]ContentOverview{{Metrics: platform.AnalyticsValues{"visibility": 999}}}), "visibility", "the projected key requires a compatible visibility measurement")

	table := exportGroupedTable(content, []string{"views", "likes", "visibility"}, ExportGroupPlatform, time.UTC)

	require.Equal(t, []string{"Platform", "Posts", "Engagement", "Views", "Likes", "Visibility"}, table.Columns)
	require.Equal(t, [][]any{
		{"x", 2, int64(15), int64(150), int64(0), int64(275)},
		{"bluesky", 1, nil, nil, nil, nil},
		{"threads", 1, nil, int64(7), nil, int64(7)},
		{"youtube", 2, nil, int64(11), nil, int64(11)},
	}, table.Rows, "a measured zero stays 0 and an unmeasured value stays empty")
	posts := exportPostsTable(content, []string{"visibility"}, time.UTC)
	require.Equal(t, []any{int64(200), int64(75), nil, int64(7), int64(11), int64(0)}, []any{posts.Rows[0][7], posts.Rows[1][7], posts.Rows[2][7], posts.Rows[3][7], posts.Rows[4][7], posts.Rows[5][7]})
	totals := exportGroupedTable(content, []string{"visibility"}, ExportGroupDay, time.UTC)
	require.Equal(t, int64(293), totals.Rows[0][3], "mixed providers contribute exactly one projected counter per output")
}

func TestNormalizeExportGroupBy(t *testing.T) {
	value, err := NormalizeExportGroupBy("")
	require.NoError(t, err)
	require.Equal(t, ExportGroupPost, value)
	_, err = NormalizeExportGroupBy("hour")
	require.ErrorIs(t, err, ErrInvalidExportOptions)
}

func TestUnpagedOverviewRejectsCursor(t *testing.T) {
	_, err := (&Service{}).OverviewWithOptions(t.Context(), "ws-1", 30, OverviewOptions{Unpaged: true, Cursor: "stale"})
	require.ErrorIs(t, err, ErrInvalidOverviewCursor)
}

func TestExportDailyFilteringDoesNotInventMeasurements(t *testing.T) {
	trends := TrendSeries{
		Engagement: []DailyBreakdownPoint{{Date: "2026-10-01", Value: 3, Items: []DailyBreakdownItem{{Platform: "bluesky", Value: 3}}}},
		Views:      []DailyBreakdownPoint{{Date: "2026-10-01", Value: 12, Items: []DailyBreakdownItem{{Platform: "youtube", Value: 12}}}},
	}
	table := exportDailyTable(trends, exportScope{platforms: map[string]bool{"bluesky": true}})
	require.Equal(t, [][]any{{"2026-10-01", nil, int64(3), nil, nil}}, table.Rows)
}

func TestExportGroupedTableDoesNotSumAverages(t *testing.T) {
	metadata := map[string]platform.AnalyticsMetricMetadata{"average_view_percentage": {Unit: platform.AnalyticsMetricUnitBasisPoints, Aggregation: platform.AnalyticsMetricAggregationReportingPeriodAverage}}
	content := []ContentOverview{
		{Platform: "youtube", Metrics: platform.AnalyticsValues{"average_view_percentage": 8000}, MetricMetadata: metadata},
		{Platform: "youtube", Metrics: platform.AnalyticsValues{"average_view_percentage": 8000}, MetricMetadata: metadata},
	}
	table := exportGroupedTable(content, []string{"average_view_percentage"}, ExportGroupPlatform, time.UTC)
	require.Equal(t, [][]any{{"youtube", 2, nil, nil}}, table.Rows, "an average cannot be summed or averaged without its weights")
	posts := exportPostsTable(content, []string{"average_view_percentage"}, time.UTC)
	require.Equal(t, int64(8000), posts.Rows[0][7], "per-post source values remain available")
}

func TestExportEngagementRequiresCompatibleProjection(t *testing.T) {
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
