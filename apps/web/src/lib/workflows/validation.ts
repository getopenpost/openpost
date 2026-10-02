import { referenceTokens, referenceParts } from './reference-path';
/* oxlint-disable anti-slop/no-runtime-typeof -- This form validator checks arbitrary user-authored JSON literals before publishing or testing a workflow. */
import type { Definition, Value, Step, WorkflowData } from './api';
import { availableReferences } from './catalog';
import { stepFields, type FieldSpec, type Reference } from './fields';
import { m } from '$lib/paraglide/messages';
export type Issue = { node: string; field: string; message: string };
export function referenceExists(reference: string, references: Reference[]): boolean {
	const parts = referenceParts(reference);
	if (!parts || parts.length < 2) return false;
	return references.some((item) => {
		const candidate = referenceParts(item.value);
		return (
			candidate &&
			(item.dynamic || candidate.length === parts.length) &&
			candidate.every((key, i) => parts[i] === key)
		);
	});
}
function missingValue(value: Value | undefined): boolean {
	return (
		!value?.reference &&
		(value?.literal === undefined ||
			value.literal === null ||
			(typeof value.literal === 'string' && !value.literal.trim()))
	);
}
function bindingIssue(value: Value | undefined, references: Reference[], required = false): string {
	if (required && missingValue(value)) return m.workflows_required();
	if (value?.reference && !referenceExists(value.reference, references))
		return m.workflows_invalid_variable({ reference: value.reference });
	if (value?.literal && typeof value.literal === 'object') {
		for (const child of Object.values(value.literal)) {
			const issue = bindingIssue({ literal: child }, references);
			if (issue) return issue;
		}
	}
	if (typeof value?.literal !== 'string') return '';
	return interpolationIssue(value.literal, references);
}

function interpolationIssue(text: string, references: Reference[]): string {
	const pattern = referenceTokens();
	const rest = text.replace(pattern, '');
	if (rest.includes('{{') || rest.includes('}}')) return m.workflows_invalid_syntax();
	for (const token of text.matchAll(pattern))
		if (!referenceExists(token[1], references))
			return m.workflows_invalid_variable({ reference: token[1] });
	return '';
}
export function workflowIssues(definition: Definition, sourceData?: WorkflowData[string]): Issue[] {
	const issues: Issue[] = [];
	const source = definition.source;
	const requiredSource =
		source.kind === 'github_release'
			? 'repository'
			: source.kind === 'interval'
				? 'interval_minutes'
				: '';
	if (source.kind === 'rss') {
		const message = feedURLIssue(source.url);
		if (message) issues.push({ node: 'source', field: 'url', message });
	}
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
	const parts = referenceParts(reference);
	if (!parts) return undefined;
	for (const part of parts) {
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
	if (field.code)
		return field.required && !String(value?.literal ?? '').trim() ? m.workflows_required() : '';
	if (field.json && typeof value?.literal === 'string' && value.literal.trim()) {
		try {
			value = { ...value, literal: JSON.parse(value.literal) };
		} catch {
			return m.workflows_invalid_json();
		}
	}
	const issue = bindingIssue(value, references, field.required);
	if (issue) return issue;
	if (value?.reference || value?.literal === undefined || value.literal === '') return '';
	if (field.numeric) return numberIssue(value.literal, field.min, field.max);
	if (field.key === 'url') return urlIssue(value.literal);
	return '';
}

function numberIssue(value: Value['literal'], min = 0, max = Number.MAX_SAFE_INTEGER): string {
	const number = Number(value);
	return !Number.isFinite(number) || number < min || number > max
		? m.workflows_invalid_number({ min, max })
		: '';
}

function urlIssue(value: Value['literal']): string {
	if (typeof value !== 'string' || value.includes('{{')) return '';
	try {
		const url = new URL(value);
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
			return m.workflows_invalid_url();
	} catch {
		return m.workflows_invalid_url();
	}
	return '';
}

export function feedURLIssue(value: string | undefined): string {
	if (!value?.trim()) return m.workflows_required();
	const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1];
	if (!authority || authority.includes('@') || value !== value.trim())
		return m.workflows_invalid_url();
	try {
		const url = new URL(value);
		if (!url.hostname) return m.workflows_invalid_url();
	} catch {
		return m.workflows_invalid_url();
	}
	return '';
}
