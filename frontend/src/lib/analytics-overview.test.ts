import { describe, expect, it } from 'vitest';

import { hasEngagementMeasurement } from './analytics-overview';

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
});
