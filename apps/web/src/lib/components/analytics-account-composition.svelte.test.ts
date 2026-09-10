import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import { resolveBuiltInTheme, WebThemeRuntime } from '$lib/themes';
import AnalyticsAccountComposition from './analytics-account-composition.svelte';
import '../../routes/layout.css';

function account(id: string, followers?: number): components['schemas']['AccountOverview'] {
	return {
		id,
		username: id,
		platform: 'x',
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
	it('shows follower totals and named accounts, grouping the remaining audience without changing chart geometry between themes', async () => {
		const screen = render(AnalyticsAccountComposition, {
			accounts: [
				account('Launch', 40),
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
		const figure = screen.getByRole('figure', { name: 'Audience by account' }).element();
		if (!(figure instanceof HTMLElement)) throw new Error('Chart is unavailable');
		await expect.element(screen.getByText('100', { exact: true })).toBeVisible();
		const values = [...figure.querySelectorAll('dl > div')].map((row) => [
			row.querySelector('dt')?.textContent?.trim(),
			row.querySelector('dd')?.textContent?.trim()
		]);
		expect(values).toEqual([
			['X Launch', '40'],
			['X Journal', '30'],
			['X Notes', '20'],
			['X Studio', '5'],
			['Other accounts', '5']
		]);
		const rings = [...figure.querySelectorAll<SVGCircleElement>('[data-chart-ring]')];
		const geometry = () =>
			rings.map((ring) => ring.parentElement?.getAttribute('stroke-dasharray'));
		const original = geometry();
		const runtime = new WebThemeRuntime({
			stageFonts: async () => ({ release: () => undefined }),
			loadAssets: async () => undefined,
			loadIconPack: async () => undefined,
			setBrowserSurface: () => () => undefined
		});
		try {
			await runtime.apply(resolveBuiltInTheme('dither', 'light'), figure);
			expect(rings.map((ring) => getComputedStyle(ring).maskImage)).toEqual(Array(5).fill('none'));
			expect(geometry()).toEqual(original);
			expect(new Set(rings.map((ring) => getComputedStyle(ring).stroke)).size).toBe(5);
			await runtime.apply(resolveBuiltInTheme('workshop', 'dark'), figure);
			expect(geometry()).toEqual(original);
			await expect.element(screen.getByText('100', { exact: true })).toBeVisible();
		} finally {
			runtime.clear(figure);
		}
	});

	it('explains an empty audience without fabricating chart values', async () => {
		const screen = render(AnalyticsAccountComposition, {
			accounts: [account('New account', 0), account('Unavailable')],
			formatValue: String,
			accountLabel: (value) => value.username
		});
		await expect.element(screen.getByText('No audience to display yet.')).toBeVisible();
		expect(screen.getByRole('figure').element().querySelector('svg')).toBeNull();
	});
});
