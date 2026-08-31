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
		addShapeItem,
		addTextItemAtFrame,
		addTextTemplateItem,
		canCloseAllGapsOnTrack,
		canCloseGapAtPosition,
		closeAllGapsOnTrack,
		closeGapAtPosition,
		setCurrentFrame,
		removeMarker,
		selectMarker as selectMarkerAction,
		splitItemsAtFrame,
		updateMarker,
		joinItems,
		linkItems,
		unlinkItems
	} from '$lib/video-editor/timeline/actions/items';
	import {
		clearGeneratedItemDragData,
		getGeneratedItemDragData,
		type GeneratedItemDragData
	} from '$lib/video-editor/timeline/generated-item-drag';
	import { localizedTextStylePresetCopy } from '$lib/video-editor/typography/text-style-preset-copy';
	import { trackRangeIsOpen } from '$lib/video-editor/timeline/track-occupancy';
	import { findTrackGapAtFrame } from '$lib/video-editor/timeline/gap-closing';
	import {
		DEFAULT_MARKER_COLOR,
		MARKER_PRESET_COLORS,
		markerAfter,
		markerBefore,
		markerDisplayName
	} from '$lib/video-editor/timeline/markers';
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
	import {
		TIMELINE_WAVEFORM_HEIGHT,
		mappedTimelineWaveformSourceBoundaries,
		planTimelineWaveformRenderWindow,
		waveformPolyline
	} from '$lib/video-editor/timeline/waveform-render-window';
	import { peaksForMappedWindow, peaksForWindow } from '$lib/video-editor/media/peaks';
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
	import MarkerListPopover from './marker-list-popover.svelte';
	import TimelineFadeHandles from './timeline-fade-handles.svelte';
	import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
	import { emitEditorSound } from '$lib/video-editor/sounds/editor-sounds';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import {
		editorShortcutTargetIsDisabled,
		eventMatchesShortcut,
		formatShortcutBinding,
		type EditorShortcutId
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import {
		adjacentKeyframe,
		keyframeShortcutScopeActive,
		type KeyframeEditorMode
	} from '$lib/video-editor/timeline/keyframe-shortcuts';
	import KeyframeDopesheet from './keyframe-dopesheet.svelte';
	import PropertyRuntimePanel from './property-runtime-panel.svelte';
	import KeyframeValueGraph from './keyframe-value-graph.svelte';
	import {
		computeFilmstripTiles,
		visibleFilmstripTargetIndices
	} from '$lib/video-editor/media/filmstrip-plan';
	import {
		hasVariableSpeed,
		timelineOffsetToSourceFrame
	} from '$lib/video-editor/timeline/source-time-map';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { getTextItemPlainText } from '$lib/video-editor/typography/text-item-spans';
	import { hasColorGrade } from '$lib/video-editor/effects/color-grade';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
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
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
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
	import {
		canJoinMultipleItems,
		joinableItemNeighbors
	} from '$lib/video-editor/timeline/join-items';
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
		timelineNavigationSnapPoints,
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
	import { itemClipboardStore } from '$lib/video-editor/timeline/stores/item-clipboard-store.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import {
		addTransition,
		pruneOrphanedTransitions,
		removeTransition,
		transitionsStore,
		updateTransition,
		updateTransitionPresentation
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
		removeEmptyTracks,
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
	import { emptyTrackIdsForRemoval } from '$lib/video-editor/timeline/track-removal';
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
	import PanelResizeHandle from '$lib/components/panel-resize-handle.svelte';
	import BeatDetectionPanel from '$lib/video-editor/audio/beat-detection/beat-detection-panel.svelte';
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
	import {
		clearTransitionDragData,
		getTransitionDragData,
		resolveTransitionDropTarget,
		type TransitionDropTarget
	} from '$lib/video-editor/timeline/transition-drop';
	import {
		addAdjustmentLayerWithEffects,
		addEffectTemplates
	} from '$lib/video-editor/timeline/actions/effects';
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
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import MoreHorizontalIcon from '@lucide/svelte/icons/ellipsis';
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import MagnetIcon from '@lucide/svelte/icons/magnet';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import CombineIcon from '@lucide/svelte/icons/combine';
	import UnlinkIcon from '@lucide/svelte/icons/unlink';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';
	import Maximize2Icon from '@lucide/svelte/icons/maximize-2';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import MusicIcon from '@lucide/svelte/icons/music';
	import type { SceneScanMode } from '$lib/video-editor/media/scene-scan';
	import { canExtractEmbeddedSubtitles } from '$lib/video-editor/media/embedded-subtitle-service';

	let {
		onedit,
		ontransitionbreak = () => {},
		onopencomposition = () => {},
		onfreezeframe = () => {},
		onreverseitems = () => {},
		onsplitscenes = () => {},
		ontranscribecaptions = () => {},
		onaicaptions = () => {},
		onextractsubtitles = () => {},
		onopenspeechcleanup = () => {},
		oncreatevoice = () => {},
		oncreatecompound = () => {},
		ondissolvecompound = () => {},
		oncopygrade = () => {},
		onpastegrade = () => {},
		oncopyselection = () => false,
		oncutselection = () => false,
		onpasteat = () => false,
		onsplitselection = () => {},
		ondeleteselection = () => {},
		onrippledeleteselection = () => {},
		onmixerlayoutchange = () => {},
		mixerMaximum = 420,
		freezeFramePending = false,
		sceneScanPending = false,
		transcriptionPendingItemIds = [],
		aiCaptionPendingItemIds = [],
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
		onreverseitems?: (itemIds: string[], isReversed: boolean) => void;
		onsplitscenes?: (itemId: string, mode: SceneScanMode) => void;
		ontranscribecaptions?: (itemId: string) => void;
		onaicaptions?: (itemId: string) => void;
		onextractsubtitles?: (itemId: string) => void;
		onopenspeechcleanup?: (mode: 'fillers' | 'silence', itemIds: string[]) => void;
		oncreatevoice?: (itemId: string, text: string) => void;
		oncreatecompound?: (itemIds: string[]) => void;
		ondissolvecompound?: (itemId: string) => void;
		oncopygrade?: (itemId: string) => void;
		onpastegrade?: (itemIds: string[]) => void;
		oncopyselection?: () => boolean;
		oncutselection?: () => boolean;
		onpasteat?: (frame: number, trackId: string | null) => boolean;
		onsplitselection?: () => void;
		ondeleteselection?: () => void;
		onrippledeleteselection?: () => void;
		onmixerlayoutchange?: (open: boolean, height: number) => void;
		mixerMaximum?: number;
		freezeFramePending?: boolean;
		sceneScanPending?: boolean;
		transcriptionPendingItemIds?: readonly string[];
		aiCaptionPendingItemIds?: readonly string[];
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
	type TimelineContextTarget =
		| { kind: 'items'; itemIds: string[]; primaryId: string }
		| { kind: 'transition'; transitionId: string }
		| { kind: 'marker'; markerId: string }
		| { kind: 'track'; trackId: string }
		| { kind: 'space'; frame: number; trackId: string | null };
	let timelineContextTarget = $state<TimelineContextTarget | null>(null);
	let deleteGroupTarget = $state<{
		id: string;
		name: string;
		trackCount: number;
	} | null>(null);
	let deleteGroupDialogOpen = $state(false);
	let bentoLayoutOpen = $state(false);
	let clearKeyframesDialogOpen = $state(false);
	let mixerOpen = $state(false);
	let mixerHeight = $state(editorSettings.audioMixerHeight);
	let beatPanelOpen = $state(false);
	let keyframesOpen = $state(false);
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

	function toggleMixer(): void {
		mixerOpen = !mixerOpen;
		if (mixerOpen) beatPanelOpen = false;
		onmixerlayoutchange(mixerOpen, mixerHeight);
	}

	function toggleBeatPanel(): void {
		beatPanelOpen = !beatPanelOpen;
		if (!beatPanelOpen || !mixerOpen) return;
		mixerOpen = false;
		onmixerlayoutchange(false, mixerHeight);
	}

	function resizeMixer(value: number): void {
		mixerHeight = value;
		onmixerlayoutchange(true, value);
	}

	$effect(() => {
		const minimum = Math.min(160, mixerMaximum);
		const next = Math.max(minimum, Math.min(mixerHeight, mixerMaximum));
		if (next === mixerHeight) return;
		mixerHeight = next;
		if (mixerOpen) onmixerlayoutchange(true, next);
	});
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
	const waveformRenderCache = new Map<
		string,
		{
			peaks: Float32Array;
			loadedSamples: number;
			isComplete: boolean;
			key: string;
			value: {
				points: string;
				leftPx: number;
				widthPx: number;
				clipWidthPx: number;
			};
		}
	>();
	const waveformItemRangeIndex = $derived(
		buildTimelineItemRangeIndex(
			timelineStore.items.filter(
				(item) => (item.type === 'video' || item.type === 'audio') && Boolean(item.mediaId)
			)
		)
	);
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
		waveformRenderCache.clear();
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
		for (const itemId of waveformRenderCache.keys()) {
			if (!itemIds.has(itemId)) waveformRenderCache.delete(itemId);
		}
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
			itemIndex: waveformItemRangeIndex,
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

	function timelineWaveform(item: TimelineItem): {
		points: string;
		leftPx: number;
		widthPx: number;
		clipWidthPx: number;
	} | null {
		if (!item.mediaId) return null;
		const entry = waveforms[item.mediaId];
		const data = entry?.data ?? cachedWaveform(item.mediaId);
		if (!data) return null;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : fps;
		const sourceStart = item.sourceStart ?? 0;
		const sourceEnd =
			item.sourceEnd ?? sourceStart + (item.durationInFrames / fps) * (item.speed ?? 1) * sourceFps;
		const variableSpeed = hasVariableSpeed(item);
		const window = planTimelineWaveformRenderWindow({
			clipFromFrame: item.from,
			clipDurationFrames: item.durationInFrames,
			sourceStartFrame: sourceStart,
			sourceEndFrame: sourceEnd,
			pixelsPerFrame: pxPerFrame,
			scrollLeft: timelineViewport.scrollLeft,
			viewportWidth: timelineViewport.width,
			headerWidth: TRACK_HEADER_WIDTH,
			reversed: item.isReversed === true
		});
		if (!window) return null;
		const renderKey = [
			window.leftPx,
			window.widthPx,
			window.startSourceFrame,
			window.endSourceFrame,
			sourceFps,
			window.reverseColumns,
			...(variableSpeed
				? (item.speedRamp ?? []).flatMap((point) => [point.sourceFrame, point.speed, point.easing])
				: [])
		].join(':');
		const cached = waveformRenderCache.get(item.id);
		if (
			cached?.peaks === data.peaks &&
			cached.loadedSamples === data.loadedSamples &&
			cached.isComplete === data.isComplete &&
			cached.key === renderKey
		)
			return cached.value;
		const columns = variableSpeed
			? peaksForMappedWindow(
					data,
					mappedTimelineWaveformSourceBoundaries({
						window,
						clipDurationFrames: item.durationInFrames,
						sourceFrameAtTimelineOffset: (timelineOffset) =>
							timelineOffsetToSourceFrame(item, timelineOffset, fps) + (item.isReversed ? 1 : 0)
					}),
					sourceFps
				)
			: peaksForWindow(
					data,
					window.startSourceFrame,
					window.endSourceFrame,
					sourceFps,
					window.widthPx
				);
		const value = {
			points: waveformPolyline(
				columns,
				TIMELINE_WAVEFORM_HEIGHT,
				variableSpeed ? false : window.reverseColumns
			),
			leftPx: window.leftPx,
			widthPx: window.widthPx,
			clipWidthPx: window.clipWidthPx
		};
		waveformRenderCache.set(item.id, {
			peaks: data.peaks,
			loadedSamples: data.loadedSamples,
			isComplete: data.isComplete,
			key: renderKey,
			value
		});
		return value;
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
	type AdvancedEditTool = 'razor' | 'slip' | 'slide' | 'rate-stretch' | 'track-push';
	let activeEditTool = $state<AdvancedEditTool | null>(null);
	let hoveredTimelineItemId = $state<string | null>(null);
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
		for (const track of mediaTracks(timelineStore.tracks)) {
			if (!isTrackEffectivelyLocked(track.id, timelineStore.tracks)) continue;
			for (const item of timelineStore.itemsByTrackId.get(track.id) ?? []) {
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
	let effectAdjustmentDropPreview = $state<{
		trackId: string;
		from: number;
		durationInFrames: number;
		label: string;
	} | null>(null);
	let transitionDropPreview = $state<(TransitionDropTarget & { hoveredItemId: string }) | null>(
		null
	);
	let transitionBridgeDropPreviewId = $state<string | null>(null);
	let sceneDropPreview = $state<{
		trackId: string | null;
		from: number;
		durationInFrames: number;
		label: string;
	} | null>(null);
	let generatedItemDropPreview = $state<{
		trackId: string;
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
	let mediaDropSnapTargets: SnapTarget[] | null = null;
	let handledPlacementRequestId = 0;
	interface SnappedMediaFrame {
		from: number;
		snapTarget: SnapTarget | null;
	}

	$effect(() => {
		if (
			effectDropTargetIds.length === 0 &&
			!effectAdjustmentDropPreview &&
			!transitionDropPreview &&
			!transitionBridgeDropPreviewId
		)
			return;
		const clear = () => {
			clearEffectDropPreview();
			clearTransitionDropPreview();
		};
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
		if (!generatedItemDropPreview) return;
		const clear = () => {
			generatedItemDropPreview = null;
			clearGeneratedItemDragData();
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
		for (const itemId of visibleTimelineItemIds) {
			const item = timelineStore.itemById.get(itemId);
			if (!item) continue;
			if (item.type !== 'image' || !item.mediaId) continue;
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
		for (const itemId of visibleTimelineItemIds) {
			const item = timelineStore.itemById.get(itemId);
			if (!item) continue;
			if (item.type !== 'video' || !item.mediaId) continue;
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
			const clipSpanSeconds =
				item.sourceEnd !== undefined
					? Math.max(0, item.sourceEnd - (item.sourceStart ?? 0)) / sourceFps
					: (item.durationInFrames / fps) * (item.speed ?? 1);
			const sourceSecondAtTimelineRatio = hasVariableSpeed(item)
				? (ratio: number) =>
						timelineOffsetToSourceFrame(item, ratio * item.durationInFrames, fps) / sourceFps
				: undefined;
			const targets = visibleFilmstripTargetIndices({
				sourceStartSeconds,
				clipSpanSeconds,
				clipWidthPx: clipWidth,
				visibleStartPx,
				visibleEndPx,
				tileWidthPx: FILMSTRIP_TILE_WIDTH_PX,
				totalSourceFrames: Math.max(1, Math.ceil(media.duration)),
				reversed: item.isReversed,
				sourceSecondAtTimelineRatio
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

	function filmstripTilesFor(item: TimelineItem): ReturnType<typeof computeFilmstripTiles> | null {
		if (!item.mediaId) return null;
		const entry = filmstrips[item.mediaId];
		if (!entry || entry.failed || entry.frames.length === 0) return null;
		const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : Math.max(1, fps);
		const startSeconds = (item.sourceStart ?? 0) / sourceFps;
		const spanSeconds =
			item.sourceEnd !== undefined
				? Math.max(0, item.sourceEnd - (item.sourceStart ?? 0)) / sourceFps
				: (item.durationInFrames / fps) * (item.speed ?? 1);
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
				visibleEndPx,
				sourceSecondAtTimelineRatio: hasVariableSpeed(item)
					? (ratio: number) =>
							timelineOffsetToSourceFrame(item, ratio * item.durationInFrames, fps) / sourceFps
					: undefined
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
	let timelineIndexesFrozen = $state(false);
	let frozenTimelineItemRangeIndexes: Map<string, TimelineItemRangeIndex> | null = null;
	let frozenTimelineDensityBucketsByTrackId: Map<
		string,
		ReturnType<typeof buildTimelineDensityBuckets>
	> | null = null;
	let dragPromotedItemIds = $state<string[]>([]);
	const timelineItemRangeIndexes = $derived.by(() => {
		if (timelineIndexesFrozen && frozenTimelineItemRangeIndexes) {
			return frozenTimelineItemRangeIndexes;
		}
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
		if (timelineIndexesFrozen && frozenTimelineDensityBucketsByTrackId) {
			return frozenTimelineDensityBucketsByTrackId;
		}
		const buckets = new Map<string, ReturnType<typeof buildTimelineDensityBuckets>>();
		for (const [trackId, index] of timelineItemRangeIndexes) {
			if (index.items.length >= DENSE_TIMELINE_TRACK_ITEM_THRESHOLD) {
				buckets.set(trackId, buildTimelineDensityBuckets(index.items));
			}
		}
		return buckets;
	});
	function freezeTimelineIndexes(promotedItemIds: string[]): void {
		frozenTimelineItemRangeIndexes = timelineItemRangeIndexes;
		frozenTimelineDensityBucketsByTrackId = timelineDensityBucketsByTrackId;
		dragPromotedItemIds = [...new Set(promotedItemIds)];
		timelineIndexesFrozen = true;
	}
	function releaseTimelineIndexes(): void {
		timelineIndexesFrozen = false;
		frozenTimelineItemRangeIndexes = null;
		frozenTimelineDensityBucketsByTrackId = null;
		dragPromotedItemIds = [];
	}
	function promoteDragItems(itemIds: readonly string[]): void {
		const next = new Set(dragPromotedItemIds);
		for (const id of itemIds) next.add(id);
		if (next.size !== dragPromotedItemIds.length) dragPromotedItemIds = [...next];
	}
	function previewMoveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
		promoteDragItems(updates.map(({ id }) => id));
		timelineStore._previewMoveItems(updates);
	}
	function previewUpdateItems(updates: Array<{ id: string; patch: Partial<TimelineItem> }>): void {
		promoteDragItems(updates.map(({ id }) => id));
		timelineStore._previewUpdateItems(updates);
	}
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
		const plan = buildTimelineTrackRenderPlan({
			index,
			range,
			pixelsPerFrame: pxPerFrame,
			selectedItemIds: [...selectedItemIds, ...dragPromotedItemIds],
			primarySelectedItemId: selectedItemId,
			densityBuckets: timelineDensityBucketsByTrackId.get(trackId)
		});
		if (dragPromotedItemIds.length === 0) return plan;
		const nativeById = new Map(
			plan.nativeItems.filter((item) => item.trackId === trackId).map((item) => [item.id, item])
		);
		for (const id of dragPromotedItemIds) {
			const item = timelineStore.itemById.get(id);
			if (item?.trackId === trackId) nativeById.set(id, item);
		}
		return {
			...plan,
			nativeItems: [...nativeById.values()].toSorted(
				(left, right) => left.from - right.from || left.id.localeCompare(right.id)
			)
		};
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

	function removeContextTransition(): void {
		if (!contextTransition) return;
		removeTransition(contextTransition.id);
		selectedTransitionId = null;
		timelineContextTarget = null;
		onedit();
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

	function prepareTimelineContextMenu(event: MouseEvent): void {
		const element = event.target instanceof Element ? event.target : null;
		const transitionId =
			element?.closest<HTMLElement>('[data-transition-id]')?.dataset.transitionId;
		if (transitionId && transitionsStore.list.some((candidate) => candidate.id === transitionId)) {
			selectTransition(transitionId);
			timelineStore._setSelectedMarkerId(null);
			timelineContextTarget = { kind: 'transition', transitionId };
			return;
		}

		const itemId = element?.closest<HTMLElement>('[data-timeline-item-id]')?.dataset.timelineItemId;
		if (itemId && timelineStore.itemById.has(itemId)) {
			if (!selectedItemIds.includes(itemId)) {
				const selection = updateTimelineItemSelection(
					timelineStore.items,
					selectedItemIds,
					itemId,
					timelineStore.linkedSelectionEnabled,
					false
				);
				selectedItemIds = selection.ids;
			}
			selectedItemId = itemId;
			selectedTransitionId = null;
			timelineStore._setSelectedMarkerId(null);
			timelineContextTarget = {
				kind: 'items',
				itemIds: selectedItemIds.filter((id) => timelineStore.itemById.has(id)),
				primaryId: itemId
			};
			return;
		}

		const markerId =
			element?.closest<HTMLElement>('[data-timeline-marker]')?.dataset.timelineMarker;
		if (markerId) {
			const marker = timelineStore.markers.find((candidate) => candidate.id === markerId);
			if (!marker) return;
			selectMarker(marker);
			timelineContextTarget = { kind: 'marker', markerId };
			return;
		}

		const headerTrackId = element?.closest<HTMLElement>('[data-track-header]')?.dataset.trackHeader;
		if (headerTrackId) {
			const track = timelineStore.tracks.find((candidate) => candidate.id === headerTrackId);
			if (!track) return;
			const ids = isTrackGroup(track)
				? trackChildren(timelineStore.tracks, track.id).map((childTrack) => childTrack.id)
				: [track.id];
			if (!ids.every((id) => selectedTrackIds.includes(id))) selectedTrackIds = ids;
			timelineContextTarget = { kind: 'track', trackId: headerTrackId };
			return;
		}

		const trackId = element?.closest<HTMLElement>('[data-track]')?.dataset.track ?? null;
		const frame = frameFromClientX(event.clientX) ?? timelineStore.currentFrame;
		timelineContextTarget = { kind: 'space', frame, trackId };
	}

	function openTimelineContextMenuFromKeyboard(event: KeyboardEvent): void {
		if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
		event.preventDefault();
		event.stopPropagation();
		const target = event.target instanceof HTMLElement ? event.target : event.currentTarget;
		const bounds = target.getBoundingClientRect();
		target.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: bounds.left + bounds.width / 2,
				clientY: bounds.top + bounds.height / 2
			})
		);
	}

	function addContextMarker(frame: number): void {
		const markerId = addMarker(frame);
		timelineStore._setSelectedMarkerId(markerId);
		setCurrentFrame(frame);
		selectedItemId = null;
		selectedItemIds = [];
		selectedTransitionId = null;
		onedit();
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
		editorSession.pausePlayback();
	}

	function startRulerScrub(event: PointerEvent): void {
		if (event.button !== 0 || rulerScrub || timelineStore.seekLocked) return;
		clearHoverPreview();
		event.preventDefault();
		event.stopPropagation();
		shuttleScrubResume.begin();
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
		if (!selectMarkerAction(marker.id)) return;
		selectedItemId = null;
		selectedItemIds = [];
		selectedTransitionId = null;
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
		effectAdjustmentDropPreview = null;
	}

	function clearTransitionDropPreview(): void {
		transitionDropPreview = null;
		transitionBridgeDropPreviewId = null;
	}

	function transitionTargetAtPointer(
		event: DragEvent,
		itemId: string
	): TransitionDropTarget | null {
		const payload = getTransitionDragData();
		if (!payload || !(event.currentTarget instanceof HTMLElement)) return null;
		const rect = event.currentTarget.getBoundingClientRect();
		const edge = event.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
		return resolveTransitionDropTarget({
			itemId,
			edge,
			items: timelineStore.items,
			tracks: effectiveMediaTracks(timelineStore.tracks),
			transitions: transitionsStore.list,
			fps: timelineStore.fps,
			presentation: payload.presentation
		});
	}

	function previewTransitionDrop(event: DragEvent, itemId: string): void {
		const target = transitionTargetAtPointer(event, itemId);
		if (!target) {
			clearTransitionDropPreview();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		transitionDropPreview = { ...target, hoveredItemId: itemId };
	}

	function leaveTransitionDrop(event: DragEvent, itemId: string): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		if (transitionDropPreview?.hoveredItemId === itemId) clearTransitionDropPreview();
	}

	function dropTransition(event: DragEvent, itemId: string): boolean {
		const payload = getTransitionDragData();
		if (!payload) return false;
		const target = transitionTargetAtPointer(event, itemId);
		clearTransitionDropPreview();
		clearTransitionDragData();
		event.preventDefault();
		event.stopPropagation();
		if (!target) return true;
		try {
			let transitionId = target.existingTransitionId;
			if (transitionId) {
				if (!updateTransitionPresentation(transitionId, payload.presentation, payload.direction)) {
					emitEditorSound('error', editorSession.clock.isPlaying);
					return true;
				}
			} else {
				transitionId = addTransition(
					target.fromItemId,
					target.toItemId,
					'crossfade',
					target.suggestedDurationInFrames,
					{ presentation: payload.presentation, direction: payload.direction }
				);
			}
			selectedTransitionId = transitionId ?? null;
			selectedItemId = null;
			selectedItemIds = [];
			onedit();
		} catch {
			emitEditorSound('error', editorSession.clock.isPlaying);
		}
		return true;
	}

	function transitionTargetForBridge(transitionId: string): TransitionDropTarget | null {
		const payload = getTransitionDragData();
		const transition = transitionsStore.list.find((candidate) => candidate.id === transitionId);
		if (!payload || !transition) return null;
		const target = resolveTransitionDropTarget({
			itemId: transition.fromItemId,
			edge: 'right',
			items: timelineStore.items,
			tracks: effectiveMediaTracks(timelineStore.tracks),
			transitions: transitionsStore.list,
			fps: timelineStore.fps,
			presentation: payload.presentation
		});
		return target?.existingTransitionId === transitionId ? target : null;
	}

	function previewTransitionBridgeDrop(event: DragEvent, transitionId: string): void {
		if (!transitionTargetForBridge(transitionId)) {
			clearTransitionDropPreview();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		transitionDropPreview = null;
		transitionBridgeDropPreviewId = transitionId;
	}

	function leaveTransitionBridgeDrop(event: DragEvent, transitionId: string): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		if (transitionBridgeDropPreviewId === transitionId) clearTransitionDropPreview();
	}

	function dropTransitionOnBridge(event: DragEvent, transitionId: string): void {
		const payload = getTransitionDragData();
		const target = transitionTargetForBridge(transitionId);
		clearTransitionDropPreview();
		clearTransitionDragData();
		if (!payload) return;
		event.preventDefault();
		event.stopPropagation();
		if (
			!target ||
			!updateTransitionPresentation(transitionId, payload.presentation, payload.direction)
		) {
			emitEditorSound('error', editorSession.clock.isPlaying);
			return;
		}
		selectedTransitionId = transitionId;
		selectedItemId = null;
		selectedItemIds = [];
		onedit();
	}

	function previewCatalogDrop(event: DragEvent, itemId: string): void {
		if (getTransitionDragData()) {
			clearEffectDropPreview();
			previewTransitionDrop(event, itemId);
			return;
		}
		previewEffectDrop(event, itemId);
	}

	function leaveCatalogDrop(event: DragEvent, itemId: string): void {
		leaveEffectDrop(event, itemId);
		leaveTransitionDrop(event, itemId);
	}

	function dropCatalogItem(event: DragEvent, itemId: string): void {
		if (dropTransition(event, itemId)) return;
		dropEffect(event, itemId);
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

	function previewEffectAdjustmentDrop(event: DragEvent, trackId: string): boolean {
		const payload = getEffectDragData();
		if (!payload) return false;
		const track = effectiveMediaTracks(timelineStore.tracks).find(
			(candidate) => candidate.id === trackId
		);
		if (!track || track.kind === 'audio' || track.locked) {
			effectAdjustmentDropPreview = null;
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
			return true;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		effectAdjustmentDropPreview = {
			trackId,
			from: sceneFrameAtPointer(event),
			durationInFrames: timelineStore.fps * 3,
			label: payload.label
		};
		return true;
	}

	function leaveEffectAdjustmentDrop(event: DragEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		effectAdjustmentDropPreview = null;
	}

	function dropEffectAdjustment(event: DragEvent, trackId: string): boolean {
		const payload = getEffectDragData();
		if (!payload) return false;
		const preview = effectAdjustmentDropPreview;
		clearEffectDropPreview();
		clearEffectDragData();
		event.preventDefault();
		event.stopPropagation();
		if (!preview || preview.trackId !== trackId) return true;
		try {
			const itemId = addAdjustmentLayerWithEffects(payload.label, payload.effects, {
				frame: preview.from,
				preferredTrackId: trackId
			});
			selectedItemId = itemId;
			selectedItemIds = [itemId];
			onedit();
		} catch {
			emitEditorSound('error', editorSession.clock.isPlaying);
		}
		return true;
	}

	function sceneFrameAtPointer(event: DragEvent): number {
		if (!scrollContainer) return timelineStore.currentFrame;
		const rect = scrollContainer.getBoundingClientRect();
		return Math.max(
			0,
			pxToFrame(event.clientX - rect.left + scrollContainer.scrollLeft - TRACK_HEADER_WIDTH)
		);
	}

	function previewGeneratedItemDrop(event: DragEvent, trackId: string): boolean {
		const payload = getGeneratedItemDragData(event.dataTransfer);
		if (!payload) return false;
		const track = effectiveMediaTracks(timelineStore.tracks).find(
			(candidate) => candidate.id === trackId
		);
		if (!track || track.kind === 'audio' || track.locked) {
			generatedItemDropPreview = null;
			return true;
		}
		const from = sceneFrameAtPointer(event);
		const durationInFrames = timelineStore.fps * 3;
		const itemType = payload.kind === 'shape' ? 'shape' : 'text';
		if (!trackRangeIsOpen(timelineStore.items, trackId, from, durationInFrames, itemType)) {
			generatedItemDropPreview = null;
			if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
			return true;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		generatedItemDropPreview = {
			trackId,
			from,
			durationInFrames,
			label: payload.label
		};
		sceneDropPreview = null;
		return true;
	}

	function leaveGeneratedItemDrop(event: DragEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (isDragPointInsideElement(event, event.currentTarget)) return;
		generatedItemDropPreview = null;
	}

	function insertGeneratedItem(
		payload: GeneratedItemDragData,
		frame: number,
		preferredTrackId: string
	): string {
		if (payload.kind === 'shape') {
			return addShapeItem(payload.shapeType, payload.label, payload.style, {
				frame,
				preferredTrackId
			});
		}
		return payload.presetId
			? addTextTemplateItem(payload.presetId, localizedTextStylePresetCopy(payload.presetId), {
					frame,
					preferredTrackId
				})
			: addTextItemAtFrame(payload.label, frame, preferredTrackId);
	}

	function dropGeneratedItem(event: DragEvent, trackId: string): boolean {
		const payload = getGeneratedItemDragData(event.dataTransfer);
		if (!payload) return false;
		const preview = generatedItemDropPreview;
		generatedItemDropPreview = null;
		clearGeneratedItemDragData();
		event.preventDefault();
		event.stopPropagation();
		if (!preview || preview.trackId !== trackId) return true;
		try {
			const itemId = insertGeneratedItem(payload, preview.from, trackId);
			selectedItemId = itemId;
			selectedItemIds = [itemId];
			onedit();
		} catch {
			emitEditorSound('error', editorSession.clock.isPlaying);
		}
		return true;
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
		mediaDropSnapTargets ??= snapTargetsFor([]);
		const threshold = calculateAdaptiveSnapThreshold(zoom, pxPerFrame);
		const result = calculateMoveSnap(rawFrame, durationInFrames, mediaDropSnapTargets, threshold);
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
		mediaDropSnapTargets = null;
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
				queryTimelineItemRange(
					timelineItemRangeIndexes.get(item.trackId) ?? EMPTY_TIMELINE_ITEM_RANGE_INDEX,
					{ start: end, end: end + 1 }
				).find((candidate) => candidate.id !== item.id && candidate.from === end) ?? null
			);
		}
		if (kind === 'trim-start') {
			return (
				queryTimelineItemRange(
					timelineItemRangeIndexes.get(item.trackId) ?? EMPTY_TIMELINE_ITEM_RANGE_INDEX,
					{ start: item.from - 1, end: item.from }
				).find(
					(candidate) =>
						candidate.id !== item.id && candidate.from + candidate.durationInFrames === item.from
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
		const index = timelineItemRangeIndexes.get(item.trackId) ?? EMPTY_TIMELINE_ITEM_RANGE_INDEX;
		const leftCandidates = queryTimelineItemRange(index, {
			start: item.from - 1,
			end: item.from
		});
		const rightCandidates = queryTimelineItemRange(index, { start: end, end: end + 1 });
		return {
			left:
				leftCandidates.find(
					(candidate) =>
						candidate.id !== item.id && candidate.from + candidate.durationInFrames === item.from
				) ?? null,
			right:
				rightCandidates.find((candidate) => candidate.id !== item.id && candidate.from === end) ??
				null
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

	function splitTimelineItemAtFrame(itemId: string, frame: number): boolean {
		const targetIds = timelineStore.linkedSelectionEnabled
			? expandSelectionWithLinkedItems(timelineStore.items, [itemId])
			: [itemId];
		const result = splitItemsAtFrame(frame, targetIds);
		if (result.left.length === 0) return false;
		selectedItemIds = result.left;
		selectedItemId = result.left.includes(itemId) ? itemId : (result.left.at(-1) ?? null);
		selectedTransitionId = null;
		onedit();
		return true;
	}

	function razorSplitTimelineItem(event: PointerEvent, itemId: string): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const frame = frameFromClientX(event.clientX);
		if (frame !== undefined) splitTimelineItemAtFrame(itemId, frame);
	}

	function splitHoveredTimelineItem(): void {
		if (!hoveredTimelineItemId) return;
		const frame = $timelinePreviewScrub.frame ?? timelineStore.currentFrame;
		splitTimelineItemAtFrame(hoveredTimelineItemId, frame);
	}

	function handleTimelineItemKeydown(
		event: KeyboardEvent,
		item: TimelineItem,
		tool: AdvancedEditTool | null
	): void {
		if (tool === 'razor') {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			splitTimelineItemAtFrame(item.id, timelineStore.currentFrame);
			return;
		}
		applyKeyboardEdit(event, item, tool ?? 'move');
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

	function joinSelectionItems(itemIds: string[]): void {
		const joinedIds = joinItems(itemIds);
		if (joinedIds.length === 0) return;
		selectedItemIds = joinedIds;
		selectedItemId = joinedIds.at(-1) ?? null;
		onedit();
	}

	function joinSelection(): void {
		joinSelectionItems(selectedItemIds);
	}

	function joinContextNeighbor(neighborId: string): void {
		if (contextPrimaryItem) joinSelectionItems([contextPrimaryItem.id, neighborId]);
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
		if (event.defaultPrevented) return;
		if (editorShortcutTargetIsDisabled(event.target)) return;
		const bindings = keyboardShortcuts.bindings;
		const matches = (...ids: EditorShortcutId[]) =>
			ids.some((id) => eventMatchesShortcut(event, bindings[id]));
		if (handleKeyframeEditorShortcut(event, matches)) return;
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
		} else if (matches('SPLIT_AT_CURSOR')) {
			event.preventDefault();
			splitHoveredTimelineItem();
		} else if (matches('RAZOR_TOOL')) {
			event.preventDefault();
			toggleEditTool('razor');
		} else if (matches('RATE_STRETCH_TOOL')) {
			event.preventDefault();
			toggleEditTool('rate-stretch');
		} else if (matches('SLIP_TOOL')) {
			event.preventDefault();
			toggleEditTool('slip');
		} else if (matches('SLIDE_TOOL')) {
			event.preventDefault();
			toggleEditTool('slide');
		} else if (matches('SELECTION_TOOL')) {
			event.preventDefault();
			activeEditTool = null;
			editPreviewStore.clear();
		} else if (matches('PREVIOUS_SNAP_POINT', 'NEXT_SNAP_POINT')) {
			event.preventDefault();
			const points = timelineNavigationSnapPoints({
				items: timelineStore.items,
				tracks: timelineStore.tracks,
				transitions: transitionsStore.list,
				markers: timelineStore.markers
			});
			const frame = matches('NEXT_SNAP_POINT')
				? points.find((point) => point > timelineStore.currentFrame)
				: points.findLast((point) => point < timelineStore.currentFrame);
			if (frame !== undefined) setCurrentFrame(frame);
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
		if (event.currentTarget instanceof HTMLElement) {
			event.currentTarget.focus({ preventScroll: true });
		}
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
		freezeTimelineIndexes([id, ...excludedIds]);
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
			previewMoveItems(plan.moves);
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
			previewMoveItems(
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
					previewUpdateItems(updates);
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
				previewUpdateItems([
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
			previewUpdateItems([
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
				previewUpdateItems([
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
					previewUpdateItems([
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
		previewUpdateItems([{ id: drag.id, patch: plan.patch }, ...(plan.linkedPatches ?? [])]);
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
		} else {
			timelineStore._commitPreviewItems();
		}
		if (!cancelled && completed.ripple) {
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
		releaseTimelineIndexes();
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
			previewMoveItems(
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

	function closeContextGap(): void {
		if (timelineContextTarget?.kind !== 'space' || !timelineContextTarget.trackId) return;
		if (closeGapAtPosition(timelineContextTarget.trackId, timelineContextTarget.frame)) onedit();
	}

	function closeContextTrackGaps(): void {
		if (!contextTrack || contextTrack.isGroup) return;
		if (closeAllGapsOnTrack(contextTrack.id)) onedit();
	}

	function removeContextEmptyTracks(): void {
		if (!contextTrack || contextTrack.isGroup) return;
		const removedIds = new Set(removeEmptyTracks(contextTrack.id));
		if (removedIds.size === 0) return;
		selectedTrackIds = selectedTrackIds.filter((trackId) => !removedIds.has(trackId));
		onedit();
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
		if (mixerOpen) onmixerlayoutchange(false, mixerHeight);
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
				transitionDropPreview ||
				sceneDropPreview ||
				deleteGroupDialogOpen ||
				bentoLayoutOpen ||
				clearKeyframesDialogOpen
			)
		);
	}

	function clearHoverPreview(): void {
		pendingHoverPreviewClientX = null;
		hoveredTimelineItemId = null;
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
		const target = event.target instanceof Element ? event.target : null;
		hoveredTimelineItemId =
			target?.closest<HTMLElement>('[data-timeline-item-id]')?.dataset.timelineItemId ?? null;
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
	let keyframeEditorMode = $state<KeyframeEditorMode>('dopesheet');
	let keyframeShortcutPointerInside = $state(false);
	let keyframeGraphFitRequest = $state(0);
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
	const contextTrack = $derived(
		timelineContextTarget?.kind === 'track'
			? timelineStore.tracks.find((track) => track.id === timelineContextTarget.trackId)
			: undefined
	);
	const contextSpaceGap = $derived.by(() => {
		if (timelineContextTarget?.kind !== 'space' || !timelineContextTarget.trackId) return null;
		return findTrackGapAtFrame(
			timelineStore.items,
			timelineContextTarget.trackId,
			timelineContextTarget.frame
		);
	});
	const contextSpaceGapCanClose = $derived(
		contextSpaceGap !== null &&
			timelineContextTarget?.kind === 'space' &&
			timelineContextTarget.trackId !== null &&
			canCloseGapAtPosition(timelineContextTarget.trackId, timelineContextTarget.frame)
	);
	const contextTrackGapsCanClose = $derived(
		contextTrack !== undefined && !contextTrack.isGroup && canCloseAllGapsOnTrack(contextTrack.id)
	);
	const contextEmptyTrackIds = $derived.by(() =>
		contextTrack && !contextTrack.isGroup
			? emptyTrackIdsForRemoval(timelineStore.tracks, timelineStore.items, contextTrack.id)
			: []
	);
	const contextTransition = $derived(
		timelineContextTarget?.kind === 'transition'
			? transitionsStore.list.find(
					(transition) => transition.id === timelineContextTarget.transitionId
				)
			: undefined
	);
	const contextPrimaryItem = $derived(
		timelineContextTarget?.kind === 'items'
			? timelineStore.itemById.get(timelineContextTarget.primaryId)
			: undefined
	);
	const contextPrimaryMedia = $derived(
		contextPrimaryItem?.mediaId ? mediaPool.get(contextPrimaryItem.mediaId) : undefined
	);
	const transcriptionPendingSet = $derived(new Set(transcriptionPendingItemIds));
	const aiCaptionPendingSet = $derived(new Set(aiCaptionPendingItemIds));
	const contextHasTranscriptCaptions = $derived(
		contextPrimaryItem
			? timelineStore.items.some(
					(item) =>
						item.captionSource?.type === 'transcript' &&
						item.captionSource.clipId === contextPrimaryItem.id
				)
			: false
	);
	const contextHasAiCaptions = $derived(
		contextPrimaryItem
			? timelineStore.items.some(
					(item) =>
						item.captionSource?.type === 'ai-captions' &&
						item.captionSource.clipId === contextPrimaryItem.id
				)
			: false
	);
	const contextCanManageCaptions = $derived(
		Boolean(
			contextPrimaryItem &&
			(contextPrimaryItem.type === 'video' || contextPrimaryItem.type === 'audio') &&
			contextPrimaryItem.mediaId &&
			contextPrimaryItem.isReversed !== true &&
			!isTrackEffectivelyLocked(contextPrimaryItem.trackId, timelineStore.tracks) &&
			(contextPrimaryItem.type !== 'audio' ||
				!timelineStore.items.some(
					(item) =>
						item.type === 'video' &&
						item.mediaId === contextPrimaryItem.mediaId &&
						item.linkedGroupId !== undefined &&
						item.linkedGroupId === contextPrimaryItem.linkedGroupId
				))
		)
	);
	const contextCanExtractEmbeddedSubtitles = $derived(
		contextCanManageCaptions &&
			contextPrimaryMedia !== undefined &&
			canExtractEmbeddedSubtitles(contextPrimaryMedia)
	);
	const contextItems = $derived.by(() =>
		timelineContextTarget?.kind === 'items'
			? timelineContextTarget.itemIds
					.map((id) => timelineStore.itemById.get(id))
					.filter((item): item is TimelineItem => item !== undefined)
			: []
	);
	const contextMediaItemIds = $derived(
		contextItems
			.filter((item) => item.type === 'video' || item.type === 'audio')
			.map((item) => item.id)
	);
	const contextVoiceText = $derived(
		contextPrimaryItem?.type === 'text' ? getTextItemPlainText(contextPrimaryItem).trim() : ''
	);
	const hasContextPrimaryEditTools = $derived(
		contextPrimaryItem?.type === 'video' ||
			contextPrimaryItem?.type === 'audio' ||
			(contextPrimaryItem?.type === 'text' && contextVoiceText.length > 0) ||
			captionConsolidationTarget !== null
	);
	const contextGradeSourceItem = $derived(contextItems.find((item) => hasColorGrade(item.effects)));
	const contextGradeTargetItemIds = $derived(
		contextItems.filter((item) => item.type !== 'audio').map((item) => item.id)
	);
	const hasContextGradeActions = $derived(
		contextGradeSourceItem !== undefined ||
			(Boolean(colorPreviewStore.gradeClipboard?.length) && contextGradeTargetItemIds.length > 0)
	);
	const hasContextEditTools = $derived(hasContextPrimaryEditTools || hasContextGradeActions);
	const contextMarker = $derived(
		timelineContextTarget?.kind === 'marker'
			? timelineStore.markers.find((marker) => marker.id === timelineContextTarget.markerId)
			: undefined
	);
	const contextItemsEditable = $derived.by(() => {
		if (timelineContextTarget?.kind !== 'items') return false;
		return timelineContextTarget.itemIds.some((id) => {
			const item = timelineStore.itemById.get(id);
			return item && !isTrackEffectivelyLocked(item.trackId, timelineStore.tracks);
		});
	});
	const contextItemsAllEditable = $derived(
		contextItems.length > 0 &&
			contextItems.every((item) => !isTrackEffectivelyLocked(item.trackId, timelineStore.tracks))
	);
	const contextMediaItemsEditable = $derived(
		contextItems.some(
			(item) =>
				(item.type === 'video' || item.type === 'audio') &&
				!isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)
		)
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
	const contextJoinableNeighbors = $derived.by(() => {
		if (
			!contextPrimaryItem ||
			isTrackEffectivelyLocked(contextPrimaryItem.trackId, timelineStore.tracks)
		) {
			return {};
		}
		return joinableItemNeighbors(timelineStore.items, contextPrimaryItem);
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
	const hasContextClipActions = $derived(
		Boolean(
			contextPrimaryItem ||
			canJoinSelectedItems ||
			bentoEligibleIds.length >= 2 ||
			captionConsolidationTarget ||
			clearableKeyframeCount > 0 ||
			lockedAnimatedSelectionCount > 0
		)
	);
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
	const keyframeViewOptions = $derived([
		{ value: 'dopesheet', label: m.video_editor_keyframe_view_dopesheet() },
		{ value: 'graph', label: m.video_editor_keyframe_view_graph() },
		{ value: 'split', label: m.video_editor_keyframe_view_split() }
	]);
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
		if (
			timelineStore.currentFrame < item.from ||
			timelineStore.currentFrame >= item.from + item.durationInFrames
		)
			return;
		const frame = timelineStore.currentFrame - item.from;
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
			case 'scaleX':
			case 'scaleY':
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

	function setKeyframeEditorMode(value: string): void {
		if (value === 'graph' || value === 'dopesheet' || value === 'split') {
			keyframeEditorMode = value;
		}
	}

	function fitKeyframeDopesheet(): void {
		if (!scrollContainer || !selectedItem) return;
		const frames = pendingEditorKeyframes.map((keyframe) => selectedItem.from + keyframe.frame);
		const first = frames.length > 0 ? Math.min(...frames) : selectedItem.from;
		const last =
			frames.length > 0
				? Math.max(...frames)
				: selectedItem.from + selectedItem.durationInFrames - 1;
		const span = Math.max(fps, last - first + 1);
		const center = (first + last) / 2;
		const start = Math.max(0, center - span / 2);
		const availableWidth = Math.max(1, scrollContainer.clientWidth - TRACK_HEADER_WIDTH - 50);
		const level = clampTimelineZoom(availableWidth / (span * timelinePixelsPerFrame(1)));
		const targetScrollLeft = Math.max(
			0,
			TRACK_HEADER_WIDTH + start * timelinePixelsPerFrame(level) - 24
		);
		timelineStore._setZoomLevel(level);
		queueMicrotask(() => {
			if (scrollContainer) scrollContainer.scrollLeft = targetScrollLeft;
		});
	}

	function fitActiveKeyframeView(): void {
		if (keyframeEditorMode !== 'graph') fitKeyframeDopesheet();
		if (keyframeEditorMode !== 'dopesheet') keyframeGraphFitRequest += 1;
	}

	function handleKeyframeEditorShortcut(
		event: KeyboardEvent,
		matches: (...ids: EditorShortcutId[]) => boolean
	): boolean {
		if (
			!keyframesOpen ||
			!selectedItem ||
			!keyframeShortcutScopeActive(event.target, keyframeShortcutPointerInside)
		)
			return false;
		let handled = true;
		if (matches('KEYFRAME_EDITOR_GRAPH')) keyframeEditorMode = 'graph';
		else if (matches('KEYFRAME_EDITOR_DOPESHEET')) keyframeEditorMode = 'dopesheet';
		else if (matches('KEYFRAME_EDITOR_SPLIT')) keyframeEditorMode = 'split';
		else if (matches('EDIT_KEYFRAME_ADD')) addKeyframeAtPlayhead(pendingKeyframeProperty);
		else if (matches('KEYFRAME_PREVIOUS', 'KEYFRAME_NEXT')) {
			const keyframe = adjacentKeyframe(
				pendingEditorKeyframes,
				timelineStore.currentFrame - selectedItem.from,
				matches('KEYFRAME_PREVIOUS') ? 'previous' : 'next'
			);
			if (keyframe) {
				selectedKeyframe = { property: keyframe.property, frame: keyframe.frame };
				setCurrentFrame(selectedItem.from + keyframe.frame);
			}
		} else if (matches('KEYFRAME_TOGGLE_AUTO')) {
			const enabled = autoKeyframeStore.toggle(selectedItem.id, pendingKeyframeProperty);
			emitEditorSound(enabled ? 'toggleOn' : 'toggleOff', editorSession.clock.isPlaying);
		} else if (matches('KEYFRAME_FIT')) fitActiveKeyframeView();
		else handled = false;
		if (handled) event.preventDefault();
		return handled;
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

<div class="flex size-full min-h-0 flex-col">
	<div class="flex max-w-full min-w-0 shrink-0 items-center gap-2 overflow-x-auto px-3 py-1">
		<span class="text-xs text-[oklch(0.65_0.015_55)]">{m.video_editor_timeline()}</span>
		<div class="flex items-center gap-0.5 border-l border-[oklch(0.25_0.015_55)] pl-2">
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
			<MarkerListPopover {onedit} onselect={selectMarker} />
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
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class="size-7 rounded"
							aria-label={m.image_editor_more_actions()}
						>
							<MoreHorizontalIcon class="size-3.5" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="video-editor-theme w-60" align="start">
					<DropdownMenu.Item onclick={() => addNamedTrack('video')}>
						{m.video_editor_track_add_video()}
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => addNamedTrack('audio')}>
						{m.video_editor_track_add_audio()}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item
						disabled={!markerBefore(timelineStore.markers, timelineStore.currentFrame)}
						onclick={() =>
							jumpToMarker(markerBefore(timelineStore.markers, timelineStore.currentFrame))}
					>
						{m.video_editor_previous_marker()}
					</DropdownMenu.Item>
					<DropdownMenu.Item
						disabled={!markerAfter(timelineStore.markers, timelineStore.currentFrame)}
						onclick={() =>
							jumpToMarker(markerAfter(timelineStore.markers, timelineStore.currentFrame))}
					>
						{m.video_editor_next_marker()}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item
						disabled={selectedTrackIds.length === 0}
						onclick={createGroupFromSelection}
					>
						{m.video_editor_track_group_selected()}
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.CheckboxItem
						checked={previewPlaybackSettings.audioSkimmingEnabled}
						onCheckedChange={toggleAudioSkimming}
					>
						{m.video_editor_audio_skimming_hint()}
					</DropdownMenu.CheckboxItem>
					<DropdownMenu.CheckboxItem
						checked={timelineStore.linkedSelectionEnabled}
						onCheckedChange={toggleLinkedSelection}
					>
						{m.video_editor_linked_selection_enable()}
					</DropdownMenu.CheckboxItem>
					<DropdownMenu.Separator />
					{#each [['razor', m.video_editor_shortcuts_command_razor_tool()], ['slip', m.video_editor_slip()], ['slide', m.video_editor_slide()], ['rate-stretch', m.video_editor_rate_stretch()], ['track-push', m.video_editor_track_push()]] as tool}
						<DropdownMenu.CheckboxItem
							checked={activeEditTool === tool[0]}
							onCheckedChange={() => toggleEditTool(tool[0] as AdvancedEditTool)}
						>
							{tool[1]}
						</DropdownMenu.CheckboxItem>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
		<div class="ml-auto flex items-center gap-1">
			{#if selectedItem}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class="size-7 rounded"
								aria-label={m.image_editor_more_actions()}
							>
								<MoreHorizontalIcon class="size-3.5" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="video-editor-theme w-60" align="end">
						<DropdownMenu.Item
							disabled={bentoEligibleIds.length < 2}
							onclick={() => (bentoLayoutOpen = true)}
						>
							{m.video_editor_bento_open()}
						</DropdownMenu.Item>
						<DropdownMenu.Item
							disabled={!canFreezeSelectedItem || freezeFramePending}
							onclick={() => onfreezeframe(selectedItem.id)}
						>
							{m.video_editor_freeze_frame()}
						</DropdownMenu.Item>
						<DropdownMenu.Item disabled={!canJoinSelectedItems} onclick={joinSelection}>
							{m.video_editor_join_selected()}
						</DropdownMenu.Item>
						{#if captionConsolidationTarget}
							<DropdownMenu.Item onclick={consolidateSelection}>
								{m.video_editor_consolidate_captions()}
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Separator />
						<DropdownMenu.Item disabled={!canLinkSelectedItems} onclick={linkSelection}>
							{m.video_editor_link_selected()}
						</DropdownMenu.Item>
						<DropdownMenu.Item disabled={!canUnlinkSelectedItems} onclick={unlinkSelection}>
							{m.video_editor_unlink_selected()}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<span class="mr-2 max-w-40 truncate rounded bg-[oklch(0.22_0.01_50)] px-2 py-0.5 text-xs">
					{selectedItemIds.length > 1
						? m.video_editor_items_selected({ count: selectedItemIds.length })
						: selectedItem.label}
				</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
					data-active={keyframesOpen}
					aria-pressed={keyframesOpen}
					aria-label={m.video_editor_keyframes()}
					title={m.video_editor_keyframes()}
					onclick={() => (keyframesOpen = !keyframesOpen)}
				>
					<DiamondIcon class="size-3.5" />
				</Button>
				{#if keyframesOpen}
					<AppSelect
						class="h-7 w-36 text-xs"
						value={pendingKeyframeProperty}
						options={keyframePropertyOptions}
						ariaLabel={m.video_editor_keyframe_property()}
						onValueChange={setPendingKeyframeProperty}
					/>
					<button
						type="button"
						class="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
						onclick={() => addKeyframeAtPlayhead(pendingKeyframeProperty)}
						><DiamondIcon class="size-2.5 fill-current" />
						{m.video_editor_keyframe_add()}</button
					>
					<button
						type="button"
						class="rounded px-1.5 py-0.5 text-xs font-semibold text-[oklch(0.62_0.015_55)] hover:bg-[oklch(0.22_0.01_50)] data-[active=true]:bg-[oklch(0.66_0.14_45)] data-[active=true]:text-black [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
						data-active={selectedItem
							? autoKeyframeStore.isEnabled(selectedItem.id, pendingKeyframeProperty)
							: false}
						aria-pressed={selectedItem
							? autoKeyframeStore.isEnabled(selectedItem.id, pendingKeyframeProperty)
							: false}
						aria-label={m.video_editor_property_auto_key({
							property: keyframeLabel(pendingKeyframeProperty)
						})}
						onclick={() =>
							selectedItem && autoKeyframeStore.toggle(selectedItem.id, pendingKeyframeProperty)}
						>A</button
					>
					<button
						type="button"
						class="rounded px-1 py-0.5 text-xs hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
						disabled={clearableKeyframeCount === 0}
						aria-label={m.video_editor_clear_keyframes_toolbar()}
						title={m.video_editor_clear_keyframes_toolbar_hint()}
						onclick={openClearKeyframesDialog}
					>
						{m.video_editor_clear_keyframes_toolbar()}
					</button>
					<AppSelect
						class="h-7 w-24 text-xs"
						value={keyframeEditorMode}
						options={keyframeViewOptions}
						ariaLabel={m.video_editor_keyframe_view()}
						onValueChange={setKeyframeEditorMode}
					/>
				{/if}
			{/if}
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
				data-active={beatPanelOpen}
				aria-pressed={beatPanelOpen}
				aria-label={m.video_editor_beat_panel_title()}
				title={m.video_editor_beat_panel_title()}
				onclick={toggleBeatPanel}
			>
				<MusicIcon class="size-3.5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="size-7 rounded data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]"
				data-active={mixerOpen}
				aria-pressed={mixerOpen}
				aria-label={m.video_editor_mixer_toggle()}
				title={m.video_editor_mixer_toggle_hint()}
				onclick={toggleMixer}
			>
				<SlidersHorizontalIcon class="size-3.5" />
			</Button>
			<button
				type="button"
				class="rounded p-1 hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
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
				class="rounded p-1 hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
				aria-label={m.video_editor_zoom_in()}
				title={m.video_editor_zoom_in_hint()}
				onclick={() => zoomBy(TIMELINE_ZOOM_STEP)}
			>
				<ZoomInIcon class="size-4" />
			</button>
			<button
				type="button"
				class="min-w-10 rounded px-1 py-0.5 font-mono text-xs text-[oklch(0.7_0.015_55)] tabular-nums hover:bg-[oklch(0.22_0.01_50)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
				aria-label={m.video_editor_zoom_100()}
				title={m.video_editor_zoom_100_hint()}
				onclick={zoomTo100}
			>
				{Math.round(zoom * 100)}%
			</button>
			<button
				type="button"
				class="rounded p-1 hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
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
			class="flex min-h-9 max-w-full items-center gap-2 overflow-x-auto border-t border-[oklch(0.25_0.015_55)] px-3 py-1 text-xs"
		>
			<FlagIcon class="size-3.5 shrink-0" style={`color:${selectedMarker.color}`} />
			<span class="shrink-0 font-medium text-white/85">{markerName(selectedMarker)}</span>
			<label class="flex items-center gap-1 text-[oklch(0.65_0.015_55)]">
				{m.video_editor_marker_label()}
				<Input
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
				<Input
					class="h-7 w-20 rounded border border-[oklch(0.3_0.01_55)] bg-[oklch(0.2_0.008_55)] px-2 font-mono text-white outline-none focus:border-[oklch(0.66_0.14_45)]"
					type="number"
					aria-label={m.video_editor_marker_frame()}
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
				<span class="font-mono text-xs tabular-nums">
					{formatTimelinePreviewTimecode(selectedMarker.frame, timelineStore.fps)}
				</span>
			</label>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class="size-7 rounded border border-[oklch(0.3_0.01_55)]"
							aria-label={m.video_editor_marker_color()}
						>
							<span
								class="size-4 rounded-full border border-black/30"
								style={`background:${selectedMarker.color}`}
							></span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="video-editor-theme w-48 p-2" align="start">
					<div class="flex items-center gap-2 px-1 pb-2 text-xs text-[var(--video-editor-muted)]">
						<Input
							class="size-7 cursor-pointer rounded border border-[oklch(0.3_0.01_55)] bg-transparent p-0.5"
							type="color"
							aria-label={m.video_editor_marker_color()}
							value={markerColorForInput(selectedMarker.color)}
							onchange={(event) =>
								commitMarkerPatch(selectedMarker, {
									color: event.currentTarget.value
								})}
						/>
						{m.video_editor_marker_color()}
					</div>
					<div
						class="grid grid-cols-6 gap-1 border-t border-[oklch(0.28_0.014_55)] pt-2"
						role="group"
						aria-label={m.video_editor_marker_color()}
					>
						{#each MARKER_PRESET_COLORS as color, index (color)}
							<button
								type="button"
								class="grid size-6 place-items-center rounded focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [@media(pointer:coarse)]:size-11"
								aria-label={m.video_editor_marker_color_choice({ number: index + 1 })}
								aria-pressed={selectedMarker.color.toLowerCase() === color.toLowerCase()}
								onclick={() => commitMarkerPatch(selectedMarker, { color })}
							>
								<span
									class="size-4 rounded-full border border-black/30 {selectedMarker.color.toLowerCase() ===
									color.toLowerCase()
										? 'ring-2 ring-white/80'
										: ''}"
									style={`background:${color}`}
								></span>
							</button>
						{/each}
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="mt-2 h-7 w-full justify-center text-xs"
						disabled={selectedMarker.color.toLowerCase() === DEFAULT_MARKER_COLOR}
						onclick={() => commitMarkerPatch(selectedMarker, { color: DEFAULT_MARKER_COLOR })}
					>
						{m.video_editor_marker_reset_color()}
					</Button>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
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
		<div class="relative min-h-0 shrink-0" style:height={`${mixerHeight}px`} data-audio-mixer-dock>
			<PanelResizeHandle
				edge="top"
				value={mixerHeight}
				minimum={Math.min(160, mixerMaximum)}
				maximum={mixerMaximum}
				defaultValue={Math.min(224, mixerMaximum)}
				label={m.video_editor_mixer()}
				onresize={resizeMixer}
				oncommit={(value) => editorSettings.set('audioMixerHeight', value)}
			/>
			<AudioMixerPanel />
		</div>
	{/if}

	{#if beatPanelOpen}
		<BeatDetectionPanel bind:selectedItemId />
	{/if}

	<ContextMenu.Root>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
				<div
					{...props}
					bind:this={scrollContainer}
					id="video-editor-timeline-scroll"
					tabindex="-1"
					data-media-placement-surface
					oncontextmenucapture={prepareTimelineContextMenu}
					onkeydown={openTimelineContextMenuFromKeyboard}
					onscroll={scheduleTimelineViewportUpdate}
					onpointerdown={(event) => {
						clearHoverPreview();
						if (mediaPlacement.request) return;
						startMarquee(event);
					}}
					onpointermove={rememberTimelinePointer}
					onpointerleave={forgetTimelinePointer}
					onwheel={onTimelineWheel}
					class="relative min-h-24 flex-1 overflow-auto pb-2"
					role="region"
					aria-label={m.video_editor_timeline()}
				>
					{#if mediaPlacement.request && mediaDropPreview}
						<div
							class="pointer-events-none absolute top-1 right-2 left-2 z-[70] w-auto rounded-md border border-[oklch(0.38_0.015_55)] bg-[oklch(0.17_0.01_55_/_0.96)] px-3 py-1.5 text-xs text-white shadow-xl sm:right-auto sm:left-1/2 sm:w-max sm:max-w-[calc(100%-1rem)] sm:-translate-x-1/2"
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
									class="absolute bottom-0 border-l border-[oklch(0.3_0.01_55)] pl-1 font-mono text-xs text-[oklch(0.65_0.015_55)]"
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
									class="pointer-events-auto absolute top-0 flex h-6 w-5 -translate-x-1/2 cursor-grab items-start justify-center pt-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white active:cursor-grabbing [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
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
								class="relative border-b border-[oklch(0.22_0.01_50)] {resolvedTrack.visible ===
									false ||
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
											updateMediaDropPreview(
												request.payload,
												track.id,
												position.from,
												position.snapTarget
											);
										}}
								ondragenter={track.isGroup
									? undefined
									: (event) => {
											if (
												!previewMediaDrop(event, track.id) &&
												!previewGeneratedItemDrop(event, track.id) &&
												!previewEffectAdjustmentDrop(event, track.id)
											) {
												previewSceneDrop(event, track.id);
											}
										}}
								ondragover={track.isGroup
									? undefined
									: (event) => {
											if (
												!previewMediaDrop(event, track.id) &&
												!previewGeneratedItemDrop(event, track.id) &&
												!previewEffectAdjustmentDrop(event, track.id)
											) {
												previewSceneDrop(event, track.id);
											}
										}}
								ondragleave={track.isGroup
									? undefined
									: (event) => {
											leaveMediaDrop(event);
											leaveGeneratedItemDrop(event);
											leaveEffectAdjustmentDrop(event);
											leaveSceneDrop(event);
										}}
								ondrop={track.isGroup
									? undefined
									: (event) => {
											if (
												!dropMedia(event, track.id) &&
												!dropGeneratedItem(event, track.id) &&
												!dropEffectAdjustment(event, track.id)
											) {
												dropScene(event, track.id);
											}
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
														!trackChildren(timelineStore.tracks, track.id).some(
															(child) => child.id === id
														)
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
											editTrack(
												() => toggleTrackMute(track.id),
												track.muted ? 'toggleOff' : 'toggleOn'
											)}
										onsolo={() =>
											editTrack(
												() => toggleTrackSolo(track.id),
												track.solo ? 'toggleOff' : 'toggleOn'
											)}
										onlock={() =>
											editTrack(
												() => toggleTrackLock(track.id),
												track.locked ? 'toggleOff' : 'toggleOn'
											)}
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
										class="pointer-events-none absolute top-1 z-20 h-[calc(100%-8px)] overflow-hidden rounded-sm border border-dashed border-[oklch(0.72_0.13_45)] bg-[oklch(0.4_0.04_250_/_0.78)] px-2 py-1 text-xs text-white shadow-lg"
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
								{#if generatedItemDropPreview?.trackId === track.id}
									<div
										class="pointer-events-none absolute top-1 z-20 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-sm border border-dashed border-fuchsia-300 bg-fuchsia-950/80 px-2 py-1 text-xs text-white shadow-lg"
										style={clipStyle({
											from: generatedItemDropPreview.from,
											durationInFrames: generatedItemDropPreview.durationInFrames,
											type: 'text'
										})}
										data-generated-item-drop-preview
									>
										<span class="block truncate">{generatedItemDropPreview.label}</span>
									</div>
								{/if}
								{#if effectAdjustmentDropPreview?.trackId === track.id}
									<div
										class="pointer-events-none absolute top-1 z-20 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-sm border border-dashed border-[oklch(0.72_0.14_45)] bg-[oklch(0.3_0.08_45_/_0.84)] px-2 py-1 text-xs text-white shadow-lg"
										style={clipStyle({
											from: effectAdjustmentDropPreview.from,
											durationInFrames: effectAdjustmentDropPreview.durationInFrames,
											type: 'adjustment'
										})}
										data-effect-adjustment-drop-preview
									>
										<span class="block truncate">{effectAdjustmentDropPreview.label}</span>
									</div>
								{/if}
								{#if mediaDropPreview && (mediaDropPreview.trackId === track.id || mediaDropPreview.secondaryTrackId === track.id)}
									<div
										class="pointer-events-none absolute top-1 z-20 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-sm border border-dashed px-2 py-1 text-xs text-white shadow-lg {mediaDropPreview.valid
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
										onpointeritem={(event, item) =>
											activeEditTool === 'razor'
												? razorSplitTimelineItem(event, item.id)
												: startDrag(event, item.id, activeEditTool ?? 'move')}
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
											class="group/timeline-item @container absolute top-1 h-[calc(100%-8px)] touch-none rounded-sm border text-left {selectedItemIds.includes(
												item.id
											)
												? 'border-[oklch(0.66_0.14_45)] ring-1 ring-[oklch(0.66_0.14_45)]'
												: 'border-transparent'} {resolvedTrack.locked ? 'opacity-75' : ''}"
											style={clipStyle(displayItem)}
											data-timeline-item-id={item.id}
											data-editor-shortcuts-enabled
											use:observeTimelineItem={item.id}
											ondragenter={(event) => previewCatalogDrop(event, item.id)}
											ondragover={(event) => previewCatalogDrop(event, item.id)}
											ondragleave={(event) => leaveCatalogDrop(event, item.id)}
											ondrop={(event) => dropCatalogItem(event, item.id)}
										>
											{#if transitionDropPreview?.hoveredItemId === item.id}
												<div
													class="pointer-events-none absolute inset-y-0 z-40 w-1/3 border border-dashed border-[oklch(0.72_0.14_45)] bg-[oklch(0.66_0.14_45_/_0.2)] {transitionDropPreview.edge ===
													'left'
														? 'left-0 rounded-l-sm'
														: 'right-0 rounded-r-sm'}"
													data-transition-drop-preview
													data-transition-edge={transitionDropPreview.edge}
												></div>
											{/if}
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
															class="absolute top-1 right-1 rounded-full bg-[oklch(0.66_0.14_45)] px-1.5 py-0.5 text-xs font-medium text-[oklch(0.16_0.008_55)]"
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
												'razor'
													? 'cursor-crosshair'
													: activeEditTool === 'track-push'
														? pushAvailability === 'ready'
															? 'cursor-col-resize'
															: 'cursor-not-allowed'
														: 'cursor-grab active:cursor-grabbing'}"
												aria-label={activeEditTool === 'track-push'
													? `${item.label}. ${m.video_editor_track_push_handle()}`
													: timelineItemAriaLabel(item, syncOffsetFrames)}
												aria-disabled={activeEditTool === 'track-push' &&
													pushAvailability !== 'ready'}
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
												onkeydown={(event) =>
													handleTimelineItemKeydown(event, item, activeEditTool)}
												onpointerdown={(event) =>
													activeEditTool === 'razor'
														? razorSplitTimelineItem(event, item.id)
														: startDrag(event, item.id, activeEditTool ?? 'move')}
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
													{@const waveform = timelineWaveform(displayItem)}
													{#if waveform}
														<svg
															class="pointer-events-none absolute bottom-0 h-10 origin-center"
															style="left:{waveform.leftPx}px;width:{waveform.widthPx}px;transform:scaleY({displayItem.type ===
															'audio'
																? audioVolumeWaveformScale(audioVolumeDb(displayItem))
																: 1})"
															viewBox="0 0 {waveform.widthPx} {TIMELINE_WAVEFORM_HEIGHT}"
															preserveAspectRatio="none"
															data-waveform-window
															data-render-width={waveform.widthPx}
															data-clip-width={waveform.clipWidthPx}
														>
															<polyline
																points={waveform.points}
																fill="none"
																stroke="oklch(0.85 0.03 120)"
																stroke-width="0.6"
															/>
														</svg>
													{/if}
												{/if}
												<span
													class="relative z-10 min-w-0 flex-1 truncate px-2 text-xs text-white/90"
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
														class="relative z-10 mr-2 rounded bg-black/55 px-1 py-0.5 text-xs font-semibold text-white/85"
														title={m.video_editor_clip_reverse()}
													>
														{m.video_editor_clip_reverse_badge()}
													</span>
												{/if}
											</button>
											<TimelineFadeHandles
												{item}
												selected={selectedItemIds.includes(item.id)}
												trackLocked={isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)}
												{activeEditTool}
												{onedit}
											/>
											{#if displayItem.type === 'audio' && selectedItemIds.includes(item.id) && activeEditTool === null}
												{@const volumeDb = audioVolumeDb(displayItem)}
												<button
													type="button"
													role="slider"
													class="absolute inset-x-0 z-30 h-3 -translate-y-1/2 cursor-ns-resize touch-none rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white [@media(pointer:coarse)]:h-11"
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
															class="pointer-events-none absolute right-1 bottom-full mb-1 rounded bg-black/90 px-1.5 py-0.5 font-mono text-xs text-white shadow-lg"
															data-audio-volume-readout
														>
															{formatAudioVolumeDb(volumeDb)}
														</span>
													{/if}
												</button>
											{/if}
											<button
												type="button"
												class="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white [@media(pointer:coarse)]:w-11 {activeEditTool ===
												'track-push'
													? pushAvailability === 'ready'
														? 'bg-cyan-400/45 hover:bg-cyan-300/70'
														: 'cursor-not-allowed bg-white/10'
													: 'bg-white/15 hover:bg-white/40'}"
												aria-label={activeEditTool === 'track-push'
													? m.video_editor_track_push_handle()
													: m.video_editor_trim_start()}
												aria-disabled={activeEditTool === 'track-push' &&
													pushAvailability !== 'ready'}
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
												class="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-white/15 opacity-0 group-hover:opacity-100 hover:bg-white/40 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white [@media(pointer:coarse)]:w-11"
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
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											class="group absolute top-1 z-30 flex h-[calc(100%-8px)] items-start justify-center rounded-sm border bg-[repeating-linear-gradient(135deg,oklch(0.66_0.14_45_/_0.2)_0_4px,transparent_4px_8px)] {selectedTransitionId ===
											transition.id
												? 'border-[oklch(0.82_0.16_65)] ring-2 ring-[oklch(0.66_0.14_45_/_0.48)]'
												: 'border-[oklch(0.76_0.14_45_/_0.7)]'}"
											style="left:{geometry.left}px;width:{geometry.width}px"
											data-transition-id={transition.id}
											ondragenter={(event) => previewTransitionBridgeDrop(event, transition.id)}
											ondragover={(event) => previewTransitionBridgeDrop(event, transition.id)}
											ondragleave={(event) => leaveTransitionBridgeDrop(event, transition.id)}
											ondrop={(event) => dropTransitionOnBridge(event, transition.id)}
										>
											{#if transitionBridgeDropPreviewId === transition.id}
												<div
													class="pointer-events-none absolute inset-0 z-30 rounded-sm border border-dashed border-[oklch(0.88_0.17_65)] bg-[oklch(0.66_0.14_45_/_0.28)]"
													data-transition-bridge-drop-preview
												></div>
											{/if}
											<button
												type="button"
												class="absolute inset-0 overflow-hidden rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[oklch(0.82_0.16_65)]"
												aria-label={m.video_editor_transition()}
												onclick={() => selectTransition(transition.id)}
											>
												<span
													class="mt-0.5 inline-block max-w-[calc(100%-8px)] truncate rounded bg-[oklch(0.16_0.008_55_/_0.88)] px-1 text-xs font-medium whitespace-nowrap text-[oklch(0.88_0.09_65)]"
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
												class="absolute inset-y-0 -left-3 z-20 w-6 cursor-ew-resize touch-none rounded-l-sm opacity-0 group-hover:opacity-100 hover:bg-white/25 hover:opacity-100 focus-visible:bg-white/25 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white [@media(pointer:coarse)]:-left-[22px] [@media(pointer:coarse)]:w-11"
												aria-label={m.video_editor_transition_resize_start()}
												title={m.video_editor_transition_resize_keyboard()}
												onkeydown={(event) =>
													resizeTransitionWithKeyboard(event, transition, 'left')}
												onpointerdown={(event) => startTransitionResize(event, transition, 'left')}
											></button>
											<button
												type="button"
												class="absolute inset-y-0 -right-3 z-20 w-6 cursor-ew-resize touch-none rounded-r-sm opacity-0 group-hover:opacity-100 hover:bg-white/25 hover:opacity-100 focus-visible:bg-white/25 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white [@media(pointer:coarse)]:-right-[22px] [@media(pointer:coarse)]:w-11"
												aria-label={m.video_editor_transition_resize_end()}
												title={m.video_editor_transition_resize_keyboard()}
												onkeydown={(event) =>
													resizeTransitionWithKeyboard(event, transition, 'right')}
												onpointerdown={(event) => startTransitionResize(event, transition, 'right')}
											></button>
										</div>
									{/if}
								{/each}
								{#if !track.isGroup}<div
										class="absolute inset-x-0 bottom-0 z-50 h-2 cursor-row-resize touch-none bg-transparent focus-visible:bg-[oklch(0.66_0.14_45_/_0.25)] focus-visible:outline-none [@media(pointer:coarse)]:h-11"
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
						{#if selectedItem && keyframesOpen}
							<div
								class="relative bg-[oklch(0.145_0.008_55)]"
								role="group"
								aria-label={m.video_editor_keyframe_view()}
								data-keyframe-shortcuts
								onpointerenter={() => (keyframeShortcutPointerInside = true)}
								onpointerleave={() => (keyframeShortcutPointerInside = false)}
							>
								{#if keyframeEditorMode !== 'graph'}
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
								{/if}
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
										class="flex min-h-10 flex-wrap items-center gap-2 border-t border-[oklch(0.25_0.015_55)] px-2 py-1 text-xs"
									>
										<span class="font-medium capitalize"
											>{keyframeLabel(selectedKeyframe.property)}</span
										>
										<label class="flex items-center gap-1">
											{m.video_editor_keyframe_easing()}
											<AppSelect
												class="h-7 w-28 text-xs"
												value={selectedEasing}
												options={easingOptions}
												onValueChange={(value) => commitEasing(easingFromValue(value))}
											/>
										</label>
										{#if selectedEasing === 'cubic-bezier'}
											<AppSelect
												class="h-7 w-32 text-xs"
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
														onchange={(event) =>
															commitBezier(key, event.currentTarget.valueAsNumber)}
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
														onchange={(event) =>
															commitSpring(key, event.currentTarget.valueAsNumber)}
													/></label
												>{/each}
										{/if}
										{#if selectedEasing === 'cubic-bezier' || selectedEasing === 'spring'}
											<div
												class="flex items-center gap-1 border-l border-[oklch(0.28_0.012_55)] pl-2"
											>
												<AppSelect
													class="h-7 w-32 text-xs"
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
													class="h-7 rounded border border-[oklch(0.32_0.015_55)] px-2 font-medium hover:bg-[oklch(0.25_0.012_55)] disabled:opacity-35 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
													disabled={!customPresetName.trim()}
													onclick={saveCustomPreset}>{m.video_editor_keyframe_preset_save()}</button
												>
												{#if selectedCustomPresetName}
													<button
														type="button"
														class="h-7 rounded px-2 text-[oklch(0.72_0.1_28)] hover:bg-[oklch(0.3_0.08_28_/_0.22)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
														onclick={deleteCustomPreset}
														>{m.video_editor_keyframe_preset_delete()}</button
													>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
								{#if keyframeEditorMode !== 'dopesheet'}
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
										fitRequest={keyframeGraphFitRequest}
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
			{/snippet}
		</ContextMenu.Trigger>
		<ContextMenu.Content class="video-editor-theme w-60">
			{#if contextTransition}
				<ContextMenu.Item variant="destructive" onclick={removeContextTransition}>
					{m.video_editor_transition_delete()}
				</ContextMenu.Item>
			{:else if timelineContextTarget?.kind === 'items'}
				{#if contextPrimaryItem?.compositionId}
					<ContextMenu.Item
						onclick={() => {
							if (contextPrimaryItem?.compositionId) {
								onopencomposition(contextPrimaryItem.compositionId);
							}
						}}
					>
						{m.video_editor_sequence_open()}
					</ContextMenu.Item>
					<ContextMenu.Item
						disabled={!contextItemsAllEditable}
						onclick={() => ondissolvecompound(contextPrimaryItem.id)}
					>
						{m.video_editor_dissolve_compound()}
					</ContextMenu.Item>
				{:else if contextPrimaryItem}
					<ContextMenu.Item
						disabled={!contextItemsAllEditable}
						onclick={() => oncreatecompound(contextItems.map((item) => item.id))}
					>
						{m.video_editor_create_compound()}
					</ContextMenu.Item>
				{/if}
				{#if hasContextEditTools}
					<ContextMenu.Sub>
						<ContextMenu.SubTrigger>{m.video_editor_tools()}</ContextMenu.SubTrigger>
						<ContextMenu.SubContent class="video-editor-theme w-56">
							{#if contextPrimaryItem?.type === 'video' || contextPrimaryItem?.type === 'audio'}
								<ContextMenu.Item
									disabled={!contextMediaItemsEditable}
									onclick={() =>
										onreverseitems(contextMediaItemIds, contextPrimaryItem?.isReversed !== true)}
								>
									{m.video_editor_clip_reverse()}
									<ContextMenu.Shortcut>
										{contextPrimaryItem?.isReversed
											? m.video_editor_clip_reverse_on()
											: m.video_editor_clip_reverse_off()}
									</ContextMenu.Shortcut>
								</ContextMenu.Item>
								{#if contextPrimaryItem?.type === 'video'}
									<ContextMenu.Sub>
										<ContextMenu.SubTrigger
											disabled={sceneScanPending ||
												isTrackEffectivelyLocked(contextPrimaryItem.trackId, timelineStore.tracks)}
										>
											{m.video_editor_scene_split()}
										</ContextMenu.SubTrigger>
										<ContextMenu.SubContent class="video-editor-theme w-52">
											<ContextMenu.Item
												onclick={() => onsplitscenes(contextPrimaryItem.id, 'fast')}
											>
												{m.video_editor_scene_split_fast()}
												<ContextMenu.Shortcut>4 fps</ContextMenu.Shortcut>
											</ContextMenu.Item>
											<ContextMenu.Item
												onclick={() => onsplitscenes(contextPrimaryItem.id, 'adaptive-lfm')}
											>
												{m.video_editor_scene_split_adaptive()}
												<ContextMenu.Shortcut>Local</ContextMenu.Shortcut>
											</ContextMenu.Item>
										</ContextMenu.SubContent>
									</ContextMenu.Sub>
								{/if}
								<ContextMenu.Separator />
								<ContextMenu.Item
									onclick={() => onopenspeechcleanup('fillers', contextMediaItemIds)}
								>
									{m.video_editor_cleanup_fillers_short()}
								</ContextMenu.Item>
								<ContextMenu.Item
									onclick={() => onopenspeechcleanup('silence', contextMediaItemIds)}
								>
									{m.video_editor_cleanup_silence_short()}
								</ContextMenu.Item>
							{:else if contextPrimaryItem?.type === 'text' && contextVoiceText}
								<ContextMenu.Item
									onclick={() => oncreatevoice(contextPrimaryItem.id, contextVoiceText)}
								>
									{m.video_editor_text_create_voice()}
								</ContextMenu.Item>
							{/if}
							{#if contextPrimaryItem && (contextCanManageCaptions || captionConsolidationTarget)}
								<ContextMenu.Sub>
									<ContextMenu.SubTrigger>{m.video_editor_tool_captions()}</ContextMenu.SubTrigger>
									<ContextMenu.SubContent class="video-editor-theme w-60">
										{#if contextCanManageCaptions}
											<ContextMenu.Item
												disabled={transcriptionPendingSet.has(contextPrimaryItem.id)}
												onclick={() => ontranscribecaptions(contextPrimaryItem.id)}
											>
												{transcriptionPendingSet.has(contextPrimaryItem.id)
													? m.video_editor_captions_updating()
													: contextHasTranscriptCaptions
														? m.video_editor_captions_regenerate()
														: m.video_editor_captions_generate()}
											</ContextMenu.Item>
											<ContextMenu.Item
												disabled={aiCaptionPendingSet.has(contextPrimaryItem.id)}
												onclick={() => onaicaptions(contextPrimaryItem.id)}
											>
												{aiCaptionPendingSet.has(contextPrimaryItem.id)
													? m.video_editor_ai_scene_captions_updating()
													: contextHasAiCaptions
														? m.video_editor_ai_scene_captions_refresh()
														: m.video_editor_ai_scene_captions_generate()}
											</ContextMenu.Item>
										{/if}
										{#if contextCanExtractEmbeddedSubtitles}
											<ContextMenu.Item onclick={() => onextractsubtitles(contextPrimaryItem.id)}>
												{m.video_editor_extract_embedded_subtitles()}
											</ContextMenu.Item>
										{/if}
										{#if captionConsolidationTarget}
											<ContextMenu.Item onclick={consolidateSelection}>
												{m.video_editor_consolidate_captions()}
											</ContextMenu.Item>
										{/if}
									</ContextMenu.SubContent>
								</ContextMenu.Sub>
							{/if}
							{#if hasContextGradeActions}
								{#if hasContextPrimaryEditTools}<ContextMenu.Separator />{/if}
								{#if contextGradeSourceItem}
									<ContextMenu.Item onclick={() => oncopygrade(contextGradeSourceItem.id)}>
										{m.video_editor_color_copy_grade()}
									</ContextMenu.Item>
								{/if}
								{#if colorPreviewStore.gradeClipboard?.length && contextGradeTargetItemIds.length > 0}
									<ContextMenu.Item onclick={() => onpastegrade(contextGradeTargetItemIds)}>
										{m.video_editor_color_paste_grade()}
									</ContextMenu.Item>
								{/if}
							{/if}
						</ContextMenu.SubContent>
					</ContextMenu.Sub>
				{/if}
				{#if contextPrimaryItem?.type === 'video'}
					<ContextMenu.Item
						disabled={!canFreezeSelectedItem || freezeFramePending}
						onclick={() => {
							if (contextPrimaryItem) onfreezeframe(contextPrimaryItem.id);
						}}
					>
						{m.video_editor_freeze_frame()}
					</ContextMenu.Item>
				{/if}
				{#if contextJoinableNeighbors.previous}
					<ContextMenu.Item
						onclick={() => joinContextNeighbor(contextJoinableNeighbors.previous.id)}
					>
						{m.video_editor_join_previous()}
						<ContextMenu.Shortcut
							>{formatShortcutBinding(keyboardShortcuts.bindings.JOIN_ITEMS)}</ContextMenu.Shortcut
						>
					</ContextMenu.Item>
				{/if}
				{#if contextJoinableNeighbors.next}
					<ContextMenu.Item onclick={() => joinContextNeighbor(contextJoinableNeighbors.next.id)}>
						{m.video_editor_join_next()}
						<ContextMenu.Shortcut
							>{formatShortcutBinding(keyboardShortcuts.bindings.JOIN_ITEMS)}</ContextMenu.Shortcut
						>
					</ContextMenu.Item>
				{/if}
				{#if canJoinSelectedItems}
					<ContextMenu.Item onclick={joinSelection}>
						{m.video_editor_join_selected()}
						<ContextMenu.Shortcut
							>{formatShortcutBinding(keyboardShortcuts.bindings.JOIN_ITEMS)}</ContextMenu.Shortcut
						>
					</ContextMenu.Item>
				{/if}
				{#if bentoEligibleIds.length >= 2}
					<ContextMenu.Item onclick={() => (bentoLayoutOpen = true)}>
						{m.video_editor_bento_open()}
					</ContextMenu.Item>
				{/if}
				{#if clearableKeyframeCount > 0 || lockedAnimatedSelectionCount > 0}
					<ContextMenu.Item
						disabled={clearableKeyframeCount === 0}
						onclick={openClearKeyframesDialog}
					>
						{m.video_editor_clear_keyframes_toolbar()}
						<ContextMenu.Shortcut
							>{formatShortcutBinding(
								keyboardShortcuts.bindings.CLEAR_KEYFRAMES
							)}</ContextMenu.Shortcut
						>
					</ContextMenu.Item>
				{/if}
				{#if hasContextClipActions}<ContextMenu.Separator />{/if}
				<ContextMenu.Item onclick={() => oncutselection()}>
					{m.video_editor_shortcuts_command_cut()}
					<ContextMenu.Shortcut
						>{formatShortcutBinding(keyboardShortcuts.bindings.CUT)}</ContextMenu.Shortcut
					>
				</ContextMenu.Item>
				<ContextMenu.Item onclick={() => oncopyselection()}>
					{m.common_copy()}
					<ContextMenu.Shortcut
						>{formatShortcutBinding(keyboardShortcuts.bindings.COPY)}</ContextMenu.Shortcut
					>
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item disabled={!contextItemsEditable} onclick={onsplitselection}>
					{m.video_editor_shortcuts_command_split()}
					<ContextMenu.Shortcut
						>{formatShortcutBinding(
							keyboardShortcuts.bindings.SPLIT_AT_PLAYHEAD
						)}</ContextMenu.Shortcut
					>
				</ContextMenu.Item>
				{#if canLinkSelectedItems}
					<ContextMenu.Item onclick={linkSelection}
						>{m.video_editor_link_selected()}</ContextMenu.Item
					>
				{:else if canUnlinkSelectedItems}
					<ContextMenu.Item onclick={unlinkSelection}
						>{m.video_editor_unlink_selected()}</ContextMenu.Item
					>
				{/if}
				<ContextMenu.Separator />
				<ContextMenu.Item
					variant="destructive"
					disabled={!contextItemsEditable}
					onclick={ondeleteselection}
				>
					{m.video_editor_delete_leave_gap()}
					<ContextMenu.Shortcut
						>{formatShortcutBinding(
							keyboardShortcuts.bindings.DELETE_SELECTED
						)}</ContextMenu.Shortcut
					>
				</ContextMenu.Item>
				<ContextMenu.Item
					variant="destructive"
					disabled={!contextItemsEditable}
					onclick={onrippledeleteselection}
				>
					{m.video_editor_ripple_delete()}
					<ContextMenu.Shortcut
						>{formatShortcutBinding(keyboardShortcuts.bindings.RIPPLE_DELETE)}</ContextMenu.Shortcut
					>
				</ContextMenu.Item>
			{:else if contextMarker}
				<ContextMenu.Item onclick={() => selectMarker(contextMarker)}>
					{markerName(contextMarker)} · {m.video_editor_marker_frame_value({
						frame: contextMarker.frame
					})}
				</ContextMenu.Item>
				<ContextMenu.Sub>
					<ContextMenu.SubTrigger>{m.video_editor_marker_color()}</ContextMenu.SubTrigger>
					<ContextMenu.SubContent class="video-editor-theme w-44">
						{#each MARKER_PRESET_COLORS as color, index (color)}
							<ContextMenu.Item onclick={() => commitMarkerPatch(contextMarker, { color })}>
								<span
									class="size-3 rounded-full border border-black/30"
									style={`background:${color}`}
								></span>
								{m.video_editor_marker_color_choice({ number: index + 1 })}
							</ContextMenu.Item>
						{/each}
						<ContextMenu.Separator />
						<ContextMenu.Item
							disabled={contextMarker.color.toLowerCase() === DEFAULT_MARKER_COLOR}
							onclick={() => commitMarkerPatch(contextMarker, { color: DEFAULT_MARKER_COLOR })}
						>
							{m.video_editor_marker_reset_color()}
						</ContextMenu.Item>
					</ContextMenu.SubContent>
				</ContextMenu.Sub>
				<ContextMenu.Separator />
				<ContextMenu.Item
					variant="destructive"
					onclick={() => deleteTimelineMarker(contextMarker.id)}
				>
					{m.video_editor_delete_marker()}
				</ContextMenu.Item>
			{:else if contextTrack}
				{@const parentTrack = contextTrack.parentTrackId
					? timelineStore.tracks.find((track) => track.id === contextTrack.parentTrackId)
					: undefined}
				{@const effectiveContextTrack = effectiveTrackState(contextTrack, timelineStore.tracks)}
				{#if !contextTrack.isGroup}
					<ContextMenu.Item disabled={!contextTrackGapsCanClose} onclick={closeContextTrackGaps}>
						{m.video_editor_track_close_all_gaps()}
					</ContextMenu.Item>
					<ContextMenu.Separator />
					<ContextMenu.Sub>
						<ContextMenu.SubTrigger>{m.video_editor_track_add()}</ContextMenu.SubTrigger>
						<ContextMenu.SubContent class="video-editor-theme w-48">
							<ContextMenu.Item onclick={() => addNamedTrack('video')}>
								{m.video_editor_track_add_video()}
							</ContextMenu.Item>
							<ContextMenu.Item onclick={() => addNamedTrack('audio')}>
								{m.video_editor_track_add_audio()}
							</ContextMenu.Item>
						</ContextMenu.SubContent>
					</ContextMenu.Sub>
					<ContextMenu.Item
						disabled={contextEmptyTrackIds.length === 0}
						onclick={removeContextEmptyTracks}
					>
						{m.video_editor_track_delete_empty()}
					</ContextMenu.Item>
					<ContextMenu.Separator />
				{/if}
				<ContextMenu.Item
					disabled={parentTrack?.visible === false}
					onclick={() => editTrack(() => toggleTrackVisibility(contextTrack.id))}
				>
					{effectiveContextTrack.visible
						? m.video_editor_track_hide()
						: m.video_editor_track_show()}
				</ContextMenu.Item>
				<ContextMenu.Item
					disabled={Boolean(parentTrack?.locked)}
					onclick={() => editTrack(() => toggleTrackLock(contextTrack.id))}
				>
					{effectiveContextTrack.locked
						? m.video_editor_track_unlock()
						: m.video_editor_track_lock()}
				</ContextMenu.Item>
				<ContextMenu.Item
					disabled={Boolean(parentTrack?.muted)}
					onclick={() => editTrack(() => toggleTrackMute(contextTrack.id))}
				>
					{effectiveContextTrack.muted
						? m.video_editor_track_unmute()
						: m.video_editor_track_mute()}
				</ContextMenu.Item>
				<ContextMenu.Item
					disabled={Boolean(parentTrack?.solo)}
					onclick={() => editTrack(() => toggleTrackSolo(contextTrack.id))}
				>
					{effectiveContextTrack.solo ? m.video_editor_track_unsolo() : m.video_editor_track_solo()}
				</ContextMenu.Item>
				{#if contextTrack.isGroup}
					<ContextMenu.Item onclick={() => editTrack(() => ungroupTracks(contextTrack.id))}>
						{m.video_editor_track_group_ungroup_hint()}
					</ContextMenu.Item>
				{:else}
					<ContextMenu.Item onclick={() => editTrack(() => toggleTrackSyncLock(contextTrack.id))}>
						{contextTrack.syncLock !== false
							? m.video_editor_track_sync_unlock()
							: m.video_editor_track_sync_lock()}
					</ContextMenu.Item>
				{/if}
				<ContextMenu.Separator />
				<ContextMenu.Item
					variant="destructive"
					disabled={contextTrack.isGroup
						? mediaTracks(timelineStore.tracks).length -
								trackChildren(timelineStore.tracks, contextTrack.id).length <
							1
						: mediaTracks(timelineStore.tracks).length <= 1}
					onclick={() =>
						contextTrack.isGroup
							? requestDeleteGroup(contextTrack.id)
							: deleteTrack(contextTrack.id)}
				>
					{contextTrack.isGroup
						? m.video_editor_track_group_delete()
						: m.video_editor_track_delete()}
				</ContextMenu.Item>
			{:else if timelineContextTarget?.kind === 'space'}
				{#if contextSpaceGap}
					<ContextMenu.Item disabled={!contextSpaceGapCanClose} onclick={closeContextGap}>
						{m.video_editor_close_gap()}
					</ContextMenu.Item>
					<ContextMenu.Separator />
				{/if}
				<ContextMenu.Item onclick={() => addContextMarker(timelineContextTarget.frame)}>
					{m.video_editor_add_marker()}
					<ContextMenu.Shortcut
						>{formatShortcutBinding(keyboardShortcuts.bindings.ADD_MARKER)}</ContextMenu.Shortcut
					>
				</ContextMenu.Item>
				<ContextMenu.Item
					disabled={!itemClipboardStore.hasItems}
					onclick={() => onpasteat(timelineContextTarget.frame, timelineContextTarget.trackId)}
				>
					{m.video_editor_shortcuts_command_paste()}
					<ContextMenu.Shortcut
						>{formatShortcutBinding(keyboardShortcuts.bindings.PASTE)}</ContextMenu.Shortcut
					>
				</ContextMenu.Item>
			{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>
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
</div>
