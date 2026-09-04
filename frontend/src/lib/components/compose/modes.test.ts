import { describe, expect, it } from 'vitest';
import { buildPublicationPayload } from './modes';

const youtube = { id: 'yt-1', platform: 'youtube', account_username: 'OpenPost' };
const tiktok = { id: 'tt-1', platform: 'tiktok', account_username: 'openpost' };

describe('publication composer payloads', () => {
	it('maps required video metadata and explicit destination choices from the shared composer', () => {
		const payload = buildPublicationPayload({
			mode: 'post',
			workspaceId: 'ws-1',
			accounts: [youtube],
			fields: { postText: 'A complete tour of the release.' },
			media: [{ id: 'video-1', mimeType: 'video/mp4' }],
			thumbnailMediaId: 'thumb-1',
			settingsByAccount: {
				'yt-1': {
					privacy: 'private',
					title: 'Launch walkthrough',
					description: 'A complete tour of the release.'
				}
			},
			resolvedByAccount: {
				'yt-1': {
					profile: 'long_video',
					outputProfile: 'youtube.video',
					revision: 'youtube.video:v1'
				}
			}
		});

		expect(payload.intent).toBe('post');
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
		const payload = buildPublicationPayload({
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
		const payload = buildPublicationPayload({
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

	it('joins a shared thread for a single-post destination', () => {
		const linkedin = { id: 'li-1', platform: 'linkedin', account_username: 'OpenPost' };
		const payload = buildPublicationPayload({
			mode: 'thread',
			workspaceId: 'ws-1',
			accounts: [linkedin],
			fields: {},
			media: [],
			segments: [
				{ id: 'segment-1', content: 'First', media: [] },
				{ id: 'segment-2', content: 'Second', media: [] }
			],
			resolvedByAccount: {
				'li-1': {
					profile: 'short_text',
					outputProfile: 'linkedin.post',
					segmentStrategy: 'join'
				}
			}
		});

		expect(payload.segments).toHaveLength(2);
		expect(payload.renditions[0].segments).toHaveLength(1);
		expect(payload.renditions[0].segments[0].body).toBe('First\n\nSecond');
	});
});
