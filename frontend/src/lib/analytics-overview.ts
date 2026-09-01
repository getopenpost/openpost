import type { components } from '$lib/api/types';

type AnalyticsContent = components['schemas']['ContentOverview'];
type AnalyticsInsight = components['schemas']['Insight'];
type AnalyticsOverview = components['schemas']['Overview'];
type AccountDiscoveryCoverage = components['schemas']['AccountDiscoveryCoverage'];
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

export function isBuildingAccountHistory(coverage: AccountDiscoveryCoverage) {
	// Telegram observes forward from installation and never runs an initial backfill.
	return (
		!coverage.initial_completed_at &&
		coverage.platform !== 'telegram' &&
		(coverage.status === 'complete' || coverage.status === 'partial')
	);
}

export function hasLimitedAccountHistory(coverage: AccountDiscoveryCoverage) {
	return coverage.status !== 'complete' || isBuildingAccountHistory(coverage);
}
