/**
 * Timeline domain store — items, tracks, markers, playback settings, zoom.
 *
 * Consolidates FreeCut's separate Zustand stores (items-store,
 * markers-store, timeline-settings-store, zoom-store) into one Svelte 5
 * runes module. State mutates only through the private `_` methods called
 * by the command-wrapped actions in ./actions/; components read through
 * the exported singleton.
 *
 * Ported from FreeCut (MIT), trimmed to v1 (no compositions, transitions,
 * or keyframes).
 */

import type { TimelineItem, TimelineMarker, TimelineTrack } from '$lib/video-editor/project/types';
import type { AudioEqSettings } from '$lib/video-editor/audio/types';
import { clampTimelineZoom } from '$lib/video-editor/timeline/zoom';
import { calculateSplitSourceBoundaries } from '../utils/source-calculations';
import { hasVariableSpeed, variableSpeedSplitBoundaries } from '../source-time-map';
import { synchronizeTranscriptCaptionsAfterSplit } from '../../transcript/split-transcript-captions';

export interface TimelineSettings {
	fps: number;
	snapEnabled: boolean;
	linkedSelectionEnabled: boolean;
	currentFrame: number;
	scrollPosition: number;
	maxUndoHistory: number;
}

interface ItemsIndex {
	itemsByTrackId: Map<string, TimelineItem[]>;
	itemById: Map<string, TimelineItem>;
	maxItemEndFrame: number;
}

function buildIndex(items: TimelineItem[]): ItemsIndex {
	const itemsByTrackId = new Map<string, TimelineItem[]>();
	const itemById = new Map<string, TimelineItem>();
	let maxItemEndFrame = 0;
	for (const item of items) {
		const list = itemsByTrackId.get(item.trackId);
		if (list) list.push(item);
		else itemsByTrackId.set(item.trackId, [item]);
		itemById.set(item.id, item);
		maxItemEndFrame = Math.max(maxItemEndFrame, item.from + item.durationInFrames);
	}
	return { itemsByTrackId, itemById, maxItemEndFrame };
}

interface TimelineMarkerRecord {
	id: string;
	frame: number;
	label?: string;
	color: string;
}

interface TimelineState {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	inPoint: number | null;
	outPoint: number | null;
	markers: TimelineMarkerRecord[];
	selectedMarkerId: string | null;
	settings: TimelineSettings;
	zoomLevel: number;
	seekLocked: boolean;
	isDirty: boolean;
	masterVolumeDb: number;
	masterMuted: boolean;
	busAudioEq?: AudioEqSettings;
}

const state = $state<TimelineState>({
	items: [],
	tracks: [],
	inPoint: null,
	outPoint: null,
	markers: [],
	selectedMarkerId: null,
	settings: {
		fps: 30,
		snapEnabled: true,
		linkedSelectionEnabled: true,
		currentFrame: 0,
		scrollPosition: 0,
		maxUndoHistory: 100
	},
	zoomLevel: 1,
	seekLocked: false,
	isDirty: false,
	masterVolumeDb: 0,
	masterMuted: false,
	busAudioEq: undefined
});

let index = $state.raw<ItemsIndex>(buildIndex(state.items));

function reindex(): void {
	index = buildIndex(state.items);
	state.isDirty = true;
}

function moveIndexedItemTrack(item: TimelineItem, nextTrackId: string): void {
	if (item.trackId === nextTrackId) return;
	const previous = index.itemsByTrackId.get(item.trackId);
	if (previous) {
		const itemIndex = previous.indexOf(item);
		if (itemIndex >= 0) previous.splice(itemIndex, 1);
		if (previous.length === 0) index.itemsByTrackId.delete(item.trackId);
	}
	const next = index.itemsByTrackId.get(nextTrackId);
	if (next) next.push(item);
	else index.itemsByTrackId.set(nextTrackId, [item]);
	item.trackId = nextTrackId;
}

function finishPreviewMutation(maxItemEndFrame: number): void {
	if (maxItemEndFrame > index.maxItemEndFrame) {
		index = { ...index, maxItemEndFrame };
	}
	state.isDirty = true;
}

export const timelineStore = {
	get items(): TimelineItem[] {
		return state.items;
	},
	get tracks(): TimelineTrack[] {
		return state.tracks;
	},
	get inPoint(): number | null {
		return state.inPoint;
	},
	get outPoint(): number | null {
		return state.outPoint;
	},
	get markers() {
		return state.markers;
	},
	get selectedMarkerId(): string | null {
		return state.selectedMarkerId;
	},
	get fps(): number {
		return state.settings.fps;
	},
	get snapEnabled(): boolean {
		return state.settings.snapEnabled;
	},
	get linkedSelectionEnabled(): boolean {
		return state.settings.linkedSelectionEnabled;
	},
	get currentFrame(): number {
		return state.settings.currentFrame;
	},
	get scrollPosition(): number {
		return state.settings.scrollPosition;
	},
	get maxUndoHistory(): number {
		return state.settings.maxUndoHistory;
	},
	get zoomLevel(): number {
		return state.zoomLevel;
	},
	get seekLocked(): boolean {
		return state.seekLocked;
	},
	get isDirty(): boolean {
		return state.isDirty;
	},
	get masterVolumeDb(): number {
		return state.masterVolumeDb;
	},
	get masterMuted(): boolean {
		return state.masterMuted;
	},
	get busAudioEq(): AudioEqSettings | undefined {
		return state.busAudioEq;
	},
	get itemsByTrackId(): Map<string, TimelineItem[]> {
		return index.itemsByTrackId;
	},
	get itemById(): Map<string, TimelineItem> {
		return index.itemById;
	},
	get maxItemEndFrame(): number {
		return index.maxItemEndFrame;
	},

	/* ─────────────── Bulk setters (snapshot restore / project load) ─────────────── */

	setAll(next: {
		items?: TimelineItem[];
		tracks?: TimelineTrack[];
		inPoint?: number | null;
		outPoint?: number | null;
		currentFrame?: number;
		fps?: number;
		markers?: TimelineMarker[];
		zoomLevel?: number;
		scrollPosition?: number;
		masterVolumeDb?: number;
		masterMuted?: boolean;
		busAudioEq?: AudioEqSettings;
	}): void {
		if (next.items) state.items = next.items;
		if (next.tracks) state.tracks = next.tracks;
		if (next.inPoint !== undefined) state.inPoint = next.inPoint;
		if (next.outPoint !== undefined) state.outPoint = next.outPoint;
		if (next.currentFrame !== undefined && Number.isFinite(next.currentFrame)) {
			state.settings.currentFrame = next.currentFrame;
		}
		if (next.fps !== undefined && Number.isFinite(next.fps) && next.fps > 0) {
			state.settings.fps = next.fps;
		}
		if (next.markers) {
			state.markers = next.markers;
			if (!state.markers.some((marker) => marker.id === state.selectedMarkerId)) {
				state.selectedMarkerId = null;
			}
		}
		if (next.zoomLevel !== undefined && Number.isFinite(next.zoomLevel)) {
			state.zoomLevel = clampTimelineZoom(next.zoomLevel);
		}
		if (next.scrollPosition !== undefined && Number.isFinite(next.scrollPosition)) {
			state.settings.scrollPosition = next.scrollPosition;
		}
		if (next.masterVolumeDb !== undefined) {
			state.masterVolumeDb = Math.min(
				12,
				Math.max(-60, Number.isFinite(next.masterVolumeDb) ? next.masterVolumeDb : 0)
			);
		}
		if (next.masterMuted !== undefined) state.masterMuted = Boolean(next.masterMuted);
		if ('busAudioEq' in next)
			state.busAudioEq = next.busAudioEq ? { ...next.busAudioEq } : undefined;
		reindex();
	},

	clear(): void {
		state.items = [];
		state.tracks = [];
		state.inPoint = null;
		state.outPoint = null;
		state.markers = [];
		state.selectedMarkerId = null;
		state.settings.currentFrame = 0;
		state.seekLocked = false;
		state.masterVolumeDb = 0;
		state.masterMuted = false;
		state.busAudioEq = undefined;
		state.isDirty = false;
		reindex();
	},

	/* ────────────────────────── Private mutators (actions only) ────────────────── */

	_setItems(items: TimelineItem[]): void {
		state.items = items;
		reindex();
	},

	_setTracks(tracks: TimelineTrack[]): void {
		state.tracks = tracks;
		state.isDirty = true;
	},

	_setMasterVolumeDb(value: number): void {
		state.masterVolumeDb = Math.min(12, Math.max(-60, Number.isFinite(value) ? value : 0));
		state.isDirty = true;
	},

	_setMasterMuted(value: boolean): void {
		state.masterMuted = value;
		state.isDirty = true;
	},

	_setBusAudioEq(value?: AudioEqSettings): void {
		state.busAudioEq = value ? { ...value } : undefined;
		state.isDirty = true;
	},

	_addItem(item: TimelineItem): void {
		state.items.push(item);
		reindex();
	},

	_updateItems(updates: Array<{ id: string; patch: Partial<TimelineItem> }>): void {
		for (const { id, patch } of updates) {
			const item = index.itemById.get(id);
			if (!item) continue;
			Object.assign(item, patch);
		}
		reindex();
	},

	_removeItems(ids: string[]): void {
		const remove = new Set(ids);
		state.items = state.items.filter((item) => !remove.has(item.id));
		reindex();
	},

	_splitItem(
		id: string,
		frame: number,
		options: { synchronizeTranscriptCaptions?: boolean } = {}
	): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
		const item = index.itemById.get(id);
		if (!item) return null;
		const relative = frame - item.from;
		if (relative <= 0 || relative >= item.durationInFrames) return null;

		const rightDuration = item.durationInFrames - relative;
		const leftDuration = relative;
		const rightItem: TimelineItem = {
			...$state.snapshot(item),
			id: crypto.randomUUID(),
			originId: item.originId ?? item.id,
			from: frame,
			durationInFrames: rightDuration,
			label: item.label
		};
		item.durationInFrames = leftDuration;
		if (
			rightItem.type === 'video' ||
			rightItem.type === 'audio' ||
			rightItem.type === 'composition'
		) {
			const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : state.settings.fps;
			const boundaries = hasVariableSpeed(rightItem)
				? variableSpeedSplitBoundaries(rightItem, leftDuration, state.settings.fps)
				: calculateSplitSourceBoundaries(
						item.sourceStart ?? 0,
						leftDuration,
						rightDuration,
						item.speed ?? 1,
						state.settings.fps,
						sourceFps,
						item.isReversed,
						item.sourceEnd
					);
			item.sourceStart = boundaries.left.sourceStart;
			item.sourceEnd = boundaries.left.sourceEnd;
			rightItem.sourceStart = boundaries.right.sourceStart;
			rightItem.sourceEnd = boundaries.right.sourceEnd;
			if (options.synchronizeTranscriptCaptions !== false) {
				state.items = synchronizeTranscriptCaptionsAfterSplit(
					state.items,
					item,
					rightItem,
					frame,
					state.settings.fps
				);
			}
		} else if (rightItem.type === 'lottie') {
			rightItem.lottiePhaseOffset = (item.lottiePhaseOffset ?? 0) + relative;
		}
		// Both halves carry the original's lineage so downstream range-removal
		// can identify every piece of the clip that was edited.
		if (!item.originId) item.originId = rightItem.originId;
		state.items.push(rightItem);
		reindex();
		return { leftItem: item, rightItem };
	},

	_moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
		for (const update of updates) {
			const item = index.itemById.get(update.id);
			if (!item) continue;
			item.from = update.from;
			if (update.trackId && update.trackId !== item.trackId) {
				item.trackId = update.trackId;
			}
		}
		reindex();
	},

	/** Update gesture drafts without rebuilding whole-project indexes on every pointer frame. */
	_previewMoveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
		let maxItemEndFrame = index.maxItemEndFrame;
		for (const update of updates) {
			const item = index.itemById.get(update.id);
			if (!item) continue;
			if (update.trackId) moveIndexedItemTrack(item, update.trackId);
			item.from = update.from;
			maxItemEndFrame = Math.max(maxItemEndFrame, item.from + item.durationInFrames);
		}
		finishPreviewMutation(maxItemEndFrame);
	},

	/** Apply gesture property drafts while keeping id and track indexes usable. */
	_previewUpdateItems(updates: Array<{ id: string; patch: Partial<TimelineItem> }>): void {
		let maxItemEndFrame = index.maxItemEndFrame;
		for (const { id, patch } of updates) {
			const item = index.itemById.get(id);
			if (!item) continue;
			if (patch.trackId) moveIndexedItemTrack(item, patch.trackId);
			Object.assign(item, patch);
			maxItemEndFrame = Math.max(maxItemEndFrame, item.from + item.durationInFrames);
		}
		finishPreviewMutation(maxItemEndFrame);
	},

	/** Rebuild exact duration and track indexes once after a gesture draft settles. */
	_commitPreviewItems(): void {
		reindex();
	},

	_setCurrentFrame(frame: number): void {
		state.settings.currentFrame = Math.max(0, Math.round(frame));
	},

	_setSeekLocked(locked: boolean): void {
		state.seekLocked = locked;
	},

	_setScrollPosition(position: number): void {
		state.settings.scrollPosition = position;
	},

	_setSnapEnabled(enabled: boolean): void {
		state.settings.snapEnabled = enabled;
	},

	_setMaxUndoHistory(depth: number): void {
		if (!Number.isFinite(depth)) return;
		state.settings.maxUndoHistory = Math.round(Math.min(200, Math.max(10, depth)) / 10) * 10;
	},

	_setLinkedSelectionEnabled(enabled: boolean): void {
		state.settings.linkedSelectionEnabled = enabled;
	},

	_setZoomLevel(level: number): void {
		state.zoomLevel = clampTimelineZoom(level);
	},

	_setInPoint(frame: number | null): void {
		state.inPoint = frame;
		state.isDirty = true;
	},

	_setOutPoint(frame: number | null): void {
		state.outPoint = frame;
		state.isDirty = true;
	},

	_addMarker(marker: TimelineMarkerRecord): void {
		state.markers.push(marker);
		state.isDirty = true;
	},

	_updateMarker(id: string, patch: Partial<Omit<TimelineMarkerRecord, 'id'>>): void {
		state.markers = state.markers.map((marker) =>
			marker.id === id ? { ...marker, ...patch } : marker
		);
		state.isDirty = true;
	},

	_setMarkers(markers: TimelineMarkerRecord[]): void {
		state.markers = markers;
		state.isDirty = true;
	},

	_removeMarker(id: string): void {
		state.markers = state.markers.filter((marker) => marker.id !== id);
		if (state.selectedMarkerId === id) state.selectedMarkerId = null;
		state.isDirty = true;
	},

	_setSelectedMarkerId(id: string | null): void {
		state.selectedMarkerId = id;
	},

	_clearDirty(): void {
		state.isDirty = false;
	},

	__setSeekLockedForTesting(locked: boolean): void {
		state.seekLocked = locked;
	},

	__updateItemsForTesting(items: Array<{ id: string; patch: Partial<TimelineItem> }>): void {
		for (const { id, patch } of items) {
			const existing = index.itemById.get(id);
			if (existing) Object.assign(existing, patch);
		}
		reindex();
	},

	__resetForTesting(): void {
		timelineStore.clear();
		timelineStore._setZoomLevel(1);
		state.settings.snapEnabled = true;
		state.settings.linkedSelectionEnabled = true;
		state.settings.maxUndoHistory = 100;
		state.markers = [];
		state.selectedMarkerId = null;
		state.seekLocked = false;
		state.masterVolumeDb = 0;
		state.masterMuted = false;
		state.busAudioEq = undefined;
	}
};
