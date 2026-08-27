/** Reusable sequence registry and active-timeline swapping. */

import type {
	ProjectResolution,
	ProjectTimeline,
	SubComposition,
	TimelineItem,
	TimelineTransition
} from '../project/types';
import { createEmptyTimeline } from '../project/defaults';
import { transitionsStore } from '../timeline/actions/transitions.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { snapshotTimelineState } from '../timeline/utils/state-snapshot.svelte';
import { sanitizeCompositionControlSchema } from './composition-controls';

export interface SequenceRegistrySnapshot {
	compositions: SubComposition[];
	topLevelSequenceIds: string[];
	rootTimeline: ProjectTimeline;
	rootResolution: ProjectResolution;
	sequenceViewById: Record<string, SequenceViewState>;
}

interface SequenceViewState {
	currentFrame: number;
	zoomLevel: number;
	scrollPosition: number;
}

const state = $state<{
	compositions: SubComposition[];
	topLevelSequenceIds: string[];
	activeSequenceId: string | null;
	rootTimeline: ProjectTimeline;
	rootResolution: ProjectResolution;
	sequenceViewById: Record<string, SequenceViewState>;
}>({
	compositions: [],
	topLevelSequenceIds: [],
	activeSequenceId: null,
	rootTimeline: createEmptyTimeline(),
	rootResolution: { width: 1920, height: 1080, fps: 30 },
	sequenceViewById: {}
});

function copy<T>(value: T): T {
	return snapshotTimelineState(value);
}

function equal<T>(left: T, right: T): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function activeTimelineSnapshot(): ProjectTimeline {
	return {
		tracks: copy(timelineStore.tracks),
		items: copy(timelineStore.items),
		transitions: copy(transitionsStore.list),
		currentFrame: timelineStore.currentFrame,
		zoomLevel: timelineStore.zoomLevel,
		scrollPosition: timelineStore.scrollPosition,
		inPoint: timelineStore.inPoint ?? undefined,
		outPoint: timelineStore.outPoint ?? undefined,
		markers: copy(timelineStore.markers),
		masterVolumeDb: timelineStore.masterVolumeDb,
		masterMuted: timelineStore.masterMuted,
		busAudioEq: copy(timelineStore.busAudioEq)
	};
}

function applyTimeline(timeline: ProjectTimeline, fps: number): void {
	transitionsStore.setAll(copy(timeline.transitions ?? []));
	timelineStore.setAll({
		items: copy(timeline.items),
		tracks: copy(timeline.tracks),
		currentFrame: timeline.currentFrame ?? 0,
		fps,
		inPoint: timeline.inPoint ?? null,
		outPoint: timeline.outPoint ?? null,
		markers: copy(timeline.markers ?? []),
		zoomLevel: timeline.zoomLevel ?? 1,
		scrollPosition: timeline.scrollPosition ?? 0,
		masterVolumeDb: timeline.masterVolumeDb ?? 0,
		masterMuted: timeline.masterMuted ?? false,
		busAudioEq: copy(timeline.busAudioEq)
	});
}

function sequenceTimeline(composition: SubComposition, view?: SequenceViewState): ProjectTimeline {
	return {
		items: composition.items,
		tracks: composition.tracks,
		transitions: composition.transitions,
		markers: composition.markers,
		inPoint: composition.inPoint ?? undefined,
		outPoint: composition.outPoint ?? undefined,
		currentFrame: view?.currentFrame ?? 0,
		zoomLevel: view?.zoomLevel ?? 1,
		scrollPosition: view?.scrollPosition ?? 0,
		masterVolumeDb: composition.masterVolumeDb ?? 0,
		masterMuted: composition.masterMuted ?? false,
		busAudioEq: copy(composition.busAudioEq)
	};
}

function removeCompositionReferences<
	T extends { items: TimelineItem[]; transitions?: TimelineTransition[] }
>(timeline: T, compositionId: string): T {
	const removedIds = new Set(
		timeline.items.filter((item) => item.compositionId === compositionId).map((item) => item.id)
	);
	if (removedIds.size === 0) return timeline;
	return {
		...timeline,
		items: timeline.items.filter((item) => !removedIds.has(item.id)),
		transitions: (timeline.transitions ?? []).filter(
			(transition) => !removedIds.has(transition.fromItemId) && !removedIds.has(transition.toItemId)
		)
	};
}

function flushActive(): void {
	const snapshot = activeTimelineSnapshot();
	if (state.activeSequenceId === null) {
		state.rootTimeline = snapshot;
		return;
	}
	const index = state.compositions.findIndex(
		(composition) => composition.id === state.activeSequenceId
	);
	if (index < 0) return;
	const current = state.compositions[index]!;
	const compositionControls = sanitizeCompositionControlSchema(
		current.compositionControls,
		snapshot.items
	);
	state.sequenceViewById[state.activeSequenceId] = {
		currentFrame: timelineStore.currentFrame,
		zoomLevel: timelineStore.zoomLevel,
		scrollPosition: timelineStore.scrollPosition
	};
	state.compositions[index] = {
		...current,
		compositionControls,
		items: snapshot.items,
		tracks: snapshot.tracks,
		transitions: snapshot.transitions ?? [],
		markers: snapshot.markers,
		inPoint: snapshot.inPoint ?? null,
		outPoint: snapshot.outPoint ?? null,
		masterVolumeDb: snapshot.masterVolumeDb,
		masterMuted: snapshot.masterMuted,
		busAudioEq: copy(snapshot.busAudioEq),
		durationInFrames: snapshot.items.reduce(
			(max, item) => Math.max(max, item.from + item.durationInFrames),
			0
		)
	};
}

export const sequenceStore = {
	get compositions(): SubComposition[] {
		return state.compositions;
	},
	get compositionById(): Map<string, SubComposition> {
		return new Map(state.compositions.map((composition) => [composition.id, composition]));
	},
	get topLevelSequenceIds(): string[] {
		return state.topLevelSequenceIds;
	},
	get activeSequenceId(): string | null {
		return state.activeSequenceId;
	},
	get activeSequence(): SubComposition | undefined {
		return state.activeSequenceId
			? state.compositions.find((composition) => composition.id === state.activeSequenceId)
			: undefined;
	},
	get activeWidth(): number {
		return sequenceStore.activeSequence?.width ?? state.rootResolution.width;
	},
	get activeHeight(): number {
		return sequenceStore.activeSequence?.height ?? state.rootResolution.height;
	},
	load(timeline: ProjectTimeline, rootResolution: ProjectResolution): void {
		state.compositions = copy(timeline.compositions ?? []).map((composition) => {
			const compositionControls = sanitizeCompositionControlSchema(
				composition.compositionControls,
				composition.items
			);
			return {
				...composition,
				editorKind: composition.editorKind === 'composite-2d' ? 'composite-2d' : 'sequence',
				compositionControls
			};
		});
		const validIds = new Set(
			state.compositions
				.filter((composition) => composition.editorKind !== 'composite-2d')
				.map((composition) => composition.id)
		);
		state.topLevelSequenceIds = [
			...new Set((timeline.topLevelSequenceIds ?? []).filter((id) => validIds.has(id)))
		];
		state.activeSequenceId = null;
		state.sequenceViewById = {};
		state.rootResolution = copy(rootResolution);
		state.rootTimeline = copy({
			...timeline,
			compositions: undefined,
			topLevelSequenceIds: undefined
		});
		applyTimeline(state.rootTimeline, rootResolution.fps);
	},
	switchTo(sequenceId: string | null): boolean {
		if (sequenceId === state.activeSequenceId) return true;
		const target = sequenceId
			? state.compositions.find((composition) => composition.id === sequenceId)
			: undefined;
		if (sequenceId && !target) return false;
		flushActive();
		state.activeSequenceId = sequenceId;
		if (target)
			applyTimeline(sequenceTimeline(target, state.sequenceViewById[target.id]), target.fps);
		else applyTimeline(state.rootTimeline, state.rootResolution.fps);
		return true;
	},
	flushActive,
	projectTimeline(): ProjectTimeline {
		flushActive();
		return copy({
			...state.rootTimeline,
			compositions: state.compositions,
			topLevelSequenceIds: state.topLevelSequenceIds
		});
	},
	addComposition(composition: SubComposition, promoteToTab = false): void {
		state.compositions = [...state.compositions, copy(composition)];
		if (promoteToTab && !state.topLevelSequenceIds.includes(composition.id)) {
			state.topLevelSequenceIds = [...state.topLevelSequenceIds, composition.id];
		}
	},
	updateComposition(id: string, patch: Partial<Omit<SubComposition, 'id'>>): boolean {
		const index = state.compositions.findIndex((composition) => composition.id === id);
		if (index < 0) return false;
		state.compositions[index] = { ...state.compositions[index]!, ...copy(patch) };
		return true;
	},
	deleteCompositionAndReferences(id: string): boolean {
		if (!state.compositions.some((composition) => composition.id === id)) return false;
		flushActive();
		state.rootTimeline = removeCompositionReferences(state.rootTimeline, id);
		state.compositions = state.compositions
			.filter((composition) => composition.id !== id)
			.map((composition) => {
				const sanitized = removeCompositionReferences(composition, id);
				return {
					...sanitized,
					durationInFrames: sanitized.items.reduce(
						(max, item) => Math.max(max, item.from + item.durationInFrames),
						0
					)
				};
			});
		state.topLevelSequenceIds = state.topLevelSequenceIds.filter((sequenceId) => sequenceId !== id);
		delete state.sequenceViewById[id];
		if (state.activeSequenceId === id) state.activeSequenceId = null;
		const active = state.activeSequenceId
			? state.compositions.find((composition) => composition.id === state.activeSequenceId)
			: undefined;
		if (active) {
			applyTimeline(sequenceTimeline(active, state.sequenceViewById[active.id]), active.fps);
		} else {
			applyTimeline(state.rootTimeline, state.rootResolution.fps);
		}
		return true;
	},
	promoteToTab(id: string): boolean {
		if (
			!state.compositions.some(
				(composition) => composition.id === id && composition.editorKind !== 'composite-2d'
			)
		)
			return false;
		if (!state.topLevelSequenceIds.includes(id)) {
			state.topLevelSequenceIds = [...state.topLevelSequenceIds, id];
		}
		return true;
	},
	closeTab(id: string): void {
		state.topLevelSequenceIds = state.topLevelSequenceIds.filter((sequenceId) => sequenceId !== id);
	},
	reorderTabs(fromIndex: number, toIndex: number): boolean {
		if (
			fromIndex < 0 ||
			toIndex < 0 ||
			fromIndex >= state.topLevelSequenceIds.length ||
			toIndex >= state.topLevelSequenceIds.length ||
			fromIndex === toIndex
		)
			return false;
		const next = [...state.topLevelSequenceIds];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved!);
		state.topLevelSequenceIds = next;
		return true;
	},
	snapshotRegistry(): SequenceRegistrySnapshot {
		return copy({
			compositions: state.compositions,
			topLevelSequenceIds: state.topLevelSequenceIds,
			rootTimeline: state.rootTimeline,
			rootResolution: state.rootResolution,
			sequenceViewById: state.sequenceViewById
		});
	},
	restoreRegistry(snapshot: SequenceRegistrySnapshot): void {
		state.compositions = copy(snapshot.compositions);
		state.topLevelSequenceIds = copy(snapshot.topLevelSequenceIds);
		state.rootTimeline = copy(snapshot.rootTimeline);
		state.rootResolution = copy(snapshot.rootResolution);
		state.sequenceViewById = copy(snapshot.sequenceViewById);
	},
	applyRegistryDelta(
		fromSnapshot: SequenceRegistrySnapshot,
		toSnapshot: SequenceRegistrySnapshot
	): void {
		const currentById = new Map(
			state.compositions.map((composition) => [composition.id, composition])
		);
		const fromById = new Map(
			fromSnapshot.compositions.map((composition) => [composition.id, composition])
		);
		const toById = new Map(
			toSnapshot.compositions.map((composition) => [composition.id, composition])
		);
		const allIds = new Set([...fromById.keys(), ...toById.keys()]);
		for (const id of allIds) {
			const current = currentById.get(id);
			const from = fromById.get(id);
			const to = toById.get(id);
			if (equal(from, to)) continue;
			if (!to) {
				if (equal(current, from)) currentById.delete(id);
				continue;
			}
			if (!from) {
				if (!current) currentById.set(id, copy(to));
				continue;
			}
			if (equal(current, from)) currentById.set(id, copy(to));
		}
		const orderedIds = [
			...state.compositions.map((composition) => composition.id),
			...toSnapshot.compositions.map((composition) => composition.id)
		].filter((id, index, ids) => ids.indexOf(id) === index && currentById.has(id));
		state.compositions = orderedIds.map((id) => currentById.get(id)!);

		const removedTabs = new Set(
			fromSnapshot.topLevelSequenceIds.filter((id) => !toSnapshot.topLevelSequenceIds.includes(id))
		);
		const addedTabs = toSnapshot.topLevelSequenceIds.filter(
			(id) => !fromSnapshot.topLevelSequenceIds.includes(id)
		);
		state.topLevelSequenceIds = state.topLevelSequenceIds.filter((id) => !removedTabs.has(id));
		for (const id of addedTabs) {
			if (currentById.has(id) && !state.topLevelSequenceIds.includes(id)) {
				state.topLevelSequenceIds = [...state.topLevelSequenceIds, id];
			}
		}

		if (equal(state.rootTimeline, fromSnapshot.rootTimeline)) {
			state.rootTimeline = copy(toSnapshot.rootTimeline);
		}
		if (equal(state.rootResolution, fromSnapshot.rootResolution)) {
			state.rootResolution = copy(toSnapshot.rootResolution);
		}
		const viewIds = new Set([
			...Object.keys(fromSnapshot.sequenceViewById),
			...Object.keys(toSnapshot.sequenceViewById)
		]);
		for (const id of viewIds) {
			const current = state.sequenceViewById[id];
			const from = fromSnapshot.sequenceViewById[id];
			const to = toSnapshot.sequenceViewById[id];
			if (!equal(current, from)) continue;
			if (to) state.sequenceViewById[id] = copy(to);
			else delete state.sequenceViewById[id];
		}
	},
	reset(): void {
		state.compositions = [];
		state.topLevelSequenceIds = [];
		state.activeSequenceId = null;
		state.rootTimeline = createEmptyTimeline();
		state.rootResolution = { width: 1920, height: 1080, fps: 30 };
		state.sequenceViewById = {};
	}
};
