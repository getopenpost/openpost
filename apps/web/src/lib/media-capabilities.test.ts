import { describe, expect, it } from 'vitest';
import {
	MAX_COMPOSER_DRAFT_MEDIA,
	providerMediaWarningMessages,
	validateProviderMedia
} from './media-capabilities';

// Per-provider limits are enforced and matrix-tested on the backend
// (apps/server/internal/platform/media_validation_test.go is authoritative).
// This file keeps composer-specific behavior: item plumbing, warnings,
// instance-deferred rules, and draft independence.
describe('media-capabilities', () => {
	it('warns when video is mixed with images on X and Bluesky', () => {
		const media = [
			{ id: 'video-1', mimeType: 'video/mp4' },
			{ id: 'image-1', mimeType: 'image/png' }
		];

		expect(providerMediaWarningMessages('x', media)).toContain(
			'X supports one video per post and cannot mix video with images.'
		);
		expect(providerMediaWarningMessages('bluesky', media)).toContain(
			'Bluesky does not support mixing video and images in one post.'
		);
	});

	it('allows a single Bluesky GIF and rejects mixed or oversized GIFs', () => {
		expect(
			validateProviderMedia('bluesky', [{ id: 'gif-1', mimeType: 'image/gif', size: 150_000_000 }])
		).toEqual([]);
		expect(
			providerMediaWarningMessages('bluesky', [
				{ id: 'gif-1', mimeType: 'image/gif' },
				{ id: 'image-1', mimeType: 'image/jpeg' }
			])
		).toContain('Bluesky supports one GIF per post and cannot mix GIFs with other media.');
		expect(
			providerMediaWarningMessages('bluesky', [
				{ id: 'gif-1', mimeType: 'image/gif', size: 300_000_001 }
			])
		).toContain('Bluesky GIF must be 300 MB or less.');
	});

	it('keeps the composer draft ceiling independent from the X destination limit', () => {
		const images = (count: number) =>
			Array.from({ length: count }, (_, index) => ({
				id: `image-${index}`,
				mimeType: 'image/jpeg'
			}));

		// The X destination stops at four images...
		expect(validateProviderMedia('x', images(5))).toContainEqual(
			expect.objectContaining({
				provider: 'x',
				severity: 'error',
				message: 'X supports up to 4 images per post.'
			})
		);
		expect(validateProviderMedia('x', images(4))).toEqual([]);

		// ...while the composer draft ceiling is authored separately and higher.
		expect(MAX_COMPOSER_DRAFT_MEDIA).toBeGreaterThan(4);
	});
});
