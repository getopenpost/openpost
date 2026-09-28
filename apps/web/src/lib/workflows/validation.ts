/* oxlint-disable anti-slop/no-runtime-typeof -- This form validator checks arbitrary user-authored JSON literals before publishing or testing a workflow. */
import type { Definition, Value, Step, WorkflowData } from './api';
import { availableReferences } from './catalog';
import { stepFields, type FieldSpec, type Reference } from './fields';
import { m } from '$lib/paraglide/messages';
export type Issue = { node: string; field: string; message: string };
export function referenceExists(reference: string, references: Reference[]): boolean {
	if (!/^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)+$/.test(reference)) return false;
	if (reference.split('.').some((part) => ['__proto__', 'constructor', 'prototype'].includes(part)))
		return false;
	return references.some(
		(item) => item.value === reference || (item.dynamic && reference.startsWith(`${item.value}.`))
	);
}
export function bindingIssue(
	value: Value | undefined,
	references: Reference[],
	required = false
): string {
	if (
		required &&
		!value?.reference &&
		(value?.literal === undefined ||
			value.literal === null ||
			(typeof value.literal === 'string' && !value.literal.trim()))
	)
		return m.workflows_required();
	if (value?.reference && !referenceExists(value.reference, references))
		return m.workflows_invalid_variable({ reference: value.reference });
	if (value?.literal && typeof value.literal === 'object') {
		for (const child of Object.values(value.literal)) {
			const issue = bindingIssue({ literal: child }, references);
			if (issue) return issue;
		}
	}
	if (typeof value?.literal !== 'string') return '';
	const pattern = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*\}\}/g;
	const rest = value.literal.replace(pattern, '');
	if (rest.includes('{{') || rest.includes('}}')) return m.workflows_invalid_syntax();
	for (const token of value.literal.matchAll(pattern))
		if (!referenceExists(token[1], references))
			return m.workflows_invalid_variable({ reference: token[1] });
	return '';
}
export function workflowIssues(definition: Definition, sourceData?: WorkflowData): Issue[] {
	const issues: Issue[] = [];
	const source = definition.source;
	const requiredSource =
		source.kind === 'github_release'
			? 'repository'
			: source.kind === 'rss'
				? 'url'
				: source.kind === 'interval'
					? 'interval_minutes'
					: '';
	if (requiredSource && !source[requiredSource])
		issues.push({ node: 'source', field: requiredSource, message: m.workflows_required() });
	if (
		source.kind === 'interval' &&
		(!Number.isInteger(source.interval_minutes) ||
			Number(source.interval_minutes) < 5 ||
			Number(source.interval_minutes) > 43200)
	)
		issues.push({
			node: 'source',
			field: 'interval_minutes',
			message: m.workflows_interval_help()
		});
	if (
		source.kind === 'github_release' &&
		source.repository &&
		!/^[\w.-]+\/[\w.-]+$/.test(source.repository)
	)
		issues.push({ node: 'source', field: 'repository', message: m.workflows_repository_help() });
	function visit(steps: Step[]) {
		for (const step of steps) {
			const references = availableReferences(definition.steps ?? [], step.id, sourceData);
			for (const field of stepFields(step.kind, step.inputs)) {
				const message = fieldIssue(field, step.inputs?.[field.key], references);
				if (message) issues.push({ node: step.id, field: field.key, message });
			}
			visit(step.then ?? []);
			visit(step.else ?? []);
		}
	}
	visit(definition.steps ?? []);
	return issues;
}
export function resolveDisplay(reference: string, data: WorkflowData): Value['literal'] {
	let value: Value['literal'] = data;
	for (const part of reference.split('.')) {
		if (
			!value ||
			typeof value !== 'object' ||
			['__proto__', 'constructor', 'prototype'].includes(part)
		)
			return undefined;
		value = Object.entries(value).find(([key]) => key === part)?.[1];
	}
	return value;
}

export function fieldIssue(
	field: FieldSpec,
	value: Value | undefined,
	references: Reference[]
): string {
	const issue = field.code
		? field.required && !String(value?.literal ?? '').trim()
			? m.workflows_required()
			: ''
		: bindingIssue(value, references, field.required);
	if (issue) return issue;
	if (value?.reference || value?.literal === undefined || value.literal === '') return '';
	if (field.numeric) {
		const number = Number(value.literal);
		if (
			!Number.isFinite(number) ||
			number < (field.min ?? 0) ||
			number > (field.max ?? Number.MAX_SAFE_INTEGER)
		)
			return m.workflows_invalid_number({
				min: field.min ?? 0,
				max: field.max ?? Number.MAX_SAFE_INTEGER
			});
	}
	if (field.json) {
		try {
			if (typeof value.literal === 'string') JSON.parse(value.literal);
		} catch {
			return m.workflows_invalid_json();
		}
	}
	if (field.key === 'url' && typeof value.literal === 'string' && !value.literal.includes('{{')) {
		try {
			const url = new URL(value.literal);
			if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
				return m.workflows_invalid_url();
		} catch {
			return m.workflows_invalid_url();
		}
	}
	return '';
}
