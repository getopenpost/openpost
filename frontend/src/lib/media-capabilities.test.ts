import { describe, expect, it } from 'vitest';
import {
	mediaCapabilityItemsFromIds,
	providerMediaWarningMessages,
	validateProviderMedia,
	videoProviderSupportDetail,
	videoProviderSupportLabel
} from './media-capabilities';

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

	it('catches Bluesky video format and size limits when metadata is available', () => {
		expect(
			validateProviderMedia('bluesky', [
				{ id: 'video-1', mimeType: 'video/webm', size: 10 * 1024 * 1024 }
			])
		).toEqual([
			{
				provider: 'bluesky',
				mediaId: 'video-1',
				severity: 'error',
				message: 'Bluesky supports MP4 video only.'
			}
		]);

		expect(
			providerMediaWarningMessages('bluesky', [
				{ id: 'video-1', mimeType: 'video/mp4', size: 101 * 1024 * 1024 }
			])
		).toContain('Bluesky video must be under 100MB.');
	});

	it('accepts Threads mixed carousels and enforces their count and MIME rules', () => {
		const carousel = Array.from({ length: 10 }, (_, index) => ({
			id: `media-${index}`,
			mimeType: index % 2 === 0 ? 'image/webp' : 'video/quicktime'
		}));

		expect(validateProviderMedia('threads', carousel)).toEqual([]);
		expect(
			providerMediaWarningMessages('threads', [
				...carousel,
				{ id: 'media-10', mimeType: 'image/jpeg' }
			])
		).toContain('Threads supports up to 10 media attachments per post.');
		expect(validateProviderMedia('threads', [{ id: 'video', mimeType: 'video/webm' }])).toEqual([
			{
				provider: 'threads',
				mediaId: 'video',
				severity: 'error',
				message: 'Threads supports MP4 or MOV video.'
			}
		]);
	});

	it('allows Facebook multi-photo posts without treating videos as photos', () => {
		const photos = Array.from({ length: 10 }, (_, index) => ({
			id: `photo-${index}`,
			mimeType: index % 2 === 0 ? 'image/jpeg' : 'image/png'
		}));

		expect(validateProviderMedia('facebook', photos)).toEqual([]);
		expect(
			providerMediaWarningMessages('facebook', [
				...photos,
				{ id: 'photo-10', mimeType: 'image/webp' }
			])
		).toContain('Facebook photo posts support up to 10 media attachments.');
		expect(
			providerMediaWarningMessages('facebook', [
				{ id: 'photo', mimeType: 'image/jpeg' },
				{ id: 'video', mimeType: 'video/mp4' }
			])
		).toContain('Facebook multi-photo posts support JPEG, PNG, or WebP images only.');
	});

	it('accepts Instagram single media and 2-10 item carousels', () => {
		const carousel = Array.from({ length: 10 }, (_, index) => ({
			id: `instagram-${index}`,
			mimeType: index % 2 === 0 ? 'image/webp' : 'video/mp4'
		}));

		expect(validateProviderMedia('instagram', [{ id: 'image', mimeType: 'image/jpeg' }])).toEqual(
			[]
		);
		expect(validateProviderMedia('instagram', carousel)).toEqual([]);
		expect(
			providerMediaWarningMessages('instagram', [
				...carousel,
				{ id: 'instagram-10', mimeType: 'image/png' }
			])
		).toContain('Instagram publishing requires 1-10 image or video attachments.');
		expect(providerMediaWarningMessages('instagram', [])).toContain(
			'Instagram publishing requires 1-10 image or video attachments.'
		);
	});

	it('accepts one TikTok video or 1-35 JPEG and WebP photos', () => {
		const photos = Array.from({ length: 35 }, (_, index) => ({
			id: `tiktok-${index}`,
			mimeType: index % 2 === 0 ? 'image/jpeg' : 'image/webp'
		}));

		expect(validateProviderMedia('tiktok', [{ id: 'video', mimeType: 'video/quicktime' }])).toEqual(
			[]
		);
		expect(validateProviderMedia('tiktok', photos)).toEqual([]);
		expect(
			providerMediaWarningMessages('tiktok', [
				...photos,
				{ id: 'tiktok-35', mimeType: 'image/jpeg' }
			])
		).toContain('TikTok photo posts support 1-35 images.');
		expect(validateProviderMedia('tiktok', [{ id: 'png', mimeType: 'image/png' }])).toEqual([
			{
				provider: 'tiktok',
				mediaId: 'png',
				severity: 'error',
				message: 'TikTok photo posts support JPEG or WebP images only.'
			}
		]);
	});

	it('warns when YouTube receives an image', () => {
		expect(
			providerMediaWarningMessages('youtube', [{ id: 'image-1', mimeType: 'image/png' }])
		).toContain('YouTube publishing supports video attachments only.');
	});

	it('explains that video rules vary by social network', () => {
		expect(videoProviderSupportLabel('video/mp4')).toBe('Rules vary by network');
		expect(videoProviderSupportLabel('image/png')).toBeNull();
		expect(videoProviderSupportDetail('video/webm')).toContain('works best on Mastodon');
	});
});
