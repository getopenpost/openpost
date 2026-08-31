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
	import {
		editorDeleteModeForEvent,
		editorShortcutTargetIsDisabled,
		eventMatchesShortcut,
		type EditorShortcutId
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { removeItems, updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		setTransformParent,
		detachTransformParent
	} from '$lib/video-editor/timeline/actions/transform-parenting';
	import {
		clampTimelineZoom,
		timelinePixelsPerFrame,
		TIMELINE_ZOOM_MAX,
		TIMELINE_ZOOM_MIN
	} from '$lib/video-editor/timeline/zoom';
	import {
		createBrowserPointerGestureSessionHost,
		type PointerGestureEvent,
		type PointerGestureSessionHost
	} from '$lib/video-editor/timeline/pointer-gesture-session';
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
	import { findForwardOpenTrackShift } from '$lib/video-editor/timeline/track-occupancy';
	import { planTrimCompositionToRange } from '$lib/video-editor/timeline/trim-composition-range';
	import { timelinePreviewScrub } from '$lib/video-editor/preview/timeline-preview-scrub';
	import { editorKeyframes, keyframeIdentity } from '$lib/video-editor/timeline/keyframe-editor';
	import { activeVectorKeyframes } from '$lib/video-editor/timeline/vector-keyframes';
	import { keyframeSelectionStore } from '$lib/video-editor/timeline/stores/keyframe-selection-store.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import {
		adjacentKeyframe,
		keyframeShortcutScopeActive,
		type KeyframeEditorMode
	} from '$lib/video-editor/timeline/keyframe-shortcuts';
	import {
		setKeyframeEasings,
		updateKeyframes
	} from '$lib/video-editor/timeline/actions/keyframes';
	import {
		getTextMotionTimelineBands,
		getMaxOffsetFrames
	} from '$lib/video-editor/timeline/text-motion-timeline';
	import type { TextMotionPresetId, TextMotionSlot } from '$lib/video-editor/project/types';
	import {
		TEXT_MOTION_IN_PRESET_IDS,
		TEXT_MOTION_LOOP_PRESET_IDS,
		TEXT_MOTION_OUT_PRESET_IDS
	} from '$lib/video-editor/project/types';
	import {
		beginTextMotionEdit,
		updateTextMotionLive,
		commitTextMotionEdit
	} from '$lib/video-editor/timeline/actions/text-motion';
	import {
		isTrackEffectivelyLocked,
		effectiveTrackState
	} from '$lib/video-editor/timeline/utils/track-groups';
	import { snapshotTimelineState } from '$lib/video-editor/timeline/utils/state-snapshot.svelte';
	import { getTextMotionPreset } from '$lib/video-editor/timeline/text-motion-presets';
	import {
		textMotionPresetLabel,
		textMotionSlotLabel
	} from '$lib/video-editor/timeline/text-motion-labels';
	import {
		captureSnapshot,
		restoreSnapshot,
		snapshotsEqual
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import {
		commandHistory,
		executeAtomic
	} from '$lib/video-editor/timeline/commands/command-store.svelte';
	import { insertMediaAtFrame } from '$lib/video-editor/timeline/actions/insert-media';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { clearActiveMediaDrag, getMediaDragData } from '$lib/video-editor/media/media-drag';
	import {
		evaluateExactMediaPlacement,
		mediaDurationInFrames,
		mediaTimelineKind,
		planExactSequencePlacement
	} from '$lib/video-editor/media/media-drop-placement';
	import { wouldCreateCompositionCycle } from '$lib/video-editor/sequences/composition-graph';
	import { nestSequenceOnExactTracks } from '$lib/video-editor/sequences/sequence-actions';
	import {
		planMotionTimelineRows,
		expandMotionLayerItemIds
	} from '$lib/video-editor/timeline/motion-timeline-rows';
	import type {
		CompositionControlDefinition,
		DirectLinkableProperty,
		TimelineItem,
		TimelineTrack
	} from '$lib/video-editor/project/types';
	import { getCompositionControlSourceValue } from '$lib/video-editor/sequences/composition-controls';
	import type { EasingType, KeyframeProperty } from '$lib/video-editor/project/types';
	import KeyframeDopesheet from '$lib/video-editor/components/keyframe-dopesheet.svelte';
	import KeyframeValueGraph from '$lib/video-editor/components/keyframe-value-graph.svelte';
	import { getAnimatablePropertiesForItem } from '$lib/video-editor/timeline/animated-properties';
	import { removeMotionLayerFromItems } from '$lib/video-editor/timeline/actions/motion-layers';
	import { removeMotionModifierFromItems } from '$lib/video-editor/timeline/actions/motion-modifiers';
	import {
		ALL_BLEND_MODES,
		BLEND_MODE_GROUPS,
		type BlendMode
	} from '$lib/video-editor/effects/gpu/blend-modes';
	import {
		removeDirectPropertyLink,
		setDirectPropertyLink
	} from '$lib/video-editor/timeline/actions/property-runtime';
	import { Slider } from '$lib/components/ui/slider';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Select from '$lib/components/ui/select';
	import type {
		MotionTimelineGroupRow,
		MotionTimelineLayerRow,
		MotionTimelineRow
	} from '$lib/video-editor/timeline/motion-timeline-rows';
	import {
		buildVirtualRowLayout,
		queryVirtualRowLayout
	} from '$lib/video-editor/timeline/virtual-row-window';
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

	function isLayerRow(row: MotionTimelineRow): row is MotionTimelineLayerRow {
		return row.kind === 'layer';
	}

	function motionRowKey(row: MotionTimelineRow): string {
		return row.kind === 'group' ? `group:${row.track.id}` : `layer:${row.item.id}`;
	}

	function isBlendMode(value: string): value is BlendMode {
		return ALL_BLEND_MODES.some((mode) => mode === value);
	}

	function isKeyframeProperty(value: string): value is KeyframeProperty {
		return (
			value === 'x' ||
			value === 'y' ||
			value === 'width' ||
			value === 'height' ||
			value === 'anchorX' ||
			value === 'anchorY' ||
			value === 'rotation' ||
			value === 'opacity' ||
			value === 'scaleX' ||
			value === 'scaleY'
		);
	}
	function isEasingType(value: string): value is EasingType {
		return (
			value === 'linear' || value === 'ease-in' || value === 'ease-out' || value === 'ease-in-out'
		);
	}

	function isDirectLinkableProperty(value: string): value is DirectLinkableProperty {
		return (
			isKeyframeProperty(value) ||
			value === 'cornerRadius' ||
			value === 'position' ||
			value === 'scale' ||
			value === 'anchor'
		);
	}

	const TEXT_PRESET_SET = new Set<string>([
		...TEXT_MOTION_IN_PRESET_IDS,
		...TEXT_MOTION_OUT_PRESET_IDS,
		...TEXT_MOTION_LOOP_PRESET_IDS
	]);
	const blendModeLabels = $derived<Record<BlendMode, string>>({
		normal: m.video_editor_blend_normal(),
		dissolve: m.video_editor_blend_dissolve(),
		darken: m.video_editor_blend_darken(),
		multiply: m.video_editor_blend_multiply(),
		'color-burn': m.video_editor_blend_color_burn(),
		'linear-burn': m.video_editor_blend_linear_burn(),
		lighten: m.video_editor_blend_lighten(),
		screen: m.video_editor_blend_screen(),
		'color-dodge': m.video_editor_blend_color_dodge(),
		'linear-dodge': m.video_editor_blend_linear_dodge(),
		overlay: m.video_editor_blend_overlay(),
		'soft-light': m.video_editor_blend_soft_light(),
		'hard-light': m.video_editor_blend_hard_light(),
		'vivid-light': m.video_editor_blend_vivid_light(),
		'linear-light': m.video_editor_blend_linear_light(),
		'pin-light': m.video_editor_blend_pin_light(),
		'hard-mix': m.video_editor_blend_hard_mix(),
		difference: m.video_editor_blend_difference(),
		exclusion: m.video_editor_blend_exclusion(),
		subtract: m.video_editor_blend_subtract(),
		divide: m.video_editor_blend_divide(),
		hue: m.video_editor_blend_hue(),
		saturation: m.video_editor_blend_saturation(),
		color: m.video_editor_blend_color(),
		luminosity: m.video_editor_blend_luminosity()
	});
	const blendGroupLabels = $derived<Record<string, string>>({
		normal: m.video_editor_blend_group_normal(),
		darken: m.video_editor_blend_group_darken(),
		lighten: m.video_editor_blend_group_lighten(),
		contrast: m.video_editor_blend_group_contrast(),
		inversion: m.video_editor_blend_group_inversion(),
		component: m.video_editor_blend_group_component()
	});

	function isTextMotionPresetId(value: string): value is TextMotionPresetId {
		return TEXT_PRESET_SET.has(value);
	}

	function publishedControls(item: TimelineItem): CompositionControlDefinition[] {
		if (item.type !== 'composition' || !item.compositionId) return [];
		return (
			sequenceStore.compositionById.get(item.compositionId)?.compositionControls?.controls ?? []
		);
	}

	function compositionControlValue(
		item: TimelineItem,
		control: CompositionControlDefinition
	): string {
		const override = item.compositionControlOverrides?.[control.id];
		if (override !== undefined) return override;
		const nestedItems = item.compositionId
			? (sequenceStore.compositionById.get(item.compositionId)?.items ?? [])
			: [];
		return getCompositionControlSourceValue(nestedItems, control);
	}

	function setCompositionControlValue(
		item: TimelineItem,
		control: CompositionControlDefinition,
		value: string
	): void {
		const overrides = { ...(item.compositionControlOverrides ?? {}) };
		const nestedItems = item.compositionId
			? (sequenceStore.compositionById.get(item.compositionId)?.items ?? [])
			: [];
		if (value === getCompositionControlSourceValue(nestedItems, control)) {
			delete overrides[control.id];
		} else {
			overrides[control.id] = value;
		}
		updateItemProperties(
			item.id,
			{
				compositionControlOverrides: Object.keys(overrides).length > 0 ? overrides : undefined
			},
			'UPDATE_COMPOSITION_CONTROL_OVERRIDE'
		);
		onedit();
	}

	let {
		onedit,
		onselectitem,
		oncompositionchange,
		selectedItemId: externalSelectedId = null
	}: {
		onedit: () => void;
		onselectitem?: (id: string | null) => void;
		oncompositionchange?: (id: string) => void;
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
	let layerBarsEl: HTMLDivElement | null = $state(null);
	let sidebarEl: HTMLDivElement | null = $state(null);
	let timelineViewportWidth = $state(1200);
	let sidebarViewportHeight = $state(400);
	let sidebarScrollTop = $state(0);
	let sidebarRowHeights = $state<Map<string, number>>(new Map());
	let selectedItemIds = $state<Set<string>>(new Set());
	let lastSelectedId = $state<string | null>(null);
	$effect(() => {
		selectedItemIds = externalId === null ? new Set() : new Set([externalId]);
		lastSelectedId = externalId;
	});
	$effect(() => {
		const timeline = scrollEl;
		const sidebar = sidebarEl;
		if (!timeline && !sidebar) return;
		const updateSizes = () => {
			if (timeline) timelineViewportWidth = timeline.clientWidth;
			if (sidebar) sidebarViewportHeight = sidebar.clientHeight;
		};
		updateSizes();
		const observer = new ResizeObserver(updateSizes);
		if (timeline) observer.observe(timeline);
		if (sidebar) observer.observe(sidebar);
		return () => observer.disconnect();
	});
	let pickTarget: string | null = $state(null);
	let pendingParent: string | null = $state(null);
	let status = $state('');
	let zoomSlider = $derived(timelineStore.zoomLevel);
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
	type CompositionContextTarget =
		| { kind: 'layer'; itemId: string }
		| { kind: 'group'; trackId: string; itemIds: string[] };
	let compositionContextTarget: CompositionContextTarget | null = $state(null);
	let previewFrame: number | null = $state(null);
	let keyframeEditorModes = $state<Partial<Record<string, KeyframeEditorMode>>>({});
	let keyframeShortcutPointerItemId: string | null = $state(null);
	let keyframeGraphFitRequest = $state(0);
	let activeKeyframeProperties = $state<Partial<Record<string, KeyframeProperty>>>({});
	let selectedEasing: string = $state('linear');
	let linkPickSource: { itemId: string; property: string } | null = $state(null);
	const ROW_H = 34;
	const VECTOR_H = 20;
	const TEXT_BAND_H = 22;
	const visibleRange = $derived({
		start: Math.max(0, (scrollLeft - 600) / Math.max(0.001, pxPerFrame)),
		end: Math.max(
			0,
			(scrollLeft + Math.max(1, timelineViewportWidth) + 600) / Math.max(0.001, pxPerFrame)
		)
	});
	const motionPlan = $derived(
		planMotionTimelineRows({ items: timelineStore.items, tracks: timelineStore.tracks })
	);
	const motionRows = $derived(motionPlan.rows);
	const trackById = $derived(new Map(timelineStore.tracks.map((t) => [t.id, t])));
	const groupRows = $derived(
		motionRows.filter((r): r is MotionTimelineGroupRow => r.kind === 'group')
	);
	const layerEntries = $derived(motionRows.filter(isLayerRow));
	const contextLayer = $derived(
		compositionContextTarget?.kind === 'layer'
			? timelineStore.itemById.get(compositionContextTarget.itemId)
			: undefined
	);
	const contextGroup = $derived(
		compositionContextTarget?.kind === 'group'
			? trackById.get(compositionContextTarget.trackId)
			: undefined
	);
	const sidebarRows = $derived.by(() => {
		const query = filterText.trim().toLowerCase();
		if (!query) return motionRows;
		const matchingItemIds = new Set(
			layerEntries
				.filter((row) => itemLabel(row.item).toLowerCase().includes(query))
				.map((row) => row.item.id)
		);
		return motionRows.filter((row) =>
			row.kind === 'layer'
				? matchingItemIds.has(row.item.id)
				: row.track.name.toLowerCase().includes(query) ||
					row.itemIds.some((itemId) => matchingItemIds.has(itemId))
		);
	});
	const sidebarRowKeys = $derived(sidebarRows.map(motionRowKey));
	const sidebarLayout = $derived(
		buildVirtualRowLayout(sidebarRowKeys, sidebarRowHeights, ROW_H + 4)
	);
	const sidebarWindow = $derived(
		queryVirtualRowLayout(sidebarLayout, sidebarScrollTop, sidebarViewportHeight, ROW_H * 8)
	);
	const visibleSidebarRows = $derived(
		sidebarRows.slice(sidebarWindow.startIndex, sidebarWindow.endIndex)
	);
	$effect(() => {
		const activeKeys = new Set(sidebarRowKeys);
		if ([...sidebarRowHeights.keys()].every((key) => activeKeys.has(key))) return;
		sidebarRowHeights = new Map([...sidebarRowHeights].filter(([key]) => activeKeys.has(key)));
	});
	function setSidebarRowHeight(key: string, size: number): void {
		if (!Number.isFinite(size) || size <= 0) return;
		const previous = sidebarRowHeights.get(key);
		if (previous !== undefined && Math.abs(previous - size) < 0.5) return;
		const next = new Map(sidebarRowHeights);
		next.set(key, size);
		sidebarRowHeights = next;
	}
	function measureSidebarRow(node: HTMLElement, key: string) {
		let activeKey = key;
		const measure = () => {
			const style = getComputedStyle(node);
			const marginBottom = Number.parseFloat(style.marginBottom) || 0;
			setSidebarRowHeight(activeKey, node.getBoundingClientRect().height + marginBottom);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		measure();
		return {
			update(nextKey: string) {
				activeKey = nextKey;
				measure();
			},
			destroy() {
				observer.disconnect();
			}
		};
	}

	// Viewport culling: only mount visible bars + selected
	const visualLayerItems = $derived(layerEntries.map((r) => r.item));
	const itemIndex = $derived(buildTimelineItemRangeIndex(visualLayerItems));
	const visibleBars = $derived(
		queryTimelineItemRange(itemIndex, { start: visibleRange.start, end: visibleRange.end })
	);
	const layerEntryByItemId = $derived(
		new Map(layerEntries.map((row, index) => [row.item.id, { row, index }]))
	);
	const visibleLayerEntries = $derived.by(() => {
		const ids = new Set([...visibleBars.map((item) => item.id), ...selectedItemIds]);
		const entries = [...ids]
			.map((id) => layerEntryByItemId.get(id))
			.filter((entry) => entry !== undefined);
		return entries.toSorted((a, b) => a.index - b.index);
	});

	const compositions = $derived(
		sequenceStore.compositions.filter((c) => c.editorKind === 'composite-2d')
	);

	function itemLabel(item: TimelineItem): string {
		return item.label || item.type;
	}
	function toggleLayerExpanded(itemId: string): void {
		const next = new Set(expandedLayerIds);
		if (next.has(itemId)) {
			next.delete(itemId);
		} else {
			next.add(itemId);
			while (next.size > 3) {
				const oldest = next.values().next().value;
				if (oldest === undefined) break;
				next.delete(oldest);
			}
		}
		expandedLayerIds = next;
	}
	function selectItem(id: string, additive: boolean, range: boolean): void {
		if (range && lastSelectedId) {
			const ids = layerEntries.map((r) => r.item.id);
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
	function switchComposition(id: string): void {
		if (oncompositionchange) oncompositionchange(id);
		else sequenceStore.switchTo(id);
	}
	function prepareCompositionContextMenu(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof Element)) return;

		const groupElement = target.closest<HTMLElement>('[data-group-row]');
		const groupId = groupElement?.dataset.groupRow;
		if (groupId) {
			const group = groupRows.find((row) => row.track.id === groupId);
			if (!group) return;
			const allSelected = group.itemIds.every((id) => selectedItemIds.has(id));
			if (!allSelected) {
				selectedItemIds = new Set(group.itemIds);
				lastSelectedId = group.itemIds[0] ?? null;
				onselectitem?.(lastSelectedId);
			}
			compositionContextTarget = {
				kind: 'group',
				trackId: groupId,
				itemIds: [...group.itemIds]
			};
			return;
		}

		const layerElement = target.closest<HTMLElement>('[data-layer-row]');
		const itemId = layerElement?.dataset.layerRow;
		if (itemId && timelineStore.itemById.has(itemId)) {
			if (!selectedItemIds.has(itemId)) selectItem(itemId, false, false);
			compositionContextTarget = { kind: 'layer', itemId };
			return;
		}

		compositionContextTarget = null;
		event.preventDefault();
	}
	function openCompositionContextMenuFromKeyboard(event: KeyboardEvent): void {
		if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();
		const rect = target.getBoundingClientRect();
		target.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: rect.left + Math.min(24, rect.width / 2),
				clientY: rect.top + rect.height / 2
			})
		);
	}
	function seekTo(frame: number): void {
		const clamped = Math.max(0, Math.min(frame, durationFrames - 1));
		timelineStore._setCurrentFrame(clamped);
	}
	function handleTimelineClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (
			target.closest('[data-layer-row]') ||
			target.closest('[data-vector-row]') ||
			target.closest('[data-testid^="composition-bar"]')
		)
			return;
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
		const level = clampTimelineZoom(targetPxPerFrame / 4);
		timelineStore._setZoomLevel(level);
		status = m.video_editor_composition_timeline_fit();
	}
	function activeKeyframeProperty(item: TimelineItem): KeyframeProperty {
		const available = getAnimatablePropertiesForItem(item);
		const preferred = activeKeyframeProperties[item.id];
		return (
			(preferred && available.includes(preferred) ? preferred : undefined) ??
			available.find((property) => editorKeyframes(item, property).length > 0) ??
			available[0] ??
			'x'
		);
	}
	function setActiveKeyframeProperty(itemId: string, property: KeyframeProperty): void {
		activeKeyframeProperties = { ...activeKeyframeProperties, [itemId]: property };
	}
	function keyframeEditorMode(itemId: string): KeyframeEditorMode {
		return keyframeEditorModes[itemId] ?? 'dopesheet';
	}
	function setKeyframeEditorMode(itemId: string, mode: KeyframeEditorMode): void {
		keyframeEditorModes = { ...keyframeEditorModes, [itemId]: mode };
	}
	function fitMotionKeyframes(item: TimelineItem, property: KeyframeProperty): void {
		if (!scrollEl) return;
		const frames = editorKeyframes(item, property).map((keyframe) => item.from + keyframe.frame);
		const first = frames.length > 0 ? Math.min(...frames) : item.from;
		const last = frames.length > 0 ? Math.max(...frames) : item.from + item.durationInFrames - 1;
		const span = Math.max(fps, last - first + 1);
		const center = (first + last) / 2;
		const start = Math.max(0, center - span / 2);
		const availableWidth = Math.max(1, scrollEl.clientWidth - 220 - 50);
		const level = clampTimelineZoom(availableWidth / (span * timelinePixelsPerFrame(1)));
		const targetScrollLeft = Math.max(0, start * timelinePixelsPerFrame(level) - 24);
		timelineStore._setZoomLevel(level);
		queueMicrotask(() => {
			if (scrollEl) scrollEl.scrollLeft = targetScrollLeft;
		});
	}
	function shortcutKeyframeItem(event: KeyboardEvent): TimelineItem | undefined {
		const targetId =
			event.target instanceof HTMLElement
				? event.target.closest<HTMLElement>('[data-keyframe-shortcuts]')?.dataset.keyframeShortcuts
				: undefined;
		const itemId = targetId ?? keyframeShortcutPointerItemId;
		return itemId ? timelineStore.itemById.get(itemId) : undefined;
	}
	function handleKeyframeShortcut(
		event: KeyboardEvent,
		matches: (...ids: EditorShortcutId[]) => boolean
	): boolean {
		if (!keyframeShortcutScopeActive(event.target, keyframeShortcutPointerItemId !== null)) {
			return false;
		}
		const item = shortcutKeyframeItem(event);
		if (!item) return false;
		const property = activeKeyframeProperty(item);
		const mode = keyframeEditorMode(item.id);
		let handled = true;
		if (matches('KEYFRAME_EDITOR_GRAPH')) setKeyframeEditorMode(item.id, 'graph');
		else if (matches('KEYFRAME_EDITOR_DOPESHEET')) setKeyframeEditorMode(item.id, 'dopesheet');
		else if (matches('KEYFRAME_EDITOR_SPLIT')) setKeyframeEditorMode(item.id, 'split');
		else if (matches('KEYFRAME_PREVIOUS', 'KEYFRAME_NEXT')) {
			const keyframe = adjacentKeyframe(
				editorKeyframes(item, property),
				timelineStore.currentFrame - item.from,
				matches('KEYFRAME_PREVIOUS') ? 'previous' : 'next'
			);
			if (keyframe) seekTo(item.from + keyframe.frame);
		} else if (matches('KEYFRAME_TOGGLE_AUTO')) {
			autoKeyframeStore.toggle(item.id, property);
		} else if (matches('KEYFRAME_FIT')) {
			if (mode !== 'graph') fitMotionKeyframes(item, property);
			if (mode !== 'dopesheet') keyframeGraphFitRequest += 1;
		} else handled = false;
		if (handled) event.preventDefault();
		return handled;
	}
	function updateCompositionTiming(
		patch: { fps?: number; durationInFrames?: number },
		commandType: string
	): void {
		if (!composition) return;
		const unchanged =
			(patch.fps === undefined || patch.fps === composition.fps) &&
			(patch.durationInFrames === undefined ||
				patch.durationInFrames === composition.durationInFrames);
		if (unchanged) return;
		const before = captureSnapshot();
		sequenceStore.updateComposition(composition.id, patch);
		commandHistory.addUndoEntry({ type: commandType }, before);
		onedit();
	}
	function handleScroll(event: Event): void {
		const current = event.currentTarget;
		if (!(current instanceof HTMLDivElement)) return;
		const el = current;
		scrollLeft = el.scrollLeft;
		sidebarScrollTop = el.scrollTop;
		if (sidebarEl && sidebarEl !== el) sidebarEl.scrollTop = el.scrollTop;
	}
	function handleSidebarScroll(event: Event): void {
		const current = event.currentTarget;
		if (!(current instanceof HTMLDivElement)) return;
		const el = current;
		sidebarScrollTop = el.scrollTop;
		if (scrollEl) scrollEl.scrollTop = el.scrollTop;
	}
	let snapGuideFrame: number | null = $state(null);
	function handleWheel(event: WheelEvent): void {
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			if (!scrollEl) return;
			const activeScroll = scrollEl;
			const rect = activeScroll.getBoundingClientRect();
			const pointerRatio = (event.clientX - rect.left + scrollLeft) / Math.max(1, timelineWidth);
			const delta = event.deltaY > 0 ? 0.9 : 1.1;
			const next = clampTimelineZoom(timelineStore.zoomLevel * delta);
			timelineStore._setZoomLevel(next);
			// compensate scroll to keep frame under pointer anchored
			requestAnimationFrame(() => {
				const newPx = timelinePixelsPerFrame(next);
				const newWidth = durationFrames * newPx;
				const newScroll = pointerRatio * newWidth - (event.clientX - rect.left);
				activeScroll.scrollLeft = Math.max(0, newScroll);
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
		timelinePreviewScrub.setFrame(previewFrame);
	}
	function commitGhostScrub(): void {
		if (previewFrame !== null) {
			timelineStore._setCurrentFrame(previewFrame);
			previewFrame = null;
		}
		timelinePreviewScrub.clear();
	}
	function cancelGhostScrub(): void {
		previewFrame = null;
		timelinePreviewScrub.clear();
	}
	function handleTrimToActive(): void {
		const inP = timelineStore.inPoint;
		const outP = timelineStore.outPoint;
		if (inP === null || outP === null || outP <= inP) {
			status = m.video_editor_composition_timeline_no_work_area();
			return;
		}
		if (!composition) return;
		const plan = planTrimCompositionToRange({
			items: timelineStore.items,
			tracks: timelineStore.tracks,
			transitions: composition.transitions,
			markers: timelineStore.markers,
			inPoint: inP,
			outPoint: outP,
			currentFrame: timelineStore.currentFrame,
			fps: timelineStore.fps
		});
		if (!plan.ok) {
			status = m.video_editor_motion_track_locked();
			return;
		}
		const before = captureSnapshot();
		if (plan.updates.length > 0) timelineStore._updateItems(plan.updates);
		if (plan.removeIds.length > 0) timelineStore._removeItems(plan.removeIds);
		timelineStore._setMarkers(plan.markers);
		timelineStore._setCurrentFrame(plan.currentFrame);
		sequenceStore.updateComposition(composition.id, {
			durationInFrames: plan.durationInFrames,
			transitions: plan.transitions,
			markers: plan.markers
		});
		timelineStore._setInPoint(null);
		timelineStore._setOutPoint(null);
		commandHistory.addUndoEntry({ type: 'TRIM_TO_ACTIVE' }, before);
		onedit();
		status = m.video_editor_composition_timeline_trimmed();
	}
	let pointerGestures: PointerGestureSessionHost | null = null;
	onMount(() => {
		pointerGestures = createBrowserPointerGestureSessionHost();
	});
	onDestroy(() => {
		pointerGestures?.destroy();
		pointerGestures = null;
		timelinePreviewScrub.clear();
		if (drag) restoreSnapshot(drag.before);
		if (textDrag?.before) restoreSnapshot(textDrag.before);
		drag = null;
		kfDrag = null;
		textDrag = null;
		restorePick();
	});
	function restorePick(): void {
		pendingParent = null;
		pickTarget = null;
	}
	function beginParentPick(childId: string, event: PointerEvent): void {
		if (event.button !== 0) return;
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;
		event.preventDefault();
		pointerGestures?.cancel('superseded');
		pendingParent = childId;
		pickTarget = null;
		const onMove = (move: PointerGestureEvent) => {
			const maybeEl = document.elementFromPoint(move.clientX, move.clientY);
			const el = maybeEl instanceof HTMLElement ? maybeEl : null;
			const row = el?.closest<HTMLElement>('[data-layer-row]');
			pickTarget = row?.dataset.layerRow ?? null;
			if (pickTarget === childId) pickTarget = null;
		};
		const onCommit = () => {
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
		pointerGestures?.start({
			pointerId: event.pointerId,
			target,
			onMove,
			onCommit,
			onCancel: restorePick
		});
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
		const removed = removeItems(ids, false);
		if (removed.length > 0) {
			clearSelection();
			onedit();
		}
	}
	function duplicateSelected(): void {
		if (selectedItemIds.size === 0) return;
		const before = captureSnapshot();
		const ids = expandMotionLayerItemIds(motionPlan, [...selectedItemIds]);
		const selected = timelineStore.items.filter((i) => ids.includes(i.id));
		const newItems: TimelineItem[] = selected.map((item) => ({
			...snapshotTimelineState(item),
			id: crypto.randomUUID(),
			from: item.from + 10,
			label: item.label ? `${item.label} copy` : item.type
		}));
		const shift = findForwardOpenTrackShift(newItems, timelineStore.items);
		if (shift === null) return;
		if (shift > 0) newItems.forEach((item) => (item.from += shift));
		timelineStore._setItems([...timelineStore.items, ...newItems]);
		commandHistory.addUndoEntry({ type: 'DUPLICATE_ITEMS' }, before);
		onedit();
		status = m.video_editor_motion_duplicated();
	}
	function copySelected(): void {
		if (selectedItemIds.size === 0) return;
		const ids = expandMotionLayerItemIds(motionPlan, [...selectedItemIds]);
		clipboard = timelineStore.items
			.filter((i) => ids.includes(i.id))
			.map((i) => snapshotTimelineState(i));
		status = m.video_editor_motion_copied();
	}
	function pasteClipboard(): void {
		if (!clipboard || clipboard.length === 0) return;
		const before = captureSnapshot();
		const offset = 10;
		const newItems: TimelineItem[] = clipboard.map((item) => ({
			...snapshotTimelineState(item),
			id: crypto.randomUUID(),
			from: Math.max(0, item.from + offset)
		}));
		const shift = findForwardOpenTrackShift(newItems, timelineStore.items);
		if (shift === null) return;
		if (shift > 0) newItems.forEach((item) => (item.from += shift));
		timelineStore._setItems([...timelineStore.items, ...newItems]);
		commandHistory.addUndoEntry({ type: 'PASTE_ITEMS' }, before);
		onedit();
		status = m.video_editor_motion_pasted();
	}
	function groupSelected(): void {
		if (selectedItemIds.size < 2) return;
		const ids = expandMotionLayerItemIds(motionPlan, [...selectedItemIds]);
		const selectedTracks = new Set(
			timelineStore.items.filter((i) => ids.includes(i.id)).map((i) => i.trackId)
		);
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
		const newTracks = timelineStore.tracks.map((t) =>
			selectedTracks.has(t.id) ? { ...t, parentTrackId: groupId } : t
		);
		timelineStore._setTracks([...newTracks, groupTrack]);
		commandHistory.addUndoEntry({ type: 'GROUP_TRACKS' }, before);
		onedit();
	}
	function ungroupTrack(groupId: string): void {
		const before = captureSnapshot();
		const newTracks = timelineStore.tracks
			.filter((t) => t.id !== groupId)
			.map((t) => (t.parentTrackId === groupId ? { ...t, parentTrackId: undefined } : t));
		timelineStore._setTracks(newTracks);
		commandHistory.addUndoEntry({ type: 'UNGROUP_TRACKS' }, before);
		onedit();
	}
	function deleteGroupAndContents(groupId: string, itemIds: string[]): void {
		if (!trackById.has(groupId)) return;
		const ids = itemIds.flatMap((id) => expandMotionLayerItemIds(motionPlan, [id]));
		executeAtomic('DELETE_GROUP', () => {
			if (ids.length > 0) removeItems(ids, false);
			const remaining = timelineStore.tracks
				.filter((track) => track.id !== groupId)
				.map((track) =>
					track.parentTrackId === groupId ? { ...track, parentTrackId: undefined } : track
				);
			timelineStore._setTracks(remaining);
		});
		if (ids.some((id) => selectedItemIds.has(id))) clearSelection();
		onedit();
	}
	function toggleGroupCollapse(groupId: string): void {
		updateTrackFlag(groupId, 'isCollapsed', 'TOGGLE_TRACK_GROUP');
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
					timelineStore._setTracks(
						timelineStore.tracks.map((t) => (t.id === editingNameId ? { ...t, name: val } : t))
					);
					commandHistory.addUndoEntry({ type: 'RENAME_TRACK' }, before);
					onedit();
				}
			}
		}
		editingNameId = null;
	}
	function toggleTrackVisible(trackId: string): void {
		updateTrackFlag(trackId, 'visible', 'TOGGLE_TRACK_VISIBILITY');
	}
	function toggleTrackLocked(trackId: string): void {
		updateTrackFlag(trackId, 'locked', 'TOGGLE_TRACK_LOCK');
	}
	function toggleTrackMuted(trackId: string): void {
		updateTrackFlag(trackId, 'muted', 'TOGGLE_TRACK_MUTE');
	}
	function toggleTrackSolo(trackId: string): void {
		updateTrackFlag(trackId, 'solo', 'TOGGLE_TRACK_SOLO');
	}
	function updateTrackFlag(
		trackId: string,
		property: 'visible' | 'locked' | 'muted' | 'solo' | 'isCollapsed',
		commandType: string
	): void {
		const t = trackById.get(trackId);
		if (!t) return;
		const before = captureSnapshot();
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === trackId ? { ...track, [property]: !track[property] } : track
			)
		);
		commandHistory.addUndoEntry({ type: commandType }, before);
		onedit();
	}
	function setBlendMode(itemId: string, mode: string): void {
		if (!isBlendMode(mode)) return;
		const item = timelineStore.itemById.get(itemId);
		if (!item || isLocked(item) || item.blendMode === mode) return;
		const before = captureSnapshot();
		timelineStore._updateItems([{ id: itemId, patch: { blendMode: mode } }]);
		commandHistory.addUndoEntry({ type: 'SET_BLEND_MODE' }, before);
		onedit();
	}
	function editItemTiming(item: TimelineItem, edge: 'in' | 'out', rawValue: string): void {
		if (isLocked(item)) return;
		const parsed = Number(rawValue);
		if (!Number.isFinite(parsed)) return;
		const requestedEdge = Math.round(parsed);
		const currentEdge = edge === 'in' ? item.from : item.from + item.durationInFrames;
		const plan = planTrimGesture(
			item,
			edge === 'in' ? 'start' : 'end',
			requestedEdge - currentEdge,
			timelineStore.items,
			fps,
			[],
			0,
			composition?.transitions ?? []
		);
		const updates = [{ id: item.id, patch: plan.patch }, ...(plan.linkedPatches ?? [])];
		if (
			updates.some((update) =>
				isTrackEffectivelyLocked(
					timelineStore.itemById.get(update.id)?.trackId ?? '',
					timelineStore.tracks
				)
			)
		) {
			status = m.video_editor_motion_track_locked();
			return;
		}
		const before = captureSnapshot();
		timelineStore._updateItems(updates);
		if (snapshotsEqual(before, captureSnapshot())) return;
		commandHistory.addUndoEntry({ type: 'EDIT_TIMING' }, before);
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
				{
					id: crypto.randomUUID(),
					name: 'Video',
					kind: 'video' as const,
					height: 34,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				},
				{
					id: crypto.randomUUID(),
					name: 'Audio',
					kind: 'audio' as const,
					height: 34,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 1
				}
			],
			transitions: [],
			fps: fpsVal,
			width: composition?.width ?? 1920,
			height: composition?.height ?? 1080,
			durationInFrames: dur
		};
		sequenceStore.addComposition(comp, true);
		switchComposition(id);
		showNewDialog = false;
		newName = '';
		status = m.video_editor_motion_composition_created();
		onedit();
	}
	function addGeneratedLayer(kind: 'text' | 'solid' | 'gradient' | 'shape' | 'controller'): void {
		const before = captureSnapshot();
		const trackId = crypto.randomUUID();
		const base: TimelineItem = {
			id: crypto.randomUUID(),
			trackId,
			from: timelineStore.currentFrame,
			durationInFrames: Math.max(30, Math.min(300, durationFrames - timelineStore.currentFrame)),
			label:
				kind === 'text'
					? m.video_editor_motion_add_text()
					: kind === 'solid'
						? m.video_editor_motion_add_solid()
						: kind === 'gradient'
							? m.video_editor_motion_add_gradient()
							: kind === 'shape'
								? m.video_editor_motion_add_shape()
								: m.video_editor_motion_controller_default(),
			type:
				kind === 'text'
					? 'text'
					: kind === 'shape'
						? 'shape'
						: kind === 'controller'
							? 'controller'
							: 'video',
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
			// controller is non-rendering: participates in transforms but never renders (preview/export filter by type)
		}
		const track: TimelineTrack = {
			id: trackId,
			name: base.label,
			kind: 'video',
			height: 34,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: timelineStore.tracks.reduce((max, candidate) => Math.max(max, candidate.order), -1) + 1
		};
		timelineStore._setTracks([...timelineStore.tracks, track]);
		timelineStore._setItems([...timelineStore.items, base]);
		selectItem(base.id, false, false);
		commandHistory.addUndoEntry({ type: 'ADD_LAYER' }, before);
		onedit();
	}
	type MotionDropSource =
		| { kind: 'media'; id: string; label: string }
		| { kind: 'composition'; id: string; label: string };
	let dropGhost: {
		frame: number;
		trackId: string | null;
		visualTrackId: string | null;
		audioTrackId: string | null;
		valid: boolean;
		source: MotionDropSource | null;
	} | null = $state(null);

	function resolveMotionDropSource(event: DragEvent): MotionDropSource | null {
		const payload = getMediaDragData(event.dataTransfer);
		if (!payload) return null;
		if (payload.source === 'media') {
			const entry = mediaPool.entry(payload.id);
			if (!entry || entry.status !== 'ready') return null;
			return { kind: 'media', id: payload.id, label: entry.media.fileName };
		}
		const nested = sequenceStore.compositionById.get(payload.id);
		if (
			!nested ||
			wouldCreateCompositionCycle(
				sequenceStore.activeSequenceId,
				nested.id,
				sequenceStore.compositionById
			)
		) {
			return null;
		}
		return { kind: 'composition', id: nested.id, label: nested.name };
	}

	function handleDragOver(event: DragEvent): void {
		const source = resolveMotionDropSource(event);
		if (!source) return;
		event.preventDefault();
		if (!scrollEl) return;
		const scrollRect = scrollEl.getBoundingClientRect();
		const x = event.clientX - scrollRect.left + scrollEl.scrollLeft;
		const frame = Math.round(Math.max(0, x / Math.max(1, pxPerFrame)));
		// Resolve the exact row from either the layer list or the timeline lane.
		const maybeEl = document.elementFromPoint(event.clientX, event.clientY);
		const el = maybeEl instanceof HTMLElement ? maybeEl : null;
		const row = el?.closest<HTMLElement>('[data-layer-row]');
		let trackId = row?.dataset.layerRow
			? (timelineStore.itemById.get(row.dataset.layerRow)?.trackId ?? null)
			: null;
		if (!trackId && layerBarsEl) {
			const barsRect = layerBarsEl.getBoundingClientRect();
			if (event.clientY >= barsRect.top && event.clientY <= barsRect.bottom) {
				const rowIndex = Math.floor((event.clientY - barsRect.top) / ROW_H);
				trackId = layerEntries[rowIndex]?.item.trackId ?? null;
			}
		}
		let visualTrackId: string | null = null;
		let audioTrackId: string | null = null;
		let valid = false;
		if (trackId && source.kind === 'media') {
			const media = mediaPool.get(source.id);
			if (media) {
				valid = evaluateExactMediaPlacement({
					trackId,
					from: frame,
					durationInFrames: mediaDurationInFrames(media, fps),
					kind: mediaTimelineKind(media),
					tracks: timelineStore.tracks,
					items: timelineStore.items
				}).valid;
			}
		} else if (trackId) {
			const nested = sequenceStore.compositionById.get(source.id);
			if (nested) {
				const result = planExactSequencePlacement({
					composition: nested,
					preferredTrackId: trackId,
					from: frame,
					tracks: timelineStore.tracks,
					items: timelineStore.items
				});
				valid = result.valid;
				if (result.valid) {
					visualTrackId = result.placement.visualTrackId ?? null;
					audioTrackId = result.placement.audioTrackId ?? null;
				}
			}
		}
		if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'copy' : 'none';
		dropGhost = { frame, trackId, visualTrackId, audioTrackId, valid, source };
	}
	function handleDragLeave(): void {
		dropGhost = null;
	}
	function handleDrop(event: DragEvent): void {
		const ghost = dropGhost;
		dropGhost = null;
		if (!ghost?.valid || !ghost.trackId || !ghost.source) {
			status = m.video_editor_motion_track_locked();
			return;
		}
		event.preventDefault();
		try {
			let ids: string[];
			if (ghost.source.kind === 'media') {
				const media = mediaPool.get(ghost.source.id);
				if (!media) return;
				ids = [
					insertMediaAtFrame(media, ghost.frame, {
						exactTrackId: ghost.trackId,
						label: ghost.source.label
					})
				];
			} else {
				ids = nestSequenceOnExactTracks(ghost.source.id, ghost.frame, {
					visualTrackId: ghost.visualTrackId ?? undefined,
					audioTrackId: ghost.audioTrackId ?? undefined
				});
			}
			const selected = ids[0];
			if (selected) selectItem(selected, false, false);
			clearActiveMediaDrag();
			onedit();
			status = m.video_editor_motion_drop_media();
		} catch {
			status = m.video_editor_motion_track_locked();
		}
	}
	function handleLinkPick(itemId: string, property: string): void {
		if (
			linkPickSource &&
			linkPickSource.itemId === itemId &&
			linkPickSource.property === property
		) {
			linkPickSource = null;
			return;
		}
		linkPickSource = { itemId, property };
	}
	function handleLinkSelect(targetId: string, targetProp: string): void {
		if (!linkPickSource) return;
		if (
			!isDirectLinkableProperty(linkPickSource.property) ||
			!isDirectLinkableProperty(targetProp)
		) {
			status = m.video_editor_motion_parent_failed();
			linkPickSource = null;
			return;
		}
		const result = setDirectPropertyLink(linkPickSource.itemId, {
			type: 'link',
			targetProperty: linkPickSource.property,
			sourceItemId: targetId,
			sourceProperty: targetProp,
			enabled: true,
			timeOffsetFrames: 0
		});
		if (result.ok) {
			onedit();
		} else {
			status = m.video_editor_motion_parent_failed();
		}
		linkPickSource = null;
	}
	function handleLinkButton(itemId: string): void {
		if (!linkPickSource || linkPickSource.itemId === itemId) {
			handleLinkPick(itemId, 'x');
			return;
		}
		handleLinkSelect(itemId, 'x');
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
		snapTargets: ReturnType<typeof buildSnapTargets>;
		snapThreshold: number;
		snapEnabled: boolean;
	};
	let drag: DragState | null = $state(null);
	function isLocked(item: TimelineItem): boolean {
		return isTrackEffectivelyLocked(item.trackId, timelineStore.tracks);
	}
	function startBarPointerDown(item: TimelineItem, event: PointerEvent): void {
		if (event.button !== 0 || isLocked(item)) return;
		const current = event.currentTarget;
		if (!(current instanceof HTMLElement)) return;
		const barElement = current;
		const rect = barElement.getBoundingClientRect();
		const xInBar = event.clientX - rect.left;
		const w = rect.width;
		const edge = 8;
		let kind: DragState['kind'] = 'move';
		if (xInBar < edge) kind = 'trim-start';
		else if (xInBar > w - edge) kind = 'trim-end';
		selectItem(item.id, event.ctrlKey || event.metaKey, event.shiftKey);
		const before = captureSnapshot();
		pointerGestures?.cancel('superseded');
		drag = {
			kind,
			id: item.id,
			startX: event.clientX,
			originalFrom: item.from,
			originalDuration: item.durationInFrames,
			before,
			active: false,
			pointerId: event.pointerId,
			snapTargets: buildSnapTargets({
				items: timelineStore.items,
				tracks: timelineStore.tracks,
				transitions: composition?.transitions ?? [],
				markers: timelineStore.markers,
				currentFrame: timelineStore.currentFrame,
				durationInFrames: durationFrames,
				fps,
				zoomLevel: timelineStore.zoomLevel,
				excludeItemIds: [...selectedItemIds]
			}),
			snapThreshold: calculateAdaptiveSnapThreshold(timelineStore.zoomLevel, pxPerFrame),
			snapEnabled: timelineStore.snapEnabled
		};
		pointerGestures?.start({
			pointerId: event.pointerId,
			target: barElement,
			onMove: onBarPointerMove,
			onCommit: () => onBarPointerUp(false),
			onCancel: () => onBarPointerUp(true)
		});
		event.preventDefault();
	}
	function onBarPointerMove(event: PointerGestureEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const deltaPx = event.clientX - drag.startX;
		if (!drag.active && Math.abs(deltaPx) < 3) return;
		drag.active = true;
		const activeDrag = drag;
		const deltaFrames = Math.round(deltaPx / Math.max(0.001, pxPerFrame));
		const item = timelineStore.itemById.get(activeDrag.id);
		if (!item) return;
		if (activeDrag.kind === 'move') {
			const proposed = activeDrag.originalFrom + deltaFrames;
			const snap = activeDrag.snapEnabled
				? calculateMoveSnap(
						proposed,
						activeDrag.originalDuration,
						activeDrag.snapTargets,
						activeDrag.snapThreshold
					)
				: { snappedFrame: proposed, snapTarget: null };
			snapGuideFrame = snap.snapTarget ? snap.snappedFrame : null;
			const patchFrom = Math.max(0, snap.snappedFrame);
			// linked audio propagation: move companions together via planLinkedMoveGesture
			const anchorItem: TimelineItem = {
				...item,
				from: activeDrag.originalFrom,
				durationInFrames: activeDrag.originalDuration
			};
			const plan = planLinkedMoveGesture(
				anchorItem,
				patchFrom,
				timelineStore.items,
				selectedItemIds.has(anchorItem.id) ? [...selectedItemIds] : [anchorItem.id]
			);
			const locked = plan.some((u) => {
				const it = timelineStore.itemById.get(u.id);
				return it ? isTrackEffectivelyLocked(it.trackId, timelineStore.tracks) : false;
			});
			if (locked) {
				status = m.video_editor_motion_track_locked();
				return;
			}
			timelineStore._moveItems(plan);
		} else {
			const handle = activeDrag.kind === 'trim-start' ? 'start' : 'end';
			const originalEdge =
				handle === 'start'
					? activeDrag.originalFrom
					: activeDrag.originalFrom + activeDrag.originalDuration;
			const proposedEdge = originalEdge + deltaFrames;
			const snap = activeDrag.snapEnabled
				? calculateEdgeSnap(proposedEdge, activeDrag.snapTargets, activeDrag.snapThreshold)
				: { snappedFrame: proposedEdge, snapTarget: null };
			snapGuideFrame = snap.snapTarget ? snap.snappedFrame : null;
			const trimAnchor: TimelineItem = {
				...item,
				from: activeDrag.originalFrom,
				durationInFrames: activeDrag.originalDuration
			};
			const plan = planTrimGesture(
				trimAnchor,
				handle,
				snap.snappedFrame - originalEdge,
				timelineStore.items,
				timelineStore.fps,
				activeDrag.snapEnabled ? activeDrag.snapTargets : [],
				activeDrag.snapThreshold,
				composition?.transitions ?? []
			);
			timelineStore._updateItems([
				{ id: activeDrag.id, patch: plan.patch },
				...(plan.linkedPatches ?? [])
			]);
		}
	}
	function onBarPointerUp(cancelled: boolean): void {
		snapGuideFrame = null;
		if (!drag) return;
		const before = drag.before;
		const wasActive = drag.active;
		if (cancelled || !wasActive) {
			restoreSnapshot(before);
			drag = null;
			return;
		}
		const after = captureSnapshot();
		const changed = !snapshotsEqual(before, after);
		if (changed) {
			commandHistory.addUndoEntry(
				{ type: drag.kind === 'move' ? 'MOVE_ITEMS' : 'TRIM_ITEM' },
				before
			);
			onedit();
		}
		drag = null;
	}
	// reorder via pointer on layer rows
	let reorderDrag: {
		id: string;
		startY: number;
		before: ReturnType<typeof captureSnapshot>;
	} | null = $state(null);
	function startReorder(trackId: string, event: PointerEvent): void {
		if (event.button !== 0) return;
		event.preventDefault();
		const current = event.currentTarget;
		if (!(current instanceof HTMLElement)) return;
		const before = captureSnapshot();
		pointerGestures?.cancel('superseded');
		reorderDrag = { id: trackId, startY: event.clientY, before };
		const onMove = (e: PointerGestureEvent) => {
			if (!reorderDrag) return;
			const deltaY = e.clientY - reorderDrag.startY;
			if (Math.abs(deltaY) < 6) return;
			const rows = motionRows;
			const idx = rows.findIndex((r) =>
				isLayerRow(r) ? r.track?.id === trackId : r.track.id === trackId
			);
			const targetIdx = Math.max(0, Math.min(rows.length - 1, idx + Math.round(deltaY / ROW_H)));
			if (targetIdx === idx || targetIdx < 0) return;
			// update track orders atomically
			const trackOrder = timelineStore.tracks.toSorted((a, b) => a.order - b.order);
			const fromTrack = trackById.get(trackId);
			if (!fromTrack) return;
			const fromOrder = fromTrack.order;
			const toRow = rows[targetIdx];
			const toTrackId =
				toRow.kind === 'group' ? toRow.track.id : isLayerRow(toRow) ? toRow.track?.id : undefined;
			if (!toTrackId) return;
			const toOrder = trackById.get(toTrackId)?.order ?? fromOrder;
			const newTracks = timelineStore.tracks.map((t) => {
				if (t.id === trackId) return { ...t, order: toOrder };
				if (fromOrder < toOrder && t.order > fromOrder && t.order <= toOrder)
					return { ...t, order: t.order - 1 };
				if (fromOrder > toOrder && t.order < fromOrder && t.order >= toOrder)
					return { ...t, order: t.order + 1 };
				return t;
			});
			timelineStore._setTracks(newTracks);
			reorderDrag.startY = e.clientY;
		};
		pointerGestures?.start({
			pointerId: event.pointerId,
			target: current,
			onMove,
			onCommit: () => {
				if (!reorderDrag) return;
				const after = captureSnapshot();
				if (!snapshotsEqual(reorderDrag.before, after)) {
					commandHistory.addUndoEntry({ type: 'REORDER_TRACKS' }, reorderDrag.before);
					onedit();
				}
				reorderDrag = null;
			},
			onCancel: () => {
				if (reorderDrag) restoreSnapshot(reorderDrag.before);
				reorderDrag = null;
			}
		});
	}
	function handleKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented) return;
		if (editorShortcutTargetIsDisabled(event.target)) return;
		const bindings = keyboardShortcuts.bindings;
		const matches = (...ids: EditorShortcutId[]) =>
			ids.some((id) => eventMatchesShortcut(event, bindings[id]));
		if (handleKeyframeShortcut(event, matches)) return;
		if (
			event.key !== 'Escape' &&
			!(event.target instanceof HTMLElement && event.target.closest('[data-composition-shortcuts]'))
		)
			return;
		if (event.key === 'Escape') {
			let handled = false;
			if (pointerGestures?.activePointerId !== null) {
				pointerGestures.cancel('escape');
				handled = true;
			}
			if (previewFrame !== null) {
				cancelGhostScrub();
				handled = true;
			}
			if (drag) {
				restoreSnapshot(drag.before);
				drag = null;
				handled = true;
			}
			if (kfDrag) {
				kfDrag = null;
				handled = true;
			}
			if (textDrag?.before) {
				restoreSnapshot(textDrag.before);
				textDrag = null;
				handled = true;
			} else if (textDrag) {
				textDrag = null;
				handled = true;
			}
			if (reorderDrag) {
				restoreSnapshot(reorderDrag.before);
				reorderDrag = null;
				handled = true;
			}
			if (pendingParent) {
				restorePick();
				handled = true;
			}
			if (handled) {
				event.preventDefault();
				return;
			}
			clearSelection();
			return;
		}
		if (editorDeleteModeForEvent(event, bindings) && selectedItemIds.size > 0) {
			event.preventDefault();
			removeSelected();
			return;
		}
		if (matches('COPY') && selectedItemIds.size > 0) {
			event.preventDefault();
			copySelected();
			return;
		}
		if (matches('PASTE')) {
			event.preventDefault();
			pasteClipboard();
			return;
		}
		if (matches('COMPOSITION_DUPLICATE') && selectedItemIds.size > 0) {
			event.preventDefault();
			duplicateSelected();
			return;
		}
		if (matches('COMPOSITION_SELECT_ALL')) {
			event.preventDefault();
			selectedItemIds = new Set(visualLayerItems.map((i) => i.id));
			return;
		}
		if (matches('COMPOSITION_GROUP') && selectedItemIds.size > 1) {
			event.preventDefault();
			groupSelected();
			return;
		}
		const nudgeLeft = matches('COMPOSITION_NUDGE_LEFT', 'COMPOSITION_NUDGE_LEFT_FAST');
		const nudgeRight = matches('COMPOSITION_NUDGE_RIGHT', 'COMPOSITION_NUDGE_RIGHT_FAST');
		if (nudgeLeft || nudgeRight) {
			if (selectedItemIds.size === 0) return;
			event.preventDefault();
			const delta = nudgeLeft ? -1 : 1;
			const amount = matches('COMPOSITION_NUDGE_LEFT_FAST', 'COMPOSITION_NUDGE_RIGHT_FAST')
				? 10
				: 1;
			const before = captureSnapshot();
			let moved = false;
			const anchor = [...selectedItemIds]
				.map((id) => timelineStore.itemById.get(id))
				.find((item): item is TimelineItem => item !== undefined && !isLocked(item));
			if (anchor) {
				const plan = planLinkedMoveGesture(
					anchor,
					anchor.from + delta * amount,
					timelineStore.items,
					[...selectedItemIds]
				);
				const includesLockedItem = plan.some((update) => {
					const item = timelineStore.itemById.get(update.id);
					return item ? isTrackEffectivelyLocked(item.trackId, timelineStore.tracks) : false;
				});
				if (!includesLockedItem) {
					moved = plan.some((update) => {
						const original = timelineStore.itemById.get(update.id);
						return original?.from !== update.from;
					});
					if (moved) timelineStore._moveItems(plan);
				}
			}
			if (moved) {
				commandHistory.addUndoEntry({ type: 'MOVE_ITEMS' }, before);
				onedit();
			}
			return;
		}
		const reorderUp = matches('COMPOSITION_REORDER_UP');
		const reorderDown = matches('COMPOSITION_REORDER_DOWN');
		if ((reorderUp || reorderDown) && lastSelectedId) {
			event.preventDefault();
			const item = timelineStore.itemById.get(lastSelectedId);
			if (!item) return;
			const rows = motionRows;
			const idx = rows.findIndex((r) => isLayerRow(r) && r.item.id === lastSelectedId);
			const dir = reorderUp ? -1 : 1;
			const targetIdx = idx + dir;
			if (targetIdx < 0 || targetIdx >= rows.length) return;
			const before = captureSnapshot();
			const fromTrack = trackById.get(item.trackId);
			const toRow = rows[targetIdx];
			const toTrackId =
				toRow.kind === 'group' ? toRow.track.id : isLayerRow(toRow) ? toRow.track?.id : undefined;
			if (!fromTrack || !toTrackId) return;
			const toOrder = trackById.get(toTrackId)?.order ?? fromTrack.order;
			const newTracks = timelineStore.tracks.map((t) =>
				t.id === fromTrack.id
					? { ...t, order: toOrder }
					: t.order === toOrder
						? { ...t, order: fromTrack.order }
						: t
			);
			timelineStore._setTracks(newTracks);
			commandHistory.addUndoEntry({ type: 'REORDER_TRACKS' }, before);
			onedit();
		}
	}
	function handleTimelineKeydown(event: KeyboardEvent): void {
		handleKeydown(event);
		event.stopPropagation();
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
	function keyframeDisplayFrame(
		itemId: string,
		property: KeyframeProperty,
		keyframe: ReturnType<typeof editorKeyframes>[number]
	): number {
		return kfDrag?.itemId === itemId && kfDrag.property === property && kfDrag.id === keyframe.id
			? kfDrag.currentFrame
			: keyframe.frame;
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
		currentFrame: number;
		startX: number;
		pointerId: number;
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
		pointerId: number;
	} | null = $state(null);
	function isTextLocked(item: TimelineItem): boolean {
		return isTrackEffectivelyLocked(item.trackId, timelineStore.tracks);
	}
	function textSlotLabel(slot: TextMotionSlot): string {
		return textMotionSlotLabel(slot);
	}
	function textPresetLabel(presetId: string): string {
		if (isTextMotionPresetId(presetId)) return textMotionPresetLabel(presetId);
		return presetId;
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
		const maybeTarget = event.currentTarget;
		if (!(maybeTarget instanceof HTMLElement)) return;
		const target = maybeTarget;
		const bands = kind === 'offset' ? getTextMotionTimelineBands(item) : [];
		const maxOffset = kind === 'offset' ? getMaxOffsetFrames(band, bands) : 0;
		pointerGestures?.cancel('superseded');
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
		const onMove = (e: PointerGestureEvent) => {
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
		const onCommit = () => {
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
			if (textDrag?.before) restoreSnapshot(textDrag.before);
			textDrag = null;
		};
		pointerGestures?.start({
			pointerId: event.pointerId,
			target,
			onMove,
			onCommit,
			onCancel
		});
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
		const item = timelineStore.itemById.get(itemId);
		if (!item || isLocked(item)) return;
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();
		selectVectorKeyframe(itemId, property, frame);
		const keyframe = editorKeyframes(item, property).find((candidate) => candidate.frame === frame);
		if (!keyframe) return;
		pointerGestures?.cancel('superseded');
		kfDrag = {
			itemId,
			property,
			id: keyframe.id,
			startFrame: frame,
			currentFrame: frame,
			startX: event.clientX,
			pointerId: event.pointerId
		};
		const onMove = (e: PointerGestureEvent) => {
			if (!kfDrag || e.pointerId !== kfDrag.pointerId) return;
			const delta = Math.round((e.clientX - kfDrag.startX) / Math.max(0.001, pxPerFrame));
			kfDrag.currentFrame = Math.max(0, kfDrag.startFrame + delta);
		};
		const onCommit = () => {
			if (!kfDrag) return;
			const finished = kfDrag;
			kfDrag = null;
			if (finished.currentFrame !== finished.startFrame) {
				const item = timelineStore.itemById.get(finished.itemId);
				if (item) {
					const kfs = editorKeyframes(item, finished.property);
					const kf = kfs.find((candidate) => candidate.id === finished.id);
					if (kf) {
						const changed = updateKeyframes(finished.itemId, [
							{ ref: kf, frame: finished.currentFrame, value: kf.value }
						]);
						if (changed) onedit();
					}
				}
			}
		};
		pointerGestures?.start({
			pointerId: event.pointerId,
			target,
			onMove,
			onCommit,
			onCancel: () => {
				kfDrag = null;
			}
		});
	}
	// marquee selection
	let marquee: {
		x: number;
		y: number;
		w: number;
		h: number;
		startX: number;
		startY: number;
		active: boolean;
	} | null = $state(null);
	function startMarquee(event: PointerEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (
			target.closest('[data-layer-row]') ||
			target.closest('button') ||
			target.closest('[data-testid^="composition-bar"]')
		)
			return;
		if (event.button !== 0) return;
		const marqueeRoot = event.currentTarget;
		if (!(marqueeRoot instanceof HTMLElement)) return;
		const rect = marqueeRoot.getBoundingClientRect();
		const rowIndexById = new Map(visualLayerItems.map((item, index) => [item.id, index]));
		pointerGestures?.cancel('superseded');
		marquee = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
			w: 0,
			h: 0,
			startX: event.clientX,
			startY: event.clientY,
			active: false
		};
		const onMove = (e: PointerGestureEvent) => {
			if (!marquee) return;
			const dx = e.clientX - marquee.startX;
			const dy = e.clientY - marquee.startY;
			if (!marquee.active && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
			marquee.active = true;
			const curX = e.clientX - rect.left;
			const curY = e.clientY - rect.top;
			marquee.w = curX - marquee.x;
			marquee.h = curY - marquee.y;
			// select items whose bar overlaps marquee in timeline content
			const sel = new Set<string>();
			for (const row of layerEntries) {
				const item = row.item;
				const left = timelineX(item.from) - scrollLeft;
				const right = timelineX(item.from + item.durationInFrames) - scrollLeft;
				const top = 8 + (rowIndexById.get(item.id) ?? 0) * ROW_H;
				const barRect = { left, right, top, bottom: top + ROW_H - 12 };
				const mRect = {
					left: Math.min(marquee.x, marquee.x + marquee.w),
					right: Math.max(marquee.x, marquee.x + marquee.w),
					top: Math.min(marquee.y, marquee.y + marquee.h),
					bottom: Math.max(marquee.y, marquee.y + marquee.h)
				};
				if (
					barRect.right >= mRect.left &&
					barRect.left <= mRect.right &&
					barRect.bottom >= mRect.top &&
					barRect.top <= mRect.bottom
				)
					sel.add(item.id);
			}
			if (sel.size) selectedItemIds = sel;
		};
		pointerGestures?.start({
			pointerId: event.pointerId,
			target: marqueeRoot,
			onMove,
			onCommit: () => {
				marquee = null;
			},
			onCancel: () => {
				marquee = null;
			}
		});
	}
	// ghost scrub: separate previewFrame, commit on release, cancel on Escape/pointercancel
	let scrubActive = $state(false);
	function startScrub(event: PointerEvent): void {
		if (event.button !== 0) return;
		const eventTarget = event.target;
		if (eventTarget instanceof Element && eventTarget.closest('button')) return;
		event.stopPropagation();
		const scrubRoot = event.currentTarget;
		if (!(scrubRoot instanceof HTMLElement)) return;
		pointerGestures?.cancel('superseded');
		scrubActive = true;
		const rect = scrubRoot.getBoundingClientRect();
		const frame = Math.round(
			((event.clientX - rect.left) / Math.max(1, rect.width)) *
				(visibleRange.end - visibleRange.start) +
				visibleRange.start
		);
		handleGhostScrubMove(frame);
		const onMove = (e: PointerGestureEvent) => {
			const f = Math.round(
				((e.clientX - rect.left) / Math.max(1, rect.width)) *
					(visibleRange.end - visibleRange.start) +
					visibleRange.start
			);
			handleGhostScrubMove(f);
		};
		pointerGestures?.start({
			pointerId: event.pointerId,
			target: scrubRoot,
			onMove,
			onCommit: () => {
				commitGhostScrub();
				scrubActive = false;
			},
			onCancel: () => {
				cancelGhostScrub();
				scrubActive = false;
			}
		});
	}
	const rulerTicks = $derived.by(() => {
		const start = Math.floor(visibleRange.start);
		const end = Math.ceil(visibleRange.end);
		const target = Math.ceil(80 / pxPerFrame);
		const options = [1, 5, 10, 30, 60, 150, 300, 600, 1_800, 3_600];
		const step = options.find((option) => option >= target) ?? 3_600;
		const ticks: number[] = [];
		for (let frame = start - (start % step); frame <= end; frame += step)
			if (frame >= 0) ticks.push(frame);
		return ticks.slice(0, 128);
	});
	const regions = $derived(motionRegions());
	const inP = $derived(timelineStore.inPoint);
	const outP = $derived(timelineStore.outPoint);
	function startRangeHandleDrag(kind: 'in' | 'out', event: PointerEvent): void {
		if (event.button !== 0) return;
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return;
		const startValue = kind === 'in' ? timelineStore.inPoint : timelineStore.outPoint;
		if (startValue === null) return;
		event.preventDefault();
		const startX = event.clientX;
		const pixelsPerFrame = pxPerFrame;
		const before = captureSnapshot();
		pointerGestures?.cancel('superseded');
		pointerGestures?.start({
			pointerId: event.pointerId,
			target,
			onMove: (move) => {
				const deltaFrames = Math.round((move.clientX - startX) / pixelsPerFrame);
				if (kind === 'in') {
					const next = Math.max(
						0,
						Math.min(startValue + deltaFrames, (timelineStore.outPoint ?? durationFrames) - 1)
					);
					timelineStore._setInPoint(next);
					return;
				}
				const next = Math.max(
					(timelineStore.inPoint ?? 0) + 1,
					Math.min(startValue + deltaFrames, durationFrames)
				);
				timelineStore._setOutPoint(next);
			},
			onCommit: () => {
				if (snapshotsEqual(before, captureSnapshot())) return;
				commandHistory.addUndoEntry(
					{ type: kind === 'in' ? 'SET_IN_POINT' : 'SET_OUT_POINT' },
					before
				);
				onedit();
			},
			onCancel: () => restoreSnapshot(before)
		});
	}
	onMount(() => {
		const onSeqChange = () => {
			pointerGestures?.cancel('cancel');
			if (drag) {
				restoreSnapshot(drag.before);
				drag = null;
			}
			kfDrag = null;
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
		data-composition-shortcuts
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
	>
		<!-- Header: composition picker, new, generated layers, duration/fps, fit, trim -->
		<div class="composition-header">
			<div class="header-left">
				<label class="header-label" for="composition-picker"
					>{m.video_editor_composition_timeline_picker()}</label
				>
				<Select.Root
					type="single"
					value={composition.id}
					onValueChange={(value) => value && switchComposition(value)}
				>
					<Select.Trigger
						id="composition-picker"
						class="composition-picker"
						aria-label={m.video_editor_composition_timeline_picker()}
						data-testid="composition-picker"
					>
						<span class="truncate">{composition.name}</span>
					</Select.Trigger>
					<Select.Content>
						{#each compositions as comp (comp.id)}
							<Select.Item value={comp.id}>{comp.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					size="sm"
					variant="ghost"
					aria-label={m.video_editor_motion_create_composition()}
					onclick={() => {
						showNewDialog = true;
						newName = '';
						newFps = fps;
						newDuration = durationFrames;
					}}
					data-testid="composition-new"
				>
					<PlusIcon class="size-4" />
					{m.video_editor_motion_create_composition()}
				</Button>
			</div>
			<div class="header-center">
				<h2 class="composition-title">{composition.name}</h2>
				<span class="composition-meta" aria-label={m.video_editor_composition_timeline_meta()}>
					{composition.width}×{composition.height} ·
					<Input
						aria-label={m.video_editor_composition_timeline_fps()}
						class="meta-input"
						type="number"
						min="1"
						max="120"
						value={fps}
						onchange={(e) => {
							const v = Math.max(
								1,
								Math.min(120, Math.round(Number(e.currentTarget.value) || fps))
							);
							updateCompositionTiming({ fps: v }, 'UPDATE_COMPOSITION_FPS');
						}}
						data-testid="composition-fps"
					/>
					{m.video_editor_composition_timeline_fps_suffix()} ·
					<Input
						aria-label={m.video_editor_composition_timeline_duration()}
						class="meta-input"
						type="number"
						min="1"
						value={durationFrames}
						onchange={(e) => {
							const v = Math.max(1, Math.round(Number(e.currentTarget.value) || durationFrames));
							updateCompositionTiming({ durationInFrames: v }, 'UPDATE_COMPOSITION_DURATION');
						}}
						data-testid="composition-duration"
					/>
					{m.video_editor_composition_timeline_frames()}
				</span>
			</div>
			<div class="header-right">
				<div class="header-zoom">
					<label class="zoom-label" for="composition-zoom-slider"
						>{m.video_editor_composition_timeline_zoom()}</label
					>
					<div class="zoom-slider-wrap">
						<Slider
							id="composition-zoom-slider"
							value={[zoomSlider]}
							min={TIMELINE_ZOOM_MIN}
							max={TIMELINE_ZOOM_MAX}
							step={0.05}
							onValueChange={handleZoomChange}
							aria-label={m.video_editor_composition_timeline_zoom()}
						/>
					</div>
					<Button
						size="sm"
						variant="ghost"
						aria-label={m.video_editor_composition_timeline_fit()}
						onclick={handleFit}
						data-testid="composition-fit"
					>
						{m.video_editor_composition_timeline_fit()}
					</Button>
					{#if regions.hasActive}
						<Button
							size="sm"
							variant="ghost"
							aria-label={m.video_editor_composition_timeline_trim_active()}
							onclick={handleTrimToActive}
							data-testid="composition-trim-active"
						>
							{m.video_editor_composition_timeline_trim_active()}
						</Button>
					{/if}
				</div>
			</div>
		</div>
		<!-- Generated layers + media add -->
		<div class="composition-toolbar" aria-label={m.video_editor_composition_timeline_toolbar()}>
			<span class="toolbar-label">{m.video_editor_composition_timeline_add_layer()}</span>
			<Button
				size="sm"
				variant="outline"
				onclick={() => addGeneratedLayer('text')}
				data-testid="add-layer-text">{m.video_editor_motion_add_text()}</Button
			>
			<Button
				size="sm"
				variant="outline"
				onclick={() => addGeneratedLayer('solid')}
				data-testid="add-layer-solid">{m.video_editor_motion_add_solid()}</Button
			>
			<Button
				size="sm"
				variant="outline"
				onclick={() => addGeneratedLayer('gradient')}
				data-testid="add-layer-gradient">{m.video_editor_motion_add_gradient()}</Button
			>
			<Button
				size="sm"
				variant="outline"
				onclick={() => addGeneratedLayer('shape')}
				data-testid="add-layer-shape">{m.video_editor_motion_add_shape()}</Button
			>
			<Button
				size="sm"
				variant="outline"
				onclick={() => addGeneratedLayer('controller')}
				data-testid="add-layer-controller">{m.video_editor_motion_add_controller()}</Button
			>
			<label class="toolbar-search">
				<span class="sr-only">{m.video_editor_composition_timeline_filter()}</span>
				<Input
					class="filter-input"
					placeholder={m.video_editor_composition_timeline_filter_placeholder()}
					value={filterText}
					oninput={(e) => (filterText = (e.currentTarget as HTMLInputElement).value)}
					aria-label={m.video_editor_composition_timeline_filter()}
					data-testid="composition-filter"
				/>
			</label>
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
						onpointerdown={(event) => startRangeHandleDrag('in', event)}
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
						onpointerdown={(event) => startRangeHandleDrag('out', event)}
					></button>
				{/if}
				{#if !regions.hasActive}
					<span class="io-empty">{m.video_editor_composition_timeline_full_range()}</span>
				{/if}
			</div>
		</div>
		<div class="composition-body" data-testid="composition-body">
			<ContextMenu.Root>
				<ContextMenu.Trigger>
					{#snippet child({ props })}
						<div
							{...props}
							class="layer-sidebar"
							aria-label={m.video_editor_composition_timeline_layers()}
							bind:this={sidebarEl}
							oncontextmenucapture={prepareCompositionContextMenu}
							onscroll={handleSidebarScroll}
						>
							<div class="layer-sidebar-header">
								<span>{m.video_editor_composition_timeline_layer()}</span>
								<span class="col-parent">{m.video_editor_motion_parent_label()}</span>
								<span class="col-blend"><BlendIcon class="size-3" /></span>
								<span class="col-timing">{m.video_editor_composition_timeline_timing()}</span>
							</div>
							{#if sidebarWindow.beforeSize > 0}
								<div
									class="sidebar-virtual-spacer"
									style:height={`${sidebarWindow.beforeSize}px`}
									aria-hidden="true"
									data-testid="sidebar-virtual-before"
								></div>
							{/if}
							{#each visibleSidebarRows as row (row.kind === 'group' ? row.track.id : row.item.id)}
								{@const rowKey = motionRowKey(row)}
								{#if row.kind === 'group'}
									{@const isExpanded = !row.track.isCollapsed}
									{@const groupSelected = row.itemIds.some((id) => selectedItemIds.has(id))}
									<div
										class="group-row"
										use:measureSidebarRow={rowKey}
										data-group-row={row.track.id}
										data-testid={`group-row-${row.track.id}`}
									>
										<button
											type="button"
											class="group-header"
											class:selected={groupSelected}
											aria-pressed={groupSelected}
											aria-label={row.track.name}
											data-testid={`group-header-${row.track.id}`}
											ondblclick={() => renameStart(row.track.id, row.track.name)}
											onclick={() => {
												if (row.itemIds.length === 0) return;
												const allSelected = row.itemIds.every((id) => selectedItemIds.has(id));
												if (allSelected) {
													const next = new Set(selectedItemIds);
													for (const id of row.itemIds) next.delete(id);
													selectedItemIds = next;
												} else {
													const next = new Set(selectedItemIds);
													for (const id of row.itemIds) next.add(id);
													selectedItemIds = next;
												}
											}}
											onkeydown={openCompositionContextMenuFromKeyboard}
										>
											<span
												class="group-toggle"
												role="button"
												tabindex="0"
												aria-label={isExpanded
													? m.video_editor_composition_timeline_collapse()
													: m.video_editor_composition_timeline_expand()}
												onclick={(e) => {
													e.stopPropagation();
													toggleGroupCollapse(row.track.id);
												}}
												onkeydown={(e) => {
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														toggleGroupCollapse(row.track.id);
													}
												}}
											>
												{#if isExpanded}<ChevronDownIcon class="size-3" />{:else}<ChevronRightIcon
														class="size-3"
													/>{/if}
											</span>
											{#if editingNameId === row.track.id}
												<Input
													id="rename-{row.track.id}"
													class="rename-input"
													value={editingNameValue}
													oninput={(e) =>
														(editingNameValue = (e.currentTarget as HTMLInputElement).value)}
													onkeydown={(e) => {
														if (e.key === 'Enter') renameCommit();
														if (e.key === 'Escape') editingNameId = null;
													}}
													onblur={renameCommit}
													data-testid={`rename-group-${row.track.id}`}
													aria-label={m.video_editor_composition_timeline_rename()}
												/>
											{:else}
												<span class="group-name">{row.track.name}</span>
												<span class="group-span"
													>{row.itemIds.length
														? `${Math.min(...row.itemIds.map((id) => timelineStore.itemById.get(id)?.from ?? 0))}–${Math.max(...row.itemIds.map((id) => (timelineStore.itemById.get(id)?.from ?? 0) + (timelineStore.itemById.get(id)?.durationInFrames ?? 0)))}`
														: ''}</span
												>
											{/if}
										</button>
										<span class="group-actions">
											<Button
												size="icon"
												variant="ghost"
												aria-label={row.track.visible
													? m.video_editor_timeline_hide()
													: m.video_editor_timeline_show()}
												onclick={() => toggleTrackVisible(row.track.id)}
												data-testid={`group-visible-${row.track.id}`}
												class="icon-btn"
											>
												{#if row.track.visible}<EyeIcon class="size-3" />{:else}<EyeOffIcon
														class="size-3"
													/>{/if}
											</Button>
											<Button
												size="icon"
												variant="ghost"
												aria-label={row.track.locked
													? m.video_editor_timeline_unlock()
													: m.video_editor_timeline_lock()}
												onclick={() => toggleTrackLocked(row.track.id)}
												data-testid={`group-lock-${row.track.id}`}
												class="icon-btn"
											>
												{#if row.track.locked}<LockIcon class="size-3" />{:else}<UnlockIcon
														class="size-3"
													/>{/if}
											</Button>
											<Button
												size="icon"
												variant="ghost"
												aria-label={row.track.muted
													? m.video_editor_timeline_unmute()
													: m.video_editor_timeline_mute()}
												onclick={() => toggleTrackMuted(row.track.id)}
												data-testid={`group-mute-${row.track.id}`}
												class="icon-btn"
											>
												{#if row.track.muted}<VolumeOffIcon class="size-3" />{:else}<VolumeIcon
														class="size-3"
													/>{/if}
											</Button>
											<Button
												size="icon"
												variant="ghost"
												aria-label={m.video_editor_composition_timeline_ungroup()}
												onclick={() => ungroupTrack(row.track.id)}
												data-testid={`group-ungroup-${row.track.id}`}
												class="icon-btn"
											>
												<UngroupIcon class="size-3" />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												aria-label={m.video_editor_composition_timeline_delete_group()}
												onclick={() => deleteGroupAndContents(row.track.id, row.itemIds)}
												data-testid={`group-delete-${row.track.id}`}
												class="icon-btn"
											>
												<TrashIcon class="size-3" />
											</Button>
										</span>
										<span
											class="drag-handle"
											aria-label={m.video_editor_composition_timeline_reorder()}
											role="button"
											tabindex="0"
											onpointerdown={(e) => startReorder(row.track.id, e)}
											onkeydown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													e.preventDefault(); /* keyboard reorder via Alt+Arrow */
												}
											}}>≡</span
										>
									</div>
								{:else}
									{@const item = row.item}
									{@const track = row.track}
									{@const isSelected = selectedItemIds.has(item.id)}
									{@const parentId = item.transformParent?.parentItemId}
									{@const expanded = expandedLayerIds.has(item.id)}
									{@const filtered = filterText.trim()
										? item.label.toLowerCase().includes(filterText.toLowerCase())
										: true}
									{#if filtered}
										{@const vRows = vectorRowsFor(item)}
										{@const textBands =
											item.type === 'text' ? getTextMotionTimelineBands(item) : []}
										<div
											class="layer-row-wrap"
											use:measureSidebarRow={rowKey}
											data-row-id={item.id}
											data-layer-row={item.id}
										>
											<div
												class="layer-row"
												class:selected={isSelected}
												class:pickTarget={pickTarget === item.id}
												class:controller={item.type === 'controller'}
												data-testid={`composition-layer-${item.id}`}
												role="button"
												tabindex="0"
												aria-pressed={isSelected}
												aria-label={itemLabel(item)}
												ondblclick={() => renameStart(item.id, itemLabel(item))}
												onclick={(e) => selectItem(item.id, e.ctrlKey || e.metaKey, e.shiftKey)}
												onkeydown={(e) => {
													openCompositionContextMenuFromKeyboard(e);
													if (e.defaultPrevented) return;
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														selectItem(item.id, e.ctrlKey || e.metaKey, e.shiftKey);
													}
												}}
												onpointerdown={(e) => {
													if (e.button === 2) return;
													if (e.ctrlKey || e.metaKey) return;
												}}
											>
												<button
													type="button"
													class="layer-expand"
													aria-label={expanded
														? m.video_editor_composition_timeline_collapse()
														: m.video_editor_composition_timeline_expand()}
													aria-pressed={expanded}
													tabindex="0"
													onclick={(e) => {
														e.stopPropagation();
														toggleLayerExpanded(item.id);
													}}
													data-testid={`layer-expand-${item.id}`}
												>
													{#if expanded}<ChevronDownIcon class="size-3" />{:else}<ChevronRightIcon
															class="size-3"
														/>{/if}
												</button>
												{#if editingNameId === item.id}
													<Input
														id="rename-{item.id}"
														class="rename-input"
														value={editingNameValue}
														oninput={(e) =>
															(editingNameValue = (e.currentTarget as HTMLInputElement).value)}
														onkeydown={(e) => {
															if (e.key === 'Enter') renameCommit();
															if (e.key === 'Escape') editingNameId = null;
														}}
														onblur={renameCommit}
														data-testid={`rename-layer-${item.id}`}
														aria-label={m.video_editor_composition_timeline_rename()}
													/>
												{:else}
													<span class="layer-name" title={itemLabel(item)}>{itemLabel(item)}</span>
												{/if}
												<span class="layer-type-badge" aria-label={item.type}
													>{item.type === 'text'
														? 'T'
														: item.type === 'shape'
															? 'S'
															: item.type === 'controller'
																? 'C'
																: item.type[0]?.toUpperCase()}</span
												>
												<span class="layer-actions">
													<Button
														size="icon"
														variant="ghost"
														aria-label={(
															track
																? effectiveTrackState(track, timelineStore.tracks).visible === false
																: false
														)
															? m.video_editor_timeline_show()
															: m.video_editor_timeline_hide()}
														onclick={(e) => {
															e.stopPropagation();
															if (track) toggleTrackVisible(track.id);
														}}
														data-testid={`layer-visible-${item.id}`}
														class="icon-btn"
													>
														{#if track && effectiveTrackState(track, timelineStore.tracks).visible === false}<EyeOffIcon
																class="size-3"
															/>{:else}<EyeIcon class="size-3" />{/if}
													</Button>
													<Button
														size="icon"
														variant="ghost"
														aria-label={(
															track
																? effectiveTrackState(track, timelineStore.tracks).locked
																: false
														)
															? m.video_editor_timeline_unlock()
															: m.video_editor_timeline_lock()}
														onclick={(e) => {
															e.stopPropagation();
															if (track) toggleTrackLocked(track.id);
														}}
														data-testid={`layer-lock-${item.id}`}
														class="icon-btn"
													>
														{#if track && effectiveTrackState(track, timelineStore.tracks).locked}<LockIcon
																class="size-3"
															/>{:else}<UnlockIcon class="size-3" />{/if}
													</Button>
													<Button
														size="icon"
														variant="ghost"
														aria-label={(
															track ? effectiveTrackState(track, timelineStore.tracks).muted : false
														)
															? m.video_editor_timeline_unmute()
															: m.video_editor_timeline_mute()}
														onclick={(e) => {
															e.stopPropagation();
															if (track) toggleTrackMuted(track.id);
														}}
														data-testid={`layer-mute-${item.id}`}
														class="icon-btn"
													>
														{#if track && effectiveTrackState(track, timelineStore.tracks).muted}<VolumeOffIcon
																class="size-3"
															/>{:else}<VolumeIcon class="size-3" />{/if}
													</Button>
													<Button
														size="icon"
														variant="ghost"
														aria-label={(
															track ? effectiveTrackState(track, timelineStore.tracks).solo : false
														)
															? m.video_editor_timeline_unsolo()
															: m.video_editor_timeline_solo()}
														onclick={(e) => {
															e.stopPropagation();
															if (track) toggleTrackSolo(track.id);
														}}
														data-testid={`layer-solo-${item.id}`}
														class="icon-btn"
													>
														<span class="solo-label">S</span>
													</Button>
												</span>
											</div>
											<div class="layer-meta-row">
												<div class="parent-cell">
													{#if parentId}
														{@const parent = timelineStore.itemById.get(parentId)}
														<span class="parent-name"
															>{parent ? parent.label : parentId.slice(0, 6)}</span
														>
														<Button
															size="icon"
															variant="ghost"
															aria-label={m.video_editor_motion_parent_none()}
															onclick={() => detachParent(item.id)}
															data-testid={`parent-detach-${item.id}`}
															class="icon-btn"><UnlinkIcon class="size-3" /></Button
														>
													{:else}
														<Button
															size="icon"
															variant="ghost"
															aria-label={m.video_editor_composition_timeline_link_parent({
																name: itemLabel(item)
															})}
															data-testid={`parent-pick-${item.id}`}
															onpointerdown={(event) => beginParentPick(item.id, event)}
															class="icon-btn"><Link2Icon class="size-3" /></Button
														>
													{/if}
												</div>
												<label class="blend-cell">
													<span class="sr-only"
														>{m.video_editor_composition_timeline_blend_mode()}</span
													>
													<Select.Root
														type="single"
														value={item.blendMode ?? 'normal'}
														onValueChange={(value) => setBlendMode(item.id, value)}
														disabled={isLocked(item)}
													>
														<Select.Trigger
															aria-label={m.video_editor_composition_timeline_blend_mode()}
															data-testid={`blend-${item.id}`}
															class="blend-select"
														>
															<span class="truncate"
																>{blendModeLabels[item.blendMode ?? 'normal']}</span
															>
														</Select.Trigger>
														<Select.Content>
															{#each BLEND_MODE_GROUPS as group (group.label)}
																<Select.Group>
																	<Select.GroupHeading
																		>{blendGroupLabels[group.label] ??
																			group.label}</Select.GroupHeading
																	>
																	{#each group.modes as mode (mode)}
																		<Select.Item value={mode}>{blendModeLabels[mode]}</Select.Item>
																	{/each}
																</Select.Group>
															{/each}
														</Select.Content>
													</Select.Root>
												</label>
												<span class="timing-cell" data-testid={`timing-${item.id}`}>
													<Input
														class="timing-input"
														type="number"
														min="0"
														value={item.from}
														aria-label="{itemLabel(item)} in"
														disabled={isLocked(item)}
														onchange={(e) =>
															editItemTiming(
																item,
																'in',
																(e.currentTarget as HTMLInputElement).value
															)}
														data-testid={`timing-in-${item.id}`}
													/>
													<span>–</span>
													<Input
														class="timing-input"
														type="number"
														min="1"
														value={item.from + item.durationInFrames}
														aria-label="{itemLabel(item)} out"
														disabled={isLocked(item)}
														onchange={(e) =>
															editItemTiming(
																item,
																'out',
																(e.currentTarget as HTMLInputElement).value
															)}
														data-testid={`timing-out-${item.id}`}
													/>
												</span>
												<span
													class="drag-handle"
													aria-label={m.video_editor_composition_timeline_reorder()}
													role="button"
													tabindex="0"
													onpointerdown={(e) => startReorder(track?.id ?? item.trackId, e)}>≡</span
												>
											</div>
											{#each vRows as vRow (vRow.property)}
												<div
													class="vector-row"
													data-vector-row={`${item.id}:${vRow.property}`}
													data-testid={`vector-row-${item.id}-${vRow.property}`}
												>
													<span class="vector-label">{vectorLabel(vRow.property)}</span>
													<span class="vector-unit">{vRow.unit}</span>
													<div class="vector-keys" aria-hidden="true"></div>
												</div>
											{/each}
											{#each textBands as band (band.slot)}
												<div
													class="text-band-row"
													data-testid={`text-band-row-${item.id}-${band.slot}`}
												>
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
											{#if expanded}
												<div
													class="inline-props"
													role="group"
													aria-label={m.video_editor_keyframe_view()}
													data-testid={`inline-props-${item.id}`}
													data-keyframe-shortcuts={item.id}
													onpointerenter={() => (keyframeShortcutPointerItemId = item.id)}
													onpointerleave={() => {
														if (keyframeShortcutPointerItemId === item.id) {
															keyframeShortcutPointerItemId = null;
														}
													}}
												>
													<div class="inline-props-toolbar">
														<span class="inline-label"
															>{m.video_editor_composition_timeline_inline_props()}</span
														>
														<div
															class="dopesheet-mode-row"
															data-testid={`dopesheet-mode-${item.id}`}
														>
															<button
																type="button"
																class="mode-btn"
																class:active={keyframeEditorMode(item.id) === 'dopesheet'}
																aria-pressed={keyframeEditorMode(item.id) === 'dopesheet'}
																onclick={() => setKeyframeEditorMode(item.id, 'dopesheet')}
																data-testid={`mode-lanes-${item.id}`}
																>{m.video_editor_keyframe_view_dopesheet()}</button
															>
															<button
																type="button"
																class="mode-btn"
																class:active={keyframeEditorMode(item.id) === 'graph'}
																aria-pressed={keyframeEditorMode(item.id) === 'graph'}
																onclick={() => setKeyframeEditorMode(item.id, 'graph')}
																data-testid={`mode-graph-${item.id}`}
																>{m.video_editor_composition_timeline_graph()}</button
															>
															<button
																type="button"
																class="mode-btn"
																class:active={keyframeEditorMode(item.id) === 'split'}
																aria-pressed={keyframeEditorMode(item.id) === 'split'}
																onclick={() => setKeyframeEditorMode(item.id, 'split')}
																data-testid={`mode-split-${item.id}`}
																>{m.video_editor_keyframe_view_split()}</button
															>
															<button
																type="button"
																class="mode-btn"
																class:active={autoKeyframeStore.isEnabled(
																	item.id,
																	activeKeyframeProperty(item)
																)}
																aria-pressed={autoKeyframeStore.isEnabled(
																	item.id,
																	activeKeyframeProperty(item)
																)}
																aria-label={m.video_editor_property_auto_key({
																	property: activeKeyframeProperty(item)
																})}
																onclick={() =>
																	autoKeyframeStore.toggle(item.id, activeKeyframeProperty(item))}
																>A</button
															>
															<div class="easing-picker" data-testid={`easing-picker-${item.id}`}>
																<span>{m.video_editor_keyframe_easing()}</span>
																<Select.Root
																	type="single"
																	value={selectedEasing}
																	onValueChange={(v) => {
																		if (!isEasingType(v)) return;
																		selectedEasing = v;
																		const sel = keyframeSelectionStore.forItem(item.id);
																		if (sel.size === 0) return;
																		const props = getAnimatablePropertiesForItem(item);
																		const updates: Array<{
																			property: KeyframeProperty;
																			frame: number;
																			easing: EasingType;
																		}> = [];
																		for (const prop of props) {
																			for (const kf of editorKeyframes(item, prop)) {
																				if (!sel.has(keyframeIdentity(kf))) continue;
																				updates.push({
																					property: prop,
																					frame: kf.frame,
																					easing: v
																				});
																			}
																		}
																		if (setKeyframeEasings(item.id, updates)) onedit();
																	}}
																>
																	<Select.Trigger
																		class="h-7 min-w-24 px-2"
																		aria-label={m.video_editor_keyframe_easing()}
																		data-testid={`easing-select-${item.id}`}
																	>
																		<span class="truncate">
																			{selectedEasing === 'linear'
																				? m.video_editor_keyframe_easing_linear()
																				: selectedEasing === 'ease-in'
																					? m.video_editor_keyframe_easing_in()
																					: selectedEasing === 'ease-out'
																						? m.video_editor_keyframe_easing_out()
																						: m.video_editor_keyframe_easing_in_out()}
																		</span>
																	</Select.Trigger>
																	<Select.Content>
																		<Select.Item value="linear"
																			>{m.video_editor_keyframe_easing_linear()}</Select.Item
																		>
																		<Select.Item value="ease-in"
																			>{m.video_editor_keyframe_easing_in()}</Select.Item
																		>
																		<Select.Item value="ease-out"
																			>{m.video_editor_keyframe_easing_out()}</Select.Item
																		>
																		<Select.Item value="ease-in-out"
																			>{m.video_editor_keyframe_easing_in_out()}</Select.Item
																		>
																	</Select.Content>
																</Select.Root>
															</div>
															<button
																type="button"
																class="retime-btn"
																aria-label={m.video_editor_composition_timeline_retime()}
																title={m.video_editor_composition_timeline_retime_hint()}
																onclick={() => {
																	const sel = new Set(keyframeSelectionStore.forItem(item.id));
																	if (sel.size < 2) return;
																	const props = getAnimatablePropertiesForItem(item);
																	const selected: {
																		ref: ReturnType<typeof editorKeyframes>[number];
																		prop: KeyframeProperty;
																	}[] = [];
																	for (const prop of props)
																		for (const kf of editorKeyframes(item, prop))
																			if (sel.has(keyframeIdentity(kf)))
																				selected.push({ ref: kf, prop });
																	if (selected.length < 2) return;
																	const min = Math.min(...selected.map((s) => s.ref.frame));
																	const max = Math.max(...selected.map((s) => s.ref.frame));
																	const span = max - min || 1;
																	const factor = 0.9;
																	const edits: Parameters<typeof updateKeyframes>[1][number][] = [];
																	for (const s of selected) {
																		const t = (s.ref.frame - min) / span;
																		const newFrame = Math.round(min + t * span * factor);
																		if (newFrame !== s.ref.frame) {
																			edits.push({
																				ref: s.ref,
																				frame: newFrame,
																				value: s.ref.value
																			});
																		}
																	}
																	if (updateKeyframes(item.id, edits)) onedit();
																}}
																data-testid={`retime-batch-${item.id}`}
																>{m.video_editor_composition_timeline_retime()}</button
															>
														</div>
													</div>
													<div class="inline-props-views">
														{#if keyframeEditorMode(item.id) !== 'graph'}
															<KeyframeDopesheet
																{item}
																availableProperties={getAnimatablePropertiesForItem(item)}
																currentFrame={previewFrame ?? timelineStore.currentFrame}
																pixelsPerFrame={pxPerFrame}
																{timelineWidth}
																{timelineX}
																onscrub={seekTo}
																onactiveproperty={(property) =>
																	setActiveKeyframeProperty(item.id, property)}
																{onedit}
															/>
														{/if}
														{#if keyframeEditorMode(item.id) !== 'dopesheet'}
															<KeyframeValueGraph
																{item}
																property={activeKeyframeProperty(item)}
																currentFrame={previewFrame ?? timelineStore.currentFrame}
																onscrub={seekTo}
																{onedit}
																fitRequest={keyframeGraphFitRequest}
															/>
														{/if}
													</div>
												</div>
												{#if item.motionLayers && item.motionLayers.length > 0}
													<div class="motion-layer-bands" data-testid={`motion-layers-${item.id}`}>
														{#each item.motionLayers as layer (layer.id)}
															<button
																type="button"
																class="motion-layer-band"
																style="left:{timelineX(item.from)}px; width:{Math.max(
																	8,
																	item.durationInFrames * pxPerFrame
																)}px"
																data-testid={`motion-layer-${item.id}-${layer.id}`}
																aria-label={layer.name ?? layer.presetId ?? 'layer'}
																onclick={() => {
																	if (removeMotionLayerFromItems([item.id], layer.id) > 0) onedit();
																}}
															>
																<span class="band-label"
																	>{layer.name ?? layer.presetId ?? 'layer'}</span
																>
															</button>
														{/each}
													</div>
												{/if}
												{#if item.motionModifiers && item.motionModifiers.length > 0}
													<div class="modifier-bands" data-testid={`motion-modifiers-${item.id}`}>
														{#each item.motionModifiers as mod (mod.type)}
															<button
																type="button"
																class="modifier-band"
																style="left:{timelineX(item.from)}px; width:{Math.max(
																	8,
																	item.durationInFrames * pxPerFrame
																)}px"
																data-testid={`modifier-${item.id}-${mod.type}`}
																aria-label={mod.type}
																onclick={() => {
																	if (removeMotionModifierFromItems([item.id], mod.type) > 0)
																		onedit();
																}}
															>
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
														<span class="band-label"
															>{item.maskType ?? 'mask'}
															{item.maskFeather ? `feather ${item.maskFeather}` : ''}</span
														>
													</div>
												{/if}
												<div class="link-pick-row" data-testid={`link-pick-${item.id}`}>
													<button
														type="button"
														class="link-pick-btn"
														aria-pressed={linkPickSource?.itemId === item.id}
														aria-label={m.video_editor_expression_pick_link()}
														onclick={() => handleLinkButton(item.id)}
														data-testid={`link-pick-btn-${item.id}`}
													>
														<Link2Icon class="size-3" />
														{linkPickSource
															? m.video_editor_expression_source_layer()
															: m.video_editor_expression_link_title()}
													</button>
													{#if item.propertyLinks && item.propertyLinks.length > 0}
														{#each item.propertyLinks as link (link.targetProperty)}
															<span
																class="link-badge"
																data-testid={`link-badge-${item.id}-${link.targetProperty}`}
																>{link.targetProperty}→{link.sourceItemId}</span
															>
															<button
																type="button"
																class="icon-btn"
																aria-label={m.video_editor_expression_remove_link()}
																onclick={() => {
																	if (removeDirectPropertyLink(item.id, link.targetProperty))
																		onedit();
																}}
																data-testid={`link-remove-${item.id}-${link.targetProperty}`}
																><UnlinkIcon class="size-3" /></button
															>
														{/each}
													{/if}
												</div>
												{#if publishedControls(item).length > 0}
													<div
														class="published-controls"
														data-testid={`published-controls-${item.id}`}
													>
														<span class="band-label">{m.video_editor_motion_overrides_title()}</span
														>
														{#each publishedControls(item) as control (control.id)}
															<label class="control-row"
																><span>{control.name}</span><Input
																	type={control.kind === 'color' ? 'color' : 'text'}
																	value={compositionControlValue(item, control)}
																	placeholder={control.defaultValue}
																	onchange={(e) => {
																		setCompositionControlValue(
																			item,
																			control,
																			e.currentTarget.value
																		);
																	}}
																	data-testid={`control-override-${item.id}-${control.id}`}
																/></label
															>
														{/each}
													</div>
												{/if}
											{/if}
										</div>
									{/if}
								{/if}
							{/each}
							{#if sidebarWindow.afterSize > 0}
								<div
									class="sidebar-virtual-spacer"
									style:height={`${sidebarWindow.afterSize}px`}
									aria-hidden="true"
									data-testid="sidebar-virtual-after"
								></div>
							{/if}
							{#if motionRows.length === 0}
								<div class="empty-layers" data-testid="composition-empty-layers">
									<p>{m.video_editor_composition_timeline_empty()}</p>
									<div class="empty-actions">
										<Button
											size="sm"
											onclick={() => addGeneratedLayer('text')}
											data-testid="empty-add-text">{m.video_editor_motion_add_text()}</Button
										>
										<Button
											size="sm"
											variant="outline"
											onclick={() => addGeneratedLayer('solid')}
											data-testid="empty-add-solid">{m.video_editor_motion_add_solid()}</Button
										>
									</div>
								</div>
							{/if}
						</div>
					{/snippet}
				</ContextMenu.Trigger>
				<ContextMenu.Content class="video-editor-theme w-56">
					{#if compositionContextTarget?.kind === 'group' && contextGroup}
						<ContextMenu.Item onclick={() => renameStart(contextGroup.id, contextGroup.name)}>
							{m.video_editor_composition_timeline_rename()}
						</ContextMenu.Item>
						<ContextMenu.Item onclick={() => ungroupTrack(contextGroup.id)}>
							{m.video_editor_composition_timeline_ungroup()}
						</ContextMenu.Item>
					{:else if compositionContextTarget?.kind === 'layer' && contextLayer}
						<ContextMenu.Item onclick={() => renameStart(contextLayer.id, itemLabel(contextLayer))}>
							{m.video_editor_composition_timeline_rename()}
						</ContextMenu.Item>
						<ContextMenu.Item disabled={selectedItemIds.size < 2} onclick={groupSelected}>
							{m.video_editor_composition_timeline_group()}
						</ContextMenu.Item>
					{/if}
					{#if compositionContextTarget}
						<ContextMenu.Separator />
						<ContextMenu.Item disabled={selectedItemIds.size === 0} onclick={duplicateSelected}>
							{m.video_editor_composition_timeline_duplicate()}
						</ContextMenu.Item>
						<ContextMenu.Item disabled={selectedItemIds.size === 0} onclick={copySelected}>
							{m.video_editor_composition_timeline_copy()}
						</ContextMenu.Item>
						<ContextMenu.Item disabled={!clipboard?.length} onclick={pasteClipboard}>
							{m.video_editor_composition_timeline_paste()}
						</ContextMenu.Item>
						<ContextMenu.Separator />
						{#if compositionContextTarget.kind === 'group'}
							<ContextMenu.Item
								variant="destructive"
								onclick={() =>
									deleteGroupAndContents(
										compositionContextTarget.trackId,
										compositionContextTarget.itemIds
									)}
							>
								{m.video_editor_composition_timeline_delete_group()}
							</ContextMenu.Item>
						{:else}
							<ContextMenu.Item variant="destructive" onclick={removeSelected}>
								{m.video_editor_composition_timeline_delete()}
							</ContextMenu.Item>
						{/if}
					{/if}
				</ContextMenu.Content>
			</ContextMenu.Root>
			<div
				class="timeline-content"
				bind:this={scrollEl}
				onscroll={handleScroll}
				onwheel={handleWheel}
				onclick={handleTimelineClick}
				onpointerdown={startMarquee}
				role="grid"
				tabindex="0"
				onkeydown={handleTimelineKeydown}
				aria-label={m.video_editor_composition_timeline_layers()}
				data-testid="composition-scroll"
			>
				<div
					class="timeline-inner"
					style="width:{timelineWidth}px; height:{Math.max(
						240,
						layerEntries.length * ROW_H + 120
					)}px"
				>
					<div
						class="composition-ruler"
						role="group"
						aria-label={m.video_editor_composition_timeline_ruler()}
						onpointerdown={startScrub}
						data-testid="composition-ruler"
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
						{#if previewFrame !== null}
							<div
								class="ruler-playhead ghost"
								style="left:{timelineX(previewFrame)}px"
								data-testid="composition-playhead-ghost"
								aria-hidden="true"
							></div>
						{/if}
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
						bind:this={layerBarsEl}
						data-testid="composition-layer-bars"
						style="height:{Math.max(200, layerEntries.length * ROW_H)}px"
					>
						{#each visibleLayerEntries as entry (entry.row.item.id)}
							{@const row = entry.row}
							{@const idx = entry.index}
							{@const item = row.item}
							{@const isSelected = selectedItemIds.has(item.id)}
							{@const vRows = vectorRowsFor(item)}
							{@const textBands = item.type === 'text' ? getTextMotionTimelineBands(item) : []}
							<button
								type="button"
								class="layer-bar"
								class:selected={isSelected}
								style="left:{timelineX(item.from)}px; top:{8 + idx * ROW_H}px; width:{Math.max(
									8,
									item.durationInFrames * pxPerFrame
								)}px; height:{ROW_H - 12}px"
								data-testid={`composition-bar-${item.id}`}
								aria-label={itemLabel(item)}
								aria-pressed={isSelected}
								onpointerdown={(event) => startBarPointerDown(item, event)}
								onclick={(event) => {
									event.stopPropagation();
									selectItem(item.id, event.ctrlKey || event.metaKey, event.shiftKey);
								}}
								ondblclick={() => {
									const mid = item.from + Math.floor(item.durationInFrames / 2);
									seekTo(mid);
								}}
							>
								<span class="bar-label">{itemLabel(item)}</span>
							</button>
							{#each vRows as vRow, vIdx (vRow.property)}
								<div
									class="vector-lane"
									style="top:{8 + idx * ROW_H + ROW_H + vIdx * VECTOR_H}px; height:{VECTOR_H}px"
									data-testid={`vector-lane-${item.id}-${vRow.property}`}
								>
									{#each keyframesForVector(item, vRow.primary) as kf (keyframeIdentity(kf))}
										<button
											type="button"
											class="vector-key"
											class:selected={keyframeSelectionStore
												.forItem(item.id)
												.has(keyframeIdentity(kf))}
											style="left:{timelineX(
												item.from + keyframeDisplayFrame(item.id, vRow.primary, kf)
											)}px"
											aria-label={`${vectorLabel(vRow.property)} ${keyframeDisplayFrame(item.id, vRow.primary, kf)}`}
											data-testid={`vector-key-${item.id}-${vRow.property}-${kf.frame}`}
											onclick={(e) => {
												e.stopPropagation();
												selectVectorKeyframe(item.id, vRow.primary, kf.frame);
											}}
											onpointerdown={(e) => startKeyframeDrag(item.id, vRow.primary, kf.frame, e)}
										></button>
									{/each}
									{#each keyframesForVector(item, vRow.secondary) as kf (keyframeIdentity(kf))}
										<button
											type="button"
											class="vector-key vector-key-secondary"
											style="left:{timelineX(
												item.from + keyframeDisplayFrame(item.id, vRow.secondary, kf)
											)}px"
											aria-label={`${vectorLabel(vRow.property)} ${keyframeDisplayFrame(item.id, vRow.secondary, kf)} y`}
											data-testid={`vector-key-${item.id}-${vRow.property}-y-${kf.frame}`}
											onclick={(e) => {
												e.stopPropagation();
												selectVectorKeyframe(item.id, vRow.secondary, kf.frame);
											}}
											onpointerdown={(e) => startKeyframeDrag(item.id, vRow.secondary, kf.frame, e)}
										></button>
									{/each}
								</div>
							{/each}
							{#each textBands as band, bIdx (band.slot)}
								<div
									class="text-band-lane"
									style="top:{8 +
										idx * ROW_H +
										ROW_H +
										vRows.length * VECTOR_H +
										bIdx * TEXT_BAND_H}px; height:{TEXT_BAND_H}px"
									data-testid={`text-lane-${item.id}-${band.slot}`}
								>
									<button
										type="button"
										class="text-band"
										class:locked={isTextLocked(item)}
										style="left:{timelineX(band.fromFrame)}px; width:{Math.max(
											8,
											(band.toFrame - band.fromFrame) * pxPerFrame
										)}px"
										data-testid={`text-band-${item.id}-${band.slot}`}
										aria-label={`${band.slot} ${band.presetId} ${band.durationFrames}f`}
										onpointerdown={(e) => startTextOffsetDrag(item, band, e)}
									>
										<span class="text-band-slot">{textSlotLabel(band.slot)}</span>
										<span class="text-band-preset">{textPresetLabel(band.presetId)}</span>
									</button>
									<button
										type="button"
										class="text-band-handle"
										class:disabled={isTextLocked(item)}
										style="left:{band.slot === 'out'
											? timelineX(band.fromFrame) - 4
											: timelineX(band.toFrame) - 4}px"
										data-testid={`text-band-handle-${item.id}-${band.slot}`}
										aria-label={`${textSlotLabel(band.slot)} ${m.video_editor_composition_timeline_text_duration_handle()}`}
										onpointerdown={(e) => startTextDurationDrag(item, band, e)}
									></button>
								</div>
							{/each}
						{/each}
						<div
							class="bars-playhead"
							style="left:{timelineX(timelineStore.currentFrame)}px"
							data-testid="composition-bars-playhead"
						></div>
						{#if previewFrame !== null}
							<div
								class="bars-playhead ghost"
								style="left:{timelineX(previewFrame)}px"
								data-testid="composition-bars-playhead-ghost"
							></div>
						{/if}
						{#if marquee && marquee.active}
							<div
								class="marquee"
								style="left:{Math.min(marquee.x, marquee.x + marquee.w)}px; top:{Math.min(
									marquee.y,
									marquee.y + marquee.h
								)}px; width:{Math.abs(marquee.w)}px; height:{Math.abs(marquee.h)}px"
								data-testid="composition-marquee"
							></div>
						{/if}
						{#if dropGhost && dropGhost.valid}
							<div
								class="drop-ghost"
								style="left:{timelineX(dropGhost.frame)}px"
								data-testid="composition-drop-ghost"
								aria-hidden="true"
							></div>
						{/if}
						{#if dropGhost && !dropGhost.valid}
							<div
								class="drop-ghost invalid"
								style="left:{timelineX(dropGhost.frame)}px"
								data-testid="composition-drop-ghost-invalid"
								aria-hidden="true"
							></div>
						{/if}
						{#if snapGuideFrame !== null}
							<div
								class="snap-guide"
								style="left:{timelineX(snapGuideFrame)}px"
								data-testid="composition-snap-guide"
								aria-hidden="true"
							></div>
						{/if}
					</div>
				</div>
			</div>
		</div>
		<div class="composition-footer">
			<span class="footer-status" aria-live="polite" data-testid="composition-status">{status}</span
			>
			<div class="footer-actions">
				<Button
					size="sm"
					variant="ghost"
					aria-label={m.video_editor_composition_timeline_copy()}
					disabled={selectedItemIds.size === 0}
					onclick={copySelected}
					data-testid="composition-copy"
					><CopyIcon class="size-3" />{m.video_editor_composition_timeline_copy()}</Button
				>
				<Button
					size="sm"
					variant="ghost"
					aria-label={m.video_editor_composition_timeline_paste()}
					disabled={!clipboard}
					onclick={pasteClipboard}
					data-testid="composition-paste"
					><ClipboardIcon class="size-3" />{m.video_editor_composition_timeline_paste()}</Button
				>
				<Button
					size="sm"
					variant="ghost"
					aria-label={m.video_editor_composition_timeline_duplicate()}
					disabled={selectedItemIds.size === 0}
					onclick={duplicateSelected}
					data-testid="composition-duplicate"
					>{m.video_editor_composition_timeline_duplicate()}</Button
				>
				<Button
					size="sm"
					variant="ghost"
					aria-label={m.video_editor_composition_timeline_group()}
					disabled={selectedItemIds.size < 2}
					onclick={groupSelected}
					data-testid="composition-group"
					><GroupIcon class="size-3" />{m.video_editor_composition_timeline_group()}</Button
				>
				<Button
					size="sm"
					variant="ghost"
					aria-label={m.video_editor_composition_timeline_delete()}
					disabled={selectedItemIds.size === 0}
					onclick={removeSelected}
					data-testid="composition-delete"
					><TrashIcon class="size-3" />{m.video_editor_composition_timeline_delete()}</Button
				>
				<span class="frame-readout" data-testid="composition-frame-readout"
					>{m.video_editor_composition_timeline_frame({
						frame: String(timelineStore.currentFrame),
						total: String(durationFrames)
					})}</span
				>
			</div>
		</div>
		{#if pendingParent}
			<div class="pick-overlay" data-testid="composition-pick-overlay" aria-hidden="true">
				<p>{m.video_editor_composition_timeline_pick_hint()}</p>
			</div>
		{/if}
		{#if showNewDialog}
			<div
				class="dialog-backdrop"
				role="presentation"
				onclick={() => (showNewDialog = false)}
			></div>
			<div
				class="dialog"
				role="dialog"
				aria-modal="true"
				aria-label={m.video_editor_motion_create_composition()}
				data-testid="new-composition-dialog"
			>
				<h3>{m.video_editor_motion_create_composition()}</h3>
				<label
					>{m.video_editor_composition_timeline_name()}<Input
						value={newName}
						oninput={(e) => (newName = (e.currentTarget as HTMLInputElement).value)}
						data-testid="new-composition-name"
					/></label
				>
				<label
					>{m.video_editor_composition_timeline_fps()}<Input
						type="number"
						min="1"
						max="120"
						value={newFps}
						oninput={(e) => (newFps = Number((e.currentTarget as HTMLInputElement).value))}
						data-testid="new-composition-fps"
					/></label
				>
				<label
					>{m.video_editor_composition_timeline_duration()}<Input
						type="number"
						min="1"
						value={newDuration}
						oninput={(e) => (newDuration = Number((e.currentTarget as HTMLInputElement).value))}
						data-testid="new-composition-duration"
					/></label
				>
				<div class="dialog-actions">
					<Button
						variant="ghost"
						onclick={() => (showNewDialog = false)}
						data-testid="new-composition-cancel"
						>{m.video_editor_composition_timeline_cancel()}</Button
					>
					<Button onclick={handleCreateComposition} data-testid="new-composition-create"
						>{m.video_editor_composition_timeline_create()}</Button
					>
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
				<Select.Root
					type="single"
					value=""
					onValueChange={(value) => value && switchComposition(value)}
				>
					<Select.Trigger id="empty-picker-select" data-testid="empty-composition-picker">
						<span class="truncate">{m.video_editor_composition_timeline_choose()}</span>
					</Select.Trigger>
					<Select.Content>
						{#each compositions as comp (comp.id)}
							<Select.Item value={comp.id}>{comp.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
		<Button
			onclick={() => {
				showNewDialog = true;
				newName = '';
				newFps = 30;
				newDuration = 300;
			}}
			data-testid="empty-new-composition">{m.video_editor_motion_create_composition()}</Button
		>
		{#if showNewDialog}
			<div
				class="dialog-backdrop"
				role="presentation"
				onclick={() => (showNewDialog = false)}
			></div>
			<div
				class="dialog"
				role="dialog"
				aria-modal="true"
				aria-label={m.video_editor_motion_create_composition()}
				data-testid="new-composition-dialog-empty"
			>
				<h3>{m.video_editor_motion_create_composition()}</h3>
				<label
					>{m.video_editor_composition_timeline_name()}<Input
						value={newName}
						oninput={(e) => (newName = (e.currentTarget as HTMLInputElement).value)}
						data-testid="new-composition-name-empty"
					/></label
				>
				<label
					>{m.video_editor_composition_timeline_fps()}<Input
						type="number"
						min="1"
						max="120"
						value={newFps}
						oninput={(e) => (newFps = Number((e.currentTarget as HTMLInputElement).value))}
					/></label
				>
				<label
					>{m.video_editor_composition_timeline_duration()}<Input
						type="number"
						min="1"
						value={newDuration}
						oninput={(e) => (newDuration = Number((e.currentTarget as HTMLInputElement).value))}
					/></label
				>
				<div class="dialog-actions">
					<Button variant="ghost" onclick={() => (showNewDialog = false)}
						>{m.video_editor_composition_timeline_cancel()}</Button
					>
					<Button onclick={handleCreateComposition} data-testid="new-composition-create-empty"
						>{m.video_editor_composition_timeline_create()}</Button
					>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.composition-timeline {
		display: flex;
		flex-direction: column;
		min-height: 360px;
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
	.header-left,
	.header-center,
	.header-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.header-label {
		font-size: 0.62rem;
		color: oklch(0.72 0.015 65);
	}
	.composition-timeline :global(.composition-picker) {
		min-width: 160px;
		height: 32px;
		border-radius: 0.32rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		padding: 0 0.4rem;
		font-size: 0.72rem;
	}
	.composition-timeline :global(.composition-picker:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
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
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.composition-timeline :global(.meta-input) {
		width: 56px;
		height: 24px;
		border-radius: 0.25rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		text-align: center;
		font-size: 0.62rem;
	}
	.composition-timeline :global(.meta-input:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
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
	.composition-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.7rem;
		border-bottom: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.16 0.009 55);
	}
	.toolbar-label {
		font-size: 0.62rem;
		color: oklch(0.72 0.015 65);
		margin-right: 0.2rem;
	}
	.toolbar-search {
		margin-left: auto;
	}
	.composition-timeline :global(.filter-input) {
		box-sizing: border-box;
		width: 180px;
		height: 32px;
		border-radius: 0.32rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		padding: 0 0.5rem;
		font-size: 0.72rem;
	}
	.composition-timeline :global(.filter-input:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
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
		min-height: 44px;
		min-width: 12px;
	}
	.io-handle:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.composition-body {
		display: grid;
		grid-template-columns: 320px 1fr;
		height: clamp(260px, 44vh, 560px);
		min-height: 260px;
		overflow: hidden;
	}
	@media (max-width: 720px) {
		.composition-body {
			grid-template-columns: 1fr;
			height: auto;
		}
		.layer-sidebar {
			max-height: 280px;
		}
	}
	@media (max-width: 480px) {
		.composition-header,
		.composition-toolbar {
			padding-inline: 0.45rem;
		}
		.header-left,
		.header-center,
		.header-right,
		.toolbar-search {
			width: 100%;
		}
		.composition-timeline :global(.composition-picker),
		.composition-timeline :global(.filter-input) {
			min-width: 0;
			width: 100%;
		}
		.header-zoom {
			flex: 1;
			min-width: 0;
		}
		.zoom-slider-wrap {
			flex: 1;
			min-width: 96px;
			width: auto;
		}
		.layer-sidebar-header {
			grid-template-columns: minmax(0, 1fr) 70px 40px 52px;
		}
		.layer-meta-row {
			grid-template-columns: minmax(0, 1fr) 78px 58px 20px;
			padding-inline: 0.2rem;
		}
		.composition-footer,
		.footer-actions {
			align-items: stretch;
			width: 100%;
		}
	}
	.layer-sidebar {
		border-right: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.16 0.009 55);
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0.35rem;
	}
	.layer-sidebar:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: -2px;
	}
	.sidebar-virtual-spacer {
		width: 1px;
		pointer-events: none;
	}
	.layer-sidebar-header {
		display: grid;
		grid-template-columns: 1fr 86px 44px 64px;
		gap: 0.25rem;
		font-size: 0.58rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: oklch(0.62 0.016 65);
		padding: 0.2rem 0.15rem;
	}
	.group-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3rem 0.2rem;
		border-radius: 0.32rem;
		border: 1px solid oklch(0.24 0.012 55);
		background: oklch(0.18 0.01 55);
		margin-bottom: 0.25rem;
	}
	.group-header {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		border: 0;
		background: transparent;
		color: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
		min-height: 32px;
	}
	.group-header.selected {
		color: oklch(0.78 0.08 45);
	}
	.group-header:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.group-toggle {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 0.2rem;
	}
	.group-toggle:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.group-name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.group-span {
		font-size: 0.58rem;
		color: oklch(0.62 0.016 65);
		font-variant-numeric: tabular-nums;
	}
	.group-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.layer-row-wrap {
		border-radius: 0.32rem;
		overflow: hidden;
		margin-bottom: 0.2rem;
		border: 1px solid transparent;
	}
	.layer-row {
		display: flex;
		box-sizing: border-box;
		width: 100%;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.35rem;
		border-radius: 0.32rem;
		border: 1px solid transparent;
		background: transparent;
		color: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
		min-height: 32px;
	}
	.layer-row.selected {
		background: oklch(0.22 0.02 55);
		border-color: oklch(0.66 0.14 45 / 0.5);
	}
	.layer-row.pickTarget {
		border-color: oklch(0.62 0.14 230);
		background: oklch(0.2 0.02 230);
	}
	.layer-row.controller {
		border-style: dashed;
		opacity: 0.85;
	}
	.layer-row:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: -2px;
	}
	.layer-expand {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border: 0;
		background: transparent;
		color: inherit;
		cursor: pointer;
		border-radius: 0.2rem;
	}
	.layer-expand:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.layer-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.layer-type-badge {
		flex: none;
		width: 18px;
		height: 18px;
		display: grid;
		place-items: center;
		border-radius: 0.2rem;
		background: oklch(0.24 0.012 55);
		font-size: 0.58rem;
		font-weight: 700;
	}
	.layer-actions {
		display: flex;
		align-items: center;
		gap: 0.1rem;
	}
	.icon-btn {
		width: 28px;
		height: 28px;
		min-width: 28px;
		min-height: 28px;
	}
	.icon-btn:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.solo-label {
		font-size: 0.62rem;
		font-weight: 700;
	}
	.layer-meta-row {
		display: grid;
		grid-template-columns: 1fr 92px 64px 20px;
		gap: 0.25rem;
		padding: 0.15rem 0.35rem 0.35rem;
		align-items: center;
	}
	.parent-cell {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		min-width: 0;
	}
	.parent-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.62rem;
		color: oklch(0.72 0.02 65);
	}
	.blend-cell {
		display: flex;
	}
	.composition-timeline :global(.blend-select) {
		width: 100%;
		height: 24px;
		border-radius: 0.25rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		font-size: 0.62rem;
		padding: 0 0.2rem;
	}
	.composition-timeline :global(.blend-select:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.timing-cell {
		font-size: 0.58rem;
		color: oklch(0.62 0.016 65);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.drag-handle {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		cursor: grab;
		color: oklch(0.62 0.016 65);
		user-select: none;
		border-radius: 0.2rem;
	}
	.drag-handle:active {
		cursor: grabbing;
	}
	.drag-handle:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.composition-timeline :global(.rename-input) {
		flex: 1;
		height: 28px;
		border-radius: 0.25rem;
		border: 1px solid oklch(0.66 0.14 45);
		background: oklch(0.2 0.01 55);
		color: inherit;
		padding: 0 0.35rem;
		font-size: 0.72rem;
		min-width: 0;
	}
	.composition-timeline :global(.rename-input:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.vector-row {
		display: grid;
		grid-template-columns: 72px 28px 1fr;
		align-items: center;
		gap: 0.25rem;
		padding: 0.18rem 0.35rem;
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
		min-width: 12px;
		min-height: 12px;
	}
	.vector-key:active {
		cursor: grabbing;
	}
	.vector-key.selected {
		background: oklch(0.88 0.16 45);
		box-shadow: 0 0 0 2px oklch(0.66 0.14 45 / 0.4);
	}
	.vector-key:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.vector-key-secondary {
		background: oklch(0.62 0.12 230);
		top: 5px;
	}
	.text-band-row {
		display: grid;
		grid-template-columns: 36px 1fr 60px;
		gap: 0.25rem;
		padding: 0.18rem 0.35rem;
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
	.inline-props {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.35rem;
		padding: 0.3rem 0.35rem;
		border-top: 1px dashed oklch(0.24 0.012 55);
		background: oklch(0.14 0.008 55);
		font-size: 0.62rem;
		color: oklch(0.68 0.015 65);
	}
	.inline-props-toolbar,
	.dopesheet-mode-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.inline-props-toolbar {
		flex-wrap: wrap;
	}
	.dopesheet-mode-row {
		min-width: 0;
		flex: 1 1 auto;
		flex-wrap: wrap;
	}
	.inline-props-views {
		display: grid;
		min-width: 0;
		width: 100%;
		overflow-x: auto;
	}
	.inline-props-views :global([data-keyframe-value-graph]) {
		min-width: min(20rem, 100%);
		width: 100%;
	}
	.inline-label {
		flex: 0 0 auto;
		font-weight: 600;
		color: oklch(0.76 0.14 45);
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
	.text-band:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
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
		min-width: 12px;
	}
	.text-band-handle.disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.text-band-handle:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.empty-layers {
		padding: 1rem 0.4rem;
		font-size: 0.72rem;
		text-align: center;
		color: oklch(0.62 0.016 65);
	}
	.empty-actions {
		display: flex;
		gap: 0.4rem;
		justify-content: center;
		margin-top: 0.6rem;
	}
	.timeline-content {
		overflow: auto;
		background: oklch(0.145 0.008 55);
		position: relative;
	}
	.timeline-content:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: -2px;
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
		cursor: pointer;
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
		min-width: 44px;
		min-height: 28px;
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
	.ruler-playhead.ghost {
		background: oklch(0.66 0.14 45 / 0.45);
		width: 1px;
		border-left: 1px dashed oklch(0.66 0.14 45);
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
	.bars-playhead.ghost {
		background: oklch(0.66 0.14 45 / 0.5);
		width: 1px;
		border-left: 1px dashed oklch(0.66 0.14 45);
	}
	.composition-timeline :global(.timing-input) {
		width: 48px;
		height: 22px;
		border-radius: 0.2rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		font-size: 0.58rem;
		text-align: center;
		padding: 0 0.2rem;
	}
	.composition-timeline :global(.timing-input:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.motion-layer-bands,
	.modifier-bands {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.25rem 0.35rem;
		border-top: 1px dashed oklch(0.24 0.012 55);
	}
	.motion-layer-band,
	.modifier-band {
		display: flex;
		align-items: center;
		height: 18px;
		border-radius: 0.2rem;
		border: 1px solid oklch(0.55 0.12 230 / 0.5);
		background: oklch(0.45 0.12 230 / 0.18);
		color: inherit;
		font-size: 0.58rem;
		padding: 0 0.3rem;
		cursor: pointer;
	}
	.motion-layer-band:focus-visible,
	.modifier-band:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.path-vertex-lane,
	.mask-lane {
		display: flex;
		align-items: center;
		padding: 0.2rem 0.35rem;
		border-top: 1px dashed oklch(0.24 0.012 55);
		font-size: 0.58rem;
		color: oklch(0.68 0.015 65);
	}
	.link-pick-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.35rem;
		border-top: 1px dashed oklch(0.24 0.012 55);
	}
	.link-pick-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		height: 22px;
		padding: 0 0.4rem;
		border-radius: 0.2rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		font-size: 0.58rem;
		cursor: pointer;
	}
	.link-pick-btn[aria-pressed='true'] {
		border-color: oklch(0.66 0.14 45);
		background: oklch(0.28 0.03 50);
	}
	.link-pick-btn:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.link-badge {
		font-size: 0.58rem;
		padding: 0.1rem 0.3rem;
		border-radius: 0.2rem;
		background: oklch(0.22 0.015 55);
		border: 1px solid oklch(0.26 0.016 55);
	}
	.published-controls {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.3rem 0.35rem;
		border-top: 1px dashed oklch(0.24 0.012 55);
	}
	.control-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.58rem;
	}
	.control-row :global(input) {
		flex: 1;
		height: 22px;
		border-radius: 0.2rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		padding: 0 0.3rem;
	}
	.control-row :global(input:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.drop-ghost {
		position: absolute;
		top: 8px;
		bottom: 8px;
		width: 2px;
		background: oklch(0.55 0.15 150);
		pointer-events: none;
	}
	.drop-ghost.invalid {
		background: oklch(0.6 0.18 25);
	}
	.snap-guide {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: oklch(0.76 0.14 45);
		box-shadow: 0 0 0 1px oklch(0.18 0.01 55 / 0.75);
		pointer-events: none;
		z-index: 12;
	}
	.marquee {
		position: absolute;
		border: 1px solid oklch(0.66 0.14 45);
		background: oklch(0.66 0.14 45 / 0.15);
		pointer-events: none;
		border-radius: 0.15rem;
	}
	.composition-footer {
		display: flex;
		box-sizing: border-box;
		max-width: 100%;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-top: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.17 0.01 55);
		flex-wrap: wrap;
	}
	.footer-status {
		font-size: 0.62rem;
		color: oklch(0.68 0.015 65);
		min-height: 18px;
	}
	.footer-actions {
		display: flex;
		box-sizing: border-box;
		max-width: 100%;
		min-width: 0;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
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
		background: oklch(0.12 0.008 55 / 0.6);
		color: oklch(0.9 0.01 65);
		font-size: 0.72rem;
		pointer-events: none;
	}
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		background: oklch(0 0 0 / 0.5);
		z-index: 40;
	}
	.dialog {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		background: oklch(0.18 0.01 55);
		border: 1px solid oklch(0.26 0.016 55);
		border-radius: 0.5rem;
		padding: 1rem;
		z-index: 50;
		box-sizing: border-box;
		width: min(320px, calc(100vw - 2rem));
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		color: oklch(0.9 0.01 65);
	}
	.dialog h3 {
		margin: 0;
		font-size: 0.86rem;
		font-weight: 650;
	}
	.dialog label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.72rem;
	}
	.dialog :global(input) {
		height: 32px;
		border-radius: 0.32rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		padding: 0 0.5rem;
	}
	.dialog :global(input:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.composition-empty {
		display: grid;
		place-items: center;
		gap: 0.8rem;
		padding: 2rem 1rem;
		text-align: center;
		color: oklch(0.68 0.015 65);
		min-height: 240px;
		border: 1px dashed oklch(0.26 0.016 55);
		border-radius: 0.5rem;
		background: oklch(0.16 0.009 55);
	}
	.empty-picker {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.72rem;
	}
	.empty-picker :global(button[data-slot='select-trigger']) {
		height: 32px;
		border-radius: 0.32rem;
		border: 1px solid oklch(0.26 0.016 55);
		background: oklch(0.2 0.01 55);
		color: inherit;
		padding: 0 0.4rem;
	}
	.empty-picker :global(button[data-slot='select-trigger']:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	@media (pointer: coarse) {
		.layer-row,
		.group-header,
		.ruler-tick,
		.layer-bar,
		.icon-btn {
			min-height: 44px;
		}
		.io-handle {
			min-width: 24px;
			min-height: 44px;
		}
	}
</style>
