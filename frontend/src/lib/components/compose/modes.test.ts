import { describe, expect, it } from 'vitest';
import {
	buildFocusedPublicationPayload,
	COMPOSER_MODE_GROUPS,
	isAccountCompatibleWithMode,
	roleFieldsForMode,
	SELECTABLE_COMPOSER_MODES
} from './modes';

const youtube = { id: 'yt-1', platform: 'youtube', account_username: 'OpenPost' };
const tiktok = { id: 'tt-1', platform: 'tiktok', account_username: 'openpost' };
const instagram = { id: 'ig-1', platform: 'instagram', account_username: 'openpost' };

describe('composer intent mapping', () => {
	it('offers only user publishing intents', () => {
		expect(SELECTABLE_COMPOSER_MODES.map((mode) => mode.key)).toEqual([
			'post',
			'thread',
			'story',
			'short_video',
			'video'
		]);
	});

	it('groups every intent once', () => {
		expect(
			COMPOSER_MODE_GROUPS.map((group) => ({
				label: group.label,
				modes: group.modes.map((mode) => mode.key)
			}))
		).toEqual([
			{ label: 'Write', modes: ['post', 'thread'] },
			{ label: 'Media', modes: ['story', 'short_video', 'video'] }
		]);
		expect(COMPOSER_MODE_GROUPS.flatMap((group) => group.modes)).toEqual(SELECTABLE_COMPOSER_MODES);
	});

	it('uses shared text and link fields for Post', () => {
		expect(roleFieldsForMode('post', [])).toEqual([
			expect.objectContaining({ key: 'postText', label: 'Post text' }),
			expect.objectContaining({ key: 'linkUrl', label: 'Link URL' })
		]);
	});

	it('keeps thread bodies in the ordered segment editor', () => {
		expect(roleFieldsForMode('thread', [])).toEqual([]);
	});

	it('offers YouTube only for its public video outputs', () => {
		expect(isAccountCompatibleWithMode('post', youtube)).toBe(false);
		expect(isAccountCompatibleWithMode('thread', youtube)).toBe(false);
		expect(isAccountCompatibleWithMode('story', youtube)).toBe(false);
		expect(isAccountCompatibleWithMode('short_video', youtube)).toBe(true);
		expect(isAccountCompatibleWithMode('video', youtube)).toBe(true);
	});

	it('uses resolved capability intents for other providers', () => {
		const capabilities = [{ provider: 'instagram', profile: 'image_post', intents: ['post'] }];
		expect(isAccountCompatibleWithMode('post', instagram, capabilities)).toBe(true);
		expect(isAccountCompatibleWithMode('video', instagram, capabilities)).toBe(false);
	});

	it('separates YouTube video metadata from social captions', () => {
		expect(roleFieldsForMode('short_video', [youtube, tiktok])).toEqual([
			expect.objectContaining({ key: 'videoTitle', label: 'Video title' }),
			expect.objectContaining({ key: 'videoDescription', label: 'Video description' }),
			expect.objectContaining({ key: 'caption', label: 'Caption', hint: 'Caption · TikTok' })
		]);
	});
});

describe('focused publication payloads', () => {
	it('maps Video metadata and explicit destination choices', () => {
		const payload = buildFocusedPublicationPayload({
			mode: 'video',
			workspaceId: 'ws-1',
			accounts: [youtube],
			fields: {
				videoTitle: 'Launch walkthrough',
				videoDescription: 'A complete tour of the release.'
			},
			media: [{ id: 'video-1', mimeType: 'video/mp4' }],
			thumbnailMediaId: 'thumb-1',
			settingsByAccount: { 'yt-1': { privacy: 'private' } },
			resolvedByAccount: {
				'yt-1': {
					profile: 'long_video',
					outputProfile: 'youtube.video',
					revision: 'youtube.video:v1'
				}
			}
		});

		expect(payload.intent).toBe('video');
		expect(payload.source_text).toBe('A complete tour of the release.');
		expect(payload.renditions[0]).toMatchObject({
			social_account_id: 'yt-1',
			profile: 'long_video',
			output_profile: 'youtube.video',
			body: 'A complete tour of the release.',
			title: 'Launch walkthrough',
			description: 'A complete tour of the release.',
			settings: {
				privacy: 'private',
				title: 'Launch walkthrough',
				description: 'A complete tour of the release.',
				thumbnail_media_id: 'thumb-1'
			}
		});
	});

	it('preserves ordered thread segments and segment-scoped settings', () => {
		const payload = buildFocusedPublicationPayload({
			mode: 'thread',
			workspaceId: 'ws-1',
			accounts: [tiktok],
			fields: {},
			media: [],
			segments: [
				{
					id: 'segment-1',
					content: 'First',
					media: [],
					settingsByAccount: { 'tt-1': { reply_control: 'everyone' } }
				},
				{ id: 'segment-2', content: 'Second', media: [] }
			],
			resolvedByAccount: {
				'tt-1': { profile: 'thread', outputProfile: 'tiktok.thread' }
			}
		});

		expect(payload.segments.map((segment) => segment.body)).toEqual(['First', 'Second']);
		expect(payload.renditions[0].segments).toEqual([
			expect.objectContaining({
				publication_segment_id: 'segment-1',
				body: 'First',
				settings: { reply_control: 'everyone' }
			}),
			expect.objectContaining({
				publication_segment_id: 'segment-2',
				body: 'Second',
				settings: {}
			})
		]);
	});

	it('stores first comments as follow-up segments and media options on the destination item', () => {
		const linkedin = { id: 'li-1', platform: 'linkedin', account_username: 'OpenPost' };
		const payload = buildFocusedPublicationPayload({
			mode: 'post',
			workspaceId: 'ws-1',
			accounts: [linkedin],
			fields: { postText: 'Release notes' },
			media: [
				{
					id: 'image-1',
					mimeType: 'image/jpeg',
					altText: 'A product screen',
					settingsByAccount: {
						'li-1': {
							alt_text: 'A destination-specific description',
							tagged_user_ids: 'person-1, person-2'
						}
					}
				}
			],
			segments: [
				{
					id: 'segment-1',
					content: 'Release notes',
					media: [
						{
							id: 'image-1',
							mimeType: 'image/jpeg',
							altText: 'A product screen',
							settingsByAccount: {
								'li-1': {
									alt_text: 'A destination-specific description',
									tagged_user_ids: 'person-1, person-2'
								}
							}
						}
					],
					settingsByAccount: { 'li-1': { first_comment: 'Read the full changelog.' } }
				}
			],
			resolvedByAccount: {
				'li-1': { profile: 'image_post', outputProfile: 'linkedin.image' }
			}
		});

		expect(payload.renditions[0].segments).toHaveLength(2);
		expect(payload.renditions[0].segments[0].media[0]).toMatchObject({
			media_id: 'image-1',
			alt_text: 'A destination-specific description',
			settings: { tagged_user_ids: 'person-1, person-2' }
		});
		expect(payload.renditions[0].segments[1]).toMatchObject({
			publication_segment_id: 'segment-1',
			body: 'Read the full changelog.',
			settings: {},
			media: []
		});
	});
});
