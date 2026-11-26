import { previewCapabilities, previewPlatforms } from '@openpost/social-preview';
import { describe, expect, it } from 'vitest';
import type { SocialAccount } from '$lib/api/client';
import { buildComposerPreview } from './compose-preview';
import { PLATFORM_COLORS } from '$lib/utils';

const account = {
	id: 'account-1',
	platform: 'mastodon:https://social.example',
	account_username: '@openpost',
	account_avatar_url: 'https://example.com/avatar.png',
	account_id: 'provider-account-1',
	grant_destination_count: 1,
	instance_url: 'https://social.example',
	is_active: true,
	messages_enabled: false,
	messaging_supported: false,
	shared_grant: false,
	slug: 'openpost',
	thread_replies_supported: true
} satisfies SocialAccount;

describe('social preview model', () => {
	it('defines a preview capability for every supported and registered destination', () => {
		expect(Object.keys(previewCapabilities).sort()).toEqual([...previewPlatforms].sort());
		expect(
			previewPlatforms.every((platform) => previewCapabilities[platform].formats.length > 0)
		).toBe(true);
		expect(previewPlatforms).toEqual(expect.arrayContaining(Object.keys(PLATFORM_COLORS)));
	});
});

describe('composer preview mapping', () => {
	it('keeps an explicit feed format when the post contains video', () => {
		const model = buildComposerPreview({
			account: { ...account, platform: 'facebook' },
			mode: 'post',
			outputProfile: 'facebook.post',
			segments: [
				{
					id: 'one',
					text: 'Feed video',
					media: [{ id: 'clip', mimeType: 'video/mp4' }]
				}
			]
		});
		expect(model.format).toBe('post');
	});

	it('preserves a cleared first-segment attachment override', () => {
		const model = buildComposerPreview({
			account,
			mode: 'post',
			segments: [{ id: 'one', text: 'Text only', media: [] }],
			media: [{ id: 'shared-image', mimeType: 'image/jpeg' }]
		});
		expect(model.media).toEqual([]);
	});

	it('joins destination segments when the publishing contract joins them', () => {
		const model = buildComposerPreview({
			account: { ...account, platform: 'linkedin' },
			mode: 'thread',
			outputProfile: 'linkedin.post',
			segmentStrategy: 'join',
			segments: [
				{ id: 'one', text: 'First paragraph' },
				{ id: 'two', text: 'Second paragraph' }
			]
		});
		expect(model.segments.map((segment) => segment.text)).toEqual([
			'First paragraph\n\nSecond paragraph'
		]);
	});

	it('preserves commas in poll answers on each thread segment', () => {
		const model = buildComposerPreview({
			account,
			mode: 'thread',
			segments: [
				{
					id: 'one',
					text: 'First',
					settings: { poll_options: 'Yes, sometimes\nNever' }
				},
				{
					id: 'two',
					text: 'Second',
					settings: { poll_options: 'Red, green\nBlue' }
				}
			]
		});
		expect(model.segments?.[0].poll?.options).toEqual(['Yes, sometimes', 'Never']);
		expect(model.segments?.[1].poll?.options).toEqual(['Red, green', 'Blue']);
	});
});

describe('account link previews', () => {
	it.each(['bluesky', 'linkedin', 'facebook', 'x'])(
		'uses the URL in %s account text before the shared fallback',
		(platform) => {
			const model = buildComposerPreview({
				account: { ...account, platform },
				mode: 'post',
				segments: [{ id: 'one', text: 'A separate update https://account.example/new' }],
				linkUrl: 'https://shared.example/old'
			});
			expect(model.card?.domain).toBe('account.example');
			expect(model.segments[0].card?.domain).toBe('account.example');
		}
	);
});

describe('selected media presentation', () => {
	it('uses the authored account cover instead of the default video poster', () => {
		const model = buildComposerPreview({
			account: { ...account, platform: 'youtube' },
			mode: 'post',
			outputProfile: 'youtube.video',
			destinationSettings: { thumbnail_media_id: 'authored-cover' },
			segments: [
				{
					id: 'source',
					text: 'Caption',
					media: [
						{
							id: 'video',
							mimeType: 'video/mp4',
							poster: 'https://default.example/poster.jpg'
						}
					]
				}
			]
		});
		expect(model.media[0].poster).toContain('authored-cover');
	});
	it('deduplicates joined media in source order while keeping the first authored item', () => {
		const model = buildComposerPreview({
			account: { ...account, platform: 'linkedin' },
			mode: 'thread',
			outputProfile: 'linkedin.multi_image',
			segmentStrategy: 'join',
			segments: [
				{
					id: 'first',
					text: 'First',
					media: [{ id: 'same', mimeType: 'image/jpeg', altText: 'First alt' }]
				},
				{
					id: 'second',
					text: 'Second',
					media: [
						{ id: 'same', mimeType: 'image/jpeg', altText: 'Second alt' },
						{ id: 'other', mimeType: 'image/jpeg' }
					]
				}
			]
		});
		expect(model.media.map((item) => [item.id, item.alt])).toEqual([
			['same', 'First alt'],
			['other', undefined]
		]);
	});
});

it('projects an account-specific cover frame and Mastodon focal point without changing media order', () => {
	const reel = buildComposerPreview({
		account: { ...account, platform: 'instagram' },
		mode: 'post',
		outputProfile: 'instagram.reel',
		destinationSettings: { thumbnail_timestamp_ms: 1250 },
		segments: [
			{
				id: 'one',
				text: 'Reel',
				media: [
					{
						id: 'clip',
						mimeType: 'video/mp4',
						poster: 'https://default.example/poster'
					}
				]
			}
		]
	});
	expect(reel.media[0]).toMatchObject({
		id: 'clip',
		previewFrameSeconds: 1.25
	});
	expect(reel.media[0].poster).toBeUndefined();
	const feed = buildComposerPreview({
		account,
		mode: 'post',
		segments: [
			{
				id: 'one',
				text: 'Photos',
				media: [
					{
						id: 'left',
						mimeType: 'image/jpeg',
						settings: { focal_point: '-1,1' }
					},
					{ id: 'center', mimeType: 'image/jpeg' }
				]
			}
		]
	});
	expect(feed.media.map((item) => item.id)).toEqual(['left', 'center']);
	expect(feed.media[0].focalPoint).toEqual({ x: -1, y: 1 });
	expect(feed.media[1].focalPoint).toBeUndefined();
});
