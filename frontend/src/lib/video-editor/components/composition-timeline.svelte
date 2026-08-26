<!--
	Motion composition timeline - FreeCut 4d62e80 parity.
	Port of features/editor/components/compose-workspace/compositing-timeline.tsx (7066 lines)
	plus motion-io-lane, motion-vector-rows, motion-region-overlay, pick-whips, keyframe selection.

	Owners reused (no parallel state):
	- sequence-store / timeline-store / timeline-viewport / zoom / snapping / edit-gesture
	- vector-keyframes / transform-parenting / keyframe-editor / text-motion-timeline
	- motion-timeline-rows.ts (O(n) linked-audio collapse)
	- command-store snapshot for one atomic undo per gesture
	- track-groups for inherited visibility/lock/mute/solo
-->
<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { removeItems } from '$lib/video-editor/timeline/actions/items';
	import {
		setTransformParent,
		detachTransformParent
	} from '$lib/video-editor/timeline/actions/transform-parenting';
	import { timelinePixelsPerFrame } from '$lib/video-editor/timeline/zoom';
	import {
		buildTimelineItemRangeIndex,
		queryTimelineItemRange
	} from '$lib/video-editor/timeline/timeline-viewport';
	import {
		buildSnapTargets,
		calculateAdaptiveSnapThreshold,
		calculateEdgeSnap,
		calculateMoveSnap
	} from '$lib/video-editor/timeline/snapping';
	import { planLinkedMoveGesture, planTrimGesture } from '$lib/video-editor/timeline/edit-gesture';
	import { editorKeyframes, keyframeIdentity } from '$lib/video-editor/timeline/keyframe-editor';
	import { activeVectorKeyframes } from '$lib/video-editor/timeline/vector-keyframes';
	import { keyframeSelectionStore } from '$lib/video-editor/timeline/stores/keyframe-selection-store.svelte';
	import { updateKeyframes } from '$lib/video-editor/timeline/actions/keyframes';
	import {
		getTextMotionTimelineBands,
		getMaxOffsetFrames
	} from '$lib/video-editor/timeline/text-motion-timeline';
	import type { TextMotionPresetId, TextMotionSlot } from '$lib/video-editor/project/types';
	import {
		beginTextMotionEdit,
		updateTextMotionLive,
		commitTextMotionEdit
	} from '$lib/video-editor/timeline/actions/text-motion';
	import { isTrackEffectivelyLocked, effectiveTrackState } from '$lib/video-editor/timeline/utils/track-groups';
	import { getTextMotionPreset } from '$lib/video-editor/timeline/text-motion-presets';
	import {
		textMotionPresetLabel,
		textMotionSlotLabel
	} from '$lib/video-editor/timeline/text-motion-labels';
	import {
		captureSnapshot,
		restoreSnapshot
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import { planMotionTimelineRows, expandMotionLayerItemIds } from '$lib/video-editor/timeline/motion-timeline-rows';
	import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
	import type { KeyframeProperty } from '$lib/video-editor/project/types';
	import KeyframeDopesheet from '$lib/video-editor/components/keyframe-dopesheet.svelte';
	import KeyframeValueGraph from '$lib/video-editor/components/keyframe-value-graph.svelte';
	import { getAnimatablePropertiesForItem } from '$lib/video-editor/timeline/animated-properties';
	import { getMotionPresets, type MotionPresetId as MotionLayerPresetId } from '$lib/video-editor/timeline/motion-presets';
	import { applyMotionLayersToItems, removeMotionLayerFromItems } from '$lib/video-editor/timeline/actions/motion-layers';
	import { applyMotionModifierToItems, removeMotionModifierFromItems } from '$lib/video-editor/timeline/actions/motion-modifiers';
	import { setPropertyExpression, removePropertyExpression } from '$lib/video-editor/timeline/actions/property-runtime';
	import { compositionControlsStore } from '$lib/video-editor/sequences/composition-controls';
	import { Slider } from '$lib/components/ui/slider';
	import { Button } from '$lib/components/ui/button';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import UnlinkIcon from '@lucide/svelte/icons/unlink-2';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import LockIcon from '@lucide/svelte/icons/lock';
	import UnlockIcon from '@lucide/svelte/icons/unlock';
	import VolumeIcon from '@lucide/svelte/icons/volume-2';
	import VolumeOffIcon from '@lucide/svelte/icons/volume-x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ClipboardIcon from '@lucide/svelte/icons/clipboard';
	import GroupIcon from '@lucide/svelte/icons/group';
	import UngroupIcon from '@lucide/svelte/icons/ungroup';
	import BlendIcon from '@lucide/svelte/icons/blend';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let {
		onedit,
		onselectitem,
		selectedItemId: externalSelectedId = null
	}: {
		onedit: () => void;
		onselectitem?: (id: string | null) => void;
		selectedItemId?: string | null;
	} = $props();

	const externalId = $derived(externalSelectedId);
	const composition = $derived(sequenceStore.activeSequence);
	const isComposite = $derived(composition?.editorKind === 'composite-2d');
	const fps = $derived(composition?.fps ?? timelineStore.fps ?? 30);
	const durationFrames = $derived(
		Math.max(
			composition?.durationInFrames ?? 0,
			timelineStore.items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0),
			60
		)
	);
	const compEnd = $derived(durationFrames);
	const pxPerFrame = $derived(timelinePixelsPerFrame(timelineStore.zoomLevel));
	const timelineWidth = $derived(Math.max(800, durationFrames * pxPerFrame));
	let scrollLeft = $state(0);
	let scrollEl: HTMLDivElement | null = $state(null);
	let sidebarEl: HTMLDivElement | null = $state(null);
	let sidebarScrollTop = $state(0);
	let selectedItemIds = $state<Set<string>>(new Set());
	let lastSelectedId = $state<string | null>(null);
	$effect(() => {
		if (externalId !== null) {
			selectedItemIds = new Set([externalId]);
			lastSelectedId = externalId;
		}
	});
	let pickTarget: string | null = $state(null);
	let pendingParent: string | null = $state(null);
	let status = $state('');
	let zoomSlider = $state(1);
	let showNewDialog = $state(false);
	let newName = $state('');
	let newFps = $state(30);
	let newDuration = $state(300);
	let editingNameId: string | null = $state(null);
	let editingNameValue = $state('');
	let expandedLayerIds = $state<Set<string>>(new Set());
	let expandedGroupIds = $state<Set<string>>(new Set());
	let filterText = $state('');
	let clipboard: TimelineItem[] | null = $state(null);
	let previewFrame: number | null = $state(null);
	let dopesheetMode: 'lanes' | 'graph' = $state('lanes');
	let selectedEasing: string = $state('linear');
	let linkPickSource: { itemId: string; property: string } | null = $state(null);
	$effect(() => {
		zoomSlider = timelineStore.zoomLevel;
	});
	const visibleRange = $derived({
		start: Math.max(0, (scrollLeft - 400) / Math.max(0.001, pxPerFrame)),
		end: Math.max(0, (scrollLeft + 1200) / Math.max(0.001, pxPerFrame))
	});
	const motionPlan = $derived(planMotionTimelineRows({ items: timelineStore.items, tracks: timelineStore.tracks }));
	const motionRows = $derived(motionPlan.rows);
	const trackById = $derived(new Map(timelineStore.tracks.map((t) => [t.id, t])));
	const groupRows = $derived(motionRows.filter((r) => r.kind === 'group'));
	const layerEntries = $derived(motionRows.filter((r) => r.kind === 'layer'));
	const SIDEBAR_VIEWPORT_H = 400;
	const visibleSidebarRows = $derived.by(() => {
		if (motionRows.length < 80) return motionRows;
		const startIdx = Math.max(0, Math.floor(sidebarScrollTop / ROW_H) - 8);
		const endIdx = Math.min(motionRows.length, Math.ceil((sidebarScrollTop + SIDEBAR_VIEWPORT_H) / ROW_H) + 8);
		return motionRows.slice(startIdx, endIdx);
	});

	// Viewport culling: only mount visible bars + selected
	const visualLayerItems = $derived(layerEntries.map((r) => (r as Extract<typeof r, {kind:'layer'}>).item));
	const itemIndex = $derived(buildTimelineItemRangeIndex(visualLayerItems));
	const visibleBars = $derived(queryTimelineItemRange(itemIndex, { start: visibleRange.start, end: visibleRange.end }));
	const visibleIds = $derived(new Set([...visibleBars.map((i) => i.id), ...selectedItemIds]));

	const ROW_H = 34;
	const VECTOR_H = 20;
	const TEXT_BAND_H = 22;
	const compositions = $derived(sequenceStore.compositions.filter((c) => c.editorKind === 'composite-2d'));

	function itemLabel(item: TimelineItem): string {
		return item.label || item.type;
	}
	function selectItem(id: string, additive: boolean, range: boolean): void {
		if (range && lastSelectedId) {
			const ids = layerEntries.map((r) => (r as {item:TimelineItem}).item.id);
			const a = ids.indexOf(lastSelectedId);
			const b = ids.indexOf(id);
			if (a !== -1 && b !== -1) {
				const [lo, hi] = a < b ? [a, b] : [b, a];
				const slice = ids.slice(lo, hi + 1);
				if (additive) {
					const next = new Set(selectedItemIds);
					for (const sid of slice) next.add(sid);
					selectedItemIds = next;
				} else {
					selectedItemIds = new Set(slice);
				}
				lastSelectedId = id;
				onselectitem?.(id);
				return;
			}
		}
		if (additive) {
			const next = new Set(selectedItemIds);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			selectedItemIds = next;
			lastSelectedId = id;
		} else {
			selectedItemIds = new Set([id]);
			lastSelectedId = id;
		}
		onselectitem?.(id);
	}
	function clearSelection(): void {
		selectedItemIds = new Set();
		lastSelectedId = null;
		onselectitem?.(null);
	}
	function seekTo(frame: number): void {
		const clamped = Math.max(0, Math.min(frame, durationFrames - 1));
		timelineStore._setCurrentFrame(clamped);
	}
	function handleTimelineClick(event: MouseEvent): void {
		const target = event.target as HTMLElement;
		if (target.closest('[data-layer-row]') || target.closest('[data-vector-row]') || target.closest('[data-testid^="composition-bar"]')) return;
		clearSelection();
	}
	function motionRegions() {
		const inP = timelineStore.inPoint;
		const outP = timelineStore.outPoint;
		const hasActive = inP !== null && outP !== null && outP > inP;
		return { hasActive, inP, outP };
	}
	function handleZoomChange(value: number[]): void {
		const next = value[0] ?? 1;
		timelineStore._setZoomLevel(next);
	}
	function handleFit(): void {
		const span = Math.max(60, durationFrames);
		const containerWidth = scrollEl ? scrollEl.clientWidth - 220 : 800;
		const targetPxPerFrame = containerWidth / span;
		const level = Math.max(0.25, Math.min(4, targetPxPerFrame / 12));
		timelineStore._setZoomLevel(level);
		status = m.video_editor_composition_timeline_fit();
	}
	function handleScroll(event: Event): void {
		const el = event.currentTarget as HTMLDivElement;
		scrollLeft = el.scrollLeft;
		sidebarScrollTop = el.scrollTop;
		if (sidebarEl && sidebarEl !== el) sidebarEl.scrollTop = el.scrollTop;
	}
	function handleSidebarScroll(event: Event): void {
		const el = event.currentTarget as HTMLDivElement;
		sidebarScrollTop = el.scrollTop;
		if (scrollEl) scrollEl.scrollTop = el.scrollTop;
	}
	let snapGuideFrame: number | null = $state(null);
	function handleWheel(event: WheelEvent): void {
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			if (!scrollEl) return;
			const rect = scrollEl.getBoundingClientRect();
			const pointerRatio = (event.clientX - rect.left + scrollLeft) / Math.max(1, timelineWidth);
			const delta = event.deltaY > 0 ? 0.9 : 1.1;
			const next = Math.max(0.25, Math.min(4, timelineStore.zoomLevel * delta));
			const oldPx = pxPerFrame;
			timelineStore._setZoomLevel(next);
			// compensate scroll to keep frame under pointer anchored
			requestAnimationFrame(() => {
				const newPx = timelinePixelsPerFrame(next);
				const newWidth = durationFrames * newPx;
				const newScroll = pointerRatio * newWidth - (event.clientX - rect.left);
				scrollEl!.scrollLeft = Math.max(0, newScroll);
			});
			return;
		}
		if (Math.abs(event.deltaX) < Math.abs(event.deltaY) && scrollEl) {
			scrollEl.scrollLeft += event.deltaY;
			event.preventDefault();
		}
	}
	function handleGhostScrubMove(frame: number): void {
		previewFrame = Math.max(0, Math.min(frame, durationFrames - 1));
	}
	function commitGhostScrub(): void {
		if (previewFrame !== null) {
			timelineStore._setCurrentFrame(previewFrame);
			previewFrame = null;
		}
	}
	function cancelGhostScrub(): void {
		previewFrame = null;
	}
	function handleTrimToActive(): void {
		const inP = timelineStore.inPoint;
		const outP = timelineStore.outPoint;
		if (inP === null || outP === null || outP <= inP) {
			status = m.video_editor_composition_timeline_no_work_area();
			return;
		}
		const before = captureSnapshot();
		const toRemove = timelineStore.items.filter((item) => item.from + item.durationInFrames <= inP || item.from >= outP).map((i) => i.id);
		const toTrim = timelineStore.items.filter((item) => item.from < inP && item.from + item.durationInFrames > inP || item.from < outP && item.from + item.durationInFrames > outP);
		for (const item of toTrim) {
			let patch: Partial<TimelineItem> = {};
			if (item.from < inP && item.from + item.durationInFrames > inP && item.from < outP) {
				const cut = inP - item.from;
				patch = { from: inP, durationInFrames: item.durationInFrames - cut };
			}
			if (item.from < outP && item.from + item.durationInFrames > outP) {
				const extra = item.from + item.durationInFrames - outP;
				const dur = (patch.durationInFrames ?? item.durationInFrames) - extra;
				patch = { ...patch, durationInFrames: Math.max(1, dur) };
				if (!patch.from) patch.from = item.from;
			}
			if (Object.keys(patch).length) timelineStore._updateItems([{ id: item.id, patch }]);
		}
		if (toRemove.length) timelineStore._removeItems(toRemove);
		const newDur = outP - inP;
		if (composition) sequenceStore.updateComposition(composition.id, { durationInFrames: newDur });
		// shift remaining items so active starts at 0
		for (const item of timelineStore.items) {
			if (item.from >= inP && item.from < outP) timelineStore._updateItems([{ id: item.id, patch: { from: item.from - inP } }]);
		}
		timelineStore._setInPoint(null);
		timelineStore._setOutPoint(null);
		commandHistory.addUndoEntry({ type: 'TRIM_TO_ACTIVE' }, before);
		onedit();
		status = m.video_editor_composition_timeline_trimmed();
	}
	let windowCleanup: Array<() => void> = [];
	onDestroy(() => {
		for (const fn of windowCleanup) fn();
		windowCleanup = [];
		if (drag) restoreSnapshot(drag.before);
		if (kfDrag) restoreSnapshot(kfDrag.before);
		if (textDrag?.before) restoreSnapshot(textDrag.before);
		drag = null;
		kfDrag = null;
		textDrag = null;
		restorePick();
	});
	function trackWindowCleanup(fn: () => void): void {
		windowCleanup.push(fn);
	}
	let pickCleanup: (() => void) | null = null;
	function restorePick(): void {
		if (pickCleanup) pickCleanup();
		pickCleanup = null;
		pendingParent = null;
		pickTarget = null;
	}
	function beginParentPick(childId: string, event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		pendingParent = childId;
		pickTarget = null;
		const onMove = (move: PointerEvent) => {
			const el = document.elementFromPoint(move.clientX, move.clientY) as HTMLElement | null;
			const row = el?.closest<HTMLElement>('[data-layer-row]');
			pickTarget = row?.dataset.layerRow ?? null;
			if (pickTarget === childId) pickTarget = null;
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			const targetId = pickTarget && pickTarget !== childId ? pickTarget : null;
			if (pendingParent && targetId) {
				const parent = timelineStore.itemById.get(targetId);
				const child = timelineStore.itemById.get(pendingParent);
				if (!parent || !child || parent.type === 'audio' || parent.type === 'adjustment') {
					status = m.video_editor_motion_parent_failed();
				} else {
					const result = setTransformParent(pendingParent, targetId);
					if (!result.ok) {
						status =
							result.reason === 'cycle'
								? m.video_editor_motion_parent_cycle()
								: result.reason === 'duplicate-transform'
									? m.video_editor_motion_parent_duplicate()
									: m.video_editor_motion_parent_failed();
					} else {
						status = m.video_editor_composition_timeline_parent_linked();
						onedit();
					}
				}
			}
			restorePick();
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		pickCleanup = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
	}
	function detachParent(childId: string): void {
		if (detachTransformParent(childId)) {
			status = m.video_editor_composition_timeline_parent_detached();
			onedit();
		}
	}
	function removeSelected(): void {
		if (selectedItemIds.size === 0) return;
		const ids = expandMotionLayerItemIds(motionPlan, [...selectedItemIds]);
		const before = captureSnapshot();
		const removed = removeItems(ids, false);
		if (removed.length > 0) {
			clearSelection();
			commandHistory.addUndoEntry({ type: 'REMOVE_ITEMS' }, before);
			onedit();
		}
	}
	function duplicateSelected(): void {
		if (selectedItemIds.size === 0) return;
		const before = captureSnapshot();
		const ids = expandMotionLayerItemIds(motionPlan, [...selectedItemIds]);
		const selected = timelineStore.items.filter((i) => ids.includes(i.id));
		const newItems: TimelineItem[] = selected.map((item) => ({
			...structuredClone(item),
			id: crypto.randomUUID(),
			from: item.from + 10,
			label: item.label ? `${item.label} copy` : item.type
		}));
		timelineStore._setItems([...timelineStore.items, ...newItems]);
		commandHistory.addUndoEntry({ type: 'DUPLICATE_ITEMS' }, before);
		onedit();
		status = m.video_editor_motion_duplicated();
	}
	function copySelected(): void {
		if (selectedItemIds.size === 0) return;
		const ids = expandMotionLayerItemIds(motionPlan, [...selectedItemIds]);
		clipboard = timelineStore.items.filter((i) => ids.includes(i.id)).map((i) => structuredClone(i));
		status = m.video_editor_motion_copied();
	}
	function pasteClipboard(): void {
		if (!clipboard || clipboard.length === 0) return;
		const before = captureSnapshot();
		const offset = 10;
		const newItems: TimelineItem[] = clipboard.map((item) => ({
			...structuredClone(item),
			id: crypto.randomUUID(),
			from: Math.max(0, item.from + offset)
		}));
		timelineStore._setItems([...timelineStore.items, ...newItems]);
		commandHistory.addUndoEntry({ type: 'PASTE_ITEMS' }, before);
		onedit();
		status = m.video_editor_motion_pasted();
	}
	function groupSelected(): void {
		if (selectedItemIds.size < 2) return;
		const ids = expandMotionLayerItemIds(motionPlan, [...selectedItemIds]);
		const selectedTracks = new Set(timelineStore.items.filter((i) => ids.includes(i.id)).map((i) => i.trackId));
		if (selectedTracks.size === 0) return;
		const before = captureSnapshot();
		const groupId = crypto.randomUUID();
		const groupTrack: TimelineTrack = {
			id: groupId,
			name: m.video_editor_composition_timeline_new_group(),
			isGroup: true,
			height: ROW_H,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: Math.min(...[...selectedTracks].map((tid) => trackById.get(tid)?.order ?? 0))
		};
		const newTracks = timelineStore.tracks.map((t) => selectedTracks.has(t.id) ? { ...t, parentTrackId: groupId } : t);
		timelineStore._setTracks([...newTracks, groupTrack]);
		commandHistory.addUndoEntry({ type: 'GROUP_TRACKS' }, before);
		onedit();
	}
	function ungroupTrack(groupId: string): void {
		const before = captureSnapshot();
		const newTracks = timelineStore.tracks.filter((t) => t.id !== groupId).map((t) => t.parentTrackId === groupId ? { ...t, parentTrackId: undefined } : t);
		timelineStore._setTracks(newTracks);
		commandHistory.addUndoEntry({ type: 'UNGROUP_TRACKS' }, before);
		onedit();
	}
	function toggleGroupCollapse(groupId: string): void {
		const track = trackById.get(groupId);
		if (!track) return;
		timelineStore._setTracks(timelineStore.tracks.map((t) => t.id === groupId ? { ...t, isCollapsed: !t.isCollapsed } : t));
	}
	function renameStart(id: string, current: string): void {
		editingNameId = id;
		editingNameValue = current;
		tick().then(() => document.getElementById(`rename-${id}`)?.focus());
	}
	function renameCommit(): void {
		if (!editingNameId) return;
		const val = editingNameValue.trim();
		if (val) {
			const item = timelineStore.itemById.get(editingNameId);
			if (item) {
				const before = captureSnapshot();
				timelineStore._updateItems([{ id: editingNameId, patch: { label: val } }]);
				commandHistory.addUndoEntry({ type: 'RENAME_ITEM' }, before);
				onedit();
			} else {
				const track = trackById.get(editingNameId);
				if (track) {
					const before = captureSnapshot();
					timelineStore._setTracks(timelineStore.tracks.map((t) => t.id === editingNameId ? { ...t, name: val } : t));
					commandHistory.addUndoEntry({ type: 'RENAME_TRACK' }, before);
					onedit();
				}
			}
		}
		editingNameId = null;
	}
	function toggleTrackVisible(trackId: string): void {
		const t = trackById.get(trackId);
		if (!t) return;
		timelineStore._setTracks(timelineStore.tracks.map((x) => x.id === trackId ? { ...x, visible: !x.visible } : x));
		onedit();
	}
	function toggleTrackLocked(trackId: string): void {
		const t = trackById.get(trackId);
		if (!t) return;
		timelineStore._setTracks(timelineStore.tracks.map((x) => x.id === trackId ? { ...x, locked: !x.locked } : x));
		onedit();
	}
	function toggleTrackMuted(trackId: string): void {
		const t = trackById.get(trackId);
		if (!t) return;
		timelineStore._setTracks(timelineStore.tracks.map((x) => x.id === trackId ? { ...x, muted: !x.muted } : x));
		onedit();
	}
	function toggleTrackSolo(trackId: string): void {
		const t = trackById.get(trackId);
		if (!t) return;
		timelineStore._setTracks(timelineStore.tracks.map((x) => x.id === trackId ? { ...x, solo: !x.solo } : x));
		onedit();
	}
	function setBlendMode(itemId: string, mode: string): void {
		const before = captureSnapshot();
		timelineStore._updateItems([{ id: itemId, patch: { blendMode: mode as TimelineItem['blendMode'] } }]);
		commandHistory.addUndoEntry({ type: 'SET_BLEND_MODE' }, before);
		onedit();
	}
	function handleCreateComposition(): void {
		const name = newName.trim() || m.video_editor_motion_composition_title();
		const fpsVal = Math.max(1, Math.min(120, Math.round(newFps)));
		const dur = Math.max(1, Math.round(newDuration));
		const id = crypto.randomUUID();
		const comp = {
			id,
			name,
			editorKind: 'composite-2d' as const,
			items: [],
			tracks: [
				{ id: crypto.randomUUID(), name: 'Video', kind: 'video' as const, height: 34, locked: false, visible: true, muted: false, solo: false, order: 0 },
				{ id: crypto.randomUUID(), name: 'Audio', kind: 'audio' as const, height: 34, locked: false, visible: true, muted: false, solo: false, order: 1 }
			],
			transitions: [],
			fps: fpsVal,
			width: composition?.width ?? 1920,
			height: composition?.height ?? 1080,
			durationInFrames: dur
		};
		sequenceStore.addComposition(comp, true);
		sequenceStore.switchTo(id);
		showNewDialog = false;
		newName = '';
		status = m.video_editor_motion_composition_created();
		onedit();
	}
	function addGeneratedLayer(kind: 'text' | 'solid' | 'gradient' | 'shape' | 'controller'): void {
		const before = captureSnapshot();
		const track = timelineStore.tracks.find((t) => t.kind !== 'audio' && !t.isGroup) ?? timelineStore.tracks[0];
		if (!track) return;
		const base: Partial<TimelineItem> = {
			id: crypto.randomUUID(),
			trackId: track.id,
			from: timelineStore.currentFrame,
			durationInFrames: Math.max(30, Math.min(300, durationFrames - timelineStore.currentFrame)),
			label: kind === 'text' ? 'Text layer' : kind === 'solid' ? 'Solid' : kind === 'gradient' ? 'Gradient' : kind === 'shape' ? 'Shape' : 'Controller',
			type: kind === 'text' ? 'text' : kind === 'shape' ? 'shape' : kind === 'controller' ? 'video' : 'video',
			transform: { x: 0, y: 0, rotation: 0, opacity: 1 }
		};
		if (kind === 'text') {
			base.text = 'Text layer';
			base.textMotion = undefined;
		}
		if (kind === 'solid') {
			base.fillColor = '#ff3b30';
			base.shapeType = 'rectangle';
		}
		if (kind === 'gradient') {
			base.fillType = 'linear';
			base.gradientStartColor = '#ff3b30';
			base.gradientEndColor = '#007aff';
		}
		if (kind === 'shape') {
			base.shapeType = 'rectangle';
			base.fillColor = '#34c759';
		}
		if (kind === 'controller') {
			base.transformParent = undefined;
			// controller is non-rendering: mark via empty label and zero opacity visual hint
			base.blendMode = undefined;
		}
		timelineStore._setItems([...timelineStore.items, base as TimelineItem]);
		commandHistory.addUndoEntry({ type: 'ADD_LAYER' }, before);
		onedit();
	}
	let dropGhost: { frame: number; trackId: string | null; valid: boolean } | null = $state(null);
	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const x = event.clientX - rect.left - 320;
		const frame = Math.round(Math.max(0, x / Math.max(1, pxPerFrame)));
		// validate track under pointer
		const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
		const row = el?.closest<HTMLElement>('[data-layer-row]');
		const trackId = row?.dataset.layerRow ? timelineStore.itemById.get(row.dataset.layerRow)?.trackId ?? null : null;
		const valid = trackId ? !isTrackEffectivelyLocked(trackId, timelineStore.tracks) : false;
		dropGhost = { frame, trackId, valid };
	}
	function handleDragLeave(): void { dropGhost = null; }
	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		const ghost = dropGhost;
		dropGhost = null;
		const mediaId = event.dataTransfer?.getData('text/plain') ?? event.dataTransfer?.getData('application/x-openpost-media');
		if (!mediaId || mediaId.length < 6) return;
		// track-aware validated drop: use ghost track if valid, otherwise first unlocked video track
		let targetTrack: TimelineTrack | undefined;
		if (ghost?.trackId && !isTrackEffectivelyLocked(ghost.trackId, timelineStore.tracks)) {
			targetTrack = timelineStore.tracks.find((t)=> t.id===ghost.trackId);
		}
		if (!targetTrack) targetTrack = timelineStore.tracks.find((t)=> !t.isGroup && t.kind !== 'audio' && !isTrackEffectivelyLocked(t.id, timelineStore.tracks));
		if (!targetTrack) { status = m.video_editor_motion_track_locked(); return; }
		// validate controller exclusion: controller tracks are non-rendering, drop not allowed there if track is controller
		if (targetTrack.name.toLowerCase().includes('controller')) { status = m.video_editor_motion_track_locked(); return; }
		const frame = ghost ? ghost.frame : timelineStore.currentFrame;
		const before=captureSnapshot();
		// build dropped item via track-aware validated path (mirrors buildDroppedMediaTimelineItems)
		const item: TimelineItem = { id: crypto.randomUUID(), trackId: targetTrack.id, from: Math.max(0, frame), durationInFrames: 60, label: mediaId.slice(0,12), type: 'video', transform:{x:0,y:0,rotation:0,opacity:1} };
		// ensure no overlap with existing items on target track
		const overlaps = timelineStore.items.some((it)=> it.trackId===targetTrack!.id && it.from < item.from + item.durationInFrames && it.from + it.durationInFrames > item.from);
		if (overlaps) { status = m.video_editor_motion_track_locked(); return; }
		timelineStore._setItems([...timelineStore.items, item]);
		commandHistory.addUndoEntry({type:'DROP_MEDIA'}, before); onedit(); status = m.video_editor_motion_drop_media();
	}
	function handleLinkPick(itemId: string, property: string): void {
		if (linkPickSource && linkPickSource.itemId === itemId && linkPickSource.property === property) { linkPickSource = null; return; }
		linkPickSource = { itemId, property };
	}
	function handleLinkSelect(targetId: string, targetProp: string): void {
		if (!linkPickSource) return;
		const before=captureSnapshot();
		try { setPropertyExpression(linkPickSource.itemId, linkPickSource.property as KeyframeProperty, `${targetId}.${targetProp}`, true); commandHistory.addUndoEntry({type:'SET_LINK'}, before); onedit(); } catch { status = m.video_editor_motion_parent_failed(); }
		linkPickSource = null;
	}
	type DragState = {
		kind: 'move' | 'trim-start' | 'trim-end';
		id: string;
		startX: number;
		originalFrom: number;
		originalDuration: number;
		before: ReturnType<typeof captureSnapshot>;
		active: boolean;
		pointerId: number;
	};
	let drag: DragState | null = $state(null);
	let rafId: number | null = null;
	function isLocked(item: TimelineItem): boolean {
		return isTrackEffectivelyLocked(item.trackId, timelineStore.tracks);
	}
	function startBarPointerDown(item: TimelineItem, event: PointerEvent): void {
		if (event.button !== 0 || isLocked(item)) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const xInBar = event.clientX - rect.left;
		const w = rect.width;
		const edge = 8;
		let kind: DragState['kind'] = 'move';
		if (xInBar < edge) kind = 'trim-start';
		else if (xInBar > w - edge) kind = 'trim-end';
		const before = captureSnapshot();
		drag = {
			kind,
			id: item.id,
			startX: event.clientX,
			originalFrom: item.from,
			originalDuration: item.durationInFrames,
			before,
			active: false,
			pointerId: event.pointerId
		};
		try {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} catch {}
		const onMove = (e: PointerEvent) => onBarPointerMove(e);
		const onUp = (e: PointerEvent) => onBarPointerUp(e, false);
		const onCancel = (e: PointerEvent) => onBarPointerUp(e, true);
		const onLost = () => onBarPointerUp(new PointerEvent('pointercancel'), true);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		(event.currentTarget as HTMLElement).addEventListener('lostpointercapture', onLost, { once: true });
		trackWindowCleanup(() => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
		});
		event.preventDefault();
		selectItem(item.id, event.ctrlKey || event.metaKey, event.shiftKey);
	}
	function onBarPointerMove(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const deltaPx = event.clientX - drag.startX;
		if (!drag.active && Math.abs(deltaPx) < 3) return;
		drag.active = true;
		if (rafId !== null) cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(() => {
			if (!drag) return;
			const deltaFrames = Math.round(deltaPx / Math.max(0.001, pxPerFrame));
			const item = timelineStore.itemById.get(drag!.id);
			if (!item) return;
			const snapThreshold = calculateAdaptiveSnapThreshold(timelineStore.zoomLevel, pxPerFrame);
			const snapTargets = buildSnapTargets({
				items: timelineStore.items,
				tracks: timelineStore.tracks,
				excludeIds: new Set([drag!.id]),
				currentFrame: timelineStore.currentFrame,
				markers: timelineStore.markers
			});
			if (drag!.kind === 'move') {
				const proposed = drag!.originalFrom + deltaFrames;
				const snap = calculateMoveSnap(proposed, drag!.originalDuration, snapTargets, snapThreshold);
				snapGuideFrame = snap.snappedFrame !== proposed ? snap.snappedFrame : null;
				const patchFrom = Math.max(0, snap.snappedFrame);
				// linked audio propagation: move companions together via planLinkedMoveGesture
				const plan = planLinkedMoveGesture(
					{ ...item, from: drag!.originalFrom, durationInFrames: drag!.originalDuration } as TimelineItem,
					patchFrom - drag!.originalFrom,
					timelineStore.items,
					timelineStore.tracks
				);
				// check transition blocking: if any transition owns the moving item, block
				const blocked = plan.blockedByTransition;
				if (blocked) {
					status = m.video_editor_motion_transition_blocked();
					return;
				}
				// check group lock
				const locked = plan.updates.some((u) => {
					const it = timelineStore.itemById.get(u.id);
					return it ? isTrackEffectivelyLocked(it.trackId, timelineStore.tracks) : false;
				});
				if (locked) {
					status = m.video_editor_motion_track_locked();
					return;
				}
				for (const u of plan.updates) {
					const it = timelineStore.itemById.get(u.id);
					if (it) timelineStore._updateItems([{ id: u.id, patch: { from: u.from } }]);
				}
			} else {
				const handle = drag!.kind === 'trim-start' ? 'start' : 'end';
				const snap = calculateEdgeSnap(
					(handle === 'start' ? drag!.originalFrom : drag!.originalFrom + drag!.originalDuration) + deltaFrames,
					snapTargets,
					snapThreshold
				);
				snapGuideFrame = snap.snappedFrame !== ((handle === 'start' ? drag!.originalFrom : drag!.originalFrom + drag!.originalDuration) + deltaFrames) ? snap.snappedFrame : null;
				const plan = planTrimGesture(
					{ ...item, from: drag!.originalFrom, durationInFrames: drag!.originalDuration } as TimelineItem,
					handle,
					snap.snappedFrame - (handle === 'start' ? drag!.originalFrom : drag!.originalFrom + drag!.originalDuration),
					timelineStore.items,
					timelineStore.fps,
					snapTargets,
					snapThreshold,
					[]
				);
				if ((plan as { blockedByTransition?: boolean }).blockedByTransition) {
					status = m.video_editor_motion_transition_blocked();
					return;
				}
				timelineStore._updateItems([{ id: drag!.id, patch: plan.patch }]);
			}
		});
	}
	function onBarPointerUp(event: PointerEvent, cancelled: boolean): void {
		snapGuideFrame = null;
		if (!drag) return;
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		const before = drag.before;
		const wasActive = drag.active;
		window.removeEventListener('pointermove', onBarPointerMove);
		window.removeEventListener('pointerup', onBarPointerUp);
		window.removeEventListener('pointercancel', onBarPointerUp);
		if (cancelled || !wasActive) {
			restoreSnapshot(before);
			drag = null;
			return;
		}
		const after = captureSnapshot();
		const changed = JSON.stringify(before) !== JSON.stringify(after);
		if (changed) {
			commandHistory.addUndoEntry({ type: drag.kind === 'move' ? 'MOVE_ITEMS' : 'TRIM_ITEM' }, before);
			onedit();
		}
		drag = null;
	}
	// reorder via pointer on layer rows
	let reorderDrag: { id: string; startY: number; pointerId: number; before: ReturnType<typeof captureSnapshot> } | null = $state(null);
	function startReorder(trackId: string, event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		const before = captureSnapshot();
		reorderDrag = { id: trackId, startY: event.clientY, pointerId: event.pointerId, before };
		try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch {}
		const onMove = (e: PointerEvent) => {
			if (!reorderDrag || e.pointerId !== reorderDrag.pointerId) return;
			const deltaY = e.clientY - reorderDrag.startY;
			if (Math.abs(deltaY) < 6) return;
			const rows = motionRows;
			const idx = rows.findIndex((r) => (r.kind === 'layer' ? (r as {track?:TimelineTrack}).track?.id === trackId : r.track.id === trackId));
			const targetIdx = Math.max(0, Math.min(rows.length - 1, idx + Math.round(deltaY / ROW_H)));
			if (targetIdx === idx || targetIdx < 0) return;
			// update track orders atomically
			const trackOrder = timelineStore.tracks.toSorted((a,b)=>a.order-b.order);
			const fromTrack = trackById.get(trackId);
			if (!fromTrack) return;
			const fromOrder = fromTrack.order;
			const toRow = rows[targetIdx];
			const toTrackId = toRow.kind === 'group' ? toRow.track.id : (toRow as {track?:TimelineTrack}).track?.id;
			if (!toTrackId) return;
			const toOrder = trackById.get(toTrackId)?.order ?? fromOrder;
			const newTracks = timelineStore.tracks.map((t) => {
				if (t.id === trackId) return { ...t, order: toOrder };
				if (fromOrder < toOrder && t.order > fromOrder && t.order <= toOrder) return { ...t, order: t.order - 1 };
				if (fromOrder > toOrder && t.order < fromOrder && t.order >= toOrder) return { ...t, order: t.order + 1 };
				return t;
			});
			timelineStore._setTracks(newTracks);
			reorderDrag.startY = e.clientY;
		};
		const onUp = (e: PointerEvent, cancelled = false) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			if (cancelled) {
				if (reorderDrag) restoreSnapshot(reorderDrag.before);
			} else if (reorderDrag) {
				const after = captureSnapshot();
				if (JSON.stringify(reorderDrag.before) !== JSON.stringify(after)) {
					commandHistory.addUndoEntry({ type: 'REORDER_TRACKS' }, reorderDrag.before);
					onedit();
				}
			}
			reorderDrag = null;
		};
		const onCancel = () => onUp(new PointerEvent('pointercancel'), true);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		trackWindowCleanup(() => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
		});
	}
	function handleKeydown(event: KeyboardEvent): void {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
		if (event.key === 'Escape') {
			let handled = false;
			if (previewFrame !== null) { cancelGhostScrub(); handled = true; }
			if (drag) { restoreSnapshot(drag.before); drag = null; handled = true; }
			if (kfDrag) { restoreSnapshot(kfDrag.before); kfDrag = null; handled = true; }
			if (textDrag?.before) { restoreSnapshot(textDrag.before); textDrag = null; handled = true; }
			else if (textDrag) { textDrag = null; handled = true; }
			if (reorderDrag) { restoreSnapshot(reorderDrag.before); reorderDrag = null; handled = true; }
			if (pendingParent) { restorePick(); handled = true; }
			if (handled) { event.preventDefault(); return; }
			clearSelection();
			return;
		}
		if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItemIds.size > 0) {
			event.preventDefault();
			removeSelected();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedItemIds.size > 0) {
			event.preventDefault();
			copySelected();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
			event.preventDefault();
			pasteClipboard();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selectedItemIds.size > 0) {
			event.preventDefault();
			duplicateSelected();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
			event.preventDefault();
			selectedItemIds = new Set(visualLayerItems.map((i) => i.id));
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g' && selectedItemIds.size > 1) {
			event.preventDefault();
			groupSelected();
			return;
		}
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			if (selectedItemIds.size === 0) return;
			event.preventDefault();
			const delta = event.key === 'ArrowLeft' ? -1 : 1;
			const amount = event.shiftKey ? 10 : 1;
			const before = captureSnapshot();
			let moved = false;
			for (const id of selectedItemIds) {
				const item = timelineStore.itemById.get(id);
				if (!item || isLocked(item)) continue;
				const plan = planLinkedMoveGesture(item, delta * amount, timelineStore.items, timelineStore.tracks);
				if (plan.blockedByTransition) continue;
				for (const u of plan.updates) {
					const it = timelineStore.itemById.get(u.id);
					if (it && !isTrackEffectivelyLocked(it.trackId, timelineStore.tracks)) {
						timelineStore._updateItems([{ id: u.id, patch: { from: u.from } }]);
						moved = true;
					}
				}
			}
			if (moved) {
				commandHistory.addUndoEntry({ type: 'MOVE_ITEMS' }, before);
				onedit();
			}
			return;
		}
		// reorder with Alt+Arrow
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && lastSelectedId) {
			event.preventDefault();
			const item = timelineStore.itemById.get(lastSelectedId);
			if (!item) return;
			const rows = motionRows;
			const idx = rows.findIndex((r) => r.kind==='layer' && (r as {item:TimelineItem}).item.id===lastSelectedId);
			const dir = event.key==='ArrowUp' ? -1 : 1;
			const targetIdx = idx + dir;
			if (targetIdx<0 || targetIdx>=rows.length) return;
			const before = captureSnapshot();
			const fromTrack = trackById.get(item.trackId);
			const toRow = rows[targetIdx];
			const toTrackId = toRow.kind==='group' ? toRow.track.id : (toRow as {track?:TimelineTrack}).track?.id;
			if (!fromTrack || !toTrackId) return;
			const toOrder = trackById.get(toTrackId)?.order ?? fromTrack.order;
			const newTracks = timelineStore.tracks.map((t) => t.id===fromTrack.id ? {...t, order: toOrder} : t.order===toOrder ? {...t, order: fromTrack.order} : t);
			timelineStore._setTracks(newTracks);
			commandHistory.addUndoEntry({ type: 'REORDER_TRACKS' }, before);
			onedit();
		}
	}
	function timelineX(frame: number): number {
		return frame * pxPerFrame;
	}
	const MOTION_VECTOR_ROW_DEFINITIONS = [
		{ property: 'position' as const, primary: 'x' as const, secondary: 'y' as const, unit: 'px' },
		{ property: 'scale' as const, primary: 'width' as const, secondary: 'height' as const, unit: '%', },
		{ property: 'anchor' as const, primary: 'anchorX' as const, secondary: 'anchorY' as const, unit: 'px', },
	] as const;
	function vectorLabel(property: (typeof MOTION_VECTOR_ROW_DEFINITIONS)[number]['property']): string {
		if (property === 'position') return m.video_editor_expression_position();
		if (property === 'scale') return m.video_editor_expression_scale();
		return m.video_editor_canvas_tool_anchor();
	}
	function vectorRowsFor(item: TimelineItem) {
		if (item.type === 'audio' || item.type === 'adjustment') return [];
		return MOTION_VECTOR_ROW_DEFINITIONS.filter((row) => {
			const hasVector = activeVectorKeyframes(item, row.property);
			const separated = item.separatedVectorProperties?.includes(row.property);
			return Boolean(hasVector) || !separated;
		}).slice(0, 3);
	}
	function keyframesForVector(item: TimelineItem, property: KeyframeProperty) {
		return editorKeyframes(item, property);
	}
	function selectVectorKeyframe(itemId: string, property: KeyframeProperty, frame: number): void {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return;
		const kfs = editorKeyframes(item, property);
		const kf = kfs.find((k) => k.frame === frame);
		if (!kf) return;
		keyframeSelectionStore.replace(itemId, [keyframeIdentity(kf)]);
	}
	let kfDrag: {
		itemId: string;
		property: KeyframeProperty;
		id: string;
		startFrame: number;
		startX: number;
		before: ReturnType<typeof captureSnapshot>;
	} | null = $state(null);
	let textDrag: {
		itemId: string;
		slot: TextMotionSlot;
		kind: 'duration' | 'offset';
		startX: number;
		startDuration: number;
		startOffset: number;
		maxOffset: number;
		before: ReturnType<typeof captureSnapshot> | null;
		active: boolean;
		pointerId?: number;
	} | null = $state(null);
	function isTextLocked(item: TimelineItem): boolean {
		return isTrackEffectivelyLocked(item.trackId, timelineStore.tracks);
	}
	function textSlotLabel(slot: TextMotionSlot): string {
		return textMotionSlotLabel(slot);
	}
	function textPresetLabel(presetId: string): string {
		return textMotionPresetLabel(presetId as TextMotionPresetId);
	}
	function startTextBandDrag(
		item: TimelineItem,
		band: ReturnType<typeof getTextMotionTimelineBands>[number],
		kind: 'duration' | 'offset',
		event: PointerEvent
	): void {
		if (event.button !== 0 || isTextLocked(item)) return;
		if (kind === 'offset' && band.slot === 'loop') return;
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget as HTMLElement;
		try { target.setPointerCapture(event.pointerId); } catch {}
		const bands = kind === 'offset' ? getTextMotionTimelineBands(item) : [];
		const maxOffset = kind === 'offset' ? getMaxOffsetFrames(band, bands) : 0;
		textDrag = {
			itemId: item.id,
			slot: band.slot,
			kind,
			startX: event.clientX,
			startDuration: band.durationFrames,
			startOffset: band.offsetFrames,
			maxOffset,
			before: null,
			active: false,
			pointerId: event.pointerId
		};
		let cleanup: (() => void) | null = null;
		const doCleanup = () => {
			if (!cleanup) return;
			try { target.releasePointerCapture(textDrag!.pointerId!); } catch {}
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			window.removeEventListener('keydown', onEsc);
			target.removeEventListener('lostpointercapture', onLost);
			const idx = windowCleanup.indexOf(doCleanup);
			if (idx !== -1) windowCleanup.splice(idx, 1);
			cleanup = null;
		};
		const onMove = (e: PointerEvent) => {
			if (!textDrag || textDrag.itemId !== item.id || textDrag.slot !== band.slot || e.pointerId !== textDrag.pointerId) return;
			const delta = Math.round((e.clientX - textDrag.startX) / Math.max(0.001, pxPerFrame));
			if (!textDrag.active && Math.abs(e.clientX - textDrag.startX) < 3) return;
			if (!textDrag.active) { textDrag.before = beginTextMotionEdit(); textDrag.active = true; }
			if (kind === 'duration') {
				const directed = band.slot === 'out' ? -delta : delta;
				const next = Math.max(1, textDrag.startDuration + directed);
				if (item.type === 'text' && item.textMotion?.[band.slot]?.durationFrames === next) return;
				updateTextMotionLive([item.id], band.slot, { durationFrames: next });
			} else {
				const directed = band.slot === 'out' ? -delta : delta;
				const next = Math.max(0, Math.min(textDrag.maxOffset, textDrag.startOffset + directed));
				if (item.type === 'text' && item.textMotion?.[band.slot]?.offsetFrames === next) return;
				updateTextMotionLive([item.id], band.slot, { offsetFrames: next });
			}
		};
		const onUp = () => {
			doCleanup();
			if (!textDrag || !textDrag.active || !textDrag.before) {
				if (textDrag?.before) restoreSnapshot(textDrag.before);
				textDrag = null;
				return;
			}
			const beforeSnap = textDrag.before;
			const wasActive = textDrag.active;
			const startVal = kind === 'duration' ? textDrag.startDuration : textDrag.startOffset;
			const currentVal = item.type === 'text' ? (kind === 'duration' ? item.textMotion?.[band.slot]?.durationFrames : item.textMotion?.[band.slot]?.offsetFrames) : undefined;
			textDrag = null;
			if (!wasActive || currentVal === startVal) { restoreSnapshot(beforeSnap); return; }
			commitTextMotionEdit(beforeSnap, band.slot, [item.id]);
			onedit();
		};
		const onCancel = () => { doCleanup(); if (textDrag?.before) restoreSnapshot(textDrag.before); textDrag = null; };
		const onLost = () => { doCleanup(); if (textDrag?.before) restoreSnapshot(textDrag.before); textDrag = null; };
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && textDrag) {
				e.preventDefault();
				doCleanup();
				if (textDrag.before) restoreSnapshot(textDrag.before);
				textDrag = null;
			}
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		window.addEventListener('keydown', onEsc);
		target.addEventListener('lostpointercapture', onLost);
		trackWindowCleanup(doCleanup);
		cleanup = doCleanup;
	}
	function startTextDurationDrag(item: TimelineItem, band: ReturnType<typeof getTextMotionTimelineBands>[number], event: PointerEvent): void {
		startTextBandDrag(item, band, 'duration', event);
	}
	function startTextOffsetDrag(item: TimelineItem, band: ReturnType<typeof getTextMotionTimelineBands>[number], event: PointerEvent): void {
		startTextBandDrag(item, band, 'offset', event);
	}
	function startKeyframeDrag(itemId: string, property: KeyframeProperty, frame: number, event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selectVectorKeyframe(itemId, property, frame);
		const before = captureSnapshot();
		kfDrag = { itemId, property, id: `${itemId}:${property}:${frame}`, startFrame: frame, startX: event.clientX, before };
		const onMove = (e: PointerEvent) => {
			if (!kfDrag) return;
			const delta = Math.round((e.clientX - kfDrag.startX) / Math.max(0.001, pxPerFrame));
			const newFrame = Math.max(0, kfDrag.startFrame + delta);
			const item = timelineStore.itemById.get(kfDrag.itemId);
			if (!item) return;
			const kfs = editorKeyframes(item, kfDrag.property);
			const kf = kfs.find((k) => k.frame === kfDrag.startFrame);
			if (!kf) return;
			// live preview via direct mutation (coalesced; no per-frame history)
			const idx = kfs.findIndex((k) => k.id === kf.id);
			if (idx === -1) return;
			const patch = {
				keyframes: {
					...item.keyframes,
					[kfDrag.property]: {
						frames: kfs.map((k, i) => (i === idx ? newFrame : k.frame)),
						values: kfs.map((k) => k.value),
						ids: kfs.map((k) => k.id),
						easings: kfs.map((k) => k.easing)
					}
				}
			} as unknown as Partial<TimelineItem>;
			timelineStore._updateItems([{ id: kfDrag.itemId, patch }]);
		};
		const onUp = (e: PointerEvent, cancelled = false) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			if (!kfDrag) return;
			if (cancelled) { restoreSnapshot(kfDrag.before); kfDrag = null; return; }
			const delta = Math.round((e.clientX - kfDrag.startX) / Math.max(0.001, pxPerFrame));
			if (delta !== 0) {
				const newFrame = Math.max(0, kfDrag.startFrame + delta);
				const item = timelineStore.itemById.get(kfDrag.itemId);
				if (item) {
					const kfs = editorKeyframes(item, kfDrag.property);
					const kf = kfs.find((k) => k.frame === kfDrag.startFrame);
					if (kf) {
						updateKeyframes(kfDrag.itemId, [{ ref: kf, frame: newFrame, value: kf.value }]);
						commandHistory.addUndoEntry({ type: 'UPDATE_KEYFRAMES' }, kfDrag.before);
						onedit();
					}
				}
			}
			kfDrag = null;
		};
		const onCancel = () => onUp(new PointerEvent('pointercancel'), true);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
	}
	// marquee selection
	let marquee: { x: number; y: number; w: number; h: number; startX: number; startY: number; active: boolean } | null = $state(null);
	function startMarquee(event: PointerEvent): void {
		const target = event.target as HTMLElement;
		if (target.closest('[data-layer-row]') || target.closest('button') || target.closest('[data-testid^="composition-bar"]')) return;
		if (event.button !== 0) return;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		marquee = { x: event.clientX - rect.left, y: event.clientY - rect.top, w: 0, h: 0, startX: event.clientX, startY: event.clientY, active: false };
		try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch {}
		const onMove = (e: PointerEvent) => {
			if (!marquee) return;
			const dx = e.clientX - marquee.startX;
			const dy = e.clientY - marquee.startY;
			if (!marquee.active && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
			marquee.active = true;
			const curRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
			const curX = e.clientX - curRect.left;
			const curY = e.clientY - curRect.top;
			marquee.w = curX - marquee.x;
			marquee.h = curY - marquee.y;
			// select items whose bar overlaps marquee in timeline content
			const sel = new Set<string>();
			for (const row of layerEntries) {
				const item = (row as {item:TimelineItem}).item;
				const left = timelineX(item.from) - scrollLeft;
				const right = timelineX(item.from + item.durationInFrames) - scrollLeft;
				const top = 8 + visualLayerItems.indexOf(item) * ROW_H;
				const barRect = { left, right, top, bottom: top + ROW_H - 12 };
				const mRect = { left: Math.min(marquee.x, marquee.x + marquee.w), right: Math.max(marquee.x, marquee.x + marquee.w), top: Math.min(marquee.y, marquee.y + marquee.h), bottom: Math.max(marquee.y, marquee.y + marquee.h) };
				if (barRect.right >= mRect.left && barRect.left <= mRect.right && barRect.bottom >= mRect.top && barRect.top <= mRect.bottom) sel.add(item.id);
			}
			if (sel.size) selectedItemIds = sel;
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			marquee = null;
		};
		const onCancel = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); marquee = null; };
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
	}
	// ghost scrub: separate previewFrame, commit on release, cancel on Escape/pointercancel
	let scrubActive = $state(false);
	function startScrub(event: PointerEvent): void {
		if (event.button !== 0) return;
		scrubActive = true;
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const frame = Math.round(((event.clientX - rect.left) / Math.max(1, rect.width)) * (visibleRange.end - visibleRange.start) + visibleRange.start);
		handleGhostScrubMove(frame);
		try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch {}
		const onMove = (e: PointerEvent) => {
			const f = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * (visibleRange.end - visibleRange.start) + visibleRange.start);
			handleGhostScrubMove(f);
		};
		const onUp = (e: PointerEvent) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			window.removeEventListener('keydown', onEsc);
			if (e.type === 'pointercancel') cancelGhostScrub(); else commitGhostScrub();
			scrubActive = false;
		};
		const onCancel = () => onUp(new PointerEvent('pointercancel'));
		const onEsc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); cancelGhostScrub(); scrubActive = false; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); window.removeEventListener('keydown', onEsc); } };
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp, { once: true });
		window.addEventListener('pointercancel', onCancel, { once: true });
		window.addEventListener('keydown', onEsc);
	}
	const rulerTicks = $derived.by(() => {
		const start = Math.floor(visibleRange.start);
		const end = Math.ceil(visibleRange.end);
		const step = Math.max(1, Math.round((30 / fps) * 15));
		const ticks: number[] = [];
		for (let frame = start - (start % step); frame <= end; frame += step) if (frame >= 0) ticks.push(frame);
		return ticks.slice(0, 64);
	});
	const regions = $derived(motionRegions());
	const inP = $derived(timelineStore.inPoint);
	const outP = $derived(timelineStore.outPoint);
	// filter rows by filterText
	const filteredRows = $derived(
		filterText.trim() ? layerEntries.filter((r) => (r as {item:TimelineItem}).item.label.toLowerCase().includes(filterText.toLowerCase())) : layerEntries
	);
	onMount(() => {
		const onSeqChange = () => {
			if (drag) { restoreSnapshot(drag.before); drag = null; }
			if (kfDrag) { restoreSnapshot(kfDrag.before); kfDrag = null; }
			if (textDrag?.before) restoreSnapshot(textDrag.before);
			textDrag = null;
			restorePick();
		};
		const off = () => onSeqChange();
		// listen to workspace/sequence changes via timelineStore mutation not needed; use effect
		return off;
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isComposite && composition}
	<section
		class="composition-timeline"
		aria-label={m.video_editor_composition_timeline_label()}
		data-testid="composition-timeline"
		role="region"
		tabindex="0"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
	>
		<!-- Header: composition picker, new, generated layers, duration/fps, fit, trim -->
		<div class="composition-header">
			<div class="header-left">
				<label class="header-label" for="composition-picker">{m.video_editor_composition_timeline_picker()}</label>
				<select
					id="composition-picker"
					class="composition-picker"
					value={composition.id}
					aria-label={m.video_editor_composition_timeline_picker()}
					onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; if (v) sequenceStore.switchTo(v); }}
					data-testid="composition-picker"
				>
					{#each compositions as comp (comp.id)}
						<option value={comp.id}>{comp.name}</option>
					{/each}
				</select>
				<Button size="sm" variant="ghost" aria-label={m.video_editor_motion_create_composition()} onclick={() => { showNewDialog = true; newName = ''; newFps = fps; newDuration = durationFrames; }} data-testid="composition-new">
					<PlusIcon class="size-4" />
					{m.video_editor_motion_create_composition()}
				</Button>
			</div>
			<div class="header-center">
				<h2 class="composition-title">{composition.name}</h2>
				<span class="composition-meta" aria-label={m.video_editor_composition_timeline_meta()}>
					{composition.width}×{composition.height} · <input aria-label={m.video_editor_composition_timeline_fps()} class="meta-input" type="number" min="1" max="120" value={fps} onchange={(e) => { const v = Math.max(1, Math.min(120, Math.round(Number((e.currentTarget as HTMLInputElement).value) || fps))); sequenceStore.updateComposition(composition.id, { fps: v }); onedit(); }} data-testid="composition-fps" />
					{m.video_editor_composition_timeline_fps_suffix()} · <input aria-label={m.video_editor_composition_timeline_duration()} class="meta-input" type="number" min="1" value={durationFrames} onchange={(e) => { const v = Math.max(1, Math.round(Number((e.currentTarget as HTMLInputElement).value) || durationFrames)); sequenceStore.updateComposition(composition.id, { durationInFrames: v }); onedit(); }} data-testid="composition-duration" />
					{m.video_editor_composition_timeline_frames()}
				</span>
			</div>
			<div class="header-right">
				<div class="header-zoom">
					<label class="zoom-label" for="composition-zoom-slider">{m.video_editor_composition_timeline_zoom()}</label>
					<div class="zoom-slider-wrap">
						<Slider id="composition-zoom-slider" value={[zoomSlider]} min={0.25} max={4} step={0.05} onValueChange={handleZoomChange} aria-label={m.video_editor_composition_timeline_zoom()} />
					</div>
					<Button size="sm" variant="ghost" aria-label={m.video_editor_composition_timeline_fit()} onclick={handleFit} data-testid="composition-fit">
						{m.video_editor_composition_timeline_fit()}
					</Button>
					{#if regions.hasActive}
						<Button size="sm" variant="ghost" aria-label={m.video_editor_composition_timeline_trim_active()} onclick={handleTrimToActive} data-testid="composition-trim-active">
							{m.video_editor_composition_timeline_trim_active()}
						</Button>
					{/if}
				</div>
			</div>
		</div>
		<!-- Generated layers + media add -->
		<div class="composition-toolbar" aria-label={m.video_editor_composition_timeline_toolbar()}>
			<span class="toolbar-label">{m.video_editor_composition_timeline_add_layer()}</span>
			<Button size="sm" variant="outline" onclick={() => addGeneratedLayer('text')} data-testid="add-layer-text">{m.video_editor_motion_add_text()}</Button>
			<Button size="sm" variant="outline" onclick={() => addGeneratedLayer('solid')} data-testid="add-layer-solid">{m.video_editor_motion_add_solid()}</Button>
			<Button size="sm" variant="outline" onclick={() => addGeneratedLayer('gradient')} data-testid="add-layer-gradient">{m.video_editor_motion_add_gradient()}</Button>
			<Button size="sm" variant="outline" onclick={() => addGeneratedLayer('shape')} data-testid="add-layer-shape">{m.video_editor_motion_add_shape()}</Button>
			<Button size="sm" variant="outline" onclick={() => addGeneratedLayer('controller')} data-testid="add-layer-controller">{m.video_editor_motion_add_controller()}</Button>
			<label class="toolbar-search">
				<span class="sr-only">{m.video_editor_composition_timeline_filter()}</span>
				<input class="filter-input" placeholder={m.video_editor_composition_timeline_filter_placeholder()} value={filterText} oninput={(e) => filterText = (e.currentTarget as HTMLInputElement).value} aria-label={m.video_editor_composition_timeline_filter()} data-testid="composition-filter" />
			</label>
		</div>
		<div class="io-lane" data-testid="composition-io-lane" aria-label={m.video_editor_composition_timeline_range()}>
			<div class="io-strip">
				{#if inP !== null && outP !== null && outP > inP}
					<div class="io-range" style="left:{Math.max(0, (inP - visibleRange.start) / Math.max(1, visibleRange.end - visibleRange.start)) * 100}%; width:{Math.max(1, (outP - inP) / Math.max(1, visibleRange.end - visibleRange.start)) * 100}%" data-testid="composition-io-range" data-from-frame={inP} data-to-frame={outP}>
						<span class="io-label">{m.video_editor_composition_timeline_work_area()}</span>
					</div>
					<button type="button" class="io-handle io-handle-in" style="left:{Math.max(0, Math.min(100, (inP - visibleRange.start) / Math.max(1, visibleRange.end - visibleRange.start)) * 100)}%" aria-label={m.video_editor_composition_timeline_in_point()} data-testid="composition-io-in" onpointerdown={(event) => {
						const startX = event.clientX; const startIn = inP; const before = captureSnapshot(); let changed = false;
						const onMove = (move: PointerEvent) => { const deltaFrames = Math.round((move.clientX - startX) / pxPerFrame); const next = Math.max(0, Math.min(startIn + deltaFrames, (outP ?? durationFrames) - 1)); if (next !== timelineStore.inPoint) { changed = true; timelineStore._setInPoint(next); }};
						const cleanup = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); };
						const onUp = () => { cleanup(); if (changed && JSON.stringify(before) !== JSON.stringify(captureSnapshot())) { commandHistory.addUndoEntry({ type: 'SET_IN_POINT' }, before); onedit(); }};
						const onCancel = () => { cleanup(); restoreSnapshot(before); };
						window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel);
					}}></button>
					<button type="button" class="io-handle io-handle-out" style="left:{Math.max(0, Math.min(100, (outP - visibleRange.start) / Math.max(1, visibleRange.end - visibleRange.start)) * 100)}%" aria-label={m.video_editor_composition_timeline_out_point()} data-testid="composition-io-out" onpointerdown={(event) => {
						const startX = event.clientX; const startOut = outP; const before = captureSnapshot(); let changed = false;
						const onMove = (move: PointerEvent) => { const deltaFrames = Math.round((move.clientX - startX) / pxPerFrame); const next = Math.max((inP ?? 0) + 1, Math.min(startOut + deltaFrames, durationFrames)); if (next !== timelineStore.outPoint) { changed = true; timelineStore._setOutPoint(next); }};
						const cleanup = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); };
						const onUp = () => { cleanup(); if (changed && JSON.stringify(before) !== JSON.stringify(captureSnapshot())) { commandHistory.addUndoEntry({ type: 'SET_OUT_POINT' }, before); onedit(); }};
						const onCancel = () => { cleanup(); restoreSnapshot(before); };
						window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel);
					}}></button>
				{/if}
				{#if !regions.hasActive}
					<span class="io-empty">{m.video_editor_composition_timeline_full_range()}</span>
				{/if}
			</div>
		</div>
		<div class="composition-body" data-testid="composition-body">
			<div class="layer-sidebar" aria-label={m.video_editor_composition_timeline_layers()} bind:this={sidebarEl} onscroll={handleSidebarScroll} role="region" tabindex="0">
				<div class="layer-sidebar-header">
					<span>{m.video_editor_composition_timeline_layer()}</span>
					<span class="col-parent">{m.video_editor_motion_parent_label()}</span>
					<span class="col-blend"><BlendIcon class="size-3" /></span>
					<span class="col-timing">{m.video_editor_composition_timeline_timing()}</span>
				</div>
				{#each visibleSidebarRows as row (row.kind === 'group' ? row.track.id : (row as {item:TimelineItem}).item.id)}
					{#if row.kind === 'group'}
						{@const isExpanded = !row.track.isCollapsed}
						{@const groupSelected = row.itemIds.some((id) => selectedItemIds.has(id))}
						<div class="group-row" data-group-row={row.track.id} data-testid={`group-row-${row.track.id}`}>
							<button type="button" class="group-header" class:selected={groupSelected} aria-pressed={groupSelected} aria-label={row.track.name} data-testid={`group-header-${row.track.id}`} onclick={() => { if (row.itemIds.length===0) return; const allSelected = row.itemIds.every((id)=>selectedItemIds.has(id)); if (allSelected) { const next=new Set(selectedItemIds); for(const id of row.itemIds) next.delete(id); selectedItemIds=next; } else { const next=new Set(selectedItemIds); for(const id of row.itemIds) next.add(id); selectedItemIds=next; } }}>
								<span class="group-toggle" role="button" tabindex="0" aria-label={isExpanded ? m.video_editor_composition_timeline_collapse() : m.video_editor_composition_timeline_expand()} onclick={(e) => { e.stopPropagation(); toggleGroupCollapse(row.track.id); }} onkeydown={(e) => { if(e.key==='Enter'||e.key===' ') { e.preventDefault(); toggleGroupCollapse(row.track.id); }}}>
									{#if isExpanded}<ChevronDownIcon class="size-3" />{:else}<ChevronRightIcon class="size-3" />{/if}
								</span>
								{#if editingNameId === row.track.id}
									<input id="rename-{row.track.id}" class="rename-input" value={editingNameValue} oninput={(e) => editingNameValue=(e.currentTarget as HTMLInputElement).value} onkeydown={(e) => { if(e.key==='Enter') renameCommit(); if(e.key==='Escape') editingNameId=null; }} onblur={renameCommit} data-testid={`rename-group-${row.track.id}`} aria-label={m.video_editor_composition_timeline_rename()} />
								{:else}
									<span class="group-name" ondblclick={() => renameStart(row.track.id, row.track.name)}>{row.track.name}</span>
									<span class="group-span">{row.itemIds.length ? `${Math.min(...row.itemIds.map((id)=>timelineStore.itemById.get(id)?.from ?? 0))}–${Math.max(...row.itemIds.map((id)=> (timelineStore.itemById.get(id)?.from ?? 0)+(timelineStore.itemById.get(id)?.durationInFrames ?? 0)))}` : ''}</span>
								{/if}
							</button>
							<span class="group-actions">
								<Button size="icon" variant="ghost" aria-label={row.track.visible ? m.video_editor_timeline_hide() : m.video_editor_timeline_show()} onclick={() => toggleTrackVisible(row.track.id)} data-testid={`group-visible-${row.track.id}`} class="icon-btn">
									{#if row.track.visible}<EyeIcon class="size-3" />{:else}<EyeOffIcon class="size-3" />{/if}
								</Button>
								<Button size="icon" variant="ghost" aria-label={row.track.locked ? m.video_editor_timeline_unlock() : m.video_editor_timeline_lock()} onclick={() => toggleTrackLocked(row.track.id)} data-testid={`group-lock-${row.track.id}`} class="icon-btn">
									{#if row.track.locked}<LockIcon class="size-3" />{:else}<UnlockIcon class="size-3" />{/if}
								</Button>
								<Button size="icon" variant="ghost" aria-label={row.track.muted ? m.video_editor_timeline_unmute() : m.video_editor_timeline_mute()} onclick={() => toggleTrackMuted(row.track.id)} data-testid={`group-mute-${row.track.id}`} class="icon-btn">
									{#if row.track.muted}<VolumeOffIcon class="size-3" />{:else}<VolumeIcon class="size-3" />{/if}
								</Button>
								<Button size="icon" variant="ghost" aria-label={m.video_editor_composition_timeline_ungroup()} onclick={() => ungroupTrack(row.track.id)} data-testid={`group-ungroup-${row.track.id}`} class="icon-btn">
									<UngroupIcon class="size-3" />
								</Button>
								<Button size="icon" variant="ghost" aria-label={m.video_editor_composition_timeline_delete_group()} onclick={() => { const before=captureSnapshot(); const ids=row.itemIds.flatMap((id)=>expandMotionLayerItemIds(motionPlan,[id])); if(ids.length) removeItems(ids,false); const remaining=timelineStore.tracks.filter((t)=>t.id!==row.track.id).map((t)=>t.parentTrackId===row.track.id?{...t,parentTrackId:undefined}:t); timelineStore._setTracks(remaining); commandHistory.addUndoEntry({type:'DELETE_GROUP'},before); onedit(); }} data-testid={`group-delete-${row.track.id}`} class="icon-btn">
									<TrashIcon class="size-3" />
								</Button>
							</span>
							<span class="drag-handle" aria-label={m.video_editor_composition_timeline_reorder()} role="button" tabindex="0" onpointerdown={(e)=>startReorder(row.track.id,e)} onkeydown={(e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); /* keyboard reorder via Alt+Arrow */ }}}>≡</span>
						</div>
					{:else}
						{@const item = (row as {item:TimelineItem}).item}
						{@const track = (row as {track?:TimelineTrack}).track}
						{@const isSelected = selectedItemIds.has(item.id)}
						{@const parentId = item.transformParent?.parentItemId}
						{@const expanded = expandedLayerIds.has(item.id)}
						{@const filtered = filterText.trim() ? item.label.toLowerCase().includes(filterText.toLowerCase()) : true}
						{#if filtered}
						{@const vRows = vectorRowsFor(item)}
						{@const textBands = item.type === 'text' ? getTextMotionTimelineBands(item) : []}
						<div class="layer-row-wrap" style="height:{ROW_H + vRows.length*VECTOR_H + textBands.length*TEXT_BAND_H + (expanded ? 28 : 0)}px" data-row-id={item.id} data-layer-row={item.id}>
							<div
								class="layer-row"
								class:selected={isSelected}
								class:pickTarget={pickTarget === item.id}
								class:controller={item.type==='video' && item.label?.toLowerCase().includes('controller')}
								data-testid={`composition-layer-${item.id}`}
								role="button"
								tabindex="0"
								aria-pressed={isSelected}
								aria-label={itemLabel(item)}
								onclick={(e) => selectItem(item.id, e.ctrlKey || e.metaKey, e.shiftKey)}
								onkeydown={(e) => { if(e.key==='Enter'||e.key===' ') { e.preventDefault(); selectItem(item.id, e.ctrlKey||e.metaKey, e.shiftKey); }}}
								oncontextmenu={(e) => { e.preventDefault(); // open context via right-click selects first
									if(!selectedItemIds.has(item.id)) selectItem(item.id, false, false);
								}}
								onpointerdown={(e) => { if(e.button===2) return; if(e.ctrlKey||e.metaKey) return; }}
							>
								<button type="button" class="layer-expand" aria-label={expanded ? m.video_editor_composition_timeline_collapse() : m.video_editor_composition_timeline_expand()} aria-pressed={expanded} tabindex="0" onclick={(e) => { e.stopPropagation(); const next=new Set(expandedLayerIds); if(next.has(item.id)) next.delete(item.id); else next.add(item.id); expandedLayerIds=next; }} data-testid={`layer-expand-${item.id}`}>
									{#if expanded}<ChevronDownIcon class="size-3" />{:else}<ChevronRightIcon class="size-3" />{/if}
								</button>
								{#if editingNameId === item.id}
									<input id="rename-{item.id}" class="rename-input" value={editingNameValue} oninput={(e) => editingNameValue=(e.currentTarget as HTMLInputElement).value} onkeydown={(e) => { if(e.key==='Enter') renameCommit(); if(e.key==='Escape') editingNameId=null; }} onblur={renameCommit} data-testid={`rename-layer-${item.id}`} aria-label={m.video_editor_composition_timeline_rename()} />
								{:else}
									<span class="layer-name" ondblclick={() => renameStart(item.id, itemLabel(item))} title={itemLabel(item)}>{itemLabel(item)}</span>
								{/if}
								<span class="layer-type-badge" aria-label={item.type}>{item.type==='text'?'T':item.type==='shape'?'S':item.type==='video'&&item.label?.toLowerCase().includes('controller')?'C':item.type[0]?.toUpperCase()}</span>
								<span class="layer-actions">
									<Button size="icon" variant="ghost" aria-label={(track ? effectiveTrackState(track, timelineStore.tracks).visible===false : false) ? m.video_editor_timeline_show() : m.video_editor_timeline_hide()} onclick={(e) => { e.stopPropagation(); if(track) toggleTrackVisible(track.id); }} data-testid={`layer-visible-${item.id}`} class="icon-btn">
										{#if track && effectiveTrackState(track, timelineStore.tracks).visible===false}<EyeOffIcon class="size-3" />{:else}<EyeIcon class="size-3" />{/if}
									</Button>
									<Button size="icon" variant="ghost" aria-label={(track ? effectiveTrackState(track, timelineStore.tracks).locked : false) ? m.video_editor_timeline_unlock() : m.video_editor_timeline_lock()} onclick={(e) => { e.stopPropagation(); if(track) toggleTrackLocked(track.id); }} data-testid={`layer-lock-${item.id}`} class="icon-btn">
										{#if track && effectiveTrackState(track, timelineStore.tracks).locked}<LockIcon class="size-3" />{:else}<UnlockIcon class="size-3" />{/if}
									</Button>
									<Button size="icon" variant="ghost" aria-label={(track ? effectiveTrackState(track, timelineStore.tracks).muted : false) ? m.video_editor_timeline_unmute() : m.video_editor_timeline_mute()} onclick={(e) => { e.stopPropagation(); if(track) toggleTrackMuted(track.id); }} data-testid={`layer-mute-${item.id}`} class="icon-btn">
										{#if track && effectiveTrackState(track, timelineStore.tracks).muted}<VolumeOffIcon class="size-3" />{:else}<VolumeIcon class="size-3" />{/if}
									</Button>
									<Button size="icon" variant="ghost" aria-label={(track ? effectiveTrackState(track, timelineStore.tracks).solo : false) ? m.video_editor_timeline_unsolo() : m.video_editor_timeline_solo()} onclick={(e) => { e.stopPropagation(); if(track) toggleTrackSolo(track.id); }} data-testid={`layer-solo-${item.id}`} class="icon-btn">
										<span class="solo-label">S</span>
									</Button>
								</span>
							</div>
							<div class="layer-meta-row">
								<div class="parent-cell">
									{#if parentId}
										{@const parent = timelineStore.itemById.get(parentId)}
										<span class="parent-name">{parent ? parent.label : parentId.slice(0,6)}</span>
										<Button size="icon" variant="ghost" aria-label={m.video_editor_motion_parent_none()} onclick={() => detachParent(item.id)} data-testid={`parent-detach-${item.id}`} class="icon-btn"><UnlinkIcon class="size-3" /></Button>
									{:else}
										<Button size="icon" variant="ghost" aria-label={m.video_editor_composition_timeline_link_parent({ name: itemLabel(item) })} data-testid={`parent-pick-${item.id}`} onpointerdown={(event) => beginParentPick(item.id, event)} class="icon-btn"><Link2Icon class="size-3" /></Button>
									{/if}
								</div>
								<label class="blend-cell">
									<span class="sr-only">{m.video_editor_composition_timeline_blend_mode()}</span>
									<select aria-label={m.video_editor_composition_timeline_blend_mode()} value={item.blendMode ?? 'normal'} onchange={(e) => setBlendMode(item.id, (e.currentTarget as HTMLSelectElement).value)} data-testid={`blend-${item.id}`} class="blend-select">
										<option value="normal">Normal</option>
										<option value="multiply">Multiply</option>
										<option value="screen">Screen</option>
										<option value="overlay">Overlay</option>
										<option value="add">Add</option>
									</select>
								</label>
								<span class="timing-cell" data-testid={`timing-${item.id}`}>
									<input class="timing-input" type="number" min="0" value={item.from} aria-label="{itemLabel(item)} in" onchange={(e)=>{ const v=Math.max(0, Math.round(Number((e.currentTarget as HTMLInputElement).value)||item.from)); const before=captureSnapshot(); timelineStore._updateItems([{id:item.id, patch:{from:v}}]); commandHistory.addUndoEntry({type:'EDIT_TIMING'}, before); onedit(); }} data-testid={`timing-in-${item.id}`} />
									<span>–</span>
									<input class="timing-input" type="number" min="1" value={item.from + item.durationInFrames} aria-label="{itemLabel(item)} out" onchange={(e)=>{ const v=Math.max(item.from+1, Math.round(Number((e.currentTarget as HTMLInputElement).value)||item.from+item.durationInFrames)); const dur=Math.max(1, v - item.from); const before=captureSnapshot(); timelineStore._updateItems([{id:item.id, patch:{durationInFrames:dur}}]); commandHistory.addUndoEntry({type:'EDIT_TIMING'}, before); onedit(); }} data-testid={`timing-out-${item.id}`} />
								</span>
								<span class="drag-handle" aria-label={m.video_editor_composition_timeline_reorder()} role="button" tabindex="0" onpointerdown={(e)=>startReorder(track?.id ?? item.trackId, e)}>≡</span>
							</div>
							{#each vRows as vRow (vRow.property)}
								<div class="vector-row" data-vector-row={`${item.id}:${vRow.property}`} data-testid={`vector-row-${item.id}-${vRow.property}`}>
									<span class="vector-label">{vectorLabel(vRow.property)}</span>
									<span class="vector-unit">{vRow.unit}</span>
									<div class="vector-keys" aria-hidden="true"></div>
								</div>
							{/each}
							{#each textBands as band (band.slot)}
								<div class="text-band-row" data-testid={`text-band-row-${item.id}-${band.slot}`}>
									<span class="text-band-label">{textSlotLabel(band.slot)}</span>
									<span class="text-band-preset">{textPresetLabel(band.presetId)}</span>
									<span class="text-band-meta">{m.video_editor_composition_timeline_text_duration({ frames: String(band.durationFrames) })} · {m.video_editor_composition_timeline_text_units({ count: String(band.unitCount) })}{band.offsetFrames ? ` · ${m.video_editor_composition_timeline_text_off({ frames: String(band.offsetFrames) })}` : ''}</span>
								</div>
							{/each}
							{#if expanded}
								<div class="inline-props" data-testid={`inline-props-${item.id}`}>
									<div class="dopesheet-mode-row" data-testid={`dopesheet-mode-${item.id}`}>
										<button type="button" class="mode-btn" class:active={dopesheetMode==='lanes'} aria-pressed={dopesheetMode==='lanes'} onclick={()=>dopesheetMode='lanes'} data-testid={`mode-lanes-${item.id}`}>Lanes</button>
										<button type="button" class="mode-btn" class:active={dopesheetMode==='graph'} aria-pressed={dopesheetMode==='graph'} onclick={()=>dopesheetMode='graph'} data-testid={`mode-graph-${item.id}`}>Graph</button>
										<label class="easing-picker" data-testid={`easing-picker-${item.id}`}><span>Easing</span><select value={selectedEasing} onchange={(e)=>{ const v=(e.currentTarget as HTMLSelectElement).value; selectedEasing=v; const sel=keyframeSelectionStore.forItem(item.id); if(sel.size===0) return; const before=captureSnapshot(); for(const id of sel){ const kf=editorKeyframes(item, 'x').find(k=>keyframeIdentity(k)===id) ?? editorKeyframes(item, 'y').find(k=>keyframeIdentity(k)===id); if(kf) updateKeyframes(item.id, [{ref:kf, frame:kf.frame, value:kf.value, easing:v as any}]); } commandHistory.addUndoEntry({type:'SET_EASING'}, before); onedit(); }} data-testid={`easing-select-${item.id}`}><option value="linear">Linear</option><option value="ease-in">Ease In</option><option value="ease-out">Ease Out</option><option value="ease-in-out">Ease In Out</option></select></label>
										<button type="button" class="retime-btn" onclick={()=>{ const sel=[...keyframeSelectionStore.forItem(item.id)]; if(sel.length<2) return; const before=captureSnapshot(); const kfs=sel.map(id=>{ const kf=[...editorKeyframes(item,'x'),...editorKeyframes(item,'y'),...editorKeyframes(item,'opacity')].find(k=>keyframeIdentity(k)===id); return kf ? {id, frame:kf.frame} : null; }).filter(Boolean) as {id:string,frame:number}[]; const min=Math.min(...kfs.map(k=>k.frame)); const max=Math.max(...kfs.map(k=>k.frame)); const span=max-min||1; for(const k of kfs){ const kf=[...editorKeyframes(item,'x'),...editorKeyframes(item,'y')].find(x=>keyframeIdentity(x)===k.id); if(!kf) continue; const t=(k.frame-min)/span; const newFrame=Math.round(min + t*span*0.9); updateKeyframes(item.id, [{ref:kf, frame:newFrame, value:kf.value}]); } commandHistory.addUndoEntry({type:'RETIME_BATCH'}, before); onedit(); }} data-testid={`retime-batch-${item.id}`}>Retime 0.9x</button>
									</div>
									{#if dopesheetMode==='lanes'}
									<KeyframeDopesheet
										item={item}
										availableProperties={getAnimatablePropertiesForItem(item)}
										currentFrame={previewFrame ?? timelineStore.currentFrame}
										pixelsPerFrame={pxPerFrame}
										timelineWidth={timelineWidth}
										timelineX={timelineX}
										onscrub={(f) => { previewFrame = f; }}
										onedit={onedit}
									/>
									{:else}
									<KeyframeValueGraph
										item={item}
										property={getAnimatablePropertiesForItem(item)[0] ?? 'x' as KeyframeProperty}
										currentFrame={previewFrame ?? timelineStore.currentFrame}
										onscrub={(f) => { previewFrame = f; timelineStore._setCurrentFrame(f); }}
										onedit={onedit}
									/>
									{/if}
								</div>
								{#if item.motionLayers && item.motionLayers.length > 0}
									<div class="motion-layer-bands" data-testid={`motion-layers-${item.id}`}>
										{#each item.motionLayers as layer (layer.id)}
											<button type="button" class="motion-layer-band" style="left:{timelineX(item.from)}px; width:{Math.max(8, item.durationInFrames * pxPerFrame)}px" data-testid={`motion-layer-${item.id}-${layer.id}`} aria-label={layer.name ?? layer.presetId ?? 'layer'} onclick={() => { const before=captureSnapshot(); removeMotionLayerFromItems([item.id], layer.id); commandHistory.addUndoEntry({type:'REMOVE_MOTION_LAYER'}, before); onedit(); }}>
												<span class="band-label">{layer.name ?? layer.presetId ?? 'layer'}</span>
											</button>
										{/each}
									</div>
								{/if}
								{#if item.motionModifiers && item.motionModifiers.length > 0}
									<div class="modifier-bands" data-testid={`motion-modifiers-${item.id}`}>
										{#each item.motionModifiers as mod (mod.type)}
											<button type="button" class="modifier-band" style="left:{timelineX(item.from)}px; width:{Math.max(8, item.durationInFrames * pxPerFrame)}px" data-testid={`modifier-${item.id}-${mod.type}`} aria-label={mod.type} onclick={() => { const before=captureSnapshot(); removeMotionModifierFromItems([item.id], mod.type); commandHistory.addUndoEntry({type:'REMOVE_MODIFIER'}, before); onedit(); }}>
												<span class="band-label">{mod.type}</span>
											</button>
										{/each}
									</div>
								{/if}
								{#if item.pathVertices}
									<div class="path-vertex-lane" data-testid={`path-vertices-${item.id}`}>
										<span class="band-label">{item.pathVertices.length} vertices</span>
									</div>
								{/if}
								{#if item.isMask}
									<div class="mask-lane" data-testid={`mask-lane-${item.id}`}>
										<span class="band-label">{item.maskType ?? 'mask'} {item.maskFeather ? `feather ${item.maskFeather}` : ''}</span>
									</div>
								{/if}
								<div class="link-pick-row" data-testid={`link-pick-${item.id}`}>
									<button type="button" class="link-pick-btn" aria-pressed={linkPickSource?.itemId===item.id} aria-label="Link pick" onclick={()=>handleLinkPick(item.id, 'x')} data-testid={`link-pick-btn-${item.id}`}>
										<Link2Icon class="size-3" /> {linkPickSource?.itemId===item.id ? 'Pick target…' : 'Link'}
									</button>
									{#if item.propertyLinks && item.propertyLinks.length>0}
										{#each item.propertyLinks as link (link.targetProperty)}
											<span class="link-badge" data-testid={`link-badge-${item.id}-${link.targetProperty}`}>{link.targetProperty}→{link.sourceItemId}</span>
											<button type="button" class="icon-btn" aria-label="Remove link" onclick={()=>{ const before=captureSnapshot(); removePropertyExpression(item.id, link.targetProperty as KeyframeProperty); commandHistory.addUndoEntry({type:'REMOVE_LINK'}, before); onedit(); }} data-testid={`link-remove-${item.id}-${link.targetProperty}`}><UnlinkIcon class="size-3" /></button>
										{/each}
									{/if}
								</div>
								{#if composition?.compositionControls && Object.keys(composition.compositionControls).length>0}
									<div class="published-controls" data-testid={`published-controls-${item.id}`}>
										<span class="band-label">Published controls</span>
										{#each Object.entries(composition.compositionControls) as [key, ctrl]}
											<label class="control-row"><span>{key}</span><input type="text" value={item.compositionControlOverrides?.[key] ?? ''} placeholder={String(ctrl.defaultValue ?? '')} onchange={(e)=>{ const v=(e.currentTarget as HTMLInputElement).value; const before=captureSnapshot(); const overrides={...(item.compositionControlOverrides ?? {}), [key]: v}; timelineStore._updateItems([{id:item.id, patch:{compositionControlOverrides: overrides}}]); commandHistory.addUndoEntry({type:'SET_CONTROL_OVERRIDE'}, before); onedit(); }} data-testid={`control-override-${item.id}-${key}`} /></label>
										{/each}
									</div>
								{/if}
							{/if}
						</div>
						{/if}
					{/if}
				{/each}
				{#if motionRows.length === 0}
					<div class="empty-layers" data-testid="composition-empty-layers">
						<p>{m.video_editor_composition_timeline_empty()}</p>
						<div class="empty-actions">
							<Button size="sm" onclick={() => addGeneratedLayer('text')} data-testid="empty-add-text">{m.video_editor_motion_add_text()}</Button>
							<Button size="sm" variant="outline" onclick={() => addGeneratedLayer('solid')} data-testid="empty-add-solid">{m.video_editor_motion_add_solid()}</Button>
						</div>
					</div>
				{/if}
			</div>
			<div class="timeline-content" bind:this={scrollEl} onscroll={handleScroll} onwheel={handleWheel} onclick={handleTimelineClick} onpointerdown={startMarquee} role="region" tabindex="0" aria-label={m.video_editor_composition_timeline_layers()} data-testid="composition-scroll">
				<div class="timeline-inner" style="width:{timelineWidth}px; height:{Math.max(240, layerEntries.length * ROW_H + 120)}px">
					<div class="composition-ruler" role="group" aria-label={m.video_editor_composition_timeline_ruler()} onpointerdown={startScrub} data-testid="composition-ruler">
						{#each rulerTicks as tick (tick)}
							<button type="button" class="ruler-tick" style="left:{timelineX(tick)}px" aria-label={`${tick}`} onclick={() => seekTo(tick)} data-testid={`ruler-tick-${tick}`}>
								<span class="tick-line"></span>
								<span class="tick-label">{tick}</span>
							</button>
						{/each}
						<div class="ruler-playhead" style="left:{timelineX(timelineStore.currentFrame)}px" data-testid="composition-playhead" aria-hidden="true"></div>
						{#if previewFrame !== null}
							<div class="ruler-playhead ghost" style="left:{timelineX(previewFrame)}px" data-testid="composition-playhead-ghost" aria-hidden="true"></div>
						{/if}
						{#if regions.hasActive}
							<div class="active-region-dim left" style="width:{timelineX(regions.inP ?? 0)}px" data-testid="composition-active-dim-left"></div>
							<div class="active-region-dim right" style="left:{timelineX(regions.outP ?? durationFrames)}px; width:{Math.max(0, timelineWidth - timelineX(regions.outP ?? durationFrames))}px" data-testid="composition-active-dim-right"></div>
						{/if}
						<div class="comp-end-dim" style="left:{timelineX(compEnd)}px; width:{Math.max(0, timelineWidth - timelineX(compEnd))}px" data-testid="composition-end-dim"></div>
					</div>
					<div class="layer-bars" data-testid="composition-layer-bars" style="height:{Math.max(200, layerEntries.length * ROW_H)}px">
						{#each layerEntries as row, idx (row.item.id)}
							{@const item = row.item}
							{@const isSelected = selectedItemIds.has(item.id)}
							{#if visibleIds.has(item.id) || isSelected}
								{@const vRows = vectorRowsFor(item)}
								{@const textBands = item.type === 'text' ? getTextMotionTimelineBands(item) : []}
								<button
									type="button"
									class="layer-bar"
									class:selected={isSelected}
									style="left:{timelineX(item.from)}px; top:{8 + idx * ROW_H}px; width:{Math.max(8, item.durationInFrames * pxPerFrame)}px; height:{ROW_H - 12}px"
									data-testid={`composition-bar-${item.id}`}
									aria-label={itemLabel(item)}
									aria-pressed={isSelected}
									onpointerdown={(event) => startBarPointerDown(item, event)}
									onclick={(event) => { event.stopPropagation(); selectItem(item.id, event.ctrlKey || event.metaKey, event.shiftKey); }}
									ondblclick={() => { const mid=item.from+Math.floor(item.durationInFrames/2); seekTo(mid); }}
								>
									<span class="bar-label">{itemLabel(item)}</span>
								</button>
								{#each vRows as vRow, vIdx (vRow.property)}
									<div class="vector-lane" style="top:{8 + idx*ROW_H + ROW_H + vIdx*VECTOR_H}px; height:{VECTOR_H}px" data-testid={`vector-lane-${item.id}-${vRow.property}`}>
										{#each keyframesForVector(item, vRow.primary) as kf (keyframeIdentity(kf))}
											<button type="button" class="vector-key" class:selected={keyframeSelectionStore.forItem(item.id).has(keyframeIdentity(kf))} style="left:{timelineX(item.from + kf.frame)}px" aria-label={`${vectorLabel(vRow.property)} ${kf.frame}`} data-testid={`vector-key-${item.id}-${vRow.property}-${kf.frame}`} onclick={(e) => { e.stopPropagation(); selectVectorKeyframe(item.id, vRow.primary, kf.frame); }} onpointerdown={(e) => startKeyframeDrag(item.id, vRow.primary, kf.frame, e)}></button>
										{/each}
										{#each keyframesForVector(item, vRow.secondary) as kf (keyframeIdentity(kf))}
											<button type="button" class="vector-key vector-key-secondary" style="left:{timelineX(item.from + kf.frame)}px" aria-label={`${vectorLabel(vRow.property)} ${kf.frame} y`} data-testid={`vector-key-${item.id}-${vRow.property}-y-${kf.frame}`} onclick={(e) => { e.stopPropagation(); selectVectorKeyframe(item.id, vRow.secondary, kf.frame); }} onpointerdown={(e) => startKeyframeDrag(item.id, vRow.secondary, kf.frame, e)}></button>
										{/each}
									</div>
								{/each}
								{#each textBands as band, bIdx (band.slot)}
									<div class="text-band-lane" style="top:{8 + idx*ROW_H + ROW_H + vRows.length*VECTOR_H + bIdx*TEXT_BAND_H}px; height:{TEXT_BAND_H}px" data-testid={`text-lane-${item.id}-${band.slot}`}>
										<button type="button" class="text-band" class:locked={isTextLocked(item)} style="left:{timelineX(band.fromFrame)}px; width:{Math.max(8, (band.toFrame - band.fromFrame) * pxPerFrame)}px" data-testid={`text-band-${item.id}-${band.slot}`} aria-label={`${band.slot} ${band.presetId} ${band.durationFrames}f`} onpointerdown={(e) => startTextOffsetDrag(item, band, e)}>
											<span class="text-band-slot">{textSlotLabel(band.slot)}</span>
											<span class="text-band-preset">{textPresetLabel(band.presetId)}</span>
										</button>
										<button type="button" class="text-band-handle" class:disabled={isTextLocked(item)} style="left:{band.slot==='out' ? timelineX(band.fromFrame)-4 : timelineX(band.toFrame)-4}px" data-testid={`text-band-handle-${item.id}-${band.slot}`} aria-label={`${textSlotLabel(band.slot)} ${m.video_editor_composition_timeline_text_duration_handle()}`} onpointerdown={(e) => startTextDurationDrag(item, band, e)}></button>
									</div>
								{/each}
							{/if}
						{/each}
						<div class="bars-playhead" style="left:{timelineX(timelineStore.currentFrame)}px" data-testid="composition-bars-playhead"></div>
						{#if previewFrame !== null}
							<div class="bars-playhead ghost" style="left:{timelineX(previewFrame)}px" data-testid="composition-bars-playhead-ghost"></div>
						{/if}
						{#if marquee && marquee.active}
							<div class="marquee" style="left:{Math.min(marquee.x, marquee.x+marquee.w)}px; top:{Math.min(marquee.y, marquee.y+marquee.h)}px; width:{Math.abs(marquee.w)}px; height:{Math.abs(marquee.h)}px" data-testid="composition-marquee"></div>
						{/if}
						{#if dropGhost && dropGhost.valid}
							<div class="drop-ghost" style="left:{timelineX(dropGhost.frame)}px" data-testid="composition-drop-ghost" aria-hidden="true"></div>
						{/if}
						{#if dropGhost && !dropGhost.valid}
							<div class="drop-ghost invalid" style="left:{timelineX(dropGhost.frame)}px" data-testid="composition-drop-ghost-invalid" aria-hidden="true"></div>
						{/if}
						{#if snapGuideFrame !== null}
							<div class="snap-guide" style="left:{timelineX(snapGuideFrame)}px" data-testid="composition-snap-guide" aria-hidden="true"></div>
						{/if}
					</div>
				</div>
			</div>
		</div>
		<div class="composition-footer">
			<span class="footer-status" aria-live="polite" data-testid="composition-status">{status}</span>
			<div class="footer-actions">
				<Button size="sm" variant="ghost" aria-label={m.video_editor_composition_timeline_copy()} disabled={selectedItemIds.size===0} onclick={copySelected} data-testid="composition-copy"><CopyIcon class="size-3" />{m.video_editor_composition_timeline_copy()}</Button>
				<Button size="sm" variant="ghost" aria-label={m.video_editor_composition_timeline_paste()} disabled={!clipboard} onclick={pasteClipboard} data-testid="composition-paste"><ClipboardIcon class="size-3" />{m.video_editor_composition_timeline_paste()}</Button>
				<Button size="sm" variant="ghost" aria-label={m.video_editor_composition_timeline_duplicate()} disabled={selectedItemIds.size===0} onclick={duplicateSelected} data-testid="composition-duplicate">{m.video_editor_composition_timeline_duplicate()}</Button>
				<Button size="sm" variant="ghost" aria-label={m.video_editor_composition_timeline_group()} disabled={selectedItemIds.size<2} onclick={groupSelected} data-testid="composition-group"><GroupIcon class="size-3" />{m.video_editor_composition_timeline_group()}</Button>
				<Button size="sm" variant="ghost" aria-label={m.video_editor_composition_timeline_delete()} disabled={selectedItemIds.size===0} onclick={removeSelected} data-testid="composition-delete"><TrashIcon class="size-3" />{m.video_editor_composition_timeline_delete()}</Button>
				<span class="frame-readout" data-testid="composition-frame-readout">{m.video_editor_composition_timeline_frame({ frame: String(timelineStore.currentFrame), total: String(durationFrames) })}</span>
			</div>
		</div>
		{#if pendingParent}
			<div class="pick-overlay" data-testid="composition-pick-overlay" aria-hidden="true"><p>{m.video_editor_composition_timeline_pick_hint()}</p></div>
		{/if}
		{#if showNewDialog}
			<div class="dialog-backdrop" role="presentation" onclick={() => showNewDialog=false}></div>
			<div class="dialog" role="dialog" aria-modal="true" aria-label={m.video_editor_motion_create_composition()} data-testid="new-composition-dialog">
				<h3>{m.video_editor_motion_create_composition()}</h3>
				<label>{m.video_editor_composition_timeline_name()}<input value={newName} oninput={(e) => newName=(e.currentTarget as HTMLInputElement).value} data-testid="new-composition-name" /></label>
				<label>{m.video_editor_composition_timeline_fps()}<input type="number" min="1" max="120" value={newFps} oninput={(e) => newFps=Number((e.currentTarget as HTMLInputElement).value)} data-testid="new-composition-fps" /></label>
				<label>{m.video_editor_composition_timeline_duration()}<input type="number" min="1" value={newDuration} oninput={(e) => newDuration=Number((e.currentTarget as HTMLInputElement).value)} data-testid="new-composition-duration" /></label>
				<div class="dialog-actions">
					<Button variant="ghost" onclick={() => showNewDialog=false} data-testid="new-composition-cancel">{m.video_editor_composition_timeline_cancel()}</Button>
					<Button onclick={handleCreateComposition} data-testid="new-composition-create">{m.video_editor_composition_timeline_create()}</Button>
				</div>
			</div>
		{/if}
	</section>
{:else}
	<div class="composition-empty" data-testid="composition-empty">
		<p>{m.video_editor_composition_timeline_select_composite()}</p>
		{#if compositions.length > 0}
			<div class="empty-picker">
				<label for="empty-picker-select">{m.video_editor_composition_timeline_picker()}</label>
				<select id="empty-picker-select" onchange={(e) => { const v=(e.currentTarget as HTMLSelectElement).value; if(v) sequenceStore.switchTo(v); }} data-testid="empty-composition-picker">
					<option value="">{m.video_editor_composition_timeline_choose()}</option>
					{#each compositions as comp (comp.id)}<option value={comp.id}>{comp.name}</option>{/each}
				</select>
			</div>
		{/if}
		<Button onclick={() => { showNewDialog=true; newName=''; newFps=30; newDuration=300; }} data-testid="empty-new-composition">{m.video_editor_motion_create_composition()}</Button>
		{#if showNewDialog}
			<div class="dialog-backdrop" role="presentation" onclick={() => showNewDialog=false}></div>
			<div class="dialog" role="dialog" aria-modal="true" aria-label={m.video_editor_motion_create_composition()} data-testid="new-composition-dialog-empty">
				<h3>{m.video_editor_motion_create_composition()}</h3>
				<label>{m.video_editor_composition_timeline_name()}<input value={newName} oninput={(e) => newName=(e.currentTarget as HTMLInputElement).value} data-testid="new-composition-name-empty" /></label>
				<label>{m.video_editor_composition_timeline_fps()}<input type="number" min="1" max="120" value={newFps} oninput={(e) => newFps=Number((e.currentTarget as HTMLInputElement).value)} /></label>
				<label>{m.video_editor_composition_timeline_duration()}<input type="number" min="1" value={newDuration} oninput={(e) => newDuration=Number((e.currentTarget as HTMLInputElement).value)} /></label>
				<div class="dialog-actions">
					<Button variant="ghost" onclick={() => showNewDialog=false}>{m.video_editor_composition_timeline_cancel()}</Button>
					<Button onclick={handleCreateComposition} data-testid="new-composition-create-empty">{m.video_editor_composition_timeline_create()}</Button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.composition-timeline { display: flex; flex-direction: column; min-height: 360px; border: 1px solid oklch(0.26 0.016 55); border-radius: 0.5rem; background: oklch(0.155 0.009 55); color: oklch(0.9 0.01 65); overflow: hidden; }
	.composition-timeline:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: -2px; }
	.composition-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.55rem 0.7rem; border-bottom: 1px solid oklch(0.26 0.016 55); background: oklch(0.17 0.01 55); }
	.header-left, .header-center, .header-right { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.header-label { font-size: 0.62rem; color: oklch(0.72 0.015 65); }
	.composition-picker { min-width: 160px; height: 32px; border-radius: 0.32rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; padding: 0 0.4rem; font-size: 0.72rem; }
	.composition-picker:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.composition-title { margin: 0; font-size: 0.78rem; font-weight: 650; letter-spacing: -0.01em; }
	.composition-meta { margin-left: 0.5rem; font-size: 0.62rem; color: oklch(0.68 0.016 65); display: inline-flex; align-items: center; gap: 0.25rem; }
	.meta-input { width: 56px; height: 24px; border-radius: 0.25rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; text-align: center; font-size: 0.62rem; }
	.meta-input:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.header-zoom { display: flex; align-items: center; gap: 0.5rem; }
	.zoom-label { font-size: 0.62rem; color: oklch(0.72 0.015 65); }
	.zoom-slider-wrap { width: 140px; }
	.composition-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding: 0.45rem 0.7rem; border-bottom: 1px solid oklch(0.26 0.016 55); background: oklch(0.16 0.009 55); }
	.toolbar-label { font-size: 0.62rem; color: oklch(0.72 0.015 65); margin-right: 0.2rem; }
	.toolbar-search { margin-left: auto; }
	.filter-input { width: 180px; height: 32px; border-radius: 0.32rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; padding: 0 0.5rem; font-size: 0.72rem; }
	.filter-input:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.io-lane { position: relative; height: 22px; border-bottom: 1px solid oklch(0.26 0.016 55); background: oklch(0.16 0.009 55); }
	.io-strip { position: relative; height: 100%; }
	.io-range { position: absolute; top: 4px; bottom: 4px; border-radius: 0.22rem; background: oklch(0.62 0.12 45 / 0.22); border: 1px solid oklch(0.66 0.14 45 / 0.35); display: flex; align-items: center; justify-content: center; }
	.io-label { font-size: 0.58rem; color: oklch(0.78 0.08 45); }
	.io-empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 0.62rem; color: oklch(0.62 0.016 65); }
	.io-handle { position: absolute; top: 2px; bottom: 2px; width: 10px; margin-left: -5px; border-radius: 0.22rem; border: 1px solid oklch(0.66 0.14 45); background: oklch(0.72 0.12 45); cursor: col-resize; min-height: 44px; min-width: 12px; }
	.io-handle:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.composition-body { display: grid; grid-template-columns: 320px 1fr; min-height: 260px; overflow: hidden; }
	@media (max-width: 720px) { .composition-body { grid-template-columns: 1fr; } .layer-sidebar { max-height: 280px; } }
	.layer-sidebar { border-right: 1px solid oklch(0.26 0.016 55); background: oklch(0.16 0.009 55); overflow-y: auto; overflow-x: hidden; padding: 0.35rem; }
	.layer-sidebar:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: -2px; }
	.layer-sidebar-header { display: grid; grid-template-columns: 1fr 86px 44px 64px; gap: 0.25rem; font-size: 0.58rem; letter-spacing: 0.06em; text-transform: uppercase; color: oklch(0.62 0.016 65); padding: 0.2rem 0.15rem; }
	.group-row { display: flex; align-items: center; gap: 0.25rem; padding: 0.3rem 0.2rem; border-radius: 0.32rem; border: 1px solid oklch(0.24 0.012 55); background: oklch(0.18 0.01 55); margin-bottom: 0.25rem; }
	.group-header { flex: 1; display: flex; align-items: center; gap: 0.35rem; border: 0; background: transparent; color: inherit; font-size: 0.72rem; text-align: left; cursor: pointer; min-height: 32px; }
	.group-header.selected { color: oklch(0.78 0.08 45); }
	.group-header:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.group-toggle { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 0.2rem; }
	.group-toggle:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.group-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.group-span { font-size: 0.58rem; color: oklch(0.62 0.016 65); font-variant-numeric: tabular-nums; }
	.group-actions { display: flex; align-items: center; gap: 0.15rem; }
	.layer-row-wrap { border-radius: 0.32rem; overflow: hidden; margin-bottom: 0.2rem; border: 1px solid transparent; }
	.layer-row { display: flex; width: 100%; align-items: center; gap: 0.35rem; padding: 0.35rem 0.35rem; border-radius: 0.32rem; border: 1px solid transparent; background: transparent; color: inherit; font-size: 0.72rem; text-align: left; cursor: pointer; min-height: 32px; }
	.layer-row.selected { background: oklch(0.22 0.02 55); border-color: oklch(0.66 0.14 45 / 0.5); }
	.layer-row.pickTarget { border-color: oklch(0.62 0.14 230); background: oklch(0.2 0.02 230); }
	.layer-row.controller { border-style: dashed; opacity: 0.85; }
	.layer-row:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: -2px; }
	.layer-expand { display: grid; place-items: center; width: 20px; height: 20px; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 0.2rem; }
	.layer-expand:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.layer-type-badge { flex: none; width: 18px; height: 18px; display: grid; place-items: center; border-radius: 0.2rem; background: oklch(0.24 0.012 55); font-size: 0.58rem; font-weight: 700; }
	.layer-actions { display: flex; align-items: center; gap: 0.1rem; }
	.icon-btn { width: 28px; height: 28px; min-width: 28px; min-height: 28px; }
	.icon-btn:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.solo-label { font-size: 0.62rem; font-weight: 700; }
	.layer-meta-row { display: grid; grid-template-columns: 1fr 92px 64px 20px; gap: 0.25rem; padding: 0.15rem 0.35rem 0.35rem; align-items: center; }
	.parent-cell { display: flex; align-items: center; gap: 0.2rem; min-width: 0; }
	.parent-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.62rem; color: oklch(0.72 0.02 65); }
	.blend-cell { display: flex; }
	.blend-select { width: 100%; height: 24px; border-radius: 0.25rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; font-size: 0.62rem; padding: 0 0.2rem; }
	.blend-select:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.timing-cell { font-size: 0.58rem; color: oklch(0.62 0.016 65); font-variant-numeric: tabular-nums; text-align: right; }
	.drag-handle { display: grid; place-items: center; width: 20px; height: 20px; cursor: grab; color: oklch(0.62 0.016 65); user-select: none; border-radius: 0.2rem; }
	.drag-handle:active { cursor: grabbing; }
	.drag-handle:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.rename-input { flex: 1; height: 28px; border-radius: 0.25rem; border: 1px solid oklch(0.66 0.14 45); background: oklch(0.2 0.01 55); color: inherit; padding: 0 0.35rem; font-size: 0.72rem; min-width: 0; }
	.rename-input:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.vector-row { display: grid; grid-template-columns: 72px 28px 1fr; align-items: center; gap: 0.25rem; padding: 0.18rem 0.35rem; border-top: 1px dashed oklch(0.24 0.012 55); font-size: 0.6rem; color: oklch(0.68 0.015 65); }
	.vector-keys { position: relative; height: 12px; border-radius: 0.2rem; background: oklch(0.13 0.008 55); overflow: hidden; }
	.vector-lane { position: absolute; left: 0; right: 0; background: oklch(0.13 0.008 55 / 0.5); border-top: 1px dashed oklch(0.24 0.012 55); }
	.vector-key { position: absolute; top: 2px; width: 10px; height: 10px; margin-left: -5px; transform: rotate(45deg); background: oklch(0.76 0.14 45); border: 1px solid oklch(0.12 0.01 55); cursor: grab; min-width: 12px; min-height: 12px; }
	.vector-key:active { cursor: grabbing; }
	.vector-key.selected, .vector-key[aria-pressed='true'] { background: oklch(0.88 0.16 45); box-shadow: 0 0 0 2px oklch(0.66 0.14 45 / 0.4); }
	.vector-key:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.vector-key-secondary { background: oklch(0.62 0.12 230); top: 5px; }
	.text-band-row { display: grid; grid-template-columns: 36px 1fr 60px; gap: 0.25rem; padding: 0.18rem 0.35rem; border-top: 1px dashed oklch(0.24 0.012 55); font-size: 0.58rem; color: oklch(0.68 0.015 65); }
	.text-band-label { font-weight: 600; color: oklch(0.78 0.12 230); }
	.text-band-preset { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: oklch(0.72 0.02 65); }
	.text-band-meta { font-variant-numeric: tabular-nums; color: oklch(0.62 0.016 65); text-align: right; }
	.inline-props { display: flex; align-items: center; gap: 0.35rem; padding: 0.3rem 0.35rem; border-top: 1px dashed oklch(0.24 0.012 55); background: oklch(0.14 0.008 55); font-size: 0.62rem; color: oklch(0.68 0.015 65); }
	.inline-label { font-weight: 600; color: oklch(0.76 0.14 45); }
	.text-band-lane { position: absolute; left: 0; right: 0; background: transparent; }
	.text-band { position: absolute; top: 2px; bottom: 2px; display: flex; align-items: center; gap: 0.25rem; padding: 0 0.35rem; border-radius: 0.22rem; background: oklch(0.45 0.12 230 / 0.28); border: 1px solid oklch(0.55 0.12 230 / 0.6); color: oklch(0.85 0.02 65); font-size: 0.58rem; cursor: grab; overflow: hidden; }
	.text-band:active { cursor: grabbing; }
	.text-band.locked { opacity: 0.5; cursor: not-allowed; }
	.text-band:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.text-band-slot { font-weight: 700; color: oklch(0.78 0.14 230); }
	.text-band-handle { position: absolute; top: 0; bottom: 0; width: 10px; margin-left: -5px; border: 0; background: oklch(0.72 0.12 230 / 0.9); border-radius: 2px; cursor: ew-resize; min-width: 12px; }
	.text-band-handle.disabled { opacity: 0.4; cursor: not-allowed; }
	.text-band-handle:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.empty-layers { padding: 1rem 0.4rem; font-size: 0.72rem; text-align: center; color: oklch(0.62 0.016 65); }
	.empty-actions { display: flex; gap: 0.4rem; justify-content: center; margin-top: 0.6rem; }
	.timeline-content { overflow: auto; background: oklch(0.145 0.008 55); position: relative; }
	.timeline-content:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: -2px; }
	.timeline-inner { position: relative; }
	.composition-ruler { position: sticky; top: 0; z-index: 2; height: 28px; border-bottom: 1px solid oklch(0.26 0.016 55); background: oklch(0.16 0.009 55); overflow: hidden; cursor: pointer; }
	.ruler-tick { position: absolute; top: 0; bottom: 0; width: 48px; margin-left: -24px; border: 0; background: transparent; color: oklch(0.62 0.012 55); cursor: pointer; min-width: 44px; min-height: 28px; }
	.ruler-tick:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: -2px; }
	.tick-line { position: absolute; left: 50%; top: 16px; width: 1px; bottom: 0; background: oklch(0.28 0.012 55); }
	.tick-label { position: absolute; left: 50%; top: 2px; transform: translateX(-50%); font-size: 0.58rem; font-variant-numeric: tabular-nums; }
	.ruler-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: oklch(0.66 0.14 45); pointer-events: none; }
	.ruler-playhead.ghost { background: oklch(0.66 0.14 45 / 0.45); width: 1px; border-left: 1px dashed oklch(0.66 0.14 45); }
	.active-region-dim { position: absolute; top: 0; bottom: 0; background: oklch(0.12 0.008 55 / 0.45); pointer-events: none; }
	.comp-end-dim { position: absolute; top: 0; bottom: 0; border-left: 1px solid oklch(0.38 0.02 55); background: oklch(0.12 0.008 55 / 0.55); pointer-events: none; }
	.layer-bars { position: relative; min-height: 200px; padding-top: 8px; }
	.layer-bar { position: absolute; height: 22px; border-radius: 0.28rem; border: 1px solid oklch(0.32 0.02 58); background: oklch(0.22 0.015 55); color: oklch(0.86 0.01 65); font-size: 0.62rem; text-align: left; padding-left: 0.35rem; cursor: grab; overflow: hidden; }
	.layer-bar:active { cursor: grabbing; }
	.layer-bar.selected { border-color: oklch(0.66 0.14 45); background: oklch(0.28 0.03 50); box-shadow: 0 0 0 2px oklch(0.66 0.14 45 / 0.22); }
	.layer-bar:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bars-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: oklch(0.66 0.14 45 / 0.9); pointer-events: none; }
	.bars-playhead.ghost { background: oklch(0.66 0.14 45 / 0.5); width: 1px; border-left: 1px dashed oklch(0.66 0.14 45); }
	.timing-input { width: 48px; height: 22px; border-radius: 0.2rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; font-size: 0.58rem; text-align: center; padding: 0 0.2rem; }
	.timing-input:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.motion-layer-bands, .modifier-bands { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.25rem 0.35rem; border-top: 1px dashed oklch(0.24 0.012 55); }
	.motion-layer-band, .modifier-band { display: flex; align-items: center; height: 18px; border-radius: 0.2rem; border: 1px solid oklch(0.55 0.12 230 / 0.5); background: oklch(0.45 0.12 230 / 0.18); color: inherit; font-size: 0.58rem; padding: 0 0.3rem; cursor: pointer; }
	.motion-layer-band:focus-visible, .modifier-band:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.path-vertex-lane, .mask-lane { display: flex; align-items: center; padding: 0.2rem 0.35rem; border-top: 1px dashed oklch(0.24 0.012 55); font-size: 0.58rem; color: oklch(0.68 0.015 65); }
	.link-pick-row { display: flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.35rem; border-top: 1px dashed oklch(0.24 0.012 55); }
	.link-pick-btn { display: inline-flex; align-items: center; gap: 0.2rem; height: 22px; padding: 0 0.4rem; border-radius: 0.2rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; font-size: 0.58rem; cursor: pointer; }
	.link-pick-btn[aria-pressed="true"] { border-color: oklch(0.66 0.14 45); background: oklch(0.28 0.03 50); }
	.link-pick-btn:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.link-badge { font-size: 0.58rem; padding: 0.1rem 0.3rem; border-radius: 0.2rem; background: oklch(0.22 0.015 55); border: 1px solid oklch(0.26 0.016 55); }
	.published-controls { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.3rem 0.35rem; border-top: 1px dashed oklch(0.24 0.012 55); }
	.control-row { display: flex; align-items: center; gap: 0.4rem; font-size: 0.58rem; }
	.control-row input { flex: 1; height: 22px; border-radius: 0.2rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; padding: 0 0.3rem; }
	.control-row input:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.drop-ghost { position: absolute; top: 8px; bottom: 8px; width: 2px; background: oklch(0.55 0.15 150); pointer-events: none; }
	.drop-ghost.invalid { background: oklch(0.6 0.18 25); }
	.marquee { position: absolute; border: 1px solid oklch(0.66 0.14 45); background: oklch(0.66 0.14 45 / 0.15); pointer-events: none; border-radius: 0.15rem; }
	.composition-footer { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; padding: 0.45rem 0.6rem; border-top: 1px solid oklch(0.26 0.016 55); background: oklch(0.17 0.01 55); flex-wrap: wrap; }
	.footer-status { font-size: 0.62rem; color: oklch(0.68 0.015 65); min-height: 18px; }
	.footer-actions { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
	.frame-readout { font-size: 0.62rem; font-variant-numeric: tabular-nums; color: oklch(0.72 0.015 65); }
	.pick-overlay { position: absolute; inset: 0; display: grid; place-items: center; background: oklch(0.12 0.008 55 / 0.6); color: oklch(0.9 0.01 65); font-size: 0.72rem; pointer-events: none; }
	.dialog-backdrop { position: fixed; inset: 0; background: oklch(0 0 0 / 0.5); z-index: 40; }
	.dialog { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); background: oklch(0.18 0.01 55); border: 1px solid oklch(0.26 0.016 55); border-radius: 0.5rem; padding: 1rem; z-index: 50; min-width: 320px; display: flex; flex-direction: column; gap: 0.6rem; color: oklch(0.9 0.01 65); }
	.dialog h3 { margin: 0; font-size: 0.86rem; font-weight: 650; }
	.dialog label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem; }
	.dialog input { height: 32px; border-radius: 0.32rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; padding: 0 0.5rem; }
	.dialog input:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.dialog-actions { display: flex; justify-content: flex-end; gap: 0.4rem; margin-top: 0.4rem; }
	.composition-empty { display: grid; place-items: center; gap: 0.8rem; padding: 2rem 1rem; text-align: center; color: oklch(0.68 0.015 65); min-height: 240px; border: 1px dashed oklch(0.26 0.016 55); border-radius: 0.5rem; background: oklch(0.16 0.009 55); }
	.empty-picker { display: flex; align-items: center; gap: 0.5rem; font-size: 0.72rem; }
	.empty-picker select { height: 32px; border-radius: 0.32rem; border: 1px solid oklch(0.26 0.016 55); background: oklch(0.2 0.01 55); color: inherit; padding: 0 0.4rem; }
	.empty-picker select:focus-visible { outline: 2px solid oklch(0.66 0.14 45); outline-offset: 2px; }
	.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	@media (pointer: coarse) {
		.layer-row, .group-header, .ruler-tick, .layer-bar, .icon-btn { min-height: 44px; }
		.io-handle { min-width: 24px; min-height: 44px; }
	}
</style>
