import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { components } from '$lib/api/types';
import AnalyticsPostHighlights from './analytics-post-highlights.svelte';
import AnalyticsDateRange from './analytics-date-range.svelte';
import AnalyticsNextActions from './analytics-next-actions.svelte';
import AnalyticsAccountPerformance from './analytics-account-performance.svelte';
import '../../routes/layout.css';

const reference = {
	type: 'openpost',
	publication_id: 'best-publication',
	rendition_id: 'best-output'
} as const;
const actions: components['schemas']['Takeaway'][] = [
	{
		kind: 'repurpose_post',
		account_id: 'account',
		platform: 'linkedin',
		username: 'Founder',
		reference,
		value: 40,
		baseline: 10,
		measured_count: 4,
		comparison_sample: 4,
		reason: 'above_baseline',
		title: 'Launch lessons that earned attention'
	},
	{
		kind: 'restore_measurements',
		account_id: 'broken',
		platform: 'instagram',
		username: 'Needs connection',
		value: 0,
		measured_count: 0,
		comparison_sample: 0,
		reason: 'permission_required'
	}
];
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
				const onrepurpose = vi.fn();
				const onselect = vi.fn();
				const next = render(AnalyticsNextActions, {
					items: actions,
					canEdit: true,
					onrepurpose,
					formatValue: String
				});
				const accounts = render(AnalyticsAccountPerformance, {
					items: performance,
					onselect,
					formatValue: String
				});
				await expect
					.element(
						next.getByText(
							'40 engagement actions, compared with 10 for this account across 4 comparable outputs.'
						)
					)
					.toBeVisible();
				const repurpose = next.getByRole('button', { name: 'Repurpose', exact: true });
				repurpose.element().focus();
				await userEvent.keyboard('{Enter}');
				expect(onrepurpose).toHaveBeenCalledExactlyOnceWith(reference);
				if (width < 1024) {
					expect(next.getByRole('link', { name: 'Open account details' }).query()).toBeNull();
					const disclosure = next.getByText('More actions', { exact: true }).element();
					disclosure.focus();
					await userEvent.keyboard('{Enter}');
				}
				await expect
					.element(next.getByRole('link', { name: 'Open account details' }))
					.toHaveAttribute('href', '/settings?tab=accounts');
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
					'[data-testid="analytics-takeaway"], [data-testid="analytics-account-performance"]'
				)) {
					expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(width);
				}
				if (matchMedia('(pointer: coarse)').matches) {
					for (const button of document.querySelectorAll('button, a[role="button"]'))
						expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
				}
				if (width < 1024) {
					next.getByText('More actions', { exact: true }).element().focus();
					await userEvent.keyboard('{Enter}');
				}
				await page.screenshot({
					path: `__screenshots__/actionable-analytics-${width}-${dark ? 'dark' : 'light'}.png`
				});
				await next.unmount();
				await accounts.unmount();
				document.documentElement.classList.remove('dark');
			});
		}
	it('shows an evidence empty state and disables an in-flight repurpose action', async () => {
		const empty = render(AnalyticsNextActions, {
			items: [],
			onrepurpose: vi.fn(),
			formatValue: String
		});
		await expect.element(empty.getByText(/No recommendations yet/)).toBeVisible();
		await empty.unmount();
		const busy = render(AnalyticsNextActions, {
			items: actions,
			canEdit: true,
			busy: true,
			onrepurpose: vi.fn(),
			formatValue: String
		});
		await expect
			.element(busy.getByRole('button', { name: 'Repurpose', exact: true }))
			.toBeDisabled();
		await busy.unmount();
	});
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
	it('keeps evidence visible for readers without offering an authoring action', async () => {
		const screen = render(AnalyticsNextActions, {
			items: actions.slice(0, 1),
			canEdit: false,
			onrepurpose: vi.fn(),
			formatValue: String
		});
		await expect.element(screen.getByText('Launch lessons that earned attention')).toBeVisible();
		expect(screen.getByRole('button', { name: 'Repurpose' }).query()).toBeNull();
		await screen.unmount();
	});
});
