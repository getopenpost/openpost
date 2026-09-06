package platform

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type AnalyticsMetricUnit string

const (
	AnalyticsMetricUnitCount        AnalyticsMetricUnit = "count"
	AnalyticsMetricUnitMilliseconds AnalyticsMetricUnit = "milliseconds"
	AnalyticsMetricUnitBasisPoints  AnalyticsMetricUnit = "basis_points"
)

type AnalyticsMetricAggregation string

const (
	AnalyticsMetricAggregationCurrentSnapshot        AnalyticsMetricAggregation = "current_snapshot"
	AnalyticsMetricAggregationLifetimeTotal          AnalyticsMetricAggregation = "lifetime_total"
	AnalyticsMetricAggregationReportingPeriodTotal   AnalyticsMetricAggregation = "reporting_period_total"
	AnalyticsMetricAggregationReportingPeriodAverage AnalyticsMetricAggregation = "reporting_period_average"
)

const (
	AnalyticsMetricSubjectAccount = "account"
	AnalyticsMetricSubjectContent = "content"
)

// AnalyticsMetricMetadata preserves the provider meaning of one normalized
// integer measurement. Scale is optional display metadata and does not change
// the stored integer value.
type AnalyticsMetricMetadata struct {
	Unit        AnalyticsMetricUnit        `json:"unit" enum:"count,milliseconds,basis_points"`
	Aggregation AnalyticsMetricAggregation `json:"aggregation" enum:"current_snapshot,lifetime_total,reporting_period_total,reporting_period_average"`
	Source      string                     `json:"source,omitempty"`
	PeriodStart *time.Time                 `json:"period_start,omitempty"`
	PeriodEnd   *time.Time                 `json:"period_end,omitempty"`
	Scale       *int64                     `json:"scale,omitempty" minimum:"1"`
}

type AnalyticsMeasurement struct {
	Value int64 `json:"value"`
	AnalyticsMetricMetadata
}

type AnalyticsMeasurements map[string]AnalyticsMeasurement

// SemanticAnalyticsAdapter is optional. Implementations use it when a provider
// returns units or reporting-period values that cannot truthfully fit the
// legacy count-only AnalyticsAdapter result.
type SemanticAnalyticsAdapter interface {
	FetchAccountAnalyticsMeasurements(ctx context.Context, accessToken string, input AccountAnalyticsRequest) (AnalyticsMeasurements, error)
	FetchContentAnalyticsMeasurements(ctx context.Context, accessToken string, input ContentAnalyticsRequest) (AnalyticsMeasurements, error)
}

// ValuesAndMetadata validates semantic measurements and splits them into the
// additive persistence representation used by analytics snapshots.
func (measurements AnalyticsMeasurements) ValuesAndMetadata(defaultSource string) (AnalyticsValues, map[string]AnalyticsMetricMetadata, error) {
	values := make(AnalyticsValues, len(measurements))
	metadata := make(map[string]AnalyticsMetricMetadata, len(measurements))
	for name, measurement := range measurements {
		if name == "" || name != strings.TrimSpace(name) {
			return nil, nil, fmt.Errorf("analytics metric name is required without surrounding whitespace")
		}
		meta := measurement.AnalyticsMetricMetadata
		if meta.Source = strings.TrimSpace(meta.Source); meta.Source == "" {
			meta.Source = strings.TrimSpace(defaultSource)
		}
		if meta.Source == "" {
			return nil, nil, fmt.Errorf("analytics metric %q: provider source is required", name)
		}
		if err := validateAnalyticsMetricMetadata(meta); err != nil {
			return nil, nil, fmt.Errorf("analytics metric %q: %w", name, err)
		}
		if meta.PeriodStart != nil {
			start := meta.PeriodStart.UTC()
			meta.PeriodStart = &start
		}
		if meta.PeriodEnd != nil {
			end := meta.PeriodEnd.UTC()
			meta.PeriodEnd = &end
		}
		values[name] = measurement.Value
		metadata[name] = meta
	}
	return values, metadata, nil
}

func validateAnalyticsMetricMetadata(meta AnalyticsMetricMetadata) error {
	switch meta.Unit {
	case AnalyticsMetricUnitCount, AnalyticsMetricUnitMilliseconds, AnalyticsMetricUnitBasisPoints:
	default:
		return fmt.Errorf("unsupported unit %q", meta.Unit)
	}
	periodAggregation := false
	switch meta.Aggregation {
	case AnalyticsMetricAggregationCurrentSnapshot, AnalyticsMetricAggregationLifetimeTotal:
	case AnalyticsMetricAggregationReportingPeriodTotal, AnalyticsMetricAggregationReportingPeriodAverage:
		periodAggregation = true
	default:
		return fmt.Errorf("unsupported aggregation %q", meta.Aggregation)
	}
	if periodAggregation {
		if meta.PeriodStart == nil || meta.PeriodEnd == nil || !meta.PeriodStart.Before(*meta.PeriodEnd) {
			return fmt.Errorf("reporting period requires an ordered start and end")
		}
	} else if meta.PeriodStart != nil || meta.PeriodEnd != nil {
		return fmt.Errorf("reporting period is only valid for reporting-period aggregations")
	}
	if meta.Scale != nil && *meta.Scale <= 0 {
		return fmt.Errorf("display scale must be positive")
	}
	return nil
}

// LegacyAnalyticsMetricMetadata maps only metrics whose historical meaning is
// already established. Unknown legacy keys remain readable as raw values but
// are not eligible for totals or trends.
func LegacyAnalyticsMetricMetadata(subject, metric, source string) (AnalyticsMetricMetadata, bool) {
	meta := AnalyticsMetricMetadata{Unit: AnalyticsMetricUnitCount, Source: strings.TrimSpace(source)}
	switch subject {
	case AnalyticsMetricSubjectAccount:
		switch metric {
		case MetricFollowers, MetricFollowing, MetricMembers, MetricPosts:
			meta.Aggregation = AnalyticsMetricAggregationCurrentSnapshot
			return meta, true
		}
	case AnalyticsMetricSubjectContent:
		switch metric {
		case MetricLikes, MetricReactions, MetricComments, MetricReposts, MetricQuotes, MetricShares, MetricSaves,
			MetricViews, MetricImpressions, MetricReach, MetricClicks:
			meta.Aggregation = AnalyticsMetricAggregationLifetimeTotal
			return meta, true
		}
	}
	return AnalyticsMetricMetadata{}, false
}

func AnalyticsMetricCompatible(meta AnalyticsMetricMetadata, unit AnalyticsMetricUnit, aggregation AnalyticsMetricAggregation) bool {
	return meta.Unit == unit && meta.Aggregation == aggregation
}
