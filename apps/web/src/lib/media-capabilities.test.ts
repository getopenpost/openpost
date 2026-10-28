import { describe, expect, it } from 'vitest';
import {
	MAX_COMPOSER_DRAFT_MEDIA,
	providerMediaWarningMessages,
	validateProviderMedia,
	videoProviderSupportDetail,
	videoProviderSupportLabel
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

	it('leaves Mastodon attachment counts and MOV support to the connected instance', () => {
		const media = Array.from({ length: 6 }, (_, index) => ({
			id: `mastodon-${index}`,
			mimeType: index === 0 ? 'video/quicktime' : 'image/jpeg'
		}));
		expect(validateProviderMedia('mastodon', media)).toEqual([]);
	});

	it('warns on video for Pixelfed and requires video for PeerTube', () => {
		expect(
			providerMediaWarningMessages('pixelfed', [{ id: 'video-1', mimeType: 'video/mp4' }])
		).toContain('Pixelfed is photo-first; video support depends on the instance and version.');
		expect(validateProviderMedia('peertube', [])).toContainEqual(
			expect.objectContaining({ provider: 'peertube', severity: 'error' })
		);
		expect(
			validateProviderMedia('peertube', [{ id: 'image-1', mimeType: 'image/jpeg' }])
		).toContainEqual(expect.objectContaining({ severity: 'error' }));
		expect(validateProviderMedia('peertube', [{ id: 'video-1', mimeType: 'video/mp4' }])).toEqual(
			[]
		);
	});

	it('limits community posts to a single image', () => {
		expect(validateProviderMedia('lemmy', [{ id: 'image-1', mimeType: 'image/jpeg' }])).toEqual([]);
		// Two images must hit the count rule, not the image-only rule.
		expect(
			validateProviderMedia('lemmy', [
				{ id: 'image-1', mimeType: 'image/jpeg' },
				{ id: 'image-2', mimeType: 'image/jpeg' }
			])
		).toEqual([
			{
				provider: 'lemmy',
				severity: 'error',
				message: 'Community posts accept one image; attach a single image or post a link instead.'
			}
		]);
		expect(
			validateProviderMedia('piefed', [{ id: 'video-1', mimeType: 'video/mp4' }])
		).toContainEqual(expect.objectContaining({ severity: 'error' }));
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

	it('explains that video rules vary by social network', () => {
		expect(videoProviderSupportLabel('video/mp4')).toBe('Rules vary by network');
		expect(videoProviderSupportLabel('image/png')).toBeNull();
		expect(videoProviderSupportDetail('video/webm')).toContain('works best on Mastodon');
	});

	it('limits dev/null commits to three small JPEG, PNG, or WebP images', () => {
		expect(validateProviderMedia('devnull', [])).toEqual([]);
		expect(validateProviderMedia('devnull', [{ id: 'image-1', mimeType: 'image/png' }])).toEqual(
			[]
		);
		expect(
			validateProviderMedia('devnull', [{ id: 'image-1', mimeType: 'image/gif' }])
		).toContainEqual(expect.objectContaining({ provider: 'devnull', severity: 'error' }));
		expect(
			validateProviderMedia(
				'devnull',
				Array.from({ length: 4 }, (_, index) => ({
					id: `image-${index}`,
					mimeType: 'image/jpeg'
				}))
			)
		).toContainEqual(expect.objectContaining({ provider: 'devnull', severity: 'error' }));

		// The "small" half of the title needs its own byte fixture.
		expect(
			validateProviderMedia('devnull', [
				{ id: 'image-big', mimeType: 'image/png', size: 10 * 1024 * 1024 + 1 }
			])
		).toContainEqual(
			expect.objectContaining({
				provider: 'devnull',
				severity: 'error',
				mediaId: 'image-big',
				message: 'dev/null images must be 10 MB or less.'
			})
		);
	});
});
