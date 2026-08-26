<!--
OpenPost Video Editor workspace for one project.
LAYOUT: header / left media pool / center preview + transport / bottom timeline.
OWN-WORLD: dark editing chrome on OpenPost warm neutrals; orange is the only signal color.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
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
		setItemSpeed
	} from '$lib/video-editor/timeline/actions/items';
	import { markerAfter, markerBefore } from '$lib/video-editor/timeline/markers';
	import { scanSceneCuts } from '$lib/video-editor/media/scene-scan';
	import { cutFramesForItem } from '$lib/video-editor/media/scene-math';
	import { insertFreezeFrame } from '$lib/video-editor/media/insert-freeze-frame.svelte';
	import {
		importFromPicker,
		type UnsupportedAudioImportRequest
	} from '$lib/video-editor/media/import.svelte';
	import {
		addTransition,
		removeTransition,
		transitionsStore
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { addSubtitleItemFromSrt } from '$lib/video-editor/transcript/captions';
	import {
		transcribeClip,
		addGeneratedSubtitleItem
	} from '$lib/video-editor/transcript/transcribe-action';
	import type {
		ResolvedTranscriptionEngine,
		TranscribeProgress,
		TranscriptionSelection
	} from '$lib/video-editor/transcript/engine/types';
	import { resolveMediaBlob } from '$lib/video-editor/media/import.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { renderVideoExport } from '$lib/video-editor/media/render-execution';
	import { sendToOpenPost } from '$lib/video-editor/send-to-openpost';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import MediaPoolList from '$lib/video-editor/components/media-pool-list.svelte';
	import SceneBrowserPanel from '$lib/video-editor/components/scene-browser-panel.svelte';
	import AssetLibraryPanel from '$lib/video-editor/components/asset-library-panel.svelte';
	import EditorAssistantPanel from '$lib/video-editor/components/editor-assistant-panel.svelte';
	import EffectsPanel from '$lib/video-editor/components/effects-panel.svelte';
	import MotionPresetsPanel from '$lib/video-editor/components/motion-presets-panel.svelte';
	import TextMotionPanel from '$lib/video-editor/components/text-motion-panel.svelte';
	import ClipPropertiesPanel from '$lib/video-editor/components/clip-properties-panel.svelte';
	import TransitionPropertiesPanel from '$lib/video-editor/components/transition-properties-panel.svelte';
	import ExportDialog from '$lib/video-editor/components/export-dialog.svelte';
	import RenderQueueController from '$lib/video-editor/components/render-queue-controller.svelte';
	import TranscriptPanel from '$lib/video-editor/components/transcript-panel.svelte';
	import TranscriptionControls from '$lib/video-editor/components/transcription-controls.svelte';
	import MediaTaskProgress from '$lib/video-editor/components/media-task-progress.svelte';
	import SpeechCleanupDialog from '$lib/video-editor/components/speech-cleanup-dialog.svelte';
	import EditorSettingsDialog from '$lib/video-editor/components/editor-settings-dialog.svelte';
	import PreviewDiagnosticsPanel from '$lib/video-editor/components/preview-diagnostics-panel.svelte';
	import EditorWorkspaceSwitcher from '$lib/video-editor/components/editor-workspace-switcher.svelte';
	import ColorGradingDock from '$lib/video-editor/components/color-grading-dock.svelte';
	import MotionWorkspacePanel from '$lib/video-editor/components/motion-workspace-panel.svelte';
	import MediaRecoveryDialog from '$lib/video-editor/components/media-recovery-dialog.svelte';
	import UnsupportedAudioImportDialog from '$lib/video-editor/components/unsupported-audio-import-dialog.svelte';
	import PreviewPlayer from '$lib/video-editor/components/preview-player.svelte';
	import SourceMonitor from '$lib/video-editor/components/source-monitor.svelte';
	import TransportBar from '$lib/video-editor/components/transport-bar.svelte';
	import TimelinePanel from '$lib/video-editor/components/timeline-panel.svelte';
	import { voiceoverRecorder } from '$lib/video-editor/recorder/voiceover-recorder.svelte';
	import RecordingDialog from '$lib/video-editor/components/recording-dialog.svelte';
	import SequenceTabs from '$lib/video-editor/components/sequence-tabs.svelte';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import {
		createCompoundClip,
		dissolveCompoundClip,
		switchSequence
	} from '$lib/video-editor/sequences/sequence-actions';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import {
		editorWorkspace,
		type EditorWorkspaceId
	} from '$lib/video-editor/workspaces/editor-workspace.svelte';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import {
		editorShortcutTargetIsDisabled,
		eventMatchesShortcut,
		type EditorShortcutId
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import { emitEditorSound } from '$lib/video-editor/sounds/editor-sounds';
	import { sourceHoverStore } from '$lib/video-editor/source-monitor/source-hover.svelte';
	import { shuttleScrubResume } from '$lib/video-editor/preview/shuttle-scrub-resume.svelte';
	import { mediaTaskId, mediaTasks } from '$lib/video-editor/media/media-tasks.svelte';
	import type { TextVoiceRequest } from '$lib/video-editor/local-ai/types';

	const projectId = $derived(page.params.id ?? '');
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
	let settingsOpen = $state(false);
	let recordingOpen = $state(false);
	let unsupportedAudioRequest = $state<UnsupportedAudioImportRequest | null>(null);
	let unsupportedAudioResolve: ((decision: 'import' | 'cancel') => void) | null = null;
	let assetPanel = $state<'media' | 'assets' | 'scenes' | 'ai'>('media');
	let mobileEditPane = $state<'assets' | 'program' | 'tools'>('program');
	let textVoiceRequest = $state<TextVoiceRequest | null>(null);
	const activeWorkspace = $derived(editorWorkspace.current);
	const showSourceMonitor = $derived(activeWorkspace === 'edit' && sourceMediaId !== null);

	function openTextVoice(itemId: string, text: string): void {
		textVoiceRequest = {
			id: crypto.randomUUID(),
			sourceTextItemId: itemId,
			text
		};
		assetPanel = 'ai';
		mobileEditPane = 'assets';
	}

	$effect(() => {
		if (!projectId) return;
		return () => mediaTasks.reset();
	});

	$effect(() => {
		if (selectedItemId) {
			selectedTransitionId = null;
			mobileEditPane = 'tools';
		}
	});

	$effect(() => {
		voiceoverRecorder.reconcileProject(projectId);
		if (projectId) void editorSession.load(projectId);
		return () => {
			editorSession.pausePlayback();
			editorSession.stopAutosaveTimers();
			void editorSession.flushAutosave().catch(() => undefined);
		};
	});

	async function handleImport(): Promise<void> {
		if (!projectId) return;
		try {
			await importFromPicker({
				projectId,
				storageMode: 'copy',
				onUnsupportedAudio: requestUnsupportedAudioDecision
			});
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

	function changeEditorWorkspace(workspace: EditorWorkspaceId): void {
		if (workspace === editorWorkspace.current) return;
		shuttleScrubResume.cancel();
		editorSession.pausePlayback();
		editorWorkspace.set(workspace);
		emitEditorSound('select', false);
	}

	function handleOpenSequence(compositionId: string): void {
		shuttleScrubResume.cancel();
		const composition = sequenceStore.compositionById.get(compositionId);
		if (composition?.editorKind === 'composite-2d') {
			motionReturnStack = [...motionReturnStack, sequenceStore.activeSequenceId];
		} else {
			sequenceStore.promoteToTab(compositionId);
			motionReturnStack = [];
		}
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

	function handleSelectItem(itemId: string): void {
		selectedItemId = itemId;
		selectedItemIds = [itemId];
		selectedTransitionId = null;
	}

	function handleCreateCompound(): void {
		const ids =
			selectedItemIds.length > 0 ? selectedItemIds : selectedItemId ? [selectedItemId] : [];
		const compositionId = createCompoundClip(ids, m.video_editor_compound_default());
		if (!compositionId) return;
		selectedItemIds = timelineStore.items
			.filter((item) => item.compositionId === compositionId)
			.map((item) => item.id);
		selectedItemId = selectedItemIds[0] ?? null;
		editorSession.scheduleAutosave();
		showToast(m.video_editor_compound_created(), 'success');
	}

	function handleDissolveCompound(): void {
		if (!selectedItemId) return;
		const restoredIds = dissolveCompoundClip(selectedItemId);
		if (restoredIds.length === 0) return;
		selectedItemIds = restoredIds;
		selectedItemId = restoredIds[0] ?? null;
		editorSession.scheduleAutosave();
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
			await sendToOpenPost({
				workspaceId,
				blob: result.blob,
				fileName: result.fileName
			});
			showToast(m.video_editor_sent(), 'success');
		} catch (err) {
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			sending = false;
		}
	}

	let transcribing = $state(false);
	let transcriptionProgress = $state<TranscribeProgress | null>(null);
	let transcriptionBackend = $state<'webgpu' | 'wasm' | null>(null);
	let transcriptionFallback = $state<ResolvedTranscriptionEngine | null>(null);
	let transcriptionAbort: AbortController | null = null;

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

	async function handleTranscribe(selection: TranscriptionSelection): Promise<void> {
		if (!selectedItemId || transcribing) return;
		const item = timelineStore.itemById.get(selectedItemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return;
		if (media.audioCodecSupported === false) {
			showToast(m.video_editor_unsupported_audio_title(), 'error');
			return;
		}
		transcribing = true;
		transcriptionProgress = null;
		transcriptionBackend = null;
		transcriptionFallback = null;
		const abort = new AbortController();
		transcriptionAbort = abort;
		const taskId = mediaTaskId('transcription', item.id);
		const taskRevision = mediaTasks.start({
			id: taskId,
			kind: 'transcription',
			mediaId: media.id,
			label: media.fileName,
			stage: 'preparing',
			progress: null,
			onCancel: () => abort.abort()
		});
		try {
			const blob = await resolveMediaBlob(media);
			const file =
				blob instanceof File ? blob : new File([blob], media.fileName, { type: media.mimeType });
			const words = await transcribeClip(item, file, {
				model: selection.model,
				language: selection.language,
				quantization: selection.quantization,
				signal: abort.signal,
				onProgress: (progress) => {
					transcriptionProgress = progress;
					mediaTasks.update(
						taskId,
						{
							stage: progress.stage,
							progress: progress.indeterminate ? null : progress.progress,
							receivedBytes: progress.receivedBytes,
							totalBytes: progress.totalBytes
						},
						taskRevision
					);
				},
				onRuntimeInfo: (runtime) => {
					if (runtime.backend) transcriptionBackend = runtime.backend;
				},
				onFallback: (fallback) => (transcriptionFallback = fallback)
			});
			addGeneratedSubtitleItem(item.id, words);
			editorSession.scheduleAutosave();
			showToast(m.video_editor_transcribe_done(), 'success');
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				showToast(err instanceof Error ? err.message : String(err), 'error');
			}
		} finally {
			mediaTasks.finish(taskId, taskRevision);
			transcribing = false;
			transcriptionAbort = null;
		}
	}

	function cancelTranscription(): void {
		transcriptionAbort?.abort();
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

	let showTranscript = $state(false);

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
	async function handleAutoSplitScenes(): Promise<void> {
		if (!selectedItemId || scanningScenes) return;
		const item = timelineStore.itemById.get(selectedItemId);
		const media = item?.mediaId ? mediaPool.get(item.mediaId) : undefined;
		if (!item || !media) return;
		scanningScenes = true;
		try {
			editorSession.pausePlayback();
			const sourceFps = item.sourceFps && item.sourceFps > 0 ? item.sourceFps : media.fps;
			const cutFrames = await scanSceneCuts(media, { sourceFps });
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
			showToast(err instanceof Error ? err.message : String(err), 'error');
		} finally {
			scanningScenes = false;
		}
	}

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

	function onKeydown(event: KeyboardEvent): void {
		if (event.repeat) return;
		if (editorShortcutTargetIsDisabled(event.target)) return;
		const bindings = keyboardShortcuts.bindings;
		const matches = (...ids: EditorShortcutId[]) =>
			ids.some((id) => eventMatchesShortcut(event, bindings[id]));
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
		if (matches('PLAY_PAUSE')) {
			event.preventDefault();
			togglePlay();
		} else if (matches('SAVE')) {
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
		} else if (
			matches('DELETE_SELECTED', 'DELETE_SELECTED_ALT', 'RIPPLE_DELETE', 'RIPPLE_DELETE_ALT')
		) {
			const ripple = matches('RIPPLE_DELETE', 'RIPPLE_DELETE_ALT');
			if (ripple && selectedItemId) {
				event.preventDefault();
				handleDelete(true);
			} else if (!ripple && selectedTransitionId) {
				event.preventDefault();
				removeTransition(selectedTransitionId);
				selectedTransitionId = null;
				editorSession.scheduleAutosave();
			} else if (!ripple && timelineStore.selectedMarkerId) {
				event.preventDefault();
				removeMarker(timelineStore.selectedMarkerId);
				editorSession.scheduleAutosave();
			} else if (!ripple && selectedItemId) {
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
</script>

<svelte:head>
	<title>{editorSession.project?.name ?? m.video_editor_title()}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div
	class="video-editor-theme flex h-dvh flex-col bg-[oklch(0.145_0.008_55)] text-[oklch(0.92_0.005_85)]"
>
	<header
		class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-[oklch(0.25_0.015_55)] px-2 py-2 sm:px-3"
	>
		<div class="flex min-w-0 items-center gap-2">
			<a
				href="/video-editor"
				class="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
			>
				<Logo class="h-5 w-auto" />
				<span class="hidden text-sm font-semibold lg:inline">{m.video_editor_title()}</span>
			</a>
			<span class="hidden min-w-0 truncate text-sm font-medium md:block">
				{editorSession.project?.name}
			</span>
		</div>
		<EditorWorkspaceSwitcher value={activeWorkspace} onchange={changeEditorWorkspace} />
		<div class="flex min-w-24 items-center justify-end gap-2 text-xs text-[oklch(0.65_0.015_55)]">
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
				size="sm"
				aria-label={m.video_editor_record_screen()}
				onclick={() => (recordingOpen = true)}
			>
				{m.video_editor_record()}
			</Button>
			<PreviewDiagnosticsPanel />
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label={m.video_editor_settings_title()}
				title={m.video_editor_settings_title()}
				onclick={() => (settingsOpen = true)}
			>
				<SettingsIcon class="size-3.5" aria-hidden="true" />
			</Button>
		</div>
	</header>

	{#if editorSession.loading}
		<main class="flex flex-1 items-center justify-center">
			<LoaderIcon class="size-5 animate-spin" aria-hidden="true" />
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
			<SequenceTabs
				onswitch={resetTimelineSelection}
				onedit={() => editorSession.scheduleAutosave()}
			/>
			{#if activeWorkspace === 'edit'}
				<nav
					class="grid shrink-0 grid-cols-3 border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_50)] p-1 lg:hidden"
					aria-label={m.video_editor_mobile_panels()}
				>
					<button
						type="button"
						class:active={mobileEditPane === 'assets'}
						class="rounded px-2 py-1.5 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
						aria-pressed={mobileEditPane === 'assets'}
						onclick={() => (mobileEditPane = 'assets')}
					>
						{m.video_editor_assets()}
					</button>
					<button
						type="button"
						class:active={mobileEditPane === 'program'}
						class="rounded px-2 py-1.5 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
						aria-pressed={mobileEditPane === 'program'}
						onclick={() => (mobileEditPane = 'program')}
					>
						{m.video_editor_program_monitor()}
					</button>
					<button
						type="button"
						class:active={mobileEditPane === 'tools'}
						class="rounded px-2 py-1.5 text-xs text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
						aria-pressed={mobileEditPane === 'tools'}
						onclick={() => (mobileEditPane = 'tools')}
					>
						{m.video_editor_tools()}
					</button>
				</nav>
			{/if}
			<div class="flex min-h-0 flex-1 flex-col">
				<div
					class="flex min-h-0 flex-1 {activeWorkspace === 'motion' || activeWorkspace === 'edit'
						? 'flex-col lg:flex-row'
						: 'flex-row'}"
				>
					{#if activeWorkspace === 'edit'}
						<aside
							class="min-h-0 w-full flex-1 flex-col border-b border-[oklch(0.25_0.015_55)] lg:flex lg:w-72 lg:flex-none lg:border-r lg:border-b-0 {mobileEditPane ===
							'assets'
								? 'flex'
								: 'hidden'}"
							aria-label={m.video_editor_media_pool()}
						>
							<div class="flex items-center gap-1 p-2">
								<div
									class="grid min-w-0 flex-1 grid-cols-4 rounded-md bg-[oklch(0.18_0.01_55)] p-0.5"
								>
									<button
										type="button"
										class:active={assetPanel === 'assets'}
										class="rounded px-1 py-1 text-[11px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
										onclick={() => (assetPanel = 'assets')}
									>
										{m.video_editor_assets()}
									</button>
									<button
										type="button"
										class:active={assetPanel === 'media'}
										class="rounded px-2 py-1 text-[11px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
										onclick={() => (assetPanel = 'media')}
									>
										{m.video_editor_media_tab()}
									</button>
									<button
										type="button"
										class:active={assetPanel === 'scenes'}
										class="rounded px-2 py-1 text-[11px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
										onclick={() => (assetPanel = 'scenes')}
									>
										{m.video_editor_scenes()}
									</button>
									<button
										type="button"
										class:active={assetPanel === 'ai'}
										class="rounded px-2 py-1 text-[11px] text-[oklch(0.64_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:bg-[oklch(0.27_0.02_45)] [&.active]:text-white"
										onclick={() => (assetPanel = 'ai')}
									>
										{m.video_editor_local_ai()}
									</button>
								</div>
								{#if assetPanel === 'media'}
									<Button
										size="icon-xs"
										variant="ghost"
										aria-label={m.video_editor_import_media()}
										onclick={handleImport}
									>
										<PlusIcon />
									</Button>
								{/if}
							</div>
							{#if assetPanel === 'media'}
								<MediaPoolList
									{projectId}
									onUnsupportedAudio={requestUnsupportedAudioDecision}
									onsequenceopen={resetTimelineSelection}
									onsourceopen={(mediaId) => (sourceMediaId = mediaId)}
								/>
							{:else if assetPanel === 'scenes'}
								<SceneBrowserPanel />
							{:else if assetPanel === 'assets'}
								<AssetLibraryPanel {projectId} oninserted={handleVectorAssetInserted} />
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
									selectedIds={selectedItemIds.length > 0
										? selectedItemIds
										: selectedItemId
											? [selectedItemId]
											: []}
									onautosave={() => editorSession.scheduleAutosave()}
									{textVoiceRequest}
								/>
							{/if}
							<MediaTaskProgress />
						</aside>
					{/if}

					<div
						class="min-h-0 w-full min-w-0 flex-1 bg-[oklch(0.12_0.008_55)] lg:flex {activeWorkspace !==
							'edit' || mobileEditPane === 'program'
							? 'flex'
							: 'hidden'}"
					>
						<div
							class:grid={showSourceMonitor}
							class:flex={!showSourceMonitor}
							class="min-h-0 min-w-0 flex-1 bg-[oklch(0.12_0.008_55)] {showSourceMonitor
								? 'grid-cols-1 md:grid-cols-2'
								: ''}"
						>
							{#if showSourceMonitor && sourceMediaId}
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
							{/if}
							<section
								data-video-preview
								class="fullscreen:h-screen fullscreen:w-screen [container-type:inline-size] flex min-w-0 flex-1 flex-col bg-[oklch(0.12_0.008_55)]"
							>
								{#if showSourceMonitor}
									<div
										class="flex h-9 shrink-0 items-center border-b border-[oklch(0.23_0.012_55)] px-3 text-[10px] font-semibold tracking-widest text-[oklch(0.67_0.015_55)] uppercase"
									>
										{m.video_editor_program_monitor()}
									</div>
								{/if}
								<PreviewPlayer
									bind:selectedItemId
									bind:selectedItemIds
									onedit={() => editorSession.scheduleAutosave()}
								/>
								<TransportBar {projectId} onvoiceoverinserted={handleVoiceoverInserted} />
							</section>
						</div>
					</div>

					<!-- Tools -->
					{#if activeWorkspace === 'edit'}
						<aside
							class="min-h-0 w-full flex-1 flex-col gap-1 overflow-y-auto border-t border-[oklch(0.25_0.015_55)] p-2 lg:flex lg:w-64 lg:flex-none lg:border-t-0 lg:border-l {mobileEditPane ===
							'tools'
								? 'flex'
								: 'hidden'}"
						>
							<h2
								class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase"
							>
								{m.video_editor_tools()}
							</h2>
							<Button
								size="sm"
								variant="outline"
								disabled={!selectedItemId}
								data-cuelume-toggle={undefined}
								onclick={handleSplit}
							>
								{m.video_editor_split()}
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={!selectedItemId}
								title={m.video_editor_delete_leave_gap_hint()}
								data-cuelume-toggle={undefined}
								onclick={() => handleDelete(false)}
							>
								{m.video_editor_delete_leave_gap()}
							</Button>
							<Button
								size="sm"
								variant="outline"
								disabled={!selectedItemId}
								title={m.video_editor_ripple_delete_hint()}
								data-cuelume-toggle={undefined}
								onclick={() => handleDelete(true)}
							>
								{m.video_editor_ripple_delete()}
							</Button>
							{#if selectedIsCompound}
								<Button size="sm" variant="outline" onclick={handleDissolveCompound}>
									{m.video_editor_dissolve_compound()}
								</Button>
							{:else}
								<Button
									size="sm"
									variant="outline"
									disabled={selectedItemIds.length === 0 && !selectedItemId}
									onclick={handleCreateCompound}
								>
									{m.video_editor_create_compound()}
								</Button>
							{/if}
							{#if selectedTransition}
								<Button size="sm" variant="outline" onclick={handleRemoveTransition}>
									{m.video_editor_break_transition()}
								</Button>
							{:else}
								<Button
									size="sm"
									variant="outline"
									disabled={!selectedItemId}
									onclick={handleAddCrossfade}
								>
									{m.video_editor_crossfade()}
								</Button>
							{/if}
							<Button size="sm" variant="outline" onclick={handleAddText}>
								{m.video_editor_add_text()}
							</Button>
							<Button size="sm" variant="outline" onclick={handleAddAdjustmentLayer}>
								{m.video_editor_add_adjustment_layer()}
							</Button>
							{#if selectedTransition}
								<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
									<TransitionPropertiesPanel
										transitionId={selectedTransition.id}
										onedit={() => editorSession.scheduleAutosave()}
										onremove={() => (selectedTransitionId = null)}
									/>
								</div>
							{:else if selectedItemId}
								<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
									<ClipPropertiesPanel
										itemId={selectedItemId}
										onedit={() => editorSession.scheduleAutosave()}
										oncreatevoice={openTextVoice}
									/>
								</div>
							{/if}
							{#if selectedIsVideo}
								<Button
									size="sm"
									variant="outline"
									disabled={scanningScenes}
									onclick={handleAutoSplitScenes}
								>
									{#if scanningScenes}
										<LoaderIcon class="size-3.5 animate-spin" aria-hidden="true" />
									{/if}
									{m.video_editor_scene_split()}
								</Button>
							{/if}
							{#if selectedSupportsEffects}
								{#if selectedSupportsMotion}
									<MotionPresetsPanel
										itemId={selectedItemId}
										itemIds={selectedItemIds}
										frameWidth={sequenceStore.activeWidth}
										frameHeight={sequenceStore.activeHeight}
										fps={timelineStore.fps}
										animationPresets={editorSession.project?.animationPresets ?? []}
										onsavepreset={(preset) => editorSession.saveAnimationPreset(preset)}
										ondeletepreset={(presetId) => editorSession.deleteAnimationPreset(presetId)}
										onedit={() => editorSession.scheduleAutosave()}
									/>
									{#if selectedIsText}
										<TextMotionPanel
											itemId={selectedItemId}
											itemIds={selectedItemIds}
											onedit={() => editorSession.scheduleAutosave()}
										/>
									{/if}
								{/if}
								<EffectsPanel
									itemId={selectedItemId}
									itemIds={selectedItemIds}
									onedit={() => editorSession.scheduleAutosave()}
								/>
							{/if}
							<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
								<Button
									size="sm"
									variant="outline"
									class="w-full"
									aria-expanded={showTranscript}
									onclick={() => (showTranscript = !showTranscript)}
								>
									{showTranscript
										? m.video_editor_transcript_hide()
										: m.video_editor_transcript_show()}
								</Button>
								{#if showTranscript}
									<TranscriptionControls
										canTranscribe={selectedIsMedia}
										busy={transcribing}
										progress={transcriptionProgress}
										backend={transcriptionBackend}
										fallback={transcriptionFallback}
										onstart={(selection) => void handleTranscribe(selection)}
										oncancel={cancelTranscription}
									/>
									<div
										class="mt-1 max-h-64 overflow-y-auto rounded-md border border-[oklch(0.25_0.015_55)] p-1"
									>
										<TranscriptPanel onedit={() => editorSession.scheduleAutosave()} />
									</div>
								{/if}
							</div>
							<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
								<p
									class="mb-1.5 text-[10px] font-medium tracking-wide text-[oklch(0.62_0.01_55)] uppercase"
								>
									{m.video_editor_cleanup_title()}
								</p>
								<div class="grid grid-cols-2 gap-1">
									<Button
										size="sm"
										variant="outline"
										disabled={speechCleanupItemIds.length === 0}
										aria-label={m.video_editor_filler_review()}
										onclick={() => openSpeechCleanup('fillers')}
									>
										{m.video_editor_cleanup_fillers_short()}
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={speechCleanupItemIds.length === 0}
										aria-label={m.video_editor_silence_review()}
										onclick={() => openSpeechCleanup('silence')}
									>
										{m.video_editor_cleanup_silence_short()}
									</Button>
								</div>
							</div>
							<div class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
								<Button
									size="sm"
									disabled={exporting || timelineStore.items.length === 0}
									onclick={handleExport}
								>
									{m.video_editor_export()}
								</Button>
								<div class="mt-1">
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
										ondone={(result) =>
											showToast(m.video_editor_export_done({ name: result.fileName }), 'success')}
										onerror={(error) => showToast(error.message, 'error')}
									/>
								</div>
								<Button
									size="sm"
									variant="secondary"
									class="mt-1 w-full"
									disabled={sending ||
										timelineStore.items.length === 0 ||
										!workspaceCtx.currentWorkspace}
									onclick={handleSendToOpenPost}
								>
									{m.video_editor_send_to_openpost()}
								</Button>
							</div>
						</aside>
					{:else if activeWorkspace === 'motion'}
						<MotionWorkspacePanel
							itemId={selectedItemId}
							itemIds={selectedItemIds}
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
					{/if}
				</div>

				{#if activeWorkspace === 'color'}
					<ColorGradingDock
						itemId={selectedSupportsEffects ? selectedItemId : null}
						itemIds={selectedItemIds}
						onselectitem={handleSelectItem}
						onedit={() => editorSession.scheduleAutosave()}
					/>
				{/if}
			</div>

			<footer class="border-t border-[oklch(0.25_0.015_55)]">
				<TimelinePanel
					bind:selectedItemId
					bind:selectedItemIds
					bind:selectedTransitionId
					freezeFramePending={freezingItemId !== null}
					canvasWidth={renderProject?.metadata.width ?? 1920}
					canvasHeight={renderProject?.metadata.height ?? 1080}
					onedit={() => editorSession.scheduleAutosave()}
					onfreezeframe={(itemId) => void handleFreezeFrame(itemId)}
					onopencomposition={handleOpenSequence}
					ontransitionbreak={() => showToast(m.video_editor_transition_removed(), 'info')}
				/>
			</footer>
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
