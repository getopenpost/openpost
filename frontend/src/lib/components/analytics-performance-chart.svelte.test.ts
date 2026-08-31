import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AnalyticsPerformanceChart from './analytics-performance-chart.svelte';

describe('analytics performance chart', () => {
	it('exposes the daily total and the post and platform breakdown on focus', async () => {
		const screen = await render(AnalyticsPerformanceChart, {
			points: [
				{
					date: '2026-08-29',
					value: 75,
					items: [
						{
							key: 'rendition-1',
							label: 'Launch notes',
							platform: 'linkedin',
							publication_id: 'publication-1',
							value: 75
						}
					]
				}
			],
			metric: 'views',
			label: 'Daily views',
			emptyLabel: 'No daily views',
			otherLabel: 'Other posts',
			formatValue: String,
			formatDate: (value: string) => `Date ${value}`
		});

		const day = screen.getByRole('button', { name: 'Date 2026-08-29, 75 Daily views' });
		await day.click();

		await expect.element(screen.getByText('Launch notes')).toBeVisible();
		await expect
			.element(screen.getByTestId('analytics-tooltip-platform'))
			.toHaveTextContent('Linkedin');
		await expect.element(screen.getByRole('table', { name: 'Daily views' })).toBeInTheDocument();
	});

	it('shows the supplied empty state when no daily changes are available', async () => {
		const screen = await render(AnalyticsPerformanceChart, {
			points: [],
			metric: 'followers',
			label: 'Daily follower change',
			emptyLabel: 'No daily changes',
			otherLabel: 'Other accounts',
			formatValue: String,
			formatDate: String
		});

		await expect.element(screen.getByText('No daily changes')).toBeVisible();
	});

	it('fills the available width when the series does not need horizontal scrolling', async () => {
		const screen = await render(AnalyticsPerformanceChart, {
			points: [
				{
					date: '2026-08-29',
					value: 75,
					items: [
						{
							key: 'rendition-1',
							label: 'Launch notes',
							platform: 'linkedin',
							publication_id: 'publication-1',
							value: 75
						}
					]
				}
			],
			metric: 'views',
			label: 'Daily views',
			emptyLabel: 'No daily views',
			otherLabel: 'Other posts',
			formatValue: String,
			formatDate: String
		});
		screen.container.style.width = '960px';
		const scroll = screen.getByTestId('analytics-chart-scroll').element();
		const canvas = scroll.firstElementChild;
		if (!(canvas instanceof HTMLElement)) throw new Error('Expected an analytics chart canvas');

		await expect
			.poll(() => canvas.getBoundingClientRect().right)
			.toBeGreaterThanOrEqual(scroll.getBoundingClientRect().right - 1);
	});

	it('formats follower breakdowns as provider-aware account identities', async () => {
		const screen = await render(AnalyticsPerformanceChart, {
			points: [
				{
					date: '2026-08-30',
					value: 12,
					items: [
						{
							key: 'account-1',
							label: 'openpost.bsky.social',
							platform: 'bluesky',
							value: 12
						}
					]
				}
			],
			metric: 'followers',
			label: 'Daily follower change',
			emptyLabel: 'No daily changes',
			otherLabel: 'Other accounts',
			formatValue: String,
			formatDate: (value: string) => `Date ${value}`
		});

		await screen.getByRole('button', { name: 'Date 2026-08-30, 12 Daily follower change' }).click();

		await expect.element(screen.getByText('@openpost.bsky.social')).toBeVisible();
	});
});
