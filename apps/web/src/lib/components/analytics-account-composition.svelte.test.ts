import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import AnalyticsAccountComposition from './analytics-account-composition.svelte';
import '../../routes/layout.css';

function account(
	id: string,
	followers?: number,
	avatar_url = ''
): components['schemas']['AccountOverview'] {
	return {
		id,
		username: id,
		platform: 'x',
		avatar_url,
		metrics: followers === undefined ? {} : { followers },
		metric_metadata: {},
		account_supported: true,
		content_supported: true,
		follower_series: null,
		missing_account_scopes: null,
		missing_content_scopes: null,
		stale: false,
		status: 'ready'
	};
}

describe('AnalyticsAccountComposition', () => {
	it('shows follower totals and named accounts, grouping the remaining audience', async () => {
		const screen = render(AnalyticsAccountComposition, {
			accounts: [
				account('Launch', 40, 'https://example.com/launch.png'),
				account('Journal', 30),
				account('Notes', 20),
				account('Studio', 5),
				account('Archive', 3),
				account('Lab', 2),
				account('Unavailable')
			],
			formatValue: String,
			accountLabel: (value) => value.username
		});
		const group = screen.getByRole('group', { name: 'Audience by account' });
		const chart = group.getByTestId('analytics-composition-chart');
		await expect.element(chart).toBeVisible();
		await expect.element(chart.getByText('100', { exact: true })).toBeVisible();
		const legend = [...chart.element().querySelectorAll('[aria-pressed]')];
		const cells = (row: Element) => {
			const spans = [...row.children];
			const label = row.querySelector('.truncate') ?? spans[1];
			return [
				label?.textContent?.trim(),
				spans.at(-2)?.textContent?.trim(),
				spans.at(-1)?.textContent?.trim()
			];
		};
		expect(legend.map(cells)).toEqual([
			['Launch', '40', '40%'],
			['Journal', '30', '30%'],
			['Notes', '20', '20%'],
			['Studio', '5', '5%'],
			['Other accounts', '5', '5%']
		]);
		expect(legend[0]?.querySelector('img[src="https://example.com/launch.png"]')).not.toBeNull();
		expect(legend[4]?.querySelector('img')).toBeNull();
	});

	it('explains an empty audience without fabricating chart values', async () => {
		const screen = render(AnalyticsAccountComposition, {
			accounts: [account('New account', 0), account('Unavailable')],
			formatValue: String,
			accountLabel: (value) => value.username
		});
		await expect.element(screen.getByText('No audience to display yet.')).toBeVisible();
		expect(screen.getByRole('group').element().querySelector('svg')).toBeNull();
	});
});
