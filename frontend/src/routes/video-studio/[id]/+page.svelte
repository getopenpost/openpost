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
		cloneVideoProject,
		defaultClipAudio,
		defaultVideoPresentation,
		detachPrimaryClipAudio,
		derivePrimarySequence,
		duplicatePrimaryClip,
		insertFreezeFrame,
		projectDurationUS,
		removePrimaryRanges,
		reorderPrimaryClip,
		setClipSpeed,
		setVariantPresentationOverride,
		splitPrimaryClip,
		validateVideoProject,
		type TransitionKind,
		type CaptionCue,
		type ShapeStyle,
		type VideoEffect,
		type VideoProjectDocumentV1,
		type VideoSource,
		type VariantID,
		type VisualTrack,
		type VisualTrackItem
	} from '@openpost/video-project';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
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
	import { m } from '$lib/paraglide/messages';
	import { addFileToProject, addRecordingToProject, formatBytes } from '$lib/video-studio/project';
	import { exportVideoProject } from '$lib/video-studio/exporter';
	import {
		BUNDLED_AUDIO_ITEMS,
		renderBundledAudio,
		type BundledAudioItem
	} from '$lib/video-studio/bundled-audio';
	import { syncVideoProjectToOpenPost, type CloudSyncProgress } from '$lib/video-studio/cloud-sync';
	import {
		deleteRecording,
		estimateStorageBudget,
		listProjectRevisions,
		listRecoverableRecordings,
		loadLocalVideoProject,
		requestPersistentVideoStorage,
		restoreLocalRevision,
		saveLocalVideoProject
	} from '$lib/video-studio/storage';
	import { VideoRecordingSession, type RecordingSessionState } from '$lib/video-studio/recorder';
	import type {
		LocalProjectRevision,
		LocalVideoProject,
		RecordingManifest
	} from '$lib/video-studio/types';
	import Timeline from '$lib/video-studio/components/timeline.svelte';
	import VideoPreview from '$lib/video-studio/components/video-preview.svelte';
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
	import PlayIcon from 'lucide-svelte/icons/play';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import RedoIcon from 'lucide-svelte/icons/redo-2';
	import SaveIcon from 'lucide-svelte/icons/save';
	import ShapesIcon from 'lucide-svelte/icons/shapes';
	import SparklesIcon from 'lucide-svelte/icons/sparkles';
	import TextIcon from 'lucide-svelte/icons/type';
	import UndoIcon from 'lucide-svelte/icons/undo-2';
	import VolumeIcon from 'lucide-svelte/icons/volume-2';
	import WandIcon from 'lucide-svelte/icons/wand-sparkles';

	type ToolID =
		| 'media'
		| 'record'
		| 'stock'
		| 'text'
		| 'captions'
		| 'audio'
		| 'elements'
		| 'transitions'
		| 'smart'
		| 'brand';

	const tools = [
		{ id: 'media', label: () => m.video_studio_tool_media(), icon: FilmIcon },
		{ id: 'record', label: () => m.video_studio_tool_record(), icon: MonitorIcon },
		{ id: 'stock', label: () => m.video_studio_tool_stock(), icon: ImageIcon },
		{ id: 'text', label: () => m.video_studio_tool_text(), icon: TextIcon },
		{ id: 'captions', label: () => m.video_studio_tool_captions(), icon: CaptionsIcon },
		{ id: 'audio', label: () => m.video_studio_tool_audio(), icon: MicIcon },
		{ id: 'elements', label: () => m.video_studio_tool_elements(), icon: ShapesIcon },
		{ id: 'transitions', label: () => m.video_studio_tool_transitions(), icon: LayersIcon },
		{ id: 'smart', label: () => m.video_studio_tool_smart(), icon: WandIcon },
		{ id: 'brand', label: () => m.video_studio_tool_brand(), icon: SparklesIcon }
	] satisfies Array<{ id: ToolID; label: () => string; icon: typeof FilmIcon }>;

	const variantOptions = [
		{ value: 'portrait', label: m.video_studio_variant_portrait() },
		{ value: 'feed-portrait', label: m.video_studio_variant_feed() },
		{ value: 'square', label: m.video_studio_variant_square() },
		{ value: 'landscape', label: m.video_studio_variant_landscape() }
	];
	const transitionOptions = [
		{ value: 'cut', label: m.video_studio_transition_none() },
		{ value: 'cross-dissolve', label: 'Cross dissolve' },
		{ value: 'dip-black', label: 'Dip to black' },
		{ value: 'dip-white', label: 'Dip to white' },
		{ value: 'slide', label: 'Slide' },
		{ value: 'push', label: 'Push' },
		{ value: 'zoom-blur', label: 'Zoom blur' }
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
	let returningToComposer = $state(false);
	let videoStudioConfig = $state<VideoStudioConfig | null>(null);
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
	const selectedClip = $derived(
		project?.primary_sequence.find((clip) => clip.id === selectedClipID)
	);
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

	onMount(() => {
		void initialize();
		window.addEventListener('keydown', handleKeyboard);
		return () => window.removeEventListener('keydown', handleKeyboard);
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
			videoStudioConfig = await loadVideoStudioConfig();
			const loaded = await loadLocalVideoProject(page.params.id ?? '');
			localProject = loaded;
			selectedExportVariants = [variantID];
			selectedClipID = loaded.document.primary_sequence[0]?.id ?? '';
			const recordings = await listRecoverableRecordings();
			recoverableRecording =
				recordings.find((manifest) => manifest.project_id === loaded.id) ?? null;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_project_missing();
		} finally {
			loading = false;
		}
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
			'Rename project',
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
			`Change ${property}`,
			(document) => {
				const clip = document.primary_sequence.find((item) => item.id === selectedClipID);
				if (!clip) return document;
				if (property === 'gain_db') clip.audio.gain_db = value;
				else if (editShared) clip.video[property] = value;
				else {
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
				const clip = document.primary_sequence.find((item) => item.id === selectedClipID);
				if (!clip) return document;
				if (editShared) {
					clip.video.position_x = x;
					clip.video.position_y = y;
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

	function updateSpeed(value: number): void {
		if (!selectedClipID || !localProject) return;
		mutate(
			m.video_studio_clip_speed(),
			(document) => setClipSpeed(document, selectedClipID, value),
			`${selectedClipID}:speed`
		);
	}

	function updateMute(checked: boolean): void {
		mutate('Mute clip', (document) => {
			const clip = document.primary_sequence.find((item) => item.id === selectedClipID);
			if (clip) clip.audio.muted = checked;
			return document;
		});
	}

	function updateClipAudioTiming(property: 'fade_in_us' | 'fade_out_us', seconds: number): void {
		mutate(
			property === 'fade_in_us' ? m.video_studio_fade_in() : m.video_studio_fade_out(),
			(document) => {
				const clip = document.primary_sequence.find((item) => item.id === selectedClipID);
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
			`Change ${type}`,
			(document) => {
				const clip = document.primary_sequence.find((item) => item.id === selectedClipID);
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
			if (value === 'cut') {
				delete clip.transition_out;
				if (document.primary_sequence[index + 1]) {
					delete document.primary_sequence[index + 1]!.transition_in;
				}
			} else {
				const transition = {
					type: value as TransitionKind,
					duration_us: 350_000,
					easing: 'ease-in-out' as const
				};
				clip.transition_out = transition;
				if (document.primary_sequence[index + 1]) {
					document.primary_sequence[index + 1]!.transition_in = { ...transition };
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
				targetLUFS: -14,
				onProgress: (progress) => (audioNormalizeProgress = progress)
			});
			if (adjustments.length === 0) {
				throw new Error(m.video_studio_normalize_no_audio());
			}
			mutate(m.video_studio_normalize_audio(), (document) => {
				for (const adjustment of adjustments) {
					if (adjustment.kind === 'primary') {
						const clip = document.primary_sequence.find((item) => item.id === adjustment.item_id);
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
			const file = renderBundledAudio(item);
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

	function addText(): void {
		mutate(m.video_studio_add_text(), (document) => {
			const track = firstVisualTrack(document);
			track.items.push({
				id: `text_${crypto.randomUUID()}`,
				type: 'text',
				text: m.video_studio_text_default(),
				timeline_start_us: playheadUS,
				duration_us: Math.min(
					5_000_000,
					Math.max(1_000_000, projectDurationUS(document) - playheadUS)
				),
				visible: true,
				style: {
					font_family: 'Geist Variable',
					font_size: 72,
					font_weight: 700,
					color: '#ffffff',
					align: 'center',
					background_color: '#00000000',
					outline_color: '#000000',
					outline_width: 0,
					shadow_blur: 12,
					animation: 'rise'
				},
				presentation: defaultOverlayPresentation()
			});
			return document;
		});
	}

	function addShape(kind: ShapeStyle['kind']): void {
		mutate(m.video_studio_add_shape(), (document) => {
			const track = firstVisualTrack(document);
			track.items.push({
				id: `shape_${crypto.randomUUID()}`,
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
	}

	function addCaption(): void {
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
				id: `cue_${crypto.randomUUID()}`,
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
				if (cue) cue.text = value.slice(0, 500);
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
				cue.text = cue.text.split(search).join(captionReplacement);
			}
			return document;
		});
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
				const clip = next.primary_sequence.find((item) => item.id === suggestion.clip_id);
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
				onState: (state) => (recordingState = state)
			});
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

	async function stopEditorRecording(): Promise<void> {
		if (!localProject || !recordingSession || recordBusy) return;
		recordBusy = true;
		try {
			const manifest = await recordingSession.stop();
			const draft = { ...localProject, document: cloneVideoProject(localProject.document) };
			await addRecordingToProject(draft, manifest);
			localProject = draft;
			selectedClipID ||= draft.document.primary_sequence.at(-1)?.id ?? '';
			mutationVersion += 1;
			await flushAutosave();
			await deleteRecording(manifest);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_studio_recording_failed();
		} finally {
			recordingSession = null;
			recordingKind = null;
			recordingState = null;
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
			rippleDeleteSelected();
		} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		} else if (
			['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
			(event.metaKey || event.ctrlKey) &&
			selectedClip
		) {
			event.preventDefault();
			const amount = event.shiftKey ? 0.05 : 0.01;
			updateClipPosition(
				selectedPresentation!.position_x +
					(event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
				selectedPresentation!.position_y +
					(event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0)
			);
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
		const draft = { ...localProject, document: cloneVideoProject(localProject.document) };
		await addRecordingToProject(draft, recoverableRecording);
		localProject = draft;
		mutationVersion += 1;
		await flushAutosave();
		await deleteRecording(recoverableRecording);
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

	async function startExport(): Promise<Partial<Record<VariantID, File>>> {
		if (!project || exportBusy || project.primary_sequence.length === 0) return {};
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
					signal: exportController.signal,
					onProgress: (fraction) =>
						(exportProgress = Math.max(0, Math.min(1, (index + fraction) / variants.length)))
				});
				files[currentVariant] = file;
			}
			exportedFiles = files;
			exportURLs = Object.fromEntries(
				Object.entries(files).map(([id, file]) => [id, URL.createObjectURL(file!)])
			) as Partial<Record<VariantID, string>>;
			exportFile = files[variantID] ?? files[variants[0]!] ?? null;
			exportURL = exportFile ? (exportURLs[variantID] ?? exportURLs[variants[0]!] ?? '') : '';
			exportProgress = 1;
		} catch (cause) {
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

	function cancelExport(): void {
		exportController?.abort(new DOMException('Export cancelled.', 'AbortError'));
	}

	function selectedTransition(): string {
		return selectedClip?.transition_out?.type ?? 'cut';
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
			name: 'Overlays',
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
					disabled={!history.canUndo || historyVersion < 0}
					onclick={undo}
					aria-label={m.video_studio_undo()}
					title={history.undoLabel || m.video_studio_undo()}
				>
					<UndoIcon class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={!history.canRedo || historyVersion < 0}
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
			<Button variant="outline" size="sm" onclick={cloudAction}>
				<CloudIcon class="size-4" />
				<span class="hidden lg:inline">{m.video_studio_save_cloud()}</span>
			</Button>
			<Button
				size="sm"
				onclick={() => {
					selectedExportVariants ||= [variantID];
					exportOpen = true;
				}}
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

		<div class="hidden min-h-0 flex-1 grid-cols-[4.5rem_17rem_minmax(20rem,1fr)_18rem] lg:grid">
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
						onclick={() => (activeTool = tool.id)}
					>
						<tool.icon class="size-4.5" />
						<span>{tool.label()}</span>
					</button>
				{/each}
			</nav>

			<aside
				class="min-h-0 overflow-y-auto border-r bg-muted/15 p-3"
				aria-label={tools.find((tool) => tool.id === activeTool)?.label()}
			>
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
										{source.kind} ·
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
						<Button class="w-full" onclick={addText}>
							<TextIcon class="size-4" />
							{m.video_studio_add_title()}
						</Button>
						<p class="text-xs leading-5 text-muted-foreground">
							Use the preview to place text. Timing appears in the overlay lane.
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
									<Button class="w-full" size="sm" variant="outline" onclick={applySelectedFillers}>
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
											silenceAnalysis.silences.reduce((total, item) => total + item.duration_us, 0)
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
								Transitions are bounded to half the length of each adjoining clip.
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
								<Button
									class="w-full"
									variant="destructive"
									disabled={recordBusy}
									onclick={() => void stopEditorRecording()}
								>
									{#if recordBusy}<LoaderIcon class="size-4 animate-spin" />{/if}
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
								{m.video_studio_record_screen()}
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
														preset[0] as 'circle' | 'rounded' | 'portrait' | 'side-by-side' | 'full'
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

			<main class="grid min-h-0 grid-rows-[minmax(0,1fr)_3.25rem] bg-[#121214]">
				<VideoPreview
					{project}
					{variantID}
					{playheadUS}
					{playing}
					{selectedClipID}
					onSelectClip={(clipID) => (selectedClipID = clipID)}
					onTransform={updateClipPosition}
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
				class="min-h-0 overflow-y-auto border-l bg-background p-3"
				aria-label={m.video_studio_inspector()}
			>
				<h2 class="text-sm font-semibold">{m.video_studio_inspector()}</h2>
				{#if selectedClip}
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
							<Checkbox bind:checked={editShared} aria-label={m.video_studio_selection_shared()} />
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
							<p class="pb-2 leading-5 text-muted-foreground">
								Point keyframes for position, scale, rotation, opacity, crop, blur, and volume use
								the same evaluator as export.
							</p>
						</details>
					</div>
				{:else}
					<p class="mt-4 text-xs leading-5 text-muted-foreground">
						{m.video_studio_no_selection()}
					</p>
				{/if}
			</aside>
		</div>

		<div class="hidden min-h-52 shrink-0 lg:block">
			<Timeline
				{project}
				projectID={localProject?.id ?? ''}
				bind:playheadUS
				bind:zoom={timelineZoom}
				{selectedClipID}
				onSelectClip={(clipID) => (selectedClipID = clipID)}
				onSplit={splitSelected}
				onRippleDelete={rippleDeleteSelected}
				onMove={moveSelectedClip}
				onReorder={reorderClip}
			/>
		</div>

		<main class="flex min-h-0 flex-1 flex-col lg:hidden">
			<div class="min-h-0 flex-1">
				<VideoPreview
					{project}
					{variantID}
					{playheadUS}
					playing={false}
					{selectedClipID}
					onSelectClip={(clipID) => (selectedClipID = clipID)}
				/>
			</div>
			<div class="space-y-3 border-t p-4">
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
			</div>
		</main>
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

	<Dialog.Root bind:open={exportOpen}>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>{m.video_studio_export_title()}</Dialog.Title>
				<Dialog.Description>{m.video_studio_export_description()}</Dialog.Description>
			</Dialog.Header>
			<div class="space-y-4 py-2">
				{#if project.primary_sequence.length === 0}
					<InlineNotice tone="warning" message={m.video_studio_export_no_video()} />
				{/if}
				{#if exportError}
					<InlineNotice tone="error" message={exportError} />
				{/if}
				<fieldset class="grid gap-2">
					<legend class="mb-1 text-sm font-medium">{m.video_studio_export_formats()}</legend>
					{#each variantOptions as option (option.value)}
						{@const target = option.value as VariantID}
						{@const variant = project.variants.find((item) => item.id === target)}
						<label
							class="flex min-h-11 items-center gap-3 rounded-md border bg-muted/20 px-3 text-sm"
						>
							<Checkbox
								checked={exportVariantIDs.includes(target)}
								disabled={Boolean(returnToken) || exportBusy}
								onCheckedChange={(checked) => setExportVariant(target, checked)}
							/>
							<span class="min-w-0 flex-1">
								<span class="block font-medium">{option.label}</span>
								<span class="block text-xs text-muted-foreground">
									{variant?.width}×{variant?.height} · {project.timebase.fps_numerator} fps
								</span>
							</span>
							{#if returnToken && requiredVariantIDs.includes(target)}
								<span class="text-xs text-muted-foreground">{m.video_studio_export_required()}</span
								>
							{/if}
						</label>
					{/each}
				</fieldset>
				<label class="grid gap-1.5 text-sm font-medium">
					<span>{m.video_studio_export_format()}</span>
					<AppSelect
						value={returnToken ? 'mp4' : exportFormat}
						onValueChange={(value) => (exportFormat = value as 'mp4' | 'webm')}
						disabled={exportBusy || Boolean(returnToken)}
						options={[
							{ value: 'mp4', label: m.video_studio_export_mp4() },
							{ value: 'webm', label: m.video_studio_export_webm() }
						]}
					/>
				</label>
				{#if exportBusy || returningToComposer}
					<div class="space-y-2" aria-live="polite">
						<div class="h-2 overflow-hidden rounded-full bg-muted">
							<div
								class="h-full bg-primary transition-[width]"
								style:width={`${Math.round(exportProgress * 100)}%`}
							></div>
						</div>
						<p class="text-xs text-muted-foreground">
							{m.video_studio_export_progress({ progress: Math.round(exportProgress * 100) })}
						</p>
					</div>
				{:else if exportFile && exportURL}
					<InlineNotice
						tone="success"
						message={`${m.video_studio_export_ready()} · ${formatBytes(exportFile.size)}`}
					/>
					{#if !returnToken && Object.keys(exportedFiles).length > 1}
						<div class="grid gap-2">
							{#each variantOptions as option (option.value)}
								{@const completedFile = exportedFiles[option.value as VariantID]}
								{#if completedFile}
									<div class="flex min-h-11 items-center gap-3 rounded-md border px-3">
										<span class="min-w-0 flex-1">
											<span class="block text-sm font-medium">{option.label}</span>
											<span class="block text-xs text-muted-foreground">
												{formatBytes(completedFile.size)}
											</span>
										</span>
										<Button
											variant="outline"
											size="sm"
											onclick={() => void saveExportFile(completedFile)}
										>
											<DownloadIcon class="size-4" />
											{m.video_studio_export_download()}
										</Button>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				{/if}
			</div>
			<Dialog.Footer>
				{#if exportBusy || returningToComposer}
					<Button variant="outline" onclick={cancelExport}>
						{m.video_studio_export_cancel()}
					</Button>
				{:else}
					<Button variant="outline" onclick={() => (exportOpen = false)}>
						{m.video_studio_close()}
					</Button>
					{#if returnToken && Object.keys(exportedFiles).length > 0}
						<Button onclick={() => void returnExportsToComposer()}>
							<CheckIcon class="size-4" />
							{m.video_studio_use_in_post()}
						</Button>
					{:else if exportFile && exportURL && Object.keys(exportedFiles).length === 1}
						<Button onclick={() => void saveExportFile(exportFile!)}>
							<DownloadIcon class="size-4" />
							{m.video_studio_export_download()}
						</Button>
					{:else}
						<Button
							disabled={project.primary_sequence.length === 0 || exportVariantIDs.length === 0}
							onclick={() => void startExport()}
						>
							<DownloadIcon class="size-4" />
							{returnToken ? m.video_studio_export_for_post() : m.video_studio_export_start()}
						</Button>
					{/if}
				{/if}
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

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
