import { videoLibrary } from '$lib/video-editor/library/library-store.svelte';
import type { LibraryEntry } from '$lib/video-editor/library/types';
import { buildTextStylePresetTemplate } from '$lib/video-editor/typography/text-style-presets';
import { videoLibraryCatalog } from '$lib/video-editor/library/catalog';
import { editorAuthoredRevision } from './browser-relay';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';

export function videoAgentLibrary(): LibraryEntry[] {
	const builtins = videoLibraryCatalog(
		videoLibrary.scope,
		$state.snapshot(editorSession.project?.animationPresets ?? [])
	);
	const existing = $state.snapshot(videoLibrary.entries);
	const ids = new Set(existing.map((entry) => entry.id));
	return [...existing, ...builtins.filter((entry) => !ids.has(entry.id))];
}
export async function videoLibraryRecord(entry: LibraryEntry, inspect = false) {
	const recipe = entry.recipe;
	const selection =
		recipe.kind === 'selection' ? recipe : recipe.kind === 'text-style' ? recipe.selection : null;
	const dependencies =
		selection?.media.map(({ metadata, blob }) => ({
			id: metadata.id,
			name: metadata.fileName,
			size: blob.size,
			mime_type: blob.type,
			available: blob.size > 0
		})) ?? [];
	const content = selection
		? { kind: recipe.kind, project: selection.project, dependencies }
		: recipe.kind === 'text'
			? {
					...recipe,
					defaults: buildTextStylePresetTemplate(recipe.presetId, {
						width: sequenceStore.activeWidth,
						height: sequenceStore.activeHeight
					})
				}
			: recipe.kind === 'effects'
				? {
						...recipe,
						effects: recipe.effects.map((effect) =>
							effect.kind === 'gpu'
								? {
										...effect,
										params: { ...getGpuEffectDefaultParams(effect.effectId), ...effect.params }
									}
								: effect
						)
					}
				: recipe;
	return {
		id: entry.id,
		name: entry.name,
		kind: recipe.kind,
		collection: entry.collection,
		favorite: entry.favorite,
		device_local: Boolean(selection),
		available: dependencies.every((entry) => entry.available),
		version: await editorAuthoredRevision({ content, slots: entry.slots ?? [] }),
		dependencies,
		slots: entry.slots ?? [],
		recipe: inspect ? content : undefined
	};
}
