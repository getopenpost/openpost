import { describe, expect, it } from 'vitest';
import { buildPublicationPayload } from './modes';
const tiktok = { id: 'tt-1', platform: 'tiktok', account_username: 'openpost' };

describe('publication composer payloads', () => {
	it('keeps first comments independent of selected source identities', () => {
		const mentions = {
			version: 1 as const,
			spans: [
				{
					start: 3,
					end: 9,
					text: '@guest',
					target: {
						provider: 'workspace' as const,
						kind: 'profile' as const,
						id: 'saved',
						profiles: [{ provider: 'x', text: '@guest_x' }]
					}
				}
			]
		};
		const payload = buildPublicationPayload({
			mode: 'post',
			workspaceId: 'ws',
			accounts: [{ id: 'x', platform: 'x' }],
			fields: { postText: 'Hi @guest' },
			media: [],
			segments: [
				{
					id: 'source',
					content: 'Hi @guest',
					media: [],
					mentions,
					settingsByAccount: { x: { first_comment: 'Thanks!' } }
				}
			]
		});
		expect(payload.renditions[0].segments?.[1]).toMatchObject({
			body: 'Thanks!',
			settings: { mentions: { version: 1, spans: [] } }
		});
	});
	it('preserves selected mentions and exact text in a single canonical post', () => {
		const body = ' 🚀 Hi @alice\n\n';
		const mentions = {
			version: 1 as const,
			spans: [
				{
					start: 9,
					end: 15,
					text: '@alice',
					target: {
						provider: 'bluesky' as const,
						kind: 'person' as const,
						id: 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'
					}
				}
			]
		};
		const payload = buildPublicationPayload({
			mode: 'post',
			workspaceId: 'ws',
			accounts: [{ id: 'x', platform: 'x' }],
			fields: { postText: body },
			media: [],
			segments: [{ id: 'source', content: body, media: [], mentions }]
		});
		expect(payload.segments[0]).toMatchObject({ body, settings: { mentions } });
		expect(payload.renditions[0].segments?.[0]).toMatchObject({ body });
		expect(payload.renditions[0].segments?.[0].body_override).toBeUndefined();
	});
	it('keeps inline URLs in media posts without serializing native link settings', () => {
		const accounts = [
			{ id: 'facebook-1', platform: 'facebook', account_username: 'openpost' },
			{
				id: 'instagram-1',
				platform: 'instagram',
				account_username: 'openpost'
			},
			{ id: 'threads-1', platform: 'threads', account_username: 'openpost' },
			{ id: 'x-1', platform: 'x', account_username: 'openpost' },
			{ id: 'mastodon-1', platform: 'mastodon', account_username: 'openpost' },
			{ id: 'linkedin-1', platform: 'linkedin', account_username: 'OpenPost' }
		];
		const payload = buildPublicationPayload({
			mode: 'post',
			workspaceId: 'ws-1',
			accounts,
			fields: { postText: 'Release notes https://example.com' },
			media: [{ id: 'image-1', mimeType: 'image/jpeg' }],
			resolvedByAccount: Object.fromEntries(
				accounts.map((account) => [
					account.id,
					{ profile: 'image_post', outputProfile: `${account.platform}.image` }
				])
			),
			settingsByAccount: Object.fromEntries(
				accounts.map((account) => [
					account.id,
					{ url: 'https://example.com', reply_settings: 'everyone' }
				])
			)
		});

		expect(payload.renditions).toHaveLength(6);
		for (const rendition of payload.renditions) {
			expect(rendition.body).toContain('https://example.com');
			expect(rendition.settings).toEqual({ reply_settings: 'everyone' });
		}
	});

	it('clears stale native link settings after an inline URL is removed', () => {
		const payload = buildPublicationPayload({
			mode: 'post',
			workspaceId: 'ws-1',
			accounts: [{ id: 'x-1', platform: 'x', account_username: 'openpost' }],
			fields: { postText: 'Release notes without the old link' },
			media: [{ id: 'image-1', mimeType: 'image/jpeg' }],
			resolvedByAccount: {
				'x-1': { profile: 'image_post', outputProfile: 'x.image' }
			},
			settingsByAccount: { 'x-1': { url: 'https://example.com' } }
		});

		expect(payload.renditions[0].settings).toEqual({});
	});

	it('preserves adopted legacy URLs independently of the shared post URL', () => {
		const payload = buildPublicationPayload({
			mode: 'post',
			workspaceId: 'workspace-1',
			accounts: [{ id: 'li-1', platform: 'linkedin' }],
			fields: { postText: 'Shared text' },
			media: [],
			segments: [
				{
					id: 'source',
					content: 'Shared text',
					media: [],
					link: { destinations: { 'li-1': { mode: 'legacy' } } },
					settingsByAccount: { 'li-1': { url: 'https://legacy.example/card' } }
				}
			]
		});
		expect(payload.renditions[0].segments?.[0].settings).toEqual({
			url: 'https://legacy.example/card'
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

	it.each(['A destination-specific description', ''])(
		'stores first comments and destination media options with alt text %j',
		(altText) => {
			const linkedin = {
				id: 'li-1',
				platform: 'linkedin',
				account_username: 'OpenPost'
			};
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
								alt_text: altText,
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
										alt_text: altText,
										tagged_user_ids: 'person-1, person-2'
									}
								}
							}
						],
						settingsByAccount: {
							'li-1': { first_comment: 'Read the full changelog.' }
						}
					}
				],
				resolvedByAccount: {
					'li-1': { profile: 'image_post', outputProfile: 'linkedin.image' }
				}
			});

			expect(payload.renditions[0].segments).toHaveLength(2);
			expect(payload.renditions[0].segments[0].media[0]).toMatchObject({
				media_id: 'image-1',
				settings: { tagged_user_ids: 'person-1, person-2' }
			});
			expect(payload.renditions[0].segments[0].media[0].alt_text).toBe(altText || undefined);
			expect(payload.renditions[0].segments[1]).toMatchObject({
				publication_segment_id: 'segment-1',
				body: 'Read the full changelog.',
				settings: {},
				media: []
			});
		}
	);

	it('joins a shared thread for a single-post destination', () => {
		const linkedin = {
			id: 'li-1',
			platform: 'linkedin',
			account_username: 'OpenPost'
		};
		const payload = buildPublicationPayload({
			mode: 'thread',
			workspaceId: 'ws-1',
			accounts: [linkedin],
			fields: {},
			media: [],
			segments: [
				{
					id: 'segment-1',
					content: 'First',
					media: [],
					settingsByAccount: { 'li-1': { first_comment: 'Thanks!' } }
				},
				{
					id: 'segment-2',
					content: 'Hi @guest',
					media: [],
					mentions: {
						version: 1,
						spans: [
							{
								start: 3,
								end: 9,
								text: '@guest',
								target: {
									provider: 'workspace',
									kind: 'profile',
									id: 'saved',
									profiles: [{ provider: 'linkedin', text: 'Guest' }]
								}
							}
						]
					}
				}
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
		expect(payload.renditions[0].segments).toHaveLength(2);
		expect(payload.renditions[0].segments[0].body).toBe('First\n\nHi @guest');
		expect(payload.renditions[0].segments[0].source_overrides).toEqual([
			{ publication_segment_id: 'segment-1', media_inherited: true },
			{ publication_segment_id: 'segment-2', media_inherited: true }
		]);
		expect(payload.renditions[0].segments[1].settings).toEqual({
			mentions: { version: 1, spans: [] }
		});
	});
});
