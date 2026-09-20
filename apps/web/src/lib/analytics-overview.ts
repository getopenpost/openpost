import type { components } from '$lib/api/types';

type AnalyticsContent = components['schemas']['ContentOverview'];
type AnalyticsInsight = components['schemas']['Insight'];
type AnalyticsOverview = components['schemas']['Overview'];
export type AnalyticsSortMode = 'engagement' | 'views' | 'newest';

const engagementKeys = ['likes', 'comments', 'reposts', 'quotes', 'shares', 'saves', 'clicks'];

export function hasEngagementMeasurement(item: Pick<AnalyticsContent, 'metrics'>) {
	return engagementKeys.some((metric) => metric in item.metrics);
}

// UI metric lists are driven by measured keys so an explicit zero remains
// visible while a missing provider column stays absent.
export function measuredMetricKeys(metrics: Record<string, number>, candidates: string[]) {
	return candidates.filter((metric) => metric in metrics);
}

export function insightHasRanking(
	insight: AnalyticsInsight
): insight is AnalyticsInsight & { value: number } {
	return insight.status === 'available' && insight.value !== undefined;
}

// Pagination extends only the content window. Every aggregate and insight is
// calculated by the server over the complete filtered population and must not
// be replaced by a later content page.
export function appendAnalyticsContentPage(
	current: AnalyticsOverview,
	nextPage: AnalyticsOverview
): AnalyticsOverview {
	return {
		...current,
		content: [...(current.content ?? []), ...(nextPage.content ?? [])],
		content_next_cursor: nextPage.content_next_cursor
	};
}
