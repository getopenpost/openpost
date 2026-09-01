import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import { analyticsMetricLabel } from './analytics-metric-label';

afterEach(() => setLocale('en', { reload: false }));

describe('analyticsMetricLabel', () => {
	it('localizes every normalized Pinterest and Telegram metric in a non-English locale', () => {
		setLocale('pt', { reload: false });
		expect(
			[
				'engagements',
				'pin_clicks',
				'outbound_clicks',
				'video_views',
				'click_rate',
				'reactions'
			].map(analyticsMetricLabel)
		).toEqual([
			'Interações',
			'Cliques no Pin',
			'Cliques de saída',
			'Visualizações do vídeo',
			'Taxa de cliques',
			'Reações'
		]);
	});

	it('reserves readable fallback labels for extension metrics', () => {
		expect(analyticsMetricLabel('provider_extension_metric')).toBe('provider extension metric');
	});
});
