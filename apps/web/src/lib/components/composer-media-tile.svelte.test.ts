import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ComposerMediaTile from './composer-media-tile.svelte';

function tileProps(isVideo: boolean) {
	return {
		mediaId: 'media-tile-1',
		mediaIndex: 0,
		mediaCount: 2,
		isFirstOfThree: false,
		altTexts: new Map<string, string>(),
		captioningIds: new Set<string>(),
		failedCaptionIds: new Set<string>(),
		editing: false,
		isVideoMedia: () => isVideo,
		onRemoveMedia: vi.fn(),
		onAltText: vi.fn(),
		onToggleAlt: vi.fn(),
		onRetryCaption: vi.fn(),
		onDoneAlt: vi.fn()
	};
}

describe('composer media tile', () => {
	it('shows the full original for images so the large tile stays sharp', async () => {
		const screen = await render(ComposerMediaTile, { props: tileProps(false) });

		// The harness 404s both still tiers, so assert the requested source
		// before the retry chain settles.
		const element = document.querySelector('img');
		if (!(element instanceof HTMLImageElement)) throw new Error('Expected an image element.');
		expect(element.src).toContain('/media/media-tile-1');
		expect(element.src).not.toContain('/thumb/');

		await expect.element(screen.getByRole('img')).not.toBeInTheDocument();
		await expect.element(screen.getByRole('presentation')).toBeVisible();
	});

	it('shows the video poster while keeping the player on the original', async () => {
		await render(ComposerMediaTile, { props: tileProps(true) });

		const element = document.querySelector('video');
		if (!(element instanceof HTMLVideoElement)) throw new Error('Expected a video element.');
		expect(element.src).toContain('/media/media-tile-1');
		expect(element.getAttribute('poster')).toContain('/media/media-tile-1/poster');
	});
});
