import { describe, expect, it } from 'vitest';
import { parseBuilderContext } from './builder-context';

describe('parseBuilderContext', () => {
	it('keeps only safe Builder review fields', () => {
		expect(
			parseBuilderContext({
				builder: {
					build_id: 'build-1',
					thesis: 'Less code made the product better.',
					angle: 'The deletion is the launch.',
					voices: [
						{ account_id: 'x-1', id: 'rodrigo', name: 'Rodrigo', revision: 3 },
						{ account_id: '', id: 'ignored', name: 'Ignored' }
					],
					claims: [
						{ text: '15,000 lines were deleted.', status: 'user_asserted' },
						{ text: '', status: 'supported' }
					],
					media: { treatment: 'use_source', role: 'proof', brief: 'Show the diff.' },
					destinations: [
						{
							account_id: 'x-1',
							platform: 'x',
							objective: 'discussion',
							archetype: 'technical_opinion',
							output_profile: 'x.thread',
							preview: 'deleted 15,000 lines.',
							media: { treatment: 'none', role: 'none', brief: 'No media.' }
						}
					],
					skipped: [{ account_id: 'threads-1', platform: 'threads', reason: 'Weak fit.' }],
					review_flags: [
						{ account_id: 'x-1', field: 'claim', severity: 'warning', message: 'Check the count.' }
					]
				}
			})
		).toEqual({
			buildId: 'build-1',
			voiceProfileId: '',
			route: '',
			thesis: 'Less code made the product better.',
			angle: 'The deletion is the launch.',
			voices: [{ accountId: 'x-1', id: 'rodrigo', name: 'Rodrigo', revision: 3 }],
			claims: [{ text: '15,000 lines were deleted.', status: 'user_asserted' }],
			media: { treatment: 'use_source', role: 'proof', brief: 'Show the diff.' },
			destinations: [
				{
					accountId: 'x-1',
					platform: 'x',
					objective: 'discussion',
					archetype: 'technical_opinion',
					outputProfile: 'x.thread',
					preview: 'deleted 15,000 lines.',
					media: { treatment: 'none', role: 'none', brief: 'No media.' }
				}
			],
			skipped: [{ accountId: 'threads-1', platform: 'threads', reason: 'Weak fit.' }],
			reviewFlags: [
				{ accountId: 'x-1', field: 'claim', severity: 'warning', message: 'Check the count.' }
			]
		});
	});

	it('returns null for ordinary Publication metadata', () => {
		expect(parseBuilderContext({ source: 'manual' })).toBeNull();
		expect(parseBuilderContext(null)).toBeNull();
	});
});
