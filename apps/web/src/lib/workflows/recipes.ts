import { newStep } from './catalog';
import type { Step, Value } from './api';
import { m } from '$lib/paraglide/messages';
const literal = (literal: Value['literal']): Value => ({ literal });
const reference = (reference: string): Value => ({ reference });

export function recipes() {
	return [
		{
			id: 'draft',
			label: m.workflows_recipe_draft(),
			description: m.workflows_recipe_draft_help()
		},
		{
			id: 'review',
			label: m.workflows_recipe_review(),
			description: m.workflows_recipe_review_help()
		},
		{
			id: 'digest',
			label: m.workflows_recipe_digest(),
			description: m.workflows_recipe_digest_help()
		},
		{
			id: 'dedupe',
			label: m.workflows_recipe_dedupe(),
			description: m.workflows_recipe_dedupe_help()
		},
		{
			id: 'join',
			label: m.workflows_recipe_join(),
			description: m.workflows_recipe_join_help()
		}
	];
}
export function recipeSteps(id: string): Step[] {
	switch (id) {
		case 'draft': {
			const write = newStep('ai_text');
			write.inputs!.instructions = literal(m.workflows_default_instructions());
			const draft = newStep('create_draft');
			draft.inputs!.text = reference(`${write.id}.text`);
			const review = newStep('approval');
			review.inputs!.publication_id = reference(`${draft.id}.id`);
			return [write, draft, review];
		}
		case 'review': {
			const review = newStep('approval');
			const schedule = newStep('schedule');
			schedule.inputs!.publication_id = reference(`${review.id}.publication_id`);
			schedule.inputs!.revision = reference(`${review.id}.revision`);
			return [review, schedule];
		}
		case 'digest': {
			const feed = newStep('read_feed');
			const limit = newStep('list_limit');
			limit.inputs!.items = reference(`${feed.id}.items`);
			const format = newStep('code');
			format.inputs = {
				data: reference(`${limit.id}.items`),
				code: literal('return input.map(item => item.title + "\\n" + item.url).join("\\n\\n");')
			};
			return [feed, limit, format];
		}
		case 'dedupe':
		case 'join': {
			const code = newStep('code');
			code.name = id === 'dedupe' ? m.workflows_recipe_dedupe() : m.workflows_recipe_join();
			code.inputs = {
				data: literal([]),
				code: literal(
					id === 'dedupe'
						? 'const seen = new Set();\nreturn input.filter(item => {\n  const key = JSON.stringify(item);\n  if (seen.has(key)) return false;\n  seen.add(key);\n  return true;\n});'
						: 'return input.map(item => String(item)).join("\\n");'
				)
			};
			return [code];
		}
		default:
			return [];
	}
}
