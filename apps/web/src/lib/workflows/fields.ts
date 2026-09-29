/* oxlint-disable anti-slop/no-runtime-typeof -- Authored JSON fields can be stored as structured literals or editor text; parse the text before discovering their output keys. */
import type { Step } from './api';
import { m } from '$lib/paraglide/messages';
export type Reference = { value: string; label: string; dynamic?: boolean };
export type FieldSpec = {
	key: string;
	label: string;
	required?: boolean;
	multiline?: boolean;
	numeric?: boolean;
	preserveReferenceType?: boolean;
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
	const text = field('text', m.workflows_post_text(), {
		...required,
		multiline: true
	});
	const inputText = field('text', m.workflows_text_input(), {
		...required,
		multiline: true
	});
	const post = field('publication_id', m.workflows_post(), required);
	const rendition = field('rendition_id', m.workflows_variant(), required);
	const items = field('items', m.workflows_items(), {
		...required,
		json: true
	});
	const condition = [
		field('left', m.workflows_condition_value(), { ...required, preserveReferenceType: true }),
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
		field('right', m.workflows_compare_with(), { ...required, preserveReferenceType: true })
	];
	const definitions = {
		create_draft: () => [text, field('title', m.workflows_sample_title())],
		build_draft: () => [
			text,
			field('instructions', m.workflows_instructions(), { multiline: true })
		],
		approval: () => [post],
		schedule: () => [
			post,
			field('revision', m.workflows_post_revision(), {
				...required,
				numeric: true
			}),
			field('minutes', m.workflows_minutes(), {
				...required,
				numeric: true,
				max: 43200
			})
		],
		wait: () => [
			field('minutes', m.workflows_minutes(), {
				...required,
				numeric: true,
				max: 43200
			})
		],
		condition: () => condition,
		metrics: () => [
			rendition,
			field('max_age_minutes', m.workflows_metric_age(), { numeric: true })
		],
		reply: () => [rendition, text],
		http_request: () => [
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
			field('timeout', m.workflows_timeout(), {
				numeric: true,
				min: 1,
				max: 30
			}),
			field('response_format', m.workflows_response_format(), {
				options: [
					{ value: 'auto', label: m.workflows_response_auto() },
					{ value: 'json', label: m.workflows_response_json() },
					{ value: 'text', label: m.workflows_response_text() }
				]
			})
		],
		code: () => [
			field('data', m.workflows_data(), { json: true }),
			field('code', m.workflows_code_label(), {
				...required,
				multiline: true,
				code: true
			})
		],
		ai_text: () => [
			field('instructions', m.workflows_system_message(), { multiline: true }),
			field('text', m.workflows_user_message(), {
				...required,
				multiline: true
			})
		],
		ai_decision: () => [
			field('text', m.workflows_decision_input(), {
				...required,
				multiline: true
			}),
			field('instructions', m.workflows_decision_criteria(), {
				...required,
				multiline: true
			})
		],
		set_fields: () => [field('fields', m.workflows_fields_json(), { ...required, json: true })],
		text: () => [
			inputText,
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
		],
		parse_json: () => [inputText],
		list_filter: () => [
			items,
			field('field', m.workflows_item_field(), required),
			...condition.slice(1)
		],
		list_sort: () => [
			items,
			field('field', m.workflows_item_field(), required),
			field('direction', m.workflows_direction(), {
				options: [
					{ value: 'ascending', label: m.workflows_ascending() },
					{ value: 'descending', label: m.workflows_descending() }
				]
			})
		],
		list_limit: () => [
			items,
			field('limit', m.workflows_limit(), {
				...required,
				numeric: true,
				max: 1000
			})
		],
		merge: () => [
			field('first', m.workflows_first(), { ...required, json: true }),
			field('second', m.workflows_second(), { ...required, json: true })
		],
		date: () => [
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
		],
		tracking_link: () => [
			field('url', m.workflows_url(), required),
			field('source', m.workflows_utm_source(), required),
			field('medium', m.workflows_utm_medium(), required),
			field('campaign', m.workflows_utm_campaign(), required),
			field('content', m.workflows_utm_content()),
			field('term', m.workflows_utm_term())
		],
		read_feed: () => [field('url', m.workflows_feed_url(), required)]
	} satisfies Record<Step['kind'], () => FieldSpec[]>;
	return definitions[kind]();
}
const outputs = {
	create_draft: ['id', 'revision', 'text', 'title', 'status'],
	build_draft: ['id', 'revision', 'text', 'title', 'status'],
	approval: ['publication_id', 'revision', 'text', 'title', 'approved'],
	metrics: ['likes', 'comments', 'impressions', 'observed_at'],
	condition: ['matched'],
	ai_decision: ['matched', 'probability', 'reason', 'usage'],
	ai_text: ['text', 'usage'],
	http_request: ['status', 'body', 'headers'],
	code: ['data'],
	parse_json: ['data'],
	merge: ['data'],
	list_filter: ['items', 'count'],
	list_sort: ['items', 'count'],
	list_limit: ['items', 'count'],
	read_feed: ['items', 'count'],
	text: ['text', 'length'],
	date: ['text', 'timestamp'],
	tracking_link: ['url'],
	schedule: ['publication_id', 'job_id', 'scheduled_at', 'status', 'renditions'],
	reply: ['rendition_id', 'job_id', 'status'],
	wait: ['until']
} satisfies Record<Exclude<Step['kind'], 'set_fields'>, string[]>;

export function outputFields(step: Step): { name: string; dynamic?: boolean }[] {
	if (step.kind !== 'set_fields')
		return outputs[step.kind].map((name) => ({
			name,
			dynamic: ['data', 'body', 'headers', 'items', 'usage', 'renditions'].includes(name)
		}));
	try {
		// Field mappings may be saved objects or JSON text still being edited.
		// oxlint-disable-next-line anti-slop/no-runtime-typeof
		const fields =
			typeof step.inputs?.fields?.literal === 'string'
				? JSON.parse(step.inputs.fields.literal)
				: (step.inputs?.fields?.literal ?? {});
		return Object.keys(fields).map((name) => ({ name, dynamic: true }));
	} catch {
		return [];
	}
}
