import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import { analyticsMetricLabel } from './analytics-metric-label';

afterEach(() => setLocale('en', { reload: false }));

describe('analyticsMetricLabel', () => {
	it('localizes normalized metrics in a non-English locale', () => {
		setLocale('pt', { reload: false });
		// One representative per provider proves the locale path; exact copy
		// for every metric belongs to translators, not this suite.
		expect(analyticsMetricLabel('pin_clicks')).toBe('Cliques no Pin');
		expect(analyticsMetricLabel('reactions')).toBe('Reações');
	});

	it('reserves readable fallback labels for extension metrics', () => {
		expect(analyticsMetricLabel('provider_extension_metric')).toBe('provider extension metric');
	});
});
