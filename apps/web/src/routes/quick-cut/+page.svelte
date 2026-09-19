<!--
Quick Cut: fast lossless trimming. Open a file, mark in/out, export the
selected range without re-encoding (mediabunny stream copy). UX inspired by
LosslessCut (GPL - behavioral reference only, no code ported).
-->
<script lang="ts">
	import EditorHeader from '$lib/components/editor-header.svelte';
	import { Input } from '$lib/components/ui/input';
	import TranscriptCutPanel from '$lib/quick-cut/components/TranscriptCutPanel.svelte';
	import CleanupPanel from '$lib/quick-cut/components/CleanupPanel.svelte';
	import { removeSourceRanges } from '$lib/quick-cut/range-edit';
	import { EditorHistory } from '$lib/editor-history';
	import { page } from '$app/state';
	import { loadWorkspaceMediaFile } from '$lib/video-editor/media/workspace-source';
	import { resolveAppPath } from '$lib/app-path';
	import type { QuickCutMarker } from '$lib/quick-cut/types';
	import type { AudioSilenceRange } from '$lib/video-editor/audio/audio-silence';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Label } from '$lib/components/ui/label';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import Logo from '$lib/components/Logo.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { dismissToast, showToast } from '$lib/toast';
	import { onDestroy, tick, untrack } from 'svelte';
	import SegmentList from '$lib/quick-cut/components/SegmentList.svelte';
	import TimelineBar from '$lib/quick-cut/components/TimelineBar.svelte';
	import ExportPanel from '$lib/quick-cut/components/ExportPanel.svelte';
	import StreamSelector from '$lib/quick-cut/components/StreamSelector.svelte';
	import SourceBar from '$lib/quick-cut/components/SourceBar.svelte';
	import {
		createSegment,
		MIN_SEGMENT_DURATION_SECONDS,
		validateSegment,
		validateSegments,
		hasOverlap,
		normalizeSegments,
		reorderSegment,
		formatTimecode,
		segmentsOutsideMarkedRanges
	} from '$lib/quick-cut/model';
	import { probeSourceFile } from '$lib/quick-cut/source';
	import {
		preflightExport,
		exportSegments,
		copyScratchToWorkspace,
		discardScratchFile
	} from '$lib/quick-cut/export';
	import type {
		QuickCutSource,
		QuickCutSourceMetadata,
		QuickCutSegment,
		CutMode,
		LoopMode
	} from '$lib/quick-cut/types';
	import type { PreflightResult, QuickCutExportProgress } from '$lib/quick-cut/export';
	import {
		createNewProject,
		saveProjectToWorkspace,
		serializeProject,
		deserializeProject,
		deleteProjectFromWorkspace,
		projectFileName,
		persistSourceHandles,
		reconcileSourceAfterProbe,
		snapshotProject
	} from '$lib/quick-cut/project';
	import { prepareSourceRemoval, type SourceRemovalPlan } from '$lib/quick-cut/source-removal';
	import type { QuickCutProject } from '$lib/quick-cut/types';
	import { getWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
	import { deleteHandle } from '$lib/video-editor/workspace-fs/handles-db';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { sendToOpenPost } from '$lib/video-editor/send-to-openpost';
	import {
		editorShortcutTargetIsDisabled,
		formatShortcutBinding,
		handleGlobalPlayPauseShortcut
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import {
		formatSegmentInterchange,
		inferSegmentInterchangeFormat,
		parseSegmentInterchange,
		type SegmentInterchangeFormat
	} from '$lib/quick-cut/interchange';
	import {
		captureVideoFrame,
		frameCaptureFileName,
		type FrameCaptureFormat
	} from '$lib/quick-cut/frame-capture';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { quickCutShortcutAction } from '$lib/quick-cut/shortcuts';
	import {
		listQuickCutCloudProjects,
		loadQuickCutCloudProject,
		quickCutCloudRepository,
		syncQuickCutCloudProject,
		type QuickCutCloudDocument,
		type QuickCutCloudSession
	} from '$lib/quick-cut/cloud-project';
	import {
		CloudVideoProjectConflictError,
		type CloudVideoProject
	} from '$lib/video-editor/cloud/project-repository';

	let sources = $state<QuickCutSource[]>([]);
	let sourceUrls = $state<Map<string, string>>(new Map());
	let activeSourceId = $state<string | null>(null);
	let segments = $state<QuickCutSegment[]>([]);
	let selectedId = $state<string | null>(null);
	let cutMode = $state<CutMode>('nearestKeyframe');
	let merge = $state(true);
	let panel = $state<'cuts' | 'transcript' | 'cleanup' | 'markers' | 'export'>('cuts');
	let markers = $state<QuickCutMarker[]>([]);
	let reviewRanges = $state<AudioSilenceRange[]>([]);
	let reviewEnd: number | null = null;
	let sentExports = $state<Array<{ name: string; href: string }>>([]);
	let sourceRequest = '';
	let importingSource = $state(false);
	const history = new EditorHistory<string>((value) => value);
	let historyState = '';
	let canUndo = $state(false);
	let canRedo = $state(false);
	let removeMarkedRanges = $state(false);
	let loopMode = $state<LoopMode>('off');
	let inPoint = $state<{ sourceId: string; time: number } | null>(null);
	let outPoint = $state<{ sourceId: string; time: number } | null>(null);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let currentTime = $state(0);
	let playing = $state(false);
	let exporting = $state(false);
	let exportProgress = $state<QuickCutExportProgress | null>(null);
	let abortController = $state<AbortController | null>(null);
	let project = $state<QuickCutProject | null>(null);
	let storageMode = $state<'cloud' | 'local'>('cloud');
	let storageModeChosen = $state(false);
	let cloudSession = $state.raw<QuickCutCloudSession | null>(null);
	let cloudProjects = $state.raw<Array<CloudVideoProject<QuickCutCloudDocument>>>([]);
	let cloudLoading = $state(false);
	let cloudOpeningId = $state<string | null>(null);
	let cloudError = $state('');
	let cloudConflictId = $state<string | null>(null);
	let cloudConflictWorking = $state(false);
	let cloudLoadGeneration = 0;
	let workspaceName = $state<string | null>(null);
	let videoSrc = $state<string>('');
	let previewRun = $state<{
		generation: number;
		segments: QuickCutSegment[];
		index: number;
		repeat: boolean;
	} | null>(null);
	let previewGeneration = 0;
	let individualPreflight = $state<PreflightResult | null>(null);
	let mergedPreflight = $state<PreflightResult | null>(null);
	let preflightGeneration = 0;
	let previewWait: AbortController | null = null;
	let sourceRemovalDialogOpen = $state(false);
	let segmentValidationToastId: string | number | null = null;
	let pendingSourceRemoval = $state<QuickCutSource | null>(null);
	let capturingFrame = $state(false);
	const cloudWorkspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const cloudRepository = $derived(
		cloudWorkspaceId ? quickCutCloudRepository(cloudWorkspaceId) : null
	);

	const activeSource = $derived(sources.find((s) => s.id === activeSourceId) ?? sources[0] ?? null);
	const canCaptureFrame = $derived(
		Boolean(
			activeSource &&
			activeSource.videoStreams.length > 0 &&
			activeSource.selectedVideoTrackIndex !== null
		)
	);
	const selectedSegment = $derived(segments.find((s) => s.id === selectedId) ?? null);
	const enabledSegments = $derived(segments.filter((segment) => segment.enabled !== false));
	const segmentsForExport = $derived(
		removeMarkedRanges ? segmentsOutsideMarkedRanges(segments, sources) : enabledSegments
	);
	const validationErrors = $derived(validateSegments(enabledSegments, 0, sources));
	const hasOverlapError = $derived(validationErrors.some((e) => e.kind === 'overlap'));
	const preflight = $derived(merge ? mergedPreflight : individualPreflight);
	const pendingSourceSegmentCount = $derived(
		pendingSourceRemoval
			? segments.filter((segment) => segment.sourceId === pendingSourceRemoval?.id).length
			: 0
	);

	$effect(() => {
		const requestSources = sources.slice();
		const requestSegments = segmentsForExport.map((segment) => ({ ...segment }));
		const requestCutMode = cutMode;
		const generation = ++preflightGeneration;
		individualPreflight = null;
		mergedPreflight = null;
		void Promise.all([
			preflightExport(requestSources, requestSegments, requestCutMode, false),
			preflightExport(requestSources, requestSegments, requestCutMode, true)
		]).then(([individual, merged]) => {
			if (generation === preflightGeneration) {
				individualPreflight = individual;
				mergedPreflight = merged;
			}
		});
		return () => {
			if (generation === preflightGeneration) preflightGeneration += 1;
		};
	});

	function updateWorkspaceName() {
		workspaceName = getWorkspaceRoot()?.name ?? null;
	}
	$effect(() => {
		updateWorkspaceName();
	});

	$effect(() => {
		const repository = cloudRepository;
		if (!repository) {
			cloudLoadGeneration += 1;
			cloudProjects = [];
			if (!storageModeChosen) storageMode = 'local';
			return;
		}
		if (!storageModeChosen) storageMode = 'cloud';
		untrack(() => void loadCloudProjectList(repository));
	});

	$effect(() => {
		const source = page.url.searchParams.get('source');
		const workspaceId = cloudWorkspaceId;
		if (!workspaceId || !source?.startsWith('media:') || untrack(() => sourceRequest === source))
			return;
		sourceRequest = source;
		const controller = new AbortController();
		untrack(() => void importWorkspaceSource(workspaceId, source.slice(6), controller.signal));
		return () => controller.abort();
	});
	async function importWorkspaceSource(
		workspaceId: string,
		mediaId: string,
		signal: AbortSignal
	): Promise<void> {
		importingSource = true;
		try {
			await addFiles([await loadWorkspaceMediaFile(workspaceId, mediaId, signal)], [], signal);
		} catch (error) {
			if (!signal.aborted)
				showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			importingSource = false;
		}
	}

	async function loadCloudProjectList(repository = cloudRepository): Promise<void> {
		if (!repository) return;
		const generation = ++cloudLoadGeneration;
		cloudLoading = true;
		cloudError = '';
		try {
			const projects = await listQuickCutCloudProjects(repository);
			if (generation === cloudLoadGeneration) cloudProjects = projects;
		} catch (error) {
			if (generation === cloudLoadGeneration) {
				cloudError =
					error instanceof Error ? error.message : m.video_editor_cloud_projects_load_failed();
			}
		} finally {
			if (generation === cloudLoadGeneration) cloudLoading = false;
		}
	}

	function chooseStorage(mode: 'cloud' | 'local'): void {
		storageModeChosen = true;
		storageMode = mode;
		if (project) syncProject();
	}

	async function openCloudProject(
		cloudProject: CloudVideoProject<QuickCutCloudDocument>
	): Promise<void> {
		const repository = cloudRepository;
		if (!repository || cloudOpeningId) return;
		cloudOpeningId = cloudProject.id;
		try {
			const opened = await loadQuickCutCloudProject(repository, cloudProject.id);
			stopPreview();
			clearSourceUrls();
			project = opened.project;
			sources = opened.sources;
			segments = opened.project.segments;
			markers = opened.project.markers ?? [];
			cutMode = opened.project.cutMode;
			merge = opened.project.merge;
			removeMarkedRanges = opened.project.removeMarkedRanges;
			resetHistory();
			activeSourceId = opened.sources[0]?.id ?? null;
			selectedId = opened.project.segments[0]?.id ?? null;
			cloudSession = opened.session;
			storageMode = 'cloud';
			storageModeChosen = true;
			for (const source of opened.sources) {
				if (!source.file) continue;
				const next = new Map(sourceUrls);
				next.set(source.id, URL.createObjectURL(source.file));
				sourceUrls = next;
			}
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			cloudOpeningId = null;
		}
	}

	async function resolveCloudConflict(resolution: 'keep_current' | 'use_conflict'): Promise<void> {
		const repository = cloudRepository;
		const conflictId = cloudConflictId;
		const projectId = cloudSession?.project.id;
		if (!repository || !conflictId || !projectId || cloudConflictWorking) return;
		cloudConflictWorking = true;
		try {
			const resolved = await repository.resolveConflict(projectId, conflictId, resolution);
			cloudConflictId = null;
			cloudSession = null;
			await openCloudProject(resolved);
		} catch (error) {
			showToast(error instanceof Error ? error.message : m.video_editor_restore_failed(), 'error');
		} finally {
			cloudConflictWorking = false;
		}
	}

	$effect(() => {
		if (activeSource) {
			const url = sourceUrls.get(activeSource.id) ?? '';
			videoSrc = url;
		} else {
			videoSrc = '';
		}
	});

	function pickViaInput(): Promise<File[] | null> {
		return new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.multiple = true;
			input.accept = 'video/*,audio/*,.mp4,.webm,.mov,.mkv,.m4v,.mp3,.aac,.wav,.flac,.ogg,.m4a';
			const settle = (files: File[] | null): void => {
				input.remove();
				resolve(files);
			};
			input.onchange = () => settle(input.files ? Array.from(input.files) : null);
			input.oncancel = () => settle(null);
			input.click();
		});
	}

	async function openFiles(): Promise<void> {
		let handles: FileSystemFileHandle[] = [];
		let files: File[] = [];
		if (!window.showOpenFilePicker) {
			const inputFiles = await pickViaInput();
			if (inputFiles) files = inputFiles;
		} else {
			try {
				const picked = await window.showOpenFilePicker({
					multiple: true,
					types: [
						{
							description: 'Media',
							accept: {
								'video/*': ['.mp4', '.webm', '.mov', '.mkv', '.m4v'],
								'audio/*': ['.mp3', '.aac', '.wav', '.flac', '.ogg', '.m4a']
							}
						}
					]
				});
				const arrayPicked = Array.isArray(picked) ? picked : [picked];
				// SAFETY: filtered to FileSystemFileHandle via 'getFile' in check, safe per File System Access spec
				handles = arrayPicked.filter(
					(h): h is FileSystemFileHandle => 'getFile' in h
				) as FileSystemFileHandle[];
				files = await Promise.all(handles.map((h) => h.getFile()));
			} catch (e) {
				if (e instanceof DOMException && e.name === 'AbortError') return;
				showToast(e instanceof Error ? e.message : String(e), 'error');
				return;
			}
			if (files.length === 0) {
				const inputFiles = await pickViaInput();
				if (inputFiles) {
					files = inputFiles;
					handles = [];
				}
			}
		}
		try {
			await addFiles(files, handles);
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}

	async function addFiles(
		files: File[],
		handles: FileSystemFileHandle[] = [],
		signal?: AbortSignal
	): Promise<void> {
		if (files.length === 0) return;
		const imported = await Promise.all(
			files.map((file, index) => probeSourceFile(file, handles[index]))
		);
		signal?.throwIfAborted();
		for (let i = 0; i < files.length; i++) {
			const file = files[i]!;
			const probed = imported[i]!;
			sources = [...sources, probed];
			segments = [...segments, createSegment(0, probed.duration, { sourceId: probed.id })];
			const url = URL.createObjectURL(file);
			const next = new Map(sourceUrls);
			next.set(probed.id, url);
			sourceUrls = next;
			if (!activeSourceId) activeSourceId = probed.id;
		}
		if (!project) resetHistory();
		await persistSourceHandles(sources);
		if (!project) {
			const metas = sources.map((s) => {
				const { handle: _h, file: _f, ...m } = s;
				return m;
			});
			const created = createNewProject(metas);
			created.segments = segments;
			project = created;
		} else {
			project.sources = sources.map((s) => {
				const { handle: _h, file: _f, ...m } = s;
				return m;
			});
		}
		syncProject();
		soundPreferences.play('success');
	}

	function switchActiveSource(id: string, preservePreview = false): void {
		if (id === activeSourceId) return;
		if (!preservePreview) stopPreview();
		activeSourceId = id;
		currentTime = 0;
	}

	function requestSourceRemoval(id: string): void {
		const source = sources.find((candidate) => candidate.id === id);
		if (!source || exporting) return;
		pendingSourceRemoval = source;
		sourceRemovalDialogOpen = true;
	}

	function sourceRemovalDescription(): string {
		if (!pendingSourceRemoval) return '';
		const name = pendingSourceRemoval.name;
		const removal =
			pendingSourceSegmentCount === 0
				? m.quick_cut_remove_source_no_segments({ name })
				: pendingSourceSegmentCount === 1
					? m.quick_cut_remove_source_one_segment({ name })
					: m.quick_cut_remove_source_segments({ name, count: pendingSourceSegmentCount });
		return sources.length === 1 ? `${removal} ${m.quick_cut_remove_last_source_note()}` : removal;
	}

	async function confirmSourceRemoval(): Promise<DestructiveActionOutcome> {
		const target = pendingSourceRemoval;
		if (!target) return { ok: false, message: m.app_destructive_action_failed() };
		let removal: SourceRemovalPlan | null;
		try {
			removal = await prepareSourceRemoval(
				{
					sources,
					segments,
					project,
					targetId: target.id,
					activeSourceId,
					selectedSegmentId: selectedId,
					inPoint,
					outPoint
				},
				async (plan) => {
					await saveQueue;
					if (!project) return;
					const repository = cloudRepository;
					if (storageMode === 'cloud' && repository) {
						if (plan.project) {
							cloudSession = await syncQuickCutCloudProject(
								repository,
								cloudSession,
								plan.project,
								plan.sources
							);
						} else if (cloudSession) {
							await repository.trash(cloudSession.project.id);
							cloudSession = null;
							await loadCloudProjectList(repository);
						}
						return;
					}
					if (!getWorkspaceRoot()) return;
					if (plan.project) await saveProjectToWorkspace(plan.project);
					else await deleteProjectFromWorkspace(project.id);
				}
			);
		} catch (error) {
			return {
				ok: false,
				message: error instanceof Error && error.message ? error.message : m.quick_cut_save_failed()
			};
		}
		if (!removal) return { ok: false, message: m.app_destructive_action_failed() };

		videoEl?.pause();
		stopPreview();
		const removedUrl = sourceUrls.get(removal.removedSource.id);
		if (removedUrl) URL.revokeObjectURL(removedUrl);
		const nextUrls = new Map(sourceUrls);
		nextUrls.delete(removal.removedSource.id);
		sourceUrls = nextUrls;
		sources = removal.sources;
		segments = removal.segments;
		project = removal.project;
		markers = removal.project?.markers ?? [];
		resetHistory();
		if (activeSourceId !== removal.activeSourceId) currentTime = 0;
		activeSourceId = removal.activeSourceId;
		selectedId = removal.selectedSegmentId;
		inPoint = removal.inPoint;
		outPoint = removal.outPoint;
		saveRevision += 1;
		saveState = removal.sources.length === 0 ? 'idle' : 'saved';
		pendingSourceRemoval = null;
		void deleteHandle('media', `quick-cut:${removal.removedSource.id}`).catch(() => undefined);
		soundPreferences.play('success');
		return {
			ok: true,
			successMessage: m.quick_cut_source_removed({ name: removal.removedSource.name })
		};
	}

	function seekTo(seconds: number): void {
		if (!videoEl) return;
		videoEl.currentTime = Math.min(Math.max(0, seconds), activeSource?.duration ?? 0);
	}

	function frameStep(deltaFrames: number): void {
		const fps = activeSource?.fps;
		if (!fps || fps <= 0) {
			showToast(m.quick_cut_frame_unavailable(), 'error');
			return;
		}
		seekTo(currentTime + deltaFrames / fps);
	}

	function downloadBlob(blob: Blob, fileName: string): void {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}

	async function captureCurrentFrame(
		format: FrameCaptureFormat,
		destination: 'download' | 'clipboard' = 'download'
	): Promise<void> {
		if (!videoEl || !activeSource || !canCaptureFrame || capturingFrame) return;
		capturingFrame = true;
		try {
			const blob = await captureVideoFrame(videoEl, format);
			if (destination === 'clipboard') {
				if (!navigator.clipboard?.write || !globalThis.ClipboardItem) {
					throw new Error(m.quick_cut_clipboard_unavailable());
				}
				await navigator.clipboard.write([new globalThis.ClipboardItem({ [blob.type]: blob })]);
				showToast(m.quick_cut_frame_copied(), 'success');
			} else {
				const fileName = frameCaptureFileName(activeSource.name, currentTime, format);
				downloadBlob(blob, fileName);
				showToast(m.quick_cut_frame_saved({ name: fileName }), 'success');
			}
			soundPreferences.play('success');
		} catch (error) {
			showToast(
				m.quick_cut_frame_capture_failed({
					message: error instanceof Error ? error.message : String(error)
				}),
				'error'
			);
			soundPreferences.play('error');
		} finally {
			capturingFrame = false;
		}
	}

	function markIn(): void {
		if (!activeSource) return;
		inPoint = { sourceId: activeSource.id, time: currentTime };
		if (outPoint && outPoint.sourceId === activeSource.id && outPoint.time <= currentTime)
			outPoint = null;
		soundPreferences.play('toggle');
	}

	function markOut(): void {
		if (!activeSource) return;
		outPoint = { sourceId: activeSource.id, time: currentTime };
		soundPreferences.play('toggle');
	}

	function addSegment(): void {
		if (
			!inPoint ||
			!outPoint ||
			inPoint.sourceId !== outPoint.sourceId ||
			outPoint.time <= inPoint.time
		) {
			showToast(m.quick_cut_need_range(), 'error');
			soundPreferences.play('error');
			return;
		}
		const seg = createSegment(inPoint.time, outPoint.time, { sourceId: inPoint.sourceId });
		if (!validateSegmentForProject(seg)) return;
		segments = removeSourceRanges(segmentsForExport, seg.sourceId, [
			{ start: 0, end: seg.start },
			{ start: seg.end, end: activeSource?.duration ?? seg.end }
		]);
		removeMarkedRanges = false;
		selectedId = segments.find((segment) => segment.sourceId === seg.sourceId)?.id ?? null;
		inPoint = null;
		outPoint = null;
		if (segmentValidationToastId !== null) {
			dismissToast(segmentValidationToastId);
			segmentValidationToastId = null;
		}
		soundPreferences.play('success');
		syncProject();
	}

	function removeSegment(id: string): void {
		segments = segments.filter((s) => s.id !== id);
		if (selectedId === id) selectedId = null;
		soundPreferences.play('toggle');
		syncProject();
	}

	function updateSegment(id: string, patch: Partial<QuickCutSegment>): void {
		const next = segments.map((s) => (s.id === id ? { ...s, ...patch } : s));
		const candidate = next.find((segment) => segment.id === id);
		if (!candidate || !validateSegmentForProject(candidate)) return;
		if (hasOverlap(next)) {
			showToast(m.quick_cut_overlap_error(), 'error');
			return;
		}
		segments = next;
		syncProject();
	}

	function validateSegmentForProject(segment: QuickCutSegment): boolean {
		const source = sources.find((candidate) => candidate.id === segment.sourceId);
		if (!source) {
			showToast(m.quick_cut_need_range(), 'error');
			return false;
		}
		const error = validateSegment(segment, source.duration)[0];
		if (!error) return true;
		const message =
			error.kind === 'zero_length'
				? m.quick_cut_segment_too_short({ seconds: MIN_SEGMENT_DURATION_SECONDS })
				: error.kind === 'end_beyond_duration'
					? m.quick_cut_segment_outside_source()
					: m.quick_cut_need_range();
		segmentValidationToastId = showToast(message, 'error');
		soundPreferences.play('error');
		return false;
	}

	function changeDefaultCutMode(mode: CutMode): void {
		cutMode = mode;
		segments = segments.map(({ cutMode: _cutMode, ...segment }) => segment);
		syncProject();
	}

	function moveSegment(from: number, to: number): void {
		segments = reorderSegment(segments, from, to);
		syncProject();
	}

	function updateSourceStreams(
		sourceId: string,
		patch: Pick<QuickCutSource, 'selectedVideoTrackIndex' | 'selectedAudioTrackIndices'>
	): void {
		sources = sources.map((s) => (s.id === sourceId ? { ...s, ...patch } : s));
		syncProject();
	}

	async function waitForPreviewSource(
		expectedSourceId: string,
		generation: number
	): Promise<HTMLVideoElement> {
		previewWait?.abort();
		const controller = new AbortController();
		previewWait = controller;
		if (expectedSourceId !== activeSourceId) switchActiveSource(expectedSourceId, true);
		await tick();
		const element = videoEl;
		const expectedUrl = sourceUrls.get(expectedSourceId);
		if (!element || !expectedUrl || generation !== previewGeneration) {
			throw new DOMException('Preview changed.', 'AbortError');
		}
		if (element.getAttribute('src') === expectedUrl && element.readyState >= 1) return element;
		await new Promise<void>((resolve, reject) => {
			const settle = (error?: Error): void => {
				element.removeEventListener('loadedmetadata', onLoaded);
				element.removeEventListener('error', onError);
				controller.signal.removeEventListener('abort', onAbort);
				if (error) reject(error);
				else resolve();
			};
			const onLoaded = (): void => settle();
			const onError = (): void => settle(new Error('Could not load this source for preview.'));
			const onAbort = (): void => settle(new DOMException('Preview changed.', 'AbortError'));
			element.addEventListener('loadedmetadata', onLoaded, { once: true });
			element.addEventListener('error', onError, { once: true });
			controller.signal.addEventListener('abort', onAbort, { once: true });
		});
		if (generation !== previewGeneration || controller.signal.aborted) {
			throw new DOMException('Preview changed.', 'AbortError');
		}
		return element;
	}

	async function playPreviewIndex(generation: number, index: number): Promise<void> {
		const run = previewRun;
		if (!run || run.generation !== generation || index < 0 || index >= run.segments.length) return;
		const segment = run.segments[index];
		if (!segment || segment.enabled === false) return;
		run.index = index;
		try {
			const element = await waitForPreviewSource(segment.sourceId, generation);
			const signal = previewWait?.signal;
			element.currentTime = segment.start;
			await new Promise<void>((resolve, reject) => {
				if (Math.abs(element.currentTime - segment.start) < 0.01 && element.readyState >= 2) {
					resolve();
					return;
				}
				const onSeeked = (): void => {
					element.removeEventListener('error', onError);
					signal?.removeEventListener('abort', onAbort);
					resolve();
				};
				const onError = (): void => {
					element.removeEventListener('seeked', onSeeked);
					signal?.removeEventListener('abort', onAbort);
					reject(new Error('Could not seek to this segment.'));
				};
				const onAbort = (): void => {
					element.removeEventListener('seeked', onSeeked);
					element.removeEventListener('error', onError);
					reject(new DOMException('Preview changed.', 'AbortError'));
				};
				element.addEventListener('seeked', onSeeked, { once: true });
				element.addEventListener('error', onError, { once: true });
				signal?.addEventListener('abort', onAbort, { once: true });
			});
			if (generation !== previewGeneration) return;
			await element.play();
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			previewRun = null;
			showToast(error instanceof Error ? error.message : String(error), 'error');
		}
	}

	function startPreview(requested: QuickCutSegment[], repeat: boolean): void {
		const playable = requested.filter((segment) => segment.enabled !== false);
		if (playable.length === 0) return;
		stopPreview();
		previewRun = { generation: previewGeneration, segments: playable, index: 0, repeat };
		void playPreviewIndex(previewGeneration, 0);
	}

	function stopPreview(): void {
		previewGeneration += 1;
		previewWait?.abort();
		previewWait = null;
		previewRun = null;
		reviewEnd = null;
	}

	function togglePlay(): void {
		if (!videoEl) return;
		if (playing) {
			videoEl.pause();
			stopPreview();
			return;
		}
		if (loopMode === 'all' && segmentsForExport.length > 0) {
			startPreview(segmentsForExport, true);
			return;
		}
		if (loopMode === 'segment' && selectedSegment && selectedSegment.enabled !== false) {
			startPreview([selectedSegment], true);
			return;
		}
		void videoEl.play();
	}

	function toggleLoopMode(): void {
		loopMode = loopMode === 'off' ? 'segment' : loopMode === 'segment' ? 'all' : 'off';
	}

	function shortcutLabel(binding: string): string {
		return binding ? formatShortcutBinding(binding) : m.video_editor_shortcuts_unassigned();
	}

	function previewSegment(id: string): void {
		const seg = segments.find((s) => s.id === id);
		if (!seg || seg.enabled === false) return;
		selectedId = id;
		startPreview([seg], loopMode === 'segment');
	}

	function normalize(): void {
		segments = normalizeSegments(segments);
		syncProject();
		showToast(m.quick_cut_normalized(), 'success');
	}

	function onSelectSegment(id: string): void {
		selectedId = id;
		const seg = segments.find((s) => s.id === id);
		if (seg && seg.sourceId !== activeSourceId) switchActiveSource(seg.sourceId);
		soundPreferences.play('toggle');
	}

	async function runExport(
		requestedSegments: QuickCutSegment[],
		doMerge: boolean,
		destination: 'save' | 'send' = 'save'
	): Promise<boolean> {
		const toExport = requestedSegments.filter((segment) => segment.enabled !== false);
		if (sources.length === 0 || toExport.length === 0) return false;
		const workspaceId = destination === 'send' ? workspaceCtx.currentWorkspace?.id : undefined;
		if (destination === 'send' && !workspaceId) {
			showToast(m.quick_cut_send_workspace_required(), 'error');
			return false;
		}
		sentExports = [];
		exporting = true;
		exportProgress = {
			phase: 'preparing',
			segmentIndex: 0,
			totalSegments: toExport.length,
			bytesWritten: 0,
			elapsedMs: 0,
			etaMs: null,
			fraction: 0
		};
		abortController = new AbortController();
		const controller = abortController;
		let artifacts: Awaited<ReturnType<typeof exportSegments>> = [];
		try {
			const pre = await preflightExport(sources, toExport, cutMode, doMerge);
			if (!pre.eligible) {
				showToast(pre.reason, 'error');
				return false;
			}
			artifacts = await exportSegments({
				sources,
				segments: toExport,
				cutMode,
				merge: doMerge,
				signal: controller.signal,
				onProgress: (p) => (exportProgress = p)
			});
			for (const art of artifacts) {
				if (destination === 'send') {
					const uploaded = await sendToOpenPost({
						workspaceId: workspaceId!,
						blob: art.scratchFile,
						fileName: art.fileName
					});
					const returnId = page.url.searchParams.get('return');
					const target = returnId ? `/publications/${encodeURIComponent(returnId)}` : '/';
					const query = new URLSearchParams({
						workspace_id: workspaceId!,
						media_id: uploaded.mediaId
					});
					sentExports = [
						...sentExports,
						{ name: art.fileName, href: resolveAppPath(`${target}?${query}`) }
					];
				} else {
					if (getWorkspaceRoot()) {
						const saved = await copyScratchToWorkspace(
							art.scratchFile,
							project?.id,
							art.fileName,
							controller.signal
						);
						showToast(`${m.quick_cut_saved()} · ${saved.relPath}`, 'success');
					} else {
						const url = URL.createObjectURL(art.scratchFile);
						const a = document.createElement('a');
						a.href = url;
						a.download = art.fileName;
						a.click();
						setTimeout(() => URL.revokeObjectURL(url), 5000);
						showToast(m.quick_cut_saved(), 'success');
					}
					soundPreferences.play('success');
				}
			}
			if (destination === 'send') {
				showToast(m.quick_cut_sent(), 'success');
				soundPreferences.play('success');
			}
			return true;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError')
				showToast(m.quick_cut_cancelled(), 'error');
			else {
				showToast(err instanceof Error ? err.message : String(err), 'error');
				soundPreferences.play('error');
			}
			return false;
		} finally {
			for (const artifact of artifacts) {
				await discardScratchFile(artifact.scratchPath).catch(() => undefined);
			}
			exporting = false;
			exportProgress = null;
			abortController = null;
		}
	}

	async function handleExportOne(seg: QuickCutSegment): Promise<void> {
		if (exporting || removeMarkedRanges) return;
		await runExport([seg], false);
	}

	async function handleExportAll(): Promise<void> {
		if (exporting) return;
		await runExport(segmentsForExport, false);
	}

	async function handleExportMerged(): Promise<void> {
		if (exporting) return;
		await runExport(segmentsForExport, true);
	}

	function cancelExport(): void {
		abortController?.abort();
	}

	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveQueue: Promise<void> = Promise.resolve();
	let saveRevision = 0;

	function syncProject(): void {
		if (!project) return;
		recordHistory();
		project.markers = markers;
		project.segments = segments;
		project.cutMode = cutMode;
		project.merge = merge;
		project.removeMarkedRanges = removeMarkedRanges;
		project.sources = sources.map((s) => {
			const { handle: _h, file: _f, ...m } = s;
			return m;
		});
		project.updatedAt = Date.now();
		const repository = cloudRepository;
		const saveToCloud = storageMode === 'cloud' && repository !== null;
		if (!saveToCloud && !getWorkspaceRoot()) return;
		const revision = ++saveRevision;
		saveState = 'saving';
		const toSave = snapshotProject(project);
		const sourcesToSave = [...sources];
		saveQueue = saveQueue
			.then(async () => {
				if (saveToCloud) {
					cloudSession = await syncQuickCutCloudProject(
						repository,
						cloudSession,
						toSave,
						sourcesToSave
					);
					return;
				}
				await saveProjectToWorkspace(toSave);
			})
			.then(() => {
				if (revision !== saveRevision) return;
				saveState = 'saved';
				setTimeout(() => {
					if (revision === saveRevision && saveState === 'saved') saveState = 'idle';
				}, 1500);
			})
			.catch((error: Error) => {
				if (revision !== saveRevision) return;
				saveState = 'error';
				if (error instanceof CloudVideoProjectConflictError) {
					cloudConflictId = error.conflictId;
				}
				showToast(error.message || m.quick_cut_save_failed(), 'error');
			});
	}

	function clearSourceUrls(): void {
		for (const url of sourceUrls.values()) URL.revokeObjectURL(url);
		sourceUrls = new Map();
	}

	async function reconnectSource(sourceId: string): Promise<void> {
		const target = sources.find((s) => s.id === sourceId);
		if (!target) return;
		let file: File | null = null;
		let handle: FileSystemFileHandle | undefined;
		if (window.showOpenFilePicker) {
			try {
				const [picked] = await window.showOpenFilePicker({
					multiple: false,
					types: [
						{
							description: 'Media',
							accept: {
								'video/*': ['.mp4', '.webm', '.mov', '.mkv'],
								'audio/*': ['.mp3', '.aac', '.wav', '.flac', '.ogg', '.m4a']
							}
						}
					]
				});
				if (picked && 'getFile' in picked) {
					// SAFETY: picked is FileSystemFileHandle per File System Access spec when getFile in handle
					handle = picked as FileSystemFileHandle;
					file = await handle.getFile();
				}
			} catch (e) {
				if (e instanceof DOMException && e.name === 'AbortError') return;
				showToast(e instanceof Error ? e.message : String(e), 'error');
				return;
			}
		} else {
			const picked = await new Promise<File | null>((resolve) => {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = 'video/*,audio/*,.mp4,.webm,.mov,.mkv,.m4a,.mp3,.wav,.flac,.ogg';
				input.onchange = () => resolve(input.files?.[0] ?? null);
				input.click();
			});
			if (picked) file = picked;
		}
		if (!file) return;
		try {
			const probed = await probeSourceFile(file, handle, target.id);
			const { reconciled, videoWasValid, audioWasValid } = reconcileSourceAfterProbe(
				// SAFETY: target is QuickCutSource with same id/selection fields as QuickCutSourceMetadata
				target as QuickCutSourceMetadata,
				probed
			);
			if (!videoWasValid || !audioWasValid)
				showToast(`${target.name}: ${m.quick_cut_selection_invalidated()}`, 'error');
			sources = sources.map((s) => {
				if (s.id !== sourceId) return s;
				return { ...s, ...reconciled, handle: handle ?? s.handle, file };
			});
			const url = URL.createObjectURL(file);
			const next = new Map(sourceUrls);
			const oldUrl = sourceUrls.get(sourceId);
			if (oldUrl) URL.revokeObjectURL(oldUrl);
			next.set(sourceId, url);
			sourceUrls = next;
			if (handle) await persistSourceHandles(sources.filter((s) => s.id === sourceId));
			syncProject();
			showToast(m.quick_cut_reconnected(), 'success');
		} catch (e) {
			showToast(e instanceof Error ? e.message : String(e), 'error');
		}
	}

	async function handleImportProject(): Promise<void> {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.json,.llc.json,application/json';
		const f = await new Promise<File | null>((resolve) => {
			input.onchange = () => resolve(input.files?.[0] ?? null);
			input.click();
		});
		if (!f) return;
		const text = await f.text();
		try {
			const parsed = deserializeProject(text);
			segments = parsed.segments;
			markers = parsed.markers ?? [];
			cutMode = parsed.cutMode;
			merge = parsed.merge;
			removeMarkedRanges = parsed.removeMarkedRanges;
			resetHistory();
			project = parsed;
			// Sources are metadata only; need to reconnect handles
			const { restoreSourceHandles } = await import('$lib/quick-cut/project');
			const handleMap = await restoreSourceHandles(parsed.sources);
			// For missing handles, keep source entry but mark missing; user must re-add file
			sources = parsed.sources.map((meta) => ({
				...meta,
				handle: handleMap.get(meta.id) ?? undefined,
				file: undefined
			}));
			clearSourceUrls();
			for (const s of sources) {
				if (s.handle) {
					try {
						const file = await s.handle.getFile();
						const probed = await probeSourceFile(file, s.handle, s.id);
						const { reconciled, videoWasValid, audioWasValid } = reconcileSourceAfterProbe(
							// SAFETY: target is QuickCutSource with same id/selection fields as QuickCutSourceMetadata
							s as QuickCutSourceMetadata,
							probed
						);
						if (!videoWasValid || !audioWasValid) {
							showToast(`${s.name}: ${m.quick_cut_selection_invalidated()}`, 'error');
						}
						Object.assign(s, reconciled, { file });
						const url = URL.createObjectURL(file);
						const next = new Map(sourceUrls);
						next.set(s.id, url);
						sourceUrls = next;
					} catch {
						// handle permission lost
					}
				}
			}
			if (sources.length > 0) activeSourceId = sources[0]!.id;
			syncProject();
			showToast(m.quick_cut_project_loaded(), 'success');
		} catch (e) {
			showToast(e instanceof Error ? e.message : String(e), 'error');
		}
	}

	async function handleExportProject(): Promise<void> {
		if (!project) return;
		const toSave: QuickCutProject = {
			...project,
			segments,
			cutMode,
			merge,
			removeMarkedRanges,
			sources: sources.map((s) => {
				const { handle: _h, file: _f, ...m } = s;
				return m;
			})
		};
		const json = serializeProject(toSave);
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = projectFileName(toSave);
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
		showToast(m.quick_cut_project_saved(), 'success');
	}

	async function handleImportSegments(): Promise<void> {
		if (!activeSource) return;
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.csv,.tsv,.txt,.srt,text/csv,text/tab-separated-values,text/plain';
		const file = await new Promise<File | null>((resolve) => {
			input.onchange = () => resolve(input.files?.[0] ?? null);
			input.oncancel = () => resolve(null);
			input.click();
		});
		if (!file) return;
		try {
			const imported = parseSegmentInterchange(
				await file.text(),
				inferSegmentInterchangeFormat(file.name),
				{ sourceId: activeSource.id, duration: activeSource.duration }
			);
			const next = [...segments, ...imported];
			if (hasOverlap(next)) throw new Error(m.quick_cut_overlap_error());
			const errors = validateSegments(next, 0, sources);
			if (errors.length > 0) throw new Error(errors[0]!.message);
			segments = next;
			selectedId = imported[0]?.id ?? selectedId;
			syncProject();
			showToast(m.quick_cut_segments_imported({ count: imported.length }), 'success');
			soundPreferences.play('success');
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 'error');
			soundPreferences.play('error');
		}
	}

	function segmentInterchangeFileName(format: SegmentInterchangeFormat): string {
		const sourceName = (activeSource?.name ?? 'segments')
			.replace(/\.[^.]+$/u, '')
			.replace(/[^a-z0-9._-]+/giu, '-')
			.replace(/^-+|-+$/gu, '');
		const suffix = {
			'csv-seconds': 'segments-seconds.csv',
			'csv-timecode': 'segments-timecodes.csv',
			'tsv-timecode': 'segments-timecodes.tsv',
			chapters: 'chapters.txt',
			srt: 'segments.srt'
		} satisfies Record<SegmentInterchangeFormat, string>;
		return `${sourceName || 'quick-cut'}-${suffix[format]}`;
	}

	function handleExportSegments(format: SegmentInterchangeFormat): void {
		if (!activeSource) return;
		const exportable = segments.filter(
			(segment) => segment.sourceId === activeSource.id && segment.enabled !== false
		);
		if (exportable.length === 0) {
			showToast(m.quick_cut_no_source_segments(), 'error');
			return;
		}
		const content = formatSegmentInterchange(exportable, format);
		const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = segmentInterchangeFileName(format);
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
		showToast(m.quick_cut_segments_exported(), 'success');
	}

	async function handleSendToOpenPost(): Promise<void> {
		if (segmentsForExport.length === 0 || sources.length === 0 || exporting) return;
		await runExport(segmentsForExport, merge, 'send');
	}

	function onTimeUpdate(): void {
		if (!videoEl) return;
		currentTime = videoEl.currentTime;
		if (reviewEnd !== null && currentTime >= reviewEnd) {
			videoEl.pause();
			reviewEnd = null;
		}
		const run = previewRun;
		if (!run || run.generation !== previewGeneration) return;
		const segment = run.segments[run.index];
		if (!segment || segment.sourceId !== activeSourceId) return;
		if (currentTime < segment.end - 0.02) return;
		videoEl.pause();
		let nextIndex = run.index + 1;
		if (nextIndex >= run.segments.length) {
			if (!run.repeat) {
				stopPreview();
				return;
			}
			nextIndex = 0;
		}
		void playPreviewIndex(run.generation, nextIndex);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (handleGlobalPlayPauseShortcut(event, keyboardShortcuts.bindings.PLAY_PAUSE, togglePlay))
			return;
		if (event.repeat || event.defaultPrevented || editorShortcutTargetIsDisabled(event.target))
			return;
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			restoreHistory(event.shiftKey ? 'redo' : 'undo');
			return;
		}
		if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'm') {
			event.preventDefault();
			addMarker();
			return;
		}
		const action = quickCutShortcutAction(event, keyboardShortcuts.bindings);
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		if (action === 'previous-frame') frameStep(-1);
		else if (action === 'next-frame') frameStep(1);
		else if (action === 'go-to-start') seekTo(0);
		else if (action === 'go-to-end') seekTo(activeSource?.duration ?? 0);
		else if (action === 'mark-in') markIn();
		else if (action === 'mark-out') markOut();
		else if (action === 'clear-marks') {
			inPoint = null;
			outPoint = null;
		} else if (action === 'add-segment') addSegment();
		else if (action === 'delete-segment' && selectedId) removeSegment(selectedId);
		else if (action === 'toggle-loop') toggleLoopMode();
	}

	function editSnapshot(): string {
		return JSON.stringify({ segments, markers, cutMode, merge, removeMarkedRanges });
	}
	function resetHistory(): void {
		history.clear();
		historyState = editSnapshot();
		canUndo = false;
		canRedo = false;
	}
	function recordHistory(): void {
		const next = editSnapshot();
		if (historyState && next !== historyState)
			history.checkpoint(m.quick_cut_title(), historyState, next);
		historyState = next;
		canUndo = history.canUndo;
		canRedo = history.canRedo;
	}
	function restoreHistory(direction: 'undo' | 'redo'): void {
		if (exporting) return;
		stopPreview();
		const next = direction === 'undo' ? history.undo(editSnapshot()) : history.redo(editSnapshot());
		const restored = JSON.parse(next || editSnapshot());
		segments = restored.segments;
		markers = restored.markers;
		cutMode = restored.cutMode;
		merge = restored.merge;
		removeMarkedRanges = restored.removeMarkedRanges;
		historyState = next;
		syncProject();
	}
	function removeRanges(sourceId: string, ranges: AudioSilenceRange[]): void {
		if (exporting || ranges.length === 0) return;
		stopPreview();
		segments = removeSourceRanges(segmentsForExport, sourceId, ranges);
		removeMarkedRanges = false;
		inPoint = null;
		outPoint = null;
		syncProject();
	}
	function removeSelection(): void {
		if (
			!inPoint ||
			!outPoint ||
			inPoint.sourceId !== outPoint.sourceId ||
			outPoint.time <= inPoint.time
		) {
			showToast(m.quick_cut_need_range(), 'error');
			return;
		}
		removeRanges(inPoint.sourceId, [{ start: inPoint.time, end: outPoint.time }]);
	}
	function addMarker(): void {
		if (!activeSource || exporting) return;
		markers = [
			...markers,
			{
				id: crypto.randomUUID(),
				sourceId: activeSource.id,
				time: currentTime,
				name: m.quick_cut_marker_name({ index: markers.length + 1 })
			}
		];
		panel = 'markers';
		syncProject();
	}
	function previewRange(range: AudioSilenceRange): void {
		stopPreview();
		seekTo(Math.max(0, range.start - 0.2));
		reviewEnd = range.end + 0.2;
		void videoEl?.play();
	}
	function saveTranscript(
		sourceId: string,
		transcript: NonNullable<QuickCutSource['transcript']>
	): void {
		sources = sources.map((source) =>
			source.id === sourceId ? { ...source, transcript } : source
		);
		syncProject();
	}

	onDestroy(() => {
		stopPreview();
		for (const url of sourceUrls.values()) URL.revokeObjectURL(url);
	});
</script>

<svelte:head>
	<title>{m.quick_cut_title()}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="quick-cut-workspace video-editor-theme">
	<EditorHeader>
		{#snippet identity()}
			<a
				href="/video-editor"
				class="inline-flex shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-primary"
				aria-label={m.video_editor_title()}><Logo class="h-5 w-auto" /></a
			>
			<span class="hidden text-sm font-semibold sm:inline">{m.quick_cut_title()}</span>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					>{#snippet child({ props })}<Button {...props} variant="ghost" size="sm"
							>{m.common_file()}</Button
						>{/snippet}</DropdownMenu.Trigger
				>
				<DropdownMenu.Content>
					<DropdownMenu.Item disabled={!canUndo || exporting} onclick={() => restoreHistory('undo')}
						>{m.video_editor_undo()}</DropdownMenu.Item
					>
					<DropdownMenu.Item disabled={!canRedo || exporting} onclick={() => restoreHistory('redo')}
						>{m.video_editor_redo()}</DropdownMenu.Item
					>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={openFiles}>{m.quick_cut_open_multiple()}</DropdownMenu.Item>
					<DropdownMenu.Item onclick={handleImportProject}
						>{m.quick_cut_import_project()}</DropdownMenu.Item
					>
					<DropdownMenu.Item disabled={!project} onclick={handleExportProject}
						>{m.quick_cut_export_project()}</DropdownMenu.Item
					>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if sources.length > 0}
				<Button
					size="icon-sm"
					variant="ghost"
					class="hidden sm:inline-flex"
					aria-label={m.video_editor_undo()}
					disabled={!canUndo || exporting}
					onclick={() => restoreHistory('undo')}><ThemeIcon role="undo" class="size-4" /></Button
				>
				<Button
					size="icon-sm"
					variant="ghost"
					class="hidden sm:inline-flex"
					aria-label={m.video_editor_redo()}
					disabled={!canRedo || exporting}
					onclick={() => restoreHistory('redo')}><ThemeIcon role="redo" class="size-4" /></Button
				>
			{/if}
		{/snippet}
		{#snippet workspaces()}<span
				class="hidden max-w-64 truncate text-xs text-muted-foreground md:block"
				>{project?.name ?? m.quick_cut_tagline()}</span
			>{/snippet}
		{#snippet actions()}
			{#if project}
				<span
					class="shrink-0 rounded-full bg-muted px-2 py-1 text-xs whitespace-nowrap text-muted-foreground"
					role="status"
				>
					{#if storageMode === 'cloud'}
						{#if saveState === 'saving'}
							{m.video_editor_saving()}
						{:else if saveState === 'error'}
							{m.compose_needs_attention()}
						{:else if cloudSession}
							{m.video_editor_saved_cloud()}
						{:else}
							{m.video_editor_saving()}
						{/if}
					{:else}
						{m.video_editor_local_only()}
						{#if saveState === 'saving'}
							· {m.common_loading()}
						{:else if saveState === 'saved'}
							· {m.quick_cut_saved()}
						{:else if saveState === 'error'}
							· {m.quick_cut_save_failed()}
						{/if}
					{/if}
				</span>
			{:else if workspaceName}
				<span class="hidden rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground sm:block"
					>{workspaceName}</span
				>
			{/if}
			{#if sources.length > 0}<Button size="sm" onclick={() => (panel = 'export')}
					>{m.common_export()}</Button
				>{/if}
		{/snippet}
	</EditorHeader>
	<main class="quick-cut-main">
		{#if sources.length === 0}
			<div
				class="mx-auto mt-10 w-full max-w-xl min-w-0 rounded-2xl border border-dashed bg-card p-4 text-center shadow-sm sm:mt-16 sm:p-8"
			>
				<h1 class="text-lg font-semibold">{m.quick_cut_empty_title()}</h1>
				<p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
					{m.quick_cut_empty_body()}
				</p>
				{#if cloudWorkspaceId}
					<div
						class="mx-auto mt-5 flex w-fit max-w-full flex-wrap justify-center rounded-lg border bg-muted/40 p-1"
						role="group"
						aria-label={m.video_editor_storage()}
					>
						<Button
							variant={storageMode === 'cloud' ? 'secondary' : 'ghost'}
							size="sm"
							aria-pressed={storageMode === 'cloud'}
							onclick={() => chooseStorage('cloud')}
						>
							{m.video_editor_saved_cloud()}
						</Button>
						<Button
							variant={storageMode === 'local' ? 'secondary' : 'ghost'}
							size="sm"
							aria-pressed={storageMode === 'local'}
							onclick={() => chooseStorage('local')}
						>
							{m.video_editor_local_only()}
						</Button>
					</div>
				{/if}
				<div class="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
					<Button class="min-h-11 w-full sm:w-auto" disabled={importingSource} onclick={openFiles}
						>{m.quick_cut_open_multiple()}</Button
					>
					<Button variant="outline" class="min-h-11 w-full sm:w-auto" onclick={handleImportProject}
						>{m.quick_cut_import_project()}</Button
					>
				</div>
				{#if storageMode === 'local'}
					<p class="mt-4 text-xs text-muted-foreground">{m.quick_cut_workspace_hint()}</p>
				{:else}
					<p class="mt-4 text-xs text-muted-foreground">
						{m.video_editor_cloud_projects_description()}
					</p>
				{/if}
				{#if storageMode === 'cloud' && cloudWorkspaceId}
					<div class="mt-6 border-t pt-5 text-left">
						<div class="flex items-center justify-between gap-3">
							<h2 class="text-sm font-semibold">{m.video_editor_cloud_projects()}</h2>
							<Button
								variant="ghost"
								size="sm"
								disabled={cloudLoading}
								onclick={() => void loadCloudProjectList()}
							>
								{cloudError ? m.common_retry() : m.common_refresh()}
							</Button>
						</div>
						{#if cloudError}
							<p class="mt-3 text-sm text-destructive" role="alert">{cloudError}</p>
						{:else if cloudLoading}
							<p class="mt-3 text-sm text-muted-foreground" role="status">
								{m.video_editor_cloud_projects_loading()}
							</p>
						{:else if cloudProjects.length > 0}
							<ul class="mt-3 grid gap-2 sm:grid-cols-2" role="list">
								{#each cloudProjects as cloudProject (cloudProject.id)}
									<li class="flex items-center justify-between gap-3 rounded-lg border p-3">
										<span class="min-w-0 truncate text-sm" title={cloudProject.name}>
											{cloudProject.name}
										</span>
										<Button
											variant="outline"
											size="sm"
											disabled={cloudOpeningId !== null}
											onclick={() => void openCloudProject(cloudProject)}
										>
											{m.video_editor_project_open()}
										</Button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="mt-3 text-sm text-muted-foreground">
								{m.video_editor_projects_empty()}
							</p>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			{#if cloudConflictId}
				<section
					class="rounded-xl border border-destructive/40 bg-destructive/5 p-4"
					aria-labelledby="quick-cut-cloud-conflict-title"
				>
					<h2 id="quick-cut-cloud-conflict-title" class="text-sm font-semibold">
						{m.video_editor_conflict_title()}
					</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.video_editor_conflict_preserved()}
					</p>
					<div class="mt-3 flex flex-wrap gap-2">
						<Button
							size="sm"
							disabled={cloudConflictWorking}
							onclick={() => void resolveCloudConflict('use_conflict')}
						>
							{m.video_editor_restore()}
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={cloudConflictWorking}
							onclick={() => void resolveCloudConflict('keep_current')}
						>
							{m.video_editor_conflict_reload()}
						</Button>
					</div>
				</section>
			{/if}

			<div class="source-strip">
				<SourceBar
					{sources}
					{activeSourceId}
					busy={exporting}
					onSelect={switchActiveSource}
					onReconnect={(id) => void reconnectSource(id)}
					onRemove={requestSourceRemoval}
					onAdd={() => void openFiles()}
				/>
			</div>
			<div class="cut-workstation">
				<div class="viewer">
					<ContextMenu.Root>
						<ContextMenu.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									class="preview-button"
									type="button"
									aria-label={m.quick_cut_preview()}
									onclick={togglePlay}
								>
									<!-- svelte-ignore a11y_media_has_caption -- trim preview; captions are not part of lossless cuts -->
									<video
										bind:this={videoEl}
										src={videoSrc}
										class="preview-video"
										playsinline
										controls={false}
										ontimeupdate={onTimeUpdate}
										onplay={() => (playing = true)}
										onpause={() => (playing = false)}
									></video>
								</button>
							{/snippet}
						</ContextMenu.Trigger>
						<ContextMenu.Content class="w-56">
							<ContextMenu.Item onclick={togglePlay}>
								{playing ? m.video_editor_pause() : m.video_editor_play()}
								<ContextMenu.Shortcut
									>{shortcutLabel(keyboardShortcuts.bindings.PLAY_PAUSE)}</ContextMenu.Shortcut
								>
							</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item onclick={markIn}>
								{m.video_editor_mark_in()}
								<ContextMenu.Shortcut
									>{shortcutLabel(keyboardShortcuts.bindings.MARK_IN)}</ContextMenu.Shortcut
								>
							</ContextMenu.Item>
							<ContextMenu.Item onclick={markOut}>
								{m.video_editor_mark_out()}
								<ContextMenu.Shortcut
									>{shortcutLabel(keyboardShortcuts.bindings.MARK_OUT)}</ContextMenu.Shortcut
								>
							</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item
								disabled={!canCaptureFrame || capturingFrame}
								onclick={() => void captureCurrentFrame('png')}
							>
								{m.quick_cut_save_frame_png()}
							</ContextMenu.Item>
							<ContextMenu.Item
								disabled={!canCaptureFrame || capturingFrame}
								onclick={() => void captureCurrentFrame('jpeg')}
							>
								{m.quick_cut_save_frame_jpeg()}
							</ContextMenu.Item>
							<ContextMenu.Item
								disabled={!canCaptureFrame || capturingFrame}
								onclick={() => void captureCurrentFrame('png', 'clipboard')}
							>
								{m.quick_cut_copy_frame()}
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Root>
					<div class="transport">
						<div class="flex items-center gap-1">
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={m.quick_cut_frame_back()}
								onclick={() => frameStep(-1)}
								><ProtectedIcon icon="editor-skip-back" class="size-4" /></Button
							>
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={playing ? m.video_editor_pause() : m.video_editor_play()}
								onclick={togglePlay}
								><ProtectedIcon icon={playing ? 'pause' : 'play'} class="size-4" /></Button
							>
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={m.quick_cut_frame_forward()}
								onclick={() => frameStep(1)}
								><ProtectedIcon icon="editor-skip-forward" class="size-4" /></Button
							>
						</div>
						<span class="font-mono text-xs tabular-nums"
							>{formatTimecode(currentTime)} / {formatTimecode(activeSource?.duration ?? 0)}</span
						>
						<div class="ml-auto flex items-center gap-1">
							<Button
								size="sm"
								variant="ghost"
								disabled={segmentsForExport.length === 0}
								onclick={() => startPreview(segmentsForExport, false)}
								>{m.quick_cut_preview_edit()}</Button
							>
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={m.quick_cut_capture_frame()}
								disabled={!canCaptureFrame || capturingFrame}
								onclick={() => void captureCurrentFrame('png')}
								><ThemeIcon role="camera" class="size-4" /></Button
							>
						</div>
					</div>
				</div>
				<aside class="cut-panel" aria-label={m.quick_cut_tools()}>
					<div class="panel-tabs" role="group" aria-label={m.quick_cut_tools()}>
						{#each [{ id: 'cuts', label: m.quick_cut_cuts() }, { id: 'transcript', label: m.video_editor_transcript() }, { id: 'cleanup', label: m.quick_cut_cleanup() }, { id: 'markers', label: m.quick_cut_markers() }] as tab (tab.id)}
							<Button
								variant="ghost"
								size="sm"
								class="min-w-0 flex-1 px-2 text-xs"
								aria-pressed={panel === tab.id}
								onclick={() => (panel = tab.id as typeof panel)}>{tab.label}</Button
							>
						{/each}
					</div>
					<div class="panel-content">
						{#if panel === 'cuts'}
							<div class="mb-3 flex items-center justify-between gap-2">
								<h2 class="text-sm font-medium">{m.quick_cut_kept_parts()}</h2>
								<span class="font-mono text-xs text-muted-foreground"
									>{formatTimecode(
										segmentsForExport.reduce((sum, segment) => sum + segment.end - segment.start, 0)
									)}</span
								>
							</div>
							<SegmentList
								{segments}
								{sources}
								{selectedId}
								defaultCutMode={cutMode}
								onSelect={onSelectSegment}
								onRemove={removeSegment}
								onUpdate={updateSegment}
								onMove={moveSegment}
								{exporting}
								canExportIndividually={!removeMarkedRanges}
								onPreview={previewSegment}
								onExport={(segment) => void handleExportOne(segment)}
							/>
							<details class="mt-4 border-t pt-3">
								<summary class="cursor-pointer text-xs text-muted-foreground"
									>{m.quick_cut_segment_files()}</summary
								>
								<div class="mt-2">
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<Button {...props} size="sm" variant="outline" class="min-h-11 w-full">
													{m.quick_cut_segment_files()}
												</Button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content class="w-64" align="end">
											<DropdownMenu.Item onclick={() => void handleImportSegments()}>
												{m.quick_cut_import_segments()}
											</DropdownMenu.Item>
											<DropdownMenu.Sub>
												<DropdownMenu.SubTrigger
													>{m.quick_cut_export_segments()}</DropdownMenu.SubTrigger
												>
												<DropdownMenu.SubContent class="w-56">
													<DropdownMenu.Item onclick={() => handleExportSegments('csv-seconds')}>
														{m.quick_cut_format_csv_seconds()}
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={() => handleExportSegments('csv-timecode')}>
														{m.quick_cut_format_csv_timecodes()}
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={() => handleExportSegments('tsv-timecode')}>
														{m.quick_cut_format_tsv_timecodes()}
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={() => handleExportSegments('chapters')}>
														{m.quick_cut_format_chapters()}
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={() => handleExportSegments('srt')}>
														{m.quick_cut_format_srt()}
													</DropdownMenu.Item>
												</DropdownMenu.SubContent>
											</DropdownMenu.Sub>
											<DropdownMenu.Separator />
											<DropdownMenu.Label class="max-w-60 whitespace-normal text-muted-foreground">
												{m.quick_cut_segment_files_hint()}
											</DropdownMenu.Label>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								</div>
							</details>
							{#if hasOverlapError}<p role="alert" class="mt-2 text-xs text-destructive">
									{m.quick_cut_overlap_error()}
								</p>
								<Button size="sm" variant="outline" onclick={normalize}
									>{m.quick_cut_normalize()}</Button
								>{/if}
						{:else if panel === 'transcript' && activeSource}
							{#key `${activeSource.id}:${activeSource.selectedAudioTrackIndices?.join(',')}`}<TranscriptCutPanel
									source={activeSource}
									segments={segmentsForExport}
									{currentTime}
									disabled={exporting}
									onsave={saveTranscript}
									onremove={removeRanges}
									onseek={seekTo}
								/>{/key}
						{:else if panel === 'cleanup' && activeSource}
							{#key `${activeSource.id}:${activeSource.selectedAudioTrackIndices?.join(',')}`}<CleanupPanel
									source={activeSource}
									disabled={exporting}
									onapply={removeRanges}
									onpreview={previewRange}
									onreview={(ranges) => (reviewRanges = ranges)}
								/>{/key}
						{:else if panel === 'markers'}
							<Button size="sm" variant="outline" class="mb-3 w-full" onclick={addMarker}
								>{m.quick_cut_add_marker()}</Button
							>
							<div class="divide-y divide-border">
								{#each markers.filter((marker) => marker.sourceId === activeSource?.id) as marker (marker.id)}
									<div class="flex items-center gap-1 py-2">
										<Button
											size="sm"
											variant="ghost"
											class="px-1 font-mono text-xs"
											onclick={() => seekTo(marker.time)}>{formatTimecode(marker.time)}</Button
										>
										<Input
											aria-label={m.quick_cut_marker_label()}
											value={marker.name}
											maxlength={100}
											class="min-w-0"
											onchange={(event) => {
												markers = markers.map((item) =>
													item.id === marker.id
														? { ...item, name: event.currentTarget.value }
														: item
												);
												syncProject();
											}}
										/>
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label={m.common_delete()}
											onclick={() => {
												markers = markers.filter((item) => item.id !== marker.id);
												syncProject();
											}}><ThemeIcon role="delete" class="size-4" /></Button
										>
									</div>
								{/each}
							</div>
						{:else if panel === 'export'}
							<h2 class="mb-3 text-sm font-medium">{m.common_export()}</h2>
							{#each sentExports as sent (sent.href)}<Button
									href={sent.href}
									class="mb-3 w-full"
									variant="secondary">{m.video_editor_open_composer()}</Button
								>{/each}
							<div class="space-y-4">
								<RadioGroup.Root
									value={cutMode}
									onValueChange={(value) => changeDefaultCutMode(value as CutMode)}
									class="space-y-2"
								>
									<Label class="flex items-center gap-2 text-xs"
										><RadioGroup.Item
											value="nearestKeyframe"
											id="cutMode-nearest"
										/>{m.quick_cut_cut_mode_nearest()}</Label
									>
									<Label class="flex items-center gap-2 text-xs"
										><RadioGroup.Item
											value="exact"
											id="cutMode-exact"
										/>{m.quick_cut_cut_mode_exact()}</Label
									>
								</RadioGroup.Root>
								<Label class="flex items-center gap-2 text-xs"
									><Checkbox
										checked={merge}
										onCheckedChange={(checked) => {
											merge = checked === true;
											syncProject();
										}}
									/>{m.quick_cut_merge_label()}</Label
								>
								{#if preflight}<p class="text-xs text-muted-foreground" role="status">
										{preflight.reason}
									</p>{/if}
								<Button
									class="w-full"
									disabled={exporting || !preflight?.eligible || segmentsForExport.length === 0}
									onclick={() => (merge ? handleExportMerged() : handleExportAll())}
									>{merge ? m.quick_cut_export_merged() : m.quick_cut_export_all()}</Button
								>
								<Button
									class="w-full"
									variant="outline"
									disabled={exporting || !preflight?.eligible}
									onclick={handleSendToOpenPost}>{m.quick_cut_send_to_openpost()}</Button
								>
								{#if activeSource}<details>
										<summary class="cursor-pointer text-xs">{m.quick_cut_tracks()}</summary
										><StreamSelector
											source={activeSource}
											onChange={(patch) => updateSourceStreams(activeSource.id, patch)}
										/>
									</details>{/if}
								<details>
									<summary class="cursor-pointer text-xs">{m.quick_cut_advanced()}</summary><Label
										class="mt-3 flex items-start gap-2 text-xs"
										><Checkbox
											checked={removeMarkedRanges}
											onCheckedChange={(checked) => {
												removeMarkedRanges = checked === true;
												syncProject();
											}}
										/>{m.quick_cut_remove_marked_ranges()}</Label
									>
								</details>
							</div>
						{/if}
					</div>
				</aside>
				<div class="cut-timeline">
					<div class="cut-actions">
						<Button size="sm" variant="outline" onclick={markIn}
							>{m.quick_cut_in()}<kbd class="ml-1 text-muted-foreground">I</kbd></Button
						>
						<Button size="sm" variant="outline" onclick={markOut}
							>{m.quick_cut_out()}<kbd class="ml-1 text-muted-foreground">O</kbd></Button
						>
						<Button
							size="sm"
							variant="secondary"
							disabled={!inPoint || !outPoint || exporting}
							onclick={removeSelection}>{m.quick_cut_remove_selection()}</Button
						>
						<Button
							size="sm"
							variant="ghost"
							disabled={!inPoint || !outPoint || exporting}
							onclick={addSegment}>{m.quick_cut_keep_selection()}</Button
						>
						<Button size="sm" variant="ghost" onclick={addMarker}
							><ProtectedIcon
								icon="editor-marker"
								class="mr-1 size-3.5"
							/>{m.quick_cut_add_marker()}</Button
						>
						<Button
							size="sm"
							class="ml-auto"
							variant="ghost"
							aria-pressed={loopMode !== 'off'}
							onclick={toggleLoopMode}
							>{m.quick_cut_loop_label()}: {loopMode === 'off'
								? m.quick_cut_loop_off()
								: loopMode === 'all'
									? m.quick_cut_loop_all()
									: m.quick_cut_loop_segment()}</Button
						>
					</div>
					<TimelineBar
						{activeSource}
						segments={segmentsForExport}
						{currentTime}
						{selectedId}
						{inPoint}
						{outPoint}
						{markers}
						{reviewRanges}
						onSeek={seekTo}
						onSelect={onSelectSegment}
					/>
				</div>
			</div>
			<ExportPanel progress={exportProgress} cancel={cancelExport} isExporting={exporting} />
		{/if}
	</main>
	<DestructiveConfirmDialog
		bind:open={sourceRemovalDialogOpen}
		title={m.quick_cut_remove_source_title({ name: pendingSourceRemoval?.name ?? '' })}
		description={sourceRemovalDescription()}
		confirmLabel={m.quick_cut_remove_source()}
		onConfirm={confirmSourceRemoval}
	/>
</div>

<style>
	.quick-cut-workspace {
		display: flex;
		height: 100dvh;
		min-width: 0;
		flex-direction: column;
		background: var(--background);
		color: var(--foreground);
	}
	.quick-cut-main {
		display: flex;
		flex: 1;
		min-height: 0;
		min-width: 0;
		flex-direction: column;
		overflow: auto;
	}
	.source-strip {
		padding: 6px 12px;
		border-bottom: 1px solid var(--border);
		background: var(--card);
	}
	.cut-workstation {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 330px;
		grid-template-rows: minmax(0, 1fr) auto;
		flex: 1;
		min-height: 0;
	}
	.viewer {
		display: flex;
		min-width: 0;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
	}
	.viewer :global([data-context-menu-trigger]) {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.preview-button {
		display: flex;
		flex: 1;
		min-width: 0;
		min-height: 0;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: var(--video-editor-canvas);
		outline-offset: -2px;
	}
	.preview-button:focus-visible {
		outline: 2px solid var(--primary);
	}
	.preview-video {
		display: block;
		width: 100%;
		height: 100%;
		min-height: 0;
		object-fit: contain;
	}
	.transport {
		display: flex;
		flex-shrink: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 4px 12px;
		border-top: 1px solid var(--border);
		background: var(--card);
	}
	.cut-panel {
		display: flex;
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
		min-height: 0;
		flex-direction: column;
		border-left: 1px solid var(--border);
		background: var(--card);
	}
	.panel-tabs {
		display: flex;
		flex-shrink: 0;
		border-bottom: 1px solid var(--border);
		padding: 4px;
		gap: 1px;
	}
	.panel-tabs :global([aria-pressed='true']) {
		background: var(--accent);
		color: var(--accent-foreground);
	}
	.panel-content {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 12px;
	}
	.cut-timeline {
		grid-column: 1/-1;
		min-width: 0;
		border-top: 1px solid var(--border);
		padding: 8px 12px;
		background: var(--card);
	}
	.cut-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin-bottom: 8px;
	}
	@media (max-width: 767px) {
		.cut-workstation {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(160px, 32dvh) auto minmax(260px, 1fr);
			min-height: fit-content;
		}
		.viewer {
			grid-row: 1;
		}
		.cut-panel {
			grid-column: 1;
			grid-row: 3;
			border-left: 0;
			border-top: 1px solid var(--border);
			min-height: 260px;
		}
		.cut-timeline {
			grid-column: 1;
			grid-row: 2;
			padding: 8px;
		}
		.panel-content {
			max-height: 50dvh;
		}
		.transport {
			gap: 4px;
			padding: 2px 8px;
		}
		.transport :global(button) {
			font-size: 11px;
			padding-inline: 6px;
		}
		.source-strip {
			padding: 4px 8px;
		}
	}
	@media (pointer: coarse) {
		.quick-cut-workspace :global(button),
		.quick-cut-workspace :global(input),
		.quick-cut-workspace :global(summary) {
			min-height: 44px;
		}
	}
</style>
