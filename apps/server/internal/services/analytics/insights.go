package analytics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

const (
	InsightKindMostEngagementActions        = "most_engagement_actions"
	InsightKindStrongestMeasuredDestination = "strongest_measured_destination"
	InsightKindFollowerDecline              = "follower_decline"

	InsightStatusAvailable        = "available"
	InsightStatusInsufficientData = "insufficient_data"

	InsightReasonMissingMeasurements   = "missing_measurements"
	InsightReasonLowSample             = "low_sample"
	InsightReasonIncompatibleSemantics = "incompatible_semantics"
	InsightReasonNoDecline             = "no_decline"

	InsightPeriodAggregationUnavailable = platform.AnalyticsMetricAggregation("unavailable")

	InsightCaveatFilteredLifetimeTotals = "filtered_content_lifetime_totals"
	InsightCaveatFilteredPeriodTotals   = "filtered_content_reporting_period_totals"
	InsightCaveatAccountWide            = "account_wide"
)

type InsightPeriod struct {
	FilterStart      time.Time                           `json:"filter_start"`
	FilterEnd        time.Time                           `json:"filter_end"`
	Aggregation      platform.AnalyticsMetricAggregation `json:"aggregation" enum:"unavailable,current_snapshot,lifetime_total,reporting_period_total"`
	MeasurementStart *time.Time                          `json:"measurement_start,omitempty"`
	MeasurementEnd   *time.Time                          `json:"measurement_end,omitempty"`
}

type InsightContentEvidence struct {
	Reference   ContentReference `json:"reference"`
	Source      string           `json:"source" enum:"openpost,external"`
	Title       string           `json:"title"`
	Excerpt     string           `json:"excerpt"`
	Platform    string           `json:"platform"`
	AccountID   string           `json:"account_id"`
	Username    string           `json:"username"`
	PublishedAt time.Time        `json:"published_at"`
	CollectedAt time.Time        `json:"collected_at"`
}

type Insight struct {
	Kind             string                  `json:"kind" enum:"most_engagement_actions,strongest_measured_destination,follower_decline"`
	Status           string                  `json:"status" enum:"available,insufficient_data"`
	Reason           string                  `json:"reason,omitempty" enum:"missing_measurements,low_sample,incompatible_semantics,no_decline"`
	Period           InsightPeriod           `json:"period"`
	Metric           string                  `json:"metric"`
	Value            *int64                  `json:"value,omitempty"`
	MeasuredCount    int                     `json:"measured_count"`
	ComparisonSample int                     `json:"comparison_sample"`
	DestinationCount *int                    `json:"destination_count,omitempty"`
	Content          *InsightContentEvidence `json:"content,omitempty"`
	AccountID        string                  `json:"account_id,omitempty"`
	Platform         string                  `json:"platform,omitempty"`
	Username         string                  `json:"username,omitempty"`
	Caveat           string                  `json:"caveat,omitempty" enum:"filtered_content_lifetime_totals,filtered_content_reporting_period_totals,account_wide"`
}

type engagementSemanticKey struct {
	aggregation platform.AnalyticsMetricAggregation
	periodStart string
	periodEnd   string
}

type measuredEngagementContent struct {
	content ContentOverview
	value   int64
	key     engagementSemanticKey
}

func buildOverviewInsights(content []ContentOverview, accounts []AccountOverview, accountID string, start, end time.Time) []Insight {
	insights := buildContentInsights(content, start, end)
	insights = append(insights, buildFollowerDeclineInsight(accounts, accountID, start, end))
	return insights
}

// loadStoredInsightContent prevents mutable sync-state values from becoming
// evidence. Inventory rows already carry account-content snapshots; managed
// rows are replaced with their latest immutable rendition snapshot.
func (s *Service) loadStoredInsightContent(
	ctx context.Context,
	workspaceID string,
	content []ContentOverview,
) ([]ContentOverview, error) {
	renditionIDs := make([]string, 0, len(content))
	for _, item := range content {
		if item.Reference.Type == string(platform.AccountContentOriginOpenPost) &&
			!item.insightSnapshotBacked && item.Reference.RenditionID != "" {
			renditionIDs = append(renditionIDs, item.Reference.RenditionID)
		}
	}
	latest := make(map[string]models.AnalyticsRenditionSnapshot, len(renditionIDs))
	if len(renditionIDs) > 0 {
		var snapshots []models.AnalyticsRenditionSnapshot
		if err := s.db.NewSelect().Model(&snapshots).
			Where("workspace_id = ?", workspaceID).
			Where("rendition_id IN (?)", bun.List(renditionIDs)).
			Order("rendition_id ASC", "captured_at DESC").
			Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("load stored analytics insight snapshots: %w", err)
		}
		for _, snapshot := range snapshots {
			if _, exists := latest[snapshot.RenditionID]; !exists {
				latest[snapshot.RenditionID] = snapshot
			}
		}
	}

	stored := make([]ContentOverview, 0, len(content))
	for _, item := range content {
		if item.insightSnapshotBacked {
			stored = append(stored, item)
			continue
		}
		item.Metrics = platform.AnalyticsValues{}
		item.MetricMetadata = map[string]platform.AnalyticsMetricMetadata{}
		item.CollectedAt = time.Time{}
		item.Engagement = 0
		if snapshot, ok := latest[item.Reference.RenditionID]; ok {
			item.Metrics, item.MetricMetadata = decodeAnalyticsMetrics(
				snapshot.MetricsJSON,
				snapshot.MetricMetadataJSON,
				platform.AnalyticsMetricSubjectContent,
				snapshot.Platform,
			)
			item.CollectedAt = snapshot.CapturedAt
			item.Engagement = projectedContentEngagement(item.Metrics, item.MetricMetadata)
		}
		stored = append(stored, item)
	}
	return stored, nil
}

func buildContentInsights(content []ContentOverview, start, end time.Time) []Insight {
	basePeriod := InsightPeriod{FilterStart: start, FilterEnd: end, Aggregation: InsightPeriodAggregationUnavailable}
	most := insufficientInsight(InsightKindMostEngagementActions, "engagement_actions", basePeriod, InsightReasonMissingMeasurements, 0, len(content))
	destinationCount := 0
	strongest := insufficientInsight(InsightKindStrongestMeasuredDestination, "engagement_actions", basePeriod, InsightReasonMissingMeasurements, 0, len(content))
	strongest.DestinationCount = &destinationCount

	measured, semanticCount, measuredCount := comparableEngagementContent(content)
	most.MeasuredCount, strongest.MeasuredCount = measuredCount, measuredCount
	if len(measured) == 0 {
		if semanticCount > 0 {
			most.Reason = InsightReasonIncompatibleSemantics
			strongest.Reason = InsightReasonIncompatibleSemantics
		}
		return []Insight{most, strongest}
	}
	period := insightPeriodForKey(start, end, measured[0].key)
	most.Period, strongest.Period = period, period

	if semanticCount > 1 {
		most.Reason = InsightReasonIncompatibleSemantics
		strongest.Reason = InsightReasonIncompatibleSemantics
		return []Insight{most, strongest}
	}

	destinations := make(map[string][]measuredEngagementContent)
	for _, candidate := range measured {
		destinations[candidate.content.AccountID] = append(destinations[candidate.content.AccountID], candidate)
	}
	destinationCount = len(destinations)
	strongest.DestinationCount = &destinationCount

	if len(measured) < 2 {
		most.Reason = InsightReasonLowSample
	} else {
		sortMeasuredEngagement(measured, true)
		most = availableContentInsight(InsightKindMostEngagementActions, measured[0], len(measured), len(content), period)
	}

	if destinationCount < 2 {
		strongest.Reason = InsightReasonLowSample
		return []Insight{most, strongest}
	}

	type destinationCandidate struct {
		accountID string
		platform  string
		username  string
		value     int64
		evidence  measuredEngagementContent
	}
	ranked := make([]destinationCandidate, 0, len(destinations))
	for id, candidates := range destinations {
		sortMeasuredEngagement(candidates, true)
		candidate := destinationCandidate{
			accountID: id,
			platform:  candidates[0].content.Platform,
			username:  candidates[0].content.Username,
			evidence:  candidates[0],
		}
		for _, item := range candidates {
			candidate.value += item.value
		}
		ranked = append(ranked, candidate)
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].value != ranked[j].value {
			return ranked[i].value > ranked[j].value
		}
		return ranked[i].accountID < ranked[j].accountID
	})
	winner := ranked[0]
	strongest = Insight{
		Kind: InsightKindStrongestMeasuredDestination, Status: InsightStatusAvailable,
		Period: period, Metric: "engagement_actions", Value: int64Pointer(winner.value),
		MeasuredCount: len(measured), ComparisonSample: len(content), DestinationCount: &destinationCount,
		Content: insightContentEvidence(winner.evidence.content), AccountID: winner.accountID,
		Platform: winner.platform, Username: winner.username, Caveat: contentInsightCaveat(period.Aggregation),
	}
	return []Insight{most, strongest}
}

func comparableEngagementContent(content []ContentOverview) ([]measuredEngagementContent, int, int) {
	groups := make(map[engagementSemanticKey][]measuredEngagementContent)
	measuredContent := make(map[string]struct{})
	invalidSemantics := false
	for _, item := range content {
		valuesByKey := make(map[engagementSemanticKey]int64)
		for _, metric := range engagementProjectionMetricNames(item.Metrics) {
			value, measured := item.Metrics[metric]
			metadata, described := item.MetricMetadata[metric]
			if !measured || !described {
				continue
			}
			key, comparable, invalid := comparableEngagementMetric(metadata)
			if !comparable {
				continue
			}
			measuredContent[contentIdentity(item)] = struct{}{}
			if invalid {
				invalidSemantics = true
				continue
			}
			valuesByKey[key] += value
		}
		for key, value := range valuesByKey {
			groups[key] = append(groups[key], measuredEngagementContent{content: item, value: value, key: key})
		}
	}
	if invalidSemantics {
		return nil, len(groups) + 1, len(measuredContent)
	}
	if len(groups) != 1 {
		return nil, len(groups), len(measuredContent)
	}
	for _, measured := range groups {
		return measured, 1, len(measuredContent)
	}
	return nil, 0, 0
}

func comparableEngagementMetric(metadata platform.AnalyticsMetricMetadata) (engagementSemanticKey, bool, bool) {
	if metadata.Unit != platform.AnalyticsMetricUnitCount {
		return engagementSemanticKey{}, false, false
	}
	if metadata.Aggregation != platform.AnalyticsMetricAggregationLifetimeTotal &&
		metadata.Aggregation != platform.AnalyticsMetricAggregationReportingPeriodTotal {
		return engagementSemanticKey{}, false, false
	}
	invalidPeriod := metadata.Aggregation == platform.AnalyticsMetricAggregationReportingPeriodTotal &&
		(metadata.PeriodStart == nil || metadata.PeriodEnd == nil || metadata.PeriodEnd.Before(*metadata.PeriodStart))
	return engagementKey(metadata), true, invalidPeriod
}

func engagementKey(metadata platform.AnalyticsMetricMetadata) engagementSemanticKey {
	key := engagementSemanticKey{aggregation: metadata.Aggregation}
	if metadata.PeriodStart != nil {
		key.periodStart = metadata.PeriodStart.UTC().Format(time.RFC3339Nano)
	}
	if metadata.PeriodEnd != nil {
		key.periodEnd = metadata.PeriodEnd.UTC().Format(time.RFC3339Nano)
	}
	return key
}

func insightPeriodForKey(start, end time.Time, key engagementSemanticKey) InsightPeriod {
	period := InsightPeriod{FilterStart: start, FilterEnd: end, Aggregation: key.aggregation}
	if key.periodStart != "" {
		parsed, err := time.Parse(time.RFC3339Nano, key.periodStart)
		if err == nil {
			period.MeasurementStart = &parsed
		}
	}
	if key.periodEnd != "" {
		parsed, err := time.Parse(time.RFC3339Nano, key.periodEnd)
		if err == nil {
			period.MeasurementEnd = &parsed
		}
	}
	return period
}

func availableContentInsight(kind string, candidate measuredEngagementContent, measuredCount, sample int, period InsightPeriod) Insight {
	return Insight{
		Kind: kind, Status: InsightStatusAvailable, Period: period, Metric: "engagement_actions",
		Value: int64Pointer(candidate.value), MeasuredCount: measuredCount, ComparisonSample: sample,
		Content: insightContentEvidence(candidate.content), AccountID: candidate.content.AccountID,
		Platform: candidate.content.Platform, Username: candidate.content.Username,
		Caveat: contentInsightCaveat(period.Aggregation),
	}
}

func buildFollowerDeclineInsight(accounts []AccountOverview, accountID string, start, end time.Time) Insight {
	period := InsightPeriod{
		FilterStart: start, FilterEnd: end, Aggregation: platform.AnalyticsMetricAggregationCurrentSnapshot,
	}
	comparisonSample := 0
	measuredCount := 0
	var candidates []AccountOverview
	for _, account := range accounts {
		if accountID != "" && account.ID != accountID {
			continue
		}
		comparisonSample++
		if len(account.FollowerSeries) < 2 || account.FollowerDelta == nil {
			continue
		}
		measuredCount++
		if *account.FollowerDelta < 0 {
			candidates = append(candidates, account)
		}
	}
	if measuredCount == 0 {
		insight := insufficientInsight(InsightKindFollowerDecline, platform.MetricFollowers, period, InsightReasonMissingMeasurements, 0, comparisonSample)
		insight.Caveat = InsightCaveatAccountWide
		return insight
	}
	if len(candidates) == 0 {
		insight := insufficientInsight(InsightKindFollowerDecline, platform.MetricFollowers, period, InsightReasonNoDecline, measuredCount, comparisonSample)
		insight.Caveat = InsightCaveatAccountWide
		return insight
	}
	if !followerDeclinesSharePeriod(candidates) {
		insight := insufficientInsight(InsightKindFollowerDecline, platform.MetricFollowers, period, InsightReasonIncompatibleSemantics, measuredCount, comparisonSample)
		insight.Caveat = InsightCaveatAccountWide
		return insight
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := *candidates[i].FollowerDelta, *candidates[j].FollowerDelta
		if left != right {
			return left < right
		}
		return candidates[i].ID < candidates[j].ID
	})
	winner := candidates[0]
	first, last := winner.FollowerSeries[0], winner.FollowerSeries[len(winner.FollowerSeries)-1]
	measurementStart, startErr := time.Parse("2006-01-02", first.Date)
	measurementEnd, endErr := time.Parse("2006-01-02", last.Date)
	if startErr == nil {
		period.MeasurementStart = &measurementStart
	}
	if endErr == nil {
		period.MeasurementEnd = &measurementEnd
	}
	return Insight{
		Kind: InsightKindFollowerDecline, Status: InsightStatusAvailable, Period: period,
		Metric: platform.MetricFollowers, Value: int64Pointer(*winner.FollowerDelta),
		MeasuredCount: measuredCount, ComparisonSample: comparisonSample,
		AccountID: winner.ID, Platform: winner.Platform, Username: winner.Username, Caveat: InsightCaveatAccountWide,
	}
}

func followerDeclinesSharePeriod(accounts []AccountOverview) bool {
	if len(accounts) < 2 {
		return true
	}
	firstStart := accounts[0].FollowerSeries[0].Date
	firstEnd := accounts[0].FollowerSeries[len(accounts[0].FollowerSeries)-1].Date
	for _, account := range accounts[1:] {
		if account.FollowerSeries[0].Date != firstStart ||
			account.FollowerSeries[len(account.FollowerSeries)-1].Date != firstEnd {
			return false
		}
	}
	return true
}

func insufficientInsight(kind, metric string, period InsightPeriod, reason string, measuredCount, sample int) Insight {
	return Insight{
		Kind: kind, Status: InsightStatusInsufficientData, Reason: reason, Period: period,
		Metric: metric, MeasuredCount: measuredCount, ComparisonSample: sample,
	}
}

func sortMeasuredEngagement(measured []measuredEngagementContent, descending bool) {
	sort.SliceStable(measured, func(i, j int) bool {
		if measured[i].value != measured[j].value {
			if descending {
				return measured[i].value > measured[j].value
			}
			return measured[i].value < measured[j].value
		}
		if !measured[i].content.PublishedAt.Equal(measured[j].content.PublishedAt) {
			return measured[i].content.PublishedAt.After(measured[j].content.PublishedAt)
		}
		return contentIdentity(measured[i].content) < contentIdentity(measured[j].content)
	})
}

func insightContentEvidence(content ContentOverview) *InsightContentEvidence {
	return &InsightContentEvidence{
		Reference: content.Reference, Source: content.Source, Title: content.Title, Excerpt: content.Excerpt,
		Platform: content.Platform, AccountID: content.AccountID, Username: content.Username,
		PublishedAt: content.PublishedAt, CollectedAt: content.CollectedAt,
	}
}

func contentInsightCaveat(aggregation platform.AnalyticsMetricAggregation) string {
	if aggregation == platform.AnalyticsMetricAggregationReportingPeriodTotal {
		return InsightCaveatFilteredPeriodTotals
	}
	return InsightCaveatFilteredLifetimeTotals
}

func int64Pointer(value int64) *int64 { return &value }
