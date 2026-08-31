/** Undoable sequence and compound-clip editing actions. */

import { createDefaultTracks } from '../project/defaults';
import { cloneSubCompositionDocument } from '../project/project-clone';
import type {
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import { commandHistory, execute, executeAtomic } from '../timeline/commands/command-store.svelte';
import { clonePropertyRuntime } from '../timeline/actions/property-runtime';
import { ensureOpenTrackForRange } from '../timeline/actions/track-placement';
import {
	detachedTransformParentBinding,
	detachTransformChildrenForRemoval
} from '../timeline/actions/transform-parenting';
import { transitionsStore } from '../timeline/actions/transitions.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { expandSelectionWithLinkedItems } from '../timeline/utils/linked-items';
import { snapshotTimelineState } from '../timeline/utils/state-snapshot.svelte';
import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import {
	mapSourceWindowOverlap,
	timelineToSourceFrames
} from '../timeline/utils/source-calculations';
import { wouldCreateCompositionCycle } from './composition-graph';
import { sequenceStore } from './sequence-store.svelte';

function hasVisual(items: TimelineItem[]): boolean {
	return items.some((item) => item.type !== 'audio');
}

function hasAudio(items: TimelineItem[]): boolean {
	return items.some((item) => item.type === 'audio' || item.type === 'video');
}

function wrapperSourceFields(composition: SubComposition) {
	return {
		sourceStart: 0,
		sourceEnd: composition.durationInFrames,
		sourceDuration: composition.durationInFrames,
		sourceFps: composition.fps,
		speed: 1
	};
}

function nestedSequenceWrappers(
	composition: SubComposition,
	from: number,
	visualTrack: TimelineTrack | undefined,
	audioTrack: TimelineTrack | undefined
): TimelineItem[] {
	const linkedGroupId =
		hasVisual(composition.items) && hasAudio(composition.items) ? crypto.randomUUID() : undefined;
	const wrappers: TimelineItem[] = [];
	if (hasVisual(composition.items) && visualTrack) {
		wrappers.push({
			id: crypto.randomUUID(),
			type: 'composition',
			trackId: visualTrack.id,
			from,
			durationInFrames: Math.max(1, composition.durationInFrames),
			label: composition.name,
			compositionId: composition.id,
			compositionWidth: composition.width,
			compositionHeight: composition.height,
			linkedGroupId,
			transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
			...wrapperSourceFields(composition)
		});
	}
	if (hasAudio(composition.items) && audioTrack) {
		wrappers.push({
			id: crypto.randomUUID(),
			type: 'audio',
			trackId: audioTrack.id,
			from,
			durationInFrames: Math.max(1, composition.durationInFrames),
			label: composition.name,
			compositionId: composition.id,
			linkedGroupId,
			...wrapperSourceFields(composition)
		});
	}
	return wrappers;
}

function assertCompositionCanNest(compositionId: string): SubComposition {
	const composition = sequenceStore.compositionById.get(compositionId);
	if (!composition) throw new Error('Sequence not found.');
	if (
		wouldCreateCompositionCycle(
			sequenceStore.activeSequenceId,
			compositionId,
			sequenceStore.compositionById
		)
	) {
		throw new Error('A sequence cannot contain itself.');
	}
	return composition;
}

export interface CreateCompositeCompositionOptions {
	name: string;
	width: number;
	height: number;
	fps: number;
	durationInFrames: number;
	backgroundColor?: string;
}

export type CompositeCompositionCanvasPatch = Partial<
	Pick<SubComposition, 'width' | 'height' | 'backgroundColor'>
>;

/** Create an empty Motion composition without exposing it as an editorial sequence tab. */
export function createCompositeComposition(options: CreateCompositeCompositionOptions): string {
	return execute('CREATE_COMPOSITE_COMPOSITION', () => {
		const id = crypto.randomUUID();
		const fps = Math.round(Math.min(120, Math.max(1, options.fps)));
		const composition: SubComposition = {
			id,
			name: options.name.trim() || 'Motion composition',
			editorKind: 'composite-2d',
			items: [],
			tracks: [],
			transitions: [],
			fps,
			width: Math.round(Math.min(7680, Math.max(1, options.width))),
			height: Math.round(Math.min(4320, Math.max(1, options.height))),
			durationInFrames: Math.round(Math.min(fps * 60 * 60, Math.max(1, options.durationInFrames)))
		};
		if (options.backgroundColor) composition.backgroundColor = options.backgroundColor;
		sequenceStore.addComposition(composition);
		return id;
	});
}

export function updateCompositeCompositionCanvas(
	compositionId: string,
	patch: CompositeCompositionCanvasPatch
): boolean {
	const composition = sequenceStore.compositionById.get(compositionId);
	if (!composition || composition.editorKind !== 'composite-2d') return false;
	const normalized: CompositeCompositionCanvasPatch = {
		...(patch.width !== undefined && {
			width: Math.round(Math.min(7680, Math.max(1, patch.width)))
		}),
		...(patch.height !== undefined && {
			height: Math.round(Math.min(4320, Math.max(1, patch.height)))
		}),
		...(patch.backgroundColor !== undefined && { backgroundColor: patch.backgroundColor })
	};
	if (
		(normalized.width === undefined || normalized.width === composition.width) &&
		(normalized.height === undefined || normalized.height === composition.height) &&
		(normalized.backgroundColor === undefined ||
			normalized.backgroundColor.toLowerCase() ===
				(composition.backgroundColor ?? '#000000').toLowerCase())
	) {
		return false;
	}
	return execute('UPDATE_COMPOSITION_CANVAS', () =>
		sequenceStore.updateComposition(compositionId, normalized)
	);
}

function visualTrackFor(items: TimelineItem[], tracks: TimelineTrack[]): TimelineTrack | undefined {
	const selectedTrackIds = new Set(items.map((item) => item.trackId));
	return tracks
		.filter((track) => selectedTrackIds.has(track.id) && track.kind !== 'audio')
		.toSorted((left, right) => right.order - left.order)[0];
}

function audioTrackFor(items: TimelineItem[], tracks: TimelineTrack[]): TimelineTrack | undefined {
	const selectedTrackIds = new Set(items.map((item) => item.trackId));
	return (
		tracks
			.filter((track) => selectedTrackIds.has(track.id) && track.kind === 'audio')
			.toSorted((left, right) => right.order - left.order)[0] ??
		tracks.filter((track) => track.kind === 'audio').toSorted((a, b) => b.order - a.order)[0]
	);
}

export function createSequence(name = 'Sequence'): string {
	return execute('CREATE_SEQUENCE', () => {
		const id = crypto.randomUUID();
		sequenceStore.addComposition(
			{
				id,
				name,
				editorKind: 'sequence',
				items: [],
				tracks: createDefaultTracks(),
				transitions: [],
				fps: timelineStore.fps,
				width: sequenceStore.activeWidth,
				height: sequenceStore.activeHeight,
				durationInFrames: 0
			},
			true
		);
		return id;
	});
}

export function renameSequence(id: string, name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	return execute('RENAME_SEQUENCE', () => {
		if (!sequenceStore.updateComposition(id, { name: trimmed })) return false;
		const rename = (item: TimelineItem): TimelineItem =>
			item.compositionId === id && item.label !== trimmed ? { ...item, label: trimmed } : item;
		timelineStore._setItems(timelineStore.items.map(rename));
		for (const composition of sequenceStore.compositions) {
			if (composition.id !== id) {
				sequenceStore.updateComposition(composition.id, {
					items: composition.items.map(rename)
				});
			}
		}
		return true;
	});
}

export function duplicateSequence(id: string, name?: string): string | null {
	return execute('DUPLICATE_SEQUENCE', () => {
		const source = sequenceStore.compositionById.get(id);
		if (!source) return null;
		const names = new Set(sequenceStore.compositions.map((composition) => composition.name));
		const baseName = name?.trim() || `${source.name} copy`;
		let copyName = baseName;
		for (let suffix = 2; names.has(copyName); suffix += 1) copyName = `${baseName} ${suffix}`;
		const duplicate = cloneSubCompositionDocument(source, { name: copyName });
		sequenceStore.addComposition(duplicate, sequenceStore.topLevelSequenceIds.includes(source.id));
		return duplicate.id;
	});
}

export interface SequenceDeletionImpact {
	rootReferenceCount: number;
	nestedReferenceCount: number;
	totalReferenceCount: number;
}

export function sequenceDeletionImpact(compositionId: string): SequenceDeletionImpact {
	return sequenceDeletionImpactFor([compositionId]);
}

export function sequenceDeletionImpactFor(compositionIds: string[]): SequenceDeletionImpact {
	const timeline = sequenceStore.projectTimeline();
	const targetIds = new Set(compositionIds);
	const rootReferenceCount = timeline.items.filter(
		(item) => item.compositionId && targetIds.has(item.compositionId)
	).length;
	const nestedReferenceCount = (timeline.compositions ?? [])
		.filter((composition) => !targetIds.has(composition.id))
		.reduce(
			(count, composition) =>
				count +
				composition.items.filter((item) => item.compositionId && targetIds.has(item.compositionId))
					.length,
			0
		);
	return {
		rootReferenceCount,
		nestedReferenceCount,
		totalReferenceCount: rootReferenceCount + nestedReferenceCount
	};
}

export function nestSequence(compositionId: string, from = timelineStore.currentFrame): string[] {
	return execute('NEST_SEQUENCE', () => {
		const composition = assertCompositionCanNest(compositionId);
		const durationInFrames = Math.max(1, composition.durationInFrames);
		const effectiveTracks = effectiveMediaTracks(timelineStore.tracks);
		const preferredVisualTrack = effectiveTracks
			.filter((track) => track.kind !== 'audio' && !track.locked)
			.toSorted((left, right) => left.order - right.order)[0];
		const visualTrack =
			hasVisual(composition.items) && preferredVisualTrack
				? ensureOpenTrackForRange({
						kind: 'video',
						itemType: 'composition',
						from,
						durationInFrames,
						label: composition.name,
						preferredTrackId: preferredVisualTrack.id
					})
				: undefined;
		const audioTrack = effectiveTracks
			.filter((track) => track.kind === 'audio' && !track.locked)
			.toSorted((left, right) => right.order - left.order)[0];
		const wrappers = nestedSequenceWrappers(composition, from, visualTrack, audioTrack);
		if (wrappers.length === 0) throw new Error('No compatible unlocked track is available.');
		timelineStore._setItems([...timelineStore.items, ...wrappers]);
		return wrappers.map((wrapper) => wrapper.id);
	});
}

export interface ExactSequencePlacement {
	visualTrackId?: string;
	audioTrackId?: string;
}

/** Nest a sequence on the exact rows shown by a placement preview. */
export function nestSequenceOnExactTracks(
	compositionId: string,
	from: number,
	placement: ExactSequencePlacement
): string[] {
	return execute('NEST_SEQUENCE', () => {
		const composition = assertCompositionCanNest(compositionId);
		const exactFrom = Math.max(0, Math.round(from));
		const duration = Math.max(1, composition.durationInFrames);
		const end = exactFrom + duration;
		const effectiveTracks = effectiveMediaTracks(timelineStore.tracks);
		const exactTrack = (trackId: string | undefined, kind: 'video' | 'audio') => {
			if (!trackId) return undefined;
			const track = effectiveTracks.find((candidate) => candidate.id === trackId);
			if (!track || track.kind !== kind || track.locked || track.visible === false) {
				throw new Error('Exact sequence placement target is unavailable.');
			}
			const occupied = (timelineStore.itemsByTrackId.get(track.id) ?? []).some(
				(item) => item.from < end && item.from + item.durationInFrames > exactFrom
			);
			if (occupied) throw new Error('Exact sequence placement target is occupied.');
			return track;
		};
		const visualTrack = exactTrack(placement.visualTrackId, 'video');
		const audioTrack = exactTrack(placement.audioTrackId, 'audio');
		if (hasVisual(composition.items) && !visualTrack) {
			throw new Error('Exact sequence placement needs a video track.');
		}
		if (hasAudio(composition.items) && !audioTrack) {
			throw new Error('Exact sequence placement needs an audio track.');
		}
		const wrappers = nestedSequenceWrappers(composition, exactFrom, visualTrack, audioTrack);
		if (wrappers.length === 0) throw new Error('Sequence has no placeable media.');
		timelineStore._setItems([...timelineStore.items, ...wrappers]);
		return wrappers.map((wrapper) => wrapper.id);
	});
}

export function createCompoundClip(
	itemIds: string[],
	name = 'Compound Clip',
	editorKind: SubComposition['editorKind'] = 'sequence'
): string | null {
	return execute('CREATE_COMPOUND_CLIP', () => {
		const expandedIds = new Set(expandSelectionWithLinkedItems(timelineStore.items, itemIds));
		const selected = timelineStore.items.filter((item) => expandedIds.has(item.id));
		if (selected.length === 0) return null;
		const minFrom = Math.min(...selected.map((item) => item.from));
		const maxEnd = Math.max(...selected.map((item) => item.from + item.durationInFrames));
		const selectedTrackIds = new Set(selected.map((item) => item.trackId));
		const selectedItemIds = new Set(selected.map((item) => item.id));
		const compositionId = crypto.randomUUID();
		const composition: SubComposition = {
			id: compositionId,
			name,
			editorKind,
			items: selected.map((item) => {
				const snapshot = snapshotTimelineState(item);
				const propertyLinks = snapshot.propertyLinks?.filter((link) =>
					selectedItemIds.has(link.sourceItemId)
				);
				const externalParent =
					snapshot.transformParent?.parentItemId &&
					!selectedItemIds.has(snapshot.transformParent.parentItemId);
				return {
					...snapshot,
					from: item.from - minFrom,
					...(snapshot.propertyLinks && {
						propertyLinks: propertyLinks?.length ? propertyLinks : undefined
					}),
					...(externalParent && {
						transformParent: detachedTransformParentBinding(item)
					})
				};
			}),
			tracks: timelineStore.tracks
				.filter((track) => selectedTrackIds.has(track.id))
				.map((track) => snapshotTimelineState(track)),
			transitions: transitionsStore.list.filter(
				(transition) =>
					expandedIds.has(transition.fromItemId) && expandedIds.has(transition.toItemId)
			),
			fps: timelineStore.fps,
			width: sequenceStore.activeWidth,
			height: sequenceStore.activeHeight,
			durationInFrames: maxEnd - minFrom
		};
		sequenceStore.addComposition(composition);
		detachTransformChildrenForRemoval([...expandedIds]);
		timelineStore._removeItems([...expandedIds]);
		transitionsStore.setAll(
			transitionsStore.list.filter(
				(transition) =>
					!expandedIds.has(transition.fromItemId) && !expandedIds.has(transition.toItemId)
			)
		);
		const preferredVisualTrack = visualTrackFor(selected, timelineStore.tracks);
		const visualTrack =
			hasVisual(selected) && preferredVisualTrack
				? ensureOpenTrackForRange({
						kind: 'video',
						itemType: 'composition',
						from: minFrom,
						durationInFrames: composition.durationInFrames,
						label: name,
						preferredTrackId: preferredVisualTrack.id
					})
				: undefined;
		const audioTrack = audioTrackFor(selected, timelineStore.tracks);
		const linkedGroupId =
			hasVisual(selected) && hasAudio(selected) ? crypto.randomUUID() : undefined;
		const wrappers: TimelineItem[] = [];
		if (hasVisual(selected) && visualTrack) {
			wrappers.push({
				id: crypto.randomUUID(),
				type: 'composition',
				trackId: visualTrack.id,
				from: minFrom,
				durationInFrames: composition.durationInFrames,
				label: name,
				compositionId,
				compositionWidth: composition.width,
				compositionHeight: composition.height,
				linkedGroupId,
				transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
				...wrapperSourceFields(composition)
			});
		}
		if (hasAudio(selected) && audioTrack) {
			wrappers.push({
				id: crypto.randomUUID(),
				type: 'audio',
				trackId: audioTrack.id,
				from: minFrom,
				durationInFrames: composition.durationInFrames,
				label: name,
				compositionId,
				linkedGroupId,
				...wrapperSourceFields(composition)
			});
		}
		timelineStore._setItems([...timelineStore.items, ...wrappers]);
		return compositionId;
	});
}

function remapTransition(
	transition: TimelineTransition,
	idMap: Map<string, string>
): TimelineTransition | null {
	const fromItemId = idMap.get(transition.fromItemId);
	const toItemId = idMap.get(transition.toItemId);
	return fromItemId && toItemId
		? { ...transition, id: crypto.randomUUID(), fromItemId, toItemId }
		: null;
}

function mapItemThroughWrapper(
	item: TimelineItem,
	wrapper: TimelineItem,
	timelineFps: number,
	compositionFps: number
): TimelineItem | null {
	const mapping = mapSourceWindowOverlap({
		itemStart: item.from,
		itemDuration: item.durationInFrames,
		wrapperDuration: wrapper.durationInFrames,
		wrapperSpeed: wrapper.speed,
		wrapperSourceFps: wrapper.sourceFps,
		wrapperSourceStart: wrapper.sourceStart ?? 0,
		wrapperSourceEnd: wrapper.sourceEnd,
		timelineFps,
		fallbackSourceFps: compositionFps
	});
	if (!mapping) return null;

	const mapped: TimelineItem = {
		...snapshotTimelineState(item),
		from: wrapper.from + mapping.mappedFrom,
		durationInFrames: mapping.mappedDuration,
		speed: (item.speed ?? 1) * mapping.wrapperSpeed
	};
	if (item.type === 'video' || item.type === 'audio' || item.type === 'composition') {
		const childSourceFps =
			item.sourceFps ??
			(item.compositionId
				? (sequenceStore.compositionById.get(item.compositionId)?.fps ?? compositionFps)
				: compositionFps);
		const childSpeed = item.speed ?? 1;
		const nextSourceStart =
			(item.sourceStart ?? 0) +
			timelineToSourceFrames(
				mapping.clippedStartFrames,
				childSpeed,
				compositionFps,
				childSourceFps
			);
		mapped.sourceStart = nextSourceStart;
		if (item.sourceEnd !== undefined) {
			mapped.sourceEnd = Math.max(
				nextSourceStart + 1,
				item.sourceEnd -
					timelineToSourceFrames(
						mapping.clippedEndFrames,
						childSpeed,
						compositionFps,
						childSourceFps
					)
			);
		}
	}
	return mapped;
}

function itemTrackKind(item: TimelineItem): 'video' | 'audio' {
	return item.type === 'audio' ? 'audio' : 'video';
}

interface DissolveTrackMap {
	trackMap: Map<string, string>;
	tracks: TimelineTrack[];
}

function buildDissolveTrackMap(
	composition: SubComposition,
	wrapperItems: TimelineItem[],
	existingTracks: TimelineTrack[]
): DissolveTrackMap {
	const trackMap = new Map<string, string>();
	const nextTracks = [...existingTracks];
	const existingIds = new Set(existingTracks.map((track) => track.id));
	const visualAnchor = wrapperItems.find((item) => item.type === 'composition');
	const audioAnchor = wrapperItems.find((item) => item.type === 'audio');
	const usedAnchors = new Set<string>();

	for (const sourceTrack of composition.tracks.toSorted(
		(left, right) => left.order - right.order
	)) {
		const sourceItems = composition.items.filter((item) => item.trackId === sourceTrack.id);
		const kind =
			sourceTrack.kind === 'audio' ||
			(sourceItems.length > 0 && sourceItems.every((item) => itemTrackKind(item) === 'audio'))
				? 'audio'
				: 'video';
		const existingTrack = existingIds.has(sourceTrack.id)
			? existingTracks.find((track) => track.id === sourceTrack.id)
			: undefined;
		if (existingTrack?.kind === kind) {
			trackMap.set(sourceTrack.id, sourceTrack.id);
			continue;
		}
		const anchor = kind === 'audio' ? audioAnchor : visualAnchor;
		if (anchor && !usedAnchors.has(anchor.trackId)) {
			trackMap.set(sourceTrack.id, anchor.trackId);
			usedAnchors.add(anchor.trackId);
			continue;
		}
		const id = crypto.randomUUID();
		const anchorTrack = anchor
			? nextTracks.find((track) => track.id === anchor.trackId)
			: nextTracks.find((track) => track.kind === kind);
		nextTracks.push({
			...snapshotTimelineState(sourceTrack),
			id,
			kind,
			order: (anchorTrack?.order ?? sourceTrack.order) + (kind === 'audio' ? 0.01 : -0.01)
		});
		trackMap.set(sourceTrack.id, id);
	}
	return { trackMap, tracks: nextTracks };
}

export function dissolveCompoundClip(wrapperId: string): string[] {
	return execute('DISSOLVE_COMPOUND_CLIP', () => {
		const wrapper = timelineStore.itemById.get(wrapperId);
		if (!wrapper?.compositionId) return [];
		const composition = sequenceStore.compositionById.get(wrapper.compositionId);
		if (!composition) return [];
		const wrapperItems = timelineStore.items.filter(
			(item) =>
				item.compositionId === wrapper.compositionId &&
				(item.id === wrapper.id ||
					(Boolean(wrapper.linkedGroupId) && item.linkedGroupId === wrapper.linkedGroupId))
		);
		const wrapperIds = new Set(wrapperItems.map((item) => item.id));
		const windowAnchor =
			wrapperItems.find((item) => item.type === 'composition') ?? wrapperItems[0];
		if (!windowAnchor) return [];
		const { trackMap, tracks } = buildDissolveTrackMap(
			composition,
			wrapperItems,
			timelineStore.tracks
		);
		const idMap = new Map<string, string>();
		const mappedItems = composition.items.flatMap((item) => {
			const mapped = mapItemThroughWrapper(item, windowAnchor, timelineStore.fps, composition.fps);
			if (!mapped) return [];
			const id = crypto.randomUUID();
			idMap.set(item.id, id);
			return [
				{
					...mapped,
					id,
					originId: item.originId ?? item.id,
					trackId: trackMap.get(item.trackId) ?? windowAnchor.trackId
				}
			];
		});
		const restored = mappedItems.map((item) => ({
			...item,
			...clonePropertyRuntime(item, idMap)
		}));
		timelineStore._setTracks(tracks);
		timelineStore._setItems([
			...timelineStore.items.filter((item) => !wrapperIds.has(item.id)),
			...restored
		]);
		const restoredTransitions = composition.transitions
			.map((transition) => remapTransition(transition, idMap))
			.filter((transition): transition is TimelineTransition => transition !== null);
		transitionsStore.setAll([
			...transitionsStore.list.filter(
				(transition) =>
					!wrapperIds.has(transition.fromItemId) && !wrapperIds.has(transition.toItemId)
			),
			...restoredTransitions
		]);
		return restored.map((item) => item.id);
	});
}

export function deleteSequence(compositionId: string): boolean {
	if (sequenceStore.activeSequenceId === compositionId && !switchSequence(null)) return false;
	return execute('DELETE_SEQUENCE', () => {
		const removed = sequenceStore.deleteCompositionAndReferences(compositionId);
		if (removed) commandHistory.removeContext(compositionId);
		return removed;
	});
}

export function deleteSequences(compositionIds: string[]): string[] {
	const availableIds = new Set(sequenceStore.compositions.map((composition) => composition.id));
	const targets = [...new Set(compositionIds)].filter((id) => availableIds.has(id));
	if (targets.length === 0) return [];
	if (sequenceStore.activeSequenceId && targets.includes(sequenceStore.activeSequenceId)) {
		if (!switchSequence(null)) return [];
	}
	return executeAtomic('DELETE_SEQUENCES', () => {
		const removed = targets.filter((id) => sequenceStore.deleteCompositionAndReferences(id));
		for (const id of removed) commandHistory.removeContext(id);
		return removed;
	});
}

export function switchSequence(sequenceId: string | null): boolean {
	if (!sequenceStore.switchTo(sequenceId)) return false;
	commandHistory.setActiveContext(sequenceId);
	return true;
}
