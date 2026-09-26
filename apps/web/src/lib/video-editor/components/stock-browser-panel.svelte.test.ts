import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import StockBrowserPanel from './stock-browser-panel.svelte';

it('exposes the stock browser as a named group', async () => {
	const screen = await render(StockBrowserPanel, {
		projectId: 'project-1',
		oninserted: vi.fn(),
		services: {
			// SAFETY: a single stubbed provider renders the search form without network access.
			listProviders: async () => [
				{
					key: 'pexels',
					name: 'Pexels',
					attribution: '',
					audio: false,
					photos: true,
					videos: true,
					provider_url: 'https://example.com'
				}
			],
			search: vi.fn(),
			resolve: vi.fn()
		}
	});

	const group = screen.getByRole('group', { name: m.video_editor_stock_assets() });
	await expect.element(group).toBeVisible();
	await expect.element(group.getByRole('textbox', { name: m.stock_media_search() })).toBeVisible();
});
