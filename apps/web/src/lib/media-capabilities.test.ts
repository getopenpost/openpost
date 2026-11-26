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

	it('allows 5–10 Bluesky images and rejects 11 without splitting the gallery', () => {
		for (const count of [1, 4, 5, 8, 10]) {
			const images = Array.from({ length: count }, (_, index) => ({
				id: 'image-' + index,
				mimeType: 'image/jpeg'
			}));
			expect(validateProviderMedia('bluesky', images)).toEqual([]);
		}
		for (const count of [1, 4, 5, 10]) {
			for (const mimeType of ['application/pdf', '']) {
				const images = Array.from({ length: count }, (_, index) => ({
					id: `image-${index}`,
					mimeType: index === count - 1 ? mimeType : 'image/jpeg'
				}));
				expect(validateProviderMedia('bluesky', images)).toContainEqual({
					provider: 'bluesky',
					severity: 'error',
					mediaId: `image-${count - 1}`,
					message: 'Bluesky images must be JPEG, PNG, or WebP.'
				});
			}
		}
		for (const count of [4, 5, 10]) {
			const images = Array.from({ length: count }, (_, index) => ({
				id: `image-${index}`,
				mimeType: index === count - 1 ? 'image/gif' : 'image/jpeg'
			}));
			expect(validateProviderMedia('bluesky', images)).toContainEqual({
				provider: 'bluesky',
				severity: 'error',
				mediaId: `image-${count - 1}`,
				message: 'Bluesky supports one GIF per post and cannot mix GIFs with other media.'
			});
		}
		const tooMany = Array.from({ length: 11 }, (_, index) => ({
			id: 'image-' + index,
			mimeType: 'image/jpeg'
		}));
		expect(providerMediaWarningMessages('bluesky', tooMany)).toContain(
			'Bluesky supports up to 10 images per post.'
		);
	});
});
