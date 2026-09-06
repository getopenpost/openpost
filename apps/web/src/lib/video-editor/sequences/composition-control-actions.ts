import {
	COMPOSITION_CONTROLS_VERSION,
	type CompositionControlDefinition,
	type CompositionControlKind,
	type CompositionControlProperty
} from '../project/types';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { sequenceStore } from './sequence-store.svelte';
import { getCompositionControlCandidates } from './composition-controls';

export interface AddCompositionControlInput {
	name: string;
	targetItemId: string;
	property: CompositionControlProperty;
	kind: CompositionControlKind;
	defaultValue: string;
}

function source(compositionId: string) {
	const composition = sequenceStore.compositionById.get(compositionId);
	if (!composition || composition.editorKind !== 'composite-2d') return null;
	return {
		composition,
		items:
			sequenceStore.activeSequenceId === compositionId ? timelineStore.items : composition.items,
		controls: composition.compositionControls?.controls ?? []
	};
}

function commit(compositionId: string, controls: CompositionControlDefinition[]): void {
	sequenceStore.updateComposition(compositionId, {
		compositionControls:
			controls.length > 0 ? { version: COMPOSITION_CONTROLS_VERSION, controls } : undefined
	});
}

export function addCompositionControl(
	compositionId: string,
	input: AddCompositionControlInput
): string | null {
	return execute(
		'ADD_COMPOSITION_CONTROL',
		() => {
			const current = source(compositionId);
			const name = input.name.trim();
			if (!current || !name || name.length > 120 || current.controls.length >= 1_000) return null;
			const candidate = getCompositionControlCandidates(current.items).find(
				(entry) => entry.targetItemId === input.targetItemId && entry.property === input.property
			);
			if (!candidate || candidate.kind !== input.kind) return null;
			if (
				current.controls.some(
					(control) =>
						control.targetItemId === input.targetItemId && control.property === input.property
				)
			) {
				return null;
			}
			const id = crypto.randomUUID();
			commit(compositionId, [
				...current.controls,
				{
					id,
					name,
					targetItemId: candidate.targetItemId,
					property: candidate.property,
					kind: candidate.kind,
					defaultValue: candidate.defaultValue
				}
			]);
			return id;
		},
		{ compositionId, property: input.property }
	);
}

export function renameCompositionControl(
	compositionId: string,
	controlId: string,
	name: string
): boolean {
	const trimmed = name.trim();
	if (!trimmed || trimmed.length > 120) return false;
	return execute(
		'RENAME_COMPOSITION_CONTROL',
		() => {
			const current = source(compositionId);
			const control = current?.controls.find((candidate) => candidate.id === controlId);
			if (!current || !control || control.name === trimmed) return false;
			commit(
				compositionId,
				current.controls.map((candidate) =>
					candidate.id === controlId ? { ...candidate, name: trimmed } : candidate
				)
			);
			return true;
		},
		{ compositionId, controlId }
	);
}

export function removeCompositionControl(compositionId: string, controlId: string): boolean {
	return execute(
		'REMOVE_COMPOSITION_CONTROL',
		() => {
			const current = source(compositionId);
			if (!current?.controls.some((control) => control.id === controlId)) return false;
			commit(
				compositionId,
				current.controls.filter((control) => control.id !== controlId)
			);
			return true;
		},
		{ compositionId, controlId }
	);
}
