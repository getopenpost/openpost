import { describe, expect, it } from 'vitest';
import { downloadStockAsset, MAX_STOCK_PHOTO_BYTES } from './stock-media';

const asset = {
	provider: 'pixabay',
	provider_url: 'https://pixabay.com',
	external_id: 'photo:12',
	kind: 'photo',
	title: 'Beach',
	creator_name: 'A',
	creator_url: 'https://example.com/a',
	source_url: 'https://example.com/photo',
	thumbnail_url: 'https://example.com/thumb.jpg',
	width: 100,
	height: 100,
	duration_seconds: 0,
	license_name: 'Pixabay Content License',
	license_url: 'https://pixabay.com/service/license-summary/',
	attribution_text: 'Image by A on Pixabay'
} as const;

const resolved = {
	...asset,
	download_url: 'https://cdn.example.com/photo.png',
	mime_type: 'image/png'
} as const;

describe('downloadStockAsset', () => {
	it('downloads through an anonymous request and keeps the provider identity', async () => {
		let init: RequestInit | undefined;
		const file = await downloadStockAsset(asset, resolved, async (_input, requestInit) => {
			init = requestInit;
			return new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { 'content-type': 'image/png', 'content-length': '3' }
			});
		});
		expect(init).toMatchObject({
			credentials: 'omit',
			referrerPolicy: 'no-referrer'
		});
		expect(file.name).toBe('pixabay-photo-12.png');
		expect(file.type).toBe('image/png');
		expect(file.size).toBe(3);
	});

	it('rejects a declared oversized image before reading its body', async () => {
		await expect(
			downloadStockAsset(
				asset,
				resolved,
				async () =>
					new Response(new Uint8Array([1]), {
						status: 200,
						headers: { 'content-length': String(MAX_STOCK_PHOTO_BYTES + 1) }
					})
			)
		).rejects.toMatchObject({ code: 'photo-too-large' });
	});

	it('maps network errors to a stable user-facing error code', async () => {
		await expect(
			downloadStockAsset(asset, resolved, async () => {
				throw new TypeError('offline');
			})
		).rejects.toMatchObject({ code: 'download-failed' });
	});
});
