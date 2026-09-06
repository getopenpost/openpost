import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AnalyticsPerformanceChart from './analytics-performance-chart.svelte';

describe('AnalyticsPerformanceChart', () => {
	it('uses one stable theme series per platform instead of graying most posts', async () => {
		const screen = await render(AnalyticsPerformanceChart, {
			props: {
				points: [
					{
						date: '2026-09-04',
						value: 42,
						items: [
							{ key: 'x-1', label: 'First X post', platform: 'x', value: 12 },
							{ key: 'x-2', label: 'Second X post', platform: 'x', value: 10 },
							{ key: 'youtube-1', label: 'First video', platform: 'youtube', value: 8 },
							{ key: 'youtube-2', label: 'Second video', platform: 'youtube', value: 7 },
							{ key: 'threads-1', label: 'Thread', platform: 'threads', value: 5 }
						]
					}
				],
				metric: 'engagement',
				label: 'Daily engagement',
				emptyLabel: 'No engagement',
				otherLabel: 'Other',
				formatValue: (value: number) => String(value),
				formatDate: (value: string) => value
			}
		});

		const fills = screen
			.getByRole('img', { name: 'Daily engagement' })
			.element()
			.querySelectorAll<SVGRectElement>('rect[fill^="var(--analytics-series-"]');
		const byPlatform = {
			x: [fills[0]?.getAttribute('fill'), fills[1]?.getAttribute('fill')],
			youtube: [fills[2]?.getAttribute('fill'), fills[3]?.getAttribute('fill')],
			threads: fills[4]?.getAttribute('fill')
		};

		expect(byPlatform.x[0]).toBe(byPlatform.x[1]);
		expect(byPlatform.youtube[0]).toBe(byPlatform.youtube[1]);
		expect(new Set([byPlatform.x[0], byPlatform.youtube[0], byPlatform.threads]).size).toBe(3);
		expect([...fills].some((rect) => rect.getAttribute('fill')?.endsWith('-other)'))).toBe(false);
	});
});
