import type { components } from '$lib/api/types';

type AnalyticsContent = components['schemas']['ContentOverview'];
export type AnalyticsSortMode = 'engagement' | 'views' | 'newest';

const engagementKeys = ['likes', 'comments', 'reposts', 'quotes', 'shares', 'saves', 'clicks'];

export function hasEngagementMeasurement(item: AnalyticsContent) {
	return engagementKeys.some((metric) => metric in item.metrics);
}
