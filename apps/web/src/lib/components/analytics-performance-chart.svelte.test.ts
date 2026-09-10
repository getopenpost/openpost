import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { resolveBuiltInTheme, WebThemeRuntime } from '$lib/themes';
import AnalyticsPerformanceChart from './analytics-performance-chart.svelte';
import '../../routes/layout.css';

function geometry(bar: SVGRectElement) {
	const { x, y, width, height } = bar.getBBox();
	return { x, y, width, height };
}

describe('AnalyticsPerformanceChart', () => {
	it('textures both signs without changing values, keyboard inspection, or the restored chart', async () => {
		const runtime = new WebThemeRuntime({
			stageFonts: async () => ({ release: () => undefined }),
			loadAssets: async () => undefined,
			loadIconPack: async () => undefined,
			setBrowserSurface: () => () => undefined
		});
		const screen = render(AnalyticsPerformanceChart, {
			points: [
				{
					date: '2026-09-10',
					value: 6,
					items: [
						{ key: 'gain', label: 'Gained followers', platform: 'x', value: 12 },
						{ key: 'loss', label: 'Lost followers', platform: 'youtube', value: -6 }
					]
				},
				{
					date: '2026-09-11',
					value: 3,
					items: [{ key: 'gain-2', label: 'Gained followers', platform: 'x', value: 3 }]
				}
			],
			metric: 'followers',
			label: 'Daily followers',
			emptyLabel: 'No followers',
			otherLabel: 'Other',
			formatValue: String,
			formatDate: (date: string) => date
		});
		const figure = screen.getByRole('figure', { name: 'Daily followers' }).element();
		if (!(figure instanceof HTMLElement)) throw new Error('Chart figure is unavailable');
		const bars = [...figure.querySelectorAll<SVGRectElement>('[data-chart-fill]')];
		const original = bars.map(geometry);
		try {
			await runtime.apply(resolveBuiltInTheme('dither', 'light'), figure);
			for (const [index, bar] of bars.entries()) {
				expect(getComputedStyle(bar).maskImage).toContain('data:image/svg+xml');
				expect(geometry(bar)).toEqual(original[index]);
			}
			expect(original[0].height / original[1].height).toBeCloseTo(2);
			expect(original[0].y + original[0].height).toBeCloseTo(original[1].y);
			const day = screen.getByRole('button', { name: '2026-09-10, 6 Daily followers' });
			const dayElement = day.element();
			if (!(dayElement instanceof SVGElement)) throw new Error('Chart day is unavailable');
			dayElement.focus();
			await userEvent.keyboard('{Enter}');
			await expect.element(screen.getByRole('status')).toHaveTextContent('+6');
			await expect.element(screen.getByRole('status')).toHaveTextContent('-6');
			await day.hover();
			const nextDay = screen.getByRole('button', { name: '2026-09-11, 3 Daily followers' });
			const nextDayElement = nextDay.element();
			if (!(nextDayElement instanceof SVGElement)) throw new Error('Chart day is unavailable');
			nextDayElement.focus();
			await expect.element(screen.getByRole('status')).toHaveTextContent('2026-09-11');
			await expect.element(nextDay).toHaveAttribute('data-chart-active', 'true');
			dayElement.focus();
			await expect.element(day).toHaveAttribute('data-chart-active', 'true');
			await userEvent.keyboard('{Escape}');
			await expect.element(screen.getByRole('status')).not.toBeInTheDocument();
			await userEvent.keyboard('{Enter}');
			await expect.element(screen.getByRole('status')).toHaveTextContent('+6');
			await runtime.apply(resolveBuiltInTheme('workshop', 'light'), figure);
			expect(bars.map((bar) => getComputedStyle(bar).maskImage)).toEqual(['none', 'none', 'none']);
			expect(bars.map(geometry)).toEqual(original);
		} finally {
			runtime.clear(figure);
		}
	});

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
