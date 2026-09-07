<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import { Input } from '$lib/components/ui/input';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
	import {
		duplicateKeyframes,
		insertKeyframes,
		removeKeyframes,
		setKeyframe,
		setKeyframeEasing,
		setKeyframeEasings,
		updateKeyframes
	} from '$lib/video-editor/timeline/actions/keyframes';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
	import {
		buildDopesheetRetimePreview,
		buildDopesheetSegmentSpans,
		buildKeyframePastePlan,
		groupDopesheetProperties,
		shiftRangeSelection,
		type BlockedFrameRange,
		type DopesheetPropertyGroup,
		type DopesheetSegmentSpan
	} from '$lib/video-editor/timeline/keyframe-dopesheet';
	import { buildScaleRetimePreview } from '$lib/video-editor/timeline/keyframe-scale-retime';
	import {
		editorKeyframes,
		editorPropertyLabel,
		keyframeIdentity,
		marqueeSelection,
		type EditorKeyframe,
		type MarqueeMode
	} from '$lib/video-editor/timeline/keyframe-editor';
	import { activeValueAt } from '$lib/video-editor/timeline/actions/keyframes';
	import { calculateTransitionPortions } from '$lib/video-editor/timeline/transition-planner';
	import { keyframeSelectionStore } from '$lib/video-editor/timeline/stores/keyframe-selection-store.svelte';
	import { m } from '$lib/paraglide/messages';
	import { effectPropertyLabel } from '$lib/video-editor/effects/effect-keyframes';
	import {
		editorDeleteModeForEvent,
		eventMatchesShortcut
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import KeyframeContextMenuContent from './keyframe-context-menu-content.svelte';
	import KeyframeTimingStrip from './keyframe-timing-strip.svelte';
	import KeyframeSegmentEasingPopover from './keyframe-segment-easing-popover.svelte';
	import type { SegmentEasingUpdate } from './keyframe-easing-editor.svelte';

	let {
		item,
		availableProperties,
		currentFrame,
		pixelsPerFrame,
		timelineWidth,
		timelineX,
		presentation = 'timeline',
		propertyColumnWidth = 180,
		initialFilter = 'keyframed',
		onscrub,
		onselect = () => {},
		onactiveproperty = () => {},
		onedit
	}: {
		item: TimelineItem;
		availableProperties: KeyframeProperty[];
		currentFrame: number;
		pixelsPerFrame: number;
		timelineWidth: number;
		timelineX: (absoluteFrame: number) => number;
		presentation?: 'timeline' | 'side';
		propertyColumnWidth?: number;
		initialFilter?: 'keyframed' | 'all';
		onscrub: (absoluteFrame: number) => void;
		onselect?: (keyframe: EditorKeyframe | null) => void;
		onactiveproperty?: (property: KeyframeProperty) => void;
		onedit: () => void;
	} = $props();

	const ROW_HEIGHT = 24;
	const DRAG_THRESHOLD = 3;
	const SNAP_THRESHOLD = 8;
	let root = $state<HTMLDivElement | null>(null);
	let showKeyframedOnly = $state(true);
	let initializedFilter = false;
	let searchQuery = $state('');
	let hiddenGroups = $state<Set<DopesheetPropertyGroup>>(new Set());
	let segmentMenu = $state<{ property: KeyframeProperty; fromFrame: number } | null>(null);
	let lockedProperties = $state<Set<KeyframeProperty>>(new Set());
	let anchors = $state<Partial<Record<KeyframeProperty, string>>>({});
	let previewFrames = $state<Map<string, number> | null>(null);
	let status = $state('');
	let marquee = $state<{ left: number; top: number; width: number; height: number } | null>(null);

	$effect(() => {
		if (initializedFilter) return;
		showKeyframedOnly = initialFilter === 'keyframed';
		initializedFilter = true;
	});

	type KeyframeDrag = {
		kind: 'keyframe';
		pointerId: number;
		anchorId: string;
		startX: number;
		duplicate: boolean;
		started: boolean;
	};
	type MarqueeDrag = {
		kind: 'marquee';
		pointerId: number;
		startX: number;
		startY: number;
		mode: MarqueeMode;
		base: Set<string>;
		started: boolean;
	};
	let drag = $state<KeyframeDrag | MarqueeDrag | null>(null);

	const selectedIds = $derived(keyframeSelectionStore.forItem(item.id));
	const allKeyframes = $derived(
		availableProperties.flatMap((property) => editorKeyframes(item, property))
	);
	const keyframedProperties = $derived(
		availableProperties.filter((property) =>
			allKeyframes.some((keyframe) => keyframe.property === property)
		)
	);
	const visibleProperties = $derived.by(() => {
		const base = showKeyframedOnly ? keyframedProperties : availableProperties;
		const query = searchQuery.trim().toLowerCase();
		return base.filter(
			(property) => !query || propertyLabel(property).toLowerCase().includes(query)
		);
	});
	const groupedRows = $derived(groupDopesheetProperties(visibleProperties, hiddenGroups));
	const segmentSpans = $derived(buildDopesheetSegmentSpans(allKeyframes));
	const spansByProperty = $derived.by(() => {
		const grouped = new Map<KeyframeProperty, DopesheetSegmentSpan[]>();
		for (const span of segmentSpans) {
			const lane = grouped.get(span.property) ?? [];
			lane.push(span);
			grouped.set(span.property, lane);
		}
		return grouped;
	});
	const scaleSelection = $derived.by(() => {
		const frames = selectedKeyframes.map((keyframe) => keyframe.frame);
		if (frames.length < 2) return null;
		const minFrame = Math.min(...frames);
		const maxFrame = Math.max(...frames);
		return minFrame === maxFrame ? null : { minFrame, maxFrame };
	});
	const selectedKeyframes = $derived(
		allKeyframes.filter((keyframe) => selectedIds.has(keyframeIdentity(keyframe)))
	);
	const selectedFrame = $derived.by(() => {
		const frames = new Set(selectedKeyframes.map((keyframe) => keyframe.frame));
		return frames.size === 1 ? selectedKeyframes[0]?.frame : undefined;
	});
	const relativeCurrentFrame = $derived(
		Math.max(0, Math.min(item.durationInFrames - 1, currentFrame - item.from))
	);
	const blockedRanges = $derived.by((): BlockedFrameRange[] =>
		transitionsStore.list.flatMap((transition) => {
			const { leftPortion, rightPortion } = calculateTransitionPortions(
				transition.durationInFrames,
				transition.alignment
			);
			if (transition.fromItemId === item.id && leftPortion > 0) {
				return [{ start: item.durationInFrames - leftPortion, end: item.durationInFrames }];
			}
			if (transition.toItemId === item.id && rightPortion > 0) {
				return [{ start: 0, end: rightPortion }];
			}
			return [];
		})
	);

	$effect(() => {
		keyframeSelectionStore.prune(
			item.id,
			new Set(allKeyframes.map((keyframe) => keyframeIdentity(keyframe)))
		);
	});

	onDestroy(() => {
		drag = null;
		previewFrames = null;
		marquee = null;
	});

	function propertyLabel(property: KeyframeProperty): string {
		return effectPropertyLabel(item, property) ?? editorPropertyLabel(item, property);
	}

	function groupLabel(group: DopesheetPropertyGroup): string {
		switch (group) {
			case 'transform':
				return m.video_editor_keyframe_sheet_group_transform();
			case 'crop':
				return m.video_editor_keyframe_sheet_group_crop();
			case 'typography':
				return m.video_editor_keyframe_sheet_group_typography();
			case 'path':
				return m.video_editor_keyframe_sheet_group_path();
			case 'audio':
				return m.video_editor_keyframe_sheet_group_audio();
			case 'other':
				return m.video_editor_keyframe_sheet_group_other();
		}
	}

	function toggleGroupVisibility(group: DopesheetPropertyGroup): void {
		const next = new Set(hiddenGroups);
		if (next.has(group)) next.delete(group);
		else next.add(group);
		hiddenGroups = next;
	}

	function groupLocked(properties: readonly KeyframeProperty[]): boolean {
		return properties.length > 0 && properties.every((property) => lockedProperties.has(property));
	}

	function toggleGroupLock(properties: readonly KeyframeProperty[]): void {
		const next = new Set(lockedProperties);
		if (groupLocked(properties)) {
			for (const property of properties) next.delete(property);
		} else {
			for (const property of properties) next.add(property);
		}
		lockedProperties = next;
	}

	function setSelection(ids: Iterable<string>, primary?: EditorKeyframe | null): void {
		keyframeSelectionStore.replace(item.id, ids);
		onselect(primary ?? null);
	}

	function selectAllVisible(): void {
		setSelection(
			allKeyframes
				.filter((keyframe) => visibleProperties.includes(keyframe.property))
				.map((keyframe) => keyframeIdentity(keyframe))
		);
	}

	function prepareContextMenu(event: MouseEvent): void {
		if (!(event.target instanceof Element)) return;
		const target = event.target.closest<HTMLElement>('[data-dopesheet-keyframe-id]');
		const id = target?.dataset.dopesheetKeyframeId;
		if (!id || selectedIds.has(id)) return;
		const keyframe = allKeyframes.find((candidate) => keyframeIdentity(candidate) === id);
		if (!keyframe) return;
		setSelection([id], keyframe);
		onactiveproperty(keyframe.property);
	}

	function openContextMenuFromKeyboard(event: KeyboardEvent): boolean {
		if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return false;
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return true;
		const rect = target.getBoundingClientRect();
		target.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + Math.min(rect.height / 2, 160)
			})
		);
		return true;
	}

	function capturePointer(target: EventTarget | null, pointerId: number): void {
		if (!(target instanceof Element)) return;
		try {
			target.setPointerCapture(pointerId);
		} catch {
			// Synthetic and interrupted pointer sequences may not own capture.
		}
	}

	function selectKeyframe(keyframe: EditorKeyframe, event: PointerEvent): Set<string> {
		const id = keyframeIdentity(keyframe);
		let next: Set<string>;
		if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
			next = shiftRangeSelection(
				allKeyframes,
				selectedIds,
				keyframe.property,
				anchors[keyframe.property],
				id
			);
		} else if (event.ctrlKey || event.metaKey) {
			next = new Set(selectedIds);
			if (next.has(id)) next.delete(id);
			else next.add(id);
		} else {
			next = selectedIds.has(id) ? new Set(selectedIds) : new Set([id]);
		}
		anchors = { ...anchors, [keyframe.property]: id };
		setSelection(next, keyframe);
		onactiveproperty(keyframe.property);
		return next;
	}

	function startKeyframeDrag(keyframe: EditorKeyframe, event: PointerEvent): void {
		if (event.button !== 0 || lockedProperties.has(keyframe.property)) return;
		event.preventDefault();
		event.stopPropagation();
		const selection = selectKeyframe(keyframe, event);
		if (
			event.shiftKey ||
			event.ctrlKey ||
			event.metaKey ||
			!selection.has(keyframeIdentity(keyframe))
		) {
			return;
		}
		capturePointer(event.currentTarget, event.pointerId);
		drag = {
			kind: 'keyframe',
			pointerId: event.pointerId,
			anchorId: keyframeIdentity(keyframe),
			startX: event.clientX,
			duplicate: event.altKey,
			started: false
		};
	}

	function startMarquee(event: PointerEvent): void {
		if (event.button !== 0 || !root) return;
		event.preventDefault();
		const mode: MarqueeMode = event.shiftKey
			? 'add'
			: event.ctrlKey || event.metaKey
				? 'toggle'
				: 'replace';
		capturePointer(event.currentTarget, event.pointerId);
		drag = {
			kind: 'marquee',
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			mode,
			base: new Set(selectedIds),
			started: false
		};
	}

	function onPointerMove(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (drag.kind === 'keyframe') moveKeyframes(event, drag);
		else moveMarquee(event, drag);
	}

	function moveKeyframes(event: PointerEvent, state: KeyframeDrag): void {
		const deltaX = event.clientX - state.startX;
		if (!state.started && Math.abs(deltaX) <= DRAG_THRESHOLD) return;
		state.started = true;
		const anchor = allKeyframes.find((keyframe) => keyframeIdentity(keyframe) === state.anchorId);
		if (!anchor) return;
		let deltaFrames = Math.round(deltaX / Math.max(0.001, pixelsPerFrame));
		if (!event.ctrlKey && !event.metaKey) {
			const candidate = anchor.frame + deltaFrames;
			const targets = [
				relativeCurrentFrame,
				...allKeyframes
					.filter((keyframe) => !selectedIds.has(keyframeIdentity(keyframe)))
					.map((keyframe) => keyframe.frame)
			];
			const snapped = nearestSnap(candidate, targets, SNAP_THRESHOLD / pixelsPerFrame);
			deltaFrames += snapped - candidate;
		}
		const preview = buildDopesheetRetimePreview({
			keyframes: allKeyframes,
			selectionIds: selectedIds,
			lockedProperties,
			requestedDeltaFrames: deltaFrames,
			totalFrames: item.durationInFrames,
			blockedRanges
		});
		previewFrames = new Map(preview.frames);
		status = m.video_editor_keyframe_sheet_status_drag({
			count: selectedIds.size,
			delta: `${preview.appliedDeltaFrames >= 0 ? '+' : ''}${preview.appliedDeltaFrames}`
		});
	}

	function moveMarquee(event: PointerEvent, state: MarqueeDrag): void {
		if (!root) return;
		if (
			!state.started &&
			Math.hypot(event.clientX - state.startX, event.clientY - state.startY) <= DRAG_THRESHOLD
		) {
			return;
		}
		state.started = true;
		const left = Math.min(state.startX, event.clientX);
		const right = Math.max(state.startX, event.clientX);
		const top = Math.min(state.startY, event.clientY);
		const bottom = Math.max(state.startY, event.clientY);
		const rootRect = root.getBoundingClientRect();
		marquee = {
			left: left - rootRect.left,
			top: top - rootRect.top,
			width: Math.max(1, right - left),
			height: Math.max(1, bottom - top)
		};
		const hits = [...root.querySelectorAll<HTMLElement>('[data-dopesheet-keyframe-id]')]
			.filter((element) => !element.hasAttribute('disabled'))
			.filter((element) => {
				const rect = element.getBoundingClientRect();
				return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
			})
			.map((element) => element.dataset.dopesheetKeyframeId ?? '')
			.filter(Boolean);
		setSelection(marqueeSelection(state.mode, state.base, hits));
		status = m.video_editor_keyframe_sheet_status_marquee({ count: hits.length });
	}

	function onPointerUp(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (drag.kind === 'keyframe') finishKeyframeDrag(drag);
		else if (!drag.started && drag.mode === 'replace') setSelection([]);
		drag = null;
		previewFrames = null;
		marquee = null;
	}

	function finishKeyframeDrag(state: KeyframeDrag): void {
		if (!state.started || !previewFrames || previewFrames.size === 0) {
			const anchor = allKeyframes.find((keyframe) => keyframeIdentity(keyframe) === state.anchorId);
			if (anchor) onscrub(item.from + anchor.frame);
			return;
		}
		const edits = allKeyframes.flatMap((keyframe) => {
			const frame = previewFrames?.get(keyframeIdentity(keyframe));
			return frame === undefined ? [] : [{ ref: keyframe, frame, value: keyframe.value }];
		});
		const changed = state.duplicate
			? duplicateKeyframes(item.id, edits)
			: updateKeyframes(item.id, edits);
		if (!changed) return;
		const anchor = allKeyframes.find((keyframe) => keyframeIdentity(keyframe) === state.anchorId);
		const anchorFrame = anchor ? previewFrames.get(state.anchorId) : undefined;
		if (anchor && anchorFrame !== undefined) {
			onselect({ ...anchor, frame: anchorFrame });
			onscrub(item.from + anchorFrame);
		}
		onedit();
	}

	function previewScale(preview: { anchorFrame: number; requestedScale: number }): void {
		const result = buildScaleRetimePreview({
			keyframes: allKeyframes,
			selectionIds: selectedIds,
			lockedProperties,
			anchorFrame: preview.anchorFrame,
			requestedScale: preview.requestedScale,
			totalFrames: item.durationInFrames,
			blockedRanges
		});
		previewFrames = new Map(result.frames);
		status = m.video_editor_keyframe_sheet_status_scaled({
			count: selectedIds.size,
			scale: result.appliedScale.toFixed(2)
		});
	}

	function commitScale(end: {
		anchorFrame: number;
		requestedScale: number;
		duplicate: boolean;
	}): void {
		const result = buildScaleRetimePreview({
			keyframes: allKeyframes,
			selectionIds: selectedIds,
			lockedProperties,
			anchorFrame: end.anchorFrame,
			requestedScale: end.requestedScale,
			totalFrames: item.durationInFrames,
			blockedRanges
		});
		previewFrames = null;
		if (result.frames.size === 0) return;
		const edits = allKeyframes.flatMap((keyframe) => {
			const frame = result.frames.get(keyframeIdentity(keyframe));
			return frame === undefined ? [] : [{ ref: keyframe, frame, value: keyframe.value }];
		});
		const changed = end.duplicate
			? duplicateKeyframes(item.id, edits)
			: updateKeyframes(item.id, edits);
		if (!changed) return;
		status = m.video_editor_keyframe_sheet_status_scaled({
			count: selectedIds.size,
			scale: result.appliedScale.toFixed(2)
		});
		onedit();
	}

	function cancelScale(): void {
		previewFrames = null;
	}

	function toggleSegmentMenu(property: KeyframeProperty, fromFrame: number): void {
		if (segmentMenu?.property === property && segmentMenu.fromFrame === fromFrame) {
			segmentMenu = null;
		} else {
			segmentMenu = { property, fromFrame };
		}
	}

	function closeSegmentMenu(): void {
		segmentMenu = null;
	}

	function applySegmentEasing(updates: SegmentEasingUpdate[]): void {
		const changed =
			updates.length > 1
				? setKeyframeEasings(item.id, updates)
				: updates[0]
					? setKeyframeEasing(
							item.id,
							updates[0].property,
							updates[0].frame,
							updates[0].easing,
							updates[0].easingConfig
						)
					: false;
		if (changed) onedit();
	}

	function onSegmentKeyDown(
		property: KeyframeProperty,
		fromFrame: number,
		event: KeyboardEvent
	): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		toggleSegmentMenu(property, fromFrame);
	}

	function nearestSnap(value: number, targets: readonly number[], threshold: number): number {
		let result = value;
		let distance = threshold;
		for (const target of targets) {
			const nextDistance = Math.abs(target - value);
			if (nextDistance <= distance) {
				distance = nextDistance;
				result = target;
			}
		}
		return result;
	}

	function toggleLock(property: KeyframeProperty): void {
		const next = new Set(lockedProperties);
		if (next.has(property)) next.delete(property);
		else next.add(property);
		lockedProperties = next;
	}

	function addAtCurrentFrame(property: KeyframeProperty): void {
		const value =
			activeValueAt(item, property, currentFrame) ??
			(property === 'opacity' || property === 'volume' ? 1 : 0);
		if (!setKeyframe(item.id, property, relativeCurrentFrame, value)) return;
		onactiveproperty(property);
		onedit();
	}

	function removeSelection(): void {
		const refs = selectedKeyframes.map((keyframe) => ({ ...keyframe }));
		if (!removeKeyframes(item.id, refs)) return;
		setSelection([]);
		status = m.video_editor_keyframe_sheet_status_removed({ count: refs.length });
		onedit();
	}

	function copySelection(cut = false): void {
		if (!keyframeSelectionStore.copy(item, selectedIds, cut)) return;
		if (cut) {
			const count = selectedIds.size;
			removeSelection();
			status = m.video_editor_keyframe_sheet_status_cut({ count });
		} else {
			status = m.video_editor_keyframe_sheet_status_copied({ count: selectedIds.size });
		}
	}

	function pasteClipboard(): void {
		const clipboard = keyframeSelectionStore.clipboard;
		if (!clipboard) return;
		const plan = buildKeyframePastePlan({
			clipboard,
			item,
			anchorFrame: relativeCurrentFrame,
			availableProperties,
			blockedRanges
		});
		const skipped = plan.skippedUnsupported + plan.skippedBlocked;
		if (keyframeSelectionStore.isCut && skipped > 0) {
			status = m.video_editor_keyframe_sheet_status_cut_blocked({
				unsupported: plan.skippedUnsupported,
				blocked: plan.skippedBlocked
			});
			return;
		}
		const refs = insertKeyframes(item.id, plan.inserts);
		if (refs.length === 0) {
			status = m.video_editor_keyframe_sheet_status_none_pasted();
			return;
		}
		setSelection(refs.map((ref) => ref.id ?? keyframeIdentity(ref)));
		if (keyframeSelectionStore.isCut) keyframeSelectionStore.clearClipboard();
		status =
			skipped > 0
				? m.video_editor_keyframe_sheet_status_pasted({
						count: refs.length,
						unsupported: plan.skippedUnsupported,
						blocked: plan.skippedBlocked
					})
				: m.video_editor_keyframe_sheet_status_pasted_clean({ count: refs.length });
		onedit();
	}

	function moveSelectionBy(deltaFrames: number): void {
		const preview = buildDopesheetRetimePreview({
			keyframes: allKeyframes,
			selectionIds: selectedIds,
			lockedProperties,
			requestedDeltaFrames: deltaFrames,
			totalFrames: item.durationInFrames,
			blockedRanges
		});
		if (preview.frames.size === 0 || preview.appliedDeltaFrames === 0) return;
		const edits = selectedKeyframes.flatMap((keyframe) => {
			const frame = preview.frames.get(keyframeIdentity(keyframe));
			return frame === undefined ? [] : [{ ref: keyframe, frame, value: keyframe.value }];
		});
		if (!updateKeyframes(item.id, edits)) return;
		status = m.video_editor_keyframe_sheet_status_moved({
			count: selectedIds.size,
			delta: preview.appliedDeltaFrames
		});
		onedit();
	}

	function commitSelectedFrame(event: Event): void {
		if (selectedFrame === undefined) return;
		// SAFETY: this handler is attached only to the numeric frame input below.
		const target = Math.round((event.currentTarget as HTMLInputElement).valueAsNumber);
		if (!Number.isFinite(target)) return;
		moveSelectionBy(target - selectedFrame);
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (openContextMenuFromKeyboard(event)) return;
		if (isEditableTarget(event.target)) return;
		const bindings = keyboardShortcuts.bindings;
		if (eventMatchesShortcut(event, bindings.GRAPH_SELECT_ALL)) {
			event.preventDefault();
			selectAllVisible();
			return;
		}
		if (eventMatchesShortcut(event, bindings.COPY)) {
			event.preventDefault();
			copySelection();
			return;
		}
		if (eventMatchesShortcut(event, bindings.CUT)) {
			event.preventDefault();
			copySelection(true);
			return;
		}
		if (eventMatchesShortcut(event, bindings.PASTE)) {
			event.preventDefault();
			pasteClipboard();
			return;
		}
		if (editorDeleteModeForEvent(event, bindings)) {
			event.preventDefault();
			removeSelection();
		} else if (
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_LEFT) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_RIGHT) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_LEFT_FAST) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_RIGHT_FAST)
		) {
			event.preventDefault();
			const fast =
				eventMatchesShortcut(event, bindings.GRAPH_NUDGE_LEFT_FAST) ||
				eventMatchesShortcut(event, bindings.GRAPH_NUDGE_RIGHT_FAST);
			const left =
				eventMatchesShortcut(event, bindings.GRAPH_NUDGE_LEFT) ||
				eventMatchesShortcut(event, bindings.GRAPH_NUDGE_LEFT_FAST);
			moveSelectionBy((left ? -1 : 1) * (fast ? 10 : 1));
		} else if (eventMatchesShortcut(event, bindings.GRAPH_CLEAR_SELECTION)) {
			setSelection([]);
		}
	}

	function isEditableTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function onPointKeyDown(keyframe: EditorKeyframe, event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		setSelection([keyframeIdentity(keyframe)], keyframe);
		onscrub(item.from + keyframe.frame);
	}
</script>

<svelte:window
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
/>

<ContextMenu.Root>
	<ContextMenu.Trigger>
		{#snippet child({ props })}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				{...props}
				bind:this={root}
				role="region"
				aria-label={m.video_editor_keyframe_sheet_aria()}
				tabindex="0"
				class="relative flex h-full min-h-0 flex-col bg-[oklch(0.145_0.008_55)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(0.66_0.14_45)] {presentation ===
				'side'
					? ''
					: 'border-t border-[oklch(0.25_0.015_55)]'}"
				style="width:{timelineWidth}px"
				onkeydown={onKeyDown}
				oncontextmenucapture={prepareContextMenu}
			>
				<div
					class="z-30 flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55_/_0.97)] px-1.5 text-[10px] {presentation ===
					'side'
						? 'w-full'
						: 'sticky left-0 w-fit min-w-[720px] border-r'}"
				>
					<span class="mr-1 font-medium tracking-wide text-[oklch(0.72_0.02_55)] uppercase">
						{m.video_editor_keyframe_sheet_title()}
					</span>
					<button
						type="button"
						class="rounded border border-[oklch(0.28_0.012_55)] px-1.5 py-0.5 data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.18)] data-[active=true]:text-[oklch(0.82_0.12_55)]"
						data-active={showKeyframedOnly}
						aria-pressed={showKeyframedOnly}
						onclick={() => (showKeyframedOnly = !showKeyframedOnly)}
						>{m.video_editor_keyframe_sheet_keyframed_only()}</button
					>
					<Input
						type="search"
						class="h-6 w-32 rounded border border-[oklch(0.3_0.012_55)] bg-[oklch(0.2_0.008_55)] px-1.5 text-xs shadow-none"
						bind:value={searchQuery}
						placeholder={m.video_editor_keyframe_sheet_search()}
						aria-label={m.video_editor_keyframe_sheet_search()}
					/>

					<button
						type="button"
						class="rounded p-1 hover:bg-[oklch(0.25_0.012_55)] disabled:opacity-35"
						aria-label={m.video_editor_keyframe_sheet_copy()}
						disabled={selectedIds.size === 0}
						onclick={() => copySelection()}><ThemeIcon role="copy" class="size-3" /></button
					>
					<button
						type="button"
						class="rounded p-1 hover:bg-[oklch(0.25_0.012_55)] disabled:opacity-35"
						aria-label={m.video_editor_keyframe_sheet_cut()}
						disabled={selectedIds.size === 0}
						onclick={() => copySelection(true)}
						><ProtectedIcon icon="editor-cut" class="size-3" /></button
					>
					<button
						type="button"
						class="rounded p-1 hover:bg-[oklch(0.25_0.012_55)] disabled:opacity-35"
						aria-label={keyframeSelectionStore.isCut
							? m.video_editor_keyframe_sheet_move_clipboard()
							: m.video_editor_keyframe_sheet_paste()}
						disabled={!keyframeSelectionStore.clipboard}
						onclick={pasteClipboard}><ThemeIcon role="copy" class="size-3" /></button
					>
					{#if keyframeSelectionStore.isCut && keyframeSelectionStore.clipboard}
						<span class="font-medium text-[oklch(0.78_0.14_65)] uppercase">
							{m.video_editor_keyframe_sheet_cut_badge()}
						</span>
					{/if}
					<label class="ml-1 flex items-center gap-1">
						{m.video_editor_keyframe_sheet_frame()}
						<Input
							type="number"
							min={0}
							max={item.durationInFrames - 1}
							class="h-5 w-14 rounded border border-[oklch(0.3_0.012_55)] bg-[oklch(0.2_0.008_55)] px-1 font-mono text-xs shadow-none disabled:opacity-45"
							value={selectedFrame ?? ''}
							placeholder={selectedIds.size > 1 ? m.video_editor_keyframe_sheet_mixed() : '-'}
							disabled={selectedFrame === undefined}
							onchange={commitSelectedFrame}
						/>
					</label>
					<span class="font-mono text-[9px] text-[oklch(0.58_0.014_55)]">
						{m.video_editor_keyframe_sheet_selected({ count: selectedIds.size })}
					</span>
				</div>
				{#if scaleSelection}
					<KeyframeTimingStrip
						minFrame={scaleSelection.minFrame}
						maxFrame={scaleSelection.maxFrame}
						itemFrom={item.from}
						{pixelsPerFrame}
						{timelineX}
						onscalechange={previewScale}
						onscaleend={commitScale}
						onscalecancel={cancelScale}
					/>
				{/if}
				{#if presentation === 'side'}
					<div
						class="grid h-[22px] shrink-0 border-b border-white/10 bg-[oklch(0.155_0.008_55)] text-[8px] tracking-wider text-white/35 uppercase"
						style="grid-template-columns:{propertyColumnWidth}px minmax(0, 1fr)"
						data-keyframe-side-ruler
					>
						<span class="flex items-center px-2">{m.video_editor_keyframe_property()}</span>
						<div class="relative border-l border-white/8">
							<span class="absolute top-1 left-2">0</span>
							<span class="absolute top-1 left-1/2 -translate-x-1/2"
								>{Math.round((item.durationInFrames - 1) / 2)}</span
							>
							<span class="absolute top-1 right-2">{item.durationInFrames - 1}</span>
						</div>
					</div>
				{/if}

				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto {presentation === 'side'
						? ''
						: 'max-h-60'}"
					onpointerdown={startMarquee}
				>
					{#if presentation === 'side'}
						<div
							class="pointer-events-none absolute inset-y-0 z-30 w-px bg-orange-300/80"
							style="left:{timelineX(item.from + relativeCurrentFrame)}px"
							data-keyframe-side-playhead
						></div>
					{/if}
					{#each groupedRows as { group, properties, hidden } (group)}
						<div
							class="flex h-[22px] shrink-0 items-center gap-1 border-b border-[oklch(0.28_0.015_55)] bg-[oklch(0.17_0.008_55)] px-1.5"
							data-dopesheet-group={group}
							data-group-hidden={hidden}
						>
							<button
								type="button"
								class="rounded p-0.5 text-[oklch(0.62_0.015_55)] hover:bg-[oklch(0.25_0.012_55)] hover:text-[oklch(0.82_0.02_55)]"
								aria-label={hidden
									? m.video_editor_keyframe_sheet_group_show({ group: groupLabel(group) })
									: m.video_editor_keyframe_sheet_group_hide({ group: groupLabel(group) })}
								aria-pressed={!hidden}
								onpointerdown={(event) => event.stopPropagation()}
								onclick={() => toggleGroupVisibility(group)}
								>{#if hidden}<ThemeIcon role="eye-off" class="size-3" />{:else}<ThemeIcon
										role="eye"
										class="size-3"
									/>{/if}</button
							>
							<button
								type="button"
								class="rounded p-0.5 text-[oklch(0.62_0.015_55)] hover:bg-[oklch(0.25_0.012_55)] hover:text-[oklch(0.82_0.02_55)]"
								aria-label={groupLocked(properties)
									? m.video_editor_keyframe_sheet_group_unlock({ group: groupLabel(group) })
									: m.video_editor_keyframe_sheet_group_lock({ group: groupLabel(group) })}
								aria-pressed={groupLocked(properties)}
								onpointerdown={(event) => event.stopPropagation()}
								onclick={() => toggleGroupLock(properties)}
								><ThemeIcon role="lock" class="size-3" /></button
							>
							<span
								class="text-[9px] font-medium tracking-wide text-[oklch(0.66_0.015_55)] uppercase"
								>{groupLabel(group)}</span
							>
							<span class="font-mono text-[9px] text-[oklch(0.58_0.014_55)]"
								>{properties.length}</span
							>
						</div>
						{#if !hidden}
							{#each properties as property (property)}
								<div
									role="group"
									aria-label={m.video_editor_keyframe_sheet_row({
										property: propertyLabel(property)
									})}
									class="relative border-b border-[oklch(0.22_0.01_50)] last:border-b-0"
									style="height:{ROW_HEIGHT}px"
								>
									<div
										class="sticky left-0 z-20 flex h-full items-center gap-1 border-r border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55_/_0.97)] px-1.5"
										style="width:{propertyColumnWidth}px"
										data-marquee-ignore
									>
										<button
											type="button"
											class="rounded p-0.5 text-[oklch(0.62_0.015_55)] hover:bg-[oklch(0.25_0.012_55)] hover:text-[oklch(0.82_0.02_55)]"
											aria-label={lockedProperties.has(property)
												? m.video_editor_keyframe_sheet_unlock({
														property: propertyLabel(property)
													})
												: m.video_editor_keyframe_sheet_lock({ property: propertyLabel(property) })}
											onpointerdown={(event) => event.stopPropagation()}
											onclick={() => toggleLock(property)}
										>
											{#if lockedProperties.has(property)}
												<ThemeIcon role="lock" class="size-3" />
											{:else}
												<ThemeIcon role="lock" class="size-3" />
											{/if}
										</button>
										<button
											type="button"
											class="min-w-0 flex-1 truncate text-left text-[9px] text-[oklch(0.66_0.015_55)] uppercase hover:text-[oklch(0.85_0.02_55)]"
											onpointerdown={(event) => event.stopPropagation()}
											onclick={() => onactiveproperty(property)}>{propertyLabel(property)}</button
										>
										<button
											type="button"
											class="rounded p-0.5 text-[oklch(0.62_0.015_55)] hover:bg-[oklch(0.25_0.012_55)] hover:text-[oklch(0.82_0.02_55)] disabled:opacity-35"
											aria-label={m.video_editor_keyframe_sheet_add({
												property: propertyLabel(property)
											})}
											disabled={lockedProperties.has(property)}
											onpointerdown={(event) => event.stopPropagation()}
											onclick={() => addAtCurrentFrame(property)}
											><ThemeIcon role="add" class="size-3" /></button
										>
									</div>
									{#each blockedRanges as blocked, index (`${blocked.start}:${blocked.end}:${index}`)}
										<div
											class="pointer-events-none absolute top-0 h-full bg-[repeating-linear-gradient(135deg,oklch(0.66_0.14_45_/_0.18)_0_3px,transparent_3px_6px)]"
											style="left:{timelineX(item.from + blocked.start)}px;width:{Math.max(
												1,
												(blocked.end - blocked.start) * pixelsPerFrame
											)}px"
											data-dopesheet-transition-blocked
										></div>
									{/each}
									{#each allKeyframes.filter((keyframe) => keyframe.property === property) as keyframe (keyframeIdentity(keyframe))}
										{@const id = keyframeIdentity(keyframe)}
										{@const previewFrame = previewFrames?.get(id)}
										{@const displayFrame =
											drag?.kind === 'keyframe' && drag.duplicate
												? keyframe.frame
												: (previewFrame ?? keyframe.frame)}
										<button
											type="button"
											class="absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[oklch(0.12_0.01_55)] bg-[oklch(0.72_0.02_55)] shadow-sm disabled:cursor-not-allowed disabled:opacity-45 data-[selected=true]:bg-[oklch(0.76_0.14_45)] data-[selected=true]:shadow-[0_0_0_2px_oklch(0.66_0.14_45_/_0.3)]"
											style="left:{timelineX(item.from + displayFrame)}px"
											aria-label={m.video_editor_keyframe_sheet_point({
												property: propertyLabel(property),
												frame: keyframe.frame
											})}
											aria-pressed={selectedIds.has(id)}
											data-selected={selectedIds.has(id)}
											data-dopesheet-keyframe-id={id}
											disabled={lockedProperties.has(property)}
											onpointerdown={(event) => startKeyframeDrag(keyframe, event)}
											onkeydown={(event) => onPointKeyDown(keyframe, event)}
										></button>
										{#if drag?.kind === 'keyframe' && drag.duplicate && previewFrame !== undefined}
											<div
												class="pointer-events-none absolute top-1/2 z-20 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-dashed border-[oklch(0.88_0.14_65)] bg-[oklch(0.66_0.14_45_/_0.45)]"
												style="left:{timelineX(item.from + previewFrame)}px"
												data-dopesheet-duplicate-preview
											></div>
										{/if}
									{/each}
									{#each spansByProperty.get(property) ?? [] as span (span.fromId)}
										{@const segLeft = timelineX(item.from + span.fromFrame)}
										{@const segWidth = (span.toFrame - span.fromFrame) * pixelsPerFrame}
										{#if segWidth >= 14}
											<button
												type="button"
												class="absolute top-1/2 z-[5] h-2.5 -translate-y-1/2 rounded-full bg-[oklch(0.72_0.02_55_/_0.22)] hover:bg-[oklch(0.66_0.14_45_/_0.55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] data-[open=true]:bg-[oklch(0.66_0.14_45_/_0.55)]"
												style="left:{segLeft + 7}px;width:{Math.max(4, segWidth - 14)}px"
												aria-label={m.video_editor_keyframe_sheet_segment_easing({
													property: propertyLabel(property),
													from: span.fromFrame,
													to: span.toFrame,
													easing: span.easing
												})}
												aria-expanded={segmentMenu?.property === property &&
													segmentMenu.fromFrame === span.fromFrame}
												data-open={segmentMenu?.property === property &&
													segmentMenu.fromFrame === span.fromFrame}
												data-segment-easing={span.fromFrame}
												onpointerdown={(event) => {
													event.stopPropagation();
													toggleSegmentMenu(property, span.fromFrame);
												}}
												onkeydown={(event) => onSegmentKeyDown(property, span.fromFrame, event)}
											></button>
										{/if}
									{/each}
									{#if segmentMenu?.property === property}
										{@const menuSpan = (spansByProperty.get(property) ?? []).find(
											(span) => span.fromFrame === segmentMenu.fromFrame
										)}
										{@const menuKeyframe = allKeyframes.find(
											(keyframe) =>
												keyframe.property === property && keyframe.frame === segmentMenu.fromFrame
										)}
										{#if menuSpan && menuKeyframe}
											<KeyframeSegmentEasingPopover
												keyframe={menuKeyframe}
												endFrame={menuSpan.toFrame}
												{property}
												selectedFrames={[menuSpan.fromFrame]}
												leftPx={timelineX(item.from + menuSpan.fromFrame)}
												maxLeftPx={timelineWidth}
												onchange={applySegmentEasing}
												onclose={closeSegmentMenu}
											/>
										{/if}
									{/if}
								</div>
							{/each}
						{/if}
					{/each}
				</div>
				{#if marquee}
					<div
						class="pointer-events-none absolute z-40 border border-[oklch(0.76_0.14_45)] bg-[oklch(0.66_0.14_45_/_0.14)]"
						style="left:{marquee.left}px;top:{marquee.top}px;width:{marquee.width}px;height:{marquee.height}px"
						data-dopesheet-marquee
					></div>
				{/if}
				<p class="sr-only" aria-live="polite">{status}</p>
			</div>
		{/snippet}
	</ContextMenu.Trigger>
	<KeyframeContextMenuContent
		selectedCount={selectedIds.size}
		clipboardAvailable={keyframeSelectionStore.clipboard !== null}
		keyframeCount={allKeyframes.filter((keyframe) => visibleProperties.includes(keyframe.property))
			.length}
		oncopy={() => copySelection()}
		oncut={() => copySelection(true)}
		onpaste={pasteClipboard}
		ondelete={removeSelection}
		onselectall={selectAllVisible}
	/>
</ContextMenu.Root>
