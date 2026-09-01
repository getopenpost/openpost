import { describe, expect, it } from 'vitest';

import type { components } from '$lib/api/types';

import {
	analyticsSourceLabelKey,
	appendAnalyticsContentPage,
	hasEngagementMeasurement,
	hasLimitedAccountHistory,
	insightHasRanking,
	isBuildingAccountHistory,
	measuredMetricKeys
} from './analytics-overview';

type AnalyticsContent = components['schemas']['ContentOverview'];
type AnalyticsInsight = components['schemas']['Insight'];
type AnalyticsOverview = components['schemas']['Overview'];

function externalContent(id: string): AnalyticsContent {
	return {
		account_id: 'account-1',
		content_profile: 'short_text',
		engagement: 1,
		excerpt: id,
		measurements: {},
		metric_availability: 'available',
		metric_metadata: {},
		metrics: { likes: 1 },
		platform: 'x',
		published_at: '2026-08-31T12:00:00Z',
		reference: { type: 'external', account_content_id: id },
		source: 'external',
		stale: false,
		status: 'ok',
		title: id,
		username: '@account'
	};
}

function engagementInsight(value: number): AnalyticsInsight {
	return {
		comparison_sample: 2,
		kind: 'most_engagement_actions',
		measured_count: 2,
		metric: 'engagement_actions',
		period: {
			aggregation: 'lifetime_total',
			filter_start: '2026-08-01T00:00:00Z',
			filter_end: '2026-08-31T00:00:00Z'
		},
		status: 'available',
		value
	};
}

function overview(content: AnalyticsContent[], insightValue: number): AnalyticsOverview {
	const measured = { value: 1, measured: 1 };
	return {
		generated_at: '2026-08-31T12:00:00Z',
		range_days: 30,
		source: 'all',
		account_growth_scope: 'account_wide',
		accounts: [],
		coverage: [],
		follower_series: [],
		trends: { followers: [], engagement: [], views: [] },
		publications: [],
		publication_total: 0,
		content,
		content_total: 2,
		insights: [engagementInsight(insightValue)],
		summary: {
			followers: measured,
			engagement: measured,
			views: measured,
			impressions: measured,
			reach: measured,
			follower_scope: 'account_wide',
			published: 2
		}
	};
}

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

	it('does not let a later content page replace server-owned insights or aggregates', () => {
		const current = overview([externalContent('first')], 12);
		current.content_next_cursor = 'next';
		const nextPage = overview([externalContent('second')], 999);
		nextPage.summary.published = 999;

		const merged = appendAnalyticsContentPage(current, nextPage);

		expect(merged.content).toHaveLength(2);
		expect(merged.content_next_cursor).toBeUndefined();
		expect(merged.insights).toEqual([engagementInsight(12)]);
		expect(merged.summary.published).toBe(2);
	});

	it('distinguishes building, capped partial, and unsupported account history', () => {
		expect(
			isBuildingAccountHistory({
				account_id: 'account-1',
				platform: 'youtube',
				status: 'partial',
				initial_items_discovered: 40
			})
		).toBe(true);
		expect(
			isBuildingAccountHistory({
				account_id: 'account-1',
				platform: 'youtube',
				status: 'partial',
				initial_items_discovered: 250,
				initial_completed_at: '2026-08-31T12:00:00Z',
				description: 'Initial discovery stopped after the 250-item account history limit.'
			})
		).toBe(false);
		expect(
			hasLimitedAccountHistory({
				account_id: 'account-1',
				platform: 'youtube',
				status: 'partial',
				initial_items_discovered: 250,
				initial_completed_at: '2026-08-31T12:00:00Z'
			})
		).toBe(true);
		expect(
			hasLimitedAccountHistory({
				account_id: 'account-2',
				platform: 'discord',
				status: 'unsupported',
				initial_items_discovered: 0
			})
		).toBe(true);
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
