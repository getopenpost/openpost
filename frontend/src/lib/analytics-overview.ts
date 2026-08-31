import type { components } from '$lib/api/types';

type AnalyticsContent = components['schemas']['ContentOverview'];
export type AnalyticsSortMode = 'engagement' | 'views' | 'newest';

const engagementKeys = ['likes', 'comments', 'reposts', 'quotes', 'shares', 'saves', 'clicks'];

export function hasEngagementMeasurement(item: AnalyticsContent) {
	return engagementKeys.some((metric) => metric in item.metrics);
}

// UI metric lists are driven by measured keys so an explicit zero remains
// visible while a missing provider column stays absent.
export function measuredMetricKeys(metrics: Record<string, number>, candidates: string[]) {
	return candidates.filter((metric) => metric in metrics);
}
