import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import AnalyticsPostHighlights from './analytics-post-highlights.svelte';
import AnalyticsDateRange from './analytics-date-range.svelte';
import AnalyticsAccountPerformance from './analytics-account-performance.svelte';
import '../../routes/layout.css';

const reference = {
	type: 'openpost',
	publication_id: 'best-publication',
	rendition_id: 'best-output'
} as const;
const performance: components['schemas']['AccountPerformance'][] = [
	{
		account_id: 'outside-loaded-page',
		platform: 'youtube',
		username: 'Full-population leader',
		published: 140,
		publication_count: 100,
		visibility: { value: 9000, measured: 140 },
		engagement: { value: 40, measured: 140 },
		followers: 200,
		status: 'ok'
	},
	{
		account_id: 'zero',
		platform: 'linkedin',
		username: 'Measured zero',
		published: 1,
		publication_count: 1,
		visibility: { value: 0, measured: 1 },
		engagement: { value: 0, measured: 1 },
		status: 'ok'
	},
	{
		account_id: 'missing',
		platform: 'threads',
		username: 'Missing measurements',
		published: 2,
		publication_count: 1,
		visibility: { value: 0, measured: 0 },
		engagement: { value: 0, measured: 0 },
		status: 'unsupported'
	}
];

describe('Actionable analytics', () => {
	for (const width of [1280, 390, 320])
		for (const dark of [false, true]) {
			it(`keeps evidence and actions usable at ${width}px ${dark ? 'dark' : 'light'}`, async () => {
				await page.viewport(width, 1000);
				document.documentElement.classList.toggle('dark', dark);
				const onselect = vi.fn();
				const accounts = render(AnalyticsAccountPerformance, {
					items: performance,
					onselect,
					formatValue: String
				});
				await accounts.getByRole('button', { name: /Full-population leader/ }).click();
				expect(onselect).toHaveBeenCalledExactlyOnceWith('outside-loaded-page');
				const rows = [
					...document.querySelectorAll('[data-testid="analytics-account-performance"]')
				];
				expect(rows).toHaveLength(3);
				expect(rows[0].textContent).toContain('9000');
				expect(rows[1].querySelector('dd')?.textContent).toBe('0');
				expect(rows[2].querySelector('dd')?.textContent).toBe('—');
				for (const row of document.querySelectorAll(
					'[data-testid="analytics-account-performance"]'
				)) {
					expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(width);
				}
				if (matchMedia('(pointer: coarse)').matches) {
					for (const button of document.querySelectorAll('button, a[role="button"]'))
						expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
				}
				await page.screenshot({
					path: `__screenshots__/actionable-analytics-${width}-${dark ? 'dark' : 'light'}.png`
				});
				await accounts.unmount();
				document.documentElement.classList.remove('dark');
			});
		}
	it('uses server highlights with native links and the existing repurpose action', async () => {
		const item: components['schemas']['ContentOverview'] = {
			account_id: 'account',
			platform: 'youtube',
			username: 'Founder',
			title: 'A ranked post outside the current loaded page',
			excerpt: '',
			content_profile: 'video',
			engagement: 0,
			metrics: { views: 0, likes: 0 },
			measurements: {},
			metric_metadata: {},
			metric_availability: 'available',
			status: 'ok',
			stale: false,
			published_at: '2026-10-01T12:00:00Z',
			reference,
			external_url: 'https://youtube.com/watch?v=demo',
			visibility: { value: 0, metric: 'views', basis: 'video_views' }
		};
		const onrepurpose = vi.fn();
		const screen = render(AnalyticsPostHighlights, {
			items: [item],
			canEdit: true,
			onrepurpose,
			formatValue: String
		});
		await expect
			.element(screen.getByRole('link', { name: item.title }))
			.toHaveAttribute('href', '/publications/best-publication');
		await expect
			.element(screen.getByRole('link', { name: 'Open post on platform' }))
			.toHaveAttribute('href', item.external_url);
		await expect.element(screen.getByText('Visibility: 0 · Engagement: 0')).toBeVisible();
		await screen.getByRole('button', { name: 'Repurpose' }).click();
		expect(onrepurpose).toHaveBeenCalledExactlyOnceWith(item);
		await screen.unmount();
	});
	it('applies UTC month presets through the mounted date control', async () => {
		await page.viewport(390, 900);
		const onchange = vi.fn();
		const screen = render(AnalyticsDateRange, { days: 30, onchange });
		await screen.getByRole('button', { name: /Reporting window/ }).click();
		await page.getByRole('button', { name: 'Month to date', exact: true }).click();
		const now = new Date();
		expect(onchange).toHaveBeenCalledExactlyOnceWith(
			0,
			new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
			now.toISOString().slice(0, 10)
		);
		await screen.unmount();
	});
});
