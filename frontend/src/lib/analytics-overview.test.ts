import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import { filterAnalyticsPublications, selectedAnalyticsSummary } from './analytics-overview';

type AnalyticsOverview = components['schemas']['Overview'];
type AnalyticsPublication = components['schemas']['PublicationOverview'];

function publication(): AnalyticsPublication {
	return {
		publication_id: 'publication-1',
		title: 'Launch',
		excerpt: '',
		published_at: '2026-07-26T12:00:00Z',
		metrics: { likes: 7, views: 100 },
		measured: { likes: 2, views: 1 },
		engagement: 7,
		engagement_measured: 2,
		renditions: [
			{
				publication_id: 'publication-1',
				rendition_id: 'rendition-a',
				title: 'Launch',
				excerpt: '',
				platform: 'x',
				account_id: 'account-a',
				username: 'alpha',
				published_at: '2026-07-26T12:00:00Z',
				status: 'ok',
				metrics: { likes: 7, views: 100 },
				engagement: 7,
				stale: false
			},
			{
				publication_id: 'publication-1',
				rendition_id: 'rendition-b',
				title: 'Launch',
				excerpt: '',
				platform: 'linkedin',
				account_id: 'account-b',
				username: 'beta',
				published_at: '2026-07-26T12:00:00Z',
				status: 'ok',
				metrics: {},
				engagement: 0,
				stale: false
			}
		]
	};
}

describe('analytics overview filtering', () => {
	it('filters every publication total to the selected account without inventing zeros', () => {
		const filtered = filterAnalyticsPublications([publication()], 'account-b', 'engagement');
		expect(filtered).toHaveLength(1);
		expect(filtered[0].renditions).toHaveLength(1);
		expect(filtered[0].metrics).toEqual({});
		expect(filtered[0].measured).toEqual({});
		expect(filtered[0].engagement_measured).toBe(0);

		const overview = {
			summary: {
				followers: { value: 10, measured: 1 },
				engagement: { value: 7, measured: 1 },
				views: { value: 100, measured: 1 },
				impressions: { value: 0, measured: 0 },
				reach: { value: 0, measured: 0 },
				published: 1
			}
		} as AnalyticsOverview;
		const summary = selectedAnalyticsSummary(
			overview,
			{ id: 'account-b', metrics: {}, follower_series: [] } as never,
			filtered
		);
		expect(summary.views.measured).toBe(0);
		expect(summary.engagement.measured).toBe(0);
	});
});
