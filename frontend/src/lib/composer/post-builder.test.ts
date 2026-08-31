import { describe, expect, it } from 'vitest';
import { buildGeneratedPublicationDraft } from './post-builder';

describe('buildGeneratedPublicationDraft', () => {
	it('keeps source media and creates editable destination renditions', () => {
		const draft = buildGeneratedPublicationDraft(
			{
				source_text: 'A clear source post',
				renditions: [
					{ social_account_id: 'linkedin', body: 'A considered LinkedIn post' },
					{ social_account_id: 'x', body: 'A concise X post' }
				]
			},
			{ key: 'source', content: 'rough launch idea', mediaIds: ['hero-image'] }
		);

		expect(draft.sourcePost).toEqual({
			key: 'source',
			content: 'A clear source post',
			mediaIds: ['hero-image']
		});
		expect(draft.variants).toEqual({
			linkedin: {
				source: {
					content: 'A considered LinkedIn post',
					mediaIds: ['hero-image'],
					contentInherited: false,
					mediaInherited: true
				}
			},
			x: {
				source: {
					content: 'A concise X post',
					mediaIds: ['hero-image'],
					contentInherited: false,
					mediaInherited: true
				}
			}
		});
	});
});
