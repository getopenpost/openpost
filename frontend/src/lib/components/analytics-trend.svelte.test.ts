import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AnalyticsTrend from './analytics-trend.svelte';

describe('analytics trend', () => {
	it('renders through the shared shadcn chart container and keeps an accessible table', async () => {
		const screen = await render(AnalyticsTrend, {
			points: [
				{ date: '2026-07-25', value: 1200 },
				{ date: '2026-07-26', value: 1250 },
				{ date: '2026-07-27', value: 1300 }
			],
			label: 'Follower trend',
			emptyLabel: 'No trend data',
			formatValue: (value: number) => value.toLocaleString('en-US')
		});

		await expect.element(screen.getByRole('img', { name: 'Follower trend' })).toBeInTheDocument();
		expect(screen.container.querySelector('[data-slot="chart"]')).not.toBeNull();
		await expect.element(screen.getByRole('table', { name: 'Follower trend' })).toBeInTheDocument();
		await expect.element(screen.getByRole('cell', { name: '1,300' })).toBeInTheDocument();
	});

	it('shows the supplied empty state when fewer than two measurements exist', async () => {
		const screen = await render(AnalyticsTrend, {
			points: [{ date: '2026-07-27', value: 1300 }],
			label: 'Follower trend',
			emptyLabel: 'No trend data',
			formatValue: String
		});

		await expect.element(screen.getByText('No trend data')).toBeVisible();
		expect(screen.container.querySelector('[data-slot="chart"]')).toBeNull();
	});
});
