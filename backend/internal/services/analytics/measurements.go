package analytics

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/platform"
)

func fetchAccountMeasurements(
	ctx context.Context,
	adapter platform.AnalyticsAdapter,
	accessToken string,
	request platform.AccountAnalyticsRequest,
	source string,
) (platform.AnalyticsValues, map[string]platform.AnalyticsMetricMetadata, error) {
	if semantic, ok := adapter.(platform.SemanticAnalyticsAdapter); ok {
		measurements, err := semantic.FetchAccountAnalyticsMeasurements(ctx, accessToken, request)
		if err != nil {
			return nil, nil, err
		}
		return measurements.ValuesAndMetadata(source)
	}
	values, err := adapter.FetchAccountAnalytics(ctx, accessToken, request)
	return values, legacyMetricMetadata(values, platform.AnalyticsMetricSubjectAccount, source), err
}

func fetchContentMeasurements(
	ctx context.Context,
	adapter platform.AnalyticsAdapter,
	accessToken string,
	request platform.ContentAnalyticsRequest,
	source string,
) (platform.AnalyticsValues, map[string]platform.AnalyticsMetricMetadata, error) {
	if semantic, ok := adapter.(platform.SemanticAnalyticsAdapter); ok {
		measurements, err := semantic.FetchContentAnalyticsMeasurements(ctx, accessToken, request)
		if err != nil {
			return nil, nil, err
		}
		return measurements.ValuesAndMetadata(source)
	}
	values, err := adapter.FetchContentAnalytics(ctx, accessToken, request)
	return values, legacyMetricMetadata(values, platform.AnalyticsMetricSubjectContent, source), err
}

func legacyMetricMetadata(values platform.AnalyticsValues, subject, source string) map[string]platform.AnalyticsMetricMetadata {
	metadata := make(map[string]platform.AnalyticsMetricMetadata)
	for metric := range values {
		if meta, ok := platform.LegacyAnalyticsMetricMetadata(subject, metric, source); ok {
			metadata[metric] = meta
		}
	}
	return metadata
}

func encodeMetricMetadata(metadata map[string]platform.AnalyticsMetricMetadata) (string, error) {
	if metadata == nil {
		metadata = map[string]platform.AnalyticsMetricMetadata{}
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return "", fmt.Errorf("encode analytics metric metadata: %w", err)
	}
	return string(encoded), nil
}

// decodeAnalyticsMetrics keeps every stored value readable. Semantic metadata
// is inferred only for established legacy keys when the entire legacy row has
// no metadata; malformed or partial new metadata fails closed for aggregation.
func decodeAnalyticsMetrics(rawValues, rawMetadata, subject, source string) (platform.AnalyticsValues, map[string]platform.AnalyticsMetricMetadata) {
	values := decodeAnalyticsValues(rawValues)
	metadata := map[string]platform.AnalyticsMetricMetadata{}
	cleanMetadata := strings.TrimSpace(rawMetadata)
	if cleanMetadata == "" || cleanMetadata == "{}" {
		return values, legacyMetricMetadata(values, subject, source)
	}
	if json.Unmarshal([]byte(cleanMetadata), &metadata) != nil {
		return values, map[string]platform.AnalyticsMetricMetadata{}
	}
	return values, metadata
}

func compatibleCountMetricValue(
	values platform.AnalyticsValues,
	metadata map[string]platform.AnalyticsMetricMetadata,
	metric string,
	aggregation platform.AnalyticsMetricAggregation,
) (int64, bool) {
	value, measured := values[metric]
	meta, described := metadata[metric]
	if !measured || !described || !platform.AnalyticsMetricCompatible(meta, platform.AnalyticsMetricUnitCount, aggregation) {
		return 0, false
	}
	return value, true
}

func projectedContentEngagement(values platform.AnalyticsValues, metadata map[string]platform.AnalyticsMetricMetadata) (int64, bool) {
	metrics := engagementProjectionMetricNames(values)
	var total int64
	var aggregation platform.AnalyticsMetricAggregation
	var periodStart, periodEnd string
	measured := false
	for _, metric := range metrics {
		value, present := values[metric]
		meta, described := metadata[metric]
		if !present || !described || meta.Unit != platform.AnalyticsMetricUnitCount ||
			(meta.Aggregation != platform.AnalyticsMetricAggregationLifetimeTotal && meta.Aggregation != platform.AnalyticsMetricAggregationReportingPeriodTotal) {
			continue
		}
		start, end := "", ""
		if meta.PeriodStart != nil {
			start = meta.PeriodStart.UTC().Format(time.RFC3339Nano)
		}
		if meta.PeriodEnd != nil {
			end = meta.PeriodEnd.UTC().Format(time.RFC3339Nano)
		}
		if measured && (aggregation != meta.Aggregation || periodStart != start || periodEnd != end) {
			return 0, false
		}
		aggregation, periodStart, periodEnd = meta.Aggregation, start, end
		total += value
		measured = true
	}
	return total, measured
}

func compatibleContentValues(values platform.AnalyticsValues, metadata map[string]platform.AnalyticsMetricMetadata) platform.AnalyticsValues {
	compatible := platform.AnalyticsValues{}
	for metric, value := range values {
		meta, ok := metadata[metric]
		if ok && platform.AnalyticsMetricCompatible(
			meta,
			platform.AnalyticsMetricUnitCount,
			platform.AnalyticsMetricAggregationLifetimeTotal,
		) {
			compatible[metric] = value
		}
	}
	return compatible
}
