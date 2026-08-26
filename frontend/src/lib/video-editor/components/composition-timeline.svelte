<!--
	Focused 2D composition timeline - port of FreeCut compositing-timeline.tsx
	plus motion-io-lane, motion-vector-rows, motion-region-overlay and pick-whip overlays.
	Reuses owners: sequence-store, timeline-store, vector-keyframes, transform-parenting,
	keyframe selection/actions, timeline-viewport, zoom; no parallel model.
-->
<script lang="ts">
	import { onDestroy } from 'svelte';
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
	import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';
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
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import type { KeyframeProperty } from '$lib/video-editor/project/types';
	import { Slider } from '$lib/components/ui/slider';
	import { Button } from '$lib/components/ui/button';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import UnlinkIcon from '@lucide/svelte/icons/unlink-2';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

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
			timelineStore.items.reduce(
				(max, item) => Math.max(max, item.from + item.durationInFrames),
				0
			),
			60
		)
	);
	const compEnd = $derived(durationFrames);
	const pxPerFrame = $derived(timelinePixelsPerFrame(timelineStore.zoomLevel));
	const timelineWidth = $derived(Math.max(800, durationFrames * pxPerFrame));
	let scrollLeft = $state(0);
	let scrollEl: HTMLDivElement | null = $state(null);
	let sidebarEl: HTMLDivElement | null = $state(null);
	let selectedItemId = $state<string | null>(null);
	$effect(() => {
		if (externalId !== null) selectedItemId = externalId;
	});
	let pickTarget: string | null = $state(null);
	let pendingParent: string | null = $state(null);
	let status = $state('');
	let zoomSlider = $state(1);
	$effect(() => {
		zoomSlider = timelineStore.zoomLevel;
	});
	const visibleRange = $derived({
		start: Math.max(0, (scrollLeft - 600) / Math.max(0.001, pxPerFrame)),
		end: Math.max(0, (scrollLeft + 800) / Math.max(0.001, pxPerFrame))
	});
	const sortedItems = $derived(
		[...timelineStore.items].sort(
			(a, b) => a.from - b.from || a.durationInFrames - b.durationInFrames
		)
	);
	const visualItems = $derived(
		sortedItems.filter((item) => item.type !== 'audio' && item.type !== 'adjustment')
	);
	const ROW_H = 34;
	const VECTOR_H = 20;
	const TEXT_BAND_H = 22;
	type RowModel = {
		item: TimelineItem;
		y: number;
		height: number;
		vRows: readonly {
			property: 'position' | 'scale' | 'anchor';
			primary: KeyframeProperty;
			secondary: KeyframeProperty;
			unit: string;
		}[];
		textBands: ReturnType<typeof getTextMotionTimelineBands>;
	};
	const rows = $derived.by<RowModel[]>(() => {
		let y = 0;
		const out: RowModel[] = [];
		for (const item of visualItems) {
			const vRows = vectorRowsFor(item);
			const textBands = item.type === 'text' ? getTextMotionTimelineBands(item) : [];
			const h = ROW_H + vRows.length * VECTOR_H + textBands.length * TEXT_BAND_H;
			out.push({ item, y, height: h, vRows, textBands });
			y += h;
		}
		return out;
	});
	const totalRowsHeight = $derived(rows.reduce((sum, r) => sum + r.height, 0));
	const itemIndex = $derived(buildTimelineItemRangeIndex(visualItems));
	const visibleBars = $derived(
		queryTimelineItemRange(itemIndex, { start: visibleRange.start, end: visibleRange.end })
	);
	const visibleIds = $derived(new Set(visibleBars.map((i) => i.id)));

	function itemLabel(item: TimelineItem): string {
		return item.label || item.type;
	}
	function selectItem(id: string): void {
		selectedItemId = id;
		onselectitem?.(id);
	}
	function clearSelection(): void {
		selectedItemId = null;
		onselectitem?.(null);
	}
	function seekTo(frame: number): void {
		const clamped = Math.max(0, Math.min(frame, durationFrames - 1));
		timelineStore._setCurrentFrame(clamped);
	}
	function handleTimelineClick(event: MouseEvent): void {
		const target = event.target as HTMLElement;
		if (target.closest('[data-layer-row]') || target.closest('[data-vector-row]')) return;
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
	function handleScroll(event: Event): void {
		const el = event.currentTarget as HTMLDivElement;
		scrollLeft = el.scrollLeft;
		if (sidebarEl && sidebarEl !== el) sidebarEl.scrollTop = el.scrollTop;
	}
	function handleSidebarScroll(event: Event): void {
		const el = event.currentTarget as HTMLDivElement;
		if (scrollEl) scrollEl.scrollTop = el.scrollTop;
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
	});
	function trackWindowCleanup(fn: () => void): void {
		windowCleanup.push(fn);
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
			pendingParent = null;
			pickTarget = null;
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
	function detachParent(childId: string): void {
		if (detachTransformParent(childId)) {
			status = m.video_editor_composition_timeline_parent_detached();
			onedit();
		}
	}
	function removeSelected(): void {
		if (!selectedItemId) return;
		const item = timelineStore.itemById.get(selectedItemId);
		if (!item) return;
		const removed = removeItems([selectedItemId], false);
		if (removed.length > 0) {
			selectedItemId = null;
			onedit();
		}
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
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		trackWindowCleanup(() => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
		});
		event.preventDefault();
		selectItem(item.id);
	}
	function onBarPointerMove(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const deltaPx = event.clientX - drag.startX;
		if (!drag.active && Math.abs(deltaPx) < 3) return;
		drag.active = true;
		const deltaFrames = Math.round(deltaPx / Math.max(0.001, pxPerFrame));
		const item = timelineStore.itemById.get(drag.id);
		if (!item) return;
		// snap
		const snapThreshold = calculateAdaptiveSnapThreshold(timelineStore.zoomLevel, pxPerFrame);
		const snapTargets = buildSnapTargets({
			items: timelineStore.items,
			tracks: timelineStore.tracks,
			excludeIds: new Set([drag.id]),
			currentFrame: timelineStore.currentFrame,
			markers: timelineStore.markers
		});
		if (drag.kind === 'move') {
			const proposed = drag.originalFrom + deltaFrames;
			const snap = calculateMoveSnap(proposed, drag.originalDuration, snapTargets, snapThreshold);
			const from = snap.snappedFrame;
			const patchFrom = Math.max(0, from);
			// draft without history
			timelineStore._updateItems([{ id: drag.id, patch: { from: patchFrom } }]);
		} else {
			const handle = drag.kind === 'trim-start' ? 'start' : 'end';
			const snap = calculateEdgeSnap(
				(handle === 'start' ? drag.originalFrom : drag.originalFrom + drag.originalDuration) +
					deltaFrames,
				snapTargets,
				snapThreshold
			);
			const plan = planTrimGesture(
				{
					...item,
					from: drag.originalFrom,
					durationInFrames: drag.originalDuration
				} as TimelineItem,
				handle,
				snap.snappedFrame -
					(handle === 'start' ? drag.originalFrom : drag.originalFrom + drag.originalDuration),
				timelineStore.items,
				timelineStore.fps,
				snapTargets,
				snapThreshold,
				[]
			);
			timelineStore._updateItems([{ id: drag.id, patch: plan.patch }]);
		}
	}
	function onBarPointerUp(event: PointerEvent, cancelled: boolean): void {
		if (!drag) return;
		const before = drag.before;
		const wasActive = drag.active;
		// cleanup listeners
		window.removeEventListener('pointermove', onBarPointerMove);
		window.removeEventListener('pointerup', onBarPointerUp);
		window.removeEventListener('pointercancel', onBarPointerUp);
		if (cancelled || !wasActive) {
			restoreSnapshot(before);
			drag = null;
			return;
		}
		// commit single undo if changed
		const after = captureSnapshot();
		const changed = JSON.stringify(before) !== JSON.stringify(after);
		if (changed) {
			// _updateItems already mutated state, now push one undo entry for the before snapshot
			// Use commandHistory directly: the execute wrapper for _updateItems does not push, so we push here
			commandHistory.addUndoEntry(
				{ type: drag.kind === 'move' ? 'MOVE_ITEMS' : 'TRIM_ITEM' },
				before
			);
			onedit();
		}
		drag = null;
	}
	function handleKeydown(event: KeyboardEvent): void {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
			return;
		if (event.key === 'Escape') {
			let handled = false;
			if (drag) {
				restoreSnapshot(drag.before);
				drag = null;
				handled = true;
			}
			if (kfDrag) {
				restoreSnapshot(kfDrag.before);
				kfDrag = null;
				handled = true;
			}
			if (textDrag?.before) {
				restoreSnapshot(textDrag.before);
				textDrag = null;
				handled = true;
			} else if (textDrag) {
				// active before threshold, still need to cleanup without snapshot
				textDrag = null;
				handled = true;
			}
			if (handled) {
				event.preventDefault();
				return;
			}
			clearSelection();
			pendingParent = null;
			pickTarget = null;
			return;
		}
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			removeSelected();
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			if (!selectedItemId) return;
			event.preventDefault();
			const delta = event.key === 'ArrowLeft' ? -1 : 1;
			const amount = event.shiftKey ? 10 : 1;
			const item = timelineStore.itemById.get(selectedItemId);
			if (!item) return;
			const before = captureSnapshot();
			timelineStore._updateItems([
				{ id: selectedItemId, patch: { from: Math.max(0, item.from + delta * amount) } }
			]);
			commandHistory.addUndoEntry({ type: 'MOVE_ITEMS' }, before);
			onedit();
		}
	}
	function timelineX(frame: number): number {
		return frame * pxPerFrame;
	}
	const MOTION_VECTOR_ROW_DEFINITIONS = [
		{ property: 'position' as const, primary: 'x' as const, secondary: 'y' as const, unit: 'px' },
		{
			property: 'scale' as const,
			primary: 'width' as const,
			secondary: 'height' as const,
			unit: '%'
		},
		{
			property: 'anchor' as const,
			primary: 'anchorX' as const,
			secondary: 'anchorY' as const,
			unit: 'px'
		}
	] as const;
	function vectorLabel(
		property: (typeof MOTION_VECTOR_ROW_DEFINITIONS)[number]['property']
	): string {
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
		try {
			target.setPointerCapture(event.pointerId);
		} catch {}
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
			try {
				target.releasePointerCapture(textDrag!.pointerId);
			} catch {}
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
			if (
				!textDrag ||
				textDrag.itemId !== item.id ||
				textDrag.slot !== band.slot ||
				e.pointerId !== textDrag.pointerId
			)
				return;
			const delta = Math.round((e.clientX - textDrag.startX) / Math.max(0.001, pxPerFrame));
			if (!textDrag.active && Math.abs(e.clientX - textDrag.startX) < 3) return;
			if (!textDrag.active) {
				textDrag.before = beginTextMotionEdit();
				textDrag.active = true;
			}
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
			const currentVal =
				item.type === 'text'
					? kind === 'duration'
						? item.textMotion?.[band.slot]?.durationFrames
						: item.textMotion?.[band.slot]?.offsetFrames
					: undefined;
			textDrag = null;
			if (!wasActive || currentVal === startVal) {
				restoreSnapshot(beforeSnap);
				return;
			}
			commitTextMotionEdit(beforeSnap, band.slot, [item.id]);
			onedit();
		};
		const onCancel = () => {
			doCleanup();
			if (textDrag?.before) restoreSnapshot(textDrag.before);
			textDrag = null;
		};
		const onLost = () => {
			doCleanup();
			if (textDrag?.before) restoreSnapshot(textDrag.before);
			textDrag = null;
		};
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
	function startTextDurationDrag(
		item: TimelineItem,
		band: ReturnType<typeof getTextMotionTimelineBands>[number],
		event: PointerEvent
	): void {
		startTextBandDrag(item, band, 'duration', event);
	}
	function startTextOffsetDrag(
		item: TimelineItem,
		band: ReturnType<typeof getTextMotionTimelineBands>[number],
		event: PointerEvent
	): void {
		startTextBandDrag(item, band, 'offset', event);
	}
	function startKeyframeDrag(
		itemId: string,
		property: KeyframeProperty,
		frame: number,
		event: PointerEvent
	): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		selectVectorKeyframe(itemId, property, frame);
		const before = captureSnapshot();
		kfDrag = {
			itemId,
			property,
			id: `${itemId}:${property}:${frame}`,
			startFrame: frame,
			startX: event.clientX,
			before
		};
		const onMove = (e: PointerEvent) => {
			if (!kfDrag) return;
			const delta = Math.round((e.clientX - kfDrag.startX) / Math.max(0.001, pxPerFrame));
			const newFrame = Math.max(0, kfDrag.startFrame + delta);
			// draft via raw update
			const item = timelineStore.itemById.get(kfDrag.itemId);
			if (!item) return;
			const kfs = editorKeyframes(item, kfDrag.property);
			const kf = kfs.find((k) => k.frame === kfDrag.startFrame);
			if (!kf) return;
			timelineStore._updateItems([
				{
					id: kfDrag.itemId,
					patch: {
						// use atomic keyframe action via _updateItems? simplified draft
						keyframes: {
							...item.keyframes,
							[kfDrag.property]: {
								frames: kfs.map((k) => (k.frame === kfDrag.startFrame ? newFrame : k.frame)),
								values: kfs.map((k) => k.value),
								ids: kfs.map((k) => k.id),
								easings: kfs.map((k) => k.easing)
							}
						}
					} as Partial<TimelineItem>
				}
			]);
		};
		const onUp = (e: PointerEvent, cancelled = false) => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			if (!kfDrag) return;
			if (cancelled) {
				restoreSnapshot(kfDrag.before);
				kfDrag = null;
				return;
			}
			const delta = Math.round((e.clientX - kfDrag.startX) / Math.max(0.001, pxPerFrame));
			if (delta !== 0) {
				const newFrame = Math.max(0, kfDrag.startFrame + delta);
				const item = timelineStore.itemById.get(kfDrag.itemId);
				if (item) {
					const kfs = editorKeyframes(item, kfDrag.property);
					const kf = kfs.find((k) => k.frame === kfDrag.startFrame);
					if (kf) {
						// final commit via atomic action
						updateKeyframes(kfDrag.itemId, [{ ref: kf, frame: newFrame, value: kf.value }]);
						commandHistory.addUndoEntry({ type: 'UPDATE_KEYFRAMES' }, kfDrag.before);
						onedit();
					}
				}
			}
			kfDrag = null;
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
	}
	const rulerTicks = $derived.by(() => {
		const start = Math.floor(visibleRange.start);
		const end = Math.ceil(visibleRange.end);
		const step = Math.max(1, Math.round((30 / fps) * 15));
		const ticks: number[] = [];
		for (let frame = start - (start % step); frame <= end; frame += step) {
			if (frame >= 0) ticks.push(frame);
		}
		return ticks.slice(0, 64);
	});
	const regions = $derived(motionRegions());
	const inP = $derived(timelineStore.inPoint);
	const outP = $derived(timelineStore.outPoint);
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isComposite && composition}
	<section
		class="composition-timeline"
		aria-label={m.video_editor_composition_timeline_label()}
		data-testid="composition-timeline"
		role="region"
		tabindex="0"
		onkeydown={handleKeydown}
	>
		<div class="composition-header">
			<div class="header-main">
				<h2 class="composition-title">
					{composition.name ?? m.video_editor_motion_composition_title()}
				</h2>
				<span class="composition-meta" aria-label={m.video_editor_composition_timeline_meta()}>
					{composition.width}×{composition.height} · {fps} fps · {durationFrames}
					{m.video_editor_composition_timeline_frames()}
				</span>
			</div>
			<div class="header-zoom">
				<label class="zoom-label" for="composition-zoom-slider"
					>{m.video_editor_composition_timeline_zoom()}</label
				>
				<div class="zoom-slider-wrap">
					<Slider
						id="composition-zoom-slider"
						value={[zoomSlider]}
						min={0.25}
						max={4}
						step={0.05}
						onValueChange={handleZoomChange}
						aria-label={m.video_editor_composition_timeline_zoom()}
					/>
				</div>
			</div>
		</div>
		<div
			class="io-lane"
			data-testid="composition-io-lane"
			aria-label={m.video_editor_composition_timeline_range()}
		>
			<div class="io-strip">
				{#if inP !== null && outP !== null && outP > inP}
					<div
						class="io-range"
						style="left:{Math.max(
							0,
							(inP - visibleRange.start) / Math.max(1, visibleRange.end - visibleRange.start)
						) * 100}%; width:{Math.max(
							1,
							(outP - inP) / Math.max(1, visibleRange.end - visibleRange.start)
						) * 100}%"
						data-testid="composition-io-range"
						data-from-frame={inP}
						data-to-frame={outP}
					>
						<span class="io-label">{m.video_editor_composition_timeline_work_area()}</span>
					</div>
					<button
						type="button"
						class="io-handle io-handle-in"
						style="left:{Math.max(
							0,
							Math.min(
								100,
								(inP - visibleRange.start) / Math.max(1, visibleRange.end - visibleRange.start)
							) * 100
						)}%"
						aria-label={m.video_editor_composition_timeline_in_point()}
						data-testid="composition-io-in"
						onpointerdown={(event) => {
							const startX = event.clientX;
							const startIn = inP;
							const before = captureSnapshot();
							let changed = false;
							const onMove = (move: PointerEvent) => {
								const deltaFrames = Math.round((move.clientX - startX) / pxPerFrame);
								const next = Math.max(
									0,
									Math.min(startIn + deltaFrames, (outP ?? durationFrames) - 1)
								);
								if (next !== timelineStore.inPoint) {
									changed = true;
									timelineStore._setInPoint(next);
								}
							};
							const cleanup = () => {
								window.removeEventListener('pointermove', onMove);
								window.removeEventListener('pointerup', onUp);
								window.removeEventListener('pointercancel', onCancel);
							};
							const onUp = () => {
								cleanup();
								if (changed && JSON.stringify(before) !== JSON.stringify(captureSnapshot())) {
									commandHistory.addUndoEntry({ type: 'SET_IN_POINT' }, before);
									onedit();
								}
							};
							const onCancel = () => {
								cleanup();
								restoreSnapshot(before);
							};
							window.addEventListener('pointermove', onMove);
							window.addEventListener('pointerup', onUp);
							window.addEventListener('pointercancel', onCancel);
						}}
					></button>
					<button
						type="button"
						class="io-handle io-handle-out"
						style="left:{Math.max(
							0,
							Math.min(
								100,
								(outP - visibleRange.start) / Math.max(1, visibleRange.end - visibleRange.start)
							) * 100
						)}%"
						aria-label={m.video_editor_composition_timeline_out_point()}
						data-testid="composition-io-out"
						onpointerdown={(event) => {
							const startX = event.clientX;
							const startOut = outP;
							const before = captureSnapshot();
							let changed = false;
							const onMove = (move: PointerEvent) => {
								const deltaFrames = Math.round((move.clientX - startX) / pxPerFrame);
								const next = Math.max(
									(inP ?? 0) + 1,
									Math.min(startOut + deltaFrames, durationFrames)
								);
								if (next !== timelineStore.outPoint) {
									changed = true;
									timelineStore._setOutPoint(next);
								}
							};
							const cleanup = () => {
								window.removeEventListener('pointermove', onMove);
								window.removeEventListener('pointerup', onUp);
								window.removeEventListener('pointercancel', onCancel);
							};
							const onUp = () => {
								cleanup();
								if (changed && JSON.stringify(before) !== JSON.stringify(captureSnapshot())) {
									commandHistory.addUndoEntry({ type: 'SET_OUT_POINT' }, before);
									onedit();
								}
							};
							const onCancel = () => {
								cleanup();
								restoreSnapshot(before);
							};
							window.addEventListener('pointermove', onMove);
							window.addEventListener('pointerup', onUp);
							window.addEventListener('pointercancel', onCancel);
						}}
					></button>
				{/if}
				{#if !regions.hasActive}
					<span class="io-empty">{m.video_editor_composition_timeline_full_range()}</span>
				{/if}
			</div>
		</div>
		<div class="composition-body" data-testid="composition-body">
			<div
				class="layer-sidebar"
				aria-label={m.video_editor_composition_timeline_layers()}
				bind:this={sidebarEl}
				onscroll={handleSidebarScroll}
				role="region"
				tabindex="0"
			>
				<div class="layer-sidebar-header">
					<span>{m.video_editor_composition_timeline_layer()}</span>
					<span class="parent-header">{m.video_editor_motion_parent_label()}</span>
				</div>
				{#each rows as row (row.item.id)}
					{@const isSelected = selectedItemId === row.item.id}
					{@const parentId = row.item.transformParent?.parentItemId}
					<div class="layer-row-wrap" style="height:{row.height}px" data-row-id={row.item.id}>
						<button
							type="button"
							class="layer-row"
							class:selected={isSelected}
							class:pickTarget={pickTarget === row.item.id}
							data-layer-row={row.item.id}
							data-testid={`composition-layer-${row.item.id}`}
							aria-pressed={isSelected}
							aria-label={itemLabel(row.item)}
							onclick={() => selectItem(row.item.id)}
							onkeydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									selectItem(row.item.id);
								}
							}}
						>
							<span class="layer-name">{itemLabel(row.item)}</span>
							<span class="layer-timing"
								>{row.item.from}–{row.item.from + row.item.durationInFrames}</span
							>
						</button>
						<div class="parent-cell">
							{#if parentId}
								{@const parent = timelineStore.itemById.get(parentId)}
								<span class="parent-name">{parent ? parent.label : parentId.slice(0, 6)}</span>
								<Button
									size="icon"
									variant="ghost"
									aria-label={m.video_editor_motion_parent_none()}
									onclick={() => detachParent(row.item.id)}
								>
									<UnlinkIcon class="size-3" />
								</Button>
							{:else}
								<Button
									size="icon"
									variant="ghost"
									aria-label={m.video_editor_composition_timeline_link_parent({
										name: itemLabel(row.item)
									})}
									data-testid={`parent-pick-${row.item.id}`}
									onpointerdown={(event) => beginParentPick(row.item.id, event)}
								>
									<Link2Icon class="size-3" />
								</Button>
							{/if}
						</div>
						{#each row.vRows as vRow (vRow.property)}
							<div
								class="vector-row"
								data-vector-row={`${row.item.id}:${vRow.property}`}
								data-testid={`vector-row-${row.item.id}-${vRow.property}`}
							>
								<span class="vector-label">{vectorLabel(vRow.property)}</span>
								<span class="vector-unit">{vRow.unit}</span>
								<div class="vector-keys" aria-hidden="true"></div>
							</div>
						{/each}
						{#each row.textBands as band (band.slot)}
							<div class="text-band-row" data-testid={`text-band-row-${row.item.id}-${band.slot}`}>
								<span class="text-band-label">{textSlotLabel(band.slot)}</span>
								<span class="text-band-preset">{textPresetLabel(band.presetId)}</span>
								<span class="text-band-meta"
									>{m.video_editor_composition_timeline_text_duration({
										frames: String(band.durationFrames)
									})} · {m.video_editor_composition_timeline_text_units({
										count: String(band.unitCount)
									})}{band.offsetFrames
										? ` · ${m.video_editor_composition_timeline_text_off({ frames: String(band.offsetFrames) })}`
										: ''}</span
								>
							</div>
						{/each}
					</div>
				{/each}
				{#if rows.length === 0}
					<p class="empty-layers">{m.video_editor_composition_timeline_empty()}</p>
				{/if}
			</div>
			<div
				class="timeline-content"
				bind:this={scrollEl}
				onscroll={handleScroll}
				onclick={handleTimelineClick}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						handleTimelineClick(event as unknown as MouseEvent);
					}
				}}
				role="region"
				tabindex="0"
				aria-label={m.video_editor_composition_timeline_layers()}
				data-testid="composition-scroll"
			>
				<div
					class="timeline-inner"
					style="width:{timelineWidth}px; height:{totalRowsHeight + 28}px"
				>
					<div
						class="composition-ruler"
						role="group"
						aria-label={m.video_editor_composition_timeline_ruler()}
					>
						{#each rulerTicks as tick (tick)}
							<button
								type="button"
								class="ruler-tick"
								style="left:{timelineX(tick)}px"
								aria-label={`${tick}`}
								onclick={() => seekTo(tick)}
								data-testid={`ruler-tick-${tick}`}
							>
								<span class="tick-line"></span>
								<span class="tick-label">{tick}</span>
							</button>
						{/each}
						<div
							class="ruler-playhead"
							style="left:{timelineX(timelineStore.currentFrame)}px"
							data-testid="composition-playhead"
							aria-hidden="true"
						></div>
						{#if regions.hasActive}
							<div
								class="active-region-dim left"
								style="width:{timelineX(regions.inP ?? 0)}px"
								data-testid="composition-active-dim-left"
							></div>
							<div
								class="active-region-dim right"
								style="left:{timelineX(regions.outP ?? durationFrames)}px; width:{Math.max(
									0,
									timelineWidth - timelineX(regions.outP ?? durationFrames)
								)}px"
								data-testid="composition-active-dim-right"
							></div>
						{/if}
						<div
							class="comp-end-dim"
							style="left:{timelineX(compEnd)}px; width:{Math.max(
								0,
								timelineWidth - timelineX(compEnd)
							)}px"
							data-testid="composition-end-dim"
						></div>
					</div>
					<div
						class="layer-bars"
						data-testid="composition-layer-bars"
						style="height:{totalRowsHeight}px"
					>
						{#each rows as row (row.item.id)}
							{@const isSelected = selectedItemId === row.item.id}
							{#if visibleIds.has(row.item.id) || isSelected}
								<button
									type="button"
									class="layer-bar"
									class:selected={isSelected}
									style="left:{timelineX(row.item.from)}px; top:{row.y}px; width:{Math.max(
										8,
										row.item.durationInFrames * pxPerFrame
									)}px; height:{ROW_H - 12}px"
									data-testid={`composition-bar-${row.item.id}`}
									aria-label={itemLabel(row.item)}
									aria-pressed={isSelected}
									onpointerdown={(event) => startBarPointerDown(row.item, event)}
									onclick={(event) => {
										event.stopPropagation();
										selectItem(row.item.id);
									}}
									ondblclick={() => {
										const mid = row.item.from + Math.floor(row.item.durationInFrames / 2);
										seekTo(mid);
									}}
								>
									<span class="bar-label">{itemLabel(row.item)}</span>
								</button>
								{#each row.vRows as vRow, vIdx (vRow.property)}
									<div
										class="vector-lane"
										style="top:{row.y + ROW_H + vIdx * VECTOR_H}px; height:{VECTOR_H}px"
										data-testid={`vector-lane-${row.item.id}-${vRow.property}`}
									>
										{#each keyframesForVector(row.item, vRow.primary) as kf (keyframeIdentity(kf))}
											<button
												type="button"
												class="vector-key"
												class:selected={keyframeSelectionStore
													.forItem(row.item.id)
													.has(keyframeIdentity(kf))}
												style="left:{timelineX(kf.frame)}px"
												aria-label={`${vectorLabel(vRow.property)} ${kf.frame}`}
												aria-pressed={keyframeSelectionStore
													.forItem(row.item.id)
													.has(keyframeIdentity(kf))}
												data-testid={`vector-key-${row.item.id}-${vRow.property}-${kf.frame}`}
												onclick={(e) => {
													e.stopPropagation();
													selectVectorKeyframe(row.item.id, vRow.primary, kf.frame);
												}}
												onpointerdown={(e) =>
													startKeyframeDrag(row.item.id, vRow.primary, kf.frame, e)}
											></button>
										{/each}
										{#each keyframesForVector(row.item, vRow.secondary) as kf (keyframeIdentity(kf))}
											<button
												type="button"
												class="vector-key vector-key-secondary"
												style="left:{timelineX(kf.frame)}px"
												aria-label={`${vectorLabel(vRow.property)} ${kf.frame} y`}
												data-testid={`vector-key-${row.item.id}-${vRow.property}-y-${kf.frame}`}
												onclick={(e) => {
													e.stopPropagation();
													selectVectorKeyframe(row.item.id, vRow.secondary, kf.frame);
												}}
												onpointerdown={(e) =>
													startKeyframeDrag(row.item.id, vRow.secondary, kf.frame, e)}
											></button>
										{/each}
									</div>
								{/each}
								{#each row.textBands as band, bIdx (band.slot)}
									<div
										class="text-band-lane"
										style="top:{row.y +
											ROW_H +
											row.vRows.length * VECTOR_H +
											bIdx * TEXT_BAND_H}px; height:{TEXT_BAND_H}px"
										data-testid={`text-lane-${row.item.id}-${band.slot}`}
									>
										<button
											type="button"
											class="text-band"
											class:locked={isTextLocked(row.item)}
											style="left:{timelineX(band.fromFrame)}px; width:{Math.max(
												8,
												(band.toFrame - band.fromFrame) * pxPerFrame
											)}px"
											data-testid={`text-band-${row.item.id}-${band.slot}`}
											aria-label={`${band.slot} ${band.presetId} ${band.durationFrames}f`}
											onpointerdown={(e) => startTextOffsetDrag(row.item, band, e)}
										>
											<span class="text-band-slot">{textSlotLabel(band.slot)}</span>
											<span class="text-band-preset">{textPresetLabel(band.presetId)}</span>
										</button>
										<button
											type="button"
											class="text-band-handle"
											class:disabled={isTextLocked(row.item)}
											style="left:{band.slot === 'out'
												? timelineX(band.fromFrame) - 4
												: timelineX(band.toFrame) - 4}px"
											data-testid={`text-band-handle-${row.item.id}-${band.slot}`}
											aria-label={`${textSlotLabel(band.slot)} ${m.video_editor_composition_timeline_text_duration_handle()}`}
											onpointerdown={(e) => startTextDurationDrag(row.item, band, e)}
										></button>
									</div>
								{/each}
							{/if}
						{/each}
						<div
							class="bars-playhead"
							style="left:{timelineX(timelineStore.currentFrame)}px"
							data-testid="composition-bars-playhead"
						></div>
					</div>
				</div>
			</div>
		</div>
		<div class="composition-footer">
			<span class="footer-status" aria-live="polite" data-testid="composition-status">{status}</span
			>
			<div class="footer-actions">
				<Button
					variant="ghost"
					size="sm"
					disabled={!selectedItemId}
					aria-label={m.video_editor_composition_timeline_delete()}
					onclick={removeSelected}
					data-testid="composition-delete"
				>
					<TrashIcon class="size-3" />
					{m.video_editor_composition_timeline_delete()}
				</Button>
				<span class="frame-readout" data-testid="composition-frame-readout">
					{m.video_editor_composition_timeline_frame({
						frame: String(timelineStore.currentFrame),
						total: String(durationFrames)
					})}
				</span>
			</div>
		</div>
		{#if pendingParent}
			<div class="pick-overlay" data-testid="composition-pick-overlay" aria-hidden="true">
				<p>{m.video_editor_composition_timeline_pick_hint()}</p>
			</div>
		{/if}
	</section>
{:else}
	<p class="composition-empty" data-testid="composition-empty">
		{m.video_editor_composition_timeline_select_composite()}
	</p>
{/if}

<style>
	.composition-timeline {
		display: flex;
		flex-direction: column;
		min-height: 340px;
		border: 1px solid oklch(0.26 0.016 55);
		border-radius: 0.5rem;
		background: oklch(0.155 0.009 55);
		color: oklch(0.9 0.01 65);
		overflow: hidden;
	}
	.composition-timeline:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: -2px;
	}
	.composition-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.55rem 0.7rem;
		border-bottom: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.17 0.01 55);
	}
	.composition-title {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.composition-meta {
		margin-left: 0.5rem;
		font-size: 0.62rem;
		color: oklch(0.68 0.016 65);
	}
	.header-zoom {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.zoom-label {
		font-size: 0.62rem;
		color: oklch(0.72 0.015 65);
	}
	.zoom-slider-wrap {
		width: 140px;
	}
	.io-lane {
		position: relative;
		height: 22px;
		border-bottom: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.16 0.009 55);
	}
	.io-strip {
		position: relative;
		height: 100%;
	}
	.io-range {
		position: absolute;
		top: 4px;
		bottom: 4px;
		border-radius: 0.22rem;
		background: oklch(0.62 0.12 45 / 0.22);
		border: 1px solid oklch(0.66 0.14 45 / 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.io-label {
		font-size: 0.58rem;
		color: oklch(0.78 0.08 45);
	}
	.io-empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: 0.62rem;
		color: oklch(0.62 0.016 65);
	}
	.io-handle {
		position: absolute;
		top: 2px;
		bottom: 2px;
		width: 10px;
		margin-left: -5px;
		border-radius: 0.22rem;
		border: 1px solid oklch(0.66 0.14 45);
		background: oklch(0.72 0.12 45);
		cursor: col-resize;
	}
	.composition-body {
		display: grid;
		grid-template-columns: 220px 1fr;
		min-height: 220px;
		overflow: hidden;
	}
	.layer-sidebar {
		border-right: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.16 0.009 55);
		overflow-y: auto;
		padding: 0.35rem;
	}
	.layer-sidebar-header {
		display: flex;
		justify-content: space-between;
		font-size: 0.58rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: oklch(0.62 0.016 65);
		padding: 0.2rem 0.15rem;
	}
	.layer-row-wrap {
		border-radius: 0.32rem;
		overflow: hidden;
	}
	.layer-row {
		display: flex;
		width: 100%;
		justify-content: space-between;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.4rem;
		border-radius: 0.32rem;
		border: 1px solid transparent;
		background: transparent;
		color: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
	}
	.layer-row.selected {
		background: oklch(0.22 0.02 55);
		border-color: oklch(0.48 0.08 45);
	}
	.layer-row.pickTarget {
		border-color: oklch(0.62 0.14 230);
		background: oklch(0.2 0.02 230);
	}
	.layer-row:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: -2px;
	}
	.layer-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.layer-timing {
		flex: none;
		font-size: 0.58rem;
		color: oklch(0.62 0.016 65);
		font-variant-numeric: tabular-nums;
	}
	.parent-cell {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.4rem 0.35rem;
	}
	.parent-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.62rem;
		color: oklch(0.72 0.02 65);
	}
	.vector-row {
		display: grid;
		grid-template-columns: 72px 28px 1fr;
		align-items: center;
		gap: 0.25rem;
		padding: 0.18rem 0.4rem;
		border-top: 1px dashed oklch(0.24 0.012 55);
		font-size: 0.6rem;
		color: oklch(0.68 0.015 65);
	}
	.vector-keys {
		position: relative;
		height: 12px;
		border-radius: 0.2rem;
		background: oklch(0.13 0.008 55);
		overflow: hidden;
	}
	.vector-lane {
		position: absolute;
		left: 0;
		right: 0;
		background: oklch(0.13 0.008 55 / 0.5);
		border-top: 1px dashed oklch(0.24 0.012 55);
	}
	.vector-key {
		position: absolute;
		top: 2px;
		width: 10px;
		height: 10px;
		margin-left: -5px;
		transform: rotate(45deg);
		background: oklch(0.76 0.14 45);
		border: 1px solid oklch(0.12 0.01 55);
		cursor: grab;
	}
	.vector-key:active {
		cursor: grabbing;
	}
	.vector-key.selected,
	.vector-key[aria-pressed='true'] {
		background: oklch(0.88 0.16 45);
		box-shadow: 0 0 0 2px oklch(0.66 0.14 45 / 0.4);
	}
	.vector-key-secondary {
		background: oklch(0.62 0.12 230);
		top: 5px;
	}
	.text-band-row {
		display: grid;
		grid-template-columns: 36px 1fr 60px;
		gap: 0.25rem;
		padding: 0.18rem 0.4rem;
		border-top: 1px dashed oklch(0.24 0.012 55);
		font-size: 0.58rem;
		color: oklch(0.68 0.015 65);
	}
	.text-band-label {
		font-weight: 600;
		color: oklch(0.78 0.12 230);
	}
	.text-band-preset {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: oklch(0.72 0.02 65);
	}
	.text-band-meta {
		font-variant-numeric: tabular-nums;
		color: oklch(0.62 0.016 65);
		text-align: right;
	}
	.text-band-lane {
		position: absolute;
		left: 0;
		right: 0;
		background: transparent;
	}
	.text-band {
		position: absolute;
		top: 2px;
		bottom: 2px;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.35rem;
		border-radius: 0.22rem;
		background: oklch(0.45 0.12 230 / 0.28);
		border: 1px solid oklch(0.55 0.12 230 / 0.6);
		color: oklch(0.85 0.02 65);
		font-size: 0.58rem;
		cursor: grab;
		overflow: hidden;
	}
	.text-band:active {
		cursor: grabbing;
	}
	.text-band.locked {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.text-band-slot {
		font-weight: 700;
		color: oklch(0.78 0.14 230);
	}
	.text-band-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 10px;
		margin-left: -5px;
		border: 0;
		background: oklch(0.72 0.12 230 / 0.9);
		border-radius: 2px;
		cursor: ew-resize;
	}
	.text-band-handle.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.empty-layers {
		padding: 1rem 0.4rem;
		font-size: 0.62rem;
		text-align: center;
		color: oklch(0.62 0.016 65);
	}
	.timeline-content {
		overflow: auto;
		background: oklch(0.145 0.008 55);
	}
	.timeline-inner {
		position: relative;
	}
	.composition-ruler {
		position: sticky;
		top: 0;
		z-index: 2;
		height: 28px;
		border-bottom: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.16 0.009 55);
		overflow: hidden;
	}
	.ruler-tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 48px;
		margin-left: -24px;
		border: 0;
		background: transparent;
		color: oklch(0.62 0.012 55);
		cursor: pointer;
	}
	.ruler-tick:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: -2px;
	}
	.tick-line {
		position: absolute;
		left: 50%;
		top: 16px;
		width: 1px;
		bottom: 0;
		background: oklch(0.28 0.012 55);
	}
	.tick-label {
		position: absolute;
		left: 50%;
		top: 2px;
		transform: translateX(-50%);
		font-size: 0.58rem;
		font-variant-numeric: tabular-nums;
	}
	.ruler-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: oklch(0.66 0.14 45);
		pointer-events: none;
	}
	.active-region-dim {
		position: absolute;
		top: 0;
		bottom: 0;
		background: oklch(0.12 0.008 55 / 0.45);
		pointer-events: none;
	}
	.comp-end-dim {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 1px solid oklch(0.38 0.02 55);
		background: oklch(0.12 0.008 55 / 0.55);
		pointer-events: none;
	}
	.layer-bars {
		position: relative;
		min-height: 200px;
		padding-top: 8px;
	}
	.layer-bar {
		position: absolute;
		height: 22px;
		border-radius: 0.28rem;
		border: 1px solid oklch(0.32 0.02 58);
		background: oklch(0.22 0.015 55);
		color: oklch(0.86 0.01 65);
		font-size: 0.62rem;
		text-align: left;
		padding-left: 0.35rem;
		cursor: grab;
		overflow: hidden;
	}
	.layer-bar:active {
		cursor: grabbing;
	}
	.layer-bar.selected {
		border-color: oklch(0.66 0.14 45);
		background: oklch(0.28 0.03 50);
		box-shadow: 0 0 0 2px oklch(0.66 0.14 45 / 0.22);
	}
	.layer-bar:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.bar-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bars-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: oklch(0.66 0.14 45 / 0.9);
		pointer-events: none;
	}
	.composition-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-top: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.17 0.01 55);
	}
	.footer-status {
		font-size: 0.62rem;
		color: oklch(0.68 0.015 65);
	}
	.footer-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.frame-readout {
		font-size: 0.62rem;
		font-variant-numeric: tabular-nums;
		color: oklch(0.72 0.015 65);
	}
	.pick-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: oklch(0.12 0.008 55 / 0.55);
		font-size: 0.78rem;
		color: oklch(0.86 0.02 65);
		pointer-events: none;
	}
	.composition-empty {
		padding: 1rem;
		font-size: 0.72rem;
		color: oklch(0.62 0.016 65);
		text-align: center;
	}
	@media (max-width: 640px) {
		.composition-body {
			grid-template-columns: 1fr;
		}
		.layer-sidebar {
			max-height: 42dvh;
			border-right: 0;
			border-bottom: 1px solid oklch(0.26 0.016 55);
		}
		.vector-row {
			grid-template-columns: 56px 24px 1fr;
		}
		.header-zoom {
			width: 100%;
		}
		.zoom-slider-wrap {
			flex: 1;
		}
	}
	@media (max-width: 360px) {
		.layer-bars {
			min-height: 160px;
		}
		.composition-header {
			padding: 0.45rem;
		}
	}
</style>
