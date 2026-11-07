import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import AnalyticsPerformanceChart from './analytics-performance-chart.svelte';
import '../../routes/layout.css';

const base = {
	label: 'Daily engagement',
	emptyLabel: 'No engagement',
	otherLabel: 'Other networks',
	formatValue: (value: number) => String(value),
	formatDate: (value: string) => value
};

/** The accessible data table every chart renders: header cells, then one row per day. */
function table(root: Element) {
	const rows = [...root.querySelectorAll('table tr')].map((row) =>
		[...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.trim() ?? '')
	);
	return { header: rows[0] ?? [], body: rows.slice(1) };
}

describe('AnalyticsPerformanceChart', () => {
	it('sums posts into one series per network and groups the rest as other networks', async () => {
		const item = (key: string, platform: string, value: number) => ({
			key,
			label: key,
			platform,
			value
		});
		const screen = render(AnalyticsPerformanceChart, {
			...base,
			metric: 'engagement',
			points: [
				{
					date: '2026-09-04',
					value: 0,
					items: [
						item('x-1', 'x', 12),
						item('x-2', 'x', 10),
						item('yt-1', 'youtube', 8),
						item('yt-2', 'youtube', 7),
						item('threads-1', 'threads', 5),
						item('bsky-1', 'bluesky', 4),
						item('masto-1', 'mastodon', 3),
						item('li-1', 'linkedin', 2)
					]
				},
				{ date: '2026-09-05', value: 0, items: [item('x-3', 'x', 6), item('li-2', 'linkedin', 9)] }
			]
		});
		const figure = screen.getByTestId('analytics-performance-chart');
		await expect.element(figure.getByRole('group', { name: 'Daily engagement' })).toBeVisible();
		const { header, body } = table(figure.element());
		// Ranked by period total (x 28, youtube 15, linkedin 11, threads 5); bluesky and mastodon become Other.
		expect(header).toEqual(['Category', 'X', 'YouTube', 'LinkedIn', 'Threads', 'Other networks']);
		expect(body).toEqual([
			['2026-09-04', '22', '15', '2', '5', '7'],
			['2026-09-05', '6', '0', '9', '0', '0']
		]);

		await userEvent.keyboard('{Tab}');
		await expect.element(figure.getByRole('group', { name: 'Daily engagement' })).toHaveFocus();
		await userEvent.keyboard('{Home}');
		await expect
			.element(
				figure.getByText('2026-09-04: X 22, YouTube 15, LinkedIn 2, Threads 5, Other networks 7')
			)
			.toBeInTheDocument();
	});

	it('draws account-wide follower totals for the followers metric', async () => {
		const screen = render(AnalyticsPerformanceChart, {
			...base,
			label: 'Followers over time',
			metric: 'followers',
			points: [],
			followerSeries: [
				{ date: '2026-09-01', value: 120 },
				{ date: '2026-09-02', value: 118 },
				{ date: '2026-09-03', value: 131 }
			]
		});
		const figure = screen.getByTestId('analytics-performance-chart');
		await expect.element(figure.getByRole('group', { name: 'Followers over time' })).toBeVisible();
		expect(table(figure.element()).body).toEqual([
			['2026-09-01', '120'],
			['2026-09-02', '118'],
			['2026-09-03', '131']
		]);
	});

	it('says so instead of drawing an empty chart', async () => {
		const screen = render(AnalyticsPerformanceChart, {
			...base,
			metric: 'followers',
			points: [],
			followerSeries: [{ date: '2026-09-01', value: 120 }]
		});
		await expect.element(screen.getByText('No engagement')).toBeVisible();
		expect(
			screen.getByTestId('analytics-performance-chart').element().querySelector('svg')
		).toBeNull();
	});
});
