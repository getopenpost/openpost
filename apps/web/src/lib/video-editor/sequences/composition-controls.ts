import {
	COMPOSITION_CONTROLS_VERSION,
	type CompositionControlDefinition,
	type CompositionControlKind,
	type CompositionControlOverrides,
	type CompositionControlProperty,
	type CompositionControlSchema,
	type TimelineItem
} from '../project/types';
import type { JsonValue } from '../project-bundle/snapshot-types';
import { z } from 'zod';

export interface CompositionControlCandidate {
	targetItemId: string;
	targetLabel: string;
	property: CompositionControlProperty;
	kind: CompositionControlKind;
	defaultValue: string;
}

function storedItems(items: readonly TimelineItem[]): TimelineItem[] {
	return Array.isArray(items) ? items : Array.from(items);
}

function readControlValue(item: TimelineItem, property: CompositionControlProperty): string | null {
	switch (property) {
		case 'text.text':
			return item.type === 'text' && !item.textSpans?.length ? (item.text ?? '') : null;
		case 'text.color':
			return item.type === 'text' && !item.textSpans?.length ? (item.color ?? '#ffffff') : null;
		case 'shape.fillColor':
			return item.type === 'shape' && item.fillType !== 'linear'
				? (item.fillColor ?? '#f97316')
				: null;
		case 'shape.strokeColor':
			return item.type === 'shape' && item.strokeEnabled ? (item.strokeColor ?? '#ffffff') : null;
	}
}

export function getCompositionControlSourceValue(
	items: readonly TimelineItem[],
	control: Pick<CompositionControlDefinition, 'targetItemId' | 'property' | 'defaultValue'>
): string {
	const target = items.find((item) => item.id === control.targetItemId);
	return (target && readControlValue(target, control.property)) ?? control.defaultValue;
}

export function getCompositionControlCandidates(
	items: readonly TimelineItem[]
): CompositionControlCandidate[] {
	return items.flatMap((item) => {
		const properties: Array<[CompositionControlProperty, CompositionControlKind]> =
			item.type === 'text'
				? [
						['text.text', 'text'],
						['text.color', 'color']
					]
				: item.type === 'shape'
					? [
							['shape.fillColor', 'color'],
							['shape.strokeColor', 'color']
						]
					: [];
		return properties.flatMap(([property, kind]) => {
			const defaultValue = readControlValue(item, property);
			return defaultValue === null
				? []
				: [{ targetItemId: item.id, targetLabel: item.label, property, kind, defaultValue }];
		});
	});
}

function applyControlValue(
	item: TimelineItem,
	property: CompositionControlProperty,
	value: string
): TimelineItem {
	switch (property) {
		case 'text.text':
			return item.type === 'text' && !item.textSpans?.length && item.text !== value
				? { ...item, text: value }
				: item;
		case 'text.color':
			return item.type === 'text' && !item.textSpans?.length && item.color !== value
				? { ...item, color: value }
				: item;
		case 'shape.fillColor':
			return item.type === 'shape' && item.fillType !== 'linear' && item.fillColor !== value
				? { ...item, fillColor: value }
				: item;
		case 'shape.strokeColor':
			return item.type === 'shape' && item.strokeColor !== value
				? { ...item, strokeColor: value }
				: item;
	}
}

export function applyCompositionControlOverrides(
	items: readonly TimelineItem[],
	schema: CompositionControlSchema | undefined,
	overrides: CompositionControlOverrides | undefined
): TimelineItem[] {
	if (!schema?.controls.length || !overrides || Object.keys(overrides).length === 0) {
		return storedItems(items);
	}
	const controlsByItemId = new Map<string, CompositionControlDefinition[]>();
	for (const control of schema.controls) {
		if (overrides[control.id] === undefined) continue;
		const controls = controlsByItemId.get(control.targetItemId);
		if (controls) controls.push(control);
		else controlsByItemId.set(control.targetItemId, [control]);
	}
	let changed = false;
	const resolved = items.map((item) => {
		const controls = controlsByItemId.get(item.id);
		if (!controls) return item;
		let next = item;
		for (const control of controls) {
			next = applyControlValue(next, control.property, overrides[control.id]);
		}
		changed ||= next !== item;
		return next;
	});
	return changed ? resolved : storedItems(items);
}

const compositionControlInputSchema = z.object({
	version: z.literal(COMPOSITION_CONTROLS_VERSION),
	controls: z
		.array(
			z.object({
				id: z.string().trim().min(1).max(100),
				name: z.string().trim().min(1).max(120),
				targetItemId: z.string().trim().min(1).max(100),
				property: z.enum(['text.text', 'text.color', 'shape.fillColor', 'shape.strokeColor']),
				kind: z.enum(['text', 'color']),
				defaultValue: z.string().max(100_000).optional()
			})
		)
		.max(1_000)
});

export function sanitizeCompositionControlSchema(
	value: JsonValue | CompositionControlSchema | undefined,
	items: readonly TimelineItem[]
): CompositionControlSchema | undefined {
	const parsed = compositionControlInputSchema.safeParse(value);
	if (!parsed.success) return undefined;
	const itemById = new Map(items.map((item) => [item.id, item]));
	const seenIds = new Set<string>();
	const seenTargets = new Set<string>();
	const controls: CompositionControlDefinition[] = [];
	for (const entry of parsed.data.controls) {
		const { id, name, targetItemId } = entry;
		const target = itemById.get(targetItemId);
		if (!target) continue;
		const sourceValue = readControlValue(target, entry.property);
		const kind: CompositionControlKind = entry.property === 'text.text' ? 'text' : 'color';
		const targetKey = `${targetItemId}:${entry.property}`;
		if (
			sourceValue === null ||
			entry.kind !== kind ||
			seenIds.has(id) ||
			seenTargets.has(targetKey)
		) {
			continue;
		}
		seenIds.add(id);
		seenTargets.add(targetKey);
		controls.push({
			id,
			name,
			targetItemId,
			property: entry.property,
			kind,
			defaultValue: entry.defaultValue ?? sourceValue
		});
	}
	return controls.length > 0 ? { version: COMPOSITION_CONTROLS_VERSION, controls } : undefined;
}
