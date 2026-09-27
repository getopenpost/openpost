import type { Definition, Step, Value } from './api';
import type { ThemeIconRole } from '$lib/themes';
import { m } from '$lib/paraglide/messages';
const literal = (value: Value['literal']): Value => ({ literal: value });
const reference = (reference: string): Value => ({ reference });
export function actionCatalog(): {
	kind: Step['kind'];
	label: string;
	description: string;
	icon: ThemeIconRole;
}[] {
	return [
		{
			kind: 'create_draft',
			label: m.workflows_create_draft(),
			description: m.workflows_create_draft_help(),
			icon: 'compose'
		},
		{
			kind: 'build_draft',
			label: m.workflows_build_draft(),
			description: m.workflows_build_draft_help(),
			icon: 'sparkles'
		},
		{
			kind: 'approval',
			label: m.workflows_approval(),
			description: m.workflows_approval_help(),
			icon: 'check'
		},
		{
			kind: 'schedule',
			label: m.workflows_schedule(),
			description: m.workflows_schedule_help(),
			icon: 'calendar'
		},
		{ kind: 'wait', label: m.workflows_wait(), description: m.workflows_wait_help(), icon: 'time' },
		{
			kind: 'condition',
			label: m.workflows_condition(),
			description: m.workflows_condition_help(),
			icon: 'filter'
		},
		{
			kind: 'metrics',
			label: m.workflows_metrics(),
			description: m.workflows_metrics_help(),
			icon: 'analytics'
		},
		{
			kind: 'reply',
			label: m.workflows_reply(),
			description: m.workflows_reply_help(),
			icon: 'communications'
		}
	];
}
export function sourceLabel(kind: Definition['source']['kind']): string {
	return {
		manual: m.workflows_manual(),
		github_release: m.workflows_github(),
		rss: m.workflows_rss(),
		rendition_published: m.workflows_published()
	}[kind];
}
export function newStep(kind: Step['kind']): Step {
	const id = `step_${crypto.randomUUID().slice(0, 8)}`;
	const inputs: Record<string, Value> = {};
	if (kind === 'create_draft' || kind === 'build_draft') {
		inputs.text = literal('{{source.title}}\n\n{{source.body}}\n\n{{source.url}}');
		inputs.account_ids = literal([]);
	}
	if (kind === 'wait' || kind === 'schedule') inputs.minutes = literal(60);
	if (kind === 'schedule') {
		inputs.publication_id = literal('');
		inputs.revision = literal(1);
	}
	if (kind === 'approval') inputs.publication_id = literal('');
	if (kind === 'reply' || kind === 'metrics')
		inputs.rendition_id = reference('source.rendition_id');
	if (kind === 'reply') inputs.text = literal('');
	if (kind === 'metrics') inputs.max_age_minutes = literal(60);
	if (kind === 'condition') {
		inputs.left = reference('source.title');
		inputs.operator = literal('contains');
		inputs.right = literal('');
	}
	const step: Step = {
		id,
		kind,
		name: actionCatalog().find((item) => item.kind === kind)?.label ?? kind,
		inputs
	};
	if (kind === 'condition') {
		step.then = [];
		step.else = [];
	}
	return step;
}
export function templates(): {
	id: string;
	name: string;
	description: string;
	definition: Definition;
}[] {
	const draft: Step = {
		id: 'draft',
		kind: 'create_draft',
		name: m.workflows_create_draft(),
		inputs: {
			text: literal('{{source.title}}\n\n{{source.body}}\n\n{{source.url}}'),
			title: reference('source.title'),
			account_ids: literal([])
		}
	};
	const approval: Step = {
		id: 'review',
		kind: 'approval',
		name: m.workflows_approval(),
		inputs: { publication_id: reference('draft.id') }
	};
	return [
		{
			id: 'github',
			name: m.workflows_release_template(),
			description: m.workflows_release_template_help(),
			definition: {
				schema: 1,
				source: { kind: 'github_release', repository: '' },
				steps: [draft, approval]
			}
		},
		{
			id: 'rss',
			name: m.workflows_feed_template(),
			description: m.workflows_feed_template_help(),
			definition: { schema: 1, source: { kind: 'rss', url: '' }, steps: [draft, approval] }
		},
		{
			id: 'rss-schedule',
			name: m.workflows_schedule_template(),
			description: m.workflows_schedule_template_help(),
			definition: {
				schema: 1,
				source: { kind: 'rss', url: '' },
				steps: [
					draft,
					approval,
					{
						id: 'schedule',
						kind: 'schedule',
						name: m.workflows_schedule(),
						inputs: {
							publication_id: reference('review.publication_id'),
							revision: reference('review.revision'),
							minutes: literal(60)
						}
					}
				]
			}
		},
		{
			id: 'followup',
			name: m.workflows_reply_template(),
			description: m.workflows_reply_template_help(),
			definition: {
				schema: 1,
				source: { kind: 'rendition_published' },
				steps: [
					{ id: 'wait', kind: 'wait', name: m.workflows_wait(), inputs: { minutes: literal(60) } },
					{
						id: 'reply',
						kind: 'reply',
						name: m.workflows_reply(),
						inputs: { rendition_id: reference('source.rendition_id'), text: literal('') }
					}
				]
			}
		}
	];
}
export function findStep(steps: Step[], id: string): Step | undefined {
	for (const step of steps) {
		if (step.id === id) return step;
		const child = findStep(step.then ?? [], id) ?? findStep(step.else ?? [], id);
		if (child) return child;
	}
}
export function editSteps(
	steps: Step[],
	id: string,
	edit: (step: Step, siblings: Step[], index: number) => void
): boolean {
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		if (step.id === id) {
			edit(step, steps, i);
			return true;
		}
		if (editSteps(step.then ?? [], id, edit) || editSteps(step.else ?? [], id, edit)) return true;
	}
	return false;
}
export function availableReferences(
	steps: Step[],
	selectedID: string
): { value: string; label: string }[] {
	const sources = ['title', 'body', 'url', 'published_at', 'publication_id', 'rendition_id'].map(
		(field) => ({ value: `source.${field}`, label: `${m.workflows_source()}: ${field}` })
	);
	function visit(list: Step[], available: typeof sources): typeof sources | undefined {
		let current = [...available];
		for (const step of list) {
			if (step.id === selectedID) return current;
			const branch = visit(step.then ?? [], current) ?? visit(step.else ?? [], current);
			if (branch) return branch;
			const fields =
				step.kind === 'create_draft' || step.kind === 'build_draft'
					? ['id', 'revision', 'text', 'title']
					: step.kind === 'approval'
						? ['publication_id', 'revision']
						: step.kind === 'metrics'
							? ['likes', 'comments', 'impressions', 'observed_at']
							: [];
			current = [
				...current,
				...fields.map((field) => ({
					value: `${step.id}.${field}`,
					label: `${step.name}: ${field}`
				}))
			];
		}
	}
	return visit(steps, sources) ?? sources;
}
export function runStateLabel(state: string): string {
	switch (state) {
		case 'queued':
			return m.workflows_queued();
		case 'running':
			return m.workflows_running();
		case 'waiting':
			return m.workflows_waiting();
		case 'awaiting_approval':
			return m.workflows_awaiting_approval();
		case 'succeeded':
			return m.workflows_succeeded();
		case 'failed':
			return m.workflows_failed();
		case 'cancelled':
			return m.workflows_cancelled();
		default:
			return state;
	}
}
