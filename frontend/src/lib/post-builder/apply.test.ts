import { describe, expect, test } from 'vitest';
import { applyPublicationBuildResult } from './apply';
import type { PublicationBuildResult } from './client';

function result(destinations: PublicationBuildResult['destinations']): PublicationBuildResult {
	return {
		canonical_text: 'Shared thesis',
		direction: {
			thesis: 'Shared thesis',
			outcome: 'conversation',
			audience: 'builders',
			angle: 'show the tradeoff',
			route: 'artifact_led',
			media: { treatment: 'none', role: 'none', brief: 'No media.' }
		},
		destinations
	};
}

test('keeps existing attachments and applies native account versions', () => {
	const applied = applyPublicationBuildResult(
		result([
			{
				account_id: 'linkedin-1',
				platform: 'linkedin',
				objective: 'authority',
				archetype: 'artifact_led',
				output_profile: 'linkedin.post',
				preview: 'LinkedIn copy',
				segments: [{ body: 'LinkedIn copy' }],
				media: { treatment: 'use_source', role: 'proof', brief: 'Use the screenshot.' }
			}
		]),
		{ key: 'source', content: 'Rough idea', mediaIds: ['media-1'] }
	);

	expect(applied.posts).toEqual([
		{ key: 'source', content: 'Shared thesis', mediaIds: ['media-1'] }
	]);
	expect(applied.variants['linkedin-1']['source']).toMatchObject({
		content: 'LinkedIn copy',
		mediaIds: ['media-1'],
		mediaInherited: true
	});
	expect(applied.requestedOutputProfiles).toEqual({ 'linkedin-1': 'linkedin.post' });
});

describe('thread-shaped native versions', () => {
	test('creates enough canonical review rows for the longest rendition', () => {
		const applied = applyPublicationBuildResult(
			result([
				{
					account_id: 'x-1',
					platform: 'x',
					objective: 'conversation',
					archetype: 'technical_opinion',
					output_profile: 'x.thread',
					preview: 'One',
					segments: [{ body: 'One' }, { body: 'Two' }],
					media: { treatment: 'none', role: 'none', brief: 'No media.' }
				},
				{
					account_id: 'linkedin-1',
					platform: 'linkedin',
					objective: 'authority',
					archetype: 'lesson',
					output_profile: 'linkedin.post',
					preview: 'One post',
					segments: [{ body: 'One post' }],
					media: { treatment: 'none', role: 'none', brief: 'No media.' }
				}
			]),
			{ key: 'source', content: 'Rough idea', mediaIds: [] }
		);

		expect(applied.posts.map((post) => post.content)).toEqual(['One', 'Two']);
		expect(Object.values(applied.variants['x-1']).map((post) => post.content)).toEqual([
			'One',
			'Two'
		]);
		expect(Object.values(applied.variants['linkedin-1']).map((post) => post.content)).toEqual([
			'One post',
			''
		]);
	});
});
