import { outputFields, type Reference } from './fields';
import type { Definition, Step, Value, WorkflowData } from './api';
import type { ThemeIconRole } from '$lib/themes';
import { m } from '$lib/paraglide/messages';
const literal = (value: Value['literal']): Value => ({ literal: value });
const reference = (reference: string): Value => ({ reference });
export type NodeCategory = 'triggers' | 'ai' | 'flow' | 'content' | 'tools' | 'data';

export function actionCategory(kind: Step['kind']): NodeCategory {
	if (['ai_text', 'ai_decision', 'build_draft'].includes(kind)) return 'ai';
	if (['approval', 'wait', 'condition'].includes(kind)) return 'flow';
	if (['create_draft', 'schedule', 'reply', 'metrics'].includes(kind)) return 'content';
	if (['http_request', 'code', 'read_feed'].includes(kind)) return 'tools';
	return 'data';
}

export function sourceIcon(kind: Definition['source']['kind']): ThemeIconRole {
	return (
		{
			manual: 'launch',
			github_release: 'github',
			rss: 'download',
			interval: 'time',
			publication_created: 'compose',
			rendition_published: 'send',
			rendition_failed: 'feedback'
		} as const
	)[kind];
}
export function actionCatalog(): {
	kind: Step['kind'];
	label: string;
	description: string;
	icon: ThemeIconRole;
}[] {
	return [
		{
			kind: 'http_request',
			label: m.workflows_http(),
			description: m.workflows_http_help(),
			icon: 'link'
		},
		{
			kind: 'code',
			label: m.workflows_code(),
			description: m.workflows_code_help(),
			icon: 'code'
		},
		{
			kind: 'ai_text',
			label: m.workflows_ai_text(),
			description: m.workflows_ai_text_help(),
			icon: 'sparkles'
		},
		{
			kind: 'ai_decision',
			label: m.workflows_ai_decision(),
			description: m.workflows_ai_decision_help(),
			icon: 'assistant'
		},
		{
			kind: 'set_fields',
			label: m.workflows_fields(),
			description: m.workflows_fields_help(),
			icon: 'edit'
		},
		{ kind: 'text', label: m.workflows_text(), description: m.workflows_text_help(), icon: 'edit' },
		{
			kind: 'parse_json',
			label: m.workflows_parse_json(),
			description: m.workflows_parse_json_help(),
			icon: 'code'
		},
		{
			kind: 'list_filter',
			label: m.workflows_list_filter(),
			description: m.workflows_list_filter_help(),
			icon: 'filter'
		},
		{
			kind: 'list_sort',
			label: m.workflows_list_sort(),
			description: m.workflows_list_sort_help(),
			icon: 'sort'
		},
		{
			kind: 'list_limit',
			label: m.workflows_list_limit(),
			description: m.workflows_list_limit_help(),
			icon: 'filter'
		},
		{
			kind: 'merge',
			label: m.workflows_merge(),
			description: m.workflows_merge_help(),
			icon: 'repeat'
		},
		{
			kind: 'date',
			label: m.workflows_date(),
			description: m.workflows_date_help(),
			icon: 'calendar'
		},
		{
			kind: 'tracking_link',
			label: m.workflows_tracking_link(),
			description: m.workflows_tracking_link_help(),
			icon: 'link'
		},
		{
			kind: 'read_feed',
			label: m.workflows_read_feed(),
			description: m.workflows_read_feed_help(),
			icon: 'download'
		},
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
			icon: 'share'
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
		rendition_published: m.workflows_published(),
		interval: m.workflows_interval(),
		publication_created: m.workflows_post_created(),
		rendition_failed: m.workflows_post_failed()
	}[kind];
}
export function newStep(kind: Step['kind']): Step {
	const id = `step_${crypto.randomUUID().slice(0, 8)}`;
	const inputs: Record<string, Value> = {};
	type NodeDefaults = Partial<Record<Step['kind'], Step['inputs']>>;
	const defaults: NodeDefaults = {
		http_request: {
			method: literal('GET'),
			url: literal(''),
			headers: literal({}),
			query: literal({}),
			body: literal(''),
			timeout: literal(20),
			response_format: literal('auto')
		},
		code: { data: reference('source.body'), code: literal('return { text: String(input) };') },
		ai_text: {
			text: reference('source.body'),
			instructions: literal('')
		},
		ai_decision: {
			text: reference('source.body'),
			instructions: literal('')
		},
		set_fields: { fields: literal({}) },
		text: { text: reference('source.body'), operation: literal('trim'), limit: literal(280) },
		parse_json: { text: reference('source.body') },
		list_filter: {
			items: literal([]),
			field: literal('title'),
			operator: literal('contains'),
			right: literal('')
		},
		list_sort: { items: literal([]), field: literal('title'), direction: literal('ascending') },
		list_limit: { items: literal([]), limit: literal(5) },
		merge: { first: literal({}), second: literal({}) },
		date: {
			date: reference('source.published_at'),
			format: literal('date'),
			timezone: literal('UTC')
		},
		tracking_link: {
			url: reference('source.url'),
			source: literal('social'),
			medium: literal('organic'),
			campaign: literal('')
		},
		read_feed: { url: literal('') }
	};
	Object.assign(inputs, defaults[kind]);
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
	if (kind === 'condition' || kind === 'ai_decision') {
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
	const node = (id: string, kind: Step['kind'], inputs: Record<string, Value>): Step => ({
		...newStep(kind),
		id,
		inputs
	});
	return [
		{
			id: 'digest',
			name: m.workflows_template_digest(),
			description: m.workflows_template_digest_help(),
			definition: {
				schema: 1,
				source: { kind: 'interval', interval_minutes: 10080 },
				steps: [
					node('feed', 'read_feed', { url: literal('') }),
					node('limit', 'list_limit', { items: reference('feed.items'), limit: literal(5) }),
					node('digest', 'code', {
						data: reference('limit.items'),
						code: literal('return input.map(item => item.title + "\\n" + item.url).join("\\n\\n");')
					}),
					{ ...draft, inputs: { ...draft.inputs, text: reference('digest.data') } },
					approval
				]
			}
		},
		{
			id: 'decision',
			name: m.workflows_template_decision(),
			description: m.workflows_template_decision_help(),
			definition: {
				schema: 1,
				source: { kind: 'github_release', repository: '' },
				steps: [
					{
						...node('decision', 'ai_decision', {
							text: reference('source.body'),
							instructions: literal(m.workflows_default_criteria())
						}),
						then: [draft, approval],
						else: []
					}
				]
			}
		},
		{
			id: 'api',
			name: m.workflows_template_request(),
			description: m.workflows_template_request_help(),
			definition: {
				schema: 1,
				source: { kind: 'manual' },
				steps: [
					node('request', 'http_request', {
						method: literal('GET'),
						url: literal(''),
						timeout: literal(20),
						response_format: literal('json')
					}),
					node('format', 'code', {
						data: reference('request.body'),
						code: literal('return JSON.stringify(input, null, 2);')
					}),
					{ ...draft, inputs: { ...draft.inputs, text: reference('format.data') } },
					approval
				]
			}
		},
		{
			id: 'weekly',
			name: m.workflows_template_weekly(),
			description: m.workflows_template_weekly_help(),
			definition: {
				schema: 1,
				source: { kind: 'interval', interval_minutes: 10080 },
				steps: [
					node('write', 'ai_text', {
						text: literal(''),
						instructions: literal(m.workflows_default_instructions())
					}),
					{ ...draft, inputs: { ...draft.inputs, text: reference('write.text') } },
					approval
				]
			}
		},
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
export function exampleSource(kind: Definition['source']['kind']): WorkflowData {
	const data: WorkflowData = {
		id: 'sample',
		title: 'A new release',
		body: 'What changed and why it matters.',
		url: 'https://example.com/update',
		published_at: new Date().toISOString()
	};
	if (
		kind === 'publication_created' ||
		kind === 'rendition_published' ||
		kind === 'rendition_failed'
	)
		data.publication_id = 'sample-post';
	if (kind === 'rendition_published' || kind === 'rendition_failed') {
		data.rendition_id = 'sample-variant';
		data.account_id = 'sample-account';
	}
	if (kind === 'interval') {
		data.title = 'Scheduled workflow';
		data.body = '';
		data.url = '';
	}
	return data;
}
export function availableReferences(
	steps: Step[],
	selectedID: string,
	sourceData?: WorkflowData
): Reference[] {
	const sources: Reference[] = (
		sourceData === undefined
			? [
					'title',
					'body',
					'url',
					'published_at',
					'publication_id',
					'rendition_id',
					'id',
					'account_id'
				]
			: []
	).map((field) => ({
		value: `source.${field}`,
		label: `${m.workflows_source()}: ${field}`
	}));
	/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-object-parameters -- Discover fields in user-authored sample JSON, including nested arrays, without prescribing a source schema. */
	if (sourceData && typeof sourceData === 'object') {
		function observe(data: object, path: string, depth: number) {
			if (depth > 5) return;
			for (const [key, value] of Object.entries(data).slice(0, 200)) {
				const name = `${path}.${key}`;
				sources.push({
					value: name,
					label: `${m.workflows_source()}: ${name.slice(7)}`
				});
				if (value && typeof value === 'object') observe(value, name, depth + 1);
			}
		}
		observe(sourceData, 'source', 0);
	} else
		sources.push({
			value: 'source',
			label: m.workflows_source(),
			dynamic: true
		});
	/* oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-object-parameters */
	function visit(list: Step[], available: typeof sources): typeof sources | undefined {
		let current = [...available];
		for (const step of list) {
			if (step.id === selectedID) return current;
			const fields = outputFields(step);
			current = [
				...current,
				...fields.map(({ name, dynamic }) => ({
					value: `${step.id}.${name}`,
					label: `${step.name}: ${name}`,
					dynamic
				}))
			];
			const branch = visit(step.then ?? [], current) ?? visit(step.else ?? [], current);
			if (branch) return branch;
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
