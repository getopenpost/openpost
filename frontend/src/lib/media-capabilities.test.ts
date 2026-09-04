import { describe, expect, it } from 'vitest';
import {
	mediaCapabilityItemsFromIds,
	providerMediaWarningMessages,
	validateProviderMedia,
	videoProviderSupportDetail,
	videoProviderSupportLabel
} from './media-capabilities';

// Per-provider limits are enforced and matrix-tested on the backend
// (backend/internal/platform/media_validation_test.go is authoritative).
// This file keeps composer-specific behavior: item plumbing, warnings,
// instance-deferred rules, and draft independence.
describe('media-capabilities', () => {
	it('builds ordered capability items from selected media IDs', () => {
		const mimeTypes = new Map([
			['video-1', 'video/mp4'],
			['image-1', 'image/png']
		]);
		const sizes = new Map([
			['video-1', 123],
			['image-1', 456]
		]);

		expect(mediaCapabilityItemsFromIds(['video-1', 'image-1'], mimeTypes, sizes)).toEqual([
			{ id: 'video-1', mimeType: 'video/mp4', size: 123 },
			{ id: 'image-1', mimeType: 'image/png', size: 456 }
		]);
	});

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

	it('keeps draft attachments independent from a destination single-media profile', () => {
		expect(
			validateProviderMedia(
				'x',
				Array.from({ length: 5 }, (_, index) => ({
					id: `image-${index}`,
					mimeType: 'image/jpeg'
				}))
			)
		).toContainEqual(expect.objectContaining({ provider: 'x', severity: 'error' }));
	});

	it('explains that video rules vary by social network', () => {
		expect(videoProviderSupportLabel('video/mp4')).toBe('Rules vary by network');
		expect(videoProviderSupportLabel('image/png')).toBeNull();
		expect(videoProviderSupportDetail('video/webm')).toContain('works best on Mastodon');
	});
});
