package analytics

import (
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
)

func TestContentInsightsRankStoredCompatibleMeasurementsWithStableEvidence(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	metadata := map[string]platform.AnalyticsMetricMetadata{
		platform.MetricLikes: {
			Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
			Source: "provider-native",
		},
	}
	content := []ContentOverview{
		insightTestContent("external-low", "external", "account-youtube", "youtube", now.Add(-2*time.Hour), 2, metadata),
		insightTestContent("managed-high", "openpost", "account-mastodon", "mastodon", now.Add(-time.Hour), 8, metadata),
		insightTestContent("external-high-older", "external", "account-youtube", "youtube", now.Add(-3*time.Hour), 8, metadata),
	}

	insights := buildContentInsights(content, now.Add(-30*24*time.Hour), now)
	require.Len(t, insights, 3)

	most := insights[0]
	require.Equal(t, InsightStatusAvailable, most.Status)
	require.Equal(t, int64(8), *most.Value)
	require.Equal(t, "managed-high", most.Content.Reference.RenditionID, "newer content wins a stable value tie")
	require.Equal(t, "openpost", most.Content.Source)
	require.Equal(t, "mastodon", most.Content.Platform)
	require.Equal(t, 3, most.MeasuredCount)
	require.Equal(t, 3, most.ComparisonSample)
	require.Equal(t, InsightCaveatFilteredLifetimeTotals, most.Caveat)

	least := insights[1]
	require.Equal(t, InsightStatusAvailable, least.Status)
	require.Equal(t, int64(2), *least.Value)
	require.Equal(t, "external-low", least.Content.Reference.AccountContentID)
	require.Equal(t, "external", least.Content.Source)

	strongest := insights[2]
	require.Equal(t, InsightStatusAvailable, strongest.Status)
	require.Equal(t, "account-youtube", strongest.AccountID)
	require.Equal(t, int64(10), *strongest.Value)
	require.Equal(t, 2, *strongest.DestinationCount)
	require.Equal(t, "external-high-older", strongest.Content.Reference.AccountContentID)
}

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

func TestContentInsightsReturnExplicitMissingAndLowSampleStates(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	unmeasured := insightTestContent("missing", "external", "account-a", "youtube", now, 0, nil)
	unmeasured.Metrics = platform.AnalyticsValues{platform.MetricViews: 100}
	missing := buildContentInsights([]ContentOverview{unmeasured}, now.Add(-7*24*time.Hour), now)
	for _, insight := range missing {
		require.Equal(t, InsightStatusInsufficientData, insight.Status)
		require.Equal(t, InsightReasonMissingMeasurements, insight.Reason)
		require.Nil(t, insight.Value)
	}

	metadata := map[string]platform.AnalyticsMetricMetadata{
		platform.MetricLikes: {
			Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
			Source: "youtube",
		},
	}
	lowSample := buildContentInsights([]ContentOverview{
		insightTestContent("only", "external", "account-a", "youtube", now, 0, metadata),
	}, now.Add(-7*24*time.Hour), now)
	for _, insight := range lowSample {
		require.Equal(t, InsightStatusInsufficientData, insight.Status)
		require.Equal(t, InsightReasonLowSample, insight.Reason)
		require.Equal(t, 1, insight.MeasuredCount, "a measured zero remains part of the sample")
		require.Nil(t, insight.Value)
	}
}

func TestFollowerDeclineUsesComparableStoredSnapshotsAndStaysAccountWide(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	delta := int64(-4)
	insight := buildFollowerDeclineInsight([]AccountOverview{
		{ID: "account-a", Platform: "youtube", Username: "channel", FollowerDelta: &delta, FollowerSeries: []SeriesPoint{{Date: "2026-09-05", Value: 20}, {Date: "2026-09-12", Value: 16}}},
		{ID: "account-b", Platform: "mastodon", Username: "person", FollowerSeries: []SeriesPoint{{Date: "2026-09-12", Value: 10}}},
	}, "", now.Add(-7*24*time.Hour), now)

	require.Equal(t, InsightStatusAvailable, insight.Status)
	require.Equal(t, int64(-4), *insight.Value)
	require.Equal(t, "account-a", insight.AccountID)
	require.Equal(t, InsightCaveatAccountWide, insight.Caveat)
	require.Equal(t, 1, insight.MeasuredCount)
	require.Equal(t, 2, insight.ComparisonSample)
}

func TestFollowerDeclineDoesNotRankDifferentSnapshotPeriods(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	firstDelta, secondDelta := int64(-4), int64(-8)
	insight := buildFollowerDeclineInsight([]AccountOverview{
		{ID: "account-a", FollowerDelta: &firstDelta, FollowerSeries: []SeriesPoint{{Date: "2026-09-05", Value: 20}, {Date: "2026-09-12", Value: 16}}},
		{ID: "account-b", FollowerDelta: &secondDelta, FollowerSeries: []SeriesPoint{{Date: "2026-08-13", Value: 30}, {Date: "2026-09-12", Value: 22}}},
	}, "", now.Add(-30*24*time.Hour), now)

	require.Equal(t, InsightStatusInsufficientData, insight.Status)
	require.Equal(t, InsightReasonIncompatibleSemantics, insight.Reason)
	require.Nil(t, insight.Value)
	require.Equal(t, InsightCaveatAccountWide, insight.Caveat)
}

func TestStoredInsightContentUsesImmutableSnapshotsInsteadOfSyncStateValues(t *testing.T) {
	db := newAnalyticsTestDB(t)
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	account := seedAnalyticsAccount(t, db, "")
	publication := seedAnalyticsPublication(t, db, account.WorkspaceID, "publication-1", now)
	rendition := models.Rendition{
		ID: "rendition-1", PublicationID: publication.ID, SocialAccountID: account.ID, Platform: account.Platform,
		Profile: models.ContentProfileShortText, Status: models.RenditionStatusPublished,
		SettingsJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}
	_, err := db.NewInsert().Model(&rendition).Exec(t.Context())
	require.NoError(t, err)
	metadata := `{"likes":{"unit":"count","aggregation":"lifetime_total","source":"test"}}`
	_, err = db.NewInsert().Model(&models.AnalyticsRenditionSnapshot{
		ID: "snapshot-1", WorkspaceID: account.WorkspaceID, PublicationID: publication.ID,
		RenditionID: rendition.ID, SocialAccountID: account.ID, Platform: account.Platform,
		MetricsJSON: `{"likes":3}`, MetricMetadataJSON: metadata, CapturedAt: now,
	}).Exec(t.Context())
	require.NoError(t, err)

	stateMetadata := map[string]platform.AnalyticsMetricMetadata{
		platform.MetricLikes: {
			Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationLifetimeTotal,
			Source: "mutable-sync-state",
		},
	}
	content := []ContentOverview{
		insightTestContent(rendition.ID, "openpost", account.ID, account.Platform, now, 99, stateMetadata),
		insightTestContent("rendition-without-snapshot", "openpost", account.ID, account.Platform, now, 77, stateMetadata),
	}
	service := NewService(db, staticTokenSource{})
	stored, err := service.loadStoredInsightContent(t.Context(), account.WorkspaceID, content)
	require.NoError(t, err)
	require.Equal(t, int64(3), stored[0].Metrics[platform.MetricLikes])
	require.Equal(t, "test", stored[0].MetricMetadata[platform.MetricLikes].Source)
	require.True(t, now.Equal(stored[0].CollectedAt))
	require.Empty(t, stored[1].Metrics, "content without an immutable snapshot is not measured")
}

func TestContentInsightsRejectReportingTotalsWithoutExplicitPeriod(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	metadata := map[string]platform.AnalyticsMetricMetadata{
		platform.MetricLikes: {
			Unit: platform.AnalyticsMetricUnitCount, Aggregation: platform.AnalyticsMetricAggregationReportingPeriodTotal,
			Source: "provider",
		},
	}
	content := []ContentOverview{
		insightTestContent("first", "external", "account-a", "provider", now, 5, metadata),
		insightTestContent("second", "external", "account-b", "provider", now.Add(-time.Hour), 3, metadata),
	}

	for _, insight := range buildContentInsights(content, now.Add(-7*24*time.Hour), now) {
		require.Equal(t, InsightStatusInsufficientData, insight.Status)
		require.Equal(t, InsightReasonIncompatibleSemantics, insight.Reason)
		require.Equal(t, 2, insight.MeasuredCount)
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
