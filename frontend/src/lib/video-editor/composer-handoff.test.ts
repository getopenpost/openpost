import { describe, expect, it } from 'vitest';
import {
	planVideoComposerHandoff,
	replaceOrAppendMediaID,
	videoReturnConstraints
} from './composer-handoff';

describe('video composer handoff planning', () => {
	it('assigns destination renditions to the formats they need', () => {
		const plan = planVideoComposerHandoff(
			[
				{
					account_id: 'instagram',
					rendition_id: 'rendition-story',
					output_profile: 'instagram.story',
					aspect_ratios: ['9:16']
				},
				{
					account_id: 'youtube',
					rendition_id: 'rendition-video',
					output_profile: 'youtube.video',
					aspect_ratios: ['16:9']
				}
			],
			{ width: 1920, height: 1080 }
		);

		expect(plan.required_variants).toEqual(['portrait', 'landscape']);
		expect(plan.primary_variant).toBe('landscape');
		expect(plan.variant_renditions.portrait).toEqual(['rendition-story']);
		expect(plan.variant_accounts.landscape).toEqual(['youtube']);
	});

	it('preserves the source shape when there are no destination renditions', () => {
		expect(planVideoComposerHandoff([], { width: 1080, height: 1080 })).toMatchObject({
			primary_variant: 'square',
			required_variants: ['square']
		});
	});

	it('plans unsaved destinations without inventing server rendition IDs', () => {
		const plan = planVideoComposerHandoff([
			{
				account_id: 'instagram',
				output_profile: 'instagram.reel',
				aspect_ratios: ['9:16']
			}
		]);

		expect(plan.required_variants).toEqual(['portrait']);
		expect(plan.variant_accounts.portrait).toEqual(['instagram']);
		expect(plan.variant_renditions.portrait).toEqual([]);
	});

	it('uses the strictest media limits in the server-enforced token', () => {
		const plan = planVideoComposerHandoff([], { width: 1080, height: 1920 });
		const constraints = videoReturnConstraints(
			[
				{
					min_count: 1,
					max_count: 1,
					allowed_mimes: ['video/mp4', 'video/webm'],
					max_duration_seconds: 180,
					max_size_bytes: 500,
					requires_https_fetchable: false,
					requires_public_url: false
				},
				{
					min_count: 1,
					max_count: 1,
					allowed_mimes: ['video/mp4'],
					max_duration_seconds: 60,
					max_size_bytes: 300,
					requires_https_fetchable: false,
					requires_public_url: false
				}
			],
			plan,
			{ thread_segment: 2 }
		);
		expect(constraints).toMatchObject({
			allowed_mimes: ['video/mp4'],
			max_duration_ms: 60_000,
			max_file_size_bytes: 300,
			required_variants: ['portrait'],
			thread_segment: 2
		});
	});

	it('replaces the selected video without disturbing adjacent media', () => {
		expect(replaceOrAppendMediaID(['image-1', 'video-old'], 'video-old', 'video-new', 4)).toEqual([
			'image-1',
			'video-new'
		]);
		expect(replaceOrAppendMediaID(['image-1'], undefined, 'video-new', 4)).toEqual([
			'image-1',
			'video-new'
		]);
	});
});
