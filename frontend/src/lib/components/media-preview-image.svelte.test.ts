import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { setToken } from '$lib/api/client';
import MediaPreviewImage from './media-preview-image.svelte';

describe('media preview image', () => {
	afterEach(() => setToken(null));

	it('falls back to the original media when a thumbnail is unavailable', async () => {
		setToken('preview-token');
		const screen = await render(MediaPreviewImage, {
			mediaId: 'brand-logo',
			alt: 'Brand logo'
		});
		const image = screen.getByRole('img', { name: 'Brand logo' });

		expect((image.element() as HTMLImageElement).src).toContain(
			'/media/brand-logo/thumb/md?token=preview-token'
		);
		image.element().dispatchEvent(new Event('error'));
		expect((image.element() as HTMLImageElement).src).toContain(
			'/media/brand-logo?token=preview-token'
		);
		expect((image.element() as HTMLImageElement).src).not.toContain('/thumb/');
	});
});
