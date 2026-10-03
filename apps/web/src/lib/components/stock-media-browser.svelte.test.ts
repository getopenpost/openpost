import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny';
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

	it('previews a stock video before import and dismisses it without resolving or selecting the asset', async () => {
		const onSelect = vi.fn();
		const previewURL = await movingVideoURL();
		const asset = {
			provider: 'pexels',
			external_id: 'video:own-fixture',
			kind: 'video',
			title: 'Own moving scene',
			width: 128,
			height: 72,
			duration_seconds: 2,
			thumbnail_url: '',
			preview_url: previewURL,
			source_url: 'https://example.com/own-video',
			creator_name: 'Own author',
			creator_url: 'https://example.com/own-author',
			provider_url: 'https://example.com',
			attribution_text: 'Own author',
			license_name: 'Own licence',
			license_url: 'https://example.com/licence'
		};
		mocks.listProviders.mockResolvedValue([
			{
				key: 'pexels',
				name: 'Pexels',
				photos: true,
				videos: true,
				audio: false,
				provider_url: 'https://example.com',
				attribution: 'Own author'
			}
		]);
		mocks.search.mockResolvedValue({
			items: [asset, { ...asset, external_id: 'video:second', title: 'Own second scene' }],
			page: 1,
			per_page: 24,
			total: 1,
			has_more: false,
			provider: 'pexels',
			provider_url: 'https://example.com'
		});
		const screen = await render(StockMediaBrowser, { accept: 'video', onSelect, services: mocks });
		await screen.getByRole('textbox', { name: 'Search stock media' }).fill('Own scene');
		await screen.getByRole('button', { name: 'Search', exact: true }).click();
		const preview = screen.getByRole('button', { name: 'Preview', exact: true }).first();
		await expect.element(preview).toBeVisible();
		expect(document.querySelector('video')).toBeNull();
		preview.element().focus();
		await userEvent.keyboard('{Enter}');
		await expect
			.poll(() => document.querySelector('video')?.getAttribute('src'))
			.toBe(asset.preview_url);
		expect(document.querySelector('video')?.controls).toBe(true);
		expect(document.querySelector('video')?.autoplay).toBe(false);
		const video = document.querySelector('video')!;
		await expect.poll(() => video.readyState).toBeGreaterThanOrEqual(2);
		expect(video.paused).toBe(true);
		await video.play();
		await expect.poll(() => video.currentTime).toBeGreaterThan(0.1);
		video.pause();
		video.currentTime = 1.25;
		await expect.poll(() => video.seeking).toBe(false);
		const canvas = document.createElement('canvas');
		canvas.width = 128;
		canvas.height = 72;
		const context = canvas.getContext('2d')!;
		await expect
			.poll(() => {
				context.drawImage(video, 0, 0);
				const pixel = context.getImageData(64, 36, 1, 1).data;
				return pixel[0] <= 2 && pixel[2] >= 253 && pixel[3] === 255;
			})
			.toBe(true);
		await expect
			.element(screen.getByRole('link', { name: 'View source', exact: true }).first())
			.toHaveAttribute('href', asset.source_url);
		await expect
			.element(screen.getByRole('link', { name: 'by Own author' }).first())
			.toHaveAttribute('href', asset.creator_url);
		video.focus();
		await userEvent.keyboard('{Escape}');
		await expect.poll(() => document.querySelector('video')).toBeNull();
		expect(document.activeElement).toBe(preview.element());
		expect(mocks.resolve).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
		expect(video.paused).toBe(true);
		await preview.click();
		const nextVideo = document.querySelector('video')!;
		await nextVideo.play();
		await screen.getByRole('button', { name: 'Preview', exact: true }).click();
		expect(document.querySelectorAll('video')).toHaveLength(1);
		expect(nextVideo.paused).toBe(true);
		const secondVideo = document.querySelector('video')!;
		expect(secondVideo).not.toBe(nextVideo);
		await secondVideo.play();
		await screen.getByRole('button', { name: 'Search', exact: true }).click();
		await expect.poll(() => document.querySelector('video')).toBeNull();
		expect(secondVideo.paused).toBe(true);
		const searchInput = screen.getByRole('textbox', { name: 'Search stock media' });
		searchInput.element().focus();
		await expect.element(searchInput).toHaveFocus();
	});

	it('offers the clip source when no playable preview exists and leaves photo import unchanged', async () => {
		const onSelect = vi.fn();
		const asset = {
			provider: 'pexels',
			external_id: 'video:own-fixture',
			kind: 'video',
			title: 'Own unavailable preview',
			width: 16,
			height: 16,
			thumbnail_url: '',
			source_url: 'https://example.com/own-video',
			creator_name: 'Own author',
			creator_url: 'https://example.com/own-author',
			provider_url: 'https://example.com',
			attribution_text: 'Own author',
			license_name: 'Own licence',
			license_url: 'https://example.com/licence'
		};
		mocks.search.mockResolvedValue({
			items: [asset],
			page: 1,
			per_page: 24,
			total: 1,
			has_more: false,
			provider: 'pexels',
			provider_url: 'https://example.com'
		});
		const screen = await render(StockMediaBrowser, { accept: 'both', onSelect, services: mocks });
		await screen.getByRole('button', { name: 'Type', exact: true }).click();
		await screen.getByRole('option', { name: 'Videos', exact: true }).click();
		await screen.getByRole('textbox', { name: 'Search stock media' }).fill('Own scene');
		await screen.getByRole('button', { name: 'Search', exact: true }).click();
		await expect
			.element(screen.getByRole('link', { name: 'View source', exact: true }))
			.toHaveAttribute('href', asset.source_url);
		await expect
			.element(screen.getByRole('button', { name: 'Preview', exact: true }))
			.not.toBeInTheDocument();
		expect(mocks.resolve).not.toHaveBeenCalled();
		expect(document.querySelector('video')).toBeNull();
		const photo = { ...asset, external_id: 'photo:own-fixture', kind: 'photo', title: 'Own photo' };
		mocks.search.mockResolvedValue({
			items: [photo],
			page: 1,
			per_page: 24,
			total: 1,
			has_more: false,
			provider: 'pexels',
			provider_url: 'https://example.com'
		});
		const canvas = document.createElement('canvas');
		canvas.width = 16;
		canvas.height = 16;
		const blob = await new Promise<Blob>((resolve) =>
			canvas.toBlob((value) => {
				if (!value) throw new Error('Missing photo fixture');
				resolve(value);
			}, 'image/png')
		);
		const url = URL.createObjectURL(blob);
		urls.push(url);
		mocks.resolve.mockResolvedValue({ ...photo, download_url: url, mime_type: 'image/png' });
		await screen.getByRole('button', { name: 'Type', exact: true }).click();
		await screen.getByRole('option', { name: 'Photos', exact: true }).click();
		await screen.getByRole('button', { name: 'Search', exact: true }).click();
		await expect.element(screen.getByText('Own photo', { exact: true })).toBeVisible();
		await expect
			.element(screen.getByRole('button', { name: 'Preview', exact: true }))
			.not.toBeInTheDocument();
		await screen.getByRole('button', { name: 'Use', exact: true }).click();
		await expect.poll(() => onSelect.mock.calls.length).toBe(1);
		expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('pexels', 'photo:own-fixture');
		const [file, selected] = onSelect.mock.calls[0];
		expect(file).toBeInstanceOf(File);
		expect(file.name).toBe('pexels-photo-own-fixture.png');
		expect(file.type).toBe('image/png');
		expect(selected).toEqual(photo);
		const image = await createImageBitmap(file);
		expect([image.width, image.height]).toEqual([16, 16]);
		image.close();
	});
});

const urls: string[] = [];
afterEach(() => {
	for (const url of urls.splice(0)) URL.revokeObjectURL(url);
});
async function movingVideoURL(): Promise<string> {
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 72;
	const context = canvas.getContext('2d')!;
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 200_000 });
	output.addVideoTrack(source);
	await output.start();
	for (let frame = 0; frame < 16; frame++) {
		context.fillStyle = frame < 8 ? 'red' : 'blue';
		context.fillRect(0, 0, 128, 72);
		await source.add(frame / 8, 1 / 8);
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Missing own preview fixture bytes.');
	const url = URL.createObjectURL(new Blob([target.buffer], { type: 'video/mp4' }));
	urls.push(url);
	return url;
}
