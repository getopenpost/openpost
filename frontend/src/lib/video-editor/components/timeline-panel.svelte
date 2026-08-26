<!--
	Timeline panel: ruler, markers, tracks, clips with audio waveform strips,
	playhead, drag move/trim, and zoom. Waveform rendering ported from
	FreeCut (MIT).
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		addMarker,
		setCurrentFrame,
		removeMarker,
		updateMarker,
		joinItems,
		linkItems,
		unlinkItems
	} from '$lib/video-editor/timeline/actions/items';
	import { markerAfter, markerBefore, markerDisplayName } from '$lib/video-editor/timeline/markers';
	import { shuttleScrubResume } from '$lib/video-editor/preview/shuttle-scrub-resume.svelte';
	import {
		TIMELINE_ZOOM_STEP,
		anchoredTimelineScrollLeft,
		centeredTimelineScrollLeft,
		clampTimelineZoom,
		cursorZoomAnchor,
		playheadZoomAnchor,
		timelinePixelsPerFrame,
		timelineSliderToZoom,
		timelineZoomToFit,
		timelineZoomToSlider,
		type TimelineZoomAnchor
	} from '$lib/video-editor/timeline/zoom';
	import {
		getWaveform,
		cachedWaveform,
		subscribeWaveform
	} from '$lib/video-editor/media/waveform-client';
	import type { WaveformData } from '$lib/video-editor/media/waveform-client';
	import { planTimelineWaveformDemand } from '$lib/video-editor/timeline/waveform-demand';
	import { peaksForWindow } from '$lib/video-editor/media/peaks';
	import { dbToLinearGain, linearGainToDb } from '$lib/video-editor/media/clip-fades';
	import {
		AUDIO_VOLUME_DB_MAX,
		AUDIO_VOLUME_DB_MIN,
		audioVolumeDbFromDrag,
		audioVolumeLinePercent,
		audioVolumeWaveformScale,
		clampAudioVolumeDb,
		formatAudioVolumeDb
	} from '$lib/video-editor/timeline/audio-volume-line';
	import { filmstripCache, type FilmstripFrame } from '$lib/video-editor/media/filmstrip-client';
	import {
		animatedImageCache,
		type AnimatedImageFrames
	} from '$lib/video-editor/media/animated-image-client';
	import {
		computeAnimatedImageTiles,
		isAnimatedImageMedia
	} from '$lib/video-editor/media/animated-image-plan';
	import FilmstripTile from './filmstrip-tile.svelte';
	import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
	import { emitEditorSound } from '$lib/video-editor/sounds/editor-sounds';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import {
		editorShortcutTargetIsDisabled,
		eventMatchesShortcut,
		type EditorShortcutId
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import KeyframeDopesheet from './keyframe-dopesheet.svelte';
	import PropertyRuntimePanel from './property-runtime-panel.svelte';
	import KeyframeValueGraph from './keyframe-value-graph.svelte';
	import {
		computeFilmstripTiles,
		visibleFilmstripTargetIndices
	} from '$lib/video-editor/media/filmstrip-plan';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { createTimelineAudioSkimController } from '$lib/video-editor/audio/audio-skim-controller.svelte';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import {
		formatTimelinePreviewTimecode,
		timelinePreviewScrub
	} from '$lib/video-editor/preview/timeline-preview-scrub';
	import {
		MAX_TRACK_HEIGHT,
		MIN_TRACK_HEIGHT,
		clampTrackHeight,
		resetTrackHeightsInList,
		resizeAllTracksInList,
		resizeTrackInList
	} from '$lib/video-editor/timeline/track-resize';
	import { Slider } from '$lib/components/ui/slider';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import {
		activeValueAt,
		keyframeClearOptions,
		setKeyframe,
		setKeyframeEasing
	} from '$lib/video-editor/timeline/actions/keyframes';
	import type { KeyframeClearProperty } from '$lib/video-editor/timeline/actions/keyframes';
	import type {
		EasingConfig,
		EasingType,
		KeyframeProperty,
		TimelineItem,
		TimelineMarker,
		TimelineTransition
	} from '$lib/video-editor/project/types';
	import {
		getAnimatablePropertiesForItem,
		resolvePreExpressionItemAt
	} from '$lib/video-editor/timeline/animated-properties';
	import { editorKeyframes, editorPropertyLabel } from '$lib/video-editor/timeline/keyframe-editor';
	import { pathVertexSelectionStore } from '$lib/video-editor/timeline/stores/path-vertex-selection-store.svelte';
	import { visiblePathVertexProperties } from '$lib/video-editor/timeline/path-vertex-visibility';
	import {
		isPathVertexKeyframeProperty,
		pathVertexPropertyValue
	} from '$lib/video-editor/timeline/path-vertex-keyframes';
	import {
		effectPropertyBaseValue,
		effectPropertyLabel
	} from '$lib/video-editor/effects/effect-keyframes';
	import { canJoinMultipleItems } from '$lib/video-editor/timeline/join-items';
	import { BEZIER_PRESETS, buildEasingConfig } from '$lib/video-editor/timeline/easing-presets';
	import {
		easingConfigFromPreset,
		loadCustomEasingPresets,
		presetFromEasing,
		saveCustomEasingPresets,
		suggestedCustomPresetName,
		upsertCustomEasingPreset,
		type CustomEasingPreset
	} from '$lib/video-editor/timeline/custom-easing-presets';
	import {
		planLinkedMoveGesture,
		planLinkedSlipGesture,
		planRateStretchGesture,
		planRippleTrimGesture,
		planRollingTrimGesture,
		planSlideGesture,
		planTrimGesture
	} from '$lib/video-editor/timeline/edit-gesture';
	import {
		buildBaselineMap,
		editPreviewStore
	} from '$lib/video-editor/preview/edit-preview-store.svelte';
	import {
		buildSnapTargets,
		calculateAdaptiveSnapThreshold,
		calculateMoveSnap,
		type SnapTarget
	} from '$lib/video-editor/timeline/snapping';
	import {
		createTrackPushGesturePlan,
		resolveTrackPush,
		trackPushGapBefore,
		type TrackPushGesturePlan
	} from '$lib/video-editor/timeline/track-push';
	import {
		DENSE_TIMELINE_TRACK_ITEM_THRESHOLD,
		buildTimelineDensityBuckets,
		buildTimelineItemRangeIndex,
		buildTimelineTrackRenderPlan,
		queryTimelineItemRange,
		timelineCullRange,
		type TimelineItemRangeIndex,
		type TimelineTrackRenderPlan
	} from '$lib/video-editor/timeline/timeline-viewport';
	import {
		captureSnapshot,
		restoreSnapshot,
		snapshotsEqual
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import {
		pruneOrphanedTransitions,
		transitionsStore,
		updateTransition
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import {
		buildInsertedGapPreviewUpdatesForSyncLockedTracks,
		buildRemovedIntervalPreviewUpdatesForSyncLockedTracks,
		propagateInsertedGapToSyncLockedTracks,
		propagateRemovedIntervalsToSyncLockedTracks,
		type SyncLockPreviewUpdate
	} from '$lib/video-editor/timeline/actions/sync-lock-ripple';
	import {
		getMaxTransitionDuration,
		resolveTransitionWindow
	} from '$lib/video-editor/timeline/transition-planner';
	import { localizedTransitionLabel } from '$lib/video-editor/transitions/labels';
	import {
		addTrack,
		createTrackGroup,
		moveTrack,
		renameTrack,
		removeTrackGroupWithContents,
		removeTrack,
		toggleTrackLock,
		toggleTrackMute,
		toggleTrackSolo,
		toggleTrackSyncLock,
		toggleTrackVisibility,
		toggleTrackGroupCollapsed,
		ungroupTracks,
		type TrackKind
	} from '$lib/video-editor/timeline/actions/tracks';
	import {
		effectiveMediaTracks,
		effectiveTrackState,
		isTrackEffectivelyLocked,
		isTrackGroup,
		mediaTracks,
		trackChildren,
		visibleTrackRows
	} from '$lib/video-editor/timeline/utils/track-groups';
	import TimelineTrackHeader from './timeline-track-header.svelte';
	import TimelineDensityOverview from './timeline-density-overview.svelte';
	import TimelineNavigator from './timeline-navigator.svelte';
	import AudioMixerPanel from './audio-mixer-panel.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import BentoLayoutDialog from './bento-layout-dialog.svelte';
	import ClearKeyframesDialog from './clear-keyframes-dialog.svelte';
	import { eligibleBentoItemIds } from '$lib/video-editor/timeline/actions/bento-layout';
	import TimelineVoiceoverOverlay from './timeline-voiceover-overlay.svelte';
	import {
		canLinkSelection,
		expandSelectionWithLinkedItems,
		getLinkedSyncOffsetFrames,
		getSynchronizedLinkedItems
	} from '$lib/video-editor/timeline/utils/linked-items';
	import TimelineLinkedSyncBadge from './timeline-linked-sync-badge.svelte';
	import { formatLinkedSyncOffset } from '$lib/video-editor/timeline/linked-sync-display';
	import { updateTimelineItemSelection } from '$lib/video-editor/timeline/selection';
	import {
		areItemIdListsEqual,
		clearEffectDragData,
		getEffectDragData,
		isDragPointInsideElement,
		resolveEffectDropTargetIds,
		type EffectDragData
	} from '$lib/video-editor/timeline/effect-drop';
	import { addEffectTemplates } from '$lib/video-editor/timeline/actions/effects';
	import {
		consolidateCaptionItems,
		type CaptionConsolidationOptions
	} from '$lib/video-editor/timeline/actions/captions';
	import {
		clearSceneDragData,
		getSceneDragData
	} from '$lib/video-editor/media/scene-search/scene-drag';
	import { insertSceneAtFrame } from '$lib/video-editor/media/scene-search/scene-insert';
	import {
		clearActiveMediaDrag,
		getMediaDragData,
		type MediaDragData
	} from '$lib/video-editor/media/media-drag';
	import { mediaPlacement } from '$lib/video-editor/media/media-placement.svelte';
	import {
		evaluateExactMediaPlacement,
		mediaDropAutoScrollDelta,
		mediaDurationInFrames,
		mediaTimelineKind,
		planExactSequencePlacement,
		type MediaDropRejection
	} from '$lib/video-editor/media/media-drop-placement';
	import { insertMediaAtFrame } from '$lib/video-editor/timeline/actions/insert-media';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { nestSequenceOnExactTracks } from '$lib/video-editor/sequences/sequence-actions';
	import { wouldCreateCompositionCycle } from '$lib/video-editor/sequences/composition-graph';
	import { Button } from '$lib/components/ui/button';
	import BetweenHorizontalEndIcon from '@lucide/svelte/icons/between-horizontal-end';
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import MagnetIcon from '@lucide/svelte/icons/magnet';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import CombineIcon from '@lucide/svelte/icons/combine';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import SnowflakeIcon from '@lucide/svelte/icons/snowflake';
	import UnlinkIcon from '@lucide/svelte/icons/unlink';
	import MoveHorizontalIcon from '@lucide/svelte/icons/move-horizontal';
	import MoveRightIcon from '@lucide/svelte/icons/move-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import VideoIcon from '@lucide/svelte/icons/video';
	import AudioLinesIcon from '@lucide/svelte/icons/audio-lines';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import ChartSplineIcon from '@lucide/svelte/icons/chart-spline';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';

	let {
		onedit,
		ontransitionbreak = () => {},
		onopencomposition = () => {},
		onfreezeframe = () => {},
		freezeFramePending = false,
		canvasWidth = 1920,
		canvasHeight = 1080,
		selectedItemId = $bindable(null),
		selectedItemIds = $bindable([]),
		selectedTransitionId = $bindable(null)
	}: {
		onedit: () => void;
		ontransitionbreak?: (count: number) => void;
		onopencomposition?: (compositionId: string) => void;
		onfreezeframe?: (itemId: string) => void;
		freezeFramePending?: boolean;
		canvasWidth?: number;
		canvasHeight?: number;
		selectedItemId?: string | null;
		selectedItemIds?: string[];
		selectedTransitionId?: string | null;
	} = $props();
	let scrollContainer = $state<HTMLDivElement | null>(null);
	let timelineViewport = $state({ scrollLeft: 0, width: 0 });
	let timelineViewportAnimationFrame: number | null = null;
	let visibleTimelineItemIds = $state<Set<string>>(new Set());
	let timelineItemObserver: IntersectionObserver | null = null;
	let selectedTrackIds = $state<string[]>([]);
	let deleteGroupTarget = $state<{
		id: string;
		name: string;
		trackCount: number;
	} | null>(null);
	let deleteGroupDialogOpen = $state(false);
	let bentoLayoutOpen = $state(false);
	let clearKeyframesDialogOpen = $state(false);
	let mixerOpen = $state(false);
	let lastTimelinePointerScreenX: number | null = null;
	let queuedTimelineZoom: { level: number; scrollLeft: number } | null = null;
	let timelineZoomAnimationFrame: number | null = null;
	let hoverPreviewAnimationFrame: number | null = null;
	let pendingHoverPreviewClientX: number | null = null;
	const audioSkimController = createTimelineAudioSkimController();
	let audioSkimStopTimer: ReturnType<typeof setTimeout> | null = null;
	let rulerScrub: {
		pointerId: number;
		latestClientX: number;
		animationFrame: number | null;
	} | null = null;
	let trackHeightResize: {
		pointerId: number;
		trackId: string;
		startY: number;
		startHeight: number;
		applyToAll: boolean;
		beforeSnapshot: TimelineSnapshot;
		changed: boolean;
		bodyCursor: string;
		bodyUserSelect: string;
	} | null = null;
	let markerDrag: {
		pointerId: number;
		markerId: string;
		beforeSnapshot: TimelineSnapshot;
		changed: boolean;
		bodyCursor: string;
		bodyUserSelect: string;
	} | null = null;
	let audioVolumeDrag = $state.raw<{
		pointerId: number;
		itemId: string;
		startClientY: number;
		latestClientY: number;
		startDb: number;
		rowHeight: number;
		beforeSnapshot: TimelineSnapshot;
		target: HTMLButtonElement;
		animationFrame: number | null;
		activated: boolean;
	} | null>(null);
	let markerLabelDraft = $state('');
	let markerLabelDraftId = '';
	const selectedMarker = $derived(
		timelineStore.markers.find((marker) => marker.id === timelineStore.selectedMarkerId) ?? null
	);
	const waveforms = $state<Record<string, { data: WaveformData | null; failed: boolean }>>({});
	const waveformUnsubscribers = new Map<string, () => void>();
	let waveformDemandTimer: ReturnType<typeof setTimeout> | null = null;
	let previousWaveformScrollLeft = 0;
	const WAVEFORM_DEMAND_DELAY_MS = 90;

	function clearWaveformDemandTimer(): void {
		if (waveformDemandTimer === null) return;
		clearTimeout(waveformDemandTimer);
		waveformDemandTimer = null;
	}

	function clearWaveformSubscriptions(): void {
		for (const unsubscribe of waveformUnsubscribers.values()) unsubscribe();
		waveformUnsubscribers.clear();
		for (const mediaId of Object.keys(waveforms)) delete waveforms[mediaId];
	}

	function reconcileWaveformDemand(mediaIds: readonly string[]): void {
		const neededMediaIds = new Set(mediaIds);
		for (const [mediaId, unsubscribe] of waveformUnsubscribers) {
			if (neededMediaIds.has(mediaId)) continue;
			unsubscribe();
			waveformUnsubscribers.delete(mediaId);
			delete waveforms[mediaId];
		}

		for (const mediaId of mediaIds) {
			const media = mediaPool.get(mediaId);
			const hasAudio =
				media?.audioCodecSupported !== false &&
				(media?.tags.includes('audio') || Boolean(media?.audioCodec));
			if (!media || !hasAudio || waveformUnsubscribers.has(mediaId)) continue;
			waveforms[mediaId] = { data: null, failed: false };
			waveformUnsubscribers.set(
				mediaId,
				subscribeWaveform(mediaId, (data) => {
					waveforms[mediaId] = { data, failed: false };
				})
			);
			void getWaveform(media)
				.then((data) => {
					if (!waveformUnsubscribers.has(mediaId)) return;
					waveforms[mediaId] = { data, failed: false };
				})
				.catch(() => {
					if (!waveformUnsubscribers.has(mediaId)) return;
					waveforms[mediaId] = { data: null, failed: true };
				});
		}
	}

	$effect(() => {
		const marker = selectedMarker;
		if (!marker) {
			markerLabelDraftId = '';
			markerLabelDraft = '';
			return;
		}
		if (marker.id === markerLabelDraftId) return;
		markerLabelDraftId = marker.id;
		markerLabelDraft = marker.label ?? '';
	});

	$effect(() => {
		const offPlay = editorSession.clock.on('play', clearHoverPreview);
		const offFrameChange = editorSession.clock.on('framechange', clearHoverPreview);
		return () => {
			offPlay();
			offFrameChange();
		};
	});

	$effect(() => {
		if (!selectedItemId) {
			selectedItemIds = [];
			return;
		}
		if (!selectedItemIds.includes(selectedItemId)) selectedItemIds = [selectedItemId];
	});

	$effect(() => {
		const itemIds = new Set(timelineStore.items.map((item) => item.id));
		const existingIds = selectedItemIds.filter((id) => itemIds.has(id));
		if (existingIds.length !== selectedItemIds.length) selectedItemIds = existingIds;
		if (selectedItemId && !itemIds.has(selectedItemId)) {
			selectedItemId = existingIds.at(-1) ?? null;
		}
	});

	$effect(() => {
		if (
			selectedTransitionId &&
			!transitionsStore.list.some((transition) => transition.id === selectedTransitionId)
		) {
			selectedTransitionId = null;
		}
	});

	$effect(() => {
		clearWaveformDemandTimer();
		if (!editorSettings.showWaveforms) {
			clearWaveformSubscriptions();
			return;
		}
		const currentScrollLeft = timelineViewport.scrollLeft;
		const mediaIds = planTimelineWaveformDemand({
			items: timelineStore.items,
			scrollLeft: currentScrollLeft,
			previousScrollLeft: previousWaveformScrollLeft,
			viewportWidth: timelineViewport.width,
			headerWidth: TRACK_HEADER_WIDTH,
			pixelsPerFrame: pxPerFrame
		});
		previousWaveformScrollLeft = currentScrollLeft;
		if (timelineViewport.width <= TRACK_HEADER_WIDTH) return;
		waveformDemandTimer = setTimeout(() => {
			waveformDemandTimer = null;
			reconcileWaveformDemand(mediaIds);
		}, WAVEFORM_DEMAND_DELAY_MS);
		return clearWaveformDemandTimer;
	});

	function waveformSvgPoints(item: {
		mediaId?: string;
		sourceStart?: number;
		sourceEnd?: number;
		sourceFps?: number;
		speed?: number;
		isReversed?: boolean;
		durationInFrames: number;
	}): string | null {
		if (!item.mediaId) return null;
		const entry = waveforms[item.mediaId];
		const data = entry?.data ?? cachedWaveform(item.mediaId);
		if (!data) return null;
		const width = Math.max(8, frameToPx(item.durationInFrames) - 4);
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
		const sourceStart = item.sourceStart ?? 0;
		const sourceEnd =
			item.sourceEnd ?? sourceStart + (item.durationInFrames / fps) * (item.speed ?? 1) * sourceFps;
		const columns = peaksForWindow(data, sourceStart, sourceEnd, sourceFps, width);
		const points: string[] = [];
		for (let column = 0; column < width; column++) {
			const sourceColumn = item.isReversed ? width - column - 1 : column;
			const min = columns[sourceColumn * 2];
			const max = columns[sourceColumn * 2 + 1];
			points.push(`${column + 2},${(max * 40).toFixed(1)} ${column + 2},${(min * 40).toFixed(1)}`);
		}
		return points.join(' ');
	}
	type TimelineDragKind =
		| 'move'
		| 'track-push'
		| 'trim-start'
		| 'trim-end'
		| 'slip'
		| 'slide'
		| 'rate-stretch'
		| 'rate-stretch-start'
		| 'rate-stretch-end';
	type AdvancedEditTool = 'slip' | 'slide' | 'rate-stretch' | 'track-push';
	let activeEditTool = $state<AdvancedEditTool | null>(null);
	let drag: null | {
		kind: TimelineDragKind;
		id: string;
		pointerId: number;
		startX: number;
		original: TimelineItem;
		beforeSnapshot: TimelineSnapshot;
		editItems: TimelineItem[];
		selectedItemIds: string[];
		snapTargets: SnapTarget[];
		rollingNeighbor: TimelineItem | null;
		ripple: boolean;
		rippleMoveIds: string[];
		breakingTransitionIds: string[];
		stretchHandle: 'start' | 'end';
		slideLeft: TimelineItem | null;
		slideRight: TimelineItem | null;
		trackPushPlan: TrackPushGesturePlan | null;
		trackPushDelta: number;
		activated: boolean;
		latestClientX: number;
		rafId: number | null;
	} = null;
	let activeSnapTarget = $state<SnapTarget | null>(null);
	let latestLockedItemFrame = $derived.by(() => {
		let latest = Number.NEGATIVE_INFINITY;
		for (const item of timelineStore.items) {
			if (isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) {
				latest = Math.max(latest, item.from);
			}
		}
		return latest;
	});
	let syncLockPreviewById = $state<Record<string, SyncLockPreviewUpdate>>({});
	let breakingTransitionPreviewIds = $state<string[]>([]);
	let transitionResize = $state<{
		id: string;
		handle: 'left' | 'right';
		pointerId: number;
		startX: number;
		initialDuration: number;
		currentDuration: number;
		maxDuration: number;
	} | null>(null);
	let marquee = $state<{
		startX: number;
		startY: number;
		currentX: number;
		currentY: number;
		active: boolean;
		additive: boolean;
		baseIds: string[];
	} | null>(null);
	let effectDropTargetIds = $state<string[]>([]);
	let effectDropHoveredItemId = $state<string | null>(null);
	let sceneDropPreview = $state<{
		trackId: string | null;
		from: number;
		durationInFrames: number;
		label: string;
	} | null>(null);
	let mediaDropPreview = $state<{
		trackId: string;
		secondaryTrackId: string | null;
		from: number;
		durationInFrames: number;
		label: string;
		valid: boolean;
		reason: MediaDropRejection | null;
		snapTarget: SnapTarget | null;
	} | null>(null);
	let pendingMediaDrop = $state<{
		clientX: number;
		trackId: string;
		payload: MediaDragData;
	} | null>(null);
	let activeNativeMediaDrop: {
		clientX: number;
		trackId: string;
		payload: MediaDragData;
	} | null = null;
	let mediaDropAnimationFrame: number | null = null;
	let mediaDropAutoScrollFrame: number | null = null;
	let handledPlacementRequestId = 0;
	interface SnappedMediaFrame {
		from: number;
		snapTarget: SnapTarget | null;
	}

	$effect(() => {
		if (effectDropTargetIds.length === 0) return;
		const clear = () => clearEffectDropPreview();
		window.addEventListener('dragend', clear);
		window.addEventListener('drop', clear);
		return () => {
			window.removeEventListener('dragend', clear);
			window.removeEventListener('drop', clear);
		};
	});

	$effect(() => {
		if (!mediaDropPreview || mediaPlacement.request) return;
		const clear = () => {
			clearMediaDropPreview();
			clearActiveMediaDrag();
		};
		window.addEventListener('dragend', clear);
		window.addEventListener('drop', clear);
		return () => {
			window.removeEventListener('dragend', clear);
			window.removeEventListener('drop', clear);
		};
	});

	$effect(() => {
		const request = mediaPlacement.request;
		if (!request || request.requestId === handledPlacementRequestId) return;
		handledPlacementRequestId = request.requestId;
		beginAccessibleMediaPlacement(request.payload);
	});

	// Reactive filmstrip state per video mediaId; frames stream in from the
	// extraction worker and tiles render as they arrive.
	const filmstrips = $state<Record<string, { frames: FilmstripFrame[]; failed: boolean }>>({});
	const filmstripUnsubscribers = new Map<string, () => void>();
	const FILMSTRIP_TILE_WIDTH_PX = 96;
	const FILMSTRIP_OVERSCAN_PX = FILMSTRIP_TILE_WIDTH_PX * 2;

	function updateTimelineViewport(): void {
		timelineViewportAnimationFrame = null;
		if (!scrollContainer) return;
		timelineViewport = {
			scrollLeft: scrollContainer.scrollLeft,
			width: scrollContainer.clientWidth
		};
	}

	function scheduleTimelineViewportUpdate(): void {
		if (timelineViewportAnimationFrame !== null) return;
		timelineViewportAnimationFrame = requestAnimationFrame(updateTimelineViewport);
	}

	function observeTimelineItem(node: HTMLElement, itemId: string) {
		queueMicrotask(() => {
			if (!node.isConnected || !scrollContainer) return;
			if (!timelineItemObserver) {
				timelineItemObserver = new IntersectionObserver(
					(entries) => {
						const next = new Set(visibleTimelineItemIds);
						for (const entry of entries) {
							const id =
								entry.target instanceof HTMLElement
									? entry.target.dataset.timelineItemId
									: undefined;
							if (!id) continue;
							if (entry.isIntersecting) next.add(id);
							else next.delete(id);
						}
						visibleTimelineItemIds = next;
					},
					{
						root: scrollContainer,
						rootMargin: `0px ${FILMSTRIP_OVERSCAN_PX}px`
					}
				);
			}
			timelineItemObserver.observe(node);
		});
		return {
			destroy: () => {
				timelineItemObserver?.unobserve(node);
				const next = new Set(visibleTimelineItemIds);
				next.delete(itemId);
				visibleTimelineItemIds = next;
			}
		};
	}

	// Reactive animated-image (GIF/WebP) state per mediaId; frames stream in
	// from the extraction worker and tiles render as they arrive.
	const animatedImages = $state<
		Record<string, { frames: AnimatedImageFrames | null; failed: boolean }>
	>({});
	const animatedImageUnsubscribers = new Map<string, () => void>();

	$effect(() => {
		if (!editorSettings.showFilmstrips || !editorSettings.extractFilmstrips) {
			for (const [, unsubscribe] of animatedImageUnsubscribers) {
				unsubscribe();
			}
			animatedImageUnsubscribers.clear();
			for (const mediaId of Object.keys(animatedImages)) delete animatedImages[mediaId];
			return;
		}
		const visibleAnimatedMedia = new Map<string, NonNullable<ReturnType<typeof mediaPool.get>>>();
		for (const item of timelineStore.items) {
			if (item.type !== 'image' || !item.mediaId) continue;
			if (!visibleTimelineItemIds.has(item.id)) continue;
			const media = mediaPool.get(item.mediaId);
			if (!isAnimatedImageMedia(media)) continue;
			// SAFETY: isAnimatedImageMedia just proved the entry exists.
			visibleAnimatedMedia.set(item.mediaId, media!);
		}
		for (const [mediaId, unsubscribe] of animatedImageUnsubscribers) {
			if (visibleAnimatedMedia.has(mediaId)) continue;
			unsubscribe();
			animatedImageUnsubscribers.delete(mediaId);
			delete animatedImages[mediaId];
		}
		for (const [mediaId, media] of visibleAnimatedMedia) {
			if (!animatedImageUnsubscribers.has(mediaId)) {
				animatedImages[mediaId] = { frames: null, failed: false };
				animatedImageUnsubscribers.set(
					mediaId,
					animatedImageCache.subscribe(mediaId, (frames) => {
						animatedImages[mediaId] = { frames, failed: false };
					})
				);
			}
			void animatedImageCache.getAnimatedImage(media).catch(() => {
				if (!animatedImageUnsubscribers.has(mediaId)) return;
				animatedImages[mediaId] = { frames: null, failed: true };
			});
		}
	});

	function animatedImageTilesFor(item: {
		from: number;
		mediaId?: string;
		speed?: number;
		isReversed?: boolean;
		durationInFrames: number;
	}): ReturnType<typeof computeAnimatedImageTiles> | null {
		if (!item.mediaId) return null;
		const entry = animatedImages[item.mediaId];
		const framesData = entry?.frames;
		if (entry?.failed || !framesData?.isComplete) return null;
		const clipWidth = frameToPx(item.durationInFrames);
		if (!(clipWidth > 0)) return null;
		const clipLeft = TRACK_HEADER_WIDTH + frameToPx(item.from);
		const viewportStart = timelineViewport.scrollLeft + TRACK_HEADER_WIDTH;
		const viewportEnd = timelineViewport.scrollLeft + timelineViewport.width;
		const visibleStartPx = Math.max(0, viewportStart - clipLeft - FILMSTRIP_OVERSCAN_PX);
		const visibleEndPx = Math.min(clipWidth, viewportEnd - clipLeft + FILMSTRIP_OVERSCAN_PX);
		return computeAnimatedImageTiles({
			cumulativeDelaysMs: framesData.cumulativeDelaysMs,
			totalDurationMs: framesData.totalDurationMs,
			clipSpanSeconds: item.durationInFrames / fps,
			speed: item.speed ?? 1,
			reversed: item.isReversed === true,
			clipWidthPx: clipWidth,
			tileWidthPx: FILMSTRIP_TILE_WIDTH_PX,
			visibleStartPx,
			visibleEndPx
		});
	}

	function animatedImageBitmapFor(
		mediaId: string | undefined,
		index: number
	): ImageBitmap | undefined {
		if (!mediaId) return undefined;
		return animatedImages[mediaId]?.frames?.frames[index];
	}

	$effect(() => {
		if (!editorSettings.showFilmstrips) {
			for (const [mediaId, unsubscribe] of filmstripUnsubscribers) {
				unsubscribe();
				filmstripCache.abort(mediaId);
			}
			filmstripUnsubscribers.clear();
			for (const mediaId of Object.keys(filmstrips)) delete filmstrips[mediaId];
			return;
		}
		if (timelineViewport.width <= 0) return;
		const visibleTargets = new Map<string, Set<number>>();
		const visibleMedia = new Map<string, NonNullable<ReturnType<typeof mediaPool.get>>>();
		const viewportStart = timelineViewport.scrollLeft + TRACK_HEADER_WIDTH;
		const viewportEnd = timelineViewport.scrollLeft + timelineViewport.width;
		for (const item of timelineStore.items) {
			if (item.type !== 'video' || !item.mediaId) continue;
			if (!visibleTimelineItemIds.has(item.id)) continue;
			const mediaId = item.mediaId;
			const media = mediaPool.get(mediaId);
			if (!media?.tags.includes('video')) continue;
			const clipLeft = TRACK_HEADER_WIDTH + frameToPx(item.from);
			const clipWidth = frameToPx(item.durationInFrames);
			const visibleStartPx = Math.max(0, viewportStart - clipLeft - FILMSTRIP_OVERSCAN_PX);
			const visibleEndPx = Math.min(clipWidth, viewportEnd - clipLeft + FILMSTRIP_OVERSCAN_PX);
			if (visibleEndPx <= visibleStartPx) continue;
			const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : Math.max(1, fps);
			const sourceStartSeconds = (item.sourceStart ?? 0) / sourceFps;
			const clipSpanSeconds = (item.durationInFrames / fps) * (item.speed ?? 1);
			const targets = visibleFilmstripTargetIndices({
				sourceStartSeconds,
				clipSpanSeconds,
				clipWidthPx: clipWidth,
				visibleStartPx,
				visibleEndPx,
				tileWidthPx: FILMSTRIP_TILE_WIDTH_PX,
				totalSourceFrames: Math.max(1, Math.ceil(media.duration)),
				reversed: item.isReversed
			});
			if (targets.length === 0) continue;
			visibleMedia.set(mediaId, media);
			const merged = visibleTargets.get(mediaId) ?? new Set<number>();
			for (const target of targets) merged.add(target);
			visibleTargets.set(mediaId, merged);
		}
		for (const [mediaId, unsubscribe] of filmstripUnsubscribers) {
			if (visibleMedia.has(mediaId)) continue;
			unsubscribe();
			filmstripUnsubscribers.delete(mediaId);
			filmstripCache.abort(mediaId);
			delete filmstrips[mediaId];
		}
		for (const [mediaId, media] of visibleMedia) {
			if (!filmstripUnsubscribers.has(mediaId)) {
				filmstrips[mediaId] = { frames: [], failed: false };
				filmstripUnsubscribers.set(
					mediaId,
					filmstripCache.subscribe(mediaId, (filmstrip) => {
						filmstrips[mediaId] = {
							frames: filmstrip.frames.map((frame) => ({ ...frame })),
							failed: false
						};
					})
				);
			}
			filmstripCache
				.getFilmstrip(media, {
					targetFrameIndices: [...(visibleTargets.get(mediaId) ?? [])],
					allowExtraction: editorSettings.extractFilmstrips
				})
				.catch((error: Error) => {
					if (error instanceof DOMException && error.name === 'AbortError') return;
					if (!filmstripUnsubscribers.has(mediaId)) return;
					filmstrips[mediaId] = {
						frames: filmstrips[mediaId]?.frames ?? [],
						failed: true
					};
				});
		}
	});

	function filmstripTilesFor(item: {
		from: number;
		mediaId?: string;
		sourceStart?: number;
		sourceEnd?: number;
		sourceFps?: number;
		speed?: number;
		isReversed?: boolean;
		durationInFrames: number;
	}): ReturnType<typeof computeFilmstripTiles> | null {
		if (!item.mediaId) return null;
		const entry = filmstrips[item.mediaId];
		if (!entry || entry.failed || entry.frames.length === 0) return null;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : Math.max(1, fps);
		const speed = item.speed ?? 1;
		const startSeconds = (item.sourceStart ?? 0) / sourceFps;
		const spanSeconds = (item.durationInFrames / fps) * speed;
		if (!(spanSeconds > 0)) return null;
		const clipWidth = frameToPx(item.durationInFrames);
		const clipLeft = TRACK_HEADER_WIDTH + frameToPx(item.from);
		const viewportStart = timelineViewport.scrollLeft + TRACK_HEADER_WIDTH;
		const viewportEnd = timelineViewport.scrollLeft + timelineViewport.width;
		const visibleStartPx = Math.max(0, viewportStart - clipLeft - FILMSTRIP_OVERSCAN_PX);
		const visibleEndPx = Math.min(clipWidth, viewportEnd - clipLeft + FILMSTRIP_OVERSCAN_PX);
		if (visibleEndPx <= visibleStartPx) return null;
		return computeFilmstripTiles(
			entry.frames,
			startSeconds,
			spanSeconds,
			clipWidth,
			item.isReversed,
			{
				tileWidthPx: FILMSTRIP_TILE_WIDTH_PX,
				visibleStartPx,
				visibleEndPx
			}
		);
	}

	function filmstripBitmapFor(mediaId: string | undefined, index: number): ImageBitmap | undefined {
		if (!mediaId) return undefined;
		return filmstrips[mediaId]?.frames.find((frame) => frame.index === index)?.bitmap;
	}

	const fps = $derived(editorSession.fps);
	const zoom = $derived(timelineStore.zoomLevel);
	const pxPerFrame = $derived(timelinePixelsPerFrame(zoom));
	const TRACK_HEADER_WIDTH = 180;
	const DRAG_THRESHOLD_PIXELS = 3;
	const EMPTY_TIMELINE_ITEM_RANGE_INDEX = buildTimelineItemRangeIndex([]);
	const timelineWidth = $derived(
		TRACK_HEADER_WIDTH + Math.max(800, (timelineStore.maxItemEndFrame + fps * 10) * pxPerFrame)
	);
	const timelineContentFrames = $derived(
		Math.max(fps * 10, timelineStore.maxItemEndFrame + fps * 10)
	);
	const timelineItemRangeIndexes = $derived.by(() => {
		const indexes = new Map<string, TimelineItemRangeIndex>();
		for (const track of mediaTracks(timelineStore.tracks)) {
			indexes.set(
				track.id,
				buildTimelineItemRangeIndex(timelineStore.itemsByTrackId.get(track.id) ?? [])
			);
		}
		return indexes;
	});
	const timelineDensityBucketsByTrackId = $derived.by(() => {
		const buckets = new Map<string, ReturnType<typeof buildTimelineDensityBuckets>>();
		for (const [trackId, index] of timelineItemRangeIndexes) {
			if (index.items.length >= DENSE_TIMELINE_TRACK_ITEM_THRESHOLD) {
				buckets.set(trackId, buildTimelineDensityBuckets(index.items));
			}
		}
		return buckets;
	});
	const timelineTransitionsByTrackId = $derived.by(() => {
		const byTrackId = new Map<string, TimelineTransition[]>();
		for (const transition of transitionsStore.list) {
			const from = timelineStore.itemById.get(transition.fromItemId);
			const to = timelineStore.itemById.get(transition.toItemId);
			if (!from || !to || from.trackId !== to.trackId) continue;
			const list = byTrackId.get(from.trackId);
			if (list) list.push(transition);
			else byTrackId.set(from.trackId, [transition]);
		}
		return byTrackId;
	});

	function timelineRenderPlan(trackId: string): TimelineTrackRenderPlan {
		const index = timelineItemRangeIndexes.get(trackId) ?? EMPTY_TIMELINE_ITEM_RANGE_INDEX;
		const range = timelineCullRange({
			scrollLeft: timelineViewport.scrollLeft,
			viewportWidth: timelineViewport.width,
			headerWidth: TRACK_HEADER_WIDTH,
			pixelsPerFrame: pxPerFrame,
			trackItemCount: index.items.length
		});
		return buildTimelineTrackRenderPlan({
			index,
			range,
			pixelsPerFrame: pxPerFrame,
			selectedItemIds,
			primarySelectedItemId: selectedItemId,
			densityBuckets: timelineDensityBucketsByTrackId.get(trackId)
		});
	}

	function visibleTransitionsForTrack(
		trackId: string,
		plan: TimelineTrackRenderPlan
	): TimelineTransition[] {
		return (timelineTransitionsByTrackId.get(trackId) ?? []).filter((transition) => {
			const from = timelineStore.itemById.get(transition.fromItemId);
			const to = timelineStore.itemById.get(transition.toItemId);
			if (!from || !to || from.trackId !== trackId || to.trackId !== trackId) return false;
			if (transition.id === selectedTransitionId) return true;
			const window = resolveTransitionWindow(transition, from, to);
			return !!window && window.endFrame > plan.range.start && window.startFrame < plan.range.end;
		});
	}

	function frameToPx(frame: number): number {
		return frame * pxPerFrame;
	}

	function pxToFrame(px: number): number {
		return Math.max(0, Math.round(px / pxPerFrame));
	}

	function pxDeltaToFrames(px: number): number {
		return Math.round(px / pxPerFrame);
	}

	function timelineX(frame: number): number {
		return TRACK_HEADER_WIDTH + frameToPx(frame);
	}

	function rulerTicks(): number[] {
		// Aim for one label every ~80px.
		const framesPerTickOptions = [1, 5, 10, 30, 60, 150, 300, 600, 1800, 3600];
		const target = Math.ceil(80 / pxPerFrame);
		const step = framesPerTickOptions.find((option) => option >= target) ?? 3600;
		const ticks: number[] = [];
		for (let f = 0; f <= (timelineWidth - TRACK_HEADER_WIDTH) / pxPerFrame; f += step)
			ticks.push(f);
		return ticks;
	}

	function tickLabel(frame: number): string {
		const total = frame / fps;
		return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`;
	}

	interface ClipPalette {
		video: string;
		audio: string;
		image: string;
		text: string;
		subtitle: string;
		shape: string;
		adjustment: string;
		composition: string;
	}

	function clipStyle(item: { from: number; durationInFrames: number; type: string }): string {
		const palette: ClipPalette = {
			video: 'oklch(0.4 0.04 250)',
			audio: 'oklch(0.35 0.03 300)',
			image: 'oklch(0.45 0.05 250)',
			text: 'oklch(0.55 0.02 290)',
			subtitle: 'oklch(0.55 0.02 290)',
			shape: 'oklch(0.5 0.12 45)',
			adjustment: 'oklch(0.48 0.09 45)',
			composition: 'oklch(0.42 0.07 255)'
		};
		// SAFETY: item.type values are exactly the ClipPalette keys.
		const fill = palette[item.type as keyof ClipPalette] ?? palette.video;
		return `left:${timelineX(item.from)}px;width:${frameToPx(item.durationInFrames)}px;background:${fill}`;
	}

	function previewedItem(item: TimelineItem): TimelineItem {
		const preview = syncLockPreviewById[item.id];
		if (!preview) return item;
		return {
			...item,
			from: preview.from ?? item.from,
			durationInFrames: preview.durationInFrames ?? item.durationInFrames
		};
	}

	function linkedSyncOffset(item: TimelineItem): number | null {
		if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') return null;
		if (timelineStore.linkedSelectionEnabled && drag) return null;
		return getLinkedSyncOffsetFrames(timelineStore.items, item.id, fps);
	}

	function timelineItemAriaLabel(item: TimelineItem, syncOffsetFrames: number | null): string {
		const parts = [item.label];
		if (item.isReversed) parts.push(m.video_editor_clip_reverse());
		if (syncOffsetFrames !== null) {
			parts.push(
				m.video_editor_linked_sync_offset({
					offset: formatLinkedSyncOffset(syncOffsetFrames, fps)
				})
			);
		}
		parts.push(m.video_editor_timing_keyboard());
		return parts.join('. ');
	}

	function setSyncLockPreview(updates: SyncLockPreviewUpdate[]): void {
		syncLockPreviewById = Object.fromEntries(updates.map((update) => [update.id, update]));
	}

	function clearSyncLockPreview(): void {
		syncLockPreviewById = {};
	}

	function transitionGeometry(
		transition: TimelineTransition,
		trackId: string
	): { left: number; width: number } | null {
		const outgoingItem = timelineStore.itemById.get(transition.fromItemId);
		const incomingItem = timelineStore.itemById.get(transition.toItemId);
		if (
			!outgoingItem ||
			!incomingItem ||
			syncLockPreviewById[outgoingItem.id]?.hidden ||
			syncLockPreviewById[incomingItem.id]?.hidden ||
			outgoingItem.trackId !== trackId ||
			incomingItem.trackId !== trackId
		)
			return null;
		const outgoing = previewedItem(outgoingItem);
		const incoming = previewedItem(incomingItem);
		const previewTransition =
			transitionResize?.id === transition.id
				? { ...transition, durationInFrames: transitionResize.currentDuration }
				: transition;
		const window = resolveTransitionWindow(previewTransition, outgoing, incoming);
		if (!window) return null;
		return {
			left: timelineX(window.startFrame),
			width: Math.max(2, frameToPx(window.durationInFrames))
		};
	}

	function selectTransition(id: string): void {
		selectedTransitionId = id;
		selectedItemId = null;
		selectedItemIds = [];
	}

	function transitionDurationFromPointer(clientX: number): number {
		if (!transitionResize) return 0;
		const delta = pxDeltaToFrames(clientX - transitionResize.startX);
		const raw =
			transitionResize.handle === 'left'
				? transitionResize.initialDuration - delta
				: transitionResize.initialDuration + delta;
		return Math.min(transitionResize.maxDuration, Math.max(2, raw));
	}

	function moveTransitionResize(event: PointerEvent): void {
		if (!transitionResize || event.pointerId !== transitionResize.pointerId) return;
		transitionResize.currentDuration = transitionDurationFromPointer(event.clientX);
	}

	function finishTransitionResize(cancelled = false): void {
		if (!transitionResize) return;
		const resize = transitionResize;
		transitionResize = null;
		window.removeEventListener('pointermove', moveTransitionResize);
		window.removeEventListener('pointerup', releaseTransitionResize);
		window.removeEventListener('pointercancel', cancelTransitionResize);
		window.removeEventListener('keydown', cancelTransitionResizeOnEscape);
		if (
			!cancelled &&
			resize.currentDuration !== resize.initialDuration &&
			updateTransition(resize.id, { durationInFrames: resize.currentDuration })
		) {
			onedit();
		}
	}

	function releaseTransitionResize(event: PointerEvent): void {
		if (!transitionResize || event.pointerId !== transitionResize.pointerId) return;
		finishTransitionResize();
	}

	function cancelTransitionResize(): void {
		finishTransitionResize(true);
	}

	function cancelTransitionResizeOnEscape(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		finishTransitionResize(true);
	}

	function startTransitionResize(
		event: PointerEvent,
		transition: TimelineTransition,
		handle: 'left' | 'right'
	): void {
		if (event.button !== 0) return;
		clearHoverPreview();
		const outgoing = timelineStore.itemById.get(transition.fromItemId);
		const incoming = timelineStore.itemById.get(transition.toItemId);
		if (!outgoing || !incoming) return;
		event.preventDefault();
		event.stopPropagation();
		selectTransition(transition.id);
		const maxDuration = getMaxTransitionDuration(
			outgoing,
			incoming,
			transition.alignment ?? 0.5,
			timelineStore.fps
		);
		transitionResize = {
			id: transition.id,
			handle,
			pointerId: event.pointerId,
			startX: event.clientX,
			initialDuration: transition.durationInFrames,
			currentDuration: transition.durationInFrames,
			maxDuration
		};
		window.addEventListener('pointermove', moveTransitionResize);
		window.addEventListener('pointerup', releaseTransitionResize);
		window.addEventListener('pointercancel', cancelTransitionResize);
		window.addEventListener('keydown', cancelTransitionResizeOnEscape);
	}

	function resizeTransitionWithKeyboard(
		event: KeyboardEvent,
		transition: TimelineTransition,
		handle: 'left' | 'right'
	): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		const current =
			transitionsStore.list.find((candidate) => candidate.id === transition.id) ?? transition;
		const outgoing = timelineStore.itemById.get(current.fromItemId);
		const incoming = timelineStore.itemById.get(current.toItemId);
		if (!outgoing || !incoming) return;
		event.preventDefault();
		event.stopPropagation();
		selectTransition(current.id);
		const direction = event.key === 'ArrowRight' ? 1 : -1;
		const handleDirection = handle === 'right' ? direction : -direction;
		const step = event.shiftKey ? 10 : 1;
		const maxDuration = getMaxTransitionDuration(
			outgoing,
			incoming,
			current.alignment ?? 0.5,
			timelineStore.fps
		);
		const durationInFrames = Math.min(
			maxDuration,
			Math.max(2, current.durationInFrames + handleDirection * step)
		);
		if (
			durationInFrames !== current.durationInFrames &&
			updateTransition(current.id, { durationInFrames })
		) {
			onedit();
		}
	}

	function frameFromClientX(clientX: number): number | undefined {
		if (!scrollContainer) return;
		const rect = scrollContainer.getBoundingClientRect();
		return pxToFrame(clientX - rect.left + scrollContainer.scrollLeft - TRACK_HEADER_WIDTH);
	}

	function seekAndSkim(clientX: number): void {
		if (timelineStore.seekLocked) return;
		const frame = frameFromClientX(clientX);
		if (frame === undefined) return;
		setCurrentFrame(frame);
		audioSkimController.schedule(frame);
	}

	function scheduleAudioSkimStop(): void {
		if (audioSkimStopTimer) clearTimeout(audioSkimStopTimer);
		audioSkimStopTimer = setTimeout(() => {
			audioSkimStopTimer = null;
			audioSkimController.stop();
		}, 90);
	}

	function moveRulerScrub(event: PointerEvent): void {
		if (!rulerScrub || rulerScrub.pointerId !== event.pointerId) return;
		rulerScrub.latestClientX = event.clientX;
		if (rulerScrub.animationFrame !== null) return;
		rulerScrub.animationFrame = requestAnimationFrame(() => {
			if (!rulerScrub) return;
			rulerScrub.animationFrame = null;
			seekAndSkim(rulerScrub.latestClientX);
		});
	}

	function finishRulerScrub(event: PointerEvent): void {
		if (!rulerScrub || rulerScrub.pointerId !== event.pointerId) return;
		if (rulerScrub.animationFrame !== null) cancelAnimationFrame(rulerScrub.animationFrame);
		seekAndSkim(event.clientX);
		rulerScrub = null;
		window.removeEventListener('pointermove', moveRulerScrub);
		window.removeEventListener('pointerup', finishRulerScrub);
		window.removeEventListener('pointercancel', cancelRulerScrub);
		scheduleAudioSkimStop();
		shuttleScrubResume.commit();
	}

	function cancelRulerScrub(event?: PointerEvent): void {
		if (event && rulerScrub && rulerScrub.pointerId !== event.pointerId) return;
		const animationFrame = rulerScrub?.animationFrame;
		if (animationFrame !== null && animationFrame !== undefined) {
			cancelAnimationFrame(animationFrame);
		}
		rulerScrub = null;
		window.removeEventListener('pointermove', moveRulerScrub);
		window.removeEventListener('pointerup', finishRulerScrub);
		window.removeEventListener('pointercancel', cancelRulerScrub);
		audioSkimController.stop();
		shuttleScrubResume.cancel();
	}

	function startRulerScrub(event: PointerEvent): void {
		if (event.button !== 0 || rulerScrub || timelineStore.seekLocked) return;
		clearHoverPreview();
		event.preventDefault();
		event.stopPropagation();
		shuttleScrubResume.begin();
		editorSession.pausePlayback();
		if (audioSkimStopTimer) clearTimeout(audioSkimStopTimer);
		audioSkimStopTimer = null;
		rulerScrub = {
			pointerId: event.pointerId,
			latestClientX: event.clientX,
			animationFrame: null
		};
		seekAndSkim(event.clientX);
		window.addEventListener('pointermove', moveRulerScrub);
		window.addEventListener('pointerup', finishRulerScrub);
		window.addEventListener('pointercancel', cancelRulerScrub);
	}

	function onRulerKeydown(event: KeyboardEvent): void {
		if (timelineStore.seekLocked) return;
		let frame = timelineStore.currentFrame;
		if (event.key === 'ArrowLeft') frame -= event.shiftKey ? 10 : 1;
		else if (event.key === 'ArrowRight') frame += event.shiftKey ? 10 : 1;
		else if (event.key === 'Home') frame = 0;
		else if (event.key === 'End') frame = timelineStore.maxItemEndFrame;
		else return;
		event.preventDefault();
		setCurrentFrame(frame);
		audioSkimController.schedule(frame);
		scheduleAudioSkimStop();
	}

	function applyTrackHeightResize(clientY: number): void {
		if (!trackHeightResize) return;
		const height = clampTrackHeight(
			trackHeightResize.startHeight + clientY - trackHeightResize.startY
		);
		const nextTracks = trackHeightResize.applyToAll
			? resizeAllTracksInList(timelineStore.tracks, height)
			: resizeTrackInList(timelineStore.tracks, trackHeightResize.trackId, height);
		if (nextTracks === timelineStore.tracks) return;
		// Keep drag previews out of the dirty state until pointer-up commits once.
		timelineStore.setAll({ tracks: nextTracks });
		trackHeightResize.changed = true;
	}

	function moveTrackHeightResize(event: PointerEvent): void {
		if (!trackHeightResize || event.pointerId !== trackHeightResize.pointerId) return;
		event.preventDefault();
		applyTrackHeightResize(event.clientY);
	}

	function cleanupTrackHeightResize(): void {
		if (!trackHeightResize) return;
		document.body.style.cursor = trackHeightResize.bodyCursor;
		document.body.style.userSelect = trackHeightResize.bodyUserSelect;
		window.removeEventListener('pointermove', moveTrackHeightResize);
		window.removeEventListener('pointerup', finishTrackHeightResize);
		window.removeEventListener('pointercancel', cancelTrackHeightResize);
		window.removeEventListener('keydown', onTrackHeightResizeKeydown);
		trackHeightResize = null;
	}

	function completeTrackHeightResize(cancelled: boolean): void {
		if (!trackHeightResize) return;
		const beforeSnapshot = trackHeightResize.beforeSnapshot;
		const changed = trackHeightResize.changed;
		if (cancelled && changed) restoreSnapshot(beforeSnapshot);
		if (!cancelled && changed) timelineStore._setTracks([...timelineStore.tracks]);
		cleanupTrackHeightResize();
		if (!cancelled && changed) {
			commandHistory.addUndoEntry({ type: 'RESIZE_TRACK_HEIGHT' }, beforeSnapshot);
			onedit();
		}
	}

	function finishTrackHeightResize(event: PointerEvent): void {
		if (!trackHeightResize || event.pointerId !== trackHeightResize.pointerId) return;
		event.preventDefault();
		applyTrackHeightResize(event.clientY);
		completeTrackHeightResize(false);
	}

	function cancelTrackHeightResize(event?: PointerEvent): void {
		if (event && trackHeightResize && event.pointerId !== trackHeightResize.pointerId) return;
		completeTrackHeightResize(true);
	}

	function onTrackHeightResizeKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		completeTrackHeightResize(true);
	}

	function startTrackHeightResize(event: PointerEvent, trackId: string): void {
		if (event.button !== 0 || trackHeightResize) return;
		clearHoverPreview();
		const track = timelineStore.tracks.find((candidate) => candidate.id === trackId);
		if (!track) return;
		event.preventDefault();
		event.stopPropagation();
		editorSession.pausePlayback();
		trackHeightResize = {
			pointerId: event.pointerId,
			trackId,
			startY: event.clientY,
			startHeight: track.height,
			applyToAll: event.altKey,
			beforeSnapshot: captureSnapshot(),
			changed: false,
			bodyCursor: document.body.style.cursor,
			bodyUserSelect: document.body.style.userSelect
		};
		document.body.style.cursor = 'row-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', moveTrackHeightResize);
		window.addEventListener('pointerup', finishTrackHeightResize);
		window.addEventListener('pointercancel', cancelTrackHeightResize);
		window.addEventListener('keydown', onTrackHeightResizeKeydown);
	}

	function resetTrackHeight(event: MouseEvent, trackId: string): void {
		event.preventDefault();
		event.stopPropagation();
		const before = captureSnapshot();
		const next = resetTrackHeightsInList(timelineStore.tracks, trackId, event.altKey);
		if (next === timelineStore.tracks) return;
		timelineStore._setTracks(next);
		commandHistory.addUndoEntry({ type: 'RESET_TRACK_HEIGHT' }, before);
		onedit();
	}

	function resizeTrackHeightFromKeyboard(event: KeyboardEvent, trackId: string): void {
		let height: number | null = null;
		const track = timelineStore.tracks.find((candidate) => candidate.id === trackId);
		if (!track) return;
		if (event.key === 'ArrowUp') height = track.height - (event.shiftKey ? 12 : 4);
		else if (event.key === 'ArrowDown') height = track.height + (event.shiftKey ? 12 : 4);
		else if (event.key === 'Home') height = MIN_TRACK_HEIGHT;
		else if (event.key === 'End') height = MAX_TRACK_HEIGHT;
		else return;
		event.preventDefault();
		event.stopPropagation();
		const before = captureSnapshot();
		const next = event.altKey
			? resizeAllTracksInList(timelineStore.tracks, height)
			: resizeTrackInList(timelineStore.tracks, trackId, height);
		if (next === timelineStore.tracks) return;
		timelineStore._setTracks(next);
		commandHistory.addUndoEntry({ type: 'RESIZE_TRACK_HEIGHT' }, before);
		onedit();
	}

	function markerName(marker: TimelineMarker): string {
		const ordered = [...timelineStore.markers].sort(
			(left, right) => left.frame - right.frame || left.id.localeCompare(right.id)
		);
		const index = Math.max(
			0,
			ordered.findIndex((candidate) => candidate.id === marker.id)
		);
		return markerDisplayName(marker, index, (number) => m.video_editor_marker_number({ number }));
	}

	function markerColorForInput(color: string): string {
		return /^#[0-9a-f]{6}$/i.test(color) ? color : '#d97746';
	}

	function selectMarker(marker: TimelineMarker): void {
		timelineStore._setSelectedMarkerId(marker.id);
		selectedItemId = null;
		selectedItemIds = [];
		selectedTransitionId = null;
		setCurrentFrame(marker.frame);
	}

	function addMarkerAtPlayhead(): void {
		const id = addMarker(timelineStore.currentFrame);
		timelineStore._setSelectedMarkerId(id);
		selectedItemId = null;
		selectedItemIds = [];
		selectedTransitionId = null;
		onedit();
	}

	function jumpToMarker(marker: TimelineMarker | undefined): void {
		if (!marker) return;
		selectMarker(marker);
	}

	function deleteTimelineMarker(markerId: string): void {
		if (!timelineStore.markers.some((marker) => marker.id === markerId)) return;
		removeMarker(markerId);
		onedit();
	}

	function commitMarkerPatch(
		marker: TimelineMarker,
		patch: Partial<{ frame: number; label: string; color: string }>
	): void {
		const changed =
			(patch.frame !== undefined && patch.frame !== marker.frame) ||
			(patch.label !== undefined && patch.label !== (marker.label ?? '')) ||
			(patch.color !== undefined && patch.color !== marker.color);
		if (!changed) return;
		if (patch.frame !== undefined) setCurrentFrame(patch.frame);
		if (updateMarker(marker.id, patch)) onedit();
	}

	function applyMarkerDrag(clientX: number): void {
		if (!markerDrag) return;
		const frame = frameFromClientX(clientX);
		if (frame === undefined) return;
		const marker = timelineStore.markers.find((candidate) => candidate.id === markerDrag?.markerId);
		if (!marker || marker.frame === frame) return;
		timelineStore.setAll({
			markers: timelineStore.markers.map((candidate) =>
				candidate.id === marker.id ? { ...candidate, frame } : candidate
			)
		});
		setCurrentFrame(frame);
		markerDrag.changed = true;
	}

	function moveMarkerDrag(event: PointerEvent): void {
		if (!markerDrag || event.pointerId !== markerDrag.pointerId) return;
		event.preventDefault();
		applyMarkerDrag(event.clientX);
	}

	function cleanupMarkerDrag(): void {
		if (!markerDrag) return;
		document.body.style.cursor = markerDrag.bodyCursor;
		document.body.style.userSelect = markerDrag.bodyUserSelect;
		window.removeEventListener('pointermove', moveMarkerDrag);
		window.removeEventListener('pointerup', finishMarkerDrag);
		window.removeEventListener('pointercancel', cancelMarkerDrag);
		window.removeEventListener('keydown', onMarkerDragKeydown);
		markerDrag = null;
	}

	function completeMarkerDrag(cancelled: boolean): void {
		if (!markerDrag) return;
		const beforeSnapshot = markerDrag.beforeSnapshot;
		const changed = markerDrag.changed;
		if (cancelled && changed) restoreSnapshot(beforeSnapshot);
		if (!cancelled && changed) timelineStore._setMarkers([...timelineStore.markers]);
		cleanupMarkerDrag();
		if (!cancelled && changed) {
			commandHistory.addUndoEntry({ type: 'MOVE_MARKER' }, beforeSnapshot);
			onedit();
		}
	}

	function finishMarkerDrag(event: PointerEvent): void {
		if (!markerDrag || event.pointerId !== markerDrag.pointerId) return;
		event.preventDefault();
		completeMarkerDrag(false);
	}

	function cancelMarkerDrag(event?: PointerEvent): void {
		if (event && markerDrag && event.pointerId !== markerDrag.pointerId) return;
		completeMarkerDrag(true);
	}

	function onMarkerDragKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		completeMarkerDrag(true);
	}

	function startMarkerDrag(event: PointerEvent, marker: TimelineMarker): void {
		shuttleScrubResume.cancel();
		if (event.button !== 0 || markerDrag) return;
		clearHoverPreview();
		event.preventDefault();
		event.stopPropagation();
		editorSession.pausePlayback();
		selectMarker(marker);
		markerDrag = {
			pointerId: event.pointerId,
			markerId: marker.id,
			beforeSnapshot: captureSnapshot(),
			changed: false,
			bodyCursor: document.body.style.cursor,
			bodyUserSelect: document.body.style.userSelect
		};
		document.body.style.cursor = 'grabbing';
		document.body.style.userSelect = 'none';
		window.addEventListener('pointermove', moveMarkerDrag);
		window.addEventListener('pointerup', finishMarkerDrag);
		window.addEventListener('pointercancel', cancelMarkerDrag);
		window.addEventListener('keydown', onMarkerDragKeydown);
	}

	function onMarkerKeydown(event: KeyboardEvent, marker: TimelineMarker): void {
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			deleteTimelineMarker(marker.id);
			return;
		}
		let frame: number | null = null;
		if (event.key === 'ArrowLeft') frame = marker.frame - (event.shiftKey ? 10 : 1);
		else if (event.key === 'ArrowRight') frame = marker.frame + (event.shiftKey ? 10 : 1);
		else if (event.key === 'Home') frame = 0;
		else if (event.key === 'End') frame = timelineStore.maxItemEndFrame;
		else return;
		event.preventDefault();
		event.stopPropagation();
		commitMarkerPatch(marker, { frame: Math.max(0, frame) });
	}

	function clearEffectDropPreview(): void {
		effectDropTargetIds = [];
		effectDropHoveredItemId = null;
	}

	function resolveEffectTargets(itemId: string, payload: EffectDragData | null): string[] {
		if (!payload) return [];
		const lockedTrackIds = new Set(
			effectiveMediaTracks(timelineStore.tracks)
				.filter((track) => track.locked)
				.map((track) => track.id)
		);
		return resolveEffectDropTargetIds({
			hoveredItemId: itemId,
			items: timelineStore.items,
			selectedItemIds
		}).filter((targetId) => {
			const target = timelineStore.itemById.get(targetId);
			return !!target && !lockedTrackIds.has(target.trackId);
		});
	}

	function previewEffectDrop(event: DragEvent, itemId: string): void {
		const targetItemIds = resolveEffectTargets(itemId, getEffectDragData());
		if (targetItemIds.length === 0) {
			clearEffectDropPreview();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		if (
			effectDropHoveredItemId === itemId &&
			areItemIdListsEqual(effectDropTargetIds, targetItemIds)
		) {
			return;
		}
		effectDropTargetIds = targetItemIds;
		effectDropHoveredItemId = itemId;
	}

	function leaveEffectDrop(event: DragEvent, itemId: string): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		if (effectDropHoveredItemId === itemId) clearEffectDropPreview();
	}

	function dropEffect(event: DragEvent, itemId: string): void {
		const payload = getEffectDragData();
		const targetItemIds = resolveEffectTargets(itemId, payload);
		clearEffectDropPreview();
		clearEffectDragData();
		if (!payload || targetItemIds.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (addEffectTemplates(targetItemIds, payload.effects)) onedit();
	}

	function sceneFrameAtPointer(event: DragEvent): number {
		if (!scrollContainer) return timelineStore.currentFrame;
		const rect = scrollContainer.getBoundingClientRect();
		return pxToFrame(event.clientX - rect.left + scrollContainer.scrollLeft - TRACK_HEADER_WIDTH);
	}

	function openSceneTrack(preferredTrackId: string, from: number, end: number): string | null {
		const effectiveTracks = effectiveMediaTracks(timelineStore.tracks);
		const preferred = effectiveTracks.find((track) => track.id === preferredTrackId);
		const candidates = [
			...(preferred ? [preferred] : []),
			...effectiveTracks
				.filter((track) => track.id !== preferredTrackId)
				.toSorted((left, right) => right.order - left.order)
		];
		return (
			candidates.find(
				(track) =>
					track.kind === 'video' &&
					!track.locked &&
					!(timelineStore.itemsByTrackId.get(track.id) ?? []).some(
						(item) => item.from < end && item.from + item.durationInFrames > from
					)
			)?.id ?? null
		);
	}

	function previewSceneDrop(event: DragEvent, preferredTrackId: string): void {
		const payload = getSceneDragData(event.dataTransfer);
		const media = payload ? mediaPool.get(payload.scene.mediaId) : undefined;
		if (!payload || !media) {
			sceneDropPreview = null;
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		const from = sceneFrameAtPointer(event);
		const durationInFrames = Math.max(
			1,
			Math.round((payload.scene.endSec - payload.scene.startSec) * timelineStore.fps)
		);
		const nextPreview = {
			trackId: openSceneTrack(preferredTrackId, from, from + durationInFrames),
			from,
			durationInFrames,
			label: payload.scene.text || media.fileName
		};
		if (
			sceneDropPreview?.trackId === nextPreview.trackId &&
			sceneDropPreview.from === nextPreview.from &&
			sceneDropPreview.durationInFrames === nextPreview.durationInFrames &&
			sceneDropPreview.label === nextPreview.label
		) {
			return;
		}
		sceneDropPreview = nextPreview;
	}

	function leaveSceneDrop(event: DragEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		sceneDropPreview = null;
	}

	function dropScene(event: DragEvent, preferredTrackId: string): void {
		const payload = getSceneDragData(event.dataTransfer);
		const media = payload ? mediaPool.get(payload.scene.mediaId) : undefined;
		if (!payload || !media) return;
		event.preventDefault();
		event.stopPropagation();
		const preview = sceneDropPreview;
		const from = preview?.from ?? sceneFrameAtPointer(event);
		const itemId = insertSceneAtFrame(
			payload.scene,
			media,
			from,
			preview?.trackId ?? preferredTrackId
		);
		selectedItemId = itemId;
		selectedItemIds = [itemId];
		sceneDropPreview = null;
		clearSceneDragData();
		onedit();
	}

	function resolveDraggedMedia(payload: MediaDragData) {
		if (payload.source === 'media') {
			const media = mediaPool.get(payload.id);
			const entry = mediaPool.entry(payload.id);
			if (!media || entry?.status !== 'ready') return null;
			return {
				source: 'media' as const,
				media,
				composition: null,
				kind: mediaTimelineKind(media),
				durationInFrames: mediaDurationInFrames(media, timelineStore.fps),
				label: media.fileName
			};
		}
		const composition = sequenceStore.compositionById.get(payload.id);
		if (
			!composition ||
			wouldCreateCompositionCycle(
				sequenceStore.activeSequenceId,
				composition.id,
				sequenceStore.compositionById
			)
		) {
			return null;
		}
		const visual = composition.items.some((item) => item.type !== 'audio');
		const audio = composition.items.some((item) => item.type === 'audio' || item.type === 'video');
		if (!visual && !audio) return null;
		return {
			source: 'composition' as const,
			media: null,
			composition,
			kind: visual ? ('video' as const) : ('audio' as const),
			durationInFrames: Math.max(1, composition.durationInFrames),
			label: composition.name
		};
	}

	function snappedMediaFrame(clientX: number, durationInFrames: number): SnappedMediaFrame {
		if (!scrollContainer) {
			return { from: timelineStore.currentFrame, snapTarget: null };
		}
		const rect = scrollContainer.getBoundingClientRect();
		const rawFrame = pxToFrame(
			clientX - rect.left + scrollContainer.scrollLeft - TRACK_HEADER_WIDTH
		);
		if (!timelineStore.snapEnabled) {
			return { from: Math.max(0, Math.round(rawFrame)), snapTarget: null };
		}
		const targets = buildSnapTargets({
			items: timelineStore.items,
			tracks: timelineStore.tracks,
			transitions: transitionsStore.list,
			markers: timelineStore.markers,
			currentFrame: timelineStore.currentFrame,
			durationInFrames: timelineStore.maxItemEndFrame + fps * 10,
			fps,
			zoomLevel: zoom
		});
		const threshold = calculateAdaptiveSnapThreshold(zoom, pxPerFrame);
		const result = calculateMoveSnap(rawFrame, durationInFrames, targets, threshold);
		return {
			from: Math.max(0, result.snappedFrame),
			snapTarget: result.snapTarget ?? null
		};
	}

	function exactMediaDropResult(
		resolved: NonNullable<ReturnType<typeof resolveDraggedMedia>>,
		trackId: string,
		from: number
	) {
		return resolved.composition
			? planExactSequencePlacement({
					composition: resolved.composition,
					preferredTrackId: trackId,
					from,
					tracks: timelineStore.tracks,
					items: timelineStore.items
				})
			: evaluateExactMediaPlacement({
					trackId,
					from,
					durationInFrames: resolved.durationInFrames,
					kind: resolved.kind,
					tracks: timelineStore.tracks,
					items: timelineStore.items
				});
	}

	function updateMediaDropPreview(
		payload: MediaDragData,
		trackId: string,
		from: number,
		snapTarget: SnapTarget | null = null
	): boolean {
		const resolved = resolveDraggedMedia(payload);
		if (!resolved) {
			clearMediaDropPreview();
			return false;
		}
		const result = exactMediaDropResult(resolved, trackId, from);
		mediaDropPreview = {
			trackId,
			secondaryTrackId:
				result.valid &&
				'audioTrackId' in result.placement &&
				result.placement.audioTrackId !== trackId
					? (result.placement.audioTrackId ?? null)
					: null,
			from: Math.max(0, Math.round(from)),
			durationInFrames: resolved.durationInFrames,
			label: resolved.label,
			valid: result.valid,
			reason: result.valid ? null : result.reason,
			snapTarget
		};
		activeSnapTarget = snapTarget;
		return result.valid;
	}

	function clearMediaDropPreview(cancelRequest = false): void {
		mediaDropPreview = null;
		pendingMediaDrop = null;
		activeNativeMediaDrop = null;
		activeSnapTarget = null;
		if (mediaDropAnimationFrame !== null) {
			cancelAnimationFrame(mediaDropAnimationFrame);
			mediaDropAnimationFrame = null;
		}
		if (mediaDropAutoScrollFrame !== null) {
			cancelAnimationFrame(mediaDropAutoScrollFrame);
			mediaDropAutoScrollFrame = null;
		}
		if (cancelRequest) mediaPlacement.cancel();
	}

	function runMediaDropAutoScroll(): void {
		mediaDropAutoScrollFrame = null;
		const active = activeNativeMediaDrop;
		if (!active || !scrollContainer) return;
		const rect = scrollContainer.getBoundingClientRect();
		const delta = mediaDropAutoScrollDelta(active.clientX, rect.left, rect.right);
		if (delta === 0) return;
		const before = scrollContainer.scrollLeft;
		scrollContainer.scrollLeft += delta;
		if (scrollContainer.scrollLeft === before) return;
		pendingMediaDrop = active;
		if (mediaDropAnimationFrame === null) {
			mediaDropAnimationFrame = requestAnimationFrame(flushMediaDropPreview);
		}
		mediaDropAutoScrollFrame = requestAnimationFrame(runMediaDropAutoScroll);
	}

	function scheduleMediaDropAutoScroll(): void {
		if (mediaDropAutoScrollFrame === null) {
			mediaDropAutoScrollFrame = requestAnimationFrame(runMediaDropAutoScroll);
		}
	}

	function flushMediaDropPreview(): void {
		mediaDropAnimationFrame = null;
		const pending = pendingMediaDrop;
		pendingMediaDrop = null;
		if (!pending) return;
		const resolved = resolveDraggedMedia(pending.payload);
		if (!resolved) {
			clearMediaDropPreview();
			return;
		}
		const position = snappedMediaFrame(pending.clientX, resolved.durationInFrames);
		updateMediaDropPreview(pending.payload, pending.trackId, position.from, position.snapTarget);
	}

	function previewMediaDrop(event: DragEvent, trackId: string): boolean {
		const payload = getMediaDragData(event.dataTransfer);
		if (!payload || !resolveDraggedMedia(payload)) return false;
		event.preventDefault();
		event.stopPropagation();
		pendingMediaDrop = { clientX: event.clientX, trackId, payload };
		activeNativeMediaDrop = pendingMediaDrop;
		if (mediaDropAnimationFrame === null) {
			mediaDropAnimationFrame = requestAnimationFrame(flushMediaDropPreview);
		}
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect =
				mediaDropPreview?.trackId === trackId && mediaDropPreview.valid ? 'copy' : 'none';
		}
		scheduleMediaDropAutoScroll();
		return true;
	}

	function leaveMediaDrop(event: DragEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		clearMediaDropPreview();
	}

	function commitMediaPlacement(payload: MediaDragData): boolean {
		const preview = mediaDropPreview;
		const resolved = resolveDraggedMedia(payload);
		if (!preview || !preview.valid || !resolved) return false;
		try {
			const ids = resolved.media
				? [
						insertMediaAtFrame(resolved.media, preview.from, {
							exactTrackId: preview.trackId,
							label: resolved.label
						})
					]
				: nestSequenceOnExactTracks(resolved.composition!.id, preview.from, {
						visualTrackId: resolved.kind === 'video' ? preview.trackId : undefined,
						audioTrackId:
							resolved.kind === 'audio' ? preview.trackId : (preview.secondaryTrackId ?? undefined)
					});
			selectedItemId = ids[0] ?? null;
			selectedItemIds = ids;
			clearMediaDropPreview(true);
			clearActiveMediaDrag();
			onedit();
			return true;
		} catch {
			updateMediaDropPreview(payload, preview.trackId, preview.from, preview.snapTarget);
			return false;
		}
	}

	function dropMedia(event: DragEvent, trackId: string): boolean {
		const payload = getMediaDragData(event.dataTransfer);
		const resolved = payload ? resolveDraggedMedia(payload) : null;
		if (!payload || !resolved) return false;
		event.preventDefault();
		event.stopPropagation();
		const position = snappedMediaFrame(event.clientX, resolved.durationInFrames);
		updateMediaDropPreview(payload, trackId, position.from, position.snapTarget);
		const inserted = commitMediaPlacement(payload);
		if (!inserted) {
			clearMediaDropPreview();
			clearActiveMediaDrag();
		}
		return true;
	}

	function candidatePlacementTracks(payload: MediaDragData) {
		const resolved = resolveDraggedMedia(payload);
		if (!resolved) return [];
		return visibleTrackRows(timelineStore.tracks).filter(
			(track) => !isTrackGroup(track) && track.kind === resolved.kind
		);
	}

	function beginAccessibleMediaPlacement(payload: MediaDragData): void {
		const resolved = resolveDraggedMedia(payload);
		const candidates = candidatePlacementTracks(payload);
		if (!resolved || candidates.length === 0) {
			clearMediaDropPreview(true);
			return;
		}
		const from = timelineStore.currentFrame;
		const open = candidates.find((track) => exactMediaDropResult(resolved, track.id, from).valid);
		updateMediaDropPreview(payload, (open ?? candidates[0])!.id, from);
		queueMicrotask(() => scrollContainer?.focus({ preventScroll: true }));
	}

	function moveAccessibleMediaTrack(payload: MediaDragData, direction: -1 | 1): void {
		if (!mediaDropPreview) return;
		const candidates = candidatePlacementTracks(payload);
		if (candidates.length === 0) return;
		const currentIndex = candidates.findIndex((track) => track.id === mediaDropPreview?.trackId);
		const nextIndex = (currentIndex + direction + candidates.length) % candidates.length;
		const next = candidates[nextIndex];
		if (next) updateMediaDropPreview(payload, next.id, mediaDropPreview.from);
	}

	function handleAccessibleMediaPlacementKey(event: KeyboardEvent): boolean {
		const request = mediaPlacement.request;
		if (!request || !mediaDropPreview) return false;
		if (event.key === 'Escape') {
			event.preventDefault();
			clearMediaDropPreview(true);
			return true;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			commitMediaPlacement(request.payload);
			return true;
		}
		if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			moveAccessibleMediaTrack(request.payload, event.key === 'ArrowUp' ? -1 : 1);
			return true;
		}
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const delta = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowLeft' ? -1 : 1);
			updateMediaDropPreview(
				request.payload,
				mediaDropPreview.trackId,
				Math.max(0, mediaDropPreview.from + delta)
			);
			return true;
		}
		return false;
	}

	function placeMediaWithPointer(event: PointerEvent, trackId: string): boolean {
		const request = mediaPlacement.request;
		const resolved = request ? resolveDraggedMedia(request.payload) : null;
		if (!request || !resolved) return false;
		event.preventDefault();
		event.stopPropagation();
		const position = snappedMediaFrame(event.clientX, resolved.durationInFrames);
		updateMediaDropPreview(request.payload, trackId, position.from, position.snapTarget);
		commitMediaPlacement(request.payload);
		return true;
	}

	function marqueeStyle(): string {
		if (!marquee || !scrollContainer) return '';
		const rect = scrollContainer.getBoundingClientRect();
		const left =
			Math.min(marquee.startX, marquee.currentX) - rect.left + scrollContainer.scrollLeft;
		const top = Math.min(marquee.startY, marquee.currentY) - rect.top + scrollContainer.scrollTop;
		return `left:${left}px;top:${top}px;width:${Math.abs(marquee.currentX - marquee.startX)}px;height:${Math.abs(marquee.currentY - marquee.startY)}px`;
	}

	function updateMarqueeSelection(): void {
		if (!marquee?.active || !scrollContainer) return;
		selectedTransitionId = null;
		const selectionRect = {
			left: Math.min(marquee.startX, marquee.currentX),
			right: Math.max(marquee.startX, marquee.currentX),
			top: Math.min(marquee.startY, marquee.currentY),
			bottom: Math.max(marquee.startY, marquee.currentY)
		};
		const containerRect = scrollContainer.getBoundingClientRect();
		const contentLeft =
			selectionRect.left - containerRect.left + scrollContainer.scrollLeft - TRACK_HEADER_WIDTH;
		const contentRight =
			selectionRect.right - containerRect.left + scrollContainer.scrollLeft - TRACK_HEADER_WIDTH;
		const frameRange = {
			start: Math.max(0, contentLeft / pxPerFrame),
			end: Math.max(0, contentRight / pxPerFrame)
		};
		const hitIds: string[] = [];
		if (frameRange.end > frameRange.start) {
			for (const trackElement of scrollContainer.querySelectorAll<HTMLElement>('[data-track]')) {
				const trackRect = trackElement.getBoundingClientRect();
				if (trackRect.top >= selectionRect.bottom || trackRect.bottom <= selectionRect.top)
					continue;
				const trackId = trackElement.dataset.track;
				const index = trackId ? timelineItemRangeIndexes.get(trackId) : undefined;
				if (!index) continue;
				for (const item of queryTimelineItemRange(index, frameRange)) hitIds.push(item.id);
			}
		}
		selectedItemIds = marquee.additive
			? Array.from(new Set([...marquee.baseIds, ...hitIds]))
			: hitIds;
		selectedItemId = hitIds.at(-1) ?? selectedItemIds.at(-1) ?? null;
	}

	function onMarqueePointerMove(event: PointerEvent): void {
		if (!marquee) return;
		marquee.currentX = event.clientX;
		marquee.currentY = event.clientY;
		if (
			!marquee.active &&
			Math.hypot(event.clientX - marquee.startX, event.clientY - marquee.startY) >=
				DRAG_THRESHOLD_PIXELS
		) {
			marquee.active = true;
		}
		updateMarqueeSelection();
	}

	function finishMarquee(): void {
		if (!marquee) return;
		if (!marquee.active && !marquee.additive) {
			selectedItemIds = [];
			selectedItemId = null;
			selectedTransitionId = null;
		}
		marquee = null;
		window.removeEventListener('pointermove', onMarqueePointerMove);
		window.removeEventListener('pointerup', finishMarquee);
		window.removeEventListener('pointercancel', finishMarquee);
	}

	function startMarquee(event: PointerEvent): void {
		if (event.button !== 0 || drag || marquee) return;
		const target = event.target;
		if (!(target instanceof HTMLElement) || !target.closest('[data-track]')) return;
		if (target.closest('button, input, select, textarea, [data-marquee-ignore]')) return;
		clearHoverPreview();
		event.preventDefault();
		const additive = event.metaKey || event.ctrlKey || event.shiftKey;
		marquee = {
			startX: event.clientX,
			startY: event.clientY,
			currentX: event.clientX,
			currentY: event.clientY,
			active: false,
			additive,
			baseIds: additive ? [...selectedItemIds] : []
		};
		window.addEventListener('pointermove', onMarqueePointerMove);
		window.addEventListener('pointerup', finishMarquee);
		window.addEventListener('pointercancel', finishMarquee);
	}

	function trackForItem(item: TimelineItem) {
		return effectiveMediaTracks(timelineStore.tracks).find((track) => track.id === item.trackId);
	}

	function trackPushAvailability(item: TimelineItem): 'ready' | 'no-gap' | 'locked' {
		if (trackPushGapBefore(item, timelineStore.items) <= 0) return 'no-gap';
		if (latestLockedItemFrame >= item.from) return 'locked';
		return 'ready';
	}

	function trackPushTitle(item: TimelineItem): string {
		const availability = trackPushAvailability(item);
		if (availability === 'no-gap') return m.video_editor_track_push_no_gap();
		if (availability === 'locked') return m.video_editor_track_push_locked();
		return `${m.video_editor_track_push_handle()}. ${m.video_editor_track_push_hint()}`;
	}

	function snapTargetsFor(ids: string[]): SnapTarget[] {
		return buildSnapTargets({
			items: timelineStore.items,
			tracks: timelineStore.tracks,
			transitions: transitionsStore.list,
			markers: timelineStore.markers,
			currentFrame: timelineStore.currentFrame,
			durationInFrames: timelineStore.maxItemEndFrame + fps * 10,
			fps,
			zoomLevel: zoom,
			excludeItemIds: ids
		});
	}

	function findRollingNeighbor(item: TimelineItem, kind: TimelineDragKind): TimelineItem | null {
		if (kind === 'trim-end') {
			const end = item.from + item.durationInFrames;
			return (
				timelineStore.items.find(
					(candidate) =>
						candidate.id !== item.id && candidate.trackId === item.trackId && candidate.from === end
				) ?? null
			);
		}
		if (kind === 'trim-start') {
			return (
				timelineStore.items.find(
					(candidate) =>
						candidate.id !== item.id &&
						candidate.trackId === item.trackId &&
						candidate.from + candidate.durationInFrames === item.from
				) ?? null
			);
		}
		return null;
	}

	interface SlideNeighbors {
		left: TimelineItem | null;
		right: TimelineItem | null;
	}

	function findSlideNeighbors(item: TimelineItem): SlideNeighbors {
		const end = item.from + item.durationInFrames;
		return {
			left:
				timelineStore.items.find(
					(candidate) =>
						candidate.id !== item.id &&
						candidate.trackId === item.trackId &&
						candidate.from + candidate.durationInFrames === item.from
				) ?? null,
			right:
				timelineStore.items.find(
					(candidate) =>
						candidate.id !== item.id && candidate.trackId === item.trackId && candidate.from === end
				) ?? null
		};
	}

	function unlockedEditItems(snapshot: TimelineSnapshot): TimelineItem[] {
		const lockedTrackIds = new Set(
			effectiveMediaTracks(snapshot.tracks)
				.filter((track) => track.locked)
				.map((track) => track.id)
		);
		return snapshot.items.map((item) =>
			(!timelineStore.linkedSelectionEnabled || lockedTrackIds.has(item.trackId)) &&
			item.linkedGroupId
				? { ...item, linkedGroupId: undefined }
				: item
		);
	}

	function selectItem(event: MouseEvent, id: string): void {
		const previousPrimaryId = selectedItemId;
		selectedTransitionId = null;
		const selection = updateTimelineItemSelection(
			timelineStore.items,
			selectedItemIds,
			id,
			timelineStore.linkedSelectionEnabled,
			event.metaKey || event.ctrlKey
		);
		selectedItemIds = selection.ids;
		selectedItemId = selection.primaryId;
		if (selectedItemId !== previousPrimaryId) {
			emitEditorSound('select', editorSession.clock.isPlaying);
		}
	}

	function linkSelection(): void {
		if (!linkItems(selectedItemIds)) return;
		selectedItemIds = expandSelectionWithLinkedItems(timelineStore.items, selectedItemIds);
		selectedItemId = selectedItemIds.at(-1) ?? null;
		onedit();
	}

	function unlinkSelection(): void {
		if (!unlinkItems(selectedItemIds)) return;
		onedit();
	}

	function joinSelection(): void {
		const joinedIds = joinItems(selectedItemIds);
		if (joinedIds.length === 0) return;
		selectedItemIds = joinedIds;
		selectedItemId = joinedIds.at(-1) ?? null;
		onedit();
	}

	function consolidateSelection(): void {
		if (!captionConsolidationTarget) return;
		const result = consolidateCaptionItems(captionConsolidationTarget);
		if (result.itemIds.length === 0) return;
		selectedItemIds = result.itemIds;
		selectedItemId = result.itemIds.at(-1) ?? null;
		onedit();
	}

	function onPanelKeydown(event: KeyboardEvent): void {
		if (handleAccessibleMediaPlacementKey(event)) return;
		if (editorShortcutTargetIsDisabled(event.target)) return;
		const bindings = keyboardShortcuts.bindings;
		const matches = (...ids: EditorShortcutId[]) =>
			ids.some((id) => eventMatchesShortcut(event, bindings[id]));
		if (matches('ZOOM_IN')) {
			event.preventDefault();
			zoomBy(TIMELINE_ZOOM_STEP);
			return;
		}
		if (matches('ZOOM_OUT')) {
			event.preventDefault();
			zoomBy(1 / TIMELINE_ZOOM_STEP);
			return;
		}
		if (matches('ZOOM_TO_100_ALT')) {
			event.preventDefault();
			zoomTo100();
			return;
		}
		if (matches('ZOOM_TO_FIT', 'ZOOM_TO_100')) {
			event.preventDefault();
			if (matches('ZOOM_TO_100')) zoomTo100();
			else zoomToFit();
			return;
		}
		if (matches('LINK_AUDIO_VIDEO')) {
			event.preventDefault();
			linkSelection();
		} else if (matches('UNLINK_AUDIO_VIDEO')) {
			event.preventDefault();
			unlinkSelection();
		} else if (matches('JOIN_ITEMS')) {
			event.preventDefault();
			joinSelection();
		} else if (matches('CLEAR_KEYFRAMES')) {
			event.preventDefault();
			openClearKeyframesDialog();
		} else if (matches('RATE_STRETCH_TOOL')) {
			event.preventDefault();
			toggleEditTool('rate-stretch');
		}
	}

	function isRateStretchKind(kind: TimelineDragKind): boolean {
		return kind === 'rate-stretch' || kind === 'rate-stretch-start' || kind === 'rate-stretch-end';
	}

	function audioVolumeDb(item: TimelineItem): number {
		return linearGainToDb(item.volume ?? 1);
	}

	function applyAudioVolumeFrame(clientY: number): void {
		if (!audioVolumeDrag) return;
		const pointerDeltaY = clientY - audioVolumeDrag.startClientY;
		if (!audioVolumeDrag.activated && Math.abs(pointerDeltaY) < 4) return;
		audioVolumeDrag.activated = true;
		const nextDb = audioVolumeDbFromDrag({
			startDb: audioVolumeDrag.startDb,
			pointerDeltaY,
			height: audioVolumeDrag.rowHeight
		});
		timelineStore._updateItems([
			{ id: audioVolumeDrag.itemId, patch: { volume: dbToLinearGain(nextDb) } }
		]);
	}

	function removeAudioVolumeListeners(completed: NonNullable<typeof audioVolumeDrag>): void {
		window.removeEventListener('pointermove', onAudioVolumePointerMove);
		window.removeEventListener('pointerup', onAudioVolumePointerUp);
		window.removeEventListener('pointercancel', onAudioVolumePointerCancel);
		window.removeEventListener('keydown', onAudioVolumeKeydown);
		completed.target.removeEventListener('lostpointercapture', onAudioVolumeLostPointerCapture);
	}

	function finishAudioVolumeDrag(cancelled: boolean): void {
		if (!audioVolumeDrag) return;
		const completed = audioVolumeDrag;
		if (completed.animationFrame !== null) cancelAnimationFrame(completed.animationFrame);
		if (!cancelled) applyAudioVolumeFrame(completed.latestClientY);
		audioVolumeDrag = null;
		removeAudioVolumeListeners(completed);
		if (completed.target.hasPointerCapture(completed.pointerId)) {
			completed.target.releasePointerCapture(completed.pointerId);
		}
		if (cancelled) {
			restoreSnapshot(completed.beforeSnapshot);
			return;
		}
		if (!snapshotsEqual(completed.beforeSnapshot, captureSnapshot())) {
			commandHistory.addUndoEntry({ type: 'ADJUST_CLIP_VOLUME' }, completed.beforeSnapshot);
			onedit();
		}
	}

	function onAudioVolumePointerMove(event: PointerEvent): void {
		if (!audioVolumeDrag || event.pointerId !== audioVolumeDrag.pointerId) return;
		audioVolumeDrag.latestClientY = event.clientY;
		if (audioVolumeDrag.animationFrame !== null) return;
		audioVolumeDrag.animationFrame = requestAnimationFrame(() => {
			if (!audioVolumeDrag) return;
			audioVolumeDrag.animationFrame = null;
			applyAudioVolumeFrame(audioVolumeDrag.latestClientY);
		});
	}

	function onAudioVolumePointerUp(event: PointerEvent): void {
		if (!audioVolumeDrag || event.pointerId !== audioVolumeDrag.pointerId) return;
		audioVolumeDrag.latestClientY = event.clientY;
		finishAudioVolumeDrag(false);
	}

	function onAudioVolumePointerCancel(event: PointerEvent): void {
		if (audioVolumeDrag?.pointerId === event.pointerId) finishAudioVolumeDrag(true);
	}

	function onAudioVolumeLostPointerCapture(event: PointerEvent): void {
		if (audioVolumeDrag?.pointerId === event.pointerId) finishAudioVolumeDrag(true);
	}

	function onAudioVolumeKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !audioVolumeDrag) return;
		event.preventDefault();
		finishAudioVolumeDrag(true);
	}

	function startAudioVolumeDrag(
		event: PointerEvent & { currentTarget: HTMLButtonElement },
		item: TimelineItem
	): void {
		if (
			event.button !== 0 ||
			item.type !== 'audio' ||
			activeEditTool !== null ||
			isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		shuttleScrubResume.cancel();
		const target = event.currentTarget;
		const rowHeight = target.parentElement?.getBoundingClientRect().height ?? 56;
		audioVolumeDrag = {
			pointerId: event.pointerId,
			itemId: item.id,
			startClientY: event.clientY,
			latestClientY: event.clientY,
			startDb: audioVolumeDb(item),
			rowHeight,
			beforeSnapshot: captureSnapshot(),
			target,
			animationFrame: null,
			activated: false
		};
		try {
			target.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointer events and older browsers may not own an active capture.
			// Window listeners still preserve the complete gesture lifecycle.
		}
		target.addEventListener('lostpointercapture', onAudioVolumeLostPointerCapture);
		window.addEventListener('pointermove', onAudioVolumePointerMove);
		window.addEventListener('pointerup', onAudioVolumePointerUp);
		window.addEventListener('pointercancel', onAudioVolumePointerCancel);
		window.addEventListener('keydown', onAudioVolumeKeydown);
	}

	function setAudioVolumeFromTimeline(item: TimelineItem, nextDb: number): void {
		const before = captureSnapshot();
		const nextGain = dbToLinearGain(clampAudioVolumeDb(nextDb));
		timelineStore._updateItems([{ id: item.id, patch: { volume: nextGain } }]);
		if (!snapshotsEqual(before, captureSnapshot())) {
			commandHistory.addUndoEntry({ type: 'ADJUST_CLIP_VOLUME' }, before);
			onedit();
		}
	}

	function adjustAudioVolumeWithKeyboard(event: KeyboardEvent, item: TimelineItem): void {
		const current = timelineStore.itemById.get(item.id);
		if (!current || current.type !== 'audio') return;
		if (event.key === 'Home') {
			event.preventDefault();
			setAudioVolumeFromTimeline(current, AUDIO_VOLUME_DB_MIN);
			return;
		}
		if (event.key === 'End') {
			event.preventDefault();
			setAudioVolumeFromTimeline(current, AUDIO_VOLUME_DB_MAX);
			return;
		}
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		const step = event.shiftKey ? 3 : 0.5;
		setAudioVolumeFromTimeline(
			current,
			audioVolumeDb(current) + (event.key === 'ArrowUp' ? step : -step)
		);
	}

	function rateStretchHandle(kind: TimelineDragKind): 'start' | 'end' {
		return kind === 'rate-stretch-start' ? 'start' : 'end';
	}

	function startDrag(event: PointerEvent, id: string, requestedKind: TimelineDragKind): void {
		if (event.button !== 0) return;
		shuttleScrubResume.cancel();
		clearHoverPreview();
		clearSyncLockPreview();
		breakingTransitionPreviewIds = [];
		event.stopPropagation();
		if (event.metaKey || event.ctrlKey || !selectedItemIds.includes(id)) selectItem(event, id);
		else selectedItemId = id;
		const item = timelineStore.itemById.get(id);
		if (!item || isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) return;
		const kind = requestedKind === 'move' && event.altKey ? 'slip' : requestedKind;
		if (kind === 'track-push' && trackPushGapBefore(item, timelineStore.items) <= 0) return;
		if (
			(kind === 'slip' || kind === 'slide' || isRateStretchKind(kind)) &&
			item.type !== 'video' &&
			item.type !== 'audio'
		)
			return;
		const rollingNeighbor =
			(kind === 'trim-start' || kind === 'trim-end') && event.altKey && !event.shiftKey
				? findRollingNeighbor(item, kind)
				: null;
		if ((kind === 'trim-start' || kind === 'trim-end') && event.altKey && !rollingNeighbor) return;
		const ripple = (kind === 'trim-start' || kind === 'trim-end') && event.shiftKey;
		let breakingTransitionIds =
			(kind === 'trim-start' || kind === 'trim-end') && !event.shiftKey && !event.altKey
				? transitionsStore.list
						.filter((transition) =>
							kind === 'trim-start'
								? transition.toItemId === item.id
								: transition.fromItemId === item.id
						)
						.map((transition) => transition.id)
				: [];
		const beforeSnapshot = captureSnapshot();
		const trackPushPlan =
			kind === 'track-push'
				? createTrackPushGesturePlan({
						anchorId: item.id,
						items: beforeSnapshot.items,
						tracks: beforeSnapshot.tracks,
						transitions: beforeSnapshot.transitions
					})
				: null;
		if (trackPushPlan?.blockedBy) return;
		if (trackPushPlan) breakingTransitionIds = trackPushPlan.breakingTransitionIds;
		const slideNeighbors = kind === 'slide' ? findSlideNeighbors(item) : null;
		breakingTransitionPreviewIds = breakingTransitionIds;
		const editItems = unlockedEditItems(beforeSnapshot);
		const moveSelectionIds = selectedItemIds.includes(id) ? selectedItemIds : [id];
		const synchronizedIds = Array.from(
			new Set(
				moveSelectionIds.flatMap((selectedId) =>
					getSynchronizedLinkedItems(editItems, selectedId).map((candidate) => candidate.id)
				)
			)
		);
		const rippleDownstreamIds = ripple
			? editItems
					.filter(
						(candidate) =>
							candidate.trackId === item.trackId &&
							candidate.from >= item.from + item.durationInFrames
					)
					.map((candidate) => candidate.id)
			: [];
		const excludedIds = [
			...(trackPushPlan
				? trackPushPlan.shiftedItems.map((candidate) => candidate.id)
				: synchronizedIds),
			...rippleDownstreamIds,
			...(rollingNeighbor ? [rollingNeighbor.id] : []),
			...(slideNeighbors?.left ? [slideNeighbors.left.id] : []),
			...(slideNeighbors?.right ? [slideNeighbors.right.id] : [])
		];
		event.preventDefault();
		drag = {
			kind,
			id,
			pointerId: event.pointerId,
			startX: event.clientX,
			original: $state.snapshot(item),
			beforeSnapshot,
			editItems,
			selectedItemIds: [...moveSelectionIds],
			snapTargets: snapTargetsFor(excludedIds),
			rollingNeighbor: rollingNeighbor ? $state.snapshot(rollingNeighbor) : null,
			ripple,
			rippleMoveIds: [],
			breakingTransitionIds,
			stretchHandle: rateStretchHandle(kind),
			slideLeft: slideNeighbors?.left ? $state.snapshot(slideNeighbors.left) : null,
			slideRight: slideNeighbors?.right ? $state.snapshot(slideNeighbors.right) : null,
			trackPushPlan,
			trackPushDelta: 0,
			activated:
				kind === 'track-push' ||
				kind === 'trim-start' ||
				kind === 'trim-end' ||
				isRateStretchKind(kind),
			latestClientX: event.clientX,
			rafId: null
		};
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerCancel);
		window.addEventListener('keydown', onDragKeyDown);
		window.addEventListener('keyup', onDragKeyUp);
	}

	function snapThreshold(): number {
		return calculateAdaptiveSnapThreshold(zoom, pxPerFrame);
	}

	function onPointerMove(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.latestClientX = event.clientX;
		if (drag.rafId !== null) return;
		drag.rafId = requestAnimationFrame(() => {
			if (!drag) return;
			drag.rafId = null;
			applyPointerFrame(drag.latestClientX);
		});
	}

	function applyPointerFrame(clientX: number): void {
		if (!drag) return;
		const pixelDelta = clientX - drag.startX;
		if (!drag.activated && Math.abs(pixelDelta) < DRAG_THRESHOLD_PIXELS) return;
		drag.activated = true;
		const deltaFrames = pxDeltaToFrames(pixelDelta);
		if (drag.kind === 'track-push' && drag.trackPushPlan) {
			const plan = resolveTrackPush(
				drag.trackPushPlan,
				deltaFrames,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold()
			);
			activeSnapTarget = plan.snapTarget;
			if (plan.delta === drag.trackPushDelta) return;
			drag.trackPushDelta = plan.delta;
			timelineStore._moveItems(plan.moves);
			return;
		}
		if (drag.kind === 'move') {
			const proposed = Math.max(0, drag.original.from + deltaFrames);
			const snap = timelineStore.snapEnabled
				? calculateMoveSnap(
						proposed,
						drag.original.durationInFrames,
						drag.snapTargets,
						snapThreshold()
					)
				: { snappedFrame: proposed, snapTarget: null, didSnap: false };
			const from = Math.max(0, snap.snappedFrame);
			activeSnapTarget = from === snap.snappedFrame ? snap.snapTarget : null;
			timelineStore._moveItems(
				planLinkedMoveGesture(drag.original, from, drag.editItems, drag.selectedItemIds)
			);
			return;
		}
		if (drag.kind === 'slip') {
			activeSnapTarget = null;
			const updates = planLinkedSlipGesture(
				drag.original,
				deltaFrames,
				drag.editItems,
				fps,
				drag.beforeSnapshot.transitions
			);
			if (updates.length > 0) {
				const anchorPatch = updates.find((candidate) => candidate.id === drag.id)?.patch;
				const hasSourceChange =
					anchorPatch?.sourceStart !== undefined &&
					anchorPatch.sourceStart !== (drag.original.sourceStart ?? 0);
				if (hasSourceChange) {
					timelineStore._updateItems(updates);
					ensureEditPreviewPublished();
				}
			}
			return;
		}
		if (drag.kind === 'slide') {
			const plan = planSlideGesture(
				drag.original,
				drag.slideLeft,
				drag.slideRight,
				deltaFrames,
				drag.editItems,
				fps,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold(),
				drag.beforeSnapshot.transitions
			);
			activeSnapTarget = plan.snapTarget;
			const hasSlideChange =
				plan.itemPatch.from !== undefined && plan.itemPatch.from !== drag.original.from;
			if (hasSlideChange) {
				timelineStore._updateItems([
					{ id: drag.id, patch: plan.itemPatch },
					...(drag.slideLeft && plan.leftPatch
						? [{ id: drag.slideLeft.id, patch: plan.leftPatch }]
						: []),
					...(drag.slideRight && plan.rightPatch
						? [{ id: drag.slideRight.id, patch: plan.rightPatch }]
						: []),
					...(plan.linkedPatches ?? [])
				]);
				ensureEditPreviewPublished();
			}
			return;
		}
		if (isRateStretchKind(drag.kind)) {
			const plan = planRateStretchGesture(
				drag.original,
				drag.stretchHandle,
				deltaFrames,
				drag.editItems,
				fps,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold(),
				drag.beforeSnapshot.transitions
			);
			if (!plan) return;
			activeSnapTarget = plan.snapTarget;
			timelineStore._updateItems([
				{ id: drag.id, patch: plan.patch },
				...(plan.linkedPatches ?? []),
				...plan.moves.map((move) => ({
					id: move.id,
					patch: { from: move.from }
				}))
			]);
			return;
		}
		if (drag.ripple) {
			const handle = drag.kind === 'trim-start' ? 'start' : 'end';
			const plan = planRippleTrimGesture(
				drag.original,
				handle,
				deltaFrames,
				drag.editItems,
				fps,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold(),
				drag.beforeSnapshot.transitions
			);
			activeSnapTarget = plan.snapTarget;
			const hasRippleChange =
				plan.patch.durationInFrames !== undefined &&
				plan.patch.durationInFrames !== drag.original.durationInFrames;
			if (hasRippleChange) {
				timelineStore._updateItems([
					{ id: drag.id, patch: plan.patch },
					...(plan.linkedPatches ?? []),
					...plan.moves.map((move) => ({
						id: move.id,
						patch: { from: move.from }
					}))
				]);
				drag.rippleMoveIds = plan.moves.map((move) => move.id);
				const durationInFrames = plan.patch.durationInFrames ?? drag.original.durationInFrames;
				const shift = durationInFrames - drag.original.durationInFrames;
				const editedTrackIds = new Set(
					getSynchronizedLinkedItems(drag.editItems, drag.original.id).map(
						(candidate) => candidate.trackId
					)
				);
				const oldEnd = drag.original.from + drag.original.durationInFrames;
				setSyncLockPreview(
					shift < 0
						? buildRemovedIntervalPreviewUpdatesForSyncLockedTracks({
								items: drag.beforeSnapshot.items,
								tracks: drag.beforeSnapshot.tracks,
								editedTrackIds,
								intervals: [{ start: oldEnd + shift, end: oldEnd }]
							})
						: shift > 0
							? buildInsertedGapPreviewUpdatesForSyncLockedTracks({
									items: drag.beforeSnapshot.items,
									tracks: drag.beforeSnapshot.tracks,
									editedTrackIds,
									cutFrame: oldEnd,
									amount: shift
								})
							: []
				);
				ensureEditPreviewPublished();
			}
			return;
		}
		if (drag.rollingNeighbor) {
			const left = drag.kind === 'trim-end' ? drag.original : drag.rollingNeighbor;
			const right = drag.kind === 'trim-start' ? drag.original : drag.rollingNeighbor;
			const plan = planRollingTrimGesture(
				left,
				right,
				deltaFrames,
				drag.editItems,
				fps,
				timelineStore.snapEnabled ? drag.snapTargets : [],
				snapThreshold(),
				drag.beforeSnapshot.transitions
			);
			if (plan) {
				const hasRollingChange =
					(plan.leftPatch.durationInFrames !== undefined &&
						plan.leftPatch.durationInFrames !== left.durationInFrames) ||
					(plan.rightPatch.durationInFrames !== undefined &&
						plan.rightPatch.durationInFrames !== right.durationInFrames);
				if (hasRollingChange) {
					activeSnapTarget = plan.snapTarget;
					timelineStore._updateItems([
						{ id: left.id, patch: plan.leftPatch },
						{ id: right.id, patch: plan.rightPatch },
						...(plan.linkedPatches ?? [])
					]);
					ensureEditPreviewPublished();
				} else {
					activeSnapTarget = plan.snapTarget;
				}
			}
			return;
		}
		const handle = drag.kind === 'trim-start' ? 'start' : 'end';
		const breakingTransitionIds = drag.breakingTransitionIds;
		const plan = planTrimGesture(
			drag.original,
			handle,
			deltaFrames,
			drag.editItems,
			fps,
			timelineStore.snapEnabled ? drag.snapTargets : [],
			snapThreshold(),
			drag.beforeSnapshot.transitions.filter(
				(transition) => !breakingTransitionIds.includes(transition.id)
			)
		);
		activeSnapTarget = plan.snapTarget;
		timelineStore._updateItems([{ id: drag.id, patch: plan.patch }, ...(plan.linkedPatches ?? [])]);
	}

	function commandTypeFor(kind: TimelineDragKind, rolling = false, ripple = false): string {
		if (ripple) return 'RIPPLE_EDIT';
		if (rolling) return 'ROLLING_EDIT';
		if (kind === 'track-push') return 'TRACK_PUSH';
		if (kind === 'trim-start') return 'TRIM_ITEM_START';
		if (kind === 'trim-end') return 'TRIM_ITEM_END';
		if (kind === 'slip') return 'SLIP_ITEM';
		if (kind === 'slide') return 'SLIDE_EDIT';
		if (isRateStretchKind(kind)) return 'RATE_STRETCH_ITEM';
		return 'MOVE_ITEMS';
	}

	function finishDrag(cancelled: boolean): void {
		if (!drag) return;
		const completed = drag;
		if (completed.rafId !== null) cancelAnimationFrame(completed.rafId);
		if (cancelled) {
			restoreSnapshot(completed.beforeSnapshot);
		} else if (completed.ripple) {
			const current = timelineStore.itemById.get(completed.id);
			const shift = current ? current.durationInFrames - completed.original.durationInFrames : 0;
			if (shift !== 0) {
				const editedTrackIds = new Set(
					getSynchronizedLinkedItems(completed.editItems, completed.original.id).map(
						(candidate) => candidate.trackId
					)
				);
				const oldEnd = completed.original.from + completed.original.durationInFrames;
				if (shift < 0) {
					propagateRemovedIntervalsToSyncLockedTracks({
						editedTrackIds,
						intervals: [{ start: oldEnd + shift, end: oldEnd }]
					});
				} else {
					propagateInsertedGapToSyncLockedTracks({
						editedTrackIds,
						cutFrame: oldEnd,
						amount: shift
					});
				}
				pruneOrphanedTransitions();
			}
		}
		const completedItem = timelineStore.itemById.get(completed.id);
		const didBoundaryEdit =
			completedItem !== undefined &&
			(completedItem.from !== completed.original.from ||
				completedItem.durationInFrames !== completed.original.durationInFrames);
		if (!cancelled && didBoundaryEdit && completed.breakingTransitionIds.length > 0) {
			const breakingIds = new Set(completed.breakingTransitionIds);
			const previousCount = transitionsStore.list.length;
			transitionsStore.setAll(
				transitionsStore.list.filter((transition) => !breakingIds.has(transition.id))
			);
			const removedCount = previousCount - transitionsStore.list.length;
			if (removedCount > 0) ontransitionbreak(removedCount);
		}
		clearSyncLockPreview();
		breakingTransitionPreviewIds = [];
		editPreviewStore.clear();
		if (!cancelled && !snapshotsEqual(completed.beforeSnapshot, captureSnapshot())) {
			commandHistory.addUndoEntry(
				{
					type: commandTypeFor(completed.kind, completed.rollingNeighbor !== null, completed.ripple)
				},
				completed.beforeSnapshot
			);
			onedit();
		}
		drag = null;
		activeSnapTarget = null;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerCancel);
		window.removeEventListener('keydown', onDragKeyDown);
		window.removeEventListener('keyup', onDragKeyUp);
	}

	function onPointerUp(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (drag.rafId !== null) {
			cancelAnimationFrame(drag.rafId);
			drag.rafId = null;
		}
		applyPointerFrame(drag.latestClientX);
		finishDrag(false);
	}

	function onPointerCancel(event: PointerEvent): void {
		if (drag && event.pointerId === drag.pointerId) finishDrag(true);
	}

	function setRippleMode(enabled: boolean): void {
		if (
			!drag ||
			(drag.kind !== 'trim-start' && drag.kind !== 'trim-end') ||
			drag.rollingNeighbor ||
			drag.breakingTransitionIds.length > 0 ||
			drag.ripple === enabled
		)
			return;
		if (!enabled && drag.rippleMoveIds.length > 0) {
			const originalById = new Map(drag.editItems.map((item) => [item.id, item]));
			timelineStore._moveItems(
				drag.rippleMoveIds.flatMap((id) => {
					const original = originalById.get(id);
					return original ? [{ id, from: original.from }] : [];
				})
			);
			drag.rippleMoveIds = [];
		}
		drag.ripple = enabled;
		if (!enabled) clearSyncLockPreview();
		applyPointerFrame(drag.latestClientX);
	}

	function onDragKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Shift') {
			setRippleMode(true);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			finishDrag(true);
		}
	}

	function onDragKeyUp(event: KeyboardEvent): void {
		if (event.key === 'Shift') setRippleMode(false);
	}

	function applyKeyboardEdit(
		event: KeyboardEvent,
		item: TimelineItem,
		kind: TimelineDragKind
	): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		if (isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) return;
		if (kind === 'track-push' && trackPushGapBefore(item, timelineStore.items) <= 0) return;
		event.preventDefault();
		event.stopPropagation();
		const direction = event.key === 'ArrowLeft' ? -1 : 1;
		const delta = direction * (event.shiftKey ? 10 : 1);
		const before = captureSnapshot();
		const editItems = unlockedEditItems(before);
		if (kind === 'track-push') {
			const gesture = createTrackPushGesturePlan({
				anchorId: item.id,
				items: before.items,
				tracks: before.tracks,
				transitions: before.transitions
			});
			const plan = resolveTrackPush(gesture, delta);
			if (plan.delta !== 0) {
				timelineStore._moveItems(plan.moves);
				if (gesture.breakingTransitionIds.length > 0) {
					const breakingIds = new Set(gesture.breakingTransitionIds);
					const previousCount = transitionsStore.list.length;
					transitionsStore.setAll(
						transitionsStore.list.filter((transition) => !breakingIds.has(transition.id))
					);
					const removedCount = previousCount - transitionsStore.list.length;
					if (removedCount > 0) ontransitionbreak(removedCount);
				}
			}
		} else if (kind === 'move') {
			timelineStore._moveItems(
				planLinkedMoveGesture(
					item,
					Math.max(0, item.from + delta),
					editItems,
					selectedItemIds.includes(item.id) ? selectedItemIds : [item.id]
				)
			);
		} else if (kind === 'slip') {
			const updates = planLinkedSlipGesture(item, delta, editItems, fps, before.transitions);
			if (updates.length > 0) timelineStore._updateItems(updates);
		} else if (kind === 'slide') {
			const { left, right } = findSlideNeighbors(item);
			const plan = planSlideGesture(
				item,
				left,
				right,
				delta,
				editItems,
				fps,
				[],
				1,
				before.transitions
			);
			timelineStore._updateItems([
				{ id: item.id, patch: plan.itemPatch },
				...(left && plan.leftPatch ? [{ id: left.id, patch: plan.leftPatch }] : []),
				...(right && plan.rightPatch ? [{ id: right.id, patch: plan.rightPatch }] : []),
				...(plan.linkedPatches ?? [])
			]);
		} else if (isRateStretchKind(kind)) {
			const plan = planRateStretchGesture(
				item,
				rateStretchHandle(kind),
				delta,
				editItems,
				fps,
				[],
				1,
				before.transitions
			);
			if (plan) {
				timelineStore._updateItems([
					{ id: item.id, patch: plan.patch },
					...(plan.linkedPatches ?? []),
					...plan.moves.map((move) => ({
						id: move.id,
						patch: { from: move.from }
					}))
				]);
			}
		} else if (event.altKey) {
			const neighbor = findRollingNeighbor(item, kind);
			if (!neighbor) return;
			const left = kind === 'trim-end' ? item : neighbor;
			const right = kind === 'trim-start' ? item : neighbor;
			const plan = planRollingTrimGesture(
				left,
				right,
				delta,
				editItems,
				fps,
				[],
				1,
				before.transitions
			);
			if (plan) {
				timelineStore._updateItems([
					{ id: left.id, patch: plan.leftPatch },
					{ id: right.id, patch: plan.rightPatch },
					...(plan.linkedPatches ?? [])
				]);
			}
		} else {
			const plan = planTrimGesture(
				item,
				kind === 'trim-start' ? 'start' : 'end',
				delta,
				editItems,
				fps,
				[],
				1,
				before.transitions
			);
			timelineStore._updateItems([
				{ id: item.id, patch: plan.patch },
				...(plan.linkedPatches ?? [])
			]);
		}
		if (!snapshotsEqual(before, captureSnapshot())) {
			commandHistory.addUndoEntry({ type: commandTypeFor(kind, event.altKey) }, before);
			onedit();
		}
	}

	function addNamedTrack(kind: TrackKind): void {
		const number =
			mediaTracks(timelineStore.tracks).filter((track) => track.kind === kind).length + 1;
		addTrack(
			kind,
			kind === 'video'
				? m.video_editor_track_video_name({ number })
				: m.video_editor_track_audio_name({ number })
		);
		onedit();
	}

	function selectTrack(event: MouseEvent, trackId: string): void {
		const track = timelineStore.tracks.find((candidate) => candidate.id === trackId);
		if (!track) return;
		const ids = isTrackGroup(track)
			? trackChildren(timelineStore.tracks, track.id).map((childTrack) => childTrack.id)
			: [track.id];
		if (event.shiftKey || event.metaKey || event.ctrlKey) {
			const next = new Set(selectedTrackIds);
			const removing = ids.every((id) => next.has(id));
			for (const id of ids) {
				if (removing) next.delete(id);
				else next.add(id);
			}
			selectedTrackIds = [...next];
			return;
		}
		selectedTrackIds = ids;
	}

	function createGroupFromSelection(): void {
		const validIds = selectedTrackIds.filter((id) =>
			mediaTracks(timelineStore.tracks).some((track) => track.id === id)
		);
		if (validIds.length === 0) return;
		const number = timelineStore.tracks.filter(isTrackGroup).length + 1;
		if (!createTrackGroup(validIds, m.video_editor_track_group_name({ number }))) return;
		selectedTrackIds = [];
		onedit();
	}

	function requestDeleteGroup(trackId: string): void {
		const group = timelineStore.tracks.find((track) => track.id === trackId && isTrackGroup(track));
		if (!group) return;
		deleteGroupTarget = {
			id: group.id,
			name: group.name,
			trackCount: trackChildren(timelineStore.tracks, group.id).length
		};
		deleteGroupDialogOpen = true;
	}

	function toggleEditTool(tool: AdvancedEditTool): void {
		activeEditTool = activeEditTool === tool ? null : tool;
		editPreviewStore.clear();
	}

	function beginEditPreview(): void {
		if (!drag) return;
		const ids: string[] = [drag.id];
		if (drag.rollingNeighbor) ids.push(drag.rollingNeighbor.id);
		if (drag.slideLeft) ids.push(drag.slideLeft.id);
		if (drag.slideRight) ids.push(drag.slideRight.id);
		const baseline = buildBaselineMap(drag.beforeSnapshot.items, ids);
		if (drag.rollingNeighbor) {
			const left = drag.kind === 'trim-end' ? drag.original : drag.rollingNeighbor;
			const right = drag.kind === 'trim-start' ? drag.original : drag.rollingNeighbor;
			editPreviewStore.begin({
				kind: 'rolling',
				anchorId: drag.id,
				leftId: left.id,
				rightId: right.id,
				baseline
			});
			return;
		}
		if (drag.ripple) {
			editPreviewStore.begin({
				kind: 'ripple',
				anchorId: drag.id,
				handle: drag.kind === 'trim-start' ? 'start' : 'end',
				baseline
			});
			return;
		}
		if (drag.kind === 'slip') {
			editPreviewStore.begin({ kind: 'slip', anchorId: drag.id, baseline });
			return;
		}
		if (drag.kind === 'slide') {
			editPreviewStore.begin({
				kind: 'slide',
				anchorId: drag.id,
				leftId: drag.slideLeft?.id ?? null,
				rightId: drag.slideRight?.id ?? null,
				baseline
			});
		}
	}

	function bumpEditPreview(): void {
		if (editPreviewStore.current) editPreviewStore.bump();
	}

	function ensureEditPreviewPublished(): void {
		if (editPreviewStore.current) bumpEditPreview();
		else beginEditPreview();
	}

	function toggleSnap(): void {
		const enabled = !timelineStore.snapEnabled;
		timelineStore._setSnapEnabled(enabled);
		emitEditorSound(enabled ? 'toggleOn' : 'toggleOff', editorSession.clock.isPlaying);
	}

	function toggleAudioSkimming(): void {
		previewPlaybackSettings.toggleAudioSkimming();
		if (!previewPlaybackSettings.audioSkimmingEnabled) audioSkimController.stop();
		emitEditorSound(
			previewPlaybackSettings.audioSkimmingEnabled ? 'toggleOn' : 'toggleOff',
			editorSession.clock.isPlaying
		);
	}

	function toggleLinkedSelection(): void {
		const enabled = !timelineStore.linkedSelectionEnabled;
		timelineStore._setLinkedSelectionEnabled(enabled);
		emitEditorSound(enabled ? 'toggleOn' : 'toggleOff', editorSession.clock.isPlaying);
	}

	function editTrack(action: () => boolean, sound?: 'toggleOn' | 'toggleOff'): void {
		if (!action()) return;
		onedit();
		if (sound) emitEditorSound(sound, editorSession.clock.isPlaying);
	}

	function deleteTrack(trackId: string): void {
		const removedItemIds = new Set(
			timelineStore.items.filter((item) => item.trackId === trackId).map((item) => item.id)
		);
		const selectedWasRemoved = selectedItemId ? removedItemIds.has(selectedItemId) : false;
		if (!removeTrack(trackId)) return;
		if (selectedWasRemoved) selectedItemId = null;
		selectedItemIds = selectedItemIds.filter((id) => !removedItemIds.has(id));
		selectedTrackIds = selectedTrackIds.filter((id) => id !== trackId);
		onedit();
	}

	onDestroy(() => {
		clearMediaDropPreview(true);
		clearActiveMediaDrag();
		clearHoverPreview();
		editPreviewStore.clear();
		if (drag) finishDrag(true);
		if (audioVolumeDrag) finishAudioVolumeDrag(true);
		if (transitionResize) finishTransitionResize(true);
		if (marquee) finishMarquee();
		if (rulerScrub) cancelRulerScrub();
		if (trackHeightResize) completeTrackHeightResize(true);
		if (markerDrag) completeMarkerDrag(true);
		if (audioSkimStopTimer) clearTimeout(audioSkimStopTimer);
		if (timelineZoomAnimationFrame !== null) cancelAnimationFrame(timelineZoomAnimationFrame);
		if (timelineViewportAnimationFrame !== null)
			cancelAnimationFrame(timelineViewportAnimationFrame);
		audioSkimController.dispose();
		clearEffectDropPreview();
		clearEffectDragData();
		for (const unsubscribe of filmstripUnsubscribers.values()) unsubscribe();
		clearWaveformDemandTimer();
		clearWaveformSubscriptions();
		timelineItemObserver?.disconnect();
		timelineItemObserver = null;
	});

	function zoomFrameLimit(): number {
		return Math.max(fps * 10, timelineStore.maxItemEndFrame);
	}

	function cancelQueuedTimelineZoom(): void {
		queuedTimelineZoom = null;
		if (timelineZoomAnimationFrame === null) return;
		cancelAnimationFrame(timelineZoomAnimationFrame);
		timelineZoomAnimationFrame = null;
	}

	function applyTimelineZoom(level: number, anchor: TimelineZoomAnchor): void {
		cancelQueuedTimelineZoom();
		const nextLevel = clampTimelineZoom(level);
		const nextScrollLeft = anchoredTimelineScrollLeft({
			anchor,
			nextZoomLevel: nextLevel,
			headerWidth: TRACK_HEADER_WIDTH
		});
		timelineStore._setZoomLevel(nextLevel);
		queueMicrotask(() => {
			if (scrollContainer) scrollContainer.scrollLeft = nextScrollLeft;
		});
	}

	function scrollTimelineFromNavigator(nextScrollLeft: number): void {
		if (!scrollContainer) return;
		cancelQueuedTimelineZoom();
		clearHoverPreview();
		scrollContainer.scrollLeft = Math.max(0, nextScrollLeft);
		scheduleTimelineViewportUpdate();
	}

	function zoomTimelineFromNavigator(level: number, nextScrollLeft: number): void {
		cancelQueuedTimelineZoom();
		clearHoverPreview();
		timelineStore._setZoomLevel(clampTimelineZoom(level));
		queueMicrotask(() => scrollTimelineFromNavigator(nextScrollLeft));
	}

	function playheadAnchor(): TimelineZoomAnchor {
		return playheadZoomAnchor({
			frame: timelineStore.currentFrame,
			zoomLevel: zoom,
			scrollLeft: scrollContainer?.scrollLeft ?? 0,
			headerWidth: TRACK_HEADER_WIDTH,
			maxFrame: zoomFrameLimit()
		});
	}

	function zoomBy(factor: number): void {
		applyTimelineZoom(zoom * factor, playheadAnchor());
	}

	function changeTimelineZoomFromSlider(position: number): void {
		// Bits UI normalizes an externally supplied value to the nearest step and
		// reports it through onValueChange. Ignore that sub-step echo so buttons,
		// wheel input, and restored project zoom remain exact.
		if (Math.abs(position - timelineZoomToSlider(zoom)) <= 0.000_51) return;
		applyTimelineZoom(timelineSliderToZoom(position), playheadAnchor());
	}

	function zoomToFit(): void {
		if (!scrollContainer) return;
		cancelQueuedTimelineZoom();
		const level = timelineZoomToFit({
			viewportWidth: scrollContainer.clientWidth,
			headerWidth: TRACK_HEADER_WIDTH,
			durationInFrames: timelineStore.maxItemEndFrame,
			fps
		});
		timelineStore._setZoomLevel(level);
		scrollContainer.scrollLeft = 0;
	}

	function zoomTo100(): void {
		if (!scrollContainer) {
			timelineStore._setZoomLevel(1);
			return;
		}
		cancelQueuedTimelineZoom();
		if (lastTimelinePointerScreenX !== null) {
			applyTimelineZoom(
				1,
				cursorZoomAnchor({
					zoomLevel: zoom,
					pointerScreenX: lastTimelinePointerScreenX,
					scrollLeft: scrollContainer.scrollLeft,
					headerWidth: TRACK_HEADER_WIDTH,
					maxFrame: zoomFrameLimit()
				})
			);
			return;
		}
		timelineStore._setZoomLevel(1);
		const scrollLeft = centeredTimelineScrollLeft({
			frame: timelineStore.currentFrame,
			zoomLevel: 1,
			viewportWidth: scrollContainer.clientWidth,
			headerWidth: TRACK_HEADER_WIDTH
		});
		queueMicrotask(() => {
			if (scrollContainer) scrollContainer.scrollLeft = scrollLeft;
		});
	}

	function rememberTimelinePointer(event: PointerEvent): void {
		if (!scrollContainer) return;
		lastTimelinePointerScreenX = event.clientX - scrollContainer.getBoundingClientRect().left;
		scheduleHoverPreview(event);
	}

	function forgetTimelinePointer(): void {
		lastTimelinePointerScreenX = null;
		clearHoverPreview();
	}

	function hoverPreviewSuppressed(event?: PointerEvent): boolean {
		return (
			editorSession.clock.isPlaying ||
			timelineStore.seekLocked ||
			Boolean(event && (event.buttons !== 0 || event.pointerType === 'touch')) ||
			Boolean(
				drag ||
				rulerScrub ||
				transitionResize ||
				marquee ||
				trackHeightResize ||
				markerDrag ||
				mediaDropPreview ||
				effectDropTargetIds.length > 0 ||
				sceneDropPreview ||
				deleteGroupDialogOpen ||
				bentoLayoutOpen ||
				clearKeyframesDialogOpen
			)
		);
	}

	function clearHoverPreview(): void {
		pendingHoverPreviewClientX = null;
		if (hoverPreviewAnimationFrame !== null) {
			cancelAnimationFrame(hoverPreviewAnimationFrame);
			hoverPreviewAnimationFrame = null;
		}
		timelinePreviewScrub.clear();
	}

	function flushHoverPreview(): void {
		hoverPreviewAnimationFrame = null;
		const clientX = pendingHoverPreviewClientX;
		pendingHoverPreviewClientX = null;
		if (clientX === null || hoverPreviewSuppressed() || !scrollContainer) {
			timelinePreviewScrub.clear();
			return;
		}
		const rect = scrollContainer.getBoundingClientRect();
		if (clientX < rect.left + TRACK_HEADER_WIDTH || clientX > rect.right) {
			timelinePreviewScrub.clear();
			return;
		}
		const frame = frameFromClientX(clientX);
		if (frame === undefined) return;
		timelinePreviewScrub.setFrame(Math.min(frame, Math.max(0, timelineStore.maxItemEndFrame)));
	}

	function scheduleHoverPreview(event: PointerEvent): void {
		if (hoverPreviewSuppressed(event)) {
			clearHoverPreview();
			return;
		}
		pendingHoverPreviewClientX = event.clientX;
		if (hoverPreviewAnimationFrame === null) {
			hoverPreviewAnimationFrame = requestAnimationFrame(flushHoverPreview);
		}
	}

	function flushQueuedTimelineZoom(): void {
		timelineZoomAnimationFrame = null;
		const queued = queuedTimelineZoom;
		queuedTimelineZoom = null;
		if (!queued) return;
		timelineStore._setZoomLevel(queued.level);
		queueMicrotask(() => {
			if (scrollContainer) scrollContainer.scrollLeft = queued.scrollLeft;
		});
	}

	function onTimelineWheel(event: WheelEvent): void {
		if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0 || !scrollContainer) return;
		event.preventDefault();
		clearHoverPreview();
		const pointerScreenX = event.clientX - scrollContainer.getBoundingClientRect().left;
		lastTimelinePointerScreenX = pointerScreenX;
		const baseLevel = queuedTimelineZoom?.level ?? zoom;
		const baseScrollLeft = queuedTimelineZoom?.scrollLeft ?? scrollContainer.scrollLeft;
		const anchor = cursorZoomAnchor({
			zoomLevel: baseLevel,
			pointerScreenX,
			scrollLeft: baseScrollLeft,
			headerWidth: TRACK_HEADER_WIDTH,
			maxFrame: zoomFrameLimit()
		});
		const level = clampTimelineZoom(
			event.deltaY < 0 ? baseLevel * TIMELINE_ZOOM_STEP : baseLevel / TIMELINE_ZOOM_STEP
		);
		queuedTimelineZoom = {
			level,
			scrollLeft: anchoredTimelineScrollLeft({
				anchor,
				nextZoomLevel: level,
				headerWidth: TRACK_HEADER_WIDTH
			})
		};
		if (timelineZoomAnimationFrame === null) {
			timelineZoomAnimationFrame = requestAnimationFrame(flushQueuedTimelineZoom);
		}
	}

	let pendingKeyframeProperty = $state<KeyframeProperty>('opacity');
	let showValueGraph = $state(false);
	let selectedKeyframe = $state<{
		property: KeyframeProperty;
		frame: number;
	} | null>(null);
	let customEasingPresets = $state<CustomEasingPreset[]>([]);
	let selectedCustomPresetName = $state('');
	let customPresetName = $state('');
	let presetSelectionKey = '';
	const BEZIER_KEYS = ['x1', 'y1', 'x2', 'y2'] satisfies Array<'x1' | 'y1' | 'x2' | 'y2'>;
	const SPRING_KEYS = ['tension', 'friction', 'mass'] satisfies Array<
		'tension' | 'friction' | 'mass'
	>;

	const selectedItem = $derived(
		selectedItemId ? timelineStore.itemById.get(selectedItemId) : undefined
	);
	const clearKeyframeDialogOptions = $derived.by(() => {
		const grouped = new Map<
			KeyframeClearProperty,
			{ value: KeyframeClearProperty; label: string; keyframeCount: number }
		>();
		for (const itemId of selectedItemIds) {
			const item = timelineStore.itemById.get(itemId);
			if (!item || isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) continue;
			for (const option of keyframeClearOptions(item)) {
				const current = grouped.get(option.property);
				if (current) {
					current.keyframeCount += option.keyframeCount;
					continue;
				}
				grouped.set(option.property, {
					value: option.property,
					label: clearKeyframePropertyLabel(item, option.property),
					keyframeCount: option.keyframeCount
				});
			}
		}
		return [...grouped.values()].toSorted((left, right) => left.label.localeCompare(right.label));
	});
	const lockedAnimatedSelectionCount = $derived(
		selectedItemIds.filter((itemId) => {
			const item = timelineStore.itemById.get(itemId);
			return (
				item !== undefined &&
				isTrackEffectivelyLocked(item.trackId, timelineStore.tracks) &&
				keyframeClearOptions(item).length > 0
			);
		}).length
	);
	const clearableKeyframeCount = $derived(
		clearKeyframeDialogOptions.reduce((total, option) => total + option.keyframeCount, 0)
	);
	const canLinkSelectedItems = $derived(canLinkSelection(timelineStore.items, selectedItemIds));
	const canUnlinkSelectedItems = $derived(
		selectedItemIds.some((id) => timelineStore.itemById.get(id)?.linkedGroupId !== undefined)
	);
	const canJoinSelectedItems = $derived.by(() => {
		const lockedTrackIds = new Set(
			effectiveMediaTracks(timelineStore.tracks)
				.filter((track) => track.locked)
				.map((track) => track.id)
		);
		const groups = new Map<string, TimelineItem[]>();
		for (const id of selectedItemIds) {
			const item = timelineStore.itemById.get(id);
			if (!item || lockedTrackIds.has(item.trackId)) continue;
			const key = `${item.trackId}\u0000${item.type}`;
			const group = groups.get(key) ?? [];
			group.push(item);
			groups.set(key, group);
		}
		return [...groups.values()].some(canJoinMultipleItems);
	});
	const captionConsolidationTarget = $derived.by<CaptionConsolidationOptions | null>(() => {
		const lockedTrackIds = new Set(
			effectiveMediaTracks(timelineStore.tracks)
				.filter((track) => track.locked)
				.map((track) => track.id)
		);
		const selected = selectedItemIds
			.map((id) => timelineStore.itemById.get(id))
			.filter((item): item is TimelineItem => item !== undefined);
		const sourceClip = selected.find(
			(item) =>
				(item.type === 'video' || item.type === 'audio') &&
				!item.isReversed &&
				timelineStore.items.some(
					(candidate) =>
						candidate.type === 'text' &&
						!lockedTrackIds.has(candidate.trackId) &&
						(candidate.captionSource?.type === 'subtitle-import' ||
							candidate.captionSource?.type === 'embedded-subtitles') &&
						candidate.captionSource.clipId === item.id
				)
		);
		if (sourceClip) return { clipId: sourceClip.id };

		const itemIds = selected
			.filter(
				(item) =>
					item.type === 'text' &&
					!lockedTrackIds.has(item.trackId) &&
					(item.captionSource?.type === 'subtitle-import' ||
						item.captionSource?.type === 'embedded-subtitles')
			)
			.map((item) => item.id);
		return itemIds.length > 0 ? { itemIds } : null;
	});
	const canFreezeSelectedItem = $derived.by(() => {
		if (!selectedItem || selectedItem.type !== 'video') return false;
		if (isTrackEffectivelyLocked(selectedItem.trackId, timelineStore.tracks)) return false;
		const frame = timelineStore.currentFrame;
		return (
			frame > selectedItem.from &&
			frame < selectedItem.from + selectedItem.durationInFrames &&
			!transitionsStore.at(selectedItem, frame - selectedItem.from)
		);
	});
	const bentoEligibleIds = $derived(eligibleBentoItemIds(selectedItemIds));
	const pathVertexSelection = $derived(
		selectedItem ? pathVertexSelectionStore.forItem(selectedItem.id) : null
	);
	const availableKeyframeProperties = $derived(
		selectedItem
			? visiblePathVertexProperties(getAnimatablePropertiesForItem(selectedItem), {
					itemKeyframes: selectedItem.keyframes,
					selectedVertexIndices: pathVertexSelection?.indices,
					showAllVertices: pathVertexSelection?.showAll,
					alwaysInclude: selectedKeyframe?.property
				})
			: []
	);
	const keyframePropertyOptions = $derived(
		availableKeyframeProperties.map((property) => ({
			value: property,
			label: keyframeLabel(property)
		}))
	);
	const easingOptions = $derived([
		{ value: 'linear', label: m.video_editor_keyframe_easing_linear() },
		{ value: 'hold', label: m.video_editor_keyframe_easing_hold() },
		{ value: 'ease-in', label: m.video_editor_keyframe_easing_in() },
		{ value: 'ease-out', label: m.video_editor_keyframe_easing_out() },
		{ value: 'ease-in-out', label: m.video_editor_keyframe_easing_in_out() },
		{ value: 'cubic-bezier', label: m.video_editor_keyframe_easing_bezier() },
		{ value: 'spring', label: m.video_editor_keyframe_easing_spring() }
	]);
	function bezierPresetLabel(value: string): string {
		switch (value) {
			case 'soft':
				return m.video_editor_keyframe_bezier_soft();
			case 'ease-out':
				return m.video_editor_keyframe_easing_out();
			case 'ease-in':
				return m.video_editor_keyframe_easing_in();
			case 'ease-in-out':
				return m.video_editor_keyframe_easing_in_out();
			case 'overshoot':
				return m.video_editor_keyframe_bezier_overshoot();
			case 'snap':
				return m.video_editor_keyframe_bezier_snap();
			case 'out-cubic':
				return m.video_editor_keyframe_bezier_out_cubic();
			case 'out-quart':
				return m.video_editor_keyframe_bezier_out_quart();
			case 'out-quint':
				return m.video_editor_keyframe_bezier_out_quint();
			case 'out-expo':
				return m.video_editor_keyframe_bezier_out_expo();
			case 'out-circ':
				return m.video_editor_keyframe_bezier_out_circ();
			case 'in-out-cubic':
				return m.video_editor_keyframe_bezier_in_out_cubic();
			case 'in-out-quart':
				return m.video_editor_keyframe_bezier_in_out_quart();
			case 'in-out-expo':
				return m.video_editor_keyframe_bezier_in_out_expo();
			case 'in-cubic':
				return m.video_editor_keyframe_bezier_in_cubic();
			case 'in-quart':
				return m.video_editor_keyframe_bezier_in_quart();
			case 'in-expo':
				return m.video_editor_keyframe_bezier_in_expo();
			default:
				return value;
		}
	}
	const bezierOptions = $derived([
		{ value: '', label: m.video_editor_keyframe_bezier_custom() },
		...BEZIER_PRESETS.map((preset) => ({
			value: preset.value,
			label: bezierPresetLabel(preset.value)
		}))
	]);
	const selectedEditorKeyframes = $derived(
		selectedItem && selectedKeyframe ? editorKeyframes(selectedItem, selectedKeyframe.property) : []
	);
	const selectedKeyframeIndex = $derived(
		selectedKeyframe
			? selectedEditorKeyframes.findIndex((keyframe) => keyframe.frame === selectedKeyframe?.frame)
			: -1
	);
	const selectedEditorKeyframe = $derived(selectedEditorKeyframes[selectedKeyframeIndex]);
	const selectedEasing = $derived(
		selectedKeyframeIndex >= 0 ? (selectedEditorKeyframe?.easing ?? 'linear') : 'linear'
	);
	const selectedEasingConfig = $derived(
		selectedKeyframeIndex >= 0 ? selectedEditorKeyframe?.easingConfig : undefined
	);
	const pendingEditorKeyframes = $derived(
		selectedItem ? editorKeyframes(selectedItem, pendingKeyframeProperty) : []
	);
	const customPresetOptions = $derived([
		{ value: '', label: m.video_editor_keyframe_custom_presets() },
		...customEasingPresets
			.filter((preset) =>
				selectedEasing === 'spring' ? preset.type === 'Spring' : preset.type === 'Easing'
			)
			.map((preset) => ({ value: preset.name, label: preset.name }))
	]);
	const suggestedPresetName = $derived(suggestedCustomPresetName(customEasingPresets));

	onMount(() => {
		customEasingPresets = loadCustomEasingPresets();
		updateTimelineViewport();
		if (!scrollContainer) return;
		const observer = new ResizeObserver(scheduleTimelineViewportUpdate);
		observer.observe(scrollContainer);
		return () => observer.disconnect();
	});

	$effect(() => {
		const nextKey = selectedKeyframe
			? `${selectedKeyframe.property}:${selectedKeyframe.frame}`
			: '';
		if (nextKey === presetSelectionKey) return;
		presetSelectionKey = nextKey;
		selectedCustomPresetName = '';
		customPresetName = '';
	});

	function keyframeLabel(property: KeyframeProperty): string {
		return (
			(selectedItem && effectPropertyLabel(selectedItem, property)) ??
			(selectedItem ? editorPropertyLabel(selectedItem, property) : property)
		);
	}

	function clearKeyframePropertyLabel(item: TimelineItem, property: KeyframeClearProperty): string {
		if (property === 'position') return m.video_editor_expression_position();
		if (property === 'scale') return m.video_editor_expression_scale();
		if (property === 'anchor') return m.video_editor_expression_anchor();
		const label = effectPropertyLabel(item, property) ?? editorPropertyLabel(item, property);
		return `${label.slice(0, 1).toLocaleUpperCase()}${label.slice(1)}`;
	}

	function openClearKeyframesDialog(): void {
		if (clearableKeyframeCount === 0) return;
		clearKeyframesDialogOpen = true;
	}

	function addKeyframeAtPlayhead(property: KeyframeProperty): void {
		const item = selectedItem;
		if (!item) return;
		const frame = Math.max(0, timelineStore.currentFrame - item.from);
		const resolved = resolvePreExpressionItemAt(item, timelineStore.currentFrame);
		const transformValue = transformKeyframeValue(resolved, property);
		const pathValue = isPathVertexKeyframeProperty(property)
			? pathVertexPropertyValue(resolved.pathVertices, property)
			: undefined;
		const value =
			transformValue ??
			pathValue ??
			activeValueAt(item, property, timelineStore.currentFrame) ??
			effectPropertyBaseValue(item, property) ??
			(property === 'opacity' || property === 'volume' ? 1 : 0);
		if (setKeyframe(item.id, property, frame, value)) onedit();
	}

	function transformKeyframeValue(
		item: TimelineItem,
		property: KeyframeProperty
	): number | undefined {
		switch (property) {
			case 'x':
			case 'y':
			case 'width':
			case 'height':
			case 'anchorX':
			case 'anchorY':
			case 'rotation':
			case 'opacity':
			case 'cornerRadius':
				return item.transform?.[property];
			default:
				return undefined;
		}
	}

	function commitEasing(easing: EasingType, config?: EasingConfig): void {
		if (!selectedItem || !selectedKeyframe) return;
		if (
			setKeyframeEasing(
				selectedItem.id,
				selectedKeyframe.property,
				selectedKeyframe.frame,
				easing,
				config ?? buildEasingConfig(easing, selectedEasingConfig)
			)
		)
			onedit();
	}

	function commitBezier(key: 'x1' | 'y1' | 'x2' | 'y2', value: number): void {
		const bezier = {
			x1: 0.42,
			y1: 0,
			x2: 0.58,
			y2: 1,
			...selectedEasingConfig?.bezier,
			[key]: value
		};
		commitEasing('cubic-bezier', { type: 'cubic-bezier', bezier });
	}

	function commitSpring(key: 'tension' | 'friction' | 'mass', value: number): void {
		const spring = {
			tension: 170,
			friction: 26,
			mass: 1,
			...selectedEasingConfig?.spring,
			[key]: value
		};
		commitEasing('spring', { type: 'spring', spring });
	}

	function easingFromValue(value: string): EasingType {
		switch (value) {
			case 'hold':
			case 'ease-in':
			case 'ease-out':
			case 'ease-in-out':
			case 'cubic-bezier':
			case 'spring':
				return value;
			default:
				return 'linear';
		}
	}

	function setPendingKeyframeProperty(value: string): void {
		const property = availableKeyframeProperties.find((candidate) => candidate === value);
		if (property) pendingKeyframeProperty = property;
	}

	function toggleValueGraph(): void {
		showValueGraph = !showValueGraph;
	}

	function applyBezierPreset(value: string): void {
		const preset = BEZIER_PRESETS.find((candidate) => candidate.value === value);
		if (preset)
			commitEasing('cubic-bezier', {
				type: 'cubic-bezier',
				bezier: preset.points
			});
	}

	function applyCustomPreset(value: string): void {
		const preset = customEasingPresets.find((candidate) => candidate.name === value);
		if (!preset) return;
		const config = easingConfigFromPreset(preset);
		selectedCustomPresetName = preset.name;
		customPresetName = preset.name;
		commitEasing(config.type, config);
	}

	function saveCustomPreset(): void {
		const preset = presetFromEasing(customPresetName, selectedEasingConfig);
		if (!preset) return;
		customEasingPresets = upsertCustomEasingPreset(customEasingPresets, preset);
		saveCustomEasingPresets(customEasingPresets);
		selectedCustomPresetName = preset.name;
		customPresetName = preset.name;
	}

	function deleteCustomPreset(): void {
		if (!selectedCustomPresetName) return;
		customEasingPresets = customEasingPresets.filter(
			(preset) => preset.name !== selectedCustomPresetName
		);
		saveCustomEasingPresets(customEasingPresets);
		selectedCustomPresetName = '';
		customPresetName = '';
	}

	function bezierValue(key: 'x1' | 'y1' | 'x2' | 'y2'): number {
		return selectedEasingConfig?.bezier?.[key] ?? { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }[key];
	}

	function springValue(key: 'tension' | 'friction' | 'mass'): number {
		return selectedEasingConfig?.spring?.[key] ?? { tension: 170, friction: 26, mass: 1 }[key];
	}
</script>

<svelte:window onkeydown={onPanelKeydown} />

<div class="flex max-w-full min-w-0 items-center gap-2 overflow-x-auto px-3 py-1">
	<span class="text-xs text-[oklch(0.65_0.015_55)]">{m.video_editor_timeline()}</span>
	<div class="flex items-center gap-0.5 border-l border-[oklch(0.25_0.015_55)] pl-2">
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded"
			aria-label={m.video_editor_track_add_video()}
			title={m.video_editor_track_add_video()}
			onclick={() => addNamedTrack('video')}
		>
			<VideoIcon class="size-3.5" />
			<PlusIcon class="-ml-1 size-2.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded"
			aria-label={m.video_editor_track_add_audio()}
			title={m.video_editor_track_add_audio()}
			onclick={() => addNamedTrack('audio')}
		>
			<AudioLinesIcon class="size-3.5" />
			<PlusIcon class="-ml-1 size-2.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded"
			disabled={selectedTrackIds.length === 0}
			aria-label={m.video_editor_track_group_selected()}
			title={selectedTrackIds.length === 0
				? m.video_editor_track_group_select_hint()
				: m.video_editor_track_group_selected_count({
						count: selectedTrackIds.length
					})}
			onclick={createGroupFromSelection}
		>
			<FolderPlusIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded"
			disabled={!markerBefore(timelineStore.markers, timelineStore.currentFrame)}
			aria-label={m.video_editor_previous_marker()}
			title={`${m.video_editor_previous_marker()} ([)`}
			onclick={() => jumpToMarker(markerBefore(timelineStore.markers, timelineStore.currentFrame))}
		>
			<ChevronLeftIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded"
			aria-label={m.video_editor_add_marker()}
			title={`${m.video_editor_add_marker()} (M)`}
			onclick={addMarkerAtPlayhead}
		>
			<FlagIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded"
			disabled={!markerAfter(timelineStore.markers, timelineStore.currentFrame)}
			aria-label={m.video_editor_next_marker()}
			title={`${m.video_editor_next_marker()} (])`}
			onclick={() => jumpToMarker(markerAfter(timelineStore.markers, timelineStore.currentFrame))}
		>
			<ChevronRightIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={timelineStore.snapEnabled}
			aria-pressed={timelineStore.snapEnabled}
			aria-label={timelineStore.snapEnabled
				? m.video_editor_snap_disable()
				: m.video_editor_snap_enable()}
			title={timelineStore.snapEnabled
				? m.video_editor_snap_disable()
				: m.video_editor_snap_enable()}
			onclick={toggleSnap}
		>
			<MagnetIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={previewPlaybackSettings.audioSkimmingEnabled}
			aria-pressed={previewPlaybackSettings.audioSkimmingEnabled}
			aria-label={previewPlaybackSettings.audioSkimmingEnabled
				? m.video_editor_audio_skimming_disable()
				: m.video_editor_audio_skimming_enable()}
			title={m.video_editor_audio_skimming_hint()}
			onclick={toggleAudioSkimming}
		>
			<AudioLinesIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={timelineStore.linkedSelectionEnabled}
			aria-pressed={timelineStore.linkedSelectionEnabled}
			aria-label={timelineStore.linkedSelectionEnabled
				? m.video_editor_linked_selection_disable()
				: m.video_editor_linked_selection_enable()}
			title={m.video_editor_linked_selection_hint()}
			onclick={toggleLinkedSelection}
		>
			<Link2Icon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={activeEditTool === 'slip'}
			aria-pressed={activeEditTool === 'slip'}
			aria-label={m.video_editor_slip()}
			title={m.video_editor_slip()}
			onclick={() => toggleEditTool('slip')}
		>
			<MoveHorizontalIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={activeEditTool === 'slide'}
			aria-pressed={activeEditTool === 'slide'}
			aria-label={m.video_editor_slide()}
			title={m.video_editor_slide()}
			onclick={() => toggleEditTool('slide')}
		>
			<BetweenHorizontalEndIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={activeEditTool === 'rate-stretch'}
			aria-pressed={activeEditTool === 'rate-stretch'}
			aria-label={m.video_editor_rate_stretch()}
			title={m.video_editor_rate_stretch()}
			onclick={() => toggleEditTool('rate-stretch')}
		>
			<GaugeIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)] [@media(pointer:coarse)]:size-11"
			data-active={activeEditTool === 'track-push'}
			aria-pressed={activeEditTool === 'track-push'}
			aria-label={m.video_editor_track_push()}
			title={`${m.video_editor_track_push()}: ${m.video_editor_track_push_hint()}`}
			onclick={() => toggleEditTool('track-push')}
		>
			<MoveRightIcon class="size-3.5" />
		</Button>
	</div>
	<div class="ml-auto flex items-center gap-1">
		{#if selectedItem}
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded"
				disabled={bentoEligibleIds.length < 2}
				aria-label={m.video_editor_bento_open()}
				title={bentoEligibleIds.length < 2
					? m.video_editor_bento_open_hint()
					: m.video_editor_bento_open_count({ count: bentoEligibleIds.length })}
				onclick={() => (bentoLayoutOpen = true)}
			>
				<LayoutGridIcon class="size-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded"
				disabled={!canFreezeSelectedItem || freezeFramePending}
				aria-label={m.video_editor_freeze_frame()}
				title={m.video_editor_freeze_frame_hint()}
				onclick={() => onfreezeframe(selectedItem.id)}
			>
				{#if freezeFramePending}
					<LoaderCircleIcon class="size-3.5 animate-spin" />
				{:else}
					<SnowflakeIcon class="size-3.5" />
				{/if}
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded"
				disabled={!canJoinSelectedItems}
				aria-label={m.video_editor_join_selected()}
				title={m.video_editor_join_selected_hint()}
				onclick={joinSelection}
			>
				<CombineIcon class="size-3.5" />
			</Button>
			{#if captionConsolidationTarget}
				<Button
					variant="ghost"
					size="icon"
					class="size-7 rounded"
					aria-label={m.video_editor_consolidate_captions()}
					title={m.video_editor_consolidate_captions_hint()}
					onclick={consolidateSelection}
				>
					<CaptionsIcon class="size-3.5" />
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded"
				disabled={!canLinkSelectedItems}
				aria-label={m.video_editor_link_selected()}
				title={m.video_editor_link_selected_hint()}
				onclick={linkSelection}
			>
				<Link2Icon class="size-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded"
				disabled={!canUnlinkSelectedItems}
				aria-label={m.video_editor_unlink_selected()}
				title={m.video_editor_unlink_selected_hint()}
				onclick={unlinkSelection}
			>
				<UnlinkIcon class="size-3.5" />
			</Button>
			<span class="mr-2 max-w-40 truncate rounded bg-[oklch(0.22_0.01_50)] px-2 py-0.5 text-xs">
				{selectedItemIds.length > 1
					? m.video_editor_items_selected({ count: selectedItemIds.length })
					: selectedItem.label}
			</span>
			<AppSelect
				class="h-7 w-36 text-xs"
				value={pendingKeyframeProperty}
				options={keyframePropertyOptions}
				ariaLabel={m.video_editor_keyframe_property()}
				onValueChange={setPendingKeyframeProperty}
			/>
			<button
				type="button"
				class="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				onclick={() => addKeyframeAtPlayhead(pendingKeyframeProperty)}
				><DiamondIcon class="size-2.5 fill-current" />
				{m.video_editor_keyframe_add()}</button
			>
			<button
				type="button"
				class="rounded px-1 py-0.5 text-xs hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:cursor-not-allowed disabled:opacity-40"
				disabled={clearableKeyframeCount === 0}
				aria-label={m.video_editor_clear_keyframes_toolbar()}
				title={m.video_editor_clear_keyframes_toolbar_hint()}
				onclick={openClearKeyframesDialog}
			>
				{m.video_editor_clear_keyframes_toolbar()}
			</button>
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
				data-active={showValueGraph}
				aria-pressed={showValueGraph}
				aria-label={m.video_editor_keyframe_graph_toggle()}
				title={m.video_editor_keyframe_graph_toggle()}
				disabled={pendingEditorKeyframes.length === 0}
				onclick={toggleValueGraph}
			>
				<ChartSplineIcon class="size-3.5" />
			</Button>
		{/if}
		<Button
			variant="ghost"
			size="icon"
			class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
			data-active={mixerOpen}
			aria-pressed={mixerOpen}
			aria-label={m.video_editor_mixer_toggle()}
			title={m.video_editor_mixer_toggle_hint()}
			onclick={() => (mixerOpen = !mixerOpen)}
		>
			<SlidersHorizontalIcon class="size-3.5" />
		</Button>
		<button
			type="button"
			class="rounded p-1 hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			aria-label={m.video_editor_zoom_out()}
			title={m.video_editor_zoom_out_hint()}
			onclick={() => zoomBy(1 / TIMELINE_ZOOM_STEP)}
		>
			<ZoomOutIcon class="size-4" />
		</button>
		<Slider
			class="w-28"
			min={0}
			max={1}
			step={0.001}
			value={timelineZoomToSlider(zoom)}
			ariaLabel={m.video_editor_zoom()}
			onValueChange={changeTimelineZoomFromSlider}
		/>
		<button
			type="button"
			class="rounded p-1 hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			aria-label={m.video_editor_zoom_in()}
			title={m.video_editor_zoom_in_hint()}
			onclick={() => zoomBy(TIMELINE_ZOOM_STEP)}
		>
			<ZoomInIcon class="size-4" />
		</button>
		<button
			type="button"
			class="min-w-10 rounded px-1 py-0.5 font-mono text-[10px] text-[oklch(0.7_0.015_55)] tabular-nums hover:bg-[oklch(0.22_0.01_50)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			aria-label={m.video_editor_zoom_100()}
			title={m.video_editor_zoom_100_hint()}
			onclick={zoomTo100}
		>
			{Math.round(zoom * 100)}%
		</button>
		<button
			type="button"
			class="rounded p-1 hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			aria-label={m.video_editor_zoom_fit()}
			title={m.video_editor_zoom_fit_hint()}
			onclick={zoomToFit}
		>
			<Maximize2Icon class="size-4" />
		</button>
	</div>
</div>
<DestructiveConfirmDialog
	bind:open={deleteGroupDialogOpen}
	title={m.video_editor_track_group_delete_title()}
	description={m.video_editor_track_group_delete_body({
		name: deleteGroupTarget?.name ?? '',
		count: deleteGroupTarget?.trackCount ?? 0
	})}
	confirmLabel={m.video_editor_track_group_delete()}
	onConfirm={() => {
		const target = deleteGroupTarget;
		const removedTrackIds = target
			? new Set(trackChildren(timelineStore.tracks, target.id).map((track) => track.id))
			: new Set<string>();
		deleteGroupTarget = null;
		if (!target || !removeTrackGroupWithContents(target.id)) {
			return { ok: false, message: m.video_editor_track_group_delete_failed() };
		}
		selectedTrackIds = selectedTrackIds.filter((id) =>
			mediaTracks(timelineStore.tracks).some((track) => track.id === id)
		);
		selectedItemIds = selectedItemIds.filter((id) => {
			const item = timelineStore.itemById.get(id);
			return item ? !removedTrackIds.has(item.trackId) : false;
		});
		if (selectedItemId && !timelineStore.itemById.has(selectedItemId)) selectedItemId = null;
		onedit();
		return { ok: true };
	}}
/>

<BentoLayoutDialog
	bind:open={bentoLayoutOpen}
	itemIds={bentoEligibleIds}
	{canvasWidth}
	{canvasHeight}
	onapplied={() => onedit()}
/>

<ClearKeyframesDialog
	bind:open={clearKeyframesDialogOpen}
	itemIds={selectedItemIds}
	options={clearKeyframeDialogOptions}
	lockedItemCount={lockedAnimatedSelectionCount}
	oncleared={(result) => {
		if (result.keyframesRemoved === 0) return;
		onedit();
		emitEditorSound('confirm', editorSession.clock.isPlaying);
	}}
/>

{#if selectedMarker}
	<div
		class="flex min-h-9 max-w-full items-center gap-2 overflow-x-auto border-t border-[oklch(0.25_0.015_55)] px-3 py-1 text-[11px]"
	>
		<FlagIcon class="size-3.5 shrink-0" style={`color:${selectedMarker.color}`} />
		<span class="shrink-0 font-medium text-white/85">{markerName(selectedMarker)}</span>
		<label class="flex items-center gap-1 text-[oklch(0.65_0.015_55)]">
			{m.video_editor_marker_label()}
			<input
				class="h-7 w-44 rounded border border-[oklch(0.3_0.01_55)] bg-[oklch(0.2_0.008_55)] px-2 text-white outline-none focus:border-[oklch(0.66_0.14_45)]"
				value={markerLabelDraft}
				oninput={(event) => (markerLabelDraft = event.currentTarget.value)}
				onblur={() => commitMarkerPatch(selectedMarker, { label: markerLabelDraft.trim() })}
				onkeydown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					if (event.key === 'Escape') {
						markerLabelDraft = selectedMarker.label ?? '';
						event.currentTarget.blur();
					}
				}}
			/>
		</label>
		<label class="flex items-center gap-1 text-[oklch(0.65_0.015_55)]">
			{m.video_editor_marker_frame()}
			<input
				class="h-7 w-20 rounded border border-[oklch(0.3_0.01_55)] bg-[oklch(0.2_0.008_55)] px-2 font-mono text-white outline-none focus:border-[oklch(0.66_0.14_45)]"
				type="number"
				min="0"
				step="1"
				value={selectedMarker.frame}
				onchange={(event) => {
					const frame = Number(event.currentTarget.value);
					if (Number.isFinite(frame)) {
						commitMarkerPatch(selectedMarker, {
							frame: Math.max(0, Math.round(frame))
						});
					}
				}}
			/>
		</label>
		<label class="flex items-center gap-1 text-[oklch(0.65_0.015_55)]">
			{m.video_editor_marker_color()}
			<input
				class="size-7 cursor-pointer rounded border border-[oklch(0.3_0.01_55)] bg-transparent p-0.5"
				type="color"
				value={markerColorForInput(selectedMarker.color)}
				onchange={(event) =>
					commitMarkerPatch(selectedMarker, {
						color: event.currentTarget.value
					})}
			/>
		</label>
		<Button
			variant="ghost"
			size="icon"
			class="ml-auto size-7 rounded text-red-300 hover:bg-red-500/15 hover:text-red-200"
			aria-label={m.video_editor_delete_marker()}
			title={`${m.video_editor_delete_marker()} (Shift+M)`}
			onclick={() => deleteTimelineMarker(selectedMarker.id)}
		>
			<Trash2Icon class="size-3.5" />
		</Button>
	</div>
{/if}

{#if mixerOpen}
	<AudioMixerPanel />
{/if}

<div
	bind:this={scrollContainer}
	id="video-editor-timeline-scroll"
	tabindex="-1"
	data-media-placement-surface
	onscroll={scheduleTimelineViewportUpdate}
	onpointerdown={(event) => {
		clearHoverPreview();
		if (mediaPlacement.request) return;
		startMarquee(event);
	}}
	onpointermove={rememberTimelinePointer}
	onpointerleave={forgetTimelinePointer}
	onwheel={onTimelineWheel}
	class="relative max-h-72 min-h-32 overflow-auto pb-2"
	role="region"
	aria-label={m.video_editor_timeline()}
>
	{#if mediaPlacement.request && mediaDropPreview}
		<div
			class="pointer-events-none absolute top-1 right-2 left-2 z-[70] w-auto rounded-md border border-[oklch(0.38_0.015_55)] bg-[oklch(0.17_0.01_55_/_0.96)] px-3 py-1.5 text-[11px] text-white shadow-xl sm:right-auto sm:left-1/2 sm:w-max sm:max-w-[calc(100%-1rem)] sm:-translate-x-1/2"
			role="status"
			aria-live="polite"
			data-media-placement-status
		>
			<span class="font-medium">{mediaDropPreview.label}</span>
			<span class="ml-1 text-[oklch(0.7_0.015_55)]">
				{mediaDropPreview.valid
					? m.video_editor_media_placement_ready()
					: m.video_editor_media_placement_unavailable()}
			</span>
		</div>
	{/if}
	<div class="relative select-none" style="width:{timelineWidth}px">
		{#if marquee?.active}
			<div
				class="pointer-events-none absolute z-50 border border-[oklch(0.72_0.14_45)] bg-[oklch(0.66_0.14_45_/_0.16)]"
				style={marqueeStyle()}
				data-timeline-marquee
			></div>
		{/if}
		<!-- Ruler -->
		<div
			class="sticky top-0 z-20 h-6 cursor-ew-resize touch-none border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(0.66_0.14_45)]"
			role="slider"
			tabindex="0"
			aria-label={m.video_editor_playhead()}
			aria-valuemin="0"
			aria-valuemax={timelineStore.maxItemEndFrame}
			aria-valuenow={timelineStore.currentFrame}
			aria-disabled={timelineStore.seekLocked}
			onkeydown={onRulerKeydown}
			onpointerdown={startRulerScrub}
		>
			<div
				class="sticky left-0 z-30 h-full border-r border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)]"
				style="width:{TRACK_HEADER_WIDTH}px"
			></div>
			{#each rulerTicks() as tick (tick)}
				<span
					class="absolute bottom-0 border-l border-[oklch(0.3_0.01_55)] pl-1 font-mono text-[9px] text-[oklch(0.65_0.015_55)]"
					style="left:{timelineX(tick)}px"
				>
					{tickLabel(tick)}
				</span>
			{/each}
		</div>
		<div
			class="pointer-events-none sticky top-0 z-40 -mt-6 mb-6 h-0"
			role="group"
			aria-label={m.video_editor_markers_lane()}
		>
			{#each [...timelineStore.markers].sort((left, right) => left.frame - right.frame) as marker (marker.id)}
				<button
					type="button"
					class="pointer-events-auto absolute top-0 flex h-6 w-5 -translate-x-1/2 cursor-grab items-start justify-center pt-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white active:cursor-grabbing"
					style="left:{timelineX(marker.frame)}px"
					aria-label={`${markerName(marker)}, ${m.video_editor_marker_frame_value({ frame: marker.frame })}`}
					aria-pressed={timelineStore.selectedMarkerId === marker.id}
					title={`${markerName(marker)} · ${m.video_editor_marker_frame_value({ frame: marker.frame })} · ${m.video_editor_marker_keyboard()}`}
					data-timeline-marker={marker.id}
					data-marquee-ignore
					onpointerdown={(event) => startMarkerDrag(event, marker)}
					ondblclick={(event) => {
						event.stopPropagation();
						deleteTimelineMarker(marker.id);
					}}
					onkeydown={(event) => onMarkerKeydown(event, marker)}
				>
					<span
						class="block h-0 w-0 border-r-[6px] border-l-[6px] border-r-transparent border-l-transparent drop-shadow-sm {timelineStore.selectedMarkerId ===
						marker.id
							? 'drop-shadow-[0_0_2px_white]'
							: ''}"
						style={`border-top:10px solid ${marker.color}`}
					></span>
				</button>
			{/each}
		</div>
		<TimelineVoiceoverOverlay {timelineX} pixelsPerFrame={pxPerFrame} />

		<!-- Tracks -->
		{#each visibleTrackRows(timelineStore.tracks) as track (track.id)}
			{@const parentTrack = track.parentTrackId
				? timelineStore.tracks.find((candidate) => candidate.id === track.parentTrackId)
				: undefined}
			{@const resolvedTrack = {
				...track,
				...effectiveTrackState(track, timelineStore.tracks)
			}}
			{@const renderPlan = timelineRenderPlan(track.id)}
			{@const trackTransitions = visibleTransitionsForTrack(track.id, renderPlan)}
			<div
				class="relative border-b border-[oklch(0.22_0.01_50)] {resolvedTrack.visible === false ||
				(track.kind === 'audio' && resolvedTrack.muted)
					? 'bg-[oklch(0.13_0.006_55)]'
					: ''} {track.isGroup ? 'z-[31] bg-[oklch(0.18_0.012_55)]' : ''}"
				style="height:{track.height}px"
				data-track={track.id}
				role="group"
				aria-label={track.name}
				onpointerdown={track.isGroup
					? undefined
					: (event) => placeMediaWithPointer(event, track.id)}
				onpointermove={track.isGroup
					? undefined
					: (event) => {
							const request = mediaPlacement.request;
							const resolved = request ? resolveDraggedMedia(request.payload) : null;
							if (!request || !resolved) return;
							const position = snappedMediaFrame(event.clientX, resolved.durationInFrames);
							updateMediaDropPreview(request.payload, track.id, position.from, position.snapTarget);
						}}
				ondragenter={track.isGroup
					? undefined
					: (event) => {
							if (!previewMediaDrop(event, track.id)) previewSceneDrop(event, track.id);
						}}
				ondragover={track.isGroup
					? undefined
					: (event) => {
							if (!previewMediaDrop(event, track.id)) previewSceneDrop(event, track.id);
						}}
				ondragleave={track.isGroup
					? undefined
					: (event) => {
							leaveMediaDrop(event);
							leaveSceneDrop(event);
						}}
				ondrop={track.isGroup
					? undefined
					: (event) => {
							if (!dropMedia(event, track.id)) dropScene(event, track.id);
						}}
			>
				<div
					class="sticky left-0 z-30 h-full"
					style="width:{TRACK_HEADER_WIDTH}px"
					data-marquee-ignore
				>
					<TimelineTrackHeader
						{track}
						effectiveTrack={resolvedTrack}
						itemCount={track.isGroup
							? trackChildren(timelineStore.tracks, track.id).length
							: (timelineStore.itemsByTrackId.get(track.id) ?? []).length}
						canDelete={track.isGroup
							? mediaTracks(timelineStore.tracks).length -
									trackChildren(timelineStore.tracks, track.id).length >=
								1
							: mediaTracks(timelineStore.tracks).length > 1}
						selected={track.isGroup
							? trackChildren(timelineStore.tracks, track.id).every((childTrack) =>
									selectedTrackIds.includes(childTrack.id)
								)
							: selectedTrackIds.includes(track.id)}
						child={Boolean(parentTrack)}
						inheritedLocked={Boolean(parentTrack?.locked)}
						inheritedVisible={parentTrack?.visible === false}
						inheritedMuted={Boolean(parentTrack?.muted)}
						inheritedSolo={Boolean(parentTrack?.solo)}
						onselect={(event) => selectTrack(event, track.id)}
						oncollapse={() => editTrack(() => toggleTrackGroupCollapsed(track.id))}
						onungroup={() =>
							editTrack(() => {
								selectedTrackIds = selectedTrackIds.filter(
									(id) =>
										!trackChildren(timelineStore.tracks, track.id).some((child) => child.id === id)
								);
								return ungroupTracks(track.id);
							})}
						ondeletegroup={() => requestDeleteGroup(track.id)}
						onmoveup={() => editTrack(() => moveTrack(track.id, -1))}
						onmovedown={() => editTrack(() => moveTrack(track.id, 1))}
						onrename={(name) => editTrack(() => renameTrack(track.id, name))}
						onvisibility={() =>
							editTrack(
								() => toggleTrackVisibility(track.id),
								track.visible === false ? 'toggleOn' : 'toggleOff'
							)}
						onmute={() =>
							editTrack(() => toggleTrackMute(track.id), track.muted ? 'toggleOff' : 'toggleOn')}
						onsolo={() =>
							editTrack(() => toggleTrackSolo(track.id), track.solo ? 'toggleOff' : 'toggleOn')}
						onlock={() =>
							editTrack(() => toggleTrackLock(track.id), track.locked ? 'toggleOff' : 'toggleOn')}
						onsynclock={() =>
							editTrack(
								() => toggleTrackSyncLock(track.id),
								track.syncLock ? 'toggleOff' : 'toggleOn'
							)}
						ondelete={() => deleteTrack(track.id)}
					/>
				</div>
				{#if sceneDropPreview?.trackId === track.id}
					<div
						class="pointer-events-none absolute top-1 z-20 h-[calc(100%-8px)] overflow-hidden rounded-sm border border-dashed border-[oklch(0.72_0.13_45)] bg-[oklch(0.4_0.04_250_/_0.78)] px-2 py-1 text-[10px] text-white shadow-lg"
						style={clipStyle({
							from: sceneDropPreview.from,
							durationInFrames: sceneDropPreview.durationInFrames,
							type: 'video'
						})}
						data-scene-drop-preview
					>
						<span class="block truncate">{sceneDropPreview.label}</span>
						<span class="sr-only" role="status" aria-live="polite">
							{m.video_editor_scene_drop_ready()}
						</span>
					</div>
				{/if}
				{#if mediaDropPreview && (mediaDropPreview.trackId === track.id || mediaDropPreview.secondaryTrackId === track.id)}
					<div
						class="pointer-events-none absolute top-1 z-20 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-sm border border-dashed px-2 py-1 text-[10px] text-white shadow-lg {mediaDropPreview.valid
							? 'border-[oklch(0.72_0.14_145)] bg-[oklch(0.32_0.09_145_/_0.86)]'
							: 'border-red-400 bg-red-500/25'}"
						style={`left:${timelineX(mediaDropPreview.from)}px;width:${frameToPx(mediaDropPreview.durationInFrames)}px`}
						data-media-drop-preview
						data-valid={String(mediaDropPreview.valid)}
						data-reason={mediaDropPreview.reason ?? undefined}
						data-secondary={String(mediaDropPreview.secondaryTrackId === track.id)}
					>
						<span class="block truncate">{mediaDropPreview.label}</span>
					</div>
				{/if}
				{#if renderPlan.isDense}
					<TimelineDensityOverview
						buckets={renderPlan.densityBuckets}
						{selectedItemIds}
						locked={resolvedTrack.locked}
						{timelineX}
						{frameToPx}
						onpointeritem={(event, item) => startDrag(event, item.id, activeEditTool ?? 'move')}
						onselectitem={(event, item) => selectItem(event, item.id)}
					/>
				{/if}
				{#each renderPlan.nativeItems as item (item.id)}
					{@const displayItem = previewedItem(item)}
					{@const pushAvailability = trackPushAvailability(item)}
					{@const syncOffsetFrames = linkedSyncOffset(item)}
					{#if !syncLockPreviewById[item.id]?.hidden}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="group absolute top-1 h-[calc(100%-8px)] touch-none overflow-hidden rounded-sm border text-left {selectedItemIds.includes(
								item.id
							)
								? 'border-[oklch(0.66_0.14_45)] ring-1 ring-[oklch(0.66_0.14_45)]'
								: 'border-transparent'} {resolvedTrack.locked ? 'opacity-75' : ''}"
							style={clipStyle(displayItem)}
							data-timeline-item-id={item.id}
							use:observeTimelineItem={item.id}
							ondragenter={(event) => previewEffectDrop(event, item.id)}
							ondragover={(event) => previewEffectDrop(event, item.id)}
							ondragleave={(event) => leaveEffectDrop(event, item.id)}
							ondrop={(event) => dropEffect(event, item.id)}
						>
							{#if effectDropTargetIds.includes(item.id)}
								<div
									class="pointer-events-none absolute inset-0 z-40 rounded-sm border border-dashed border-[oklch(0.66_0.14_45_/_0.95)] bg-[oklch(0.66_0.14_45_/_0.16)] shadow-[inset_0_0_0_1px_oklch(0.66_0.14_45_/_0.35)]"
									data-effect-drop-preview
								>
									{#if effectDropHoveredItemId === item.id}
										<span class="sr-only" role="status" aria-live="polite">
											{m.video_editor_effects_drop_ready({
												count: effectDropTargetIds.length
											})}
										</span>
									{/if}
									{#if effectDropHoveredItemId === item.id && effectDropTargetIds.length > 1}
										<span
											class="absolute top-1 right-1 rounded-full bg-[oklch(0.66_0.14_45)] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-[oklch(0.16_0.008_55)]"
										>
											{m.video_editor_effects_drop_count({
												count: effectDropTargetIds.length
											})}
										</span>
									{/if}
								</div>
							{/if}
							<button
								type="button"
								class="absolute inset-0 flex min-w-0 items-center overflow-hidden text-left {activeEditTool ===
								'track-push'
									? pushAvailability === 'ready'
										? 'cursor-col-resize'
										: 'cursor-not-allowed'
									: 'cursor-grab active:cursor-grabbing'}"
								aria-label={activeEditTool === 'track-push'
									? `${item.label}. ${m.video_editor_track_push_handle()}`
									: timelineItemAriaLabel(item, syncOffsetFrames)}
								aria-disabled={activeEditTool === 'track-push' && pushAvailability !== 'ready'}
								title={activeEditTool === 'track-push' ? trackPushTitle(item) : undefined}
								onclick={(event) => {
									event.stopPropagation();
									if (event.detail === 0) selectItem(event, item.id);
								}}
								ondblclick={(event) => {
									if (!item.compositionId) return;
									event.stopPropagation();
									onopencomposition(item.compositionId);
								}}
								onkeydown={(event) => applyKeyboardEdit(event, item, activeEditTool ?? 'move')}
								onpointerdown={(event) => startDrag(event, item.id, activeEditTool ?? 'move')}
							>
								{#if editorSettings.showFilmstrips && item.type === 'video'}
									{@const filmstripTiles = filmstripTilesFor(displayItem)}
									{#if filmstripTiles}
										<div
											class="pointer-events-none absolute inset-x-0 bottom-0 h-8 overflow-hidden"
											data-filmstrip
										>
											{#each filmstripTiles as tile (tile.slot)}
												<FilmstripTile
													bitmap={filmstripBitmapFor(item.mediaId, tile.index)}
													url={tile.url}
													style="left:{tile.x}px;width:{tile.width}px"
												/>
											{/each}
										</div>
									{/if}
								{/if}
								{#if editorSettings.showFilmstrips && item.type === 'image' && item.mediaId && isAnimatedImageMedia(mediaPool.get(item.mediaId))}
									{@const animationTiles = animatedImageTilesFor(displayItem)}
									{#if animationTiles}
										<div
											class="pointer-events-none absolute inset-x-0 bottom-0 h-8 overflow-hidden"
											data-filmstrip
										>
											{#each animationTiles as tile (tile.slot)}
												<FilmstripTile
													bitmap={animatedImageBitmapFor(item.mediaId, tile.index)}
													url={null}
													style="left:{tile.x}px;width:{tile.width}px"
												/>
											{/each}
										</div>
									{/if}
								{/if}
								{#if editorSettings.showWaveforms}
									{@const waveformPoints = waveformSvgPoints(displayItem)}
									{#if waveformPoints}
										<svg
											class="pointer-events-none absolute inset-x-0 bottom-0 h-10 w-full origin-center"
											style="transform:scaleY({displayItem.type === 'audio'
												? audioVolumeWaveformScale(audioVolumeDb(displayItem))
												: 1})"
											viewBox="0 0 {Math.max(8, frameToPx(displayItem.durationInFrames) - 4)} 80"
											preserveAspectRatio="none"
										>
											<polyline
												points={waveformPoints}
												fill="none"
												stroke="oklch(0.85 0.03 120)"
												stroke-width="0.6"
											/>
										</svg>
									{/if}
								{/if}
								<span class="relative z-10 min-w-0 flex-1 truncate px-2 text-[11px] text-white/90"
									>{item.label}</span
								>
								{#if syncOffsetFrames !== null}
									<TimelineLinkedSyncBadge
										offsetFrames={syncOffsetFrames}
										{fps}
										clipWidthPx={frameToPx(displayItem.durationInFrames)}
									/>
								{/if}
								{#if item.isReversed}
									<span
										class="relative z-10 mr-2 rounded bg-black/55 px-1 py-0.5 text-[8px] font-semibold tracking-wide text-white/85"
										title={m.video_editor_clip_reverse()}
									>
										{m.video_editor_clip_reverse_badge()}
									</span>
								{/if}
							</button>
							{#if displayItem.type === 'audio' && selectedItemIds.includes(item.id) && activeEditTool === null}
								{@const volumeDb = audioVolumeDb(displayItem)}
								<button
									type="button"
									role="slider"
									class="absolute inset-x-0 z-30 h-3 -translate-y-1/2 cursor-ns-resize touch-none rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
									style="top:{audioVolumeLinePercent(volumeDb)}%"
									aria-label={`${m.video_editor_clip_volume()}: ${formatAudioVolumeDb(volumeDb)}`}
									aria-valuemin={AUDIO_VOLUME_DB_MIN}
									aria-valuemax={AUDIO_VOLUME_DB_MAX}
									aria-valuenow={volumeDb}
									aria-valuetext={formatAudioVolumeDb(volumeDb)}
									onpointerdown={(event) => startAudioVolumeDrag(event, item)}
									onkeydown={(event) => adjustAudioVolumeWithKeyboard(event, item)}
									ondblclick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										setAudioVolumeFromTimeline(item, 0);
									}}
								>
									<span
										class="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/75 shadow-[0_0_0_1px_rgb(0_0_0_/_0.25)]"
									></span>
									{#if audioVolumeDrag?.itemId === item.id}
										<span
											class="pointer-events-none absolute right-1 bottom-full mb-1 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[10px] text-white shadow-lg"
											data-audio-volume-readout
										>
											{formatAudioVolumeDb(volumeDb)}
										</span>
									{/if}
								</button>
							{/if}
							<button
								type="button"
								class="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white {activeEditTool ===
								'track-push'
									? pushAvailability === 'ready'
										? 'bg-cyan-400/45 hover:bg-cyan-300/70'
										: 'cursor-not-allowed bg-white/10'
									: 'bg-white/15 hover:bg-white/40'}"
								aria-label={activeEditTool === 'track-push'
									? m.video_editor_track_push_handle()
									: m.video_editor_trim_start()}
								aria-disabled={activeEditTool === 'track-push' && pushAvailability !== 'ready'}
								title={activeEditTool === 'track-push'
									? trackPushTitle(item)
									: m.video_editor_trim_keyboard()}
								onkeydown={(event) =>
									applyKeyboardEdit(
										event,
										item,
										activeEditTool === 'rate-stretch'
											? 'rate-stretch-start'
											: activeEditTool === 'track-push'
												? 'track-push'
												: 'trim-start'
									)}
								onpointerdown={(event) =>
									startDrag(
										event,
										item.id,
										activeEditTool === 'rate-stretch'
											? 'rate-stretch-start'
											: activeEditTool === 'track-push'
												? 'track-push'
												: 'trim-start'
									)}
							></button>
							<button
								type="button"
								class="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-white/15 opacity-0 group-hover:opacity-100 hover:bg-white/40 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white"
								aria-label={m.video_editor_trim_end()}
								title={m.video_editor_trim_keyboard()}
								onkeydown={(event) =>
									applyKeyboardEdit(
										event,
										item,
										activeEditTool === 'rate-stretch' ? 'rate-stretch-end' : 'trim-end'
									)}
								onpointerdown={(event) =>
									startDrag(
										event,
										item.id,
										activeEditTool === 'rate-stretch' ? 'rate-stretch-end' : 'trim-end'
									)}
							></button>
						</div>
					{/if}
				{/each}
				{#each trackTransitions as transition (transition.id)}
					{@const geometry = transitionGeometry(transition, track.id)}
					{#if geometry && !breakingTransitionPreviewIds.includes(transition.id)}
						<div
							class="group absolute top-1 z-30 flex h-[calc(100%-8px)] items-start justify-center rounded-sm border bg-[repeating-linear-gradient(135deg,oklch(0.66_0.14_45_/_0.2)_0_4px,transparent_4px_8px)] {selectedTransitionId ===
							transition.id
								? 'border-[oklch(0.82_0.16_65)] ring-2 ring-[oklch(0.66_0.14_45_/_0.48)]'
								: 'border-[oklch(0.76_0.14_45_/_0.7)]'}"
							style="left:{geometry.left}px;width:{geometry.width}px"
							data-transition-id={transition.id}
						>
							<button
								type="button"
								class="absolute inset-0 overflow-hidden rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[oklch(0.82_0.16_65)]"
								aria-label={m.video_editor_transition()}
								onclick={() => selectTransition(transition.id)}
							>
								<span
									class="mt-0.5 inline-block max-w-[calc(100%-8px)] truncate rounded bg-[oklch(0.16_0.008_55_/_0.88)] px-1 text-[8px] font-medium whitespace-nowrap text-[oklch(0.88_0.09_65)]"
								>
									{localizedTransitionLabel(
										transition.presentation ??
											(transition.type === 'fade-black' ? 'dipToColorDissolve' : 'fade'),
										transition.type === 'fade-black'
											? m.video_editor_transition_dip_black()
											: m.video_editor_transition_cross_dissolve()
									)}
								</span>
							</button>
							<button
								type="button"
								class="absolute inset-y-0 -left-3 z-20 w-6 cursor-ew-resize touch-none rounded-l-sm opacity-0 group-hover:opacity-100 hover:bg-white/25 hover:opacity-100 focus-visible:bg-white/25 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white"
								aria-label={m.video_editor_transition_resize_start()}
								title={m.video_editor_transition_resize_keyboard()}
								onkeydown={(event) => resizeTransitionWithKeyboard(event, transition, 'left')}
								onpointerdown={(event) => startTransitionResize(event, transition, 'left')}
							></button>
							<button
								type="button"
								class="absolute inset-y-0 -right-3 z-20 w-6 cursor-ew-resize touch-none rounded-r-sm opacity-0 group-hover:opacity-100 hover:bg-white/25 hover:opacity-100 focus-visible:bg-white/25 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white"
								aria-label={m.video_editor_transition_resize_end()}
								title={m.video_editor_transition_resize_keyboard()}
								onkeydown={(event) => resizeTransitionWithKeyboard(event, transition, 'right')}
								onpointerdown={(event) => startTransitionResize(event, transition, 'right')}
							></button>
						</div>
					{/if}
				{/each}
				{#if !track.isGroup}<div
						class="absolute inset-x-0 bottom-0 z-50 h-2 cursor-row-resize touch-none bg-transparent focus-visible:bg-[oklch(0.66_0.14_45_/_0.25)] focus-visible:outline-none"
						role="slider"
						tabindex="0"
						aria-orientation="vertical"
						aria-label={m.video_editor_track_resize({ name: track.name })}
						aria-valuemin={MIN_TRACK_HEIGHT}
						aria-valuemax={MAX_TRACK_HEIGHT}
						aria-valuenow={track.height}
						title={m.video_editor_track_resize_hint()}
						data-track-resize={track.id}
						data-marquee-ignore
						onpointerdown={(event) => startTrackHeightResize(event, track.id)}
						ondblclick={(event) => resetTrackHeight(event, track.id)}
						onkeydown={(event) => resizeTrackHeightFromKeyboard(event, track.id)}
					></div>{/if}
			</div>
		{/each}

		<!-- Keyframe dopesheet for the selected clip -->
		{#if selectedItem}
			<div class="relative bg-[oklch(0.145_0.008_55)]">
				<KeyframeDopesheet
					item={selectedItem}
					availableProperties={availableKeyframeProperties}
					currentFrame={timelineStore.currentFrame}
					pixelsPerFrame={pxPerFrame}
					{timelineWidth}
					{timelineX}
					onscrub={setCurrentFrame}
					onselect={(keyframe) =>
						(selectedKeyframe = keyframe
							? { property: keyframe.property, frame: keyframe.frame }
							: null)}
					onactiveproperty={(property) => (pendingKeyframeProperty = property)}
					{onedit}
				/>
				<PropertyRuntimePanel
					item={selectedItem}
					items={timelineStore.items}
					availableProperties={availableKeyframeProperties}
					currentFrame={timelineStore.currentFrame}
					fps={timelineStore.fps}
					{onedit}
				/>
				{#if selectedKeyframe && selectedKeyframeIndex >= 0}
					<div
						class="flex min-h-10 flex-wrap items-center gap-2 border-t border-[oklch(0.25_0.015_55)] px-2 py-1 text-[10px]"
					>
						<span class="font-medium capitalize">{keyframeLabel(selectedKeyframe.property)}</span>
						<label class="flex items-center gap-1">
							{m.video_editor_keyframe_easing()}
							<AppSelect
								class="h-7 w-28 text-[10px]"
								value={selectedEasing}
								options={easingOptions}
								onValueChange={(value) => commitEasing(easingFromValue(value))}
							/>
						</label>
						{#if selectedEasing === 'cubic-bezier'}
							<AppSelect
								class="h-7 w-32 text-[10px]"
								value=""
								options={bezierOptions}
								ariaLabel={m.video_editor_keyframe_bezier_preset()}
								onValueChange={applyBezierPreset}
							/>
							{#each BEZIER_KEYS as key (key)}<label
									>{key}<Input
										class="ml-0.5 w-14 rounded bg-[oklch(0.22_0.01_50)] px-1 py-0.5"
										type="number"
										step="0.01"
										min={key === 'x1' || key === 'x2' ? 0 : -2}
										max={key === 'x1' || key === 'x2' ? 1 : 3}
										value={bezierValue(key)}
										onchange={(event) => commitBezier(key, event.currentTarget.valueAsNumber)}
									/></label
								>{/each}
						{:else if selectedEasing === 'spring'}
							{#each SPRING_KEYS as key (key)}<label
									>{key}<Input
										class="ml-0.5 w-14 rounded bg-[oklch(0.22_0.01_50)] px-1 py-0.5"
										type="number"
										step={key === 'tension' || key === 'friction' ? 1 : 0.1}
										min={key === 'tension' || key === 'friction' ? 1 : 0.1}
										max={key === 'tension' ? 1000 : key === 'friction' ? 100 : 10}
										value={springValue(key)}
										onchange={(event) => commitSpring(key, event.currentTarget.valueAsNumber)}
									/></label
								>{/each}
						{/if}
						{#if selectedEasing === 'cubic-bezier' || selectedEasing === 'spring'}
							<div class="flex items-center gap-1 border-l border-[oklch(0.28_0.012_55)] pl-2">
								<AppSelect
									class="h-7 w-32 text-[10px]"
									value={selectedCustomPresetName}
									options={customPresetOptions}
									ariaLabel={m.video_editor_keyframe_custom_presets()}
									onValueChange={applyCustomPreset}
								/>
								<Input
									class="h-7 w-28 rounded bg-[oklch(0.22_0.01_50)] px-1"
									value={customPresetName}
									placeholder={suggestedPresetName}
									aria-label={m.video_editor_keyframe_preset_name()}
									oninput={(event) => (customPresetName = event.currentTarget.value)}
								/>
								<button
									type="button"
									class="h-7 rounded border border-[oklch(0.32_0.015_55)] px-2 font-medium hover:bg-[oklch(0.25_0.012_55)] disabled:opacity-35"
									disabled={!customPresetName.trim()}
									onclick={saveCustomPreset}>{m.video_editor_keyframe_preset_save()}</button
								>
								{#if selectedCustomPresetName}
									<button
										type="button"
										class="h-7 rounded px-2 text-[oklch(0.72_0.1_28)] hover:bg-[oklch(0.3_0.08_28_/_0.22)]"
										onclick={deleteCustomPreset}>{m.video_editor_keyframe_preset_delete()}</button
									>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
				{#if showValueGraph && pendingEditorKeyframes.length > 0}
					<KeyframeValueGraph
						item={selectedItem}
						property={pendingKeyframeProperty}
						currentFrame={timelineStore.currentFrame}
						onscrub={setCurrentFrame}
						onselect={(keyframe) =>
							(selectedKeyframe = keyframe
								? { property: keyframe.property, frame: keyframe.frame }
								: null)}
						{onedit}
					/>
				{/if}
			</div>
		{/if}

		{#if activeSnapTarget}
			<div
				class="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-[oklch(0.76_0.14_45)]"
				style="left:{timelineX(activeSnapTarget.frame)}px"
				data-snap-guideline={activeSnapTarget.type}
			>
				<span
					class="absolute top-6 left-1 rounded border border-[oklch(0.48_0.11_45)] bg-[oklch(0.18_0.015_55)] px-1.5 py-0.5 font-mono text-[9px] whitespace-nowrap text-[oklch(0.88_0.09_65)]"
				>
					{m.video_editor_snapped_to({
						time: tickLabel(activeSnapTarget.frame)
					})}
				</span>
			</div>
		{/if}

		{#if $timelinePreviewScrub.frame !== null}
			<div
				class="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-white/65"
				style="left:{timelineX($timelinePreviewScrub.frame)}px"
				data-timeline-preview-scrubber
				aria-hidden="true"
			>
				<span
					class="absolute top-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] border border-black/70 bg-white"
				></span>
				<span
					class="absolute top-6 left-1/2 -translate-x-1/2 rounded border border-white/20 bg-black/85 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-white shadow-sm"
					data-timeline-preview-timecode
				>
					{formatTimelinePreviewTimecode($timelinePreviewScrub.frame, fps)}
				</span>
			</div>
		{/if}

		<!-- Playhead -->
		<div
			class="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-[oklch(0.66_0.14_45)]"
			style="left:{timelineX(timelineStore.currentFrame)}px"
		></div>
		<!-- In/out range shade -->
		{#if timelineStore.inPoint !== null && timelineStore.outPoint !== null}
			<div
				class="pointer-events-none absolute top-6 bottom-0 z-10 bg-[oklch(0.66_0.14_45_/_0.08)]"
				style="left:{timelineX(timelineStore.inPoint)}px;width:{frameToPx(
					(timelineStore.outPoint ?? 0) - (timelineStore.inPoint ?? 0)
				)}px"
			></div>
		{/if}
	</div>
</div>
<TimelineNavigator
	{timelineWidth}
	viewportWidth={timelineViewport.width}
	scrollLeft={timelineViewport.scrollLeft}
	headerWidth={TRACK_HEADER_WIDTH}
	contentFrames={timelineContentFrames}
	zoomLevel={zoom}
	items={timelineStore.items}
	onscroll={scrollTimelineFromNavigator}
	onzoom={zoomTimelineFromNavigator}
/>
