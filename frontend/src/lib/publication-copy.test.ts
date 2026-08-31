import { describe, expect, it } from 'vitest';
import type { components } from '$lib/api/types';
import { publicationDraftCopy } from './composer/publication-client';

type Publication = components['schemas']['PublicationResponse'];

describe('publicationDraftCopy', () => {
	it('preserves authored content and destinations while resetting delivery state', () => {
		const source = {
			id: 'publication-1',
			workspace_id: 'workspace-1',
			created_by: 'user-1',
			title: 'Launch update',
			intent: 'thread',
			creation_preset: 'thread',
			social_set_id: 'set-1',
			content_profile: 'thread',
			source_text: 'First post',
			source_url: 'https://openpost.social',
			goal: 'announce',
			audience: 'founders',
			status: 'published',
			revision: 4,
			scheduled_at: '2026-08-27T10:00:00Z',
			actual_run_at: '2026-08-27T10:00:01Z',
			random_delay_minutes: 10,
			random_delay_inherited: false,
			metadata: { campaign: 'launch' },
			created_at: '2026-08-26T10:00:00Z',
			updated_at: '2026-08-27T10:00:01Z',
			repost_override: { mode: 'disabled' },
			media: [],
			segments: [
				{
					id: 'segment-1',
					position: 0,
					body: 'First post',
					title: '',
					description: '',
					url: 'https://openpost.social',
					settings: { first_comment: 'Details' },
					media: [
						{
							id: 'media-1',
							mime_type: 'image/png',
							size: 100,
							original_filename: 'launch.png',
							width: 1200,
							height: 630,
							duration_ms: 0,
							frame_rate: 0,
							aspect_ratio: '40:21',
							dominant_type: 'image',
							analysis_status: 'ready',
							public_url_ready: true,
							public_url_status: 200,
							url: '/media/media-1',
							role: 'attachment',
							alt_text: 'OpenPost launch image',
							settings: { made_with_ai: false }
						}
					]
				}
			],
			renditions: [
				{
					id: 'rendition-1',
					publication_id: 'publication-1',
					social_account_id: 'account-1',
					target_key: 'x',
					platform: 'x',
					profile: 'thread',
					output_profile: 'x.thread',
					format_locked: true,
					schedule_override: '2026-08-28T10:00:00Z',
					body: 'First post for X',
					title: '',
					description: '',
					settings: { reply_settings: 'following' },
					status: 'published',
					external_id: 'remote-1',
					external_url: 'https://x.com/example/status/1',
					error_retryable: false,
					media: [],
					segments: [
						{
							id: 'rendition-segment-1',
							publication_segment_id: 'segment-1',
							position: 0,
							body: 'First post for X',
							title: '',
							description: '',
							body_override: 'First post for X',
							media_inherited: true,
							settings: { poll_duration_minutes: 60 },
							status: 'published',
							external_id: 'remote-1',
							error_retryable: false,
							media: []
						}
					]
				}
			]
		} satisfies Publication;

		const copy = publicationDraftCopy(source);

		expect(copy).toMatchObject({
			workspace_id: 'workspace-1',
			title: 'Launch update',
			intent: 'thread',
			creation_preset: 'thread',
			social_set_id: 'set-1',
			content_profile: 'thread',
			source_text: 'First post',
			source_url: 'https://openpost.social',
			goal: 'announce',
			audience: 'founders',
			metadata: { campaign: 'launch' },
			repost_override: { mode: 'disabled' },
			segments: [
				{
					id: 'segment-1',
					body: 'First post',
					media: [
						{
							media_id: 'media-1',
							role: 'attachment',
							alt_text: 'OpenPost launch image',
							settings: { made_with_ai: false }
						}
					]
				}
			],
			renditions: [
				{
					social_account_id: 'account-1',
					target_key: 'x',
					profile: 'thread',
					output_profile: 'x.thread',
					format_locked: true,
					body: 'First post for X',
					settings: { reply_settings: 'following' },
					segments: [
						{
							publication_segment_id: 'segment-1',
							body_override: 'First post for X',
							media_inherited: true,
							settings: { poll_duration_minutes: 60 }
						}
					]
				}
			]
		});
		expect(copy).not.toHaveProperty('scheduled_at');
		expect(copy).not.toHaveProperty('random_delay_minutes');
		expect(copy.renditions?.[0]).not.toHaveProperty('schedule_override');
		expect(copy.renditions?.[0]).not.toHaveProperty('id');
		expect(copy.renditions?.[0]).not.toHaveProperty('status');
		expect(copy.renditions?.[0]).not.toHaveProperty('external_id');
	});
});
