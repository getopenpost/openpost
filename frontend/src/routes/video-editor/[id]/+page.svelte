<!--
THESIS: One editor changes layout for Edit, Color, and Motion; it refuses a one-size inspector.
OWN-WORLD: warm-black production chrome, dense measured controls, and orange only for action, selection, and the playhead.
STORY: Import, assemble, grade, animate, inspect, and export without leaving the project or losing timeline context.
FIRST VIEWPORT: persistent project bar above a task-specific workspace; Edit centers preview and timeline, Color pairs program scopes with filmstrip and grading lanes, Motion pairs layer controls with keyframe editing.
FORM: FreeCut studio-workspace grammar, pinned by the user; seed freecut-parity-2026-08-29.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import PanelResizeHandle from '$lib/components/panel-resize-handle.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		addAdjustmentLayer,
		addTextItem,
		removeItems,
		rippleDeleteItems,
		splitAtFrame,
		splitAtScenes,
		removeMarker,
		setCurrentFrame,
		toggleMarkerAtPlayhead,
		setItemSpeed,
		setItemsReversed
	} from '$lib/video-editor/timeline/actions/items';
	import { markerAfter, markerBefore } from '$lib/video-editor/timeline/markers';
	import { scanSceneCuts, type SceneScanMode } from '$lib/video-editor/media/scene-scan';
	import { cutFramesForItem } from '$lib/video-editor/media/scene-math';
	import { insertFreezeFrame } from '$lib/video-editor/media/insert-freeze-frame.svelte';
	import {
		importFromPicker,
		type UnsupportedAudioImportRequest
	} from '$lib/video-editor/media/import.svelte';
	import {
		addTransition,
		removeTransition,
		transitionsStore,
		updateTransitionPresentation
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { resolveTransitionTargetFromSelection } from '$lib/video-editor/timeline/transition-drop';
	import type { TransitionDirection } from '$lib/video-editor/project/types';
	import { addSubtitleItemFromSrt } from '$lib/video-editor/transcript/captions';
	import type { TranscriptionSelection } from '$lib/video-editor/transcript/engine/types';
	import { transcriptionService } from '$lib/video-editor/transcript/transcription-service.svelte';
	import { aiCaptionService } from '$lib/video-editor/transcript/ai-caption-service.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { conformReversePreview } from '$lib/video-editor/media/reverse-conform-service';
	import {
		copyColorGradeFromItem,
		pasteColorGradeToItems
	} from '$lib/video-editor/effects/color-grade-clipboard';
	import { renderVideoExport } from '$lib/video-editor/media/render-execution';
	import { sendToOpenPost } from '$lib/video-editor/send-to-openpost';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import MediaPoolList from '$lib/video-editor/components/media-pool-list.svelte';
	import EmbeddedSubtitlePicker from '$lib/video-editor/components/embedded-subtitle-picker.svelte';
	import SceneBrowserPanel from '$lib/video-editor/components/scene-browser-panel.svelte';
	import StockBrowserPanel from '$lib/video-editor/components/stock-browser-panel.svelte';
	import TextTemplateBrowser from '$lib/video-editor/components/text-template-browser.svelte';
	// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Shape is the editor's user-facing media type.
	import ShapePanel from '$lib/video-editor/components/shape-panel.svelte';
	import BackgroundPanel from '$lib/video-editor/components/background-panel.svelte';
	import StickerBrowserPanel from '$lib/video-editor/components/sticker-browser-panel.svelte';
	import EffectBrowserPanel from '$lib/video-editor/components/effect-browser-panel.svelte';
	import TransitionBrowserPanel from '$lib/video-editor/components/transition-browser-panel.svelte';
	import LottieBrowserPanel from '$lib/video-editor/components/lottie-browser-panel.svelte';
	import EditorAssistantPanel from '$lib/video-editor/components/editor-assistant-panel.svelte';
	import EffectsPanel from '$lib/video-editor/components/effects-panel.svelte';
	import MotionPresetsPanel from '$lib/video-editor/components/motion-presets-panel.svelte';
	import TextMotionPanel from '$lib/video-editor/components/text-motion-panel.svelte';
	import ClipPropertiesPanel from '$lib/video-editor/components/clip-properties-panel.svelte';
	import ProjectCanvasPanel from '$lib/video-editor/components/project-canvas-panel.svelte';
	import TransitionPropertiesPanel from '$lib/video-editor/components/transition-properties-panel.svelte';
	import ExportDialog from '$lib/video-editor/components/export-dialog.svelte';
	import RenderQueueController from '$lib/video-editor/components/render-queue-controller.svelte';
	import TranscriptPanel from '$lib/video-editor/components/transcript-panel.svelte';
	import TranscriptionControls from '$lib/video-editor/components/transcription-controls.svelte';
	import AiCaptionControls from '$lib/video-editor/components/ai-caption-controls.svelte';
	import MediaTaskProgress from '$lib/video-editor/components/media-task-progress.svelte';
	import SpeechCleanupDialog from '$lib/video-editor/components/speech-cleanup-dialog.svelte';
	import EditorSettingsDialog from '$lib/video-editor/components/editor-settings-dialog.svelte';
	import PreviewDiagnosticsPanel from '$lib/video-editor/components/preview-diagnostics-panel.svelte';
	import EditorWorkspaceSwitcher from '$lib/video-editor/components/editor-workspace-switcher.svelte';
	import ColorGradingDock from '$lib/video-editor/components/color-grading-dock.svelte';
	import ColorScopes from '$lib/video-editor/components/color-scopes.svelte';
	import MotionWorkspacePanel from '$lib/video-editor/components/motion-workspace-panel.svelte';
	import MotionWorkspaceEmpty from '$lib/video-editor/components/motion-workspace-empty.svelte';
	import MediaRecoveryDialog from '$lib/video-editor/components/media-recovery-dialog.svelte';
	import UnsupportedAudioImportDialog from '$lib/video-editor/components/unsupported-audio-import-dialog.svelte';
	import PreviewPlayer from '$lib/video-editor/components/preview-player.svelte';
	import SourceMonitor from '$lib/video-editor/components/source-monitor.svelte';
	import TransportBar from '$lib/video-editor/components/transport-bar.svelte';
	import TimelinePanel from '$lib/video-editor/components/timeline-panel.svelte';
	import CompositionTimeline from '$lib/video-editor/components/composition-timeline.svelte';
	import { voiceoverRecorder } from '$lib/video-editor/recorder/voiceover-recorder.svelte';
	import RecordingDialog from '$lib/video-editor/components/recording-dialog.svelte';
	import SequenceTabs from '$lib/video-editor/components/sequence-tabs.svelte';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import {
		createCompositeComposition,
		createCompoundClip,
		dissolveCompoundClip,
		switchSequence,
		type CreateCompositeCompositionOptions
	} from '$lib/video-editor/sequences/sequence-actions';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import ClapperboardIcon from '@lucide/svelte/icons/clapperboard';
	import ImagesIcon from '@lucide/svelte/icons/images';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TypeIcon from '@lucide/svelte/icons/type';
	import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
	import BetweenHorizontalStartIcon from '@lucide/svelte/icons/between-horizontal-start';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import StickerIcon from '@lucide/svelte/icons/sticker';
	import PanelsTopLeftIcon from '@lucide/svelte/icons/panels-top-left';
	import FilmIcon from '@lucide/svelte/icons/film';
	import MoreHorizontalIcon from '@lucide/svelte/icons/ellipsis';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ShapesIcon from '@lucide/svelte/icons/shapes';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import VideoIcon from '@lucide/svelte/icons/video';
	import {
		editorWorkspace,
		type EditorWorkspaceId
	} from '$lib/video-editor/workspaces/editor-workspace.svelte';
	import {
		colorGradeTargetAtFrame,
		colorSelectionSpansFrame
	} from '$lib/video-editor/timeline/color-playhead-selection';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
	import {
		canExtractEmbeddedSubtitles,
		type EmbeddedSubtitleInsertResult
	} from '$lib/video-editor/media/embedded-subtitle-service';
	import {
		editorDeleteModeForEvent,
		editorShortcutTargetIsDisabled,
		eventMatchesShortcut,
		handleGlobalPlayPauseShortcut,
		handleOpenSceneBrowserShortcut,
		type EditorShortcutId
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import { itemClipboardStore } from '$lib/video-editor/timeline/stores/item-clipboard-store.svelte';
	import { pasteTimelineItemClipboard } from '$lib/video-editor/timeline/actions/item-clipboard';
	import { handleTranscriptClipboardCopy } from '$lib/video-editor/transcript/transcript-copy-bridge';
	import { expandSelectionWithLinkedItems } from '$lib/video-editor/timeline/utils/linked-items';
	import {
		effectiveMediaTracks,
		isTrackEffectivelyLocked
	} from '$lib/video-editor/timeline/utils/track-groups';
	import { snapshotTimelineState } from '$lib/video-editor/timeline/utils/state-snapshot.svelte';
	import { emitEditorSound } from '$lib/video-editor/sounds/editor-sounds';
	import { sourceHoverStore } from '$lib/video-editor/source-monitor/source-hover.svelte';
	import { shuttleScrubResume } from '$lib/video-editor/preview/shuttle-scrub-resume.svelte';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import { mediaTasks } from '$lib/video-editor/media/media-tasks.svelte';
	import type { TextVoiceRequest } from '$lib/video-editor/local-ai/types';
	import EditInspectorTabs from '$lib/video-editor/components/edit-inspector-tabs.svelte';
	import WorkspaceGatePanel from '$lib/video-editor/components/workspace-gate-panel.svelte';
	import { createWorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';
	import {
		resolveEditInspectorTabs,
		type EditInspectorTab
	} from '$lib/video-editor/components/edit-inspector-tabs';

	const projectId = $derived(page.params.id ?? '');
	const gate = createWorkspaceGate();
	let selectedItemId = $state<string | null>(null);
	let selectedItemIds = $state<string[]>([]);
	let selectedTransitionId = $state<string | null>(null);
	let sourceMediaId = $state<string | null>(null);
	$effect(() => {
		void sourceMediaId;
		shuttleScrubResume.cancel();
	});
	let freezingItemId = $state<string | null>(null);
	let motionReturnStack = $state<Array<string | null>>([]);
	let motionWorkspaceReturnSequenceId = $state<string | null>(null);
	let motionWorkspaceReturnSelectionIds = $state<string[]>([]);
	let motionWorkspaceReturnCaptured = $state(false);
	let lastMotionCompositionId = $state<string | null>(null);
	let motionSelectionByCompositionId = $state<Record<string, string[]>>({});
	let settingsOpen = $state(false);
	let recordingOpen = $state(false);
	let unsupportedAudioRequest = $state<UnsupportedAudioImportRequest | null>(null);
	let unsupportedAudioResolve: ((decision: 'import' | 'cancel') => void) | null = null;
	type LeftPanel =
		| 'media'
		| 'stock'
		| 'text'
		| 'shapes'
		| 'backgrounds'
		| 'stickers'
		| 'effects'
		| 'transitions'
		| 'lottie'
		| 'transcript'
		| 'ai';
	let leftPanel = $state<LeftPanel>('media');
	let mediaPanelView = $state<'project' | 'scenes'>('project');
	let mobileEditPane = $state<'assets' | 'program' | 'tools'>('program');
	let assetBrowserWidth = $state(editorSettings.assetBrowserWidth);
	let inspectorPanelWidth = $state(editorSettings.inspectorPanelWidth);
	let motionPanelWidth = $state(editorSettings.motionPanelWidth);
	let sourceMonitorWidth = $state(editorSettings.sourceMonitorWidth);
	let scopesPanelWidth = $state(editorSettings.scopesPanelWidth);
	let timelineHeight = $state(editorSettings.timelineHeight);
	let colorDockHeight = $state(editorSettings.colorDockHeight);
	let mixerDockLayout = $state<{ baseHeight: number; height: number } | null>(null);
	let editorViewportWidth = $state(1280);
	let editorViewportHeight = $state(800);
	const minimumProgramWidth = 360;
	const minimumMotionPreviewWidth = 480;
	const minimumProgramHeight = 180;
	const editorHeaderHeight = 48;
	const sourceMonitorHorizontal = $derived(sourceMediaId !== null && editorViewportWidth >= 1280);
	const minimumEditCenterWidth = $derived(
		minimumProgramWidth + (sourceMonitorHorizontal ? 300 : 0)
	);
	const desktopPanelWidths = $derived.by(() => {
		let asset = Math.max(300, Math.min(480, assetBrowserWidth));
		let inspector = Math.max(280, Math.min(520, inspectorPanelWidth));
		let overflow = asset + inspector - Math.max(580, editorViewportWidth - minimumEditCenterWidth);
		if (overflow > 0) {
			const assetReduction = Math.min(asset - 300, Math.ceil(overflow / 2));
			asset -= assetReduction;
			overflow -= assetReduction;
			const inspectorReduction = Math.min(inspector - 280, overflow);
			inspector -= inspectorReduction;
			overflow -= inspectorReduction;
			asset -= Math.min(asset - 300, overflow);
		}
		return { asset, inspector };
	});
	const effectiveAssetBrowserWidth = $derived(desktopPanelWidths.asset);
	const effectiveInspectorPanelWidth = $derived(desktopPanelWidths.inspector);
	const assetBrowserMaximum = $derived(
		Math.max(
			300,
			Math.min(480, editorViewportWidth - effectiveInspectorPanelWidth - minimumEditCenterWidth)
		)
	);
	const inspectorPanelMaximum = $derived(
		Math.max(
			280,
			Math.min(520, editorViewportWidth - effectiveAssetBrowserWidth - minimumEditCenterWidth)
		)
	);
	const motionPanelMaximum = $derived(
		Math.max(300, Math.min(520, editorViewportWidth - minimumMotionPreviewWidth))
	);
	const sourceMonitorMaximum = $derived(
		Math.max(
			300,
			Math.min(
				720,
				editorViewportWidth -
					effectiveAssetBrowserWidth -
					effectiveInspectorPanelWidth -
					minimumProgramWidth
			)
		)
	);
	const scopesPanelMaximum = $derived(
		Math.max(280, Math.min(600, editorViewportWidth - minimumMotionPreviewWidth))
	);
	const timelinePanelMaximum = $derived(
		Math.max(180, Math.min(620, editorViewportHeight - editorHeaderHeight - minimumProgramHeight))
	);
	const timelinePanelMinimum = $derived(
		mixerDockLayout ? Math.min(timelinePanelMaximum, 180 + mixerDockLayout.height) : 180
	);
	const mixerPanelMaximum = $derived(Math.max(160, Math.min(420, timelinePanelMaximum - 180)));
	const colorDockMaximum = $derived(
		Math.max(280, Math.min(720, editorViewportHeight - editorHeaderHeight - 220))
	);
	const colorDockMinimum = $derived(Math.min(500, colorDockMaximum));
	const colorDockDefault = $derived(Math.min(520, colorDockMaximum));
	const effectiveMotionPanelWidth = $derived(Math.min(motionPanelWidth, motionPanelMaximum));
	const effectiveSourceMonitorWidth = $derived(Math.min(sourceMonitorWidth, sourceMonitorMaximum));
	const effectiveScopesPanelWidth = $derived(Math.min(scopesPanelWidth, scopesPanelMaximum));
	const effectiveTimelineHeight = $derived(
		Math.max(timelinePanelMinimum, Math.min(timelineHeight, timelinePanelMaximum))
	);
	const effectiveColorDockHeight = $derived(
		Math.max(colorDockMinimum, Math.min(colorDockHeight, colorDockMaximum))
	);
	let textVoiceRequest = $state<TextVoiceRequest | null>(null);
	const activeWorkspace = $derived(editorWorkspace.current);
	const activeMotionComposition = $derived(
		sequenceStore.activeSequence?.editorKind === 'composite-2d'
			? sequenceStore.activeSequence
			: undefined
	);
	const motionCompositionCount = $derived(
		sequenceStore.compositions.filter((composition) => composition.editorKind === 'composite-2d')
			.length
	);
	const showSourceMonitor = $derived(activeWorkspace === 'edit' && sourceMediaId !== null);
	const primaryLeftPanelOptions = $derived([
		{ value: 'media' as const, label: m.video_editor_media_pool(), icon: ImagesIcon },
		{ value: 'stock' as const, label: m.video_editor_stock_assets(), icon: SearchIcon },
		{ value: 'text' as const, label: m.video_editor_tool_text(), icon: TypeIcon },
		// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- The generated message key names the user-facing Shapes tool.
		{ value: 'shapes' as const, label: m.video_editor_shapes(), icon: ShapesIcon },
		{
			value: 'backgrounds' as const,
			label: m.video_editor_backgrounds_title(),
			icon: PanelsTopLeftIcon
		},
		{ value: 'stickers' as const, label: m.video_editor_stickers(), icon: StickerIcon },
		{ value: 'effects' as const, label: m.video_editor_effects(), icon: WandSparklesIcon },
		{
			value: 'transitions' as const,
			label: m.video_editor_transition(),
			icon: BetweenHorizontalStartIcon
		},
		{ value: 'lottie' as const, label: m.video_editor_animations(), icon: FilmIcon },
		{ value: 'transcript' as const, label: m.video_editor_transcript(), icon: CaptionsIcon }
	]);
	const utilityLeftPanelOptions = $derived([
		{ value: 'ai' as const, label: m.video_editor_local_ai(), icon: SparklesIcon }
	]);
	const leftPanelOptions = $derived([...primaryLeftPanelOptions, ...utilityLeftPanelOptions]);
	const leftPanelHeading = $derived(
		leftPanelOptions.find((option) => option.value === leftPanel)?.label ?? m.video_editor_assets()
	);
	const selectedLeftPanelItemIds = $derived(
		selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : []
	);

	function moveLeftPanelFocus(
		event: KeyboardEvent & { currentTarget: HTMLButtonElement },
		value: LeftPanel,
		orientation: 'horizontal' | 'vertical'
	): void {
		const currentIndex = leftPanelOptions.findIndex((option) => option.value === value);
		let nextIndex: number | null = null;
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = leftPanelOptions.length - 1;
		if (orientation === 'horizontal' && event.key === 'ArrowRight') {
			nextIndex = (currentIndex + 1) % leftPanelOptions.length;
		}
		if (orientation === 'horizontal' && event.key === 'ArrowLeft') {
			nextIndex = (currentIndex - 1 + leftPanelOptions.length) % leftPanelOptions.length;
		}
		if (orientation === 'vertical' && event.key === 'ArrowDown') {
			nextIndex = (currentIndex + 1) % leftPanelOptions.length;
		}
		if (orientation === 'vertical' && event.key === 'ArrowUp') {
			nextIndex = (currentIndex - 1 + leftPanelOptions.length) % leftPanelOptions.length;
		}
		if (nextIndex === null) return;
		const next = leftPanelOptions[nextIndex];
		if (!next) return;
		event.preventDefault();
		leftPanel = next.value;
		requestAnimationFrame(() => {
			document
				.querySelector<HTMLButtonElement>(
					`[data-left-panel-tab="${next.value}"][data-tab-orientation="${orientation}"]`
				)
				?.focus();
		});
	}
	const editInspectorHeading = $derived.by(() => {
		if (selectedTransitionId) return m.video_editor_transition();
		if (selectedItemIds.length > 1) {
			return m.video_editor_items_selected({ count: selectedItemIds.length });
		}
		if (selectedItemId) {
			return timelineStore.itemById.get(selectedItemId)?.label.trim() || m.video_editor_clip();
		}
		return m.video_editor_tools();
	});
	const selectedTranscriptionJob = $derived(
		selectedItemId ? transcriptionService.jobForItem(selectedItemId) : undefined
	);
	const selectedTranscriptionQueuePosition = $derived(
		selectedTranscriptionJob
			? transcriptionService.queuePosition(selectedTranscriptionJob.id)
			: null
	);
	const transcriptionJobCount = $derived(transcriptionService.jobs.length);
	const transcriptionPendingItemIds = $derived(transcriptionService.jobs.map((job) => job.itemId));
	const selectedAiCaptionJob = $derived(
		selectedItemId ? aiCaptionService.jobForItem(selectedItemId) : undefined
	);
	const selectedAiCaptionQueuePosition = $derived(
		selectedAiCaptionJob ? aiCaptionService.queuePosition(selectedAiCaptionJob.id) : null
	);
	const aiCaptionJobCount = $derived(aiCaptionService.jobs.length);
	const aiCaptionPendingItemIds = $derived(aiCaptionService.jobs.map((job) => job.itemId));
	let aiCaptionError = $state<string | null>(null);
	let embeddedSubtitleMedia = $state<ReturnType<typeof mediaPool.get> | null>(null);
	let embeddedSubtitlePickerOpen = $state(false);

	function openTextVoice(itemId: string, text: string): void {
		textVoiceRequest = {
			id: crypto.randomUUID(),
			sourceTextItemId: itemId,
			text
		};
		leftPanel = 'ai';
		mobileEditPane = 'assets';
	}

	function persistPanelSize(
		key:
			| 'assetBrowserWidth'
			| 'inspectorPanelWidth'
			| 'motionPanelWidth'
			| 'sourceMonitorWidth'
			| 'scopesPanelWidth'
			| 'timelineHeight'
			| 'colorDockHeight',
		value: number
	): void {
		editorSettings.set(key, value);
	}

	function constrainEditorPanels(): void {
		editorViewportWidth = window.innerWidth;
		editorViewportHeight = window.innerHeight;
	}

	function resizeTimelinePanel(value: number): void {
		timelineHeight = value;
		if (mixerDockLayout) {
			mixerDockLayout = {
				...mixerDockLayout,
				baseHeight: Math.max(180, value - mixerDockLayout.height)
			};
		}
	}

	function persistTimelinePanel(value: number): void {
		persistPanelSize('timelineHeight', mixerDockLayout?.baseHeight ?? value);
	}

	function handleMixerLayoutChange(open: boolean, height: number): void {
		if (!open) {
			if (mixerDockLayout) {
				timelineHeight = Math.min(mixerDockLayout.baseHeight, timelinePanelMaximum);
			}
			mixerDockLayout = null;
			return;
		}
		const baseHeight = mixerDockLayout?.baseHeight ?? timelineHeight;
		mixerDockLayout = { baseHeight, height };
		timelineHeight = Math.min(baseHeight + height, timelinePanelMaximum);
	}

	onMount(() => {
		constrainEditorPanels();
	});

	$effect(() => {
		if (!projectId) return;
		previewPlaybackSettings.resetZoom();
		return () => {
			transcriptionService.reset();
			aiCaptionService.reset();
			mediaTasks.reset();
		};
	});

	let mobileToolsFollowSelection = false;
	$effect(() => {
		if (selectedItemId && selectedTransitionId) selectedTransitionId = null;
		const hasSelection = Boolean(selectedItemId || selectedTransitionId);
		if (hasSelection) {
			mobileToolsFollowSelection = true;
			mobileEditPane = 'tools';
			return;
		}
		if (!mobileToolsFollowSelection) return;
		mobileToolsFollowSelection = false;
		mobileEditPane = 'program';
	});

	$effect(() => {
		voiceoverRecorder.reconcileProject(projectId);
		if (gate.state !== 'ready' || !projectId) return;
		void editorSession.load(projectId);
		return () => {
			editorSession.pausePlayback();
			editorSession.stopAutosaveTimers();
			void editorSession.flushAutosave().catch(() => undefined);
		};
	});

	async function handleImport(): Promise<void> {
		if (!projectId) return;
		try {
			const importedIds = await importFromPicker({
				projectId,
				storageMode: 'copy',
				onUnsupportedAudio: requestUnsupportedAudioDecision
			});
			if (importedIds.length > 0) mediaPanelView = 'project';
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		}
	}

	function requestUnsupportedAudioDecision(
		request: UnsupportedAudioImportRequest
	): Promise<'import' | 'cancel'> {
		resolveUnsupportedAudioDecision('cancel');
		unsupportedAudioRequest = request;
		return new Promise((resolve) => {
			unsupportedAudioResolve = resolve;
		});
	}

	function resolveUnsupportedAudioDecision(decision: 'import' | 'cancel'): void {
		const resolve = unsupportedAudioResolve;
		unsupportedAudioResolve = null;
		unsupportedAudioRequest = null;
		resolve?.(decision);
	}

	function handleGeneratedAudioInserted(itemId: string): void {
		selectedItemId = itemId;
		selectedItemIds = [itemId];
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_local_ai_added(), 'success');
	}

	function handleVoiceoverInserted(itemId: string): void {
		selectedItemId = itemId;
		selectedItemIds = [itemId];
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_voiceover_added(), 'success');
	}

	function handleRecordingInserted(itemId: string): void {
		selectedItemId = itemId;
		selectedItemIds = [itemId];
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
		showToast(
			m.video_editor_recording_inserted?.() ?? 'Recording added to the timeline',
			'success'
		);
	}

	function handleVectorAssetInserted(itemId: string): void {
		selectedItemId = itemId;
		selectedItemIds = [itemId];
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
	}

	function handleSourceInserted(itemIds: string[]): void {
		selectedItemIds = itemIds;
		selectedItemId = itemIds[0] ?? null;
		selectedTransitionId = null;
	}

	function handleSplit(): void {
		const result = splitAtFrame(timelineStore.currentFrame, undefined);
		emitEditorSound(result.right.length > 0 ? 'confirm' : 'error', editorSession.clock.isPlaying);
		if (result.right.length === 0) return;
		editorSession.scheduleAutosave();
	}

	async function handleFreezeFrame(itemId = selectedItemId): Promise<void> {
		if (!itemId || !projectId || freezingItemId) return;
		freezingItemId = itemId;
		try {
			const result = await insertFreezeFrame({
				projectId,
				itemId,
				playheadFrame: timelineStore.currentFrame
			});
			if (!result.ok) {
				const message =
					result.reason === 'locked-track'
						? m.video_editor_freeze_frame_locked()
						: result.reason === 'transition-overlap'
							? m.video_editor_freeze_frame_transition()
							: result.reason === 'source-changed'
								? m.video_editor_freeze_frame_changed()
								: m.video_editor_freeze_frame_select();
				showToast(message, 'info');
				return;
			}
			selectedItemId = result.itemId;
			selectedItemIds = [result.itemId];
			selectedTransitionId = null;
			editorSession.scheduleAutosave();
			showToast(m.video_editor_freeze_frame_added(), 'success');
		} catch (error) {
			showToast(
				m.video_editor_freeze_frame_failed({
					message: error instanceof Error ? error.message : String(error)
				}),
				'error'
			);
		} finally {
			freezingItemId = null;
		}
	}

	function handleDelete(ripple: boolean): void {
		if (!selectedItemId) return;
		const ids = selectedItemIds.length > 0 ? selectedItemIds : [selectedItemId];
		const removedIds = ripple
			? rippleDeleteItems(ids, timelineStore.linkedSelectionEnabled)
			: removeItems(ids, timelineStore.linkedSelectionEnabled);
		if (removedIds.length === 0) return;
		emitEditorSound('delete', editorSession.clock.isPlaying);
		selectedItemId = null;
		selectedItemIds = [];
		editorSession.scheduleAutosave();
	}

	function resetTimelineSelection(): void {
		selectedItemId = null;
		selectedItemIds = [];
		selectedTransitionId = null;
	}

	function switchEditorSequence(sequenceId: string | null): boolean {
		shuttleScrubResume.cancel();
		editorSession.pausePlayback();
		if (!switchSequence(sequenceId)) return false;
		editorSession.syncTimelineClock();
		resetTimelineSelection();
		return true;
	}

	function preferredMotionComposition(preferredId?: string): string | null {
		const compositions = sequenceStore.compositions.filter(
			(composition) => composition.editorKind === 'composite-2d'
		);
		return (
			compositions.find((composition) => composition.id === preferredId)?.id ??
			compositions.find((composition) => composition.id === lastMotionCompositionId)?.id ??
			compositions[0]?.id ??
			null
		);
	}

	function rememberActiveMotionSelection(): void {
		const active = sequenceStore.activeSequence;
		if (active?.editorKind !== 'composite-2d') return;
		motionSelectionByCompositionId = {
			...motionSelectionByCompositionId,
			[active.id]: [...selectedItemIds]
		};
	}

	function switchMotionComposition(compositionId: string): boolean {
		rememberActiveMotionSelection();
		if (!switchEditorSequence(compositionId)) return false;
		lastMotionCompositionId = compositionId;
		const restoredIds = (motionSelectionByCompositionId[compositionId] ?? []).filter((id) =>
			timelineStore.itemById.has(id)
		);
		selectedItemIds = restoredIds;
		selectedItemId = restoredIds[0] ?? null;
		return true;
	}

	function enterMotionWorkspace(preferredId?: string): void {
		const current = sequenceStore.activeSequence;
		if (!motionWorkspaceReturnCaptured && current?.editorKind !== 'composite-2d') {
			motionWorkspaceReturnSequenceId = sequenceStore.activeSequenceId;
			motionWorkspaceReturnSelectionIds = [...selectedItemIds];
			motionWorkspaceReturnCaptured = true;
		}
		editorWorkspace.set('motion');
		const targetId = preferredMotionComposition(preferredId);
		if (targetId) {
			switchMotionComposition(targetId);
		} else resetTimelineSelection();
	}

	function leaveMotionWorkspace(workspace: Exclude<EditorWorkspaceId, 'motion'>): void {
		rememberActiveMotionSelection();
		if (activeMotionComposition) lastMotionCompositionId = activeMotionComposition.id;
		if (motionWorkspaceReturnCaptured) {
			switchEditorSequence(motionWorkspaceReturnSequenceId);
			const restoredIds = motionWorkspaceReturnSelectionIds.filter((id) =>
				timelineStore.itemById.has(id)
			);
			selectedItemIds = restoredIds;
			selectedItemId = restoredIds[0] ?? null;
		}
		motionWorkspaceReturnCaptured = false;
		motionWorkspaceReturnSequenceId = null;
		motionWorkspaceReturnSelectionIds = [];
		motionReturnStack = [];
		editorWorkspace.set(workspace);
	}

	function changeEditorWorkspace(workspace: EditorWorkspaceId): void {
		if (workspace === editorWorkspace.current) return;
		if (workspace === 'motion') enterMotionWorkspace();
		else if (editorWorkspace.current === 'motion') leaveMotionWorkspace(workspace);
		else {
			shuttleScrubResume.cancel();
			editorSession.pausePlayback();
			editorWorkspace.set(workspace);
		}
		emitEditorSound('select', false);
	}

	function handleOpenSequence(compositionId: string): void {
		shuttleScrubResume.cancel();
		const composition = sequenceStore.compositionById.get(compositionId);
		if (composition?.editorKind === 'composite-2d') {
			enterMotionWorkspace(compositionId);
			return;
		}
		sequenceStore.promoteToTab(compositionId);
		motionReturnStack = [];
		editorSession.pausePlayback();
		if (!switchSequence(compositionId)) return;
		editorSession.syncTimelineClock();
		resetTimelineSelection();
	}

	function handleCreateMotionComposition(): void {
		const ids =
			selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : [];
		const parentSequenceId = sequenceStore.activeSequenceId;
		const compositionId = createCompoundClip(
			ids,
			m.video_editor_motion_composition_title(),
			'composite-2d'
		);
		if (!compositionId) return;
		motionReturnStack = [...motionReturnStack, parentSequenceId];
		editorSession.pausePlayback();
		if (!switchSequence(compositionId)) return;
		editorSession.syncTimelineClock();
		resetTimelineSelection();
		editorSession.scheduleAutosave();
		showToast(m.video_editor_compound_created(), 'success');
	}

	function handleEditMotionClip(): void {
		const selected =
			selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : [];
		if (selected.length === 1) {
			const item = timelineStore.itemById.get(selected[0]!);
			const composition = item?.compositionId
				? sequenceStore.compositionById.get(item.compositionId)
				: undefined;
			if (composition?.editorKind === 'composite-2d') {
				enterMotionWorkspace(composition.id);
				return;
			}
		}
		const sourceLabel = selectedItemId
			? timelineStore.itemById.get(selectedItemId)?.label.trim()
			: '';
		const compositionId = createCompoundClip(
			selected,
			sourceLabel ? `${sourceLabel} Motion` : m.video_editor_motion_composition_title(),
			'composite-2d'
		);
		if (!compositionId) return;
		const wrapperIds = timelineStore.items
			.filter((item) => item.compositionId === compositionId)
			.map((item) => item.id);
		selectedItemIds = wrapperIds;
		selectedItemId = wrapperIds[0] ?? null;
		enterMotionWorkspace(compositionId);
		editorSession.scheduleAutosave();
		showToast(m.video_editor_motion_composition_created(), 'success');
	}

	function handleCreateEmptyMotionComposition(options: CreateCompositeCompositionOptions): void {
		const compositionId = createCompositeComposition({
			...options,
			backgroundColor: editorSession.project?.metadata.backgroundColor
		});
		lastMotionCompositionId = compositionId;
		switchMotionComposition(compositionId);
		editorSession.scheduleAutosave();
		showToast(m.video_editor_motion_composition_created(), 'success');
	}

	function handleReturnFromMotionComposition(): void {
		shuttleScrubResume.cancel();
		const parentSequenceId = motionReturnStack.at(-1);
		if (parentSequenceId === undefined && motionReturnStack.length === 0) return;
		editorSession.pausePlayback();
		if (!switchSequence(parentSequenceId ?? null)) return;
		motionReturnStack = motionReturnStack.slice(0, -1);
		editorSession.syncTimelineClock();
		resetTimelineSelection();
	}

	function handleSelectItem(itemId: string | null): void {
		selectedItemId = itemId;
		selectedItemIds = itemId ? [itemId] : [];
		selectedTransitionId = null;
	}

	$effect(() => {
		const workspace = activeWorkspace;
		const compositions = sequenceStore.compositions;
		const active = sequenceStore.activeSequence;
		if (workspace !== 'motion') return;
		if (active?.editorKind === 'composite-2d') {
			lastMotionCompositionId = active.id;
			return;
		}
		if (!motionWorkspaceReturnCaptured) {
			motionWorkspaceReturnSequenceId = sequenceStore.activeSequenceId;
			motionWorkspaceReturnCaptured = true;
		}
		const targetId =
			compositions.find(
				(composition) =>
					composition.editorKind === 'composite-2d' && composition.id === lastMotionCompositionId
			)?.id ?? compositions.find((composition) => composition.editorKind === 'composite-2d')?.id;
		if (targetId) {
			switchMotionComposition(targetId);
		}
	});

	$effect(() => {
		const workspace = activeWorkspace;
		const frame = timelineStore.currentFrame;
		const items = timelineStore.items;
		const tracks = timelineStore.tracks;
		const selection =
			selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : [];
		if (
			workspace !== 'color' ||
			colorSelectionSpansFrame(selection, timelineStore.itemById, frame)
		) {
			return;
		}
		const target = colorGradeTargetAtFrame(items, tracks, frame);
		if (target) handleSelectItem(target.id);
	});

	function createCompoundForItems(ids: string[]): void {
		const compositionId = createCompoundClip(ids, m.video_editor_compound_default());
		if (!compositionId) return;
		selectedItemIds = timelineStore.items
			.filter((item) => item.compositionId === compositionId)
			.map((item) => item.id);
		selectedItemId = selectedItemIds[0] ?? null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_compound_created(), 'success');
	}

	function handleCreateCompound(): void {
		createCompoundForItems(
			selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : []
		);
	}

	function dissolveCompoundItem(itemId: string): void {
		const restoredIds = dissolveCompoundClip(itemId);
		if (restoredIds.length === 0) return;
		selectedItemIds = restoredIds;
		selectedItemId = restoredIds[0] ?? null;
		editorSession.scheduleAutosave();
	}

	function handleDissolveCompound(): void {
		if (selectedItemId) dissolveCompoundItem(selectedItemId);
	}

	function activeRenderProject() {
		if (!editorSession.project) return null;
		const activeSequence = sequenceStore.activeSequence;
		return {
			...editorSession.project,
			name: activeSequence?.name ?? editorSession.project.name,
			metadata: activeSequence
				? {
						width: activeSequence.width,
						height: activeSequence.height,
						fps: activeSequence.fps,
						backgroundColor: activeSequence.backgroundColor ?? '#000000'
					}
				: editorSession.project.metadata,
			timeline: {
				tracks: $state.snapshot(timelineStore.tracks),
				items: $state.snapshot(timelineStore.items),
				transitions: $state.snapshot(transitionsStore.list),
				markers: $state.snapshot(timelineStore.markers),
				inPoint: timelineStore.inPoint ?? undefined,
				outPoint: timelineStore.outPoint ?? undefined,
				compositions: $state.snapshot(sequenceStore.compositions),
				topLevelSequenceIds: [...sequenceStore.topLevelSequenceIds]
			}
		};
	}

	let exporting = $state(false);
	let sending = $state(false);
	let sentExport = $state<{ composerHref: string } | null>(null);

	function composerMediaHref(workspaceId: string, mediaId: string): string {
		const query = new URLSearchParams({ workspace_id: workspaceId, media_id: mediaId });
		const returnPublicationId = page.url.searchParams.get('return')?.trim();
		const path = returnPublicationId
			? `/publications/${encodeURIComponent(returnPublicationId)}`
			: '/';
		return resolveAppPath(`${path}?${query}`);
	}
	async function handleExport(): Promise<void> {
		if (!editorSession.project) return;
		exporting = true;
		try {
			editorSession.pausePlayback();
			await editorSession.saveNow();
			const project = activeRenderProject();
			if (!project) return;
			const result = await renderVideoExport(project, {
				format: 'mp4',
				codec: 'avc',
				width: project.metadata.width,
				height: project.metadata.height,
				subtitleMode: 'burn'
			});
			showToast(m.video_editor_export_done({ name: result.fileName }), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			exporting = false;
		}
	}

	const renderProject = $derived(activeRenderProject());

	async function handleSendToOpenPost(): Promise<void> {
		const workspaceId = workspaceCtx.currentWorkspace?.id;
		if (!workspaceId || !editorSession.project) return;
		sending = true;
		sentExport = null;
		try {
			editorSession.pausePlayback();
			await editorSession.saveNow();
			const project = activeRenderProject();
			if (!project) return;
			const result = await renderVideoExport(project, {
				format: 'mp4',
				codec: 'avc',
				width: project.metadata.width,
				height: project.metadata.height,
				subtitleMode: 'burn'
			});
			const uploaded = await sendToOpenPost({
				workspaceId,
				blob: result.blob,
				fileName: result.fileName
			});
			sentExport = {
				composerHref: composerMediaHref(workspaceId, uploaded.mediaId)
			};
			showToast(m.video_editor_sent(), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			sending = false;
		}
	}

	function handleAddText(): void {
		const id = addTextItem(m.video_editor_text_default_label());
		selectedItemId = id;
		editorSession.scheduleAutosave();
	}

	function handleAddAdjustmentLayer(): void {
		const id = addAdjustmentLayer(m.video_editor_adjustment_layer());
		selectedItemId = id;
		editorSession.scheduleAutosave();
	}

	async function handleTranscribeItem(
		itemId: string,
		selection: TranscriptionSelection
	): Promise<void> {
		const item = timelineStore.itemById.get(itemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return;
		if (media.audioCodecSupported === false) {
			showToast(m.video_editor_unsupported_audio_title(), 'error');
			return;
		}
		try {
			await transcriptionService.enqueue(itemId, selection);
			editorSession.scheduleAutosave();
			showToast(m.video_editor_transcribe_done(), 'success');
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				showToast(err instanceof Error ? err.message : String(err), 'error');
			}
		}
	}

	async function handleTranscribe(selection: TranscriptionSelection): Promise<void> {
		if (selectedItemId) await handleTranscribeItem(selectedItemId, selection);
	}

	function handleDefaultCaptions(itemId: string): void {
		void handleTranscribeItem(itemId, {
			model: editorSettings.defaultTranscriptionModel,
			language: editorSettings.defaultTranscriptionLanguage || undefined,
			quantization: editorSettings.defaultTranscriptionQuantization
		});
	}

	function cancelTranscription(): void {
		if (selectedItemId) transcriptionService.cancelForItem(selectedItemId);
	}

	async function handleAiCaptions(itemId: string | null = selectedItemId): Promise<void> {
		if (!itemId) return;
		aiCaptionError = null;
		try {
			await aiCaptionService.enqueue(itemId);
			editorSession.scheduleAutosave();
			showToast(m.video_editor_ai_captions_done(), 'success');
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			const message = err instanceof Error ? err.message : String(err);
			aiCaptionError = message;
			showToast(message, 'error');
		}
	}

	function cancelAiCaptions(): void {
		if (selectedItemId) aiCaptionService.cancelForItem(selectedItemId);
	}

	function openEmbeddedSubtitlePicker(media: NonNullable<ReturnType<typeof mediaPool.get>>): void {
		embeddedSubtitleMedia = media;
		embeddedSubtitlePickerOpen = true;
	}

	function openEmbeddedSubtitlesForItem(itemId: string): void {
		const item = timelineStore.itemById.get(itemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (
			!item ||
			!media ||
			item.isReversed === true ||
			isTrackEffectivelyLocked(item.trackId, timelineStore.tracks) ||
			!canExtractEmbeddedSubtitles(media)
		) {
			return;
		}
		openEmbeddedSubtitlePicker(media);
	}

	function handleEmbeddedSubtitleInsert(result: EmbeddedSubtitleInsertResult): void {
		if (result.itemIds.length === 0) {
			showToast(m.video_editor_subtitle_outside_clips(), 'error');
			return;
		}
		editorSession.scheduleAutosave();
		showToast(m.video_editor_subtitle_inserted({ count: result.cueCount }), 'success');
	}

	async function handleImportCaptions(): Promise<void> {
		const handles = await window.showOpenFilePicker?.({
			types: [
				{
					description: m.video_editor_export_subtitles(),
					accept: { 'text/plain': ['.srt', '.vtt'] }
				}
			],
			multiple: false
		});
		if (!handles?.[0]) return;
		try {
			const file = await handles[0].getFile();
			addSubtitleItemFromSrt(await file.text());
			editorSession.scheduleAutosave();
		} catch (err) {
			if (err instanceof Error && err.name !== 'AbortError') {
				showToast(err.message, 'error');
			}
		}
	}

	function applySpeed(multiplier: number): void {
		if (!selectedItemId) return;
		const item = timelineStore.itemById.get(selectedItemId);
		if (!item || item.type === 'text' || item.type === 'subtitle') return;
		setItemSpeed(item.id, Math.round((item.speed ?? 1) * multiplier * 100) / 100);
		editorSession.scheduleAutosave();
	}

	function handleReverseItems(itemIds: string[], isReversed: boolean): void {
		const updatedIds = setItemsReversed(itemIds, isReversed);
		if (updatedIds.length === 0) return;
		editorSession.scheduleAutosave();
		if (!isReversed) return;
		const mediaIds = new Set<string>();
		for (const id of updatedIds) {
			const item = timelineStore.itemById.get(id);
			if (item?.type === 'video' && item.mediaId) mediaIds.add(item.mediaId);
		}
		for (const mediaId of mediaIds) {
			const media = mediaPool.get(mediaId);
			if (media) void conformReversePreview(media).catch(() => undefined);
		}
	}

	function handleCopyColorGrade(itemId: string): void {
		const result = copyColorGradeFromItem(itemId);
		if (result) {
			showToast(m.video_editor_color_grade_copied({ count: result.effectCount }), 'success');
		}
	}

	function handlePasteColorGrade(itemIds: string[]): void {
		const result = pasteColorGradeToItems(itemIds);
		if (!result) return;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_color_grade_pasted({ count: result.effectCount }), 'success');
	}

	const selectedSupportsEffects = $derived(
		selectedItemId !== null && timelineStore.itemById.get(selectedItemId)?.type !== 'audio'
	);
	const selectedSupportsMotion = $derived(
		selectedItemId !== null &&
			['video', 'image', 'lottie', 'text', 'subtitle', 'shape', 'composition'].includes(
				timelineStore.itemById.get(selectedItemId)?.type ?? ''
			)
	);
	const selectedIsMedia = $derived(
		selectedItemId !== null &&
			['video', 'audio'].includes(timelineStore.itemById.get(selectedItemId)?.type ?? '')
	);

	const selectedIsVideo = $derived(
		selectedItemId !== null && timelineStore.itemById.get(selectedItemId)?.type === 'video'
	);
	const selectedTrackLocked = $derived.by(() => {
		if (!selectedItemId) return false;
		const item = timelineStore.itemById.get(selectedItemId);
		return item ? isTrackEffectivelyLocked(item.trackId, timelineStore.tracks) : false;
	});
	const selectedIsText = $derived(
		selectedItemId !== null && timelineStore.itemById.get(selectedItemId)?.type === 'text'
	);
	const selectedIsCompound = $derived(
		selectedItemId !== null && Boolean(timelineStore.itemById.get(selectedItemId)?.compositionId)
	);
	const selectedTransition = $derived(
		selectedTransitionId
			? transitionsStore.list.find((transition) => transition.id === selectedTransitionId)
			: undefined
	);
	let editInspectorTab = $state<EditInspectorTab>('properties');
	const editInspectorTabs = $derived(
		resolveEditInspectorTabs({
			hasSelection: selectedItemId !== null,
			supportsMotion: selectedSupportsMotion,
			supportsEffects: selectedSupportsEffects,
			isMedia: selectedIsMedia
		})
	);

	$effect(() => {
		if (editInspectorTabs.includes(editInspectorTab)) return;
		editInspectorTab = editInspectorTabs[0] ?? 'properties';
	});

	function handleAddCrossfade(): void {
		if (!selectedItemId) return;
		const item = timelineStore.itemById.get(selectedItemId);
		if (!item) return;
		const neighbors = (timelineStore.itemsByTrackId.get(item.trackId) ?? [])
			.filter((other) => other.from >= item.from + item.durationInFrames - 1)
			.sort((a, b) => a.from - b.from);
		const next = neighbors[0];
		if (!next) {
			showToast(m.video_editor_no_neighbor(), 'error');
			return;
		}
		try {
			selectedTransitionId = addTransition(item.id, next.id, 'crossfade');
			selectedItemId = null;
			selectedItemIds = [];
			editorSession.scheduleAutosave();
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		}
	}

	function handleApplyTransition(presentation: string, direction?: TransitionDirection): void {
		if (selectedTransition) {
			const transitionItems = [
				timelineStore.itemById.get(selectedTransition.fromItemId),
				timelineStore.itemById.get(selectedTransition.toItemId)
			];
			if (
				transitionItems.some(
					(item) => item && isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)
				)
			) {
				showToast(m.video_editor_agent_error_locked_tracks(), 'error');
				return;
			}
			if (updateTransitionPresentation(selectedTransition.id, presentation, direction)) {
				editorSession.scheduleAutosave();
			} else {
				showToast(m.video_editor_agent_error_transition_failed(), 'error');
			}
			return;
		}
		if (selectedItemIds.length > 1 || !selectedItemId) {
			showToast(m.video_editor_select_clip(), 'info');
			return;
		}
		const target = resolveTransitionTargetFromSelection({
			selectedItemId,
			items: timelineStore.items,
			tracks: effectiveMediaTracks(timelineStore.tracks),
			transitions: transitionsStore.list,
			fps: timelineStore.fps,
			presentation
		});
		if (!target) {
			showToast(m.video_editor_no_neighbor(), 'info');
			return;
		}
		try {
			let id = target.existingTransitionId;
			if (id) {
				if (!updateTransitionPresentation(id, presentation, direction)) {
					showToast(m.video_editor_agent_error_transition_failed(), 'error');
					return;
				}
			} else {
				id = addTransition(
					target.fromItemId,
					target.toItemId,
					'crossfade',
					target.suggestedDurationInFrames,
					{ presentation, direction }
				);
			}
			selectedTransitionId = id ?? null;
			selectedItemId = null;
			selectedItemIds = [];
			editorSession.scheduleAutosave();
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}

	function handleRemoveTransition(): void {
		if (!selectedTransition) return;
		removeTransition(selectedTransition.id);
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_transition_removed(), 'info');
	}

	let speechCleanupOpen = $state(false);
	let speechCleanupMode = $state<'fillers' | 'silence'>('fillers');
	let speechCleanupTargetIds = $state<string[] | null>(null);
	const speechCleanupItemIds = $derived.by(() => {
		if (speechCleanupTargetIds && speechCleanupTargetIds.length > 0) {
			const valid = speechCleanupTargetIds.filter((id) => {
				const item = timelineStore.itemById.get(id);
				return item?.type === 'video' || item?.type === 'audio';
			});
			if (valid.length > 0) return valid;
		}
		const selected =
			selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : [];
		const selectedMedia = selected.filter((id) => {
			const item = timelineStore.itemById.get(id);
			return item?.type === 'video' || item?.type === 'audio';
		});
		return selectedMedia.length > 0
			? selectedMedia
			: timelineStore.items
					.filter((item) => item.type === 'video' || item.type === 'audio')
					.map((item) => item.id);
	});

	function openSpeechCleanup(mode: 'fillers' | 'silence'): void {
		editorSession.pausePlayback();
		speechCleanupTargetIds = null;
		speechCleanupMode = mode;
		speechCleanupOpen = true;
	}

	function openAgentSpeechCleanup(mode: 'fillers' | 'silence', itemIds: string[]): void {
		editorSession.pausePlayback();
		speechCleanupMode = mode;
		speechCleanupTargetIds = [...itemIds];
		speechCleanupOpen = true;
	}

	$effect(() => {
		if (!speechCleanupOpen) speechCleanupTargetIds = null;
	});

	function handleSpeechCleanupApplied(removedCount: number): void {
		editorSession.scheduleAutosave();
		showToast(
			removedCount === 1
				? m.video_editor_cleanup_done_one()
				: m.video_editor_cleanup_done_many({ count: removedCount }),
			'success'
		);
	}

	let scanningScenes = $state(false);
	let sceneScanController: AbortController | null = null;
	async function handleAutoSplitScenes(
		itemId: string | null = selectedItemId,
		mode: SceneScanMode = 'fast'
	): Promise<void> {
		if (!itemId) return;
		const item = timelineStore.itemById.get(itemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media || isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)) return;
		sceneScanController?.abort();
		const controller = new AbortController();
		sceneScanController = controller;
		scanningScenes = true;
		try {
			editorSession.pausePlayback();
			const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : media.fps;
			const cutFrames = await scanSceneCuts(media, {
				sourceFps,
				mode,
				signal: controller.signal
			});
			const frames = cutFramesForItem({
				cutSourceFrames: cutFrames,
				sourceFps,
				sourceStart: item.sourceStart,
				speed: item.speed,
				from: item.from,
				timelineFps: timelineStore.fps
			}).filter((frame) => frame > item.from && frame < item.from + item.durationInFrames);
			if (frames.length === 0) {
				showToast(m.video_editor_scene_none(), 'info');
				return;
			}
			splitAtScenes(item.id, frames);
			editorSession.scheduleAutosave();
			showToast(m.video_editor_scene_done({ count: frames.length }), 'success');
		} catch (err) {
			if (controller.signal.aborted) return;
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			if (sceneScanController === controller) {
				sceneScanController = null;
				scanningScenes = false;
			}
		}
	}

	$effect(() => () => sceneScanController?.abort());

	function togglePlay(): void {
		if (editorSession.clock.isPlaying) {
			editorSession.pausePlayback();
		} else {
			editorSession.startPlayback({
				start: 0,
				end: Math.max(timelineStore.maxItemEndFrame, 1),
				loop: false
			});
		}
	}

	function copyTimelineSelection(cut: boolean): boolean {
		if (handleTranscriptClipboardCopy(cut)) return true;
		const selectedIds =
			selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : [];
		const itemIds = timelineStore.linkedSelectionEnabled
			? expandSelectionWithLinkedItems(timelineStore.items, selectedIds)
			: selectedIds;
		const items = timelineStore.items.filter((item) => itemIds.includes(item.id));
		if (items.length === 0) return false;
		let copiedItems = items.map((item) => snapshotTimelineState(item));
		if (cut) {
			const removed = removeItems(itemIds, false);
			if (removed.length === 0) return false;
			const removedIds = new Set(removed);
			copiedItems = items.filter((item) => removedIds.has(item.id));
			selectedItemId = null;
			selectedItemIds = [];
			editorSession.scheduleAutosave();
		}
		itemClipboardStore.copy(copiedItems, cut ? 'cut' : 'copy');
		showToast(
			cut
				? m.video_editor_clipboard_cut_items({ count: copiedItems.length })
				: m.video_editor_clipboard_copied_items({ count: copiedItems.length }),
			'success'
		);
		return true;
	}

	function pasteTimelineClipboard(
		frame = timelineStore.currentFrame,
		preferredTrackId?: string | null
	): boolean {
		setCurrentFrame(frame);
		const activeTrackId =
			preferredTrackId ??
			(selectedItemId ? (timelineStore.itemById.get(selectedItemId)?.trackId ?? null) : null);
		const pastedIds = pasteTimelineItemClipboard(activeTrackId);
		if (pastedIds.length === 0) return false;
		selectedItemIds = pastedIds;
		selectedItemId = pastedIds.at(-1) ?? null;
		selectedTransitionId = null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_clipboard_pasted_items({ count: pastedIds.length }), 'success');
		return true;
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.repeat || event.defaultPrevented) return;
		const bindings = keyboardShortcuts.bindings;
		const matches = (...ids: EditorShortcutId[]) =>
			ids.some((id) => eventMatchesShortcut(event, bindings[id]));
		if (editorShortcutTargetIsDisabled(event.target)) return;
		const sourceLocalPlayback = matches(
			'PLAY_PAUSE',
			'PREVIOUS_FRAME',
			'NEXT_FRAME',
			'GO_TO_START',
			'GO_TO_END',
			'SHUTTLE_FORWARD',
			'SHUTTLE_REVERSE',
			'SHUTTLE_PAUSE'
		);
		if (sourceLocalPlayback && sourceHoverStore.isActive) return;
		if (matches('SHUTTLE_PAUSE', 'SHUTTLE_FORWARD', 'SHUTTLE_REVERSE')) {
			if (matches('SHUTTLE_PAUSE')) {
				if (!editorSession.clock.isPlaying) return;
				event.preventDefault();
				event.stopPropagation();
				shuttleScrubResume.cancel();
				editorSession.pausePlayback();
				return;
			}
			if (matches('SHUTTLE_FORWARD')) {
				event.preventDefault();
				editorSession.shuttlePlayback(1, {
					start: 0,
					end: Math.max(timelineStore.maxItemEndFrame, 1)
				});
				return;
			}
			if (matches('SHUTTLE_REVERSE')) {
				event.preventDefault();
				editorSession.shuttlePlayback(-1, {
					start: 0,
					end: Math.max(timelineStore.maxItemEndFrame, 1)
				});
				return;
			}
		}
		if (matches('SAVE')) {
			event.preventDefault();
			void editorSession.saveNow().catch(() => showToast(m.video_editor_save_failed(), 'error'));
		} else if (matches('EXPORT')) {
			event.preventDefault();
			if (!exporting && timelineStore.items.length > 0) void handleExport();
		} else if (matches('OPEN_SETTINGS')) {
			event.preventDefault();
			settingsOpen = true;
		} else if (matches('WORKSPACE_EDIT', 'WORKSPACE_COLOR', 'WORKSPACE_MOTION')) {
			event.preventDefault();
			changeEditorWorkspace(
				matches('WORKSPACE_EDIT') ? 'edit' : matches('WORKSPACE_COLOR') ? 'color' : 'motion'
			);
		} else if (matches('COPY', 'CUT')) {
			if (copyTimelineSelection(matches('CUT'))) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		} else if (matches('PASTE')) {
			if (pasteTimelineClipboard()) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		} else if (matches('UNDO')) {
			event.preventDefault();
			if (commandHistory.canUndo) {
				commandHistory.undo();
				editorSession.scheduleAutosave();
			}
		} else if (matches('REDO')) {
			event.preventDefault();
			if (commandHistory.canRedo) {
				commandHistory.redo();
				editorSession.scheduleAutosave();
			}
		} else if (matches('PREVIOUS_FRAME', 'NEXT_FRAME', 'GO_TO_START', 'GO_TO_END')) {
			event.preventDefault();
			const frame = matches('GO_TO_START')
				? 0
				: matches('GO_TO_END')
					? timelineStore.maxItemEndFrame
					: timelineStore.currentFrame + (matches('PREVIOUS_FRAME') ? -1 : 1);
			setCurrentFrame(frame);
		} else if (matches('TOGGLE_LINKED_SELECTION')) {
			event.preventDefault();
			const enabled = !timelineStore.linkedSelectionEnabled;
			timelineStore._setLinkedSelectionEnabled(enabled);
			emitEditorSound(enabled ? 'toggleOn' : 'toggleOff', editorSession.clock.isPlaying);
		} else if (matches('TOGGLE_SNAP')) {
			event.preventDefault();
			const enabled = !timelineStore.snapEnabled;
			timelineStore._setSnapEnabled(enabled);
			emitEditorSound(enabled ? 'toggleOn' : 'toggleOff', editorSession.clock.isPlaying);
		} else if (matches('TOGGLE_CANVAS_SNAP')) {
			event.preventDefault();
			const enabled = !editorSettings.canvasSnapEnabled;
			editorSettings.set('canvasSnapEnabled', enabled);
			emitEditorSound(enabled ? 'toggleOn' : 'toggleOff', editorSession.clock.isPlaying);
		} else if (
			matches('DELETE_SELECTED', 'DELETE_SELECTED_ALT', 'RIPPLE_DELETE', 'RIPPLE_DELETE_ALT')
		) {
			const deleteMode = editorDeleteModeForEvent(event, bindings);
			if (deleteMode === 'ripple' && selectedItemId) {
				event.preventDefault();
				handleDelete(true);
			} else if (deleteMode === 'lift' && selectedTransitionId) {
				event.preventDefault();
				removeTransition(selectedTransitionId);
				selectedTransitionId = null;
				editorSession.scheduleAutosave();
			} else if (deleteMode === 'lift' && timelineStore.selectedMarkerId) {
				event.preventDefault();
				removeMarker(timelineStore.selectedMarkerId);
				editorSession.scheduleAutosave();
			} else if (deleteMode === 'lift' && selectedItemId) {
				event.preventDefault();
				handleDelete(false);
			}
		} else if (matches('SPLIT_AT_PLAYHEAD', 'SPLIT_AT_PLAYHEAD_ALT')) {
			event.preventDefault();
			handleSplit();
		} else if (matches('FREEZE_FRAME')) {
			event.preventDefault();
			void handleFreezeFrame();
		} else if (matches('REMOVE_MARKER')) {
			event.preventDefault();
			if (timelineStore.selectedMarkerId) {
				removeMarker(timelineStore.selectedMarkerId);
				editorSession.scheduleAutosave();
			}
		} else if (matches('ADD_MARKER')) {
			event.preventDefault();
			toggleMarkerAtPlayhead();
			editorSession.scheduleAutosave();
		} else if (matches('PREVIOUS_MARKER', 'NEXT_MARKER')) {
			const marker = matches('PREVIOUS_MARKER')
				? markerBefore(timelineStore.markers, timelineStore.currentFrame)
				: markerAfter(timelineStore.markers, timelineStore.currentFrame);
			if (marker) {
				event.preventDefault();
				timelineStore._setSelectedMarkerId(marker.id);
				setCurrentFrame(marker.frame);
			}
		}
	}

	function onGlobalShortcutCapture(event: KeyboardEvent): void {
		if (
			!sourceHoverStore.isActive &&
			handleGlobalPlayPauseShortcut(event, keyboardShortcuts.bindings.PLAY_PAUSE, togglePlay)
		) {
			return;
		}
		handleOpenSceneBrowserShortcut(event, keyboardShortcuts.bindings.OPEN_SCENE_BROWSER, () => {
			leftPanel = 'media';
			mediaPanelView = 'scenes';
			requestAnimationFrame(() =>
				document.querySelector<HTMLInputElement>('[data-scene-browser-search]')?.focus()
			);
		});
	}
</script>

<svelte:head>
	<title>{editorSession.project?.name ?? m.video_editor_title()}</title>
</svelte:head>

<svelte:window
	onkeydowncapture={onGlobalShortcutCapture}
	onkeydown={onKeydown}
	onresize={constrainEditorPanels}
/>

<div
	class="video-editor-theme flex h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]"
>
	<header
		class="grid h-12 shrink-0 grid-cols-[auto_1fr_auto] items-center border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.135_0.008_55)] px-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-3"
	>
		<div class="flex min-w-0 items-center gap-2">
			<a
				href="/video-editor"
				class="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
			>
				<Logo class="h-5 w-auto" />
				<span class="hidden text-sm font-semibold lg:inline">{m.video_editor_title()}</span>
			</a>
			<span class="hidden min-w-0 truncate text-sm font-medium md:block">
				{editorSession.project?.name}
			</span>
		</div>
		<EditorWorkspaceSwitcher value={activeWorkspace} onchange={changeEditorWorkspace} />
		<div class="flex min-w-0 items-center justify-end gap-1 text-xs text-[oklch(0.65_0.015_55)]">
			{#if editorSession.saving}
				<span class="hidden sm:inline">{m.video_editor_saving()}</span>
			{:else if editorSession.saveError}
				<span class="hidden text-red-300 sm:inline" title={editorSession.saveError}>
					{m.video_editor_save_failed()}
				</span>
			{:else if !timelineStore.isDirty}
				<span class="hidden sm:inline">{m.video_editor_saved()}</span>
			{/if}
			<Button
				type="button"
				variant="outline"
				size="icon-sm"
				class="hidden 2xl:inline-flex 2xl:w-auto 2xl:px-2.5"
				aria-label={m.video_editor_record_screen()}
				title={m.video_editor_record_screen()}
				onclick={() => (recordingOpen = true)}
			>
				<VideoIcon class="size-3.5" aria-hidden="true" />
				<span class="hidden lg:inline">{m.video_editor_record()}</span>
			</Button>
			<div class="hidden 2xl:block"><PreviewDiagnosticsPanel /></div>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				class="hidden 2xl:inline-flex"
				aria-label={m.video_editor_settings_title()}
				title={m.video_editor_settings_title()}
				onclick={() => (settingsOpen = true)}
			>
				<SettingsIcon class="size-3.5" aria-hidden="true" />
			</Button>
			{#if renderProject}
				{#key renderProject.id}
					<RenderQueueController
						projectId={renderProject.id}
						onerror={(error) => showToast(error.message, 'error')}
					/>
				{/key}
			{/if}
			<ExportDialog
				project={renderProject}
				disabled={timelineStore.items.length === 0}
				triggerLabel={m.video_editor_export_title()}
				responsiveTrigger
				compactQueueTrigger
				triggerVariant="default"
				triggerClass="size-11 px-0 sm:h-8 sm:w-auto sm:min-w-0 sm:px-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
				ondone={(result) =>
					showToast(m.video_editor_export_done({ name: result.fileName }), 'success')}
				onerror={(error) => showToast(error.message, 'error')}
			/>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={m.image_editor_more_actions()}
						>
							<MoreHorizontalIcon aria-hidden="true" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="video-editor-theme w-52" align="end">
					<DropdownMenu.Item class="2xl:hidden" onclick={() => (recordingOpen = true)}>
						{m.video_editor_record_screen()}
					</DropdownMenu.Item>
					<DropdownMenu.Item class="2xl:hidden" onclick={() => (settingsOpen = true)}>
						{m.video_editor_settings_title()}
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="2xl:hidden" />
					<DropdownMenu.Item
						disabled={exporting || timelineStore.items.length === 0}
						onclick={() => void handleExport()}
					>
						{m.video_editor_export()}
					</DropdownMenu.Item>
					<DropdownMenu.Item
						disabled={sending || timelineStore.items.length === 0 || !workspaceCtx.currentWorkspace}
						onclick={() => void handleSendToOpenPost()}
					>
						{m.video_editor_send_to_openpost()}
					</DropdownMenu.Item>
					{#if sentExport}
						<DropdownMenu.Separator />
						<DropdownMenu.Item onclick={() => void goto(sentExport.composerHref)}>
							{m.video_editor_open_composer()}
						</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</header>

	{#if gate.state !== 'ready'}
		<main class="flex flex-1 flex-col items-center justify-center px-4 py-10">
			<WorkspaceGatePanel {gate} />
		</main>
	{:else if editorSession.loading}
		<main class="flex flex-1 items-center justify-center">
			<LoaderIcon class="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
			<span class="sr-only">{m.editors_loading()}</span>
		</main>
	{:else if editorSession.loadError}
		<main class="flex flex-1 flex-col items-center justify-center gap-3">
			<p class="text-sm text-[oklch(0.65_0.015_55)]">
				{editorSession.loadError}
			</p>
			<Button variant="outline" href="/video-editor">{m.video_editor_go_back()}</Button>
		</main>
	{:else}
		{#key projectId}
			{#if activeWorkspace === 'edit'}
				<nav
					class="grid shrink-0 grid-cols-3 border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_50)] p-1 lg:hidden"
					aria-label={m.video_editor_mobile_panels()}
				>
					<button
						type="button"
						class:active={mobileEditPane === 'assets'}
						class="min-h-11 rounded px-2 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
						aria-controls="video-editor-assets-panel"
						aria-pressed={mobileEditPane === 'assets'}
						onclick={() => (mobileEditPane = 'assets')}
					>
						{m.video_editor_assets()}
					</button>
					<button
						type="button"
						class:active={mobileEditPane === 'program'}
						class="min-h-11 rounded px-2 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
						aria-controls="video-editor-program-panel"
						aria-pressed={mobileEditPane === 'program'}
						onclick={() => (mobileEditPane = 'program')}
					>
						{m.video_editor_program_monitor()}
					</button>
					<button
						type="button"
						class:active={mobileEditPane === 'tools'}
						class="min-h-11 rounded px-2 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
						aria-controls="video-editor-tools-panel"
						aria-pressed={mobileEditPane === 'tools'}
						onclick={() => (mobileEditPane = 'tools')}
					>
						{m.video_editor_tools()}
					</button>
				</nav>
			{/if}

			<div
				class="flex min-h-0 flex-1 flex-col {activeWorkspace === 'edit'
					? 'lg:grid lg:grid-cols-[var(--asset-browser-width)_minmax(0,1fr)_var(--inspector-panel-width)] lg:grid-rows-[minmax(0,1fr)_var(--timeline-height)]'
					: ''}"
				style:--asset-browser-width={`${effectiveAssetBrowserWidth}px`}
				style:--inspector-panel-width={`${effectiveInspectorPanelWidth}px`}
				style:--timeline-height={`${effectiveTimelineHeight}px`}
			>
				<div
					class="flex min-h-0 flex-1 {activeWorkspace === 'motion' || activeWorkspace === 'edit'
						? activeWorkspace === 'edit'
							? 'flex-col lg:contents'
							: 'flex-col lg:flex-row'
						: 'flex-row'}"
				>
					{#if activeWorkspace === 'edit'}
						<aside
							id="video-editor-assets-panel"
							class="relative h-[min(44%,22rem)] min-h-24 w-full flex-none flex-col border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.15_0.008_55)] lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:h-auto lg:min-h-0 lg:w-auto lg:border-r lg:border-b-0 {mobileEditPane ===
							'assets'
								? 'flex'
								: 'hidden'}"
							aria-label={m.video_editor_assets()}
						>
							<div class="flex min-h-0 flex-1">
								<nav
									class="hidden w-11 shrink-0 flex-col border-r border-[oklch(0.25_0.015_55)] bg-[oklch(0.135_0.008_50)] lg:flex"
									aria-label={m.video_editor_assets()}
								>
									<div
										class="flex min-h-0 flex-1 flex-col"
										aria-label={m.video_editor_assets()}
										aria-orientation="vertical"
										role="tablist"
									>
										<div
											class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-2"
										>
											{#each primaryLeftPanelOptions as option (option.value)}
												{@const Icon = option.icon}
												<Tooltip.Root>
													<Tooltip.Trigger>
														{#snippet child({ props })}
															<Button
																{...props}
																variant={leftPanel === option.value ? 'secondary' : 'ghost'}
																size="icon-sm"
																class="shrink-0 text-[oklch(0.72_0.015_55)] data-[active=true]:text-white"
																data-active={leftPanel === option.value}
																data-left-panel-tab={option.value}
																data-tab-orientation="vertical"
																role="tab"
																tabindex={leftPanel === option.value ? 0 : -1}
																aria-controls="video-editor-left-tool-panel"
																aria-label={option.label}
																aria-selected={leftPanel === option.value}
																onclick={() => (leftPanel = option.value)}
																onkeydown={(event) =>
																	moveLeftPanelFocus(event, option.value, 'vertical')}
															>
																<Icon aria-hidden="true" />
															</Button>
														{/snippet}
													</Tooltip.Trigger>
													<Tooltip.Content side="right">{option.label}</Tooltip.Content>
												</Tooltip.Root>
											{/each}
										</div>
										<div
											class="flex shrink-0 flex-col items-center gap-1 border-t border-[oklch(0.25_0.015_55)] py-2"
										>
											{#each utilityLeftPanelOptions as option (option.value)}
												{@const Icon = option.icon}
												<Tooltip.Root>
													<Tooltip.Trigger>
														{#snippet child({ props })}
															<Button
																{...props}
																variant={leftPanel === option.value ? 'secondary' : 'ghost'}
																size="icon-sm"
																class="text-[oklch(0.72_0.015_55)] data-[active=true]:text-white"
																data-active={leftPanel === option.value}
																data-left-panel-tab={option.value}
																data-tab-orientation="vertical"
																role="tab"
																tabindex={leftPanel === option.value ? 0 : -1}
																aria-controls="video-editor-left-tool-panel"
																aria-label={option.label}
																aria-selected={leftPanel === option.value}
																onclick={() => (leftPanel = option.value)}
																onkeydown={(event) =>
																	moveLeftPanelFocus(event, option.value, 'vertical')}
															>
																<Icon aria-hidden="true" />
															</Button>
														{/snippet}
													</Tooltip.Trigger>
													<Tooltip.Content side="right">{option.label}</Tooltip.Content>
												</Tooltip.Root>
											{/each}
										</div>
									</div>
									<div
										class="flex shrink-0 flex-col items-center border-t border-[oklch(0.25_0.015_55)] py-2"
									>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												{#snippet child({ props })}
													<Button
														{...props}
														size="icon-sm"
														variant="ghost"
														aria-label={m.image_editor_add_layer()}
														title={m.image_editor_add_layer()}
													>
														<PlusIcon aria-hidden="true" />
													</Button>
												{/snippet}
											</DropdownMenu.Trigger>
											<DropdownMenu.Content
												class="video-editor-theme w-52"
												side="right"
												align="end"
											>
												<DropdownMenu.Item onclick={handleAddText}>
													{m.video_editor_add_text()}
												</DropdownMenu.Item>
												<DropdownMenu.Item onclick={handleAddAdjustmentLayer}>
													{m.video_editor_add_adjustment_layer()}
												</DropdownMenu.Item>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									</div>
								</nav>
								<div class="flex min-w-0 flex-1 flex-col">
									<div
										class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[oklch(0.25_0.015_55)] px-2"
									>
										<h2 class="min-w-0 truncate text-sm font-medium text-white/90">
											{leftPanelHeading}
										</h2>
										<div class="lg:hidden">
											<DropdownMenu.Root>
												<DropdownMenu.Trigger>
													{#snippet child({ props })}
														<Button
															{...props}
															size="icon-sm"
															variant="ghost"
															aria-label={m.image_editor_add_layer()}
														>
															<PlusIcon aria-hidden="true" />
														</Button>
													{/snippet}
												</DropdownMenu.Trigger>
												<DropdownMenu.Content class="video-editor-theme w-52" align="end">
													<DropdownMenu.Item onclick={handleAddText}>
														{m.video_editor_add_text()}
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={handleAddAdjustmentLayer}>
														{m.video_editor_add_adjustment_layer()}
													</DropdownMenu.Item>
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										</div>
									</div>
									<div
										class="flex shrink-0 gap-1 overflow-x-auto border-b border-[oklch(0.25_0.015_55)] p-1 lg:hidden"
										aria-label={m.video_editor_assets()}
										aria-orientation="horizontal"
										role="tablist"
									>
										{#each leftPanelOptions as option (option.value)}
											{@const Icon = option.icon}
											<button
												type="button"
												class:active={leftPanel === option.value}
												class="flex min-h-11 shrink-0 items-center gap-1.5 rounded px-2 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
												data-left-panel-tab={option.value}
												data-tab-orientation="horizontal"
												role="tab"
												tabindex={leftPanel === option.value ? 0 : -1}
												aria-controls="video-editor-left-tool-panel"
												aria-selected={leftPanel === option.value}
												onclick={() => (leftPanel = option.value)}
												onkeydown={(event) => moveLeftPanelFocus(event, option.value, 'horizontal')}
											>
												<Icon class="size-3.5" aria-hidden="true" />
												{option.label}
											</button>
										{/each}
									</div>
									{#if leftPanel === 'media'}
										<div class="grid grid-cols-2 gap-1 border-b border-[oklch(0.25_0.015_55)] p-1">
											<button
												type="button"
												class:active={mediaPanelView === 'project'}
												class="flex min-h-8 items-center justify-center gap-1.5 rounded px-2 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
												aria-pressed={mediaPanelView === 'project'}
												onclick={() => (mediaPanelView = 'project')}
											>
												<ImagesIcon class="size-3.5" aria-hidden="true" />
												{m.video_editor_media_tab()}
											</button>
											<button
												type="button"
												class:active={mediaPanelView === 'scenes'}
												class="flex min-h-8 items-center justify-center gap-1.5 rounded px-2 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
												aria-pressed={mediaPanelView === 'scenes'}
												onclick={() => (mediaPanelView = 'scenes')}
											>
												<ClapperboardIcon class="size-3.5" aria-hidden="true" />
												{m.video_editor_scenes()}
											</button>
										</div>
									{/if}
									<div
										id="video-editor-left-tool-panel"
										class="flex min-h-24 flex-1 flex-col lg:min-h-0"
										role="tabpanel"
										aria-label={leftPanelHeading}
									>
										{#if leftPanel === 'media' && mediaPanelView === 'project'}
											<MediaPoolList
												{projectId}
												onUnsupportedAudio={requestUnsupportedAudioDecision}
												onsequenceopen={resetTimelineSelection}
												onsourceopen={(mediaId) => (sourceMediaId = mediaId)}
												onextractsubtitles={openEmbeddedSubtitlePicker}
												onimport={handleImport}
											/>
										{:else if leftPanel === 'media'}
											<SceneBrowserPanel />
										{:else if leftPanel === 'stock'}
											<StockBrowserPanel {projectId} oninserted={handleVectorAssetInserted} />
										{:else if leftPanel === 'text'}
											<TextTemplateBrowser oninserted={handleVectorAssetInserted} />
										{:else if leftPanel === 'shapes'}
											<ShapePanel oninserted={handleVectorAssetInserted} />
										{:else if leftPanel === 'backgrounds'}
											<BackgroundPanel oninserted={handleVectorAssetInserted} />
										{:else if leftPanel === 'stickers'}
											<StickerBrowserPanel {projectId} oninserted={handleVectorAssetInserted} />
										{:else if leftPanel === 'effects'}
											<EffectBrowserPanel
												selectedItemIds={selectedLeftPanelItemIds}
												oninserted={handleVectorAssetInserted}
												onedit={() => editorSession.scheduleAutosave()}
											/>
										{:else if leftPanel === 'transitions'}
											<TransitionBrowserPanel onapply={handleApplyTransition} />
										{:else if leftPanel === 'lottie'}
											<LottieBrowserPanel {projectId} oninserted={handleVectorAssetInserted} />
										{:else if leftPanel === 'transcript'}
											<TranscriptPanel
												itemIds={selectedLeftPanelItemIds}
												showHeading={false}
												onedit={() => editorSession.scheduleAutosave()}
											/>
										{:else}
											<EditorAssistantPanel
												{projectId}
												oninserted={handleGeneratedAudioInserted}
												onselectitems={(ids) => {
													selectedItemIds = ids;
													selectedItemId = ids[0] ?? null;
													selectedTransitionId = null;
												}}
												onopensilence={(ids) => openAgentSpeechCleanup('silence', ids)}
												onopenfillers={(ids) => openAgentSpeechCleanup('fillers', ids)}
												selectedIds={selectedLeftPanelItemIds}
												onautosave={() => editorSession.scheduleAutosave()}
												{textVoiceRequest}
											/>
										{/if}
									</div>
									<MediaTaskProgress />
								</div>
							</div>
							<PanelResizeHandle
								edge="right"
								value={effectiveAssetBrowserWidth}
								minimum={300}
								maximum={assetBrowserMaximum}
								defaultValue={336}
								label={m.video_editor_assets()}
								onresize={(value) => (assetBrowserWidth = value)}
								oncommit={(value) => persistPanelSize('assetBrowserWidth', value)}
							/>
						</aside>
					{/if}

					<div
						class="flex min-h-0 w-full min-w-0 flex-1 bg-[oklch(0.205_0.008_55)] {activeWorkspace ===
						'edit'
							? 'lg:col-start-2 lg:row-start-1'
							: ''}"
					>
						<div
							class="min-h-0 min-w-0 flex-1 bg-[oklch(0.205_0.008_55)] {activeWorkspace === 'color'
								? 'flex flex-col lg:flex-row'
								: showSourceMonitor
									? 'flex flex-col xl:flex-row'
									: 'flex'}"
						>
							{#if showSourceMonitor && sourceMediaId}
								<div
									class="relative flex h-[min(44%,22rem)] min-h-0 w-full shrink-0 xl:h-auto xl:w-[var(--source-monitor-width)] xl:max-w-[calc(100%_-_300px)]"
									style:--source-monitor-width={`${effectiveSourceMonitorWidth}px`}
								>
									{#key sourceMediaId}
										<SourceMonitor
											mediaId={sourceMediaId}
											preferredTrackId={selectedItemId
												? timelineStore.itemById.get(selectedItemId)?.trackId
												: undefined}
											onclose={() => (sourceMediaId = null)}
											onedit={() => editorSession.scheduleAutosave()}
											oninserted={handleSourceInserted}
										/>
									{/key}
									<PanelResizeHandle
										edge="right"
										value={effectiveSourceMonitorWidth}
										minimum={300}
										maximum={sourceMonitorMaximum}
										defaultValue={480}
										label={m.video_editor_source_monitor()}
										visibleFrom="xl"
										onresize={(value) => (sourceMonitorWidth = value)}
										oncommit={(value) => persistPanelSize('sourceMonitorWidth', value)}
									/>
								</div>
							{/if}
							<section
								id="video-editor-program-panel"
								data-video-preview
								class="fullscreen:h-screen fullscreen:w-screen [container-type:inline-size] flex min-w-0 flex-1 flex-col bg-[oklch(0.205_0.008_55)]"
							>
								{#if showSourceMonitor}
									<div
										class="flex h-9 shrink-0 items-center border-b border-[oklch(0.23_0.012_55)] px-3 text-xs font-medium text-[oklch(0.72_0.015_55)]"
									>
										{m.video_editor_program_monitor()}
									</div>
								{/if}
								{#if activeWorkspace === 'motion' && !activeMotionComposition}
									<MotionWorkspaceEmpty
										width={editorSession.project?.metadata.width ?? 1920}
										height={editorSession.project?.metadata.height ?? 1080}
										fps={editorSession.project?.metadata.fps ?? 30}
										defaultName={`${m.video_editor_motion_composition_title()} ${motionCompositionCount + 1}`}
										oncreate={handleCreateEmptyMotionComposition}
									/>
								{:else}
									<PreviewPlayer
										bind:selectedItemId
										bind:selectedItemIds
										ondeselect={resetTimelineSelection}
										onedit={() => editorSession.scheduleAutosave()}
									/>
									<TransportBar {projectId} onvoiceoverinserted={handleVoiceoverInserted} />
								{/if}
							</section>
							{#if activeWorkspace === 'color'}
								<aside
									class="relative flex min-h-[180px] min-w-0 flex-col border-t border-[oklch(0.25_0.015_55)] bg-[oklch(0.135_0.007_55)] lg:min-h-0 lg:w-[var(--scopes-panel-width)] lg:shrink-0 lg:border-t-0 lg:border-l"
									style:--scopes-panel-width={`${effectiveScopesPanelWidth}px`}
									aria-label={m.video_editor_scopes()}
								>
									<PanelResizeHandle
										edge="left"
										value={effectiveScopesPanelWidth}
										minimum={280}
										maximum={scopesPanelMaximum}
										defaultValue={360}
										label={m.video_editor_scopes()}
										onresize={(value) => (scopesPanelWidth = value)}
										oncommit={(value) => persistPanelSize('scopesPanelWidth', value)}
									/>
									<div class="min-h-0 flex-1 overflow-hidden">
										<ColorScopes
											embedded
											itemId={selectedSupportsEffects ? selectedItemId : null}
										/>
									</div>
								</aside>
							{/if}
						</div>
					</div>

					<!-- Tools -->
					{#if activeWorkspace === 'edit'}
						<aside
							id="video-editor-tools-panel"
							class="relative h-[min(44%,22rem)] min-h-0 w-full flex-none flex-col border-t border-[oklch(0.25_0.015_55)] bg-[oklch(0.15_0.008_55)] lg:col-start-3 lg:row-start-1 lg:flex lg:h-auto lg:w-auto lg:border-t-0 lg:border-l {mobileEditPane ===
							'tools'
								? 'flex'
								: 'hidden'}"
							aria-label={m.video_editor_tools()}
						>
							<PanelResizeHandle
								edge="left"
								value={effectiveInspectorPanelWidth}
								minimum={280}
								maximum={inspectorPanelMaximum}
								defaultValue={320}
								label={m.video_editor_tools()}
								onresize={(value) => (inspectorPanelWidth = value)}
								oncommit={(value) => persistPanelSize('inspectorPanelWidth', value)}
							/>
							<div
								class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-[oklch(0.25_0.015_55)] px-3"
							>
								<h2 class="min-w-0 truncate text-sm font-medium text-white/90">
									{editInspectorHeading}
								</h2>
								{#if selectedItemId || selectedTransition}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<Button
													{...props}
													size="icon-xs"
													variant="ghost"
													aria-label={m.image_editor_more_actions()}
												>
													<MoreHorizontalIcon aria-hidden="true" />
												</Button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content class="video-editor-theme w-56" align="end">
											{#if selectedTransition}
												<DropdownMenu.Item onclick={handleRemoveTransition}>
													{m.video_editor_break_transition()}
												</DropdownMenu.Item>
											{:else}
												<DropdownMenu.Item onclick={handleSplit}>
													{m.video_editor_split()}
												</DropdownMenu.Item>
												<DropdownMenu.Item onclick={handleAddCrossfade}>
													{m.video_editor_crossfade()}
												</DropdownMenu.Item>
												<DropdownMenu.Item
													onclick={selectedIsCompound
														? handleDissolveCompound
														: handleCreateCompound}
												>
													{selectedIsCompound
														? m.video_editor_dissolve_compound()
														: m.video_editor_create_compound()}
												</DropdownMenu.Item>
												<DropdownMenu.Separator />
												<DropdownMenu.Item onclick={() => handleDelete(false)}>
													{m.video_editor_delete_leave_gap()}
												</DropdownMenu.Item>
												<DropdownMenu.Item variant="destructive" onclick={() => handleDelete(true)}>
													{m.video_editor_ripple_delete()}
												</DropdownMenu.Item>
											{/if}
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								{/if}
							</div>
							{#if editInspectorTabs.length > 0}
								<EditInspectorTabs tabs={editInspectorTabs} bind:value={editInspectorTab} />
							{/if}

							<div class="min-h-0 flex-1 overflow-y-auto p-2">
								{#if selectedTransition}
									<TransitionPropertiesPanel
										transitionId={selectedTransition.id}
										onedit={() => editorSession.scheduleAutosave()}
										onremove={() => (selectedTransitionId = null)}
									/>
								{:else if selectedItemId && editInspectorTab === 'properties'}
									<ClipPropertiesPanel
										itemId={selectedItemId}
										itemIds={selectedItemIds}
										onedit={() => editorSession.scheduleAutosave()}
										oncreatevoice={openTextVoice}
									/>
									{#if selectedIsVideo}
										<div class="mt-3">
											<div class="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
												{#if scanningScenes}
													<LoaderIcon
														class="size-3.5 animate-spin motion-reduce:animate-none"
														aria-hidden="true"
													/>
												{/if}
												{m.video_editor_scene_split()}
											</div>
											<div class="grid grid-cols-2 gap-1.5">
												<Button
													size="sm"
													variant="outline"
													class="min-h-11 lg:min-h-8"
													disabled={scanningScenes || selectedTrackLocked}
													title={m.video_editor_scene_split_fast_help()}
													onclick={() => void handleAutoSplitScenes(selectedItemId, 'fast')}
												>
													{m.video_editor_scene_split_fast()}
												</Button>
												<Button
													size="sm"
													variant="outline"
													class="min-h-11 lg:min-h-8"
													disabled={scanningScenes || selectedTrackLocked}
													title={m.video_editor_scene_split_adaptive_help()}
													onclick={() => void handleAutoSplitScenes(selectedItemId, 'adaptive-lfm')}
												>
													{m.video_editor_scene_split_adaptive()}
												</Button>
											</div>
										</div>
									{/if}
								{:else if selectedItemId && editInspectorTab === 'motion' && selectedSupportsMotion}
									<MotionPresetsPanel
										itemId={selectedItemId}
										itemIds={selectedItemIds}
										frameWidth={sequenceStore.activeWidth}
										frameHeight={sequenceStore.activeHeight}
										fps={timelineStore.fps}
										animationPresets={editorSession.project?.animationPresets ?? []}
										onsavepreset={(preset) => editorSession.saveAnimationPreset(preset)}
										ondeletepreset={(presetId) => editorSession.deleteAnimationPreset(presetId)}
										variant="edit"
										onmotionclip={handleEditMotionClip}
										onedit={() => editorSession.scheduleAutosave()}
									/>
									{#if selectedIsText}
										<TextMotionPanel
											itemId={selectedItemId}
											itemIds={selectedItemIds}
											onedit={() => editorSession.scheduleAutosave()}
										/>
									{/if}
								{:else if selectedItemId && editInspectorTab === 'effects' && selectedSupportsEffects}
									<EffectsPanel
										itemId={selectedItemId}
										itemIds={selectedItemIds}
										onedit={() => editorSession.scheduleAutosave()}
									/>
								{:else if selectedItemId && editInspectorTab === 'transcript' && selectedIsMedia}
									<TranscriptionControls
										canTranscribe={selectedIsMedia}
										busy={selectedTranscriptionJob !== undefined}
										status={selectedTranscriptionJob?.status}
										queuePosition={selectedTranscriptionQueuePosition}
										queueTotal={transcriptionJobCount}
										progress={selectedTranscriptionJob?.progress ?? null}
										backend={selectedTranscriptionJob?.backend ?? null}
										fallback={selectedTranscriptionJob?.fallback ?? null}
										onstart={(selection) => void handleTranscribe(selection)}
										oncancel={cancelTranscription}
									/>
									<div class="mt-1">
										<AiCaptionControls
											canGenerate={selectedIsMedia}
											busy={selectedAiCaptionJob !== undefined}
											status={selectedAiCaptionJob?.status}
											queuePosition={selectedAiCaptionQueuePosition}
											queueTotal={aiCaptionJobCount}
											progress={selectedAiCaptionJob?.progress ?? null}
											error={aiCaptionError}
											onstart={() => void handleAiCaptions()}
											oncancel={cancelAiCaptions}
										/>
									</div>
									<div
										class="mt-1 max-h-64 overflow-y-auto rounded-md border border-[oklch(0.25_0.015_55)] p-1"
									>
										<TranscriptPanel
											itemIds={selectedItemIds.length > 0
												? selectedItemIds
												: selectedItemId
													? [selectedItemId]
													: []}
											onedit={() => editorSession.scheduleAutosave()}
										/>
									</div>
									<div
										class="mt-3 grid grid-cols-2 gap-1 border-t border-[oklch(0.25_0.015_55)] pt-3"
									>
										<Button
											size="sm"
											variant="outline"
											class="min-h-11 lg:min-h-8"
											disabled={speechCleanupItemIds.length === 0}
											aria-label={m.video_editor_filler_review()}
											onclick={() => openSpeechCleanup('fillers')}
										>
											{m.video_editor_cleanup_fillers_short()}
										</Button>
										<Button
											size="sm"
											variant="outline"
											class="min-h-11 lg:min-h-8"
											disabled={speechCleanupItemIds.length === 0}
											aria-label={m.video_editor_silence_review()}
											onclick={() => openSpeechCleanup('silence')}
										>
											{m.video_editor_cleanup_silence_short()}
										</Button>
									</div>
								{:else if sequenceStore.activeSequenceId === null}
									<ProjectCanvasPanel onedit={() => editorSession.scheduleAutosave()} />
								{:else}
									<p class="px-1 py-3 text-sm text-[oklch(0.62_0.01_55)]">
										{m.video_editor_select_clip()}
									</p>
								{/if}
							</div>
						</aside>
					{:else if activeWorkspace === 'motion'}
						<div
							class="relative flex max-h-[44dvh] min-h-0 w-full shrink-0 lg:max-h-none lg:w-[var(--motion-panel-width)]"
							style:--motion-panel-width={`${effectiveMotionPanelWidth}px`}
						>
							<PanelResizeHandle
								edge="left"
								value={effectiveMotionPanelWidth}
								minimum={300}
								maximum={motionPanelMaximum}
								defaultValue={340}
								label={m.video_editor_workspace_motion()}
								onresize={(value) => (motionPanelWidth = value)}
								oncommit={(value) => persistPanelSize('motionPanelWidth', value)}
							/>
							<MotionWorkspacePanel
								itemId={activeMotionComposition ? selectedItemId : null}
								itemIds={activeMotionComposition ? selectedItemIds : []}
								frameWidth={sequenceStore.activeWidth}
								frameHeight={sequenceStore.activeHeight}
								fps={timelineStore.fps}
								animationPresets={editorSession.project?.animationPresets ?? []}
								onsavepreset={(preset) => editorSession.saveAnimationPreset(preset)}
								ondeletepreset={(presetId) => editorSession.deleteAnimationPreset(presetId)}
								oncreatecomposition={handleCreateMotionComposition}
								onreturncomposition={handleReturnFromMotionComposition}
								canreturncomposition={motionReturnStack.length > 0}
								onselectitem={handleSelectItem}
								onedit={() => editorSession.scheduleAutosave()}
							/>
						</div>
					{/if}
				</div>

				{#if activeWorkspace === 'color'}
					<div
						class="relative max-h-[72dvh] min-h-0 shrink-0 lg:h-[var(--color-dock-height)]"
						style:--color-dock-height={`${effectiveColorDockHeight}px`}
					>
						<PanelResizeHandle
							edge="top"
							value={effectiveColorDockHeight}
							minimum={colorDockMinimum}
							maximum={colorDockMaximum}
							defaultValue={colorDockDefault}
							label={m.video_editor_color_dock()}
							onresize={(value) => (colorDockHeight = value)}
							oncommit={(value) => persistPanelSize('colorDockHeight', value)}
						/>
						<ColorGradingDock
							itemId={selectedSupportsEffects ? selectedItemId : null}
							itemIds={selectedItemIds}
							onselectitem={handleSelectItem}
							oncreateadjustment={handleAddAdjustmentLayer}
							onedit={() => editorSession.scheduleAutosave()}
						/>
					</div>
				{/if}
				{#if activeWorkspace !== 'color'}
					<footer
						class="relative flex h-[36dvh] shrink-0 flex-col overflow-hidden border-t border-[oklch(0.25_0.015_55)] bg-[oklch(0.145_0.008_55)] {activeWorkspace ===
						'edit'
							? 'lg:col-span-2 lg:col-start-2 lg:row-start-2 lg:h-auto'
							: 'lg:h-[var(--timeline-height)]'}"
					>
						<PanelResizeHandle
							edge="top"
							value={effectiveTimelineHeight}
							minimum={timelinePanelMinimum}
							maximum={timelinePanelMaximum}
							defaultValue={260}
							label={m.video_editor_timeline()}
							class="!top-0 [@media(pointer:coarse)]:!top-0"
							onresize={resizeTimelinePanel}
							oncommit={persistTimelinePanel}
						/>
						{#if activeWorkspace === 'edit'}
							<SequenceTabs
								onswitch={resetTimelineSelection}
								onedit={() => editorSession.scheduleAutosave()}
							/>
						{/if}
						<div class="flex min-h-0 flex-1 flex-col">
							{#if activeWorkspace === 'motion' && !activeMotionComposition}
								<div
									class="h-full bg-[oklch(0.145_0.008_55)]"
									data-motion-timeline-empty
									aria-hidden="true"
								></div>
							{:else if sequenceStore.activeSequence?.editorKind === 'composite-2d'}
								<CompositionTimeline
									{selectedItemId}
									onedit={() => editorSession.scheduleAutosave()}
									onselectitem={handleSelectItem}
									oncompositionchange={switchMotionComposition}
								/>
							{:else}
								<TimelinePanel
									bind:selectedItemId
									bind:selectedItemIds
									bind:selectedTransitionId
									freezeFramePending={freezingItemId !== null}
									sceneScanPending={scanningScenes}
									{transcriptionPendingItemIds}
									{aiCaptionPendingItemIds}
									canvasWidth={renderProject?.metadata.width ?? 1920}
									canvasHeight={renderProject?.metadata.height ?? 1080}
									onedit={() => editorSession.scheduleAutosave()}
									onfreezeframe={(itemId) => void handleFreezeFrame(itemId)}
									onreverseitems={handleReverseItems}
									onsplitscenes={(itemId, mode) => void handleAutoSplitScenes(itemId, mode)}
									ontranscribecaptions={handleDefaultCaptions}
									onaicaptions={(itemId) => void handleAiCaptions(itemId)}
									onextractsubtitles={openEmbeddedSubtitlesForItem}
									onopenspeechcleanup={openAgentSpeechCleanup}
									oncreatevoice={openTextVoice}
									oncreatecompound={createCompoundForItems}
									ondissolvecompound={dissolveCompoundItem}
									oncopygrade={handleCopyColorGrade}
									onpastegrade={handlePasteColorGrade}
									oncopyselection={() => copyTimelineSelection(false)}
									oncutselection={() => copyTimelineSelection(true)}
									onpasteat={(frame, trackId) => pasteTimelineClipboard(frame, trackId)}
									onsplitselection={handleSplit}
									ondeleteselection={() => handleDelete(false)}
									onrippledeleteselection={() => handleDelete(true)}
									onmixerlayoutchange={handleMixerLayoutChange}
									mixerMaximum={mixerPanelMaximum}
									onopencomposition={handleOpenSequence}
									ontransitionbreak={() => showToast(m.video_editor_transition_removed(), 'info')}
								/>
							{/if}
						</div>
					</footer>
				{/if}
			</div>
		{/key}
	{/if}
</div>

<SpeechCleanupDialog
	bind:open={speechCleanupOpen}
	itemIds={speechCleanupItemIds}
	initialMode={speechCleanupMode}
	onapplied={handleSpeechCleanupApplied}
/>

<EditorSettingsDialog bind:open={settingsOpen} />

<MediaRecoveryDialog onedit={() => editorSession.scheduleAutosave()} />

<EmbeddedSubtitlePicker
	media={embeddedSubtitleMedia}
	bind:open={embeddedSubtitlePickerOpen}
	canvasWidth={sequenceStore.activeWidth}
	canvasHeight={sequenceStore.activeHeight}
	oninsert={handleEmbeddedSubtitleInsert}
/>

<RecordingDialog
	open={recordingOpen}
	{projectId}
	onopenchange={(v) => (recordingOpen = v)}
	oninserted={handleRecordingInserted}
/>

<UnsupportedAudioImportDialog
	open={unsupportedAudioRequest !== null}
	fileName={unsupportedAudioRequest?.fileName ?? ''}
	codec={unsupportedAudioRequest?.codec ?? ''}
	ondecision={resolveUnsupportedAudioDecision}
/>
