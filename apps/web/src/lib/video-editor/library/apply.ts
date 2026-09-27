import type { LibraryEntry } from './types';
import type { ProjectAssetImporter } from '../media/types';
import { applyLibraryTextStyle, insertLibrarySelection } from './selection';
import { addTimer } from '../timers/actions';
import { addTextTemplateItem } from '../timeline/actions/items';
import { addEffectTemplates } from '../timeline/actions/effects';
import { applySavedAnimation } from '../timeline/actions/saved-animation';
import { applyTextStylePreset } from '../timeline/actions/text-layout';
import { localizedTextStylePresetCopy } from '../typography/text-style-preset-copy';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { executeAtomic } from '../timeline/commands/command-store.svelte';
import { m } from '$lib/paraglide/messages';

export async function applyLibraryEntry(
	entry: LibraryEntry,
	options: {
		selectedIds: string[];
		importAsset?: ProjectAssetImporter;
		placement?: { from: number; trackId: string };
	}
): Promise<string[]> {
	const recipe = entry.recipe;
	if (recipe.kind === 'text-style') {
		await applyLibraryTextStyle(
			recipe.selection,
			entry.name,
			options.selectedIds,
			options.importAsset
		);
		return [];
	}
	if (recipe.kind === 'selection')
		return insertLibrarySelection(recipe, entry.name, options.importAsset, options.placement);
	if (recipe.kind === 'timer') return [addTimer(recipe.timer, entry.name, options.placement)];
	const selectedIds = options.selectedIds;
	if (recipe.kind === 'text') {
		const texts = selectedIds.filter((id) => timelineStore.itemById.get(id)?.type === 'text');
		if (!texts.length || options.placement)
			return [
				addTextTemplateItem(
					recipe.presetId,
					localizedTextStylePresetCopy(recipe.presetId),
					options.placement
						? {
								frame: options.placement.from,
								preferredTrackId: options.placement.trackId
							}
						: undefined
				)
			];
		executeAtomic('APPLY_LIBRARY_TEXT_STYLE', () => {
			for (const id of texts)
				applyTextStylePreset(
					id,
					recipe.presetId,
					{
						width: sequenceStore.activeWidth,
						height: sequenceStore.activeHeight
					},
					1,
					localizedTextStylePresetCopy(recipe.presetId)
				);
		});
	}
	if (recipe.kind === 'effects' && !addEffectTemplates(selectedIds, recipe.effects))
		throw new Error(m.video_editor_library_select_target());
	if (recipe.kind === 'animation') {
		const result = applySavedAnimation({
			itemIds: selectedIds,
			preset: recipe.preset,
			mode: 'replace',
			retime: true,
			anchorAbsoluteFrame: timelineStore.currentFrame
		});
		if (!result.ok) throw new Error(m.video_editor_library_select_target());
	}
	return [];
}
