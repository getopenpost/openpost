import { describe, expect, it } from 'vitest';
import { duplicateStep } from './operations';
import type { Step } from './api';

describe('workflow branch duplication', () => {
	it('remaps copied bindings and keeps upstream references and JavaScript intact', () => {
		const original: Step = {
			id: 'decision',
			kind: 'condition',
			name: 'Check',
			inputs: { left: { reference: 'source.body' } },
			then: [
				{
					id: 'draft',
					kind: 'create_draft',
					name: 'Draft',
					inputs: { text: { literal: '{{source.body}} {{decision.matched}}' } }
				},
				{
					id: 'review',
					kind: 'approval',
					name: 'Review',
					inputs: { publication_id: { reference: 'draft.id' } }
				},
				{
					id: 'code',
					kind: 'code',
					name: 'Code',
					inputs: {
						data: { literal: { list: ['{{draft.id}}'] } },
						code: { literal: 'return "{{draft.id}}";' }
					}
				}
			],
			else: []
		};
		const snapshot = JSON.stringify(original);
		const copy = duplicateStep(original);
		const [draft, review, code] = copy.then!;
		expect(new Set([copy.id, draft.id, review.id, code.id]).size).toBe(4);
		expect([copy.id, draft.id, review.id, code.id]).not.toContain('draft');
		expect(copy.inputs!.left.reference).toBe('source.body');
		expect(draft.inputs!.text.literal).toBe(`{{source.body}} {{${copy.id}.matched}}`);
		expect(review.inputs!.publication_id.reference).toBe(`${draft.id}.id`);
		expect(code.inputs!.data.literal).toEqual({ list: [`{{${draft.id}.id}}`] });
		expect(code.inputs!.code.literal).toBe('return "{{draft.id}}";');
		expect(JSON.stringify(original)).toBe(snapshot);
	});
});
