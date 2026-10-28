import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import thumbFixture from '../../../../../assets/brand/pwa-192.png?url&no-inline';
import originalFixture from '../../../../../assets/brand/icon.svg?url&no-inline';
import MediaThumbnail from './media-thumbnail.svelte';

// Import the authored brand files so image loads settle without depending on
// generated static assets; each error transition below is driven by the test.
const THUMB_SRC = thumbFixture;
const ORIGINAL_SRC = originalFixture;

const imageItem = {
	mime_type: 'image/png',
	thumbnail_url: THUMB_SRC,
	poster_thumbnail_url: null,
	url: ORIGINAL_SRC,
	alt_text: 'The team after a successful release.',
	original_filename: 'team.png'
};

interface RoleScreen {
	getByRole(role: string, options?: { name?: string }): { element(): Element | null };
}

function imageElement(screen: RoleScreen, name: string): HTMLImageElement {
	const element = screen.getByRole('img', { name }).element();
	if (!(element instanceof HTMLImageElement)) throw new Error('Expected an image element.');
	return element;
}

describe('media thumbnail', () => {
	it('renders the thumbnail still with the authored alt text', async () => {
		const screen = await render(MediaThumbnail, {
			props: {
				item: imageItem,
				fallbackAlt: 'Media',
				class: 'size-full object-cover'
			}
		});

		await expect
			.element(screen.getByRole('img', { name: 'The team after a successful release.' }))
			.toBeVisible();
		const element = imageElement(screen, 'The team after a successful release.');
		expect(element.src).toContain(THUMB_SRC);
	});

	it('can render a larger still than the item thumbnail', async () => {
		const screen = await render(MediaThumbnail, {
			props: {
				item: imageItem,
				fallbackAlt: 'Media',
				still: '/assets/brand/pwa-512.png'
			}
		});

		const element = imageElement(screen, 'The team after a successful release.');
		expect(element.src).toContain('/assets/brand/pwa-512.png');
		expect(element.src).not.toContain(THUMB_SRC);

		element.dispatchEvent(new Event('error'));
		await tick();
		expect(element.src).toContain(THUMB_SRC);

		element.dispatchEvent(new Event('error'));
		await tick();
		expect(element.src).toContain(ORIGINAL_SRC);
	});

	it('falls back to the filename and then the caller label for alt text', async () => {
		const withoutAlt = await render(MediaThumbnail, {
			props: {
				item: { ...imageItem, alt_text: '' },
				fallbackAlt: 'Media'
			}
		});
		await expect.element(withoutAlt.getByRole('img', { name: 'team.png' })).toBeVisible();

		const withoutNames = await render(MediaThumbnail, {
			props: {
				item: { ...imageItem, alt_text: null, original_filename: null },
				fallbackAlt: 'Media'
			}
		});
		await expect.element(withoutNames.getByRole('img', { name: 'Media' })).toBeVisible();
	});

	it('retries the original once before reporting a missing thumbnail', async () => {
		const onMissing = vi.fn();
		const screen = await render(MediaThumbnail, {
			props: {
				item: imageItem,
				fallbackAlt: 'Media',
				onMissing
			}
		});

		const element = imageElement(screen, 'The team after a successful release.');
		expect(element.src).toContain(THUMB_SRC);

		element.dispatchEvent(new Event('error'));
		await tick();
		expect(element.src).toContain(ORIGINAL_SRC);
		expect(element.src).not.toContain('pwa-192');
		expect(onMissing).not.toHaveBeenCalled();

		element.dispatchEvent(new Event('error'));
		await tick();
		await expect.element(screen.getByRole('img')).not.toBeInTheDocument();
		await expect.element(screen.getByRole('presentation')).toBeVisible();
		expect(onMissing).toHaveBeenCalledTimes(1);
	});

	it('shows a placeholder for audio without requesting a still', async () => {
		const screen = await render(MediaThumbnail, {
			props: {
				item: {
					mime_type: 'audio/mpeg',
					thumbnail_url: null,
					poster_thumbnail_url: null,
					url: ORIGINAL_SRC,
					alt_text: null,
					original_filename: 'episode.mp3'
				},
				fallbackAlt: 'Media'
			}
		});

		await expect.element(screen.getByRole('img')).not.toBeInTheDocument();
		await expect.element(screen.getByRole('presentation')).toBeVisible();
	});

	it('waits for the poster still instead of rendering the video fallback first', async () => {
		let fallbackRenders = 0;
		const noStill = createRawSnippet(() => ({
			render: () => {
				fallbackRenders += 1;
				return '<span data-testid="video-fallback"></span>';
			}
		}));
		const screen = await render(MediaThumbnail, {
			props: {
				item: {
					mime_type: 'video/mp4',
					thumbnail_url: null,
					poster_thumbnail_url: ORIGINAL_SRC,
					url: '/media/original.mp4',
					alt_text: null,
					original_filename: 'clip.mp4'
				},
				fallbackAlt: 'Media',
				noStill
			}
		});

		await expect.element(screen.getByRole('img', { name: 'clip.mp4' })).toBeVisible();
		// The poster still wins over the item's raw video URL.
		const element = imageElement(screen, 'clip.mp4');
		expect(element.src).toContain(ORIGINAL_SRC);
		expect(fallbackRenders).toBe(0);
	});
});
