/* oxlint-disable anti-slop/no-runtime-typeof -- Workflow bindings contain authored JSON, including nested literal arrays and objects. */
import type { Step, Value } from './api';

// Duplicate a branch as one edit, preserving outside references and remapping
// references inside the copied subtree to the newly allocated step IDs.
export function duplicateStep(original: Step): Step {
	const copy = structuredClone(original);
	const ids = new Map<string, string>();
	function allocate(step: Step) {
		ids.set(step.id, `step_${crypto.randomUUID().slice(0, 8)}`);
		for (const child of [...(step.then ?? []), ...(step.else ?? [])]) allocate(child);
	}
	allocate(copy);
	function reference(path: string) {
		const [id, ...fields] = path.split('.');
		return [ids.get(id) ?? id, ...fields].join('.');
	}
	function literal(value: Value['literal']): Value['literal'] {
		if (typeof value === 'string')
			return value.replace(
				/\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]*)\s*\}\}/g,
				(_token, path: string) => `{{${reference(path)}}}`
			);
		if (Array.isArray(value)) return value.map(literal);
		if (value && typeof value === 'object')
			return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, literal(child)]));
		return value;
	}
	function rewrite(step: Step) {
		step.id = ids.get(step.id)!;
		for (const [key, value] of Object.entries(step.inputs ?? {})) {
			if (step.kind === 'code' && key === 'code') continue;
			if (value.reference) value.reference = reference(value.reference);
			else value.literal = literal(value.literal);
		}
		for (const child of [...(step.then ?? []), ...(step.else ?? [])]) rewrite(child);
	}
	rewrite(copy);
	return copy;
}
