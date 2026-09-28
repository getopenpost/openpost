import type { Step } from './api';
import { m } from '$lib/paraglide/messages';
export type Reference = { value: string; label: string; dynamic?: boolean };
export type FieldSpec = {
	key: string;
	label: string;
	required?: boolean;
	multiline?: boolean;
	numeric?: boolean;
	min?: number;
	max?: number;
	code?: boolean;
	json?: boolean;
	options?: { value: string; label: string }[];
};
const field = (
	key: string,
	label: string,
	extra: Omit<FieldSpec, 'key' | 'label'> = {}
): FieldSpec => ({ key, label, ...extra });
export function stepFields(kind: Step['kind'], inputs?: Step['inputs']): FieldSpec[] {
	const required = { required: true };
	const text = field('text', m.workflows_post_text(), { ...required, multiline: true });
	const post = field('publication_id', m.workflows_post(), required);
	const rendition = field('rendition_id', m.workflows_variant(), required);
	const items = field('items', m.workflows_items(), { ...required, json: true });
	const condition = [
		field('left', m.workflows_condition_value(), required),
		field('operator', m.workflows_operator(), {
			...required,
			options: [
				{ value: 'equals', label: m.workflows_equals() },
				{ value: 'not_equals', label: m.workflows_not_equals() },
				{ value: 'contains', label: m.workflows_contains() },
				{ value: 'at_least', label: m.workflows_at_least() },
				{ value: 'greater_than', label: m.workflows_greater_than() },
				{ value: 'less_than', label: m.workflows_less_than() }
			]
		}),
		field('right', m.workflows_compare_with(), required)
	];
	switch (kind) {
		case 'create_draft':
			return [text, field('title', m.workflows_sample_title())];
		case 'build_draft':
			return [text, field('instructions', m.workflows_instructions(), { multiline: true })];
		case 'approval':
			return [post];
		case 'schedule':
			return [
				post,
				field('revision', m.workflows_post_revision(), { ...required, numeric: true }),
				field('minutes', m.workflows_minutes(), { ...required, numeric: true, max: 43200 })
			];
		case 'wait':
			return [field('minutes', m.workflows_minutes(), { ...required, numeric: true, max: 43200 })];
		case 'condition':
			return condition;
		case 'metrics':
			return [rendition, field('max_age_minutes', m.workflows_metric_age(), { numeric: true })];
		case 'reply':
			return [rendition, text];
		case 'http_request':
			return [
				field('method', m.workflows_method(), {
					...required,
					options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((value) => ({
						value,
						label: value
					}))
				}),
				field('url', m.workflows_url(), required),
				field('headers', m.workflows_headers(), { json: true }),
				field('query', m.workflows_query(), { json: true }),
				field('body', m.workflows_body(), { multiline: true }),
				field('timeout', m.workflows_timeout(), { numeric: true, min: 1, max: 30 }),
				field('response_format', m.workflows_response_format(), {
					options: [
						{ value: 'auto', label: m.workflows_response_auto() },
						{ value: 'json', label: m.workflows_response_json() },
						{ value: 'text', label: m.workflows_response_text() }
					]
				})
			];
		case 'code':
			return [
				field('data', m.workflows_data(), { json: true }),
				field('code', m.workflows_code_label(), { ...required, multiline: true, code: true })
			];
		case 'ai_text':
		case 'ai_decision':
			return [
				text,
				field(
					'instructions',
					kind === 'ai_decision' ? m.workflows_decision_criteria() : m.workflows_instructions(),
					{ ...required, multiline: true }
				)
			];
		case 'set_fields':
			return [field('fields', m.workflows_fields_json(), { ...required, json: true })];
		case 'text':
			return [
				text,
				field('operation', m.workflows_operation(), {
					...required,
					options: [
						{ value: 'trim', label: m.workflows_trim() },
						{ value: 'lowercase', label: m.workflows_lowercase() },
						{ value: 'uppercase', label: m.workflows_uppercase() },
						{ value: 'replace', label: m.workflows_replace() },
						{ value: 'strip_html', label: m.workflows_strip_html() },
						{ value: 'truncate', label: m.workflows_truncate() }
					]
				}),
				...(inputs?.operation?.literal === 'replace'
					? [
							field('find', m.workflows_find(), required),
							field('replacement', m.workflows_replacement())
						]
					: []),
				...(inputs?.operation?.literal === 'truncate'
					? [
							field('limit', m.workflows_limit(), {
								...required,
								numeric: true,
								min: 1,
								max: 20000
							})
						]
					: [])
			];
		case 'parse_json':
			return [text];
		case 'list_filter':
			return [items, field('field', m.workflows_item_field(), required), ...condition.slice(1)];
		case 'list_sort':
			return [
				items,
				field('field', m.workflows_item_field(), required),
				field('direction', m.workflows_direction(), {
					options: [
						{ value: 'ascending', label: m.workflows_ascending() },
						{ value: 'descending', label: m.workflows_descending() }
					]
				})
			];
		case 'list_limit':
			return [
				items,
				field('limit', m.workflows_limit(), { ...required, numeric: true, max: 1000 })
			];
		case 'merge':
			return [
				field('first', m.workflows_first(), { ...required, json: true }),
				field('second', m.workflows_second(), { ...required, json: true })
			];
		case 'date':
			return [
				field('date', m.workflows_date_value(), required),
				field('format', m.workflows_date_format(), {
					...required,
					options: [
						{ value: 'iso', label: m.workflows_iso() },
						{ value: 'date', label: m.workflows_date_only() },
						{ value: 'time', label: m.workflows_time_only() },
						{ value: 'readable', label: m.workflows_readable_date() }
					]
				}),
				field('timezone', m.workflows_timezone())
			];
		case 'tracking_link':
			return [
				field('url', m.workflows_url(), required),
				field('source', m.workflows_utm_source(), required),
				field('medium', m.workflows_utm_medium(), required),
				field('campaign', m.workflows_utm_campaign(), required),
				field('content', m.workflows_utm_content()),
				field('term', m.workflows_utm_term())
			];
		case 'read_feed':
			return [field('url', m.workflows_feed_url(), required)];
	}
}
export function outputFields(step: Step): { name: string; dynamic?: boolean }[] {
	const names = (() => {
		switch (step.kind) {
			case 'create_draft':
			case 'build_draft':
				return ['id', 'revision', 'text', 'title', 'status'];
			case 'approval':
				return ['publication_id', 'revision', 'text', 'title', 'approved'];
			case 'metrics':
				return ['likes', 'comments', 'impressions', 'observed_at'];
			case 'condition':
				return ['matched'];
			case 'ai_decision':
				return ['matched', 'reason', 'usage'];
			case 'ai_text':
				return ['text', 'usage'];
			case 'http_request':
				return ['status', 'body', 'headers'];
			case 'code':
			case 'parse_json':
			case 'merge':
				return ['data'];
			case 'list_filter':
			case 'list_sort':
			case 'list_limit':
			case 'read_feed':
				return ['items', 'count'];
			case 'text':
				return ['text', 'length'];
			case 'date':
				return ['text', 'timestamp'];
			case 'tracking_link':
				return ['url'];
			case 'set_fields':
				try {
					return Object.keys(
						// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Field mappings may be saved JSON objects or JSON text still being edited.
						typeof step.inputs?.fields?.literal === 'string'
							? JSON.parse(step.inputs.fields.literal)
							: (step.inputs?.fields?.literal ?? {})
					);
				} catch {
					return [];
				}
			case 'schedule':
				return ['publication_id', 'job_id', 'scheduled_at', 'status'];
			case 'reply':
				return ['rendition_id', 'job_id', 'status'];
			case 'wait':
				return ['until'];
		}
	})();
	return names.map((name) => ({
		name,
		dynamic: ['data', 'body', 'headers', 'items', 'usage'].includes(name)
	}));
}
