import { reusableBlockHold } from '../sequences/reusable-block';
import { trackRangeIsOpen } from '../timeline/track-occupancy';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import { detachedTransformParentBinding } from '../timeline/actions/transform-parenting';
import { getCompositionControlCandidates } from '../sequences/composition-controls';
import { COMPOSITION_CONTROLS_VERSION } from '../project/types';
import { loadProjectFontAssets } from '../typography/project-font-assets';
import { editorSession } from '../editor.svelte';
import { createExportableSequences } from '../export/exportable-sequences';
import { captureSnapshot } from '../timeline/commands/snapshot.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { snapshotTimelineState } from '../timeline/utils/state-snapshot.svelte';
import { expandSelectionWithLinkedItems } from '../timeline/utils/linked-items';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { cloneProjectDocument } from '../project/project-clone';
import { mediaPool } from '../media/pool.svelte';
import { importCollectedFont, importCopiedFile, resolveMediaBlob } from '../media/import.svelte';
import { executeAtomic } from '../timeline/commands/command-store.svelte';
import { ensureOpenTrackForRange } from '../timeline/actions/track-placement';
import { nestSequence } from '../sequences/sequence-actions';
import type { ProjectAssetImporter } from '../media/types';
import type { LibraryRecipe } from './types';

export async function captureLibrarySelection(
	ids: string[]
): Promise<Extract<LibraryRecipe, { kind: 'selection' }>> {
	if (!editorSession.project) throw new Error('Open a project first.');
	const activeId = sequenceStore.activeSequenceId;
	const project = createExportableSequences(
		snapshotTimelineState(editorSession.project),
		captureSnapshot(),
		activeId
	).find((entry) => entry.id === activeId)!.project;
	const timeline = project.timeline!;
	const selected = new Set(expandSelectionWithLinkedItems(timeline.items, ids));
	const items = timeline.items.filter((item) => selected.has(item.id));
	if (!items.length) throw new Error('Select items to save.');
	const start = Math.min(...items.map((item) => item.from));
	const trackIds = new Set(items.map((item) => item.trackId));
	const compositionIds = new Set(
		items.flatMap((item) => (item.compositionId ? [item.compositionId] : []))
	);
	for (const id of compositionIds) {
		for (const item of timeline.compositions?.find((entry) => entry.id === id)?.items ?? []) {
			if (item.compositionId) compositionIds.add(item.compositionId);
		}
	}
	timeline.items = items.map((item) => ({
		...item,
		from: item.from - start,
		propertyLinks: item.propertyLinks?.filter((link) => selected.has(link.sourceItemId)),
		transformParent:
			item.transformParent?.parentItemId && !selected.has(item.transformParent.parentItemId)
				? detachedTransformParentBinding(item)
				: item.transformParent
	}));
	timeline.tracks = effectiveMediaTracks(timeline.tracks)
		.filter((track) => trackIds.has(track.id))
		.map((track) => ({ ...track, locked: false, parentTrackId: undefined }));
	timeline.compositions = timeline.compositions?.filter((entry) => compositionIds.has(entry.id));
	timeline.transitions = timeline.transitions?.filter(
		(entry) => selected.has(entry.fromItemId) && selected.has(entry.toItemId)
	);
	timeline.markers = [];
	timeline.inPoint = undefined;
	timeline.outPoint = undefined;
	timeline.topLevelSequenceIds = [];
	const allItems = [
		...timeline.items,
		...(timeline.compositions ?? []).flatMap((entry) => entry.items)
	];
	const mediaIds = new Set(
		allItems.flatMap((item) =>
			[
				item.mediaId,
				item.fontAssetId,
				...(item.textSpans ?? []).map((span) => span.fontAssetId)
			].filter((id): id is string => Boolean(id))
		)
	);
	project.fontAssets = project.fontAssets?.filter((font) => mediaIds.has(font.id));
	const media: Extract<LibraryRecipe, { kind: 'selection' }>['media'] = [];
	for (const id of mediaIds) {
		const metadata = mediaPool.get(id);
		if (!metadata) throw new Error('A source file is missing. Relink it before saving.');
		const { fileHandle: _handle, ...portable } = snapshotTimelineState(metadata);
		media.push({ metadata: portable, blob: await resolveMediaBlob(metadata) });
	}
	return { kind: 'selection', project, media };
}

async function prepareLibrarySelection(
	recipe: Extract<LibraryRecipe, { kind: 'selection' }>,
	name: string,
	importAsset?: ProjectAssetImporter
) {
	const projectId = editorSession.project?.id;
	const activeId = sequenceStore.activeSequenceId;
	if (!projectId) return null;
	const mediaIdMap = new Map<string, string>();
	for (const source of recipe.media) {
		const file = new File([source.blob], source.metadata.fileName, {
			type: source.metadata.mimeType
		});
		if (importAsset) {
			const media = await importAsset(file, {
				projectId,
				tags: source.metadata.tags,
				attribution: source.metadata.attribution
			});
			if (!media) throw new Error('The source file could not be imported.');
			mediaIdMap.set(source.metadata.id, media.id);
		} else if (source.metadata.tags.includes('font'))
			mediaIdMap.set(
				source.metadata.id,
				(
					await importCollectedFont(file, {
						projectId,
						attribution: source.metadata.attribution
					})
				).id
			);
		else mediaIdMap.set(source.metadata.id, await importCopiedFile(file, { projectId }));
		if (editorSession.project?.id !== projectId || sequenceStore.activeSequenceId !== activeId)
			return null;
	}
	const project = cloneProjectDocument(recipe.project, { mediaIdMap, name });
	for (const font of project.fontAssets ?? []) editorSession.registerProjectFontAsset(font);
	const failedFonts = await loadProjectFontAssets(project, mediaPool.mediaList);
	if (failedFonts.length) throw new Error('A saved font could not be loaded.');
	if (editorSession.project?.id !== projectId || sequenceStore.activeSequenceId !== activeId)
		return null;
	return project;
}

export async function applyLibraryTextStyle(
	recipe: Extract<LibraryRecipe, { kind: 'selection' }>,
	name: string,
	selectedIds: string[],
	importAsset?: ProjectAssetImporter
): Promise<void> {
	const targets = selectedIds.filter((id) => timelineStore.itemById.get(id)?.type === 'text');
	if (!targets.length) throw new Error('Select text to apply this style.');
	const project = await prepareLibrarySelection(recipe, name, importAsset);
	const source = project?.timeline?.items[0];
	if (!source) return;
	const fields = [
		'fontFamily',
		'fontAssetId',
		'fontSize',
		'fontWeight',
		'fontStyle',
		'underline',
		'color',
		'backgroundColor',
		'backgroundFit',
		'textAlign',
		'verticalAlign',
		'lineHeight',
		'letterSpacing',
		'textShadow',
		'strokeWidth',
		'strokeColor',
		'paddingX',
		'paddingY',
		'borderRadius'
	] as const;
	const patch = Object.fromEntries(fields.map((field) => [field, source[field]]));
	executeAtomic('APPLY_LIBRARY_TEXT_STYLE', () => {
		for (const id of targets) {
			const item = timelineStore.itemById.get(id);
			if (
				!item ||
				effectiveMediaTracks(timelineStore.tracks).find((track) => track.id === item.trackId)
					?.locked
			)
				continue;
			timelineStore._updateItems([
				{
					id,
					patch: {
						...patch,
						textSpans: item.textSpans?.map((span) => ({
							text: span.text,
							...patch
						}))
					}
				}
			]);
		}
	});
}

export async function insertLibrarySelection(
	recipe: Extract<LibraryRecipe, { kind: 'selection' }>,
	name: string,
	importAsset?: ProjectAssetImporter,
	placement?: { from: number; trackId: string }
): Promise<string[]> {
	const from = placement?.from ?? timelineStore.currentFrame;
	const project = await prepareLibrarySelection(recipe, name, importAsset);
	if (!project) return [];
	const timeline = project.timeline!;
	const duration = Math.max(...timeline.items.map((item) => item.from + item.durationInFrames));
	if (placement) {
		const track = effectiveMediaTracks(timelineStore.tracks).find(
			(track) => track.id === placement.trackId
		);
		const audioOnly = timeline.items.every((item) => item.type === 'audio');
		if (
			!track ||
			track.locked ||
			track.kind !== (audioOnly ? 'audio' : 'video') ||
			!trackRangeIsOpen(
				timelineStore.items,
				track.id,
				from,
				Math.round((duration * timelineStore.fps) / project.metadata.fps),
				audioOnly ? 'audio' : 'composition'
			)
		)
			throw new Error('The drop position is no longer available.');
	}
	return executeAtomic('INSERT_LIBRARY_ITEM', () => {
		for (const composition of timeline.compositions ?? [])
			sequenceStore.addComposition(composition);
		if (timeline.items.length === 1 && project.metadata.fps === timelineStore.fps) {
			const item = timeline.items[0]!;
			const track = ensureOpenTrackForRange({
				kind: item.type === 'audio' ? 'audio' : 'video',
				itemType: item.type,
				from,
				durationInFrames: item.durationInFrames,
				label: name,
				preferredTrackId: placement?.trackId
			});
			timelineStore._addItem({ ...item, from, trackId: track.id });
			return [item.id];
		}
		const id = crypto.randomUUID();
		sequenceStore.addComposition({
			id,
			name,
			editorKind: 'composite-2d',
			width: project.metadata.width,
			height: project.metadata.height,
			fps: project.metadata.fps,
			durationInFrames: duration,
			reusableHold: reusableBlockHold(timeline.items, duration),
			items: timeline.items,
			tracks: timeline.tracks,
			transitions: timeline.transitions ?? [],
			compositionControls: {
				version: COMPOSITION_CONTROLS_VERSION,
				controls: getCompositionControlCandidates(timeline.items)
					.filter(
						(candidate) =>
							!(
								candidate.property === 'text.text' &&
								timeline.items.find((item) => item.id === candidate.targetItemId)?.timer
							)
					)
					.map((candidate) => ({
						...candidate,
						id: crypto.randomUUID(),
						name: candidate.targetLabel
					}))
			}
		});
		return nestSequence(id, from, placement?.trackId);
	});
}
