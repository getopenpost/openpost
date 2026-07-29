import type { components } from '$lib/api/types';

type AnalyticsOverview = components['schemas']['Overview'];
type AnalyticsAccount = components['schemas']['AccountOverview'];
type AnalyticsContent = components['schemas']['ContentOverview'];
type AnalyticsPublication = components['schemas']['PublicationOverview'];
type MetricSummary = components['schemas']['MetricSummary'];
export type AnalyticsSortMode = 'engagement' | 'views' | 'newest';

const engagementKeys = ['likes', 'comments', 'reposts', 'quotes', 'shares', 'saves', 'clicks'];

export function hasEngagementMeasurement(item: AnalyticsContent) {
	return engagementKeys.some((metric) => metric in item.metrics);
}

export function filterAnalyticsPublications(
	publications: AnalyticsPublication[],
	accountID: string,
	sortMode: AnalyticsSortMode
) {
	const filtered = publications
		.map((publication) => filterPublication(publication, accountID))
		.filter((publication): publication is AnalyticsPublication => publication !== null);
	return filtered.toSorted((left, right) => {
		if (sortMode === 'newest') {
			return new Date(right.published_at).getTime() - new Date(left.published_at).getTime();
		}
		if (sortMode === 'views') {
			return (right.metrics.views ?? -1) - (left.metrics.views ?? -1);
		}
		return right.engagement - left.engagement;
	});
}

export function selectedAnalyticsSummary(
	overview: AnalyticsOverview,
	account: AnalyticsAccount | undefined,
	publications: AnalyticsPublication[]
) {
	if (!account) return overview.summary;
	const renditions = publications.flatMap((publication) => publication.renditions ?? []);
	const followers: MetricSummary =
		'followers' in account.metrics
			? { value: account.metrics.followers, delta: account.follower_delta, measured: 1 }
			: { value: 0, measured: 0 };
	return {
		followers,
		engagement: summarizeEngagement(renditions),
		views: summarizeMetric(renditions, 'views'),
		impressions: summarizeMetric(renditions, 'impressions'),
		reach: summarizeMetric(renditions, 'reach'),
		published: publications.length
	};
}

function summarizeMetric(renditions: AnalyticsContent[], key: string): MetricSummary {
	const measured = renditions.filter((rendition) => key in rendition.metrics);
	return {
		value: measured.reduce((total, rendition) => total + (rendition.metrics[key] ?? 0), 0),
		measured: measured.length
	};
}

function summarizeEngagement(renditions: AnalyticsContent[]): MetricSummary {
	const measured = renditions.filter(hasEngagementMeasurement);
	return {
		value: measured.reduce((total, rendition) => total + rendition.engagement, 0),
		measured: measured.length
	};
}

function filterPublication(
	publication: AnalyticsPublication,
	accountID: string
): AnalyticsPublication | null {
	if (accountID === 'all') return publication;
	const renditions = (publication.renditions ?? []).filter(
		(rendition) => rendition.account_id === accountID
	);
	if (renditions.length === 0) return null;
	const metrics: Record<string, number> = {};
	const measured: Record<string, number> = {};
	let engagement = 0;
	let engagementMeasured = 0;
	for (const rendition of renditions) {
		for (const [key, value] of Object.entries(rendition.metrics)) {
			metrics[key] = (metrics[key] ?? 0) + value;
			measured[key] = (measured[key] ?? 0) + 1;
		}
		if (hasEngagementMeasurement(rendition)) {
			engagement += rendition.engagement;
			engagementMeasured++;
		}
	}
	return {
		...publication,
		renditions,
		metrics,
		measured,
		engagement,
		engagement_measured: engagementMeasured
	};
}
