package platform

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestEngagementTotalPrefersProviderAggregateWithoutDoubleCountingComponents(t *testing.T) {
	values := AnalyticsValues{
		MetricEngagements:    10,
		MetricSaves:          3,
		MetricPinClicks:      14,
		MetricOutboundClicks: 5,
	}
	require.Equal(t, int64(10), EngagementTotal(values))
	require.True(t, HasEngagementMetric(values))
}

func TestAnalyticsMeasurementsPreserveIntegerUnitsAndAggregations(t *testing.T) {
	start := time.Date(2026, 8, 1, 0, 0, 0, 0, time.FixedZone("test", -4*60*60))
	end := start.Add(24 * time.Hour)
	scale := int64(100)
	measurements := AnalyticsMeasurements{
		"followers": {
			Value: 10,
			AnalyticsMetricMetadata: AnalyticsMetricMetadata{
				Unit: AnalyticsMetricUnitCount, Aggregation: AnalyticsMetricAggregationCurrentSnapshot,
			},
		},
		"watch_time": {
			Value: 1234,
			AnalyticsMetricMetadata: AnalyticsMetricMetadata{
				Unit: AnalyticsMetricUnitMilliseconds, Aggregation: AnalyticsMetricAggregationReportingPeriodTotal,
				PeriodStart: &start, PeriodEnd: &end, Scale: &scale,
			},
		},
		"completion_rate": {
			Value: 8750,
			AnalyticsMetricMetadata: AnalyticsMetricMetadata{
				Unit: AnalyticsMetricUnitBasisPoints, Aggregation: AnalyticsMetricAggregationReportingPeriodAverage,
				Source: "analytics_report", PeriodStart: &start, PeriodEnd: &end,
			},
		},
		"views": {
			Value: 99,
			AnalyticsMetricMetadata: AnalyticsMetricMetadata{
				Unit: AnalyticsMetricUnitCount, Aggregation: AnalyticsMetricAggregationLifetimeTotal,
			},
		},
	}

	values, metadata, err := measurements.ValuesAndMetadata("provider_data")
	require.NoError(t, err)
	require.Equal(t, int64(8750), values["completion_rate"])
	require.Equal(t, "provider_data", metadata["watch_time"].Source)
	require.Equal(t, "analytics_report", metadata["completion_rate"].Source)
	require.Equal(t, start.UTC(), *metadata["watch_time"].PeriodStart)
	require.Equal(t, end.UTC(), *metadata["watch_time"].PeriodEnd)
	require.Equal(t, scale, *metadata["watch_time"].Scale)
}

func TestAnalyticsMeasurementsRejectInvalidPeriodAndScale(t *testing.T) {
	start := time.Now().UTC()
	zero := int64(0)
	_, _, err := (AnalyticsMeasurements{"views": {
		Value: 1,
		AnalyticsMetricMetadata: AnalyticsMetricMetadata{
			Unit: AnalyticsMetricUnitCount, Aggregation: AnalyticsMetricAggregationReportingPeriodTotal,
			PeriodStart: &start,
		},
	}}).ValuesAndMetadata("provider")
	require.ErrorContains(t, err, "ordered start and end")

	_, _, err = (AnalyticsMeasurements{"views": {
		Value: 1,
		AnalyticsMetricMetadata: AnalyticsMetricMetadata{
			Unit: AnalyticsMetricUnitCount, Aggregation: AnalyticsMetricAggregationLifetimeTotal, Scale: &zero,
		},
	}}).ValuesAndMetadata("provider")
	require.ErrorContains(t, err, "display scale must be positive")
}

func TestLegacyAnalyticsMetricMetadataMapsOnlyEstablishedSemantics(t *testing.T) {
	followers, ok := LegacyAnalyticsMetricMetadata(AnalyticsMetricSubjectAccount, MetricFollowers, "")
	require.True(t, ok)
	require.Equal(t, AnalyticsMetricAggregationCurrentSnapshot, followers.Aggregation)

	views, ok := LegacyAnalyticsMetricMetadata(AnalyticsMetricSubjectContent, MetricViews, "")
	require.True(t, ok)
	require.Equal(t, AnalyticsMetricAggregationLifetimeTotal, views.Aggregation)

	_, ok = LegacyAnalyticsMetricMetadata(AnalyticsMetricSubjectContent, "provider_score", "")
	require.False(t, ok)
}
