import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StockMediaBrowser from './stock-media-browser.svelte';

const mocks = {
	listProviders: vi.fn(),
	search: vi.fn(),
	resolve: vi.fn()
};

describe('StockMediaBrowser', () => {
	beforeEach(() => {
		mocks.listProviders.mockReset();
		mocks.search.mockReset();
		mocks.resolve.mockReset();
		mocks.listProviders.mockResolvedValue([
			{
				key: 'pexels',
				name: 'Pexels',
				provider_url: 'https://www.pexels.com',
				photos: true,
				videos: true,
				audio: false,
				photo_filters: ['orientation', 'size', 'color', 'locale'],
				video_filters: ['orientation', 'size', 'locale'],
				attribution: 'Photos and videos provided by Pexels'
			},
			{
				key: 'unsplash',
				name: 'Unsplash',
				provider_url: 'https://unsplash.com',
				photos: true,
				videos: false,
				audio: false,
				photo_filters: ['orientation', 'color', 'order', 'content_filter', 'collections'],
				video_filters: [],
				attribution: 'Photos provided by Unsplash'
			}
		]);
	});

	it('shows each provider real media types and only its supported filters', async () => {
		const screen = await render(StockMediaBrowser, {
			accept: 'both',
			onSelect: vi.fn(),
			services: mocks
		});

		const provider = screen.getByRole('button', { name: 'Provider' });
		await expect.element(provider).toHaveTextContent('Pexels · Photos and videos');
		await screen.getByRole('button', { name: 'Filters' }).click();
		await expect.element(screen.getByText('Minimum size', { exact: true })).toBeVisible();
		await expect
			.element(screen.getByText('Content safety', { exact: true }))
			.not.toBeInTheDocument();

		await provider.click();
		await screen.getByRole('option', { name: 'Unsplash · Photos only' }).click();
		await expect.element(screen.getByText('Content safety', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Collection IDs', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Minimum size', { exact: true })).not.toBeInTheDocument();

		await screen.getByRole('button', { name: 'Type' }).click();
		await screen.getByRole('option', { name: 'Videos' }).click();
		await expect.element(provider).toHaveTextContent('Pexels · Photos and videos');
		await provider.click();
		await expect
			.element(screen.getByRole('option', { name: 'Unsplash · Photos only' }))
			.not.toBeInTheDocument();
	});

	it('shows one actionable error when provider discovery fails', async () => {
		mocks.listProviders.mockRejectedValueOnce(new Error('Stock media providers could not load.'));
		const screen = await render(StockMediaBrowser, {
			accept: 'both',
			onSelect: vi.fn(),
			services: mocks
		});

		await expect.element(screen.getByText('Stock media providers could not load.')).toBeVisible();
		await expect.element(screen.getByText('Stock media is unavailable')).not.toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
	});

	it('keeps compact editor panels focused on the search controls', async () => {
		const screen = await render(StockMediaBrowser, {
			accept: 'both',
			compact: true,
			onSelect: vi.fn(),
			services: mocks
		});

		await expect.element(screen.getByRole('textbox', { name: 'Search stock media' })).toBeVisible();
		await expect
			.element(screen.getByRole('heading', { name: 'Search stock media' }))
			.not.toBeInTheDocument();
		await expect
			.element(
				screen.getByText('Each provider shows only the media types and filters its API supports.')
			)
			.not.toBeInTheDocument();
	});
});
