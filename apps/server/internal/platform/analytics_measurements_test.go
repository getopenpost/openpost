package platform

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAnalyticsMeasurementsRejectInvalidPeriodAndScale(t *testing.T) {
	t.Parallel()
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
