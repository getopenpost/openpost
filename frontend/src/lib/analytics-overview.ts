import type { components } from '$lib/api/types';

type AnalyticsContent = components['schemas']['ContentOverview'];
type AnalyticsInsight = components['schemas']['Insight'];
export type AnalyticsSortMode = 'engagement' | 'views' | 'newest';
export type AnalyticsSourceLabelKey = 'published_with_openpost' | 'published_elsewhere';

const engagementKeys = ['likes', 'comments', 'reposts', 'quotes', 'shares', 'saves', 'clicks'];

export function hasEngagementMeasurement(item: AnalyticsContent) {
	return engagementKeys.some((metric) => metric in item.metrics);
}

// UI metric lists are driven by measured keys so an explicit zero remains
// visible while a missing provider column stays absent.
export function measuredMetricKeys(metrics: Record<string, number>, candidates: string[]) {
	return candidates.filter((metric) => metric in metrics);
}

export function analyticsSourceLabelKey(
	source: AnalyticsContent['source']
): AnalyticsSourceLabelKey {
	return source === 'external' ? 'published_elsewhere' : 'published_with_openpost';
}

export function insightHasRanking(insight: AnalyticsInsight) {
	return insight.status === 'available' && insight.value !== undefined;
}
