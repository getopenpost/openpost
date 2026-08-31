import { describe, expect, it } from 'vitest';

import {
	analyticsSourceLabelKey,
	hasEngagementMeasurement,
	insightHasRanking,
	measuredMetricKeys
} from './analytics-overview';

describe('analytics overview helpers', () => {
	it('distinguishes an explicit zero measurement from a missing metric', () => {
		const base = {
			publication_id: 'publication-1',
			rendition_id: 'rendition-1',
			title: 'Launch',
			excerpt: 'Launch',
			platform: 'mastodon',
			account_id: 'account-1',
			username: '@launch',
			published_at: '2026-08-12T12:00:00Z',
			status: 'ok',
			engagement: 0,
			metrics: {},
			stale: false
		};
		expect(hasEngagementMeasurement(base)).toBe(false);
		expect(hasEngagementMeasurement({ ...base, metrics: { likes: 0 } })).toBe(true);
	});

	it('keeps missing report columns absent while preserving measured zero', () => {
		expect(
			measuredMetricKeys({ report_views: 0, average_view_percentage: 5050 }, [
				'report_views',
				'estimated_watch_time',
				'average_view_percentage',
				'report_shares'
			])
		).toEqual(['report_views', 'average_view_percentage']);
	});

	it('keeps managed and external source labels explicit', () => {
		expect(analyticsSourceLabelKey('openpost')).toBe('published_with_openpost');
		expect(analyticsSourceLabelKey('external')).toBe('published_elsewhere');
	});

	it('does not treat an insufficient low sample as a ranking', () => {
		const base = {
			kind: 'most_engagement_actions' as const,
			period: {
				filter_start: '2026-08-01T00:00:00Z',
				filter_end: '2026-08-31T00:00:00Z',
				aggregation: 'lifetime_total' as const
			},
			metric: 'engagement_actions',
			measured_count: 1,
			comparison_sample: 4
		};
		expect(
			insightHasRanking({
				...base,
				status: 'insufficient_data',
				reason: 'low_sample'
			})
		).toBe(false);
		expect(insightHasRanking({ ...base, status: 'available', value: 0 })).toBe(true);
	});
});
