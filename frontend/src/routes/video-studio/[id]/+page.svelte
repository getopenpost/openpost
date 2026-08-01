<!--
THESIS: A focused social-video workbench keeps the story, canvas, and next edit visible at once.
OWN-WORLD: OpenPost compact controls, warm surfaces, dark pasteboard, structural dividers, and restrained orange action.
STORY: Shape one shared sequence, review each social format, then explicitly export or sync the result.
FIRST VIEWPORT: Project state, active format, preview, focused tool, selected properties, and the primary timeline.
FORM: Operate surface; no floating-card dashboard, unlimited NLE chrome, hidden cloud upload, or decorative hero treatment.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		VideoProjectHistory,
		captionsToSRT,
		captionsToWebVTT,
		cloneVideoProject,
		defaultClipAudio,
		defaultVideoPresentation,
		deletePrimaryItemLeaveGap,
		detachPrimaryClipAudio,
		derivePrimarySequence,
		duplicatePrimaryClip,
		insertFreezeFrame,
		isPrimarySequenceGap,
		isPrimarySequenceClip,
		projectDurationUS,
		removePrimaryRanges,
		reorderPrimaryClip,
		resizePrimaryGap,
		setCaptionCueText,
		setClipSpeed,
		setVariantPresentationOverride,
		splitPrimaryClip,
		trimPrimaryClip,
		validateVideoProject,
		type TransitionKind,
		type CaptionCue,
		type ShapeStyle,
		type PrimarySequenceClip,
		type VideoEffect,
		type VideoProjectDocumentV1,
		type VideoSource,
		type VariantID,
		type VisualTrack,
		type VisualTrackItem
	} from '@openpost/video-project';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { loadStudioBrandKit } from '$lib/studio/api';
	import { loadStudioBrandFonts } from '$lib/studio/fonts';
	import type { StudioBrandKit, StudioBrandTextStyle } from '$lib/studio/types';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StockMediaBrowser from '$lib/components/stock-media-browser.svelte';
	import {
		createCloudVideoProjectCheckpoint,
		completeVideoReturnToken,
		getCloudVideoProject,
		listCloudVideoProjectRevisions,
		loadVideoStudioConfig,
		restoreCloudVideoProjectRevision,
		VideoProjectRevisionConflict,
		type CloudVideoProjectRevision,
		type VideoStudioConfig,
		type StockAsset
	} from '$lib/video-studio/api';
	import {
		detectVideoProjectSilence,
		measureVideoProjectLoudness,
		transcribeVideoProject,
		type LocalAnalysisProgress,
		type SilenceAnalysis,
		type TranscriptAnalysis
	} from '$lib/video-studio/analysis';
	import { cachedVideoStudioModels } from '$lib/video-studio/model-manager';
	import { analyzeSmartFraming, type SmartFramingResult } from '$lib/video-studio/smart-framing';
	import { detectVideoStudioCapabilities } from '$lib/video-studio/capabilities';
	import { m } from '$lib/paraglide/messages';
	import { addFileToProject, addRecordingToProject, formatBytes } from '$lib/video-studio/project';
	import { exportVideoProject, preflightVideoProjectExport } from '$lib/video-studio/exporter';
	import {
		BUNDLED_AUDIO_ITEMS,
		loadBundledAudio,
		type BundledAudioItem
	} from '$lib/video-studio/bundled-audio';
	import { syncVideoProjectToOpenPost, type CloudSyncProgress } from '$lib/video-studio/cloud-sync';
	import {
		deleteRecording,
		deleteRecordingManifest,
		estimateStorageBudget,
		indexProjectAsset,
		listProjectRevisions,
		listProjectAssets,
		listRecoverableRecordings,
		loadLocalVideoProject,
		readProjectFile,
		requestPersistentVideoStorage,
		restoreLocalRevision,
		saveLocalVideoProject,
		writeProjectFile
	} from '$lib/video-studio/storage';
	import { VideoRecordingSession, type RecordingSessionState } from '$lib/video-studio/recorder';
	import { recoverVerifiedRecording } from '$lib/video-studio/recording-recovery';
	import {
		classifyVideoStudioFailure,
		recordVideoStudioDiagnostic
	} from '$lib/video-studio/failures';
	import type {
		LocalProjectRevision,
		LocalVideoProject,
		RecordingManifest
	} from '$lib/video-studio/types';
	import Timeline from '$lib/video-studio/components/timeline.svelte';
	import VideoPreview from '$lib/video-studio/components/video-preview.svelte';
	import ExportDialog from '$lib/video-studio/components/export-dialog.svelte';
	import ArrowLeftIcon from 'lucide-svelte/icons/arrow-left';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import CaptionsIcon from 'lucide-svelte/icons/captions';
	import CheckIcon from 'lucide-svelte/icons/check';
	import CircleDotIcon from 'lucide-svelte/icons/circle-dot';
	import CloudIcon from 'lucide-svelte/icons/cloud';
	import DownloadIcon from 'lucide-svelte/icons/download';
	import FilmIcon from 'lucide-svelte/icons/film';
	import HistoryIcon from 'lucide-svelte/icons/history';
	import ImageIcon from 'lucide-svelte/icons/image';
	import LayersIcon from 'lucide-svelte/icons/layers-3';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import MicIcon from 'lucide-svelte/icons/mic';
	import MonitorIcon from 'lucide-svelte/icons/monitor-play';
	import PauseIcon from 'lucide-svelte/icons/pause';
	import PaletteIcon from 'lucide-svelte/icons/palette';
	import PlayIcon from 'lucide-svelte/icons/play';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import RedoIcon from 'lucide-svelte/icons/redo-2';
	import SaveIcon from 'lucide-svelte/icons/save';
	import ShapesIcon from 'lucide-svelte/icons/shapes';
	import TextIcon from 'lucide-svelte/icons/type';
	import UndoIcon from 'lucide-svelte/icons/undo-2';
	import VolumeIcon from 'lucide-svelte/icons/volume-2';
	import WandIcon from 'lucide-svelte/icons/wand-sparkles';
	import XIcon from 'lucide-svelte/icons/x';

	type ToolID =
		| 'media'
		| 'record'
		| 'stock'
		| 'text'
		| 'captions'
		| 'audio'
		| 'elements'
		| 'transitions'
		| 'brand'
		| 'smart';
	type TextOverlay = Extract<VisualTrackItem, { type: 'text' }>;
	interface LocalVideoTextStyle {
		id: string;
		name: string;
		style: TextOverlay['style'];
	}

	const tools = [
		{ id: 'media', label: () => m.video_studio_tool_media(), icon: FilmIcon },
		{ id: 'record', label: () => m.video_studio_tool_record(), icon: MonitorIcon },
		{ id: 'stock', label: () => m.video_studio_tool_stock(), icon: ImageIcon },
		{ id: 'text', label: () => m.video_studio_tool_text(), icon: TextIcon },
		{ id: 'captions', label: () => m.video_studio_tool_captions(), icon: CaptionsIcon },
		{ id: 'audio', label: () => m.video_studio_tool_audio(), icon: MicIcon },
		{ id: 'elements', label: () => m.video_studio_tool_elements(), icon: ShapesIcon },
		{ id: 'transitions', label: () => m.video_studio_tool_transitions(), icon: LayersIcon },
		{ id: 'brand', label: () => m.video_studio_tool_brand(), icon: PaletteIcon },
		{ id: 'smart', label: () => m.video_studio_tool_smart(), icon: WandIcon }
	] satisfies Array<{ id: ToolID; label: () => string; icon: typeof FilmIcon }>;

	const variantOptions = [
		{ value: 'portrait', label: m.video_studio_variant_portrait() },
		{ value: 'feed-portrait', label: m.video_studio_variant_feed() },
		{ value: 'square', label: m.video_studio_variant_square() },
		{ value: 'landscape', label: m.video_studio_variant_landscape() }
	];
	const transitionOptions = [
		{ value: 'cut', label: m.video_studio_transition_none() },
		{ value: 'cross-dissolve', label: m.video_studio_transition_cross_dissolve() },
		{ value: 'dip-black', label: m.video_studio_transition_dip_black() },
		{ value: 'dip-white', label: m.video_studio_transition_dip_white() },
		{ value: 'slide', label: m.video_studio_transition_slide() },
		{ value: 'push', label: m.video_studio_transition_push() },
		{ value: 'zoom-blur', label: m.video_studio_transition_zoom_blur() }
	];
	const adjustmentOptions = [
		{ type: 'exposure', label: m.video_studio_exposure(), min: -1, max: 1, step: 0.05 },
		{ type: 'contrast', label: m.video_studio_contrast(), min: -1, max: 1, step: 0.05 },
		{ type: 'saturation', label: m.video_studio_saturation(), min: -1, max: 1, step: 0.05 },
		{ type: 'temperature', label: m.video_studio_temperature(), min: -1, max: 1, step: 0.05 },
		{ type: 'blur', label: m.video_studio_blur(), min: 0, max: 20, step: 0.5 },
		{ type: 'vignette', label: m.video_studio_vignette(), min: 0, max: 1, step: 0.05 }
	] satisfies Array<{
		type: VideoEffect['type'];
		label: string;
		min: number;
		max: number;
		step: number;
	}>;

	let localProject = $state.raw<LocalVideoProject | null>(null);
	let loading = $state(true);
	let error = $state('');
	let saveState = $state<'saved' | 'saving' | 'failed'>('saved');
	let activeTool = $state<ToolID>('media');
	let variantID = $state<VariantID>('portrait');
	let selectedClipID = $state('');
	let selectedVisualItemID = $state('');
	let selectedAudioItemID = $state('');
	let selectedCaptionCueID = $state('');
	let fullEditor = $state(false);
	let compactToolOpen = $state(false);
	let compactInspectorOpen = $state(false);
	let persistedExports = $state<
		Array<{ id: string; path: string; name: string; size_bytes: number; variant_id: string }>
	>([]);
	let playheadUS = $state(0);
	let playing = $state(false);
	let timelineZoom = $state(1);
	let editShared = $state(true);
	let historyVersion = $state(0);
	let mutationVersion = $state(0);
	let importBusy = $state(false);
	let exportOpen = $state(false);
	let cloudOpen = $state(false);
	let cloudBusy = $state(false);
	let cloudProgress = $state<CloudSyncProgress | null>(null);
	let cloudConflictOpen = $state(false);
	let revisionOpen = $state(false);
	let revisionBusy = $state(false);
	let checkpointName = $state('');
	let localRevisions = $state<LocalProjectRevision[]>([]);
	let cloudRevisions = $state<CloudVideoProjectRevision[]>([]);
	let exportBusy = $state(false);
	let exportProgress = $state(0);
	let exportError = $state('');
	let exportFile = $state<File | null>(null);
	let exportURL = $state('');
	let exportURLs = $state<Partial<Record<VariantID, string>>>({});
	let exportFormat = $state<'mp4' | 'webm'>('mp4');
	let selectedExportVariants = $state<VariantID[]>([]);
	let exportedFiles = $state<Partial<Record<VariantID, File>>>({});
	let exportCapabilityState = $state<'idle' | 'checking' | 'ready' | 'unsupported'>('idle');
	let exportCapabilityError = $state('');
	let exportCapabilityCheck = 0;
	let returningToComposer = $state(false);
	let videoStudioConfig = $state<VideoStudioConfig | null>(null);
	let analysisBackend = $state<'WebGPU' | 'WASM'>('WASM');
	let analysisBusy = $state(false);
	let audioNormalizeBusy = $state(false);
	let audioNormalizeProgress = $state(0);
	let audioPackBusy = $state('');
	let analysisProgress = $state<LocalAnalysisProgress | null>(null);
	let analysisController: AbortController | null = null;
	let modelConsentOpen = $state(false);
	let pendingAnalysis = $state<'transcript' | 'silence' | null>(null);
	let transcriptLanguage = $state('auto');
	let transcriptAnalysis = $state<TranscriptAnalysis | null>(null);
	let silenceAnalysis = $state<SilenceAnalysis | null>(null);
	let selectedSilences = $state<string[]>([]);
	let selectedFillers = $state<string[]>([]);
	let creditsCopied = $state(false);
	let captionSearch = $state('');
	let captionReplacement = $state('');
	let smartBusy = $state(false);
	let smartProgress = $state(0);
	let smartResult = $state<SmartFramingResult | null>(null);
	let selectedFocusZooms = $state<string[]>([]);
	let recordCamera = $state(true);
	let recordMicrophone = $state(true);
	let recordSystemAudio = $state(true);
	let cameraPresetVariantOnly = $state(true);
	let recordingSession = $state<VideoRecordingSession | null>(null);
	let recordingKind = $state<'screen' | 'voiceover' | null>(null);
	let recordingState = $state<RecordingSessionState | null>(null);
	let recordBusy = $state(false);
	let recordCountdown = $state(0);
	let recordingDevices = $state<MediaDeviceInfo[]>([]);
	let recordingCameraDeviceID = $state('');
	let recordingMicrophoneDeviceID = $state('');
	let switchingRecordingDevice = $state<'camera' | 'microphone' | null>(null);
	let brandKit = $state.raw<StudioBrandKit | null>(null);
	let localTextStyles = $state.raw<LocalVideoTextStyle[]>([]);
	let exportController: AbortController | null = null;
	let recoverableRecording = $state<RecordingManifest | null>(null);
	let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
	let playbackFrame = 0;
	let playbackStartedAt = 0;
	let playbackStartUS = 0;
	let saveInFlight = false;
	let saveQueued = false;
	const history = new VideoProjectHistory(200);

	const project = $derived(localProject?.document);
	const returnToken = $derived(page.url.searchParams.get('return_token') ?? '');
	const requiredVariantIDs = $derived.by(() => {
		const values = (page.url.searchParams.get('required_variants') ?? '')
			.split(',')
			.filter((value): value is VariantID =>
				['portrait', 'feed-portrait', 'square', 'landscape'].includes(value)
			);
		return Array.from(new Set(values));
	});
	const exportVariantIDs = $derived(
		returnToken
			? requiredVariantIDs.length > 0
				? requiredVariantIDs
				: [variantID]
			: selectedExportVariants.length > 0
				? selectedExportVariants
				: [variantID]
	);
	const durationUS = $derived(project ? projectDurationUS(project) : 0);
	const selectedClip = $derived.by(() => {
		const item = project?.primary_sequence.find((candidate) => candidate.id === selectedClipID);
		return item && isPrimarySequenceClip(item) ? item : undefined;
	});
	const selectedGap = $derived.by(() => {
		const item = project?.primary_sequence.find((candidate) => candidate.id === selectedClipID);
		return item && isPrimarySequenceGap(item) ? item : undefined;
	});
	const selectedPresentation = $derived(
		selectedClip
			? editShared
				? selectedClip.video
				: {
						...selectedClip.video,
						...(selectedClip.variant_overrides?.[variantID] ?? {})
					}
			: undefined
	);
	const selectedDerived = $derived(
		project
			? derivePrimarySequence(project).find((clip) => clip.clip_id === selectedClipID)
			: undefined
	);
	const selectedVisualItem = $derived(
		project?.visual_tracks
			.flatMap((track) => track.items)
			.find((item) => item.id === selectedVisualItemID)
	);
	const selectedVisualPresentation = $derived(
		selectedVisualItem
			? editShared
				? selectedVisualItem.presentation
				: {
						...selectedVisualItem.presentation,
						...(selectedVisualItem.variant_overrides?.[variantID]?.presentation ?? {})
					}
			: undefined
	);
	const selectedVisualVisible = $derived(
		selectedVisualItem
			? editShared
				? selectedVisualItem.visible
				: (selectedVisualItem.variant_overrides?.[variantID]?.visible ?? selectedVisualItem.visible)
			: false
	);
	const selectedAudioItem = $derived(
		project?.audio_tracks
			.flatMap((track) => track.items)
			.find((item) => item.id === selectedAudioItemID)
	);
	const selectedCaptionCue = $derived(
		project?.caption_tracks
			.flatMap((track) => track.cues)
			.find((cue) => cue.id === selectedCaptionCueID)
	);
	const stockSources = $derived(
		project ? Object.values(project.sources).filter((source) => Boolean(source.provenance)) : []
	);
	const hasCameraOverlay = $derived(
		project?.visual_tracks.some((track) => track.items.some((item) => item.type === 'camera')) ??
			false
	);
	const creditsText = $derived(
		stockSources
			.map((source) => {
				const provenance = source.provenance!;
				return (
					provenance.attribution_text ||
					`${source.original_name}: ${provenance.creator_name} / ${provenance.provider}`
				);
			})
			.join('\n')
	);
	const cloudBytes = $derived(
		project
			? Object.values(project.sources)
					.filter((source) => source.locator.type === 'local-opfs')
					.reduce((total, source) => total + source.size_bytes, 0)
			: 0
	);
	let authState = $derived($auth);

	function primaryClipByID(
		document: VideoProjectDocumentV1,
		clipID: string
	): PrimarySequenceClip | undefined {
		const item = document.primary_sequence.find((candidate) => candidate.id === clipID);
		return item && isPrimarySequenceClip(item) ? item : undefined;
	}

	onMount(() => {
		void initialize();
		const precisePointerQuery = window.matchMedia('(any-pointer: fine)');
		const touchPhoneQuery = window.matchMedia('(pointer: coarse) and (hover: none)');
		const updateEditorMode = () => {
			fullEditor =
				precisePointerQuery.matches ||
				navigator.maxTouchPoints === 0 ||
				!touchPhoneQuery.matches ||
				window.innerWidth >= 768;
		};
		updateEditorMode();
		precisePointerQuery.addEventListener('change', updateEditorMode);
		touchPhoneQuery.addEventListener('change', updateEditorMode);
		window.addEventListener('resize', updateEditorMode);
		window.addEventListener('keydown', handleKeyboard);
		return () => {
			precisePointerQuery.removeEventListener('change', updateEditorMode);
			touchPhoneQuery.removeEventListener('change', updateEditorMode);
			window.removeEventListener('resize', updateEditorMode);
			window.removeEventListener('keydown', handleKeyboard);
		};
	});

	onDestroy(() => {
		if (autosaveTimer) clearTimeout(autosaveTimer);
		cancelAnimationFrame(playbackFrame);
		exportController?.abort();
		analysisController?.abort();
		if (recordingSession) void recordingSession.cancel();
		revokeExportURLs();
		if (saveState !== 'saved') void flushAutosave();
	});

	function revokeExportURLs(): void {
		for (const url of Object.values(exportURLs)) {
			if (url) URL.revokeObjectURL(url);
		}
		exportURLs = {};
		exportURL = '';
	}

	function recordFailure(cause: unknown, operation: string): void {
		recordVideoStudioDiagnostic({
			code: classifyVideoStudioFailure(cause),
			operation,
			capabilities: {
				webgpu: analysisBackend === 'WebGPU',
				webgl2: true,
				opfs: true
			}
		});
	}

	async function copyCredits(): Promise<void> {
		if (!creditsText) return;
		await navigator.clipboard.writeText(creditsText);
		creditsCopied = true;
		setTimeout(() => (creditsCopied = false), 1_500);
	}

	async function saveExportFile(file: File): Promise<void> {
		const picker = (
			window as Window & {
				showSaveFilePicker?: (options: {
					suggestedName: string;
					types: Array<{ description: string; accept: Record<string, string[]> }>;
				}) => Promise<FileSystemFileHandle>;
			}
		).showSaveFilePicker;
		if (picker) {
			try {
				const handle = await picker({
					suggestedName: file.name,
					types: [
						{
							description: file.type === 'video/mp4' ? 'MP4 video' : 'WebM video',
							accept: {
								[file.type]: [file.type === 'video/mp4' ? '.mp4' : '.webm']
							}
						}
					]
				});
				const writable = await handle.createWritable();
				await writable.write(file);
				await writable.close();
				return;
			} catch (cause) {
				if (cause instanceof DOMException && cause.name === 'AbortError') return;
				throw cause;
			}
		}
		const url = URL.createObjectURL(file);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = file.name;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	async function initialize(): Promise<void> {
		loading = true;
		error = '';
		try {
			await auth.initialize({ optional: true });
			const [config, capabilities] = await Promise.all([
				loadVideoStudioConfig(),
				detectVideoStudioCapabilities()
			]);
			if (!config.enabled) {
				await goto(resolve('/video-studio' as '/'), { replaceState: true });
				return;
			}
			if (!capabilities.supported) {
				await goto(resolve('/video-studio/unsupported' as '/'), { replaceState: true });
				return;
			}
			videoStudioConfig = config;
			try {
				localTextStyles = JSON.parse(
					localStorage.getItem('openpost-video-studio-text-styles') ?? '[]'
				) as LocalVideoTextStyle[];
			} catch {
				localTextStyles = [];
			}
			analysisBackend = capabilities.webGPU ? 'WebGPU' : 'WASM';
			const loaded = await loadLocalVideoProject(page.params.id ?? '');
			localProject = loaded;
			await refreshPersistedExports(loaded.id);
			selectedExportVariants = [variantID];
			selectedClipID = loaded.document.primary_sequence[0]?.id ?? '';
			const recordings = await listRecoverableRecordings();
			recoverableRecording =
				recordings.find((manifest) => manifest.project_id === loaded.id) ?? null;
			if ($auth.isAuthenticated) {
				try {
					await workspaceCtx.initialize();
					const workspaceID = workspaceCtx.currentWorkspace?.id;
					if (workspaceID) {
						brandKit = await loadStudioBrandKit(workspaceID);
						await loadStudioBrandFonts(brandKit);
					}
				} catch {
					brandKit = null;
				}
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_project_missing();
		} finally {
			loading = false;
		}
	}

	async function refreshPersistedExports(projectID: string): Promise<void> {
		const assets = await listProjectAssets(projectID);
		persistedExports = assets
			.filter((asset) => asset.kind === 'export')
			.map((asset) => ({
				id: asset.id,
				path: asset.path,
				name: asset.path.split('/').at(-1) ?? m.video_studio_export(),
				size_bytes: asset.size_bytes,
				variant_id: asset.source_id
			}));
	}

	async function persistExport(variant: VariantID, file: File): Promise<void> {
		if (!localProject) return;
		const stampedName = `${Date.now()}-${file.name}`;
		const stored = await writeProjectFile(localProject.id, 'exports', stampedName, file);
		const now = new Date().toISOString();
		await indexProjectAsset({
			id: `export:${localProject.id}:${crypto.randomUUID()}`,
			project_id: localProject.id,
			source_id: variant,
			path: stored.path,
			kind: 'export',
			size_bytes: stored.size,
			created_at: now,
			updated_at: now,
			disposable: false
		});
	}

	async function downloadPersistedExport(path: string, name: string): Promise<void> {
		const file = await readProjectFile(path);
		if (!file) {
			error = m.video_studio_export_missing();
			return;
		}
		await saveExportFile(new File([file], name.replace(/^\d+-/u, ''), { type: file.type }));
	}

	function mutate(
		label: string,
		apply: (document: VideoProjectDocumentV1) => VideoProjectDocumentV1,
		coalesceKey?: string
	): void {
		if (!localProject) return;
		const next = history.execute(localProject.document, {
			id: crypto.randomUUID(),
			label,
			apply,
			coalesce_key: coalesceKey
		});
		localProject = { ...localProject, document: next };
		historyVersion += 1;
		mutationVersion += 1;
		scheduleAutosave();
	}

	function scheduleAutosave(): void {
		saveState = 'saving';
		if (autosaveTimer) clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(() => void flushAutosave(), 2_000);
	}

	async function flushAutosave(): Promise<void> {
		if (!localProject) return;
		if (saveInFlight) {
			saveQueued = true;
			return;
		}
		if (autosaveTimer) clearTimeout(autosaveTimer);
		autosaveTimer = undefined;
		saveInFlight = true;
		saveState = 'saving';
		const startVersion = mutationVersion;
		const snapshot = { ...localProject, document: cloneVideoProject(localProject.document) };
		try {
			const saved = await saveLocalVideoProject(snapshot);
			if (localProject?.id === saved.id) {
				localProject =
					startVersion === mutationVersion
						? saved
						: {
								...localProject,
								revision: saved.revision,
								updated_at: saved.updated_at,
								last_opened_at: saved.last_opened_at
							};
			}
			saveState = startVersion === mutationVersion ? 'saved' : 'saving';
		} catch (cause) {
			saveState = 'failed';
			error = cause instanceof Error ? cause.message : m.video_studio_save_failed();
		} finally {
			saveInFlight = false;
			if (saveQueued || startVersion !== mutationVersion) {
				saveQueued = false;
				scheduleAutosave();
			}
		}
	}

	function undo(): void {
		if (!localProject || !history.canUndo) return;
		localProject = { ...localProject, document: history.undo(localProject.document) };
		historyVersion += 1;
		mutationVersion += 1;
		scheduleAutosave();
	}

	function redo(): void {
		if (!localProject || !history.canRedo) return;
		localProject = { ...localProject, document: history.redo(localProject.document) };
		historyVersion += 1;
		mutationVersion += 1;
		scheduleAutosave();
	}

	function selectClip(clipID: string): void {
		selectedClipID = clipID;
		selectedVisualItemID = '';
		selectedAudioItemID = '';
		selectedCaptionCueID = '';
		compactInspectorOpen = true;
	}

	function selectVisualItem(itemID: string): void {
		selectedClipID = '';
		selectedVisualItemID = itemID;
		selectedAudioItemID = '';
		selectedCaptionCueID = '';
		compactInspectorOpen = true;
	}

	function selectAudioItem(itemID: string): void {
		selectedClipID = '';
		selectedVisualItemID = '';
		selectedAudioItemID = itemID;
		selectedCaptionCueID = '';
		compactInspectorOpen = true;
	}

	function selectCaptionCue(cueID: string): void {
		selectedClipID = '';
		selectedVisualItemID = '';
		selectedAudioItemID = '';
		selectedCaptionCueID = cueID;
		compactInspectorOpen = true;
	}

	function trimClip(clipID: string, edge: 'start' | 'end', deltaUS: number): void {
		if (!project || deltaUS === 0) return;
		mutate(
			edge === 'start' ? m.video_studio_trim_start() : m.video_studio_trim_end(),
			(document) => trimPrimaryClip(document, clipID, edge, deltaUS),
			`trim:${clipID}:${edge}`
		);
	}

	function splitSelected(): void {
		if (!selectedClipID) return;
		try {
			mutate(m.video_studio_split(), (document) =>
				splitPrimaryClip(document, selectedClipID, playheadUS, () => `clip_${crypto.randomUUID()}`)
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_select_clip();
		}
	}

	function rippleDeleteSelected(): void {
		if (!selectedDerived) return;
		const deletedID = selectedClipID;
		mutate(m.video_studio_ripple_delete(), (document) =>
			removePrimaryRanges(document, [
				{ start_us: selectedDerived.timeline_start_us, end_us: selectedDerived.timeline_end_us }
			])
		);
		const clips = localProject?.document.primary_sequence ?? [];
		selectedClipID = clips.find((clip) => clip.id !== deletedID)?.id ?? '';
		playheadUS = Math.min(playheadUS, durationUS);
	}

	function leaveGapSelected(): void {
		if (!selectedClip) return;
		const gapID = `gap_${crypto.randomUUID()}`;
		mutate(m.video_studio_leave_gap(), (document) =>
			deletePrimaryItemLeaveGap(document, selectedClip.id, () => gapID)
		);
		selectedClipID = gapID;
	}

	function updateSelectedGapDuration(seconds: number): void {
		if (!selectedGap || !Number.isFinite(seconds)) return;
		mutate(m.video_studio_gap_duration(), (document) =>
			resizePrimaryGap(document, selectedGap.id, Math.max(1, Math.round(seconds * 1_000_000)))
		);
	}

	function moveSelectedClip(delta: number): void {
		if (!selectedClipID || !project) return;
		const current = project.primary_sequence.findIndex((clip) => clip.id === selectedClipID);
		if (current < 0) return;
		const nextIndex = Math.max(0, Math.min(project.primary_sequence.length - 1, current + delta));
		if (nextIndex === current) return;
		mutate(m.video_studio_reorder_clip(), (document) =>
			reorderPrimaryClip(document, selectedClipID, nextIndex)
		);
	}

	function reorderClip(clipID: string, index: number): void {
		mutate(m.video_studio_reorder_clip(), (document) =>
			reorderPrimaryClip(document, clipID, index)
		);
	}

	function duplicateSelected(): void {
		if (!selectedClipID) return;
		const duplicateID = `clip_${crypto.randomUUID()}`;
		mutate(m.video_studio_duplicate_clip(), (document) =>
			duplicatePrimaryClip(document, selectedClipID, () => duplicateID)
		);
		selectedClipID = duplicateID;
	}

	function freezeSelected(): void {
		if (!selectedClipID) return;
		const freezeID = `clip_${crypto.randomUUID()}`;
		const rightID = `clip_${crypto.randomUUID()}`;
		try {
			mutate(m.video_studio_freeze_frame(), (document) => {
				let index = 0;
				return insertFreezeFrame(
					document,
					selectedClipID,
					playheadUS,
					2_000_000,
					() => [freezeID, rightID][index++]!
				);
			});
			selectedClipID = freezeID;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_select_clip();
		}
	}

	function detachSelectedAudio(): void {
		if (!selectedClipID) return;
		try {
			mutate(m.video_studio_detach_audio(), (document) =>
				detachPrimaryClipAudio(document, selectedClipID, () => `audio_${crypto.randomUUID()}`)
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_select_clip();
		}
	}

	function setTitle(value: string): void {
		mutate(
			m.video_studio_rename_project(),
			(document) => {
				document.title = value.slice(0, 200);
				return document;
			},
			'title'
		);
	}

	function updateClipNumber(property: 'scale' | 'opacity' | 'gain_db', value: number): void {
		if (!selectedClipID) return;
		mutate(
			m.video_studio_change_clip_property({ property }),
			(document) => {
				const clip = primaryClipByID(document, selectedClipID);
				if (!clip) return document;
				if (property === 'gain_db') clip.audio.gain_db = value;
				else if (editShared) {
					clip.video[property] = value;
					for (const override of Object.values(clip.variant_overrides ?? {})) {
						if (override) delete override[property];
					}
				} else {
					return setVariantPresentationOverride(document, selectedClipID, variantID, {
						[property]: value
					});
				}
				return document;
			},
			`${selectedClipID}:${variantID}:${property}`
		);
	}

	function updateClipPosition(positionX: number, positionY: number): void {
		if (!selectedClipID) return;
		const x = Math.max(0, Math.min(1, positionX));
		const y = Math.max(0, Math.min(1, positionY));
		mutate(
			m.video_studio_inspector_position(),
			(document) => {
				const clip = primaryClipByID(document, selectedClipID);
				if (!clip) return document;
				if (editShared) {
					clip.video.position_x = x;
					clip.video.position_y = y;
					for (const override of Object.values(clip.variant_overrides ?? {})) {
						if (!override) continue;
						delete override.position_x;
						delete override.position_y;
					}
					return document;
				}
				return setVariantPresentationOverride(document, selectedClipID, variantID, {
					position_x: x,
					position_y: y
				});
			},
			`${selectedClipID}:${variantID}:position`
		);
	}

	function updateVisualPresentation(
		itemID: string,
		values: Partial<VisualTrackItem['presentation']>,
		label = m.video_studio_edit_overlay()
	): void {
		mutate(
			label,
			(document) => {
				const item = document.visual_tracks
					.flatMap((track) => track.items)
					.find((candidate) => candidate.id === itemID);
				if (!item) return document;
				if (editShared) {
					Object.assign(item.presentation, values);
					for (const override of Object.values(item.variant_overrides ?? {})) {
						if (!override?.presentation) continue;
						for (const property of Object.keys(values) as Array<
							keyof VisualTrackItem['presentation']
						>) {
							delete override.presentation[property];
						}
						if (Object.keys(override.presentation).length === 0) {
							delete override.presentation;
						}
					}
				} else {
					item.variant_overrides = {
						...(item.variant_overrides ?? {}),
						[variantID]: {
							...(item.variant_overrides?.[variantID] ?? {}),
							presentation: {
								...(item.variant_overrides?.[variantID]?.presentation ?? {}),
								...values
							}
						}
					};
				}
				return document;
			},
			`visual:${itemID}:${variantID}:${Object.keys(values).join(',')}`
		);
	}

	function updateVisualPosition(itemID: string, positionX: number, positionY: number): void {
		updateVisualPresentation(
			itemID,
			{
				position_x: Math.max(0, Math.min(1, positionX)),
				position_y: Math.max(0, Math.min(1, positionY))
			},
			m.video_studio_inspector_position()
		);
	}

	function updateVisualTiming(
		property: 'timeline_start_us' | 'duration_us',
		seconds: number
	): void {
		if (!selectedVisualItemID) return;
		mutate(
			property === 'timeline_start_us'
				? m.video_studio_overlay_start()
				: m.video_studio_overlay_duration(),
			(document) => {
				const item = document.visual_tracks
					.flatMap((track) => track.items)
					.find((candidate) => candidate.id === selectedVisualItemID);
				if (!item) return document;
				const valueUS = Math.round(Math.max(0, seconds) * 1_000_000);
				if (property === 'duration_us') item.duration_us = Math.max(100_000, valueUS);
				else item.timeline_start_us = Math.min(projectDurationUS(document), valueUS);
				return document;
			},
			`visual:${selectedVisualItemID}:${property}`
		);
	}

	function updateVisualTimeline(itemID: string, startUS: number, durationUS: number): void {
		mutate(
			m.video_studio_edit_overlay(),
			(document) => {
				const item = document.visual_tracks
					.flatMap((track) => track.items)
					.find((candidate) => candidate.id === itemID);
				if (!item) return document;
				item.timeline_start_us = Math.max(0, Math.round(startUS));
				item.duration_us = Math.max(100_000, Math.round(durationUS));
				return document;
			},
			`visual:${itemID}:timeline`
		);
	}

	function updateVisualText(value: string): void {
		if (!selectedVisualItemID) return;
		mutate(
			m.video_studio_edit_overlay(),
			(document) => {
				const item = document.visual_tracks
					.flatMap((track) => track.items)
					.find((candidate) => candidate.id === selectedVisualItemID);
				if (item?.type === 'text') item.text = value.slice(0, 500);
				return document;
			},
			`visual:${selectedVisualItemID}:text`
		);
	}

	function updateVisualTextStyle(
		property: 'font_size' | 'color' | 'background_color' | 'align' | 'animation',
		value: number | string
	): void {
		if (!selectedVisualItemID) return;
		mutate(
			m.video_studio_edit_overlay(),
			(document) => {
				const item = document.visual_tracks
					.flatMap((track) => track.items)
					.find((candidate) => candidate.id === selectedVisualItemID);
				if (item?.type !== 'text') return document;
				if (property === 'font_size') item.style.font_size = Number(value);
				else if (property === 'align') item.style.align = value as 'left' | 'center' | 'right';
				else if (property === 'animation') {
					item.style.animation = value as 'none' | 'fade' | 'rise' | 'pop' | 'typewriter';
				} else item.style[property] = String(value);
				return document;
			},
			`visual:${selectedVisualItemID}:style:${property}`
		);
	}

	function updateVisualShapeStyle(
		property: 'kind' | 'fill' | 'stroke' | 'stroke_width',
		value: number | string
	): void {
		if (!selectedVisualItemID) return;
		mutate(
			m.video_studio_edit_overlay(),
			(document) => {
				const item = document.visual_tracks
					.flatMap((track) => track.items)
					.find((candidate) => candidate.id === selectedVisualItemID);
				if (item?.type !== 'shape' && item?.type !== 'annotation') return document;
				if (property === 'stroke_width') item.shape.stroke_width = Number(value);
				else if (property === 'kind') item.shape.kind = value as ShapeStyle['kind'];
				else item.shape[property] = String(value);
				return document;
			},
			`visual:${selectedVisualItemID}:shape:${property}`
		);
	}

	function toggleVisualVisibility(checked: boolean): void {
		if (!selectedVisualItemID) return;
		mutate(m.video_studio_overlay_visibility(), (document) => {
			const item = document.visual_tracks
				.flatMap((track) => track.items)
				.find((candidate) => candidate.id === selectedVisualItemID);
			if (!item) return document;
			if (editShared) {
				item.visible = checked;
				for (const override of Object.values(item.variant_overrides ?? {})) {
					if (override) delete override.visible;
				}
			} else {
				item.variant_overrides = {
					...(item.variant_overrides ?? {}),
					[variantID]: {
						...(item.variant_overrides?.[variantID] ?? {}),
						visible: checked
					}
				};
			}
			return document;
		});
	}

	function deleteSelectedVisual(): void {
		if (!selectedVisualItemID) return;
		const deletedID = selectedVisualItemID;
		mutate(m.video_studio_delete_overlay(), (document) => {
			for (const track of document.visual_tracks) {
				track.items = track.items.filter((item) => item.id !== deletedID);
			}
			return document;
		});
		selectedVisualItemID = '';
	}

	function updateSelectedAudio(
		property: 'timeline_start_us' | 'duration_us' | 'gain_db' | 'muted',
		value: number | boolean
	): void {
		if (!selectedAudioItemID) return;
		mutate(
			m.video_studio_edit_audio_item(),
			(document) => {
				const item = document.audio_tracks
					.flatMap((track) => track.items)
					.find((candidate) => candidate.id === selectedAudioItemID);
				if (!item) return document;
				if (property === 'muted') item.muted = Boolean(value);
				else if (property === 'gain_db') item.gain_db = Number(value);
				else if (property === 'duration_us') {
					item.duration_us = Math.max(100_000, Math.round(Number(value) * 1_000_000));
				} else {
					item.timeline_start_us = Math.max(0, Math.round(Number(value) * 1_000_000));
				}
				return document;
			},
			`audio:${selectedAudioItemID}:${property}`
		);
	}

	function updateAudioTimeline(itemID: string, startUS: number, durationUS: number): void {
		mutate(
			m.video_studio_edit_audio_item(),
			(document) => {
				const item = document.audio_tracks
					.flatMap((track) => track.items)
					.find((candidate) => candidate.id === itemID);
				if (!item) return document;
				item.timeline_start_us = Math.max(0, Math.round(startUS));
				item.duration_us = Math.max(100_000, Math.round(durationUS));
				return document;
			},
			`audio:${itemID}:timeline`
		);
	}

	function deleteSelectedAudio(): void {
		if (!selectedAudioItemID) return;
		const deletedID = selectedAudioItemID;
		mutate(m.video_studio_delete_audio_item(), (document) => {
			for (const track of document.audio_tracks) {
				track.items = track.items.filter((item) => item.id !== deletedID);
			}
			return document;
		});
		selectedAudioItemID = '';
	}

	function updateSelectedCaptionTiming(property: 'start_us' | 'end_us', seconds: number): void {
		if (!selectedCaptionCueID) return;
		mutate(
			m.video_studio_edit_caption(),
			(document) => {
				const cue = document.caption_tracks
					.flatMap((track) => track.cues)
					.find((candidate) => candidate.id === selectedCaptionCueID);
				if (!cue) return document;
				const valueUS = Math.max(0, Math.round(seconds * 1_000_000));
				if (property === 'start_us') cue.start_us = Math.min(cue.end_us - 50_000, valueUS);
				else cue.end_us = Math.max(cue.start_us + 50_000, valueUS);
				return document;
			},
			`caption:${selectedCaptionCueID}:${property}`
		);
	}

	function updateCaptionTimeline(cueID: string, startUS: number, endUS: number): void {
		mutate(
			m.video_studio_edit_caption(),
			(document) => {
				const cue = document.caption_tracks
					.flatMap((track) => track.cues)
					.find((candidate) => candidate.id === cueID);
				if (!cue) return document;
				const previousStart = cue.start_us;
				const nextStart = Math.max(0, Math.round(startUS));
				const nextEnd = Math.max(nextStart + 50_000, Math.round(endUS));
				const movedBy = nextStart - previousStart;
				const sameDuration = nextEnd - nextStart === cue.end_us - cue.start_us;
				cue.start_us = nextStart;
				cue.end_us = nextEnd;
				if (sameDuration && movedBy !== 0) {
					cue.words = cue.words.map((word) => ({
						...word,
						start_us: word.start_us + movedBy,
						end_us: word.end_us + movedBy
					}));
				}
				return document;
			},
			`caption:${cueID}:timeline`
		);
	}

	function addTimelineMarker(timeUS: number): string {
		const markerID = `marker_${crypto.randomUUID()}`;
		mutate(m.video_studio_add_marker(), (document) => {
			document.markers.push({
				id: markerID,
				time_us: Math.max(0, Math.min(projectDurationUS(document), Math.round(timeUS))),
				label: m.video_studio_marker_number({ number: document.markers.length + 1 }),
				color: '#f97316'
			});
			document.markers.sort((left, right) => left.time_us - right.time_us);
			return document;
		});
		return markerID;
	}

	function updateTimelineMarker(
		markerID: string,
		values: { time_us?: number; label?: string }
	): void {
		mutate(
			m.video_studio_edit_marker(),
			(document) => {
				const marker = document.markers.find((candidate) => candidate.id === markerID);
				if (!marker) return document;
				if (values.time_us !== undefined) {
					marker.time_us = Math.max(
						0,
						Math.min(projectDurationUS(document), Math.round(values.time_us))
					);
				}
				if (values.label !== undefined) {
					marker.label = values.label.trim().slice(0, 200) || m.video_studio_marker();
				}
				document.markers.sort((left, right) => left.time_us - right.time_us);
				return document;
			},
			`marker:${markerID}`
		);
	}

	function deleteTimelineMarker(markerID: string): void {
		mutate(m.video_studio_delete_marker(), (document) => {
			document.markers = document.markers.filter((marker) => marker.id !== markerID);
			return document;
		});
	}

	function deleteSelectedCaption(): void {
		if (!selectedCaptionCueID) return;
		const deletedID = selectedCaptionCueID;
		mutate(m.video_studio_delete_caption(), (document) => {
			for (const track of document.caption_tracks) {
				track.cues = track.cues.filter((cue) => cue.id !== deletedID);
			}
			return document;
		});
		selectedCaptionCueID = '';
	}

	function applyGuidedFocusKeyframes(): void {
		if (!selectedClip || !selectedDerived || !selectedPresentation) return;
		const localTimeUS = Math.max(
			0,
			Math.min(selectedDerived.duration_us, playheadUS - selectedDerived.timeline_start_us)
		);
		const startUS = Math.max(0, localTimeUS - 300_000);
		const endUS = Math.min(selectedDerived.duration_us, localTimeUS + 1_200_000);
		const baseScale = selectedPresentation.scale;
		const keyframes = {
			...(selectedPresentation.keyframes ?? {}),
			scale: [
				{ time_us: startUS, value: baseScale, easing: 'focus-spring' as const },
				{
					time_us: Math.min(endUS, startUS + 320_000),
					value: Math.min(4, baseScale * 1.18),
					easing: 'focus-spring' as const
				},
				{ time_us: endUS, value: baseScale, easing: 'ease-out' as const }
			]
		};
		mutate(m.video_studio_add_focus_keyframes(), (document) => {
			const clip = primaryClipByID(document, selectedClipID);
			if (!clip) return document;
			if (editShared) clip.video.keyframes = keyframes;
			else {
				return setVariantPresentationOverride(document, selectedClipID, variantID, { keyframes });
			}
			return document;
		});
	}

	function updateSpeed(value: number): void {
		if (!selectedClipID || !localProject) return;
		mutate(
			m.video_studio_clip_speed(),
			(document) => setClipSpeed(document, selectedClipID, value),
			`${selectedClipID}:speed`
		);
	}

	function updateMute(checked: boolean): void {
		mutate(m.video_studio_mute_clip(), (document) => {
			const clip = primaryClipByID(document, selectedClipID);
			if (clip) clip.audio.muted = checked;
			return document;
		});
	}

	function updateClipAudioTiming(property: 'fade_in_us' | 'fade_out_us', seconds: number): void {
		mutate(
			property === 'fade_in_us' ? m.video_studio_fade_in() : m.video_studio_fade_out(),
			(document) => {
				const clip = primaryClipByID(document, selectedClipID);
				if (clip) clip.audio[property] = Math.round(seconds * 1_000_000);
				return document;
			},
			`${selectedClipID}:${property}`
		);
	}

	function clipEffectValue(type: VideoEffect['type']): number {
		return selectedClip?.effects.find((effect) => effect.type === type)?.value ?? 0;
	}

	function updateClipEffect(type: VideoEffect['type'], value: number): void {
		mutate(
			m.video_studio_change_effect({ effect: type }),
			(document) => {
				const clip = primaryClipByID(document, selectedClipID);
				if (!clip) return document;
				const index = clip.effects.findIndex((effect) => effect.type === type);
				if (Math.abs(value) < 0.001) {
					if (index >= 0) clip.effects.splice(index, 1);
					return document;
				}
				const effect = { type, value } as VideoEffect;
				if (index >= 0) clip.effects[index] = effect;
				else clip.effects.push(effect);
				return document;
			},
			`${selectedClipID}:effect:${type}`
		);
	}

	function setTransition(value: string): void {
		mutate(m.video_studio_transition(), (document) => {
			const index = document.primary_sequence.findIndex((clip) => clip.id === selectedClipID);
			if (index < 0) return document;
			const clip = document.primary_sequence[index]!;
			if (!isPrimarySequenceClip(clip)) return document;
			const nextClip = document.primary_sequence[index + 1];
			if (value === 'cut') {
				delete clip.transition_out;
				if (nextClip && isPrimarySequenceClip(nextClip)) {
					delete nextClip.transition_in;
				}
			} else {
				const transition = {
					type: value as TransitionKind,
					duration_us: 350_000,
					easing: 'ease-in-out' as const
				};
				clip.transition_out = transition;
				if (nextClip && isPrimarySequenceClip(nextClip)) {
					nextClip.transition_in = { ...transition };
				}
			}
			return document;
		});
	}

	async function importFiles(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!localProject || files.length === 0 || importBusy) return;
		importBusy = true;
		error = '';
		try {
			const draft = { ...localProject, document: cloneVideoProject(localProject.document) };
			for (const file of files) {
				const source = await addFileToProject(draft, file);
				if (source.kind === 'image' || source.kind === 'audio') {
					insertSourceIntoTimeline(draft.document, source);
				}
			}
			localProject = draft;
			selectedClipID ||= draft.document.primary_sequence[0]?.id ?? '';
			mutationVersion += 1;
			await flushAutosave();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_import_error();
		} finally {
			importBusy = false;
		}
	}

	async function addStock(file: File, asset: StockAsset): Promise<void> {
		if (!localProject) return;
		const draft = { ...localProject, document: cloneVideoProject(localProject.document) };
		const source = await addFileToProject(draft, file, undefined, {
			addToPrimary: file.type.startsWith('video/'),
			provenance: {
				provider: asset.provider,
				external_id: asset.external_id,
				source_url: asset.source_url,
				creator_name: asset.creator_name,
				creator_url: asset.creator_url,
				license_name: asset.license_name,
				license_url: asset.license_url,
				attribution_text: asset.attribution_text
			}
		});
		if (source.kind === 'image' || source.kind === 'audio') {
			insertSourceIntoTimeline(draft.document, source);
		}
		localProject = draft;
		mutationVersion += 1;
		await flushAutosave();
	}

	function insertSourceIntoTimeline(document: VideoProjectDocumentV1, source: VideoSource): void {
		if (
			source.kind === 'audio' ||
			source.kind === 'recording-microphone' ||
			source.kind === 'recording-system-audio'
		) {
			let track = document.audio_tracks.find((item) => item.id === 'imported-audio');
			if (!track) {
				if (document.audio_tracks.length >= 8) throw new Error(m.video_studio_audio_track_limit());
				track = {
					id: 'imported-audio',
					name: m.video_studio_imported_audio(),
					role: 'music',
					muted: false,
					items: []
				};
				document.audio_tracks.push(track);
			}
			track.items.push({
				id: `audio_${crypto.randomUUID()}`,
				source_id: source.id,
				timeline_start_us: playheadUS,
				source_in_us: 0,
				duration_us: source.duration_us,
				speed: 1,
				gain_db: 0,
				fade_in_us: 0,
				fade_out_us: 0,
				muted: false,
				duck_others: false
			});
			return;
		}
		if (source.kind === 'image' || source.kind === 'recording-camera') {
			let track = document.visual_tracks.find((item) => item.id === 'imported-overlays');
			if (!track) {
				if (document.visual_tracks.length >= 4)
					throw new Error(m.video_studio_visual_track_limit());
				track = {
					id: 'imported-overlays',
					name: m.video_studio_overlays(),
					locked: false,
					hidden: false,
					items: []
				};
				document.visual_tracks.push(track);
			}
			track.items.push({
				id: `overlay_${crypto.randomUUID()}`,
				type: source.kind === 'recording-camera' ? 'camera' : 'media',
				source_id: source.id,
				source_in_us: 0,
				timeline_start_us: playheadUS,
				duration_us: source.duration_us || 5_000_000,
				speed: 1,
				visible: true,
				presentation: {
					...defaultVideoPresentation(),
					scale: source.kind === 'recording-camera' ? 0.28 : 0.45,
					position_x: source.kind === 'recording-camera' ? 0.8 : 0.5,
					position_y: source.kind === 'recording-camera' ? 0.78 : 0.5,
					corner_radius: source.kind === 'recording-camera' ? 0.08 : 0
				}
			});
			return;
		}
		if (source.kind === 'video' || source.kind === 'recording-screen') {
			document.primary_sequence.push({
				id: `clip_${crypto.randomUUID()}`,
				source_id: source.id,
				mode: 'source',
				source_in_us: 0,
				source_out_us: source.duration_us,
				speed: 1,
				video: defaultVideoPresentation(),
				audio: defaultClipAudio(),
				effects: []
			});
		}
	}

	function addSourceToTimeline(sourceID: string): void {
		mutate(m.video_studio_add_to_timeline(), (document) => {
			const source = document.sources[sourceID];
			if (source) insertSourceIntoTimeline(document, source);
			return document;
		});
	}

	function applyCameraPreset(
		preset: 'circle' | 'rounded' | 'portrait' | 'side-by-side' | 'full'
	): void {
		const values = {
			circle: {
				position_x: 0.82,
				position_y: 0.78,
				scale: 0.24,
				corner_radius: 0.5
			},
			rounded: {
				position_x: 0.8,
				position_y: 0.76,
				scale: 0.3,
				corner_radius: 0.08
			},
			portrait: {
				position_x: 0.78,
				position_y: 0.5,
				scale: 0.36,
				corner_radius: 0.06
			},
			'side-by-side': {
				position_x: 0.74,
				position_y: 0.5,
				scale: 0.48,
				corner_radius: 0.03
			},
			full: {
				position_x: 0.5,
				position_y: 0.5,
				scale: 1,
				corner_radius: 0
			}
		}[preset];
		mutate(m.video_studio_camera_layout(), (document) => {
			for (const track of document.visual_tracks) {
				for (const item of track.items) {
					if (item.type !== 'camera') continue;
					if (cameraPresetVariantOnly) {
						item.variant_overrides = {
							...(item.variant_overrides ?? {}),
							[variantID]: {
								...(item.variant_overrides?.[variantID] ?? {}),
								presentation: {
									...(item.variant_overrides?.[variantID]?.presentation ?? {}),
									...values
								}
							}
						};
					} else {
						Object.assign(item.presentation, values);
					}
				}
			}
			return document;
		});
	}

	async function normalizeProjectAudio(): Promise<void> {
		if (!project || audioNormalizeBusy) return;
		audioNormalizeBusy = true;
		audioNormalizeProgress = 0;
		error = '';
		try {
			const adjustments = await measureVideoProjectLoudness(cloneVideoProject(project), {
				projectID: localProject?.id,
				targetLUFS: -14,
				onProgress: (progress) => (audioNormalizeProgress = progress)
			});
			if (adjustments.length === 0) {
				throw new Error(m.video_studio_normalize_no_audio());
			}
			mutate(m.video_studio_normalize_audio(), (document) => {
				for (const adjustment of adjustments) {
					if (adjustment.kind === 'primary') {
						const clip = primaryClipByID(document, adjustment.item_id);
						if (clip) clip.audio.gain_db = adjustment.gain_db;
					} else {
						const item = document.audio_tracks
							.flatMap((track) => track.items)
							.find((candidate) => candidate.id === adjustment.item_id);
						if (item) item.gain_db = adjustment.gain_db;
					}
				}
				return document;
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_normalize_failed();
		} finally {
			audioNormalizeBusy = false;
			audioNormalizeProgress = 0;
		}
	}

	async function addBundledAudio(item: BundledAudioItem): Promise<void> {
		if (!localProject || audioPackBusy) return;
		audioPackBusy = item.id;
		error = '';
		try {
			const file = await loadBundledAudio(item);
			const draft = { ...localProject, document: cloneVideoProject(localProject.document) };
			const source = await addFileToProject(draft, file, undefined, { addToPrimary: false });
			insertSourceIntoTimeline(draft.document, source);
			localProject = draft;
			mutationVersion += 1;
			await flushAutosave();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_audio_pack_failed();
		} finally {
			audioPackBusy = '';
		}
	}

	function addText(
		brandStyle?: StudioBrandTextStyle,
		localStyle?: LocalVideoTextStyle['style']
	): void {
		const itemID = `text_${crypto.randomUUID()}`;
		mutate(m.video_studio_add_text(), (document) => {
			const track = firstVisualTrack(document);
			track.items.push({
				id: itemID,
				type: 'text',
				text: m.video_studio_text_default(),
				timeline_start_us: playheadUS,
				duration_us: Math.min(
					5_000_000,
					Math.max(1_000_000, projectDurationUS(document) - playheadUS)
				),
				visible: true,
				style: {
					font_family: localStyle?.font_family || brandStyle?.font_family || 'Geist Variable',
					font_size: Math.max(
						24,
						Math.min(140, localStyle?.font_size ?? brandStyle?.font_size ?? 72)
					),
					font_weight: localStyle?.font_weight ?? brandStyle?.font_weight ?? 700,
					color: localStyle?.color ?? brandStyle?.color ?? '#ffffff',
					align: localStyle?.align ?? 'center',
					background_color: localStyle?.background_color ?? '#00000000',
					outline_color: localStyle?.outline_color ?? '#000000',
					outline_width: localStyle?.outline_width ?? 0,
					shadow_blur: localStyle?.shadow_blur ?? 12,
					animation: localStyle?.animation ?? 'rise'
				},
				presentation: defaultOverlayPresentation()
			});
			return document;
		});
		selectVisualItem(itemID);
	}

	function saveSelectedTextStyle(): void {
		const item = project?.visual_tracks
			.flatMap((track) => track.items)
			.find(
				(candidate): candidate is TextOverlay =>
					candidate.id === selectedVisualItemID && candidate.type === 'text'
			);
		if (!item) return;
		localTextStyles = [
			...localTextStyles,
			{
				id: crypto.randomUUID(),
				name: m.video_studio_local_style_number({ number: localTextStyles.length + 1 }),
				style: structuredClone(item.style)
			}
		].slice(-12);
		localStorage.setItem('openpost-video-studio-text-styles', JSON.stringify(localTextStyles));
	}

	function applyBrandColor(color: string): void {
		if (!selectedVisualItemID) return;
		mutate(m.video_studio_apply_brand_color(), (document) => {
			const item = document.visual_tracks
				.flatMap((track) => track.items)
				.find((candidate) => candidate.id === selectedVisualItemID);
			if (item?.type === 'text') item.style.color = color;
			else if (item?.type === 'shape' || item?.type === 'annotation') item.shape.stroke = color;
			return document;
		});
	}

	function addShape(kind: ShapeStyle['kind']): void {
		const itemID = `shape_${crypto.randomUUID()}`;
		mutate(m.video_studio_add_shape(), (document) => {
			const track = firstVisualTrack(document);
			track.items.push({
				id: itemID,
				type: 'annotation',
				timeline_start_us: playheadUS,
				duration_us: kind === 'click-pulse' ? 900_000 : 3_000_000,
				visible: true,
				shape: {
					kind,
					fill:
						kind === 'redaction'
							? '#111111ee'
							: kind === 'highlight'
								? '#fde04744'
								: kind === 'arrow'
									? '#00000000'
									: kind === 'rectangle' || kind === 'ellipse'
										? '#fb923c22'
										: '#fb923c',
					stroke: kind === 'highlight' ? '#fde047' : '#fb923c',
					stroke_width: 4,
					blur: 0
				},
				presentation: {
					...defaultOverlayPresentation(),
					scale: kind === 'progress' ? 0.8 : 0.24,
					position_y: kind === 'progress' ? 0.9 : 0.5
				}
			});
			return document;
		});
		selectVisualItem(itemID);
	}

	function addCaption(): void {
		const cueID = `cue_${crypto.randomUUID()}`;
		mutate(m.video_studio_add_caption(), (document) => {
			document.caption_tracks[0] ??= {
				id: `captions_${crypto.randomUUID()}`,
				name: m.video_studio_tool_captions(),
				language: 'und',
				visible: true,
				style: {
					preset: 'clean',
					font_family: 'Geist Variable',
					font_size: 58,
					font_weight: 700,
					color: '#ffffff',
					emphasis_color: '#fb923c',
					background_color: '#000000b8',
					position: 'bottom',
					max_lines: 2
				},
				cues: []
			};
			document.caption_tracks[0].cues.push({
				id: cueID,
				start_us: playheadUS,
				end_us: playheadUS + 2_000_000,
				text: m.video_studio_caption_default(),
				words: [
					{
						text: m.video_studio_caption_default(),
						start_us: playheadUS,
						end_us: playheadUS + 2_000_000
					}
				]
			});
			return document;
		});
		selectCaptionCue(cueID);
	}

	async function requestAnalysis(kind: 'transcript' | 'silence'): Promise<void> {
		if (!videoStudioConfig || analysisBusy) return;
		const cached = await cachedVideoStudioModels();
		const modelID = kind === 'transcript' ? 'whisper-tiny-multilingual' : 'silero-vad';
		if (!cached.some((item) => item.id === modelID)) {
			pendingAnalysis = kind;
			modelConsentOpen = true;
			return;
		}
		await runAnalysis(kind);
	}

	async function consentAndRunAnalysis(): Promise<void> {
		const kind = pendingAnalysis;
		modelConsentOpen = false;
		pendingAnalysis = null;
		if (kind) await runAnalysis(kind);
	}

	async function runAnalysis(kind: 'transcript' | 'silence'): Promise<void> {
		if (!localProject || !videoStudioConfig || analysisBusy) return;
		analysisBusy = true;
		analysisProgress = null;
		error = '';
		analysisController = new AbortController();
		try {
			if (kind === 'transcript') {
				transcriptAnalysis = await transcribeVideoProject(
					localProject.id,
					cloneVideoProject(localProject.document),
					videoStudioConfig,
					{
						language: transcriptLanguage,
						onProgress: (progress) => (analysisProgress = progress),
						signal: analysisController.signal
					}
				);
				selectedFillers = transcriptAnalysis.fillers.map(
					(item) => `${item.start_us}:${item.end_us}`
				);
			} else {
				silenceAnalysis = await detectVideoProjectSilence(
					localProject.id,
					cloneVideoProject(localProject.document),
					videoStudioConfig,
					{
						onProgress: (progress) => (analysisProgress = progress),
						signal: analysisController.signal
					}
				);
				selectedSilences = silenceAnalysis.silences.map(
					(item) => `${item.start_us}:${item.end_us}`
				);
			}
		} catch (cause) {
			recordFailure(cause, `analysis.${kind}`);
			if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
				error = cause instanceof Error ? cause.message : m.video_studio_analysis_failed();
			}
		} finally {
			analysisBusy = false;
			analysisController = null;
		}
	}

	function applyTranscript(): void {
		if (!transcriptAnalysis) return;
		mutate(m.video_studio_apply_transcript(), (document) => {
			document.caption_tracks[0] = {
				id: document.caption_tracks[0]?.id ?? `captions_${crypto.randomUUID()}`,
				name: m.video_studio_tool_captions(),
				language: transcriptAnalysis?.language ?? 'und',
				visible: true,
				style: document.caption_tracks[0]?.style ?? {
					preset: 'bold',
					font_family: 'Geist Variable',
					font_size: 58,
					font_weight: 700,
					color: '#ffffff',
					emphasis_color: '#fb923c',
					background_color: '#000000b8',
					position: 'bottom',
					max_lines: 2
				},
				cues: transcriptAnalysis?.cues.map((cue) => structuredClone(cue)) ?? []
			};
			return document;
		});
	}

	function updateCaptionCue(cueID: string, value: string): void {
		mutate(
			m.video_studio_edit_caption(),
			(document) => {
				const cue = document.caption_tracks
					.flatMap((track) => track.cues)
					.find((item) => item.id === cueID);
				if (cue) setCaptionCueText(cue, value.slice(0, 500));
				return document;
			},
			`caption:${cueID}`
		);
	}

	function replaceCaptionText(): void {
		const search = captionSearch.trim();
		if (!search) return;
		mutate(m.video_studio_replace_caption(), (document) => {
			for (const cue of document.caption_tracks.flatMap((track) => track.cues)) {
				setCaptionCueText(cue, cue.text.split(search).join(captionReplacement).slice(0, 500));
			}
			return document;
		});
	}

	function downloadCaptions(format: 'srt' | 'vtt'): void {
		const cues = project?.caption_tracks.flatMap((track) => track.cues) ?? [];
		if (cues.length === 0) return;
		const content = format === 'srt' ? captionsToSRT(cues) : captionsToWebVTT(cues);
		const blob = new Blob([content], {
			type: format === 'srt' ? 'application/x-subrip;charset=utf-8' : 'text/vtt;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		const baseName =
			project?.title
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/gu, '-')
				.replace(/^-+|-+$/gu, '') || 'openpost-video';
		anchor.href = url;
		anchor.download = `${baseName}.${format}`;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	function rippleDeleteCue(cue: CaptionCue): void {
		mutate(m.video_studio_ripple_caption(), (document) =>
			removePrimaryRanges(document, [
				{
					start_us: Math.max(0, cue.start_us - 80_000),
					end_us: Math.min(projectDurationUS(document), cue.end_us + 80_000)
				}
			])
		);
	}

	function applySelectedSilences(): void {
		if (!silenceAnalysis) return;
		const ranges = silenceAnalysis.silences.filter((item) =>
			selectedSilences.includes(`${item.start_us}:${item.end_us}`)
		);
		if (ranges.length === 0) return;
		mutate(m.video_studio_apply_silences(), (document) =>
			removePrimaryRanges(
				document,
				ranges.map((range) => ({ start_us: range.start_us, end_us: range.end_us }))
			)
		);
		silenceAnalysis = null;
		selectedSilences = [];
	}

	function applySelectedFillers(): void {
		if (!transcriptAnalysis) return;
		const ranges = transcriptAnalysis.fillers.filter((item) =>
			selectedFillers.includes(`${item.start_us}:${item.end_us}`)
		);
		if (ranges.length === 0) return;
		mutate(m.video_studio_apply_fillers(), (document) =>
			removePrimaryRanges(
				document,
				ranges.map((range) => ({
					start_us: Math.max(0, range.start_us - 80_000),
					end_us: Math.min(projectDurationUS(document), range.end_us + 80_000)
				}))
			)
		);
		selectedFillers = [];
	}

	async function runSmartFraming(): Promise<void> {
		if (!project || smartBusy) return;
		smartBusy = true;
		smartProgress = 0;
		error = '';
		try {
			smartResult = await analyzeSmartFraming(cloneVideoProject(project), variantID, {
				projectID: localProject?.id,
				onProgress: (fraction) => (smartProgress = fraction)
			});
			selectedFocusZooms = smartResult.focus_zooms.map((item) => item.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_smart_failed();
		} finally {
			smartBusy = false;
		}
	}

	function applyReframes(): void {
		if (!smartResult) return;
		mutate(m.video_studio_apply_reframes(), (document) => {
			let next = document;
			for (const suggestion of smartResult?.reframes ?? []) {
				next = setVariantPresentationOverride(next, suggestion.clip_id, suggestion.variant_id, {
					crop: suggestion.crop
				});
			}
			return next;
		});
	}

	function applyFocusZooms(): void {
		if (!smartResult) return;
		mutate(m.video_studio_apply_focus_zooms(), (document) => {
			const derived = derivePrimarySequence(document);
			let next = document;
			for (const suggestion of smartResult?.focus_zooms ?? []) {
				if (!selectedFocusZooms.includes(suggestion.id)) continue;
				const timing = derived.find((item) => item.clip_id === suggestion.clip_id);
				const clip = primaryClipByID(next, suggestion.clip_id);
				if (!timing || !clip) continue;
				const localStart = Math.max(0, suggestion.time_us - timing.timeline_start_us);
				const localEnd = Math.min(timing.duration_us, localStart + suggestion.duration_us);
				const zoom = 1.18;
				const positionX = Math.max(
					0.35,
					Math.min(0.65, 0.5 + (0.5 - suggestion.focus_x) * (zoom - 1))
				);
				const positionY = Math.max(
					0.35,
					Math.min(0.65, 0.5 + (0.5 - suggestion.focus_y) * (zoom - 1))
				);
				const existing = clip.variant_overrides?.[variantID]?.keyframes ?? {};
				next = setVariantPresentationOverride(next, clip.id, variantID, {
					keyframes: {
						...existing,
						scale: [
							...(existing.scale ?? []),
							{ time_us: localStart, value: 1, easing: 'focus-spring' as const },
							{
								time_us: Math.min(localEnd, localStart + 320_000),
								value: zoom,
								easing: 'focus-spring' as const
							},
							{
								time_us: Math.max(localStart, localEnd - 320_000),
								value: zoom,
								easing: 'ease-in-out' as const
							},
							{ time_us: localEnd, value: 1, easing: 'ease-out' as const }
						].sort((left, right) => left.time_us - right.time_us),
						position_x: [
							...(existing.position_x ?? []),
							{ time_us: localStart, value: 0.5, easing: 'focus-spring' as const },
							{
								time_us: Math.min(localEnd, localStart + 320_000),
								value: positionX,
								easing: 'focus-spring' as const
							},
							{ time_us: localEnd, value: 0.5, easing: 'ease-out' as const }
						].sort((left, right) => left.time_us - right.time_us),
						position_y: [
							...(existing.position_y ?? []),
							{ time_us: localStart, value: 0.5, easing: 'focus-spring' as const },
							{
								time_us: Math.min(localEnd, localStart + 320_000),
								value: positionY,
								easing: 'focus-spring' as const
							},
							{ time_us: localEnd, value: 0.5, easing: 'ease-out' as const }
						].sort((left, right) => left.time_us - right.time_us)
					}
				});
			}
			return next;
		});
	}

	async function startScreenRecording(): Promise<void> {
		if (!localProject || recordBusy || recordingSession) return;
		recordBusy = true;
		error = '';
		try {
			await prepareRecordingStorage();
			recordingKind = 'screen';
			recordingSession = await VideoRecordingSession.start({
				projectID: localProject.id,
				timelineOffsetUS: durationUS,
				camera: recordCamera,
				microphone: recordMicrophone,
				systemAudio: recordSystemAudio,
				countdownSeconds: 3,
				onCountdown: (remaining) => (recordCountdown = remaining),
				onState: (state) => (recordingState = state)
			});
			await refreshRecordingDevices();
		} catch (cause) {
			recordFailure(cause, 'capture.screen');
			recordingKind = null;
			error =
				cause instanceof DOMException && cause.name === 'NotAllowedError'
					? m.video_studio_recording_cancelled()
					: cause instanceof Error
						? cause.message
						: m.video_studio_recording_failed();
		} finally {
			recordCountdown = 0;
			recordBusy = false;
		}
	}

	async function startVoiceover(): Promise<void> {
		if (!localProject || recordBusy || recordingSession) return;
		recordBusy = true;
		error = '';
		try {
			await prepareRecordingStorage();
			recordingKind = 'voiceover';
			recordingSession = await VideoRecordingSession.startVoiceover({
				projectID: localProject.id,
				timelineOffsetUS: playheadUS,
				onState: (state) => (recordingState = state)
			});
			await refreshRecordingDevices();
		} catch (cause) {
			recordingKind = null;
			error =
				cause instanceof DOMException && cause.name === 'NotAllowedError'
					? m.video_studio_recording_cancelled()
					: cause instanceof Error
						? cause.message
						: m.video_studio_recording_failed();
		} finally {
			recordBusy = false;
		}
	}

	async function refreshRecordingDevices(): Promise<void> {
		if (!navigator.mediaDevices?.enumerateDevices) return;
		recordingDevices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
		recordingCameraDeviceID ||=
			recordingDevices.find((device) => device.kind === 'videoinput')?.deviceId ?? '';
		recordingMicrophoneDeviceID ||=
			recordingDevices.find((device) => device.kind === 'audioinput')?.deviceId ?? '';
	}

	async function switchEditorRecordingInput(
		kind: 'camera' | 'microphone',
		deviceID: string
	): Promise<void> {
		if (!recordingSession || !deviceID || switchingRecordingDevice) return;
		switchingRecordingDevice = kind;
		error = '';
		try {
			await recordingSession.switchInput(kind, deviceID);
			if (kind === 'camera') recordingCameraDeviceID = deviceID;
			else recordingMicrophoneDeviceID = deviceID;
			await refreshRecordingDevices();
		} catch (cause) {
			recordFailure(cause, `capture.switch.${kind}`);
			error = cause instanceof Error ? cause.message : m.video_studio_device_switch_failed();
		} finally {
			switchingRecordingDevice = null;
		}
	}

	async function stopEditorRecording(): Promise<void> {
		if (!localProject || !recordingSession || recordBusy || switchingRecordingDevice) return;
		recordBusy = true;
		try {
			const manifest = await recordingSession.stop();
			const draft = { ...localProject, document: cloneVideoProject(localProject.document) };
			await addRecordingToProject(draft, manifest);
			localProject = draft;
			selectedClipID ||= draft.document.primary_sequence.at(-1)?.id ?? '';
			mutationVersion += 1;
			await flushAutosave();
			await deleteRecordingManifest(manifest.id);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_recording_failed();
		} finally {
			recordingSession = null;
			recordingKind = null;
			recordingState = null;
			recordingDevices = [];
			recordingCameraDeviceID = '';
			recordingMicrophoneDeviceID = '';
			switchingRecordingDevice = null;
			recordBusy = false;
		}
	}

	async function prepareRecordingStorage(): Promise<void> {
		await requestPersistentVideoStorage();
		const budget = await estimateStorageBudget(200 * 1024 * 1024);
		if (!budget.can_continue) {
			throw new Error(
				m.video_studio_recording_space({
					available: formatBytes(budget.available_bytes)
				})
			);
		}
	}

	function togglePlayback(): void {
		if (playing) {
			playing = false;
			cancelAnimationFrame(playbackFrame);
			return;
		}
		if (!durationUS) return;
		if (playheadUS >= durationUS) playheadUS = 0;
		playing = true;
		playbackStartedAt = performance.now();
		playbackStartUS = playheadUS;
		playbackFrame = requestAnimationFrame(advancePlayback);
	}

	function advancePlayback(now: number): void {
		if (!playing) return;
		playheadUS = Math.min(
			durationUS,
			playbackStartUS + Math.round((now - playbackStartedAt) * 1_000)
		);
		if (playheadUS >= durationUS) {
			playing = false;
			return;
		}
		playbackFrame = requestAnimationFrame(advancePlayback);
	}

	function handleKeyboard(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		if (target?.matches('input, textarea, [contenteditable="true"]')) return;
		if (event.key === ' ' && !event.metaKey && !event.ctrlKey) {
			event.preventDefault();
			togglePlayback();
		} else if (event.key.toLowerCase() === 's' && !event.metaKey && !event.ctrlKey) {
			event.preventDefault();
			splitSelected();
		} else if (event.key === 'Delete' && event.shiftKey) {
			event.preventDefault();
			if (selectedClipID) rippleDeleteSelected();
			else if (selectedCaptionCue) rippleDeleteCue(selectedCaptionCue);
		} else if (event.key === 'Delete') {
			if (selectedClip) {
				event.preventDefault();
				leaveGapSelected();
			} else if (selectedVisualItemID || selectedAudioItemID || selectedCaptionCueID) {
				event.preventDefault();
				if (selectedVisualItemID) deleteSelectedVisual();
				else if (selectedAudioItemID) deleteSelectedAudio();
				else deleteSelectedCaption();
			}
		} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		} else if (
			['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
			(event.metaKey || event.ctrlKey) &&
			(selectedClip || selectedVisualItem)
		) {
			event.preventDefault();
			const amount = event.shiftKey ? 0.05 : 0.01;
			const presentation = selectedClip ? selectedPresentation : selectedVisualPresentation;
			const x =
				presentation!.position_x +
				(event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0);
			const y =
				presentation!.position_y +
				(event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0);
			if (selectedClip) updateClipPosition(x, y);
			else updateVisualPosition(selectedVisualItemID, x, y);
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			if (event.altKey) {
				moveSelectedClip(event.key === 'ArrowLeft' ? -1 : 1);
				return;
			}
			const direction = event.key === 'ArrowLeft' ? -1 : 1;
			const frameUS = Math.round(
				(1_000_000 * (project?.timebase.fps_denominator ?? 1)) /
					(project?.timebase.fps_numerator ?? 30)
			);
			playheadUS = Math.max(
				0,
				Math.min(durationUS, playheadUS + direction * frameUS * (event.shiftKey ? 10 : 1))
			);
		}
	}

	async function recoverRecording(): Promise<void> {
		if (!localProject || !recoverableRecording) return;
		const original = recoverableRecording;
		const recovery = await recoverVerifiedRecording(original);
		const draft = { ...localProject, document: cloneVideoProject(localProject.document) };
		await addRecordingToProject(draft, recovery.manifest);
		localProject = draft;
		mutationVersion += 1;
		await flushAutosave();
		await deleteRecording(original);
		recoverableRecording = null;
	}

	async function discardRecording(): Promise<void> {
		if (!recoverableRecording) return;
		await deleteRecording(recoverableRecording);
		recoverableRecording = null;
	}

	async function cloudAction(): Promise<void> {
		if (!authState.isAuthenticated) {
			const returnPath = page.url.pathname;
			await goto(resolve(`/register?redirect=${encodeURIComponent(returnPath)}` as '/'));
			return;
		}
		try {
			await workspaceCtx.initialize();
			if (!workspaceCtx.currentWorkspace) {
				await goto(resolve(`/onboarding?redirect=${encodeURIComponent(page.url.pathname)}` as '/'));
				return;
			}
			cloudOpen = true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_save_failed();
		}
	}

	async function saveToCloud(): Promise<void> {
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!localProject || !workspaceID || cloudBusy) return;
		cloudBusy = true;
		cloudProgress = null;
		error = '';
		try {
			await flushAutosave();
			localProject = await syncVideoProjectToOpenPost(
				localProject,
				workspaceID,
				(progress) => (cloudProgress = progress)
			);
			cloudOpen = false;
		} catch (cause) {
			if (cause instanceof VideoProjectRevisionConflict) {
				cloudOpen = false;
				cloudConflictOpen = true;
			} else {
				error = cause instanceof Error ? cause.message : m.video_studio_save_failed();
			}
		} finally {
			cloudBusy = false;
		}
	}

	async function openRevisionHistory(): Promise<void> {
		if (!localProject) return;
		revisionOpen = true;
		revisionBusy = true;
		error = '';
		try {
			localRevisions = await listProjectRevisions(localProject.id);
			cloudRevisions = localProject.cloud_project_id
				? await listCloudVideoProjectRevisions(localProject.cloud_project_id)
				: [];
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_history_failed();
		} finally {
			revisionBusy = false;
		}
	}

	async function createNamedCheckpoint(): Promise<void> {
		const name = checkpointName.trim();
		if (!localProject || !name || revisionBusy) return;
		revisionBusy = true;
		error = '';
		try {
			let saved = await saveLocalVideoProject(localProject, { checkpointName: name });
			if (saved.cloud_project_id && workspaceCtx.currentWorkspace?.id) {
				saved = await syncVideoProjectToOpenPost(
					saved,
					workspaceCtx.currentWorkspace.id,
					undefined
				);
				await createCloudVideoProjectCheckpoint(saved.cloud_project_id!, name);
			}
			localProject = saved;
			checkpointName = '';
			localRevisions = await listProjectRevisions(saved.id);
			cloudRevisions = saved.cloud_project_id
				? await listCloudVideoProjectRevisions(saved.cloud_project_id)
				: [];
		} catch (cause) {
			if (cause instanceof VideoProjectRevisionConflict) {
				revisionOpen = false;
				cloudConflictOpen = true;
			} else {
				error = cause instanceof Error ? cause.message : m.video_studio_checkpoint_failed();
			}
		} finally {
			revisionBusy = false;
		}
	}

	async function restoreLocalProjectRevision(revisionID: string): Promise<void> {
		if (!localProject || revisionBusy) return;
		revisionBusy = true;
		try {
			localProject = await restoreLocalRevision(localProject.id, revisionID);
			history.clear();
			historyVersion += 1;
			revisionOpen = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_restore_failed();
		} finally {
			revisionBusy = false;
		}
	}

	async function restoreCloudRevision(revisionID: string): Promise<void> {
		if (!localProject?.cloud_project_id || !localProject.cloud_revision || revisionBusy) return;
		revisionBusy = true;
		try {
			const response = await restoreCloudVideoProjectRevision(
				localProject.cloud_project_id,
				revisionID,
				localProject.cloud_revision
			);
			const restored = localDocumentFromCloudResponse(response.document);
			localProject = await saveLocalVideoProject({
				...localProject,
				document: restored,
				cloud_revision: response.revision,
				state: 'cloud'
			});
			history.clear();
			historyVersion += 1;
			revisionOpen = false;
		} catch (cause) {
			if (cause instanceof VideoProjectRevisionConflict) {
				revisionOpen = false;
				cloudConflictOpen = true;
			} else {
				error = cause instanceof Error ? cause.message : m.video_studio_restore_failed();
			}
		} finally {
			revisionBusy = false;
		}
	}

	async function reloadCloudProject(): Promise<void> {
		if (!localProject?.cloud_project_id || cloudBusy) return;
		cloudBusy = true;
		try {
			const response = await getCloudVideoProject(localProject.cloud_project_id);
			localProject = await saveLocalVideoProject({
				...localProject,
				document: localDocumentFromCloudResponse(response.document),
				cloud_revision: response.revision,
				state: 'cloud'
			});
			history.clear();
			historyVersion += 1;
			cloudConflictOpen = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_save_failed();
		} finally {
			cloudBusy = false;
		}
	}

	async function saveCloudConflictAsCopy(): Promise<void> {
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!localProject || !workspaceID || cloudBusy) return;
		cloudBusy = true;
		try {
			localProject = await syncVideoProjectToOpenPost(
				{
					...localProject,
					cloud_project_id: undefined,
					cloud_revision: undefined,
					state: 'local'
				},
				workspaceID,
				(progress) => (cloudProgress = progress)
			);
			cloudConflictOpen = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_save_failed();
		} finally {
			cloudBusy = false;
		}
	}

	function localDocumentFromCloudResponse(value: unknown): VideoProjectDocumentV1 {
		const validation = validateVideoProject(value);
		if (!validation.valid || !validation.document) {
			throw new Error(validation.issues[0]?.message ?? m.video_studio_project_invalid());
		}
		const restored = cloneVideoProject(validation.document);
		if (!localProject) return restored;
		for (const [sourceID, source] of Object.entries(restored.sources)) {
			const localSource = localProject.document.sources[sourceID];
			if (localSource?.locator.type === 'local-opfs') {
				restored.sources[sourceID] = {
					...source,
					locator: structuredClone(localSource.locator),
					content_hash: source.content_hash ?? localSource.content_hash
				};
			}
		}
		return restored;
	}

	function revisionDate(value: string): string {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	async function ensureCloudProject(): Promise<LocalVideoProject> {
		const workspaceID = workspaceCtx.currentWorkspace?.id;
		if (!localProject || !workspaceID) {
			throw new Error(m.video_studio_cloud_workspace_required());
		}
		await flushAutosave();
		const synced = await syncVideoProjectToOpenPost(
			localProject,
			workspaceID,
			(progress) => (cloudProgress = progress),
			exportController?.signal
		);
		localProject = synced;
		return synced;
	}

	async function refreshExportCapability(): Promise<void> {
		if (!project || project.primary_sequence.length === 0) {
			exportCapabilityState = 'idle';
			exportCapabilityError = '';
			return;
		}
		const check = ++exportCapabilityCheck;
		exportCapabilityState = 'checking';
		exportCapabilityError = '';
		try {
			const format = returnToken ? 'mp4' : exportFormat;
			for (const target of exportVariantIDs) {
				await preflightVideoProjectExport(project, target, format);
			}
			if (check !== exportCapabilityCheck) return;
			exportCapabilityState = 'ready';
		} catch (cause) {
			if (check !== exportCapabilityCheck) return;
			exportCapabilityState = 'unsupported';
			exportCapabilityError =
				cause instanceof Error ? cause.message : m.video_studio_export_failed();
		}
	}

	function openExportDialog(): void {
		selectedExportVariants ||= [variantID];
		exportOpen = true;
		void refreshExportCapability();
	}

	function setExportFormat(value: string): void {
		exportFormat = value as 'mp4' | 'webm';
		exportedFiles = {};
		exportFile = null;
		revokeExportURLs();
		void refreshExportCapability();
	}

	async function requestDirectExportHandle(): Promise<FileSystemFileHandle | undefined> {
		const picker = (
			window as Window & {
				showSaveFilePicker?: (options: {
					suggestedName: string;
					types: Array<{ description: string; accept: Record<string, string[]> }>;
				}) => Promise<FileSystemFileHandle>;
			}
		).showSaveFilePicker;
		if (!picker || returnToken || exportVariantIDs.length !== 1) return undefined;
		const format = exportFormat;
		const extension = format === 'mp4' ? '.mp4' : '.webm';
		const baseName =
			project?.title
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9]+/gu, '-')
				.replace(/^-+|-+$/gu, '')
				.slice(0, 80) || 'openpost-video';
		return await picker({
			suggestedName: `${baseName}-${exportVariantIDs[0]}${extension}`,
			types: [
				{
					description: format === 'mp4' ? 'MP4 video' : 'WebM video',
					accept: {
						[format === 'mp4' ? 'video/mp4' : 'video/webm']: [extension]
					}
				}
			]
		});
	}

	async function startExport(directDownload = false): Promise<Partial<Record<VariantID, File>>> {
		if (!project || exportBusy || project.primary_sequence.length === 0) return {};
		let directHandle: FileSystemFileHandle | undefined;
		if (directDownload) {
			try {
				directHandle = await requestDirectExportHandle();
			} catch (cause) {
				if (cause instanceof DOMException && cause.name === 'AbortError') return {};
				throw cause;
			}
		}
		exportBusy = true;
		exportError = '';
		exportProgress = 0;
		revokeExportURLs();
		exportFile = null;
		exportController = new AbortController();
		const files: Partial<Record<VariantID, File>> = {};
		try {
			const variants = [...exportVariantIDs];
			for (let index = 0; index < variants.length; index += 1) {
				const currentVariant = variants[index]!;
				const file = await exportVideoProject(cloneVideoProject(project), {
					variantID: currentVariant,
					format: returnToken ? 'mp4' : exportFormat,
					projectID: localProject?.id,
					outputFileHandle: variants.length === 1 ? directHandle : undefined,
					signal: exportController.signal,
					onProgress: (fraction) =>
						(exportProgress = Math.max(0, Math.min(1, (index + fraction) / variants.length)))
				});
				files[currentVariant] = file;
				if (!directHandle) await persistExport(currentVariant, file);
			}
			if (localProject) await refreshPersistedExports(localProject.id);
			exportedFiles = files;
			exportURLs = Object.fromEntries(
				Object.entries(files).map(([id, file]) => [id, URL.createObjectURL(file!)])
			) as Partial<Record<VariantID, string>>;
			exportFile = files[variantID] ?? files[variants[0]!] ?? null;
			exportURL = exportFile ? (exportURLs[variantID] ?? exportURLs[variants[0]!] ?? '') : '';
			exportProgress = 1;
		} catch (cause) {
			recordFailure(cause, 'export.render');
			if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
				exportError = cause instanceof Error ? cause.message : m.video_studio_export_failed();
			}
		} finally {
			exportBusy = false;
			exportController = null;
		}
		return files;
	}

	function setExportVariant(target: VariantID, checked: boolean): void {
		if (returnToken) return;
		selectedExportVariants = checked
			? Array.from(new Set([...selectedExportVariants, target]))
			: selectedExportVariants.filter((item) => item !== target);
		if (selectedExportVariants.length === 0) selectedExportVariants = [variantID];
		exportedFiles = {};
		exportFile = null;
		revokeExportURLs();
		void refreshExportCapability();
	}

	function variantRenditions(): Record<string, string[]> {
		try {
			const parsed = JSON.parse(page.url.searchParams.get('variant_renditions') ?? '{}') as Record<
				string,
				unknown
			>;
			return Object.fromEntries(
				Object.entries(parsed).map(([key, value]) => [
					key,
					Array.isArray(value)
						? value.filter((item): item is string => typeof item === 'string')
						: []
				])
			);
		} catch {
			return {};
		}
	}

	async function returnExportsToComposer(): Promise<void> {
		if (!returnToken || returningToComposer || !project) return;
		returningToComposer = true;
		exportError = '';
		exportController = new AbortController();
		try {
			await workspaceCtx.initialize();
			const workspaceID = workspaceCtx.currentWorkspace?.id;
			if (!workspaceID) throw new Error(m.video_studio_cloud_workspace_required());
			let files = exportedFiles;
			if (exportVariantIDs.some((id) => !files[id])) {
				files = await startExport();
			}
			const synced = await ensureCloudProject();
			if (!synced.cloud_project_id) throw new Error(m.video_studio_save_failed());
			const assignments = variantRenditions();
			const exports = [];
			for (let index = 0; index < exportVariantIDs.length; index += 1) {
				const currentVariant = exportVariantIDs[index]!;
				const file = files[currentVariant];
				const variant = project.variants.find((item) => item.id === currentVariant);
				if (!file || !variant) throw new Error(m.video_studio_export_failed());
				const uploaded = await uploadMediaFile({
					workspaceId: workspaceID,
					file,
					source: 'video_studio_export',
					videoProjectId: synced.cloud_project_id,
					prepareVideo: false,
					signal: exportController.signal,
					onProgress: (progress) =>
						(exportProgress = (index + progress.fraction) / exportVariantIDs.length)
				});
				exports.push({
					variant_id: currentVariant,
					media_id: uploaded.id,
					width: variant.width,
					height: variant.height,
					duration_ms: Math.round(projectDurationUS(project) / 1_000),
					rendition_ids: assignments[currentVariant] ?? []
				});
			}
			const completed = await completeVideoReturnToken(returnToken, {
				project_id: synced.cloud_project_id,
				exports
			});
			const destination = new URL(completed.return_url, page.url);
			destination.searchParams.set('video_studio_return', returnToken);
			await goto(resolve(`${destination.pathname}${destination.search}` as '/'));
		} catch (cause) {
			if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
				exportError = cause instanceof Error ? cause.message : m.video_studio_export_failed();
			}
		} finally {
			returningToComposer = false;
			exportController = null;
		}
	}

	async function returnPersistedExportsToComposer(): Promise<void> {
		const files: Partial<Record<VariantID, File>> = {};
		for (const target of exportVariantIDs) {
			const saved = persistedExports.find((item) => item.variant_id === target);
			if (!saved) {
				exportError = m.video_studio_export_missing_variant();
				return;
			}
			const stored = await readProjectFile(saved.path);
			if (!stored) {
				exportError = m.video_studio_export_missing();
				return;
			}
			const extension = saved.name.endsWith('.mp4') ? 'mp4' : 'webm';
			files[target] = new File([stored], saved.name.replace(/^\d+-/u, ''), {
				type: extension === 'mp4' ? 'video/mp4' : 'video/webm'
			});
		}
		exportedFiles = files;
		await returnExportsToComposer();
	}

	function cancelExport(): void {
		exportController?.abort(new DOMException('Export cancelled.', 'AbortError'));
	}

	function selectedTransition(): string {
		return selectedClip?.transition_out?.type ?? 'cut';
	}

	function sourceKindLabel(kind: VideoSource['kind']): string {
		const labels: Record<VideoSource['kind'], string> = {
			video: m.video_studio_source_video(),
			audio: m.video_studio_source_audio(),
			image: m.video_studio_source_image(),
			'recording-screen': m.video_studio_source_screen(),
			'recording-camera': m.video_studio_source_camera(),
			'recording-microphone': m.video_studio_source_microphone(),
			'recording-system-audio': m.video_studio_source_system_audio()
		};
		return labels[kind];
	}

	function formatTime(timestampUS: number): string {
		const totalSeconds = Math.max(0, Math.floor(timestampUS / 1_000_000));
		const frames = Math.floor(
			((timestampUS % 1_000_000) * (project?.timebase.fps_numerator ?? 30)) / 1_000_000
		);
		return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
	}

	function firstVisualTrack(document: VideoProjectDocumentV1): VisualTrack {
		document.visual_tracks[0] ??= {
			id: `visual_${crypto.randomUUID()}`,
			name: m.video_studio_overlays_track(),
			locked: false,
			hidden: false,
			items: []
		};
		return document.visual_tracks[0];
	}

	function defaultOverlayPresentation(): VisualTrackItem['presentation'] {
		return {
			position_x: 0.5,
			position_y: 0.5,
			scale: 1,
			rotation: 0,
			opacity: 1,
			crop: { x: 0, y: 0, width: 1, height: 1 },
			flip_x: false,
			flip_y: false,
			corner_radius: 0,
			border_width: 0,
			border_color: '#ffffff',
			shadow_blur: 0,
			shadow_opacity: 0,
			background_color: '#00000000'
		};
	}
</script>

<svelte:head>
	<title
		>{m.video_studio_editor_meta_title({ title: project?.title ?? m.video_studio_title() })}</title
	>
</svelte:head>

{#if loading}
	<div class="flex h-dvh items-center justify-center bg-background">
		<LoaderIcon class="mr-2 size-5 animate-spin" />
		<span>{m.common_loading()}</span>
	</div>
{:else if error && !localProject}
	<main class="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-5">
		<InlineNotice tone="error" message={error} />
		<Button href={resolve('/video-studio')} variant="outline">
			<ArrowLeftIcon class="size-4" />
			{m.video_studio_back_projects()}
		</Button>
	</main>
{:else if localProject && project}
	<div class="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
		<header class="flex min-h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
			<Button
				href={resolve('/video-studio')}
				variant="ghost"
				size="icon-sm"
				aria-label={m.video_studio_back_projects()}
			>
				<ArrowLeftIcon class="size-4" />
			</Button>
			<Input
				value={project.title}
				oninput={(event) => setTitle(event.currentTarget.value)}
				class="h-8 w-40 border-transparent bg-transparent px-2 font-medium hover:border-input focus:border-input sm:w-56"
				aria-label={m.video_studio_project_name()}
			/>
			<div
				class="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"
				aria-live="polite"
			>
				{#if saveState === 'saving'}
					<LoaderIcon class="size-3.5 animate-spin" />
					{m.video_studio_saving()}
				{:else if saveState === 'failed'}
					<CircleDotIcon class="size-3.5 text-destructive" />
					{m.video_studio_save_failed()}
				{:else}
					<CheckIcon class="size-3.5" />
					{m.video_studio_autosaved()}
				{/if}
				<span class="border-l pl-2">
					{localProject.state === 'cloud'
						? m.video_studio_cloud_saved()
						: m.video_studio_local_only()}
				</span>
			</div>
			<div class="ml-auto hidden items-center gap-1 md:flex">
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={historyVersion < 0 || !history.canUndo}
					onclick={undo}
					aria-label={m.video_studio_undo()}
					title={history.undoLabel || m.video_studio_undo()}
				>
					<UndoIcon class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={historyVersion < 0 || !history.canRedo}
					onclick={redo}
					aria-label={m.video_studio_redo()}
					title={history.redoLabel || m.video_studio_redo()}
				>
					<RedoIcon class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => void openRevisionHistory()}
					aria-label={m.video_studio_history()}
					title={m.video_studio_history()}
				>
					<HistoryIcon class="size-4" />
				</Button>
			</div>
			<AppSelect
				value={variantID}
				onValueChange={(value) => (variantID = value as VariantID)}
				options={variantOptions}
				ariaLabel={m.video_studio_variant()}
				class="hidden h-9 w-44 sm:flex"
			/>
			<Button
				variant="outline"
				size="sm"
				onclick={cloudAction}
				aria-label={m.video_studio_save_cloud()}
				title={m.video_studio_save_cloud()}
			>
				<CloudIcon class="size-4" />
				<span class="hidden lg:inline">{m.video_studio_save_cloud()}</span>
			</Button>
			<Button
				size="sm"
				disabled={!fullEditor}
				aria-label={fullEditor ? m.video_studio_export() : m.video_studio_mobile_export_disabled()}
				title={fullEditor ? m.video_studio_export() : m.video_studio_mobile_export_disabled()}
				onclick={openExportDialog}
			>
				<DownloadIcon class="size-4" />
				{m.video_studio_export()}
			</Button>
		</header>

		{#if error}
			<InlineNotice
				tone="error"
				message={error}
				class="m-2 shrink-0"
				onDismiss={() => (error = '')}
				dismissLabel={m.common_dismiss()}
			/>
		{/if}
		{#if recoverableRecording}
			<InlineNotice
				tone="warning"
				message={m.video_studio_recovery_available()}
				class="m-2 shrink-0"
			>
				{#snippet actions()}
					<Button size="sm" variant="outline" onclick={() => void recoverRecording()}>
						{m.video_studio_recover_recording()}
					</Button>
					<Button size="sm" variant="ghost" onclick={() => void discardRecording()}>
						{m.video_studio_discard_recording()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}

		{#if fullEditor}
			<div
				class="relative grid min-h-0 flex-1 grid-cols-[3.75rem_minmax(0,1fr)] min-[56rem]:grid-cols-[3.75rem_13rem_minmax(18rem,1fr)_15rem] xl:grid-cols-[4.5rem_17rem_minmax(20rem,1fr)_18rem]"
			>
				<nav
					class="flex min-h-0 flex-col items-center gap-1 overflow-y-auto border-r py-2"
					aria-label={m.video_studio_title()}
				>
					{#each tools as tool (tool.id)}
						<button
							type="button"
							class={[
								'flex min-h-14 w-16 flex-col items-center justify-center gap-1 rounded-md px-1 text-[11px] leading-tight focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
								activeTool === tool.id
									? 'bg-primary/12 text-primary'
									: 'text-muted-foreground hover:bg-muted hover:text-foreground'
							]}
							aria-current={activeTool === tool.id ? 'page' : undefined}
							onclick={() => {
								const sameTool = activeTool === tool.id;
								activeTool = tool.id;
								compactToolOpen = sameTool ? !compactToolOpen : true;
							}}
						>
							<tool.icon class="size-4.5" />
							<span>{tool.label()}</span>
						</button>
					{/each}
				</nav>

				<aside
					class={[
						'absolute inset-y-0 left-[3.75rem] z-30 w-[min(18rem,calc(100%-3.75rem))] overflow-y-auto border-r bg-background p-3 shadow-xl min-[56rem]:static min-[56rem]:z-auto min-[56rem]:w-auto min-[56rem]:bg-muted/15 min-[56rem]:shadow-none',
						!compactToolOpen && 'max-[55.999rem]:hidden'
					]}
					aria-label={tools.find((tool) => tool.id === activeTool)?.label()}
				>
					<div class="mb-2 flex justify-end min-[56rem]:hidden">
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={() => (compactToolOpen = false)}
							aria-label={m.common_close()}
						>
							<XIcon class="size-4" />
						</Button>
					</div>
					{#if activeTool === 'media'}
						<div class="space-y-4">
							<div>
								<h2 class="text-sm font-semibold">{m.video_studio_media_panel()}</h2>
								<p class="mt-1 text-xs leading-5 text-muted-foreground">
									{m.video_studio_media_panel_description()}
								</p>
							</div>
							<Input
								type="file"
								multiple
								accept="video/*,audio/*,image/*"
								onchange={importFiles}
								disabled={importBusy}
								aria-label={m.video_studio_add_media()}
							/>
							<p class="text-xs text-muted-foreground">
								{m.video_studio_sources_count({ count: Object.keys(project.sources).length })}
							</p>
							<div class="grid gap-2">
								{#each Object.values(project.sources) as source (source.id)}
									<div class="min-w-0 rounded-md border bg-background p-2">
										<p class="truncate text-xs font-medium">{source.original_name}</p>
										<p class="mt-1 text-[11px] text-muted-foreground">
											{sourceKindLabel(source.kind)} ·
											{source.width > 0 ? `${source.width}×${source.height} · ` : ''}{formatBytes(
												source.size_bytes
											)}
										</p>
										<Button
											class="mt-2 w-full"
											variant="ghost"
											size="xs"
											onclick={() => addSourceToTimeline(source.id)}
										>
											<PlusIcon class="size-3" />
											{m.video_studio_add_to_timeline()}
										</Button>
									</div>
								{:else}
									<p
										class="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground"
									>
										{m.video_studio_no_media()}
									</p>
								{/each}
							</div>
						</div>
					{:else if activeTool === 'stock'}
						<div class="space-y-4">
							<StockMediaBrowser onSelect={addStock} />
							<section class="space-y-2 border-t pt-4">
								<div class="flex items-center justify-between gap-2">
									<h2 class="text-sm font-semibold">{m.video_studio_stock_credits()}</h2>
									{#if creditsText}
										<Button variant="ghost" size="sm" onclick={() => void copyCredits()}>
											{creditsCopied
												? m.video_studio_credits_copied()
												: m.video_studio_credits_copy()}
										</Button>
									{/if}
								</div>
								{#if stockSources.length > 0}
									<div class="space-y-2">
										{#each stockSources as source (source.id)}
											<div class="rounded-md border bg-background p-2 text-xs">
												<p class="truncate font-medium">{source.original_name}</p>
												<p class="mt-1 leading-5 text-muted-foreground">
													{source.provenance?.attribution_text ||
														`${source.provenance?.creator_name} / ${source.provenance?.provider}`}
												</p>
												<Button
													href={source.provenance?.source_url}
													target="_blank"
													rel="noreferrer"
													variant="link"
													size="xs"
													class="h-auto p-0 text-xs"
												>
													{m.video_studio_credits_source()}
												</Button>
											</div>
										{/each}
									</div>
								{:else}
									<p class="text-xs leading-5 text-muted-foreground">
										{m.video_studio_credits_empty()}
									</p>
								{/if}
							</section>
						</div>
					{:else if activeTool === 'text'}
						<div class="space-y-3">
							<h2 class="text-sm font-semibold">{m.video_studio_tool_text()}</h2>
							<Button class="w-full" onclick={() => addText()}>
								<TextIcon class="size-4" />
								{m.video_studio_add_title()}
							</Button>
							<p class="text-xs leading-5 text-muted-foreground">
								{m.video_studio_text_guidance()}
							</p>
						</div>
					{:else if activeTool === 'captions'}
						<div class="space-y-3">
							<div class="flex items-center justify-between gap-2">
								<h2 class="text-sm font-semibold">{m.video_studio_tool_captions()}</h2>
								<Button href="/video-studio/models" variant="ghost" size="sm">
									{m.video_studio_models_manage()}
								</Button>
							</div>
							<label class="grid gap-1.5 text-xs font-medium">
								<span>{m.video_studio_transcript_language()}</span>
								<AppSelect
									value={transcriptLanguage}
									disabled={analysisBusy}
									onValueChange={(value) => (transcriptLanguage = value)}
									options={[
										{ value: 'auto', label: m.video_studio_language_auto() },
										{ value: 'en', label: 'English' },
										{ value: 'pt', label: 'Português' },
										{ value: 'es', label: 'Español' },
										{ value: 'fr', label: 'Français' },
										{ value: 'de', label: 'Deutsch' }
									]}
								/>
							</label>
							<Button
								class="w-full"
								disabled={analysisBusy || project.primary_sequence.length === 0}
								onclick={() => void requestAnalysis('transcript')}
							>
								{#if analysisBusy && pendingAnalysis !== 'silence'}
									<LoaderIcon class="size-4 animate-spin" />
								{:else}
									<WandIcon class="size-4" />
								{/if}
								{m.video_studio_captions_generate()}
							</Button>
							<Button
								class="w-full"
								variant="outline"
								disabled={analysisBusy || project.primary_sequence.length === 0}
								onclick={() => void requestAnalysis('silence')}
							>
								<WandIcon class="size-4" />
								{m.video_studio_find_silences()}
							</Button>
							<Button class="w-full" variant="outline" onclick={addCaption}>
								<CaptionsIcon class="size-4" />
								{m.video_studio_add_caption()}
							</Button>
							{#if analysisBusy && analysisProgress}
								<div class="space-y-1.5" aria-live="polite">
									<div class="h-1.5 overflow-hidden rounded-full bg-muted">
										<div
											class="h-full bg-primary transition-[width]"
											style:width={`${Math.round(analysisProgress.fraction * 100)}%`}
										></div>
									</div>
									<p class="text-xs text-muted-foreground">
										{m.video_studio_analysis_progress({
											progress: Math.round(analysisProgress.fraction * 100)
										})}
									</p>
									<Button
										class="w-full"
										size="sm"
										variant="ghost"
										onclick={() => analysisController?.abort()}
									>
										{m.video_studio_analysis_cancel()}
									</Button>
								</div>
							{/if}
							{#if transcriptAnalysis}
								<div class="space-y-2 rounded-md border p-3">
									<p class="text-xs font-medium">
										{m.video_studio_transcript_ready({
											count: transcriptAnalysis.cues.length
										})}
									</p>
									<Button class="w-full" size="sm" onclick={applyTranscript}>
										{m.video_studio_apply_transcript()}
									</Button>
									{#if transcriptAnalysis.fillers.length > 0}
										<p class="pt-2 text-xs font-medium">{m.video_studio_filler_suggestions()}</p>
										{#each transcriptAnalysis.fillers as filler (`${filler.start_us}:${filler.end_us}`)}
											{@const fillerID = `${filler.start_us}:${filler.end_us}`}
											<label class="flex min-h-10 items-center gap-2 text-xs">
												<Checkbox
													checked={selectedFillers.includes(fillerID)}
													onCheckedChange={(checked) =>
														(selectedFillers = checked
															? [...selectedFillers, fillerID]
															: selectedFillers.filter((item) => item !== fillerID))}
												/>
												<span class="flex-1">{filler.text}</span>
												<span class="text-muted-foreground">{formatTime(filler.start_us)}</span>
											</label>
										{/each}
										<Button
											class="w-full"
											size="sm"
											variant="outline"
											onclick={applySelectedFillers}
										>
											{m.video_studio_apply_fillers()}
										</Button>
									{/if}
								</div>
							{/if}
							{#if silenceAnalysis}
								<div class="space-y-2 rounded-md border p-3">
									<p class="text-xs font-medium">
										{m.video_studio_silence_suggestions({
											count: silenceAnalysis.silences.length,
											duration: formatTime(
												silenceAnalysis.silences.reduce(
													(total, item) => total + item.duration_us,
													0
												)
											)
										})}
									</p>
									<div class="max-h-40 space-y-1 overflow-y-auto">
										{#each silenceAnalysis.silences as silence (`${silence.start_us}:${silence.end_us}`)}
											{@const silenceID = `${silence.start_us}:${silence.end_us}`}
											<label class="flex min-h-10 items-center gap-2 text-xs">
												<Checkbox
													checked={selectedSilences.includes(silenceID)}
													onCheckedChange={(checked) =>
														(selectedSilences = checked
															? [...selectedSilences, silenceID]
															: selectedSilences.filter((item) => item !== silenceID))}
												/>
												<span class="flex-1">
													{formatTime(silence.start_us)}–{formatTime(silence.end_us)}
												</span>
											</label>
										{/each}
									</div>
									<Button class="w-full" size="sm" onclick={applySelectedSilences}>
										{m.video_studio_apply_silences()}
									</Button>
								</div>
							{/if}
							{#if project.caption_tracks[0]?.cues.length}
								<div class="space-y-2 border-t pt-3">
									<div class="grid grid-cols-2 gap-2">
										<Button size="sm" variant="outline" onclick={() => downloadCaptions('srt')}>
											<DownloadIcon class="size-4" />
											{m.video_studio_caption_download_srt()}
										</Button>
										<Button size="sm" variant="outline" onclick={() => downloadCaptions('vtt')}>
											<DownloadIcon class="size-4" />
											{m.video_studio_caption_download_vtt()}
										</Button>
									</div>
									<div class="grid grid-cols-[1fr_1fr_auto] gap-1">
										<Input
											value={captionSearch}
											oninput={(event) =>
												(captionSearch = (event.currentTarget as HTMLInputElement).value)}
											placeholder={m.video_studio_caption_search()}
										/>
										<Input
											value={captionReplacement}
											oninput={(event) =>
												(captionReplacement = (event.currentTarget as HTMLInputElement).value)}
											placeholder={m.video_studio_caption_replace()}
										/>
										<Button size="sm" variant="outline" onclick={replaceCaptionText}>
											{m.video_studio_replace()}
										</Button>
									</div>
									{#each project.caption_tracks[0].cues as cue (cue.id)}
										<div class="space-y-1.5 rounded-md border p-2">
											<p class="text-[11px] text-muted-foreground">
												{formatTime(cue.start_us)}–{formatTime(cue.end_us)}
											</p>
											<Textarea
												value={cue.text}
												rows={2}
												oninput={(event) =>
													updateCaptionCue(
														cue.id,
														(event.currentTarget as HTMLTextAreaElement).value
													)}
											/>
											<Button
												size="sm"
												variant="ghost"
												class="w-full"
												onclick={() => rippleDeleteCue(cue)}
											>
												{m.video_studio_ripple_caption()}
											</Button>
										</div>
									{/each}
								</div>
							{/if}
							<p class="text-xs leading-5 text-muted-foreground">
								{m.video_studio_suggestions_only()}
							</p>
						</div>
					{:else if activeTool === 'elements'}
						<div class="space-y-3">
							<h2 class="text-sm font-semibold">{m.video_studio_tool_elements()}</h2>
							<Button
								class="w-full justify-start"
								variant="outline"
								onclick={() => addShape('rectangle')}
							>
								<ShapesIcon class="size-4" />{m.video_studio_shape_rectangle()}
							</Button>
							<div class="grid grid-cols-2 gap-2">
								<Button variant="outline" size="sm" onclick={() => addShape('ellipse')}>
									{m.video_studio_shape_ellipse()}
								</Button>
								<Button variant="outline" size="sm" onclick={() => addShape('arrow')}>
									{m.video_studio_shape_arrow()}
								</Button>
								<Button variant="outline" size="sm" onclick={() => addShape('highlight')}>
									{m.video_studio_shape_highlight()}
								</Button>
								<Button variant="outline" size="sm" onclick={() => addShape('redaction')}>
									{m.video_studio_shape_redaction()}
								</Button>
							</div>
							<Button
								class="w-full justify-start"
								variant="outline"
								onclick={() => addShape('click-pulse')}
							>
								<CircleDotIcon class="size-4" />{m.video_studio_add_click_pulse()}
							</Button>
							<Button
								class="w-full justify-start"
								variant="outline"
								onclick={() => addShape('progress')}
							>
								<LayersIcon class="size-4" />{m.video_studio_add_progress()}
							</Button>
						</div>
					{:else if activeTool === 'brand'}
						<div class="space-y-4">
							<div>
								<h2 class="text-sm font-semibold">{m.video_studio_tool_brand()}</h2>
								<p class="mt-1 text-xs leading-5 text-muted-foreground">
									{brandKit
										? m.video_studio_brand_description()
										: m.video_studio_brand_guest_description()}
								</p>
							</div>
							{#if brandKit?.colors.length}
								<section class="space-y-2">
									<h3 class="text-xs font-semibold">{m.studio_brand_colors()}</h3>
									<div class="grid grid-cols-2 gap-2">
										{#each brandKit.colors as color (color.id)}
											<button
												type="button"
												class="flex min-h-11 items-center gap-2 rounded-md border bg-background px-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
												onclick={() => applyBrandColor(color.value)}
											>
												<span
													class="size-5 shrink-0 rounded-full border"
													style:background={color.value}
													aria-hidden="true"
												></span>
												<span class="truncate">{color.name}</span>
											</button>
										{/each}
									</div>
								</section>
							{/if}
							{#if brandKit?.text_styles.length}
								<section class="space-y-2">
									<h3 class="text-xs font-semibold">{m.studio_text_styles()}</h3>
									<div class="grid gap-2">
										{#each brandKit.text_styles as style (style.id)}
											<Button
												class="h-auto min-h-11 justify-start py-2 text-left"
												variant="outline"
												onclick={() => addText(style)}
											>
												<span class="min-w-0">
													<span class="block truncate text-xs font-medium">{style.name}</span>
													<span class="block truncate text-[11px] text-muted-foreground">
														{style.font_family} · {style.font_weight}
													</span>
												</span>
											</Button>
										{/each}
									</div>
								</section>
							{/if}
							<section class="space-y-2">
								<div class="flex items-center justify-between gap-2">
									<h3 class="text-xs font-semibold">{m.video_studio_local_styles()}</h3>
									<Button
										size="xs"
										variant="ghost"
										disabled={!selectedVisualItemID}
										onclick={saveSelectedTextStyle}
									>
										{m.video_studio_save_local_style()}
									</Button>
								</div>
								{#if localTextStyles.length}
									<div class="grid gap-2">
										{#each localTextStyles as style (style.id)}
											<Button
												class="justify-start"
												size="sm"
												variant="outline"
												onclick={() => addText(undefined, style.style)}
											>
												{style.name}
											</Button>
										{/each}
									</div>
								{:else}
									<p class="text-xs leading-5 text-muted-foreground">
										{m.video_studio_local_styles_empty()}
									</p>
								{/if}
							</section>
							{#if brandKit?.assets.length}
								<section class="space-y-2">
									<h3 class="text-xs font-semibold">{m.studio_brand_assets()}</h3>
									<p class="text-xs leading-5 text-muted-foreground">
										{m.video_studio_brand_assets_media()}
									</p>
									<Button href="/media" class="w-full" variant="outline" size="sm">
										{m.video_studio_openpost_media()}
									</Button>
								</section>
							{/if}
							{#if !brandKit}
								<Button
									href={$auth.isAuthenticated
										? '/settings?tab=brand'
										: '/login?redirect=%2Fvideo-studio'}
									class="w-full"
									variant="outline"
									size="sm"
								>
									{$auth.isAuthenticated ? m.video_studio_brand_manage() : m.landing_sign_in()}
								</Button>
							{/if}
						</div>
					{:else if activeTool === 'transitions'}
						<div class="space-y-3">
							<h2 class="text-sm font-semibold">{m.video_studio_tool_transitions()}</h2>
							{#if selectedClip}
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_transition()}</span>
									<AppSelect
										value={selectedTransition()}
										options={transitionOptions}
										onValueChange={setTransition}
									/>
								</label>
								<p class="text-xs leading-5 text-muted-foreground">
									{m.video_studio_transition_bounded()}
								</p>
							{:else}
								<p class="text-xs text-muted-foreground">{m.video_studio_select_clip()}</p>
							{/if}
						</div>
					{:else if activeTool === 'smart'}
						<div class="space-y-3">
							<h2 class="text-sm font-semibold">{m.video_studio_tool_smart()}</h2>
							<p class="text-xs leading-5 text-muted-foreground">
								{m.video_studio_smart_description()}
							</p>
							<Button
								class="w-full"
								disabled={smartBusy || project.primary_sequence.length === 0}
								onclick={() => void runSmartFraming()}
							>
								{#if smartBusy}
									<LoaderIcon class="size-4 animate-spin" />
								{:else}
									<WandIcon class="size-4" />
								{/if}
								{m.video_studio_smart_analyze()}
							</Button>
							{#if smartBusy}
								<div class="space-y-1.5" aria-live="polite">
									<div class="h-1.5 overflow-hidden rounded-full bg-muted">
										<div
											class="h-full bg-primary transition-[width]"
											style:width={`${Math.round(smartProgress * 100)}%`}
										></div>
									</div>
									<p class="text-xs text-muted-foreground">
										{m.video_studio_analysis_progress({
											progress: Math.round(smartProgress * 100)
										})}
									</p>
								</div>
							{/if}
							{#if smartResult}
								<div class="space-y-2 rounded-md border p-3">
									<p class="text-xs font-medium">
										{m.video_studio_reframe_suggestions({
											count: smartResult.reframes.length
										})}
									</p>
									<p class="text-xs leading-5 text-muted-foreground">
										{m.video_studio_reframe_scope({
											variant:
												variantOptions.find((item) => item.value === variantID)?.label ?? variantID
										})}
									</p>
									<Button
										class="w-full"
										size="sm"
										variant="outline"
										disabled={smartResult.reframes.length === 0}
										onclick={applyReframes}
									>
										{m.video_studio_apply_reframes()}
									</Button>
								</div>
								<div class="space-y-2 rounded-md border p-3">
									<p class="text-xs font-medium">
										{m.video_studio_focus_suggestions({
											count: smartResult.focus_zooms.length
										})}
									</p>
									<div class="max-h-44 space-y-1 overflow-y-auto">
										{#each smartResult.focus_zooms as suggestion (suggestion.id)}
											<label class="flex min-h-10 items-center gap-2 text-xs">
												<Checkbox
													checked={selectedFocusZooms.includes(suggestion.id)}
													onCheckedChange={(checked) =>
														(selectedFocusZooms = checked
															? [...selectedFocusZooms, suggestion.id]
															: selectedFocusZooms.filter((item) => item !== suggestion.id))}
												/>
												<span class="flex-1">{formatTime(suggestion.time_us)}</span>
												<Button
													size="sm"
													variant="ghost"
													onclick={(event) => {
														event.preventDefault();
														playheadUS = suggestion.time_us;
													}}
												>
													{m.video_studio_preview_suggestion()}
												</Button>
											</label>
										{/each}
									</div>
									<Button
										class="w-full"
										size="sm"
										disabled={selectedFocusZooms.length === 0}
										onclick={applyFocusZooms}
									>
										{m.video_studio_apply_focus_zooms()}
									</Button>
								</div>
							{/if}
							<p class="text-xs leading-5 text-muted-foreground">
								{m.video_studio_cursor_limit()}
							</p>
						</div>
					{:else if activeTool === 'record'}
						<div class="space-y-3">
							<h2 class="text-sm font-semibold">{m.video_studio_tool_record()}</h2>
							{#if recordingSession}
								<div class="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
									<div class="flex items-center justify-between gap-2">
										<span class="flex items-center gap-2 text-xs font-medium">
											<span class="size-2 animate-pulse rounded-full bg-destructive"></span>
											{recordingKind === 'voiceover'
												? m.video_studio_record_voiceover()
												: m.video_studio_record_screen()}
										</span>
										<span class="font-mono text-xs">
											{formatTime(Math.round((recordingState?.elapsed_ms ?? 0) * 1_000))}
										</span>
									</div>
									<p class="text-xs text-muted-foreground">
										{formatBytes(recordingState?.bytes_written ?? 0)}
										{#if recordingState?.paused_for_storage}
											· {m.video_studio_recording_backpressure()}
										{/if}
									</p>
									{#if recordingState?.camera_active}
										<label class="grid gap-1 text-xs">
											<span class="font-medium">{m.video_studio_switch_camera()}</span>
											<AppSelect
												value={recordingCameraDeviceID}
												disabled={switchingRecordingDevice !== null}
												ariaLabel={m.video_studio_switch_camera()}
												onValueChange={(value) => void switchEditorRecordingInput('camera', value)}
												options={recordingDevices
													.filter((device) => device.kind === 'videoinput' && device.deviceId)
													.map((device, index) => ({
														value: device.deviceId,
														label:
															device.label || m.video_studio_camera_number({ number: index + 1 })
													}))}
											/>
										</label>
									{/if}
									{#if recordingState?.microphone_active}
										<label class="grid gap-1 text-xs">
											<span class="font-medium">{m.video_studio_switch_microphone()}</span>
											<AppSelect
												value={recordingMicrophoneDeviceID}
												disabled={switchingRecordingDevice !== null}
												ariaLabel={m.video_studio_switch_microphone()}
												onValueChange={(value) =>
													void switchEditorRecordingInput('microphone', value)}
												options={recordingDevices
													.filter((device) => device.kind === 'audioinput' && device.deviceId)
													.map((device, index) => ({
														value: device.deviceId,
														label:
															device.label ||
															m.video_studio_microphone_number({ number: index + 1 })
													}))}
											/>
										</label>
									{/if}
									<Button
										class="w-full"
										variant="destructive"
										disabled={recordBusy || switchingRecordingDevice !== null}
										onclick={() => void stopEditorRecording()}
									>
										{#if recordBusy || switchingRecordingDevice}
											<LoaderIcon class="size-4 animate-spin" />
										{/if}
										{m.video_studio_recording_stop()}
									</Button>
								</div>
							{:else}
								<div class="space-y-2 rounded-md border p-3">
									<label class="flex min-h-10 items-center gap-2 text-xs">
										<Checkbox bind:checked={recordCamera} />
										<CameraIcon class="size-4" />
										{m.video_studio_camera()}
									</label>
									<label class="flex min-h-10 items-center gap-2 text-xs">
										<Checkbox bind:checked={recordMicrophone} />
										<MicIcon class="size-4" />
										{m.video_studio_microphone()}
									</label>
									<label class="flex min-h-10 items-center gap-2 text-xs">
										<Checkbox bind:checked={recordSystemAudio} />
										<VolumeIcon class="size-4" />
										{m.video_studio_system_audio()}
									</label>
								</div>
								<Button
									class="w-full"
									variant="outline"
									disabled={recordBusy}
									onclick={() => void startScreenRecording()}
								>
									<MonitorIcon class="size-4" />
									{recordCountdown > 0
										? m.video_studio_record_countdown_active({ seconds: recordCountdown })
										: m.video_studio_record_screen()}
								</Button>
								<Button
									class="w-full"
									variant="outline"
									disabled={recordBusy}
									onclick={() => void startVoiceover()}
								>
									<MicIcon class="size-4" />
									{m.video_studio_record_voiceover()}
								</Button>
								<p class="text-xs leading-5 text-muted-foreground">
									{m.video_studio_system_audio_caveat()}
								</p>
								{#if hasCameraOverlay}
									<div class="space-y-2 border-t pt-3">
										<h3 class="text-xs font-semibold">{m.video_studio_camera_layout()}</h3>
										<label class="flex min-h-10 items-center gap-2 text-xs">
											<Checkbox bind:checked={cameraPresetVariantOnly} />
											{m.video_studio_camera_current_format()}
										</label>
										<div class="grid grid-cols-2 gap-2">
											{#each [['circle', m.video_studio_camera_circle()], ['rounded', m.video_studio_camera_rounded()], ['portrait', m.video_studio_camera_portrait()], ['side-by-side', m.video_studio_camera_side_by_side()], ['full', m.video_studio_camera_full()]] as preset (preset[0])}
												<Button
													variant="outline"
													size="sm"
													onclick={() =>
														applyCameraPreset(
															preset[0] as
																'circle' | 'rounded' | 'portrait' | 'side-by-side' | 'full'
														)}
												>
													{preset[1]}
												</Button>
											{/each}
										</div>
									</div>
								{/if}
							{/if}
						</div>
					{:else if activeTool === 'audio'}
						<div class="space-y-3">
							<h2 class="text-sm font-semibold">{m.video_studio_tool_audio()}</h2>
							<Input
								type="file"
								multiple
								accept="audio/*"
								onchange={importFiles}
								aria-label={m.video_studio_add_media()}
							/>
							<Button
								class="w-full"
								variant="outline"
								disabled={audioNormalizeBusy || project.primary_sequence.length === 0}
								onclick={() => void normalizeProjectAudio()}
							>
								{#if audioNormalizeBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
								{m.video_studio_normalize_audio()}
							</Button>
							{#if audioNormalizeBusy}
								<p class="text-xs text-muted-foreground" aria-live="polite">
									{m.video_studio_normalize_progress({
										progress: Math.round(audioNormalizeProgress * 100)
									})}
								</p>
							{/if}
							<p class="text-xs leading-5 text-muted-foreground">
								{m.video_studio_normalize_description()}
							</p>
							<details class="border-t pt-3" open>
								<summary class="min-h-9 cursor-pointer py-2 text-xs font-medium">
									{m.video_studio_audio_music_beds()}
								</summary>
								<div class="grid grid-cols-2 gap-2">
									{#each BUNDLED_AUDIO_ITEMS.filter((item) => item.kind === 'music') as item (item.id)}
										<Button
											variant="outline"
											size="sm"
											disabled={Boolean(audioPackBusy)}
											onclick={() => void addBundledAudio(item)}
										>
											{#if audioPackBusy === item.id}<LoaderIcon class="size-3 animate-spin" />{/if}
											{item.name}
										</Button>
									{/each}
								</div>
							</details>
							<details class="border-t pt-3">
								<summary class="min-h-9 cursor-pointer py-2 text-xs font-medium">
									{m.video_studio_audio_sound_effects()}
								</summary>
								<div class="grid grid-cols-2 gap-2">
									{#each BUNDLED_AUDIO_ITEMS.filter((item) => item.kind === 'effect') as item (item.id)}
										<Button
											variant="outline"
											size="sm"
											disabled={Boolean(audioPackBusy)}
											onclick={() => void addBundledAudio(item)}
										>
											{#if audioPackBusy === item.id}<LoaderIcon class="size-3 animate-spin" />{/if}
											{item.name}
										</Button>
									{/each}
								</div>
							</details>
							<p class="text-[11px] leading-5 text-muted-foreground">
								{m.video_studio_audio_pack_license()}
							</p>
						</div>
					{:else}
						<div class="space-y-3">
							<h2 class="text-sm font-semibold">
								{tools.find((tool) => tool.id === activeTool)?.label()}
							</h2>
							<p class="text-xs leading-5 text-muted-foreground">
								{m.video_studio_smart_unavailable()}
							</p>
						</div>
					{/if}
				</aside>

				<main
					class="col-start-2 grid min-h-0 grid-rows-[minmax(0,1fr)_3.25rem] bg-[#121214] min-[56rem]:col-auto"
				>
					<VideoPreview
						{project}
						projectID={localProject?.id ?? ''}
						{variantID}
						{playheadUS}
						{playing}
						{selectedClipID}
						{selectedVisualItemID}
						onSelectClip={selectClip}
						onSelectVisualItem={selectVisualItem}
						onTransform={updateClipPosition}
						onTransformVisual={updateVisualPosition}
					/>
					<div
						class="flex items-center justify-center gap-3 border-t border-white/10 bg-[#18181b] px-3 text-zinc-200"
					>
						<Button
							variant="ghost"
							size="icon"
							class="text-zinc-200 hover:bg-white/10 hover:text-white"
							onclick={togglePlayback}
							aria-label={playing ? m.video_studio_pause() : m.video_studio_play()}
						>
							{#if playing}<PauseIcon class="size-5" />{:else}<PlayIcon class="size-5" />{/if}
						</Button>
						<span class="font-mono text-xs">
							{m.video_studio_playback_time({
								current: formatTime(playheadUS),
								total: formatTime(durationUS)
							})}
						</span>
						<span class="hidden text-xs text-zinc-500 xl:inline"
							>{m.video_studio_keyboard_help()}</span
						>
					</div>
				</main>

				<aside
					class={[
						'absolute inset-y-0 right-0 z-30 w-[min(18rem,calc(100%-3.75rem))] overflow-y-auto border-l bg-background p-3 shadow-xl min-[56rem]:static min-[56rem]:z-auto min-[56rem]:w-auto min-[56rem]:shadow-none',
						!compactInspectorOpen && 'max-[55.999rem]:hidden'
					]}
					aria-label={m.video_studio_inspector()}
				>
					<div class="flex items-center justify-between gap-2">
						<h2 class="text-sm font-semibold">{m.video_studio_inspector()}</h2>
						<Button
							variant="ghost"
							size="icon-sm"
							class="min-[56rem]:hidden"
							onclick={() => (compactInspectorOpen = false)}
							aria-label={m.common_close()}
						>
							<XIcon class="size-4" />
						</Button>
					</div>
					{#if selectedVisualItem}
						<div class="mt-4 space-y-5">
							<div class="rounded-md border bg-muted/20 p-3">
								<p class="truncate text-sm font-medium">
									{selectedVisualItem.type === 'text'
										? selectedVisualItem.text
										: m.video_studio_overlay_item()}
								</p>
								<p class="mt-1 text-xs text-muted-foreground">
									{m.video_studio_overlay_type({ type: selectedVisualItem.type })}
								</p>
							</div>
							{#if selectedVisualItem.type === 'text'}
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_overlay_text()}</span>
									<Textarea
										value={selectedVisualItem.text}
										rows={3}
										oninput={(event) => updateVisualText(event.currentTarget.value)}
									/>
								</label>
								<div class="grid grid-cols-2 gap-2">
									<label class="grid gap-1.5 text-xs font-medium">
										<span>{m.video_studio_text_alignment()}</span>
										<AppSelect
											value={selectedVisualItem.style.align}
											options={[
												{ value: 'left', label: m.video_studio_align_left() },
												{ value: 'center', label: m.video_studio_align_center() },
												{ value: 'right', label: m.video_studio_align_right() }
											]}
											onValueChange={(value) => updateVisualTextStyle('align', value)}
										/>
									</label>
									<label class="grid gap-1.5 text-xs font-medium">
										<span>{m.video_studio_text_animation()}</span>
										<AppSelect
											value={selectedVisualItem.style.animation}
											options={[
												{ value: 'none', label: m.video_studio_animation_none() },
												{ value: 'fade', label: m.video_studio_animation_fade() },
												{ value: 'rise', label: m.video_studio_animation_rise() },
												{ value: 'pop', label: m.video_studio_animation_pop() },
												{ value: 'typewriter', label: m.video_studio_animation_typewriter() }
											]}
											onValueChange={(value) => updateVisualTextStyle('animation', value)}
										/>
									</label>
								</div>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_text_size()}
										<span>{selectedVisualItem.style.font_size}px</span>
									</span>
									<Slider
										value={selectedVisualItem.style.font_size}
										min={18}
										max={160}
										step={1}
										onValueChange={(value) => updateVisualTextStyle('font_size', value)}
										ariaLabel={m.video_studio_text_size()}
									/>
								</label>
								<div class="grid grid-cols-2 gap-2">
									<label class="grid gap-1.5 text-xs font-medium">
										<span>{m.video_studio_text_color()}</span>
										<Input
											type="color"
											value={selectedVisualItem.style.color}
											oninput={(event) => updateVisualTextStyle('color', event.currentTarget.value)}
										/>
									</label>
									<label class="grid gap-1.5 text-xs font-medium">
										<span>{m.video_studio_text_background()}</span>
										<Input
											type="color"
											value={selectedVisualItem.style.background_color.slice(0, 7)}
											oninput={(event) =>
												updateVisualTextStyle('background_color', event.currentTarget.value)}
										/>
									</label>
								</div>
							{:else if selectedVisualItem.type === 'shape' || selectedVisualItem.type === 'annotation'}
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_shape_kind()}</span>
									<AppSelect
										value={selectedVisualItem.shape.kind}
										options={[
											{
												value: 'rectangle',
												label: m.video_studio_shape_rectangle()
											},
											{ value: 'ellipse', label: m.video_studio_shape_ellipse() },
											{ value: 'arrow', label: m.video_studio_shape_arrow() },
											{
												value: 'highlight',
												label: m.video_studio_shape_highlight()
											},
											{
												value: 'redaction',
												label: m.video_studio_shape_redaction()
											}
										]}
										onValueChange={(value) => updateVisualShapeStyle('kind', value)}
									/>
								</label>
								<div class="grid grid-cols-2 gap-2">
									<label class="grid gap-1.5 text-xs font-medium">
										<span>{m.video_studio_shape_fill()}</span>
										<Input
											type="color"
											value={selectedVisualItem.shape.fill.slice(0, 7)}
											oninput={(event) => updateVisualShapeStyle('fill', event.currentTarget.value)}
										/>
									</label>
									<label class="grid gap-1.5 text-xs font-medium">
										<span>{m.video_studio_shape_stroke()}</span>
										<Input
											type="color"
											value={selectedVisualItem.shape.stroke.slice(0, 7)}
											oninput={(event) =>
												updateVisualShapeStyle('stroke', event.currentTarget.value)}
										/>
									</label>
								</div>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_shape_stroke_width()}
										<span>{selectedVisualItem.shape.stroke_width}px</span>
									</span>
									<Slider
										value={selectedVisualItem.shape.stroke_width}
										min={0}
										max={24}
										step={1}
										onValueChange={(value) => updateVisualShapeStyle('stroke_width', value)}
										ariaLabel={m.video_studio_shape_stroke_width()}
									/>
								</label>
							{/if}
							<label class="flex items-start gap-2 text-xs">
								<Checkbox
									bind:checked={editShared}
									aria-label={m.video_studio_selection_shared()}
								/>
								<span>
									<span class="block font-medium">{m.video_studio_selection_shared()}</span>
									<span class="mt-1 block leading-4 text-muted-foreground">
										{m.video_studio_selection_shared_description()}
									</span>
								</span>
							</label>
							<div class="grid grid-cols-2 gap-2">
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_overlay_start()}</span>
									<Input
										type="number"
										min="0"
										step="0.1"
										value={(selectedVisualItem.timeline_start_us / 1_000_000).toFixed(1)}
										onchange={(event) =>
											updateVisualTiming('timeline_start_us', event.currentTarget.valueAsNumber)}
									/>
								</label>
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_overlay_duration()}</span>
									<Input
										type="number"
										min="0.1"
										step="0.1"
										value={(selectedVisualItem.duration_us / 1_000_000).toFixed(1)}
										onchange={(event) =>
											updateVisualTiming('duration_us', event.currentTarget.valueAsNumber)}
									/>
								</label>
							</div>
							<div class="space-y-3">
								<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									{m.video_studio_inspector_position()}
								</h3>
								{#each [{ property: 'position_x', label: m.video_studio_position_x(), value: selectedVisualPresentation?.position_x ?? 0.5, min: 0, max: 1, step: 0.01 }, { property: 'position_y', label: m.video_studio_position_y(), value: selectedVisualPresentation?.position_y ?? 0.5, min: 0, max: 1, step: 0.01 }, { property: 'scale', label: m.video_studio_clip_scale(), value: selectedVisualPresentation?.scale ?? 1, min: 0.1, max: 4, step: 0.01 }, { property: 'rotation', label: m.video_studio_rotation(), value: selectedVisualPresentation?.rotation ?? 0, min: -180, max: 180, step: 1 }, { property: 'opacity', label: m.video_studio_clip_opacity(), value: selectedVisualPresentation?.opacity ?? 1, min: 0, max: 1, step: 0.01 }] as control (control.property)}
									<label class="grid gap-2 text-xs">
										<span class="flex justify-between">
											{control.label}
											<span
												>{control.property === 'rotation'
													? `${Math.round(control.value)}°`
													: `${Math.round(control.value * 100)}%`}</span
											>
										</span>
										<Slider
											value={control.value}
											min={control.min}
											max={control.max}
											step={control.step}
											onValueChange={(value) =>
												updateVisualPresentation(selectedVisualItem.id, {
													[control.property]: value
												})}
											ariaLabel={control.label}
										/>
									</label>
								{/each}
							</div>
							<label class="flex min-h-10 items-center gap-2 text-xs font-medium">
								<Checkbox
									checked={selectedVisualVisible}
									onCheckedChange={toggleVisualVisibility}
									aria-label={m.video_studio_overlay_visibility()}
								/>
								{m.video_studio_overlay_visibility()}
							</label>
							<Button class="w-full" variant="destructive" size="sm" onclick={deleteSelectedVisual}>
								{m.video_studio_delete_overlay()}
							</Button>
						</div>
					{:else if selectedAudioItem}
						<div class="mt-4 space-y-4">
							<div class="rounded-md border bg-muted/20 p-3">
								<p class="text-sm font-medium">{m.video_studio_audio_item()}</p>
								<p class="mt-1 truncate text-xs text-muted-foreground">
									{project.sources[selectedAudioItem.source_id]?.original_name}
								</p>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_overlay_start()}</span>
									<Input
										type="number"
										min="0"
										step="0.1"
										value={(selectedAudioItem.timeline_start_us / 1_000_000).toFixed(1)}
										onchange={(event) =>
											updateSelectedAudio('timeline_start_us', event.currentTarget.valueAsNumber)}
									/>
								</label>
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_overlay_duration()}</span>
									<Input
										type="number"
										min="0.1"
										step="0.1"
										value={(selectedAudioItem.duration_us / 1_000_000).toFixed(1)}
										onchange={(event) =>
											updateSelectedAudio('duration_us', event.currentTarget.valueAsNumber)}
									/>
								</label>
							</div>
							<label class="grid gap-2 text-xs">
								<span class="flex justify-between">
									{m.video_studio_clip_volume()}
									<span>{selectedAudioItem.gain_db.toFixed(1)} dB</span>
								</span>
								<Slider
									value={selectedAudioItem.gain_db}
									min={-60}
									max={12}
									step={0.5}
									onValueChange={(value) => updateSelectedAudio('gain_db', value)}
									ariaLabel={m.video_studio_clip_volume()}
								/>
							</label>
							<label class="flex min-h-10 items-center gap-2 text-xs font-medium">
								<Checkbox
									checked={selectedAudioItem.muted}
									onCheckedChange={(checked) => updateSelectedAudio('muted', checked)}
									aria-label={m.video_studio_clip_mute()}
								/>
								{m.video_studio_clip_mute()}
							</label>
							<Button class="w-full" variant="destructive" size="sm" onclick={deleteSelectedAudio}>
								{m.video_studio_delete_audio_item()}
							</Button>
						</div>
					{:else if selectedCaptionCue}
						<div class="mt-4 space-y-4">
							<label class="grid gap-1.5 text-xs font-medium">
								<span>{m.video_studio_overlay_text()}</span>
								<Textarea
									value={selectedCaptionCue.text}
									rows={3}
									oninput={(event) =>
										updateCaptionCue(selectedCaptionCue.id, event.currentTarget.value)}
								/>
							</label>
							<div class="grid grid-cols-2 gap-2">
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_overlay_start()}</span>
									<Input
										type="number"
										min="0"
										step="0.1"
										value={(selectedCaptionCue.start_us / 1_000_000).toFixed(1)}
										onchange={(event) =>
											updateSelectedCaptionTiming('start_us', event.currentTarget.valueAsNumber)}
									/>
								</label>
								<label class="grid gap-1.5 text-xs font-medium">
									<span>{m.video_studio_overlay_end()}</span>
									<Input
										type="number"
										min="0.1"
										step="0.1"
										value={(selectedCaptionCue.end_us / 1_000_000).toFixed(1)}
										onchange={(event) =>
											updateSelectedCaptionTiming('end_us', event.currentTarget.valueAsNumber)}
									/>
								</label>
							</div>
							<Button
								class="w-full"
								variant="outline"
								size="sm"
								onclick={() => rippleDeleteCue(selectedCaptionCue)}
							>
								{m.video_studio_ripple_caption()}
							</Button>
							<Button
								class="w-full"
								variant="destructive"
								size="sm"
								onclick={deleteSelectedCaption}
							>
								{m.video_studio_delete_caption()}
							</Button>
						</div>
					{:else if selectedClip}
						<div class="mt-4 space-y-5">
							<div class="rounded-md border bg-muted/20 p-3">
								<p class="truncate text-sm font-medium">
									{project.sources[selectedClip.source_id]?.original_name}
								</p>
								<p class="mt-1 text-xs text-muted-foreground">{m.video_studio_clip()}</p>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<Button variant="outline" size="sm" onclick={duplicateSelected}>
									{m.video_studio_duplicate_clip()}
								</Button>
								<Button
									variant="outline"
									size="sm"
									disabled={selectedClip.mode === 'freeze'}
									onclick={freezeSelected}
								>
									{m.video_studio_freeze_frame()}
								</Button>
								<Button
									class="col-span-2"
									variant="outline"
									size="sm"
									disabled={selectedClip.mode === 'freeze' || selectedClip.audio.muted}
									onclick={detachSelectedAudio}
								>
									{m.video_studio_detach_audio()}
								</Button>
							</div>
							<label class="flex items-start gap-2 text-xs">
								<Checkbox
									bind:checked={editShared}
									aria-label={m.video_studio_selection_shared()}
								/>
								<span>
									<span class="block font-medium">{m.video_studio_selection_shared()}</span>
									<span class="mt-1 block leading-4 text-muted-foreground">
										{m.video_studio_selection_shared_description()}
									</span>
								</span>
							</label>
							<div class="space-y-3">
								<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									{m.video_studio_inspector_position()}
								</h3>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_position_x()}
										<span>{Math.round((selectedPresentation?.position_x ?? 0.5) * 100)}%</span>
									</span>
									<Slider
										value={selectedPresentation?.position_x ?? 0.5}
										min={0}
										max={1}
										step={0.01}
										onValueChange={(value) =>
											updateClipPosition(value, selectedPresentation?.position_y ?? 0.5)}
										ariaLabel={m.video_studio_position_x()}
									/>
								</label>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_position_y()}
										<span>{Math.round((selectedPresentation?.position_y ?? 0.5) * 100)}%</span>
									</span>
									<Slider
										value={selectedPresentation?.position_y ?? 0.5}
										min={0}
										max={1}
										step={0.01}
										onValueChange={(value) =>
											updateClipPosition(selectedPresentation?.position_x ?? 0.5, value)}
										ariaLabel={m.video_studio_position_y()}
									/>
								</label>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_clip_scale()}
										<span>{Math.round((selectedPresentation?.scale ?? 1) * 100)}%</span>
									</span>
									<Slider
										value={selectedPresentation?.scale ?? 1}
										min={0.1}
										max={4}
										step={0.01}
										onValueChange={(value) => updateClipNumber('scale', value)}
										ariaLabel={m.video_studio_clip_scale()}
									/>
								</label>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_clip_opacity()}
										<span>{Math.round((selectedPresentation?.opacity ?? 1) * 100)}%</span>
									</span>
									<Slider
										value={selectedPresentation?.opacity ?? 1}
										min={0}
										max={1}
										step={0.01}
										onValueChange={(value) => updateClipNumber('opacity', value)}
										ariaLabel={m.video_studio_clip_opacity()}
									/>
								</label>
							</div>
							<div class="space-y-3 border-t pt-4">
								<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									{m.video_studio_inspector_audio()}
								</h3>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_clip_speed()} <span>{selectedClip.speed.toFixed(2)}×</span>
									</span>
									<Slider
										value={selectedClip.speed}
										min={0.25}
										max={4}
										step={0.05}
										disabled={selectedClip.mode === 'freeze'}
										onValueChange={updateSpeed}
										ariaLabel={m.video_studio_clip_speed()}
									/>
								</label>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_clip_volume()}
										<span>{selectedClip.audio.gain_db.toFixed(1)} dB</span>
									</span>
									<Slider
										value={selectedClip.audio.gain_db}
										min={-60}
										max={12}
										step={0.5}
										onValueChange={(value) => updateClipNumber('gain_db', value)}
										ariaLabel={m.video_studio_clip_volume()}
									/>
								</label>
								<label class="flex min-h-10 items-center gap-2 text-xs font-medium">
									<Checkbox
										checked={selectedClip.audio.muted}
										onCheckedChange={updateMute}
										aria-label={m.video_studio_clip_mute()}
									/>
									{m.video_studio_clip_mute()}
								</label>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_fade_in()}
										<span>{(selectedClip.audio.fade_in_us / 1_000_000).toFixed(1)}s</span>
									</span>
									<Slider
										value={selectedClip.audio.fade_in_us / 1_000_000}
										min={0}
										max={3}
										step={0.1}
										onValueChange={(value) => updateClipAudioTiming('fade_in_us', value)}
										ariaLabel={m.video_studio_fade_in()}
									/>
								</label>
								<label class="grid gap-2 text-xs">
									<span class="flex justify-between">
										{m.video_studio_fade_out()}
										<span>{(selectedClip.audio.fade_out_us / 1_000_000).toFixed(1)}s</span>
									</span>
									<Slider
										value={selectedClip.audio.fade_out_us / 1_000_000}
										min={0}
										max={3}
										step={0.1}
										onValueChange={(value) => updateClipAudioTiming('fade_out_us', value)}
										ariaLabel={m.video_studio_fade_out()}
									/>
								</label>
							</div>
							<details class="border-t pt-3 text-xs">
								<summary class="min-h-9 cursor-pointer py-2 font-medium">
									{m.video_studio_adjustments()}
								</summary>
								<div class="space-y-3 pb-3">
									{#each adjustmentOptions as adjustment (adjustment.type)}
										<label class="grid gap-2">
											<span class="flex justify-between">
												{adjustment.label}
												<span>{clipEffectValue(adjustment.type).toFixed(1)}</span>
											</span>
											<Slider
												value={clipEffectValue(adjustment.type)}
												min={adjustment.min}
												max={adjustment.max}
												step={adjustment.step}
												onValueChange={(value) => updateClipEffect(adjustment.type, value)}
												ariaLabel={adjustment.label}
											/>
										</label>
									{/each}
								</div>
							</details>
							<details class="border-t pt-3 text-xs">
								<summary class="min-h-9 cursor-pointer py-2 font-medium">
									{m.video_studio_advanced()}
								</summary>
								<div class="space-y-2 pb-2">
									<p class="leading-5 text-muted-foreground">
										{m.video_studio_keyframe_description()}
									</p>
									<Button
										class="w-full"
										variant="outline"
										size="sm"
										onclick={applyGuidedFocusKeyframes}
									>
										{m.video_studio_add_focus_keyframes()}
									</Button>
								</div>
							</details>
							<div class="grid grid-cols-2 gap-2 border-t pt-4">
								<Button variant="outline" size="sm" onclick={leaveGapSelected}>
									{m.video_studio_leave_gap()}
								</Button>
								<Button variant="destructive" size="sm" onclick={rippleDeleteSelected}>
									{m.video_studio_ripple_delete()}
								</Button>
							</div>
						</div>
					{:else if selectedGap}
						<div class="mt-4 space-y-4">
							<div class="rounded-md border border-dashed bg-muted/20 p-3">
								<p class="text-sm font-medium">{m.video_studio_gap()}</p>
								<p class="mt-1 text-xs leading-5 text-muted-foreground">
									{m.video_studio_gap_description()}
								</p>
							</div>
							<label class="grid gap-1.5 text-xs font-medium">
								<span>{m.video_studio_gap_duration()}</span>
								<Input
									type="number"
									min="0.001"
									step="0.1"
									value={(selectedGap.duration_us / 1_000_000).toFixed(1)}
									onchange={(event) => updateSelectedGapDuration(event.currentTarget.valueAsNumber)}
								/>
							</label>
							<Button class="w-full" variant="destructive" size="sm" onclick={rippleDeleteSelected}>
								{m.video_studio_ripple_delete()}
							</Button>
						</div>
					{:else}
						<p class="mt-4 text-xs leading-5 text-muted-foreground">
							{m.video_studio_no_selection()}
						</p>
					{/if}
				</aside>
			</div>

			<div class="min-h-52 shrink-0">
				<Timeline
					{project}
					projectID={localProject?.id ?? ''}
					bind:playheadUS
					bind:zoom={timelineZoom}
					{selectedClipID}
					{selectedVisualItemID}
					{selectedAudioItemID}
					{selectedCaptionCueID}
					onSelectClip={selectClip}
					onSelectVisualItem={selectVisualItem}
					onSelectAudioItem={selectAudioItem}
					onSelectCaptionCue={selectCaptionCue}
					onSplit={splitSelected}
					onRippleDelete={rippleDeleteSelected}
					onLeaveGap={leaveGapSelected}
					onMove={moveSelectedClip}
					onReorder={reorderClip}
					onTrim={trimClip}
					onVisualTiming={updateVisualTimeline}
					onAudioTiming={updateAudioTimeline}
					onCaptionTiming={updateCaptionTimeline}
					onAddMarker={addTimelineMarker}
					onUpdateMarker={updateTimelineMarker}
					onDeleteMarker={deleteTimelineMarker}
				/>
			</div>
		{:else}
			<main class="flex min-h-0 flex-1 flex-col">
				<div class="min-h-0 flex-1">
					<VideoPreview
						{project}
						projectID={localProject?.id ?? ''}
						{variantID}
						{playheadUS}
						{playing}
						{selectedClipID}
						{selectedVisualItemID}
						onSelectClip={selectClip}
						onSelectVisualItem={selectVisualItem}
					/>
				</div>
				<div class="space-y-3 border-t p-4">
					<div class="flex items-center justify-center gap-3">
						<Button
							variant="outline"
							size="icon"
							onclick={togglePlayback}
							aria-label={playing ? m.video_studio_pause() : m.video_studio_play()}
						>
							{#if playing}<PauseIcon class="size-5" />{:else}<PlayIcon class="size-5" />{/if}
						</Button>
						<span class="font-mono text-xs text-muted-foreground">
							{m.video_studio_playback_time({
								current: formatTime(playheadUS),
								total: formatTime(durationUS)
							})}
						</span>
					</div>
					<AppSelect
						value={variantID}
						onValueChange={(value) => (variantID = value as VariantID)}
						options={variantOptions}
						ariaLabel={m.video_studio_variant()}
					/>
					<h2 class="font-medium">{m.video_studio_mobile_preview()}</h2>
					<p class="text-sm leading-6 text-muted-foreground">
						{m.video_studio_mobile_preview_description()}
					</p>
					{#if persistedExports.length > 0}
						<section class="space-y-2" aria-labelledby="mobile-exports-title">
							<h3 id="mobile-exports-title" class="text-sm font-medium">
								{m.video_studio_saved_exports()}
							</h3>
							{#each persistedExports as savedExport (savedExport.id)}
								<div class="flex min-h-11 items-center gap-3 rounded-md border px-3">
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm font-medium">
											{variantOptions.find((item) => item.value === savedExport.variant_id)
												?.label ?? savedExport.variant_id}
										</span>
										<span class="block text-xs text-muted-foreground">
											{formatBytes(savedExport.size_bytes)}
										</span>
									</span>
									<Button
										variant="outline"
										size="sm"
										onclick={() => void downloadPersistedExport(savedExport.path, savedExport.name)}
									>
										<DownloadIcon class="size-4" />
										{m.video_studio_export_download()}
									</Button>
								</div>
							{/each}
							{#if returnToken}
								<Button
									class="w-full"
									disabled={returningToComposer}
									onclick={() => void returnPersistedExportsToComposer()}
								>
									{#if returningToComposer}<LoaderIcon class="size-4 animate-spin" />{/if}
									{m.video_studio_use_saved_export()}
								</Button>
							{/if}
						</section>
					{/if}
				</div>
			</main>
		{/if}
	</div>

	<Dialog.Root bind:open={revisionOpen}>
		<Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
			<Dialog.Header>
				<Dialog.Title>{m.video_studio_history()}</Dialog.Title>
				<Dialog.Description>{m.video_studio_history_description()}</Dialog.Description>
			</Dialog.Header>
			<form
				class="flex items-end gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void createNamedCheckpoint();
				}}
			>
				<label class="grid min-w-0 flex-1 gap-1.5 text-sm font-medium">
					<span>{m.video_studio_checkpoint_name()}</span>
					<Input
						bind:value={checkpointName}
						maxlength={100}
						placeholder={m.video_studio_checkpoint_placeholder()}
						disabled={revisionBusy}
					/>
				</label>
				<Button type="submit" disabled={revisionBusy || !checkpointName.trim()}>
					{m.video_studio_checkpoint_create()}
				</Button>
			</form>
			{#if revisionBusy}
				<div class="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
					<LoaderIcon class="mr-2 size-4 animate-spin" />
					{m.common_loading()}
				</div>
			{:else}
				<div class="grid gap-4">
					<section class="grid gap-2" aria-labelledby="local-history-title">
						<h3 id="local-history-title" class="text-sm font-medium">
							{m.video_studio_history_local()}
						</h3>
						{#if localRevisions.length === 0}
							<p class="text-sm text-muted-foreground">{m.video_studio_history_empty()}</p>
						{:else}
							<div class="grid gap-1">
								{#each localRevisions as revision (revision.id)}
									<div class="flex min-h-11 items-center gap-3 rounded-md border px-3">
										<span class="min-w-0 flex-1">
											<span class="block truncate text-sm font-medium">
												{revision.name ||
													m.video_studio_history_autosave({ revision: revision.revision })}
											</span>
											<span class="block text-xs text-muted-foreground">
												{revisionDate(revision.created_at)}
											</span>
										</span>
										<Button
											variant="ghost"
											size="sm"
											onclick={() => void restoreLocalProjectRevision(revision.id)}
										>
											{m.video_studio_restore()}
										</Button>
									</div>
								{/each}
							</div>
						{/if}
					</section>
					{#if localProject.cloud_project_id}
						<section class="grid gap-2 border-t pt-4" aria-labelledby="cloud-history-title">
							<h3 id="cloud-history-title" class="text-sm font-medium">
								{m.video_studio_history_cloud()}
							</h3>
							{#if cloudRevisions.length === 0}
								<p class="text-sm text-muted-foreground">{m.video_studio_history_empty()}</p>
							{:else}
								<div class="grid gap-1">
									{#each cloudRevisions as revision (revision.id)}
										<div class="flex min-h-11 items-center gap-3 rounded-md border px-3">
											<span class="min-w-0 flex-1">
												<span class="block truncate text-sm font-medium">
													{revision.name ||
														m.video_studio_history_autosave({ revision: revision.revision })}
												</span>
												<span class="block text-xs text-muted-foreground">
													{revisionDate(revision.created_at)}
												</span>
											</span>
											<Button
												variant="ghost"
												size="sm"
												onclick={() => void restoreCloudRevision(revision.id)}
											>
												{m.video_studio_restore()}
											</Button>
										</div>
									{/each}
								</div>
							{/if}
						</section>
					{/if}
				</div>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (revisionOpen = false)}>
					{m.common_close()}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={cloudConflictOpen}>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>{m.video_studio_conflict_title()}</Dialog.Title>
				<Dialog.Description>{m.video_studio_cloud_conflict()}</Dialog.Description>
			</Dialog.Header>
			<InlineNotice tone="warning" message={m.video_studio_conflict_preserved()} />
			<Dialog.Footer>
				<Button
					variant="outline"
					disabled={cloudBusy}
					onclick={() => void saveCloudConflictAsCopy()}
				>
					{m.video_studio_conflict_save_copy()}
				</Button>
				<Button disabled={cloudBusy} onclick={() => void reloadCloudProject()}>
					{#if cloudBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
					{m.video_studio_conflict_reload()}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={modelConsentOpen}>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>{m.video_studio_model_consent_title()}</Dialog.Title>
				<Dialog.Description>{m.video_studio_model_consent_description()}</Dialog.Description>
			</Dialog.Header>
			{@const consentModel = videoStudioConfig?.model_manifest?.find((item) =>
				pendingAnalysis === 'transcript'
					? item.id === 'whisper-tiny-multilingual'
					: item.id === 'silero-vad'
			)}
			<div class="space-y-3 rounded-md border bg-muted/20 p-3 text-sm">
				<p class="font-medium">
					{pendingAnalysis === 'transcript'
						? m.video_studio_model_transcription()
						: m.video_studio_model_vad()}
				</p>
				<p>
					{m.video_studio_model_download_size({ size: formatBytes(consentModel?.size_bytes ?? 0) })}
				</p>
				<p>
					{m.video_studio_model_runtime_size({
						backend: analysisBackend,
						size: formatBytes(
							analysisBackend === 'WebGPU'
								? (consentModel?.runtime_bytes_webgpu ?? 0)
								: (consentModel?.runtime_bytes_wasm ?? 0)
						)
					})}
				</p>
				<p class="text-xs leading-5 text-muted-foreground">
					{m.video_studio_model_resume()}
				</p>
				<p class="text-xs leading-5 text-muted-foreground">
					{m.video_studio_model_privacy()}
				</p>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (modelConsentOpen = false)}>
					{m.video_studio_close()}
				</Button>
				<Button onclick={() => void consentAndRunAnalysis()}>
					<DownloadIcon class="size-4" />
					{m.video_studio_model_download()}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<ExportDialog
		bind:open={exportOpen}
		{project}
		{exportVariantIDs}
		{requiredVariantIDs}
		{returnToken}
		{exportBusy}
		{returningToComposer}
		{exportError}
		{exportFormat}
		{exportCapabilityState}
		{exportCapabilityError}
		{exportProgress}
		{exportFile}
		{exportURL}
		{exportedFiles}
		onSetVariant={setExportVariant}
		onSetFormat={setExportFormat}
		onSaveFile={saveExportFile}
		onCancel={cancelExport}
		onReturnToComposer={returnExportsToComposer}
		onStart={() => startExport(true)}
	/>

	<Dialog.Root bind:open={cloudOpen}>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>{m.video_studio_cloud_title()}</Dialog.Title>
				<Dialog.Description>{m.video_studio_cloud_description()}</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm">
				<p>
					{m.video_studio_cloud_source_count({
						count: Object.values(project.sources).filter(
							(source) => source.locator.type === 'local-opfs'
						).length
					})}
				</p>
				<p class="font-medium">
					{m.video_studio_cloud_estimate({ size: formatBytes(cloudBytes) })}
				</p>
			</div>
			{#if cloudProgress}
				<div class="space-y-2 py-2" aria-live="polite">
					<div class="h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full bg-primary transition-[width]"
							style:width={`${Math.round(cloudProgress.fraction * 100)}%`}
						></div>
					</div>
					<p class="text-xs text-muted-foreground">
						{cloudProgress.stage === 'saving'
							? m.video_studio_saving()
							: m.video_studio_cloud_syncing()}
						{cloudProgress.source_name ? ` · ${cloudProgress.source_name}` : ''}
					</p>
				</div>
			{/if}
			<Dialog.Footer>
				<Button variant="outline" disabled={cloudBusy} onclick={() => (cloudOpen = false)}>
					{m.video_studio_close()}
				</Button>
				<Button disabled={cloudBusy} onclick={() => void saveToCloud()}>
					{#if cloudBusy}
						<LoaderIcon class="size-4 animate-spin" />
					{:else}
						<SaveIcon class="size-4" />
					{/if}
					{m.video_studio_cloud_start()}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
