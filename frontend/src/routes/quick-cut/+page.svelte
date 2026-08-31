<!--
Quick Cut: fast lossless trimming. Open a file, mark in/out, export the
selected range without re-encoding (mediabunny stream copy). UX inspired by
LosslessCut (GPL - behavioral reference only, no code ported).
-->
<script lang="ts">
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
	import { onDestroy, tick } from 'svelte';
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
	import CameraIcon from '@lucide/svelte/icons/camera';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import { quickCutShortcutAction } from '$lib/quick-cut/shortcuts';

	let sources = $state<QuickCutSource[]>([]);
	let sourceUrls = $state<Map<string, string>>(new Map());
	let activeSourceId = $state<string | null>(null);
	let segments = $state<QuickCutSegment[]>([]);
	let selectedId = $state<string | null>(null);
	let cutMode = $state<CutMode>('nearestKeyframe');
	let merge = $state(false);
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
	let workspaceName = $state<string | null>(null);
	let videoSrc = $state<string>('');
	let previewRun = $state<{
		generation: number;
		segmentIds: string[];
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
		if (files.length === 0) return;
		for (let i = 0; i < files.length; i++) {
			const file = files[i]!;
			const handle = handles[i] ?? undefined;
			const probed = await probeSourceFile(file, handle);
			sources = [...sources, probed];
			const url = URL.createObjectURL(file);
			const next = new Map(sourceUrls);
			next.set(probed.id, url);
			sourceUrls = next;
			if (!activeSourceId) activeSourceId = probed.id;
		}
		await persistSourceHandles(sources);
		if (!project) {
			const metas = sources.map((s) => {
				const { handle: _h, file: _f, ...m } = s;
				return m;
			});
			project = createNewProject(metas);
			project.segments = segments;
		} else {
			project.sources = sources.map((s) => {
				const { handle: _h, file: _f, ...m } = s;
				return m;
			});
		}
		soundPreferences.play('success');
		syncProject();
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
					if (!getWorkspaceRoot() || !project) return;
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
		if (hasOverlap([...segments, seg])) {
			showToast(m.quick_cut_overlap_error(), 'error');
			soundPreferences.play('error');
			return;
		}
		segments = [...segments, seg];
		selectedId = seg.id;
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
		if (!run || run.generation !== generation || index < 0 || index >= run.segmentIds.length)
			return;
		const segment = segments.find((candidate) => candidate.id === run.segmentIds[index]);
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

	function startPreview(segmentIds: string[], repeat: boolean): void {
		const playable = segmentIds.filter((id) => {
			const segment = segments.find((candidate) => candidate.id === id);
			return segment?.enabled !== false;
		});
		if (playable.length === 0) return;
		previewGeneration += 1;
		previewRun = { generation: previewGeneration, segmentIds: playable, index: 0, repeat };
		void playPreviewIndex(previewGeneration, 0);
	}

	function stopPreview(): void {
		previewGeneration += 1;
		previewWait?.abort();
		previewWait = null;
		previewRun = null;
	}

	function togglePlay(): void {
		if (!videoEl) return;
		if (playing) {
			videoEl.pause();
			stopPreview();
			return;
		}
		if (loopMode === 'all' && enabledSegments.length > 0) {
			startPreview(
				enabledSegments.map((segment) => segment.id),
				true
			);
			return;
		}
		if (loopMode === 'segment' && selectedSegment && selectedSegment.enabled !== false) {
			startPreview([selectedSegment.id], true);
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
		startPreview([id], loopMode === 'segment');
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
					await sendToOpenPost({
						workspaceId: workspaceId!,
						blob: art.scratchFile,
						fileName: art.fileName
					});
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
		project.segments = segments;
		project.cutMode = cutMode;
		project.merge = merge;
		project.removeMarkedRanges = removeMarkedRanges;
		project.sources = sources.map((s) => {
			const { handle: _h, file: _f, ...m } = s;
			return m;
		});
		if (!getWorkspaceRoot()) return;
		const revision = ++saveRevision;
		saveState = 'saving';
		const toSave = snapshotProject(project);
		saveQueue = saveQueue
			.then(() => saveProjectToWorkspace(toSave))
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
			cutMode = parsed.cutMode;
			merge = parsed.merge;
			removeMarkedRanges = parsed.removeMarkedRanges;
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
		const run = previewRun;
		if (!run || run.generation !== previewGeneration) return;
		const segmentId = run.segmentIds[run.index];
		const segment = segments.find((candidate) => candidate.id === segmentId);
		if (!segment || segment.sourceId !== activeSourceId) return;
		if (currentTime < segment.end - 0.02) return;
		videoEl.pause();
		let nextIndex = run.index + 1;
		if (nextIndex >= run.segmentIds.length) {
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

	onDestroy(() => {
		stopPreview();
		for (const url of sourceUrls.values()) URL.revokeObjectURL(url);
	});
</script>

<svelte:head>
	<title>{m.quick_cut_title()}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="flex min-h-dvh flex-col bg-background text-foreground">
	<header class="flex items-center justify-between border-b px-3 py-2">
		<a
			href="/editors"
			class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
		>
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.quick_cut_title()}</span>
		</a>
		<div class="flex items-center gap-2">
			{#if workspaceName}
				<span class="hidden rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground sm:block"
					>{workspaceName}</span
				>
			{/if}
			<span class="hidden text-xs text-muted-foreground sm:block">{m.quick_cut_tagline()}</span>
		</div>
	</header>

	<main class="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col gap-4 p-3 sm:p-4">
		{#if sources.length === 0}
			<div
				class="mx-auto mt-10 max-w-xl rounded-2xl border border-dashed bg-card p-8 text-center shadow-sm sm:mt-16"
			>
				<h1 class="text-lg font-semibold">{m.quick_cut_empty_title()}</h1>
				<p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
					{m.quick_cut_empty_body()}
				</p>
				<div class="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
					<Button class="min-h-11 w-full sm:w-auto" onclick={openFiles}
						>{m.quick_cut_open_multiple()}</Button
					>
					<Button variant="outline" class="min-h-11 w-full sm:w-auto" onclick={handleImportProject}
						>{m.quick_cut_import_project()}</Button
					>
				</div>
				<p class="mt-4 text-xs text-muted-foreground">{m.quick_cut_workspace_hint()}</p>
			</div>
		{:else}
			<SourceBar
				{sources}
				{activeSourceId}
				busy={exporting}
				onSelect={switchActiveSource}
				onReconnect={(id) => void reconnectSource(id)}
				onRemove={requestSourceRemoval}
				onAdd={() => void openFiles()}
			/>

			{#if activeSource}
				<StreamSelector
					source={activeSource}
					onChange={(patch) => updateSourceStreams(activeSource.id, patch)}
				/>
			{/if}

			<div class="grid min-w-0 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
				<div class="flex min-w-0 flex-col gap-3">
					<ContextMenu.Root>
						<ContextMenu.Trigger>
							{#snippet child({ props })}
								<div
									{...props}
									class="overflow-hidden rounded-xl bg-black shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
									tabindex="0"
									role="application"
									aria-label={m.quick_cut_preview()}
								>
									<!-- svelte-ignore a11y_media_has_caption -- trim preview; captions are not part of lossless cuts -->
									<video
										bind:this={videoEl}
										src={videoSrc}
										class="block max-h-[55dvh] w-full object-contain"
										playsinline
										controls={false}
										ontimeupdate={onTimeUpdate}
										onplay={() => (playing = true)}
										onpause={() => (playing = false)}
									></video>
								</div>
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

					<TimelineBar
						{activeSource}
						{segments}
						{currentTime}
						{selectedId}
						{inPoint}
						{outPoint}
						onSeek={seekTo}
						onSelect={onSelectSegment}
					/>

					<div class="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-sm">
						<span class="rounded bg-muted px-2 py-1 font-mono text-xs tabular-nums"
							>{formatTimecode(currentTime)} / {formatTimecode(activeSource?.duration ?? 0)}</span
						>

						<Button size="xs" variant="outline" onclick={markIn} class="min-h-11 md:min-h-7"
							>{shortcutLabel(keyboardShortcuts.bindings.MARK_IN)} · {m.quick_cut_in()}</Button
						>
						{#if inPoint}<span class="font-mono text-xs text-amber-600"
								>{formatTimecode(inPoint.time)}</span
							>{/if}
						<Button size="xs" variant="outline" onclick={markOut} class="min-h-11 md:min-h-7"
							>{shortcutLabel(keyboardShortcuts.bindings.MARK_OUT)} · {m.quick_cut_out()}</Button
						>
						{#if outPoint}<span class="font-mono text-xs text-emerald-600"
								>{formatTimecode(outPoint.time)}</span
							>{/if}
						<Button size="xs" onclick={addSegment} class="min-h-11 md:min-h-7"
							>{m.quick_cut_add_segment()}</Button
						>

						<div class="ml-auto flex items-center gap-1">
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={m.quick_cut_frame_back()}
								onclick={() => frameStep(-1)}
								class="min-h-11 min-w-11 md:min-h-7 md:min-w-7">◀</Button
							>
							<Button
								size="icon-xs"
								aria-label={playing ? m.video_editor_pause() : m.video_editor_play()}
								onclick={togglePlay}
								class="min-h-11 min-w-11 md:min-h-9 md:min-w-9">{playing ? '❚❚' : '▶'}</Button
							>
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={m.quick_cut_frame_forward()}
								onclick={() => frameStep(1)}
								class="min-h-11 min-w-11 md:min-h-7 md:min-w-7">▶</Button
							>
							<Button
								size="icon-xs"
								variant="ghost"
								disabled={!canCaptureFrame || capturingFrame}
								aria-label={m.quick_cut_capture_frame()}
								title={m.quick_cut_capture_frame()}
								onclick={() => void captureCurrentFrame('png')}
								class="min-h-11 min-w-11 md:min-h-7 md:min-w-7"
							>
								{#if capturingFrame}<LoaderIcon
										class="size-4 animate-spin motion-reduce:animate-none"
									/>{:else}<CameraIcon class="size-4" />{/if}
							</Button>
						</div>
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<Label class="text-xs">{m.quick_cut_loop_label()}</Label>
						<div class="flex rounded-md border bg-card p-0.5">
							{#each [['off', m.quick_cut_loop_off()], ['segment', m.quick_cut_loop_segment()], ['all', m.quick_cut_loop_all()]] as [val, label] (val)}
								<button
									type="button"
									class="min-h-9 rounded px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary {loopMode ===
									val
										? 'bg-primary text-primary-foreground'
										: 'text-muted-foreground hover:bg-accent'}"
									aria-pressed={loopMode === val}
									onclick={() => {
										// SAFETY: val is LoopMode from the tuple above
										loopMode = val as LoopMode;
									}}>{label}</button
								>
							{/each}
						</div>
						<span class="text-xs text-muted-foreground">{m.quick_cut_loop_hint()}</span>
					</div>

					{#if segments.length > 0 && selectedSegment}
						<div class="flex gap-2">
							<Button
								size="xs"
								variant="secondary"
								onclick={() => previewSegment(selectedSegment!.id)}
								disabled={selectedSegment.enabled === false}
								class="min-h-11 md:min-h-7">{m.quick_cut_preview_selected()}</Button
							>
							<Button
								size="xs"
								variant="ghost"
								onclick={() => seekTo(selectedSegment!.start)}
								class="min-h-11 md:min-h-7">{m.quick_cut_goto_start()}</Button
							>
						</div>
					{/if}
				</div>

				<div class="flex min-w-0 flex-col gap-4">
					<div class="rounded-xl border bg-card p-4 shadow-sm">
						<h2 class="text-sm font-semibold">
							{removeMarkedRanges
								? m.quick_cut_remove_ranges_label()
								: m.quick_cut_segments_label()} · {enabledSegments.length}
						</h2>
						<p class="mt-1 text-xs text-muted-foreground">
							{removeMarkedRanges
								? m.quick_cut_remove_ranges_hint({ count: segmentsForExport.length })
								: m.quick_cut_segments_hint()}
						</p>

						<div class="mt-3 flex flex-wrap items-center gap-2">
							<Label class="flex items-center gap-2 text-xs font-normal">
								<Checkbox
									checked={removeMarkedRanges}
									onCheckedChange={(checked) => {
										removeMarkedRanges = checked === true;
										syncProject();
									}}
									aria-label={m.quick_cut_remove_marked_ranges()}
								/>
								{m.quick_cut_remove_marked_ranges()}
							</Label>
							<Label class="flex items-center gap-2 text-xs font-normal">
								<Checkbox
									checked={merge}
									onCheckedChange={(checked) => {
										merge = checked === true;
										syncProject();
									}}
									aria-label={m.quick_cut_merge_label()}
								/>
								{m.quick_cut_merge_label()}
							</Label>
							<RadioGroup.Root
								value={cutMode}
								onValueChange={(value) => changeDefaultCutMode(value as CutMode)}
								class="flex flex-wrap items-center gap-2"
							>
								<Label class="flex items-center gap-2 text-xs font-normal">
									<RadioGroup.Item value="nearestKeyframe" id="cutMode-nearest" />
									{m.quick_cut_cut_mode_nearest()}
								</Label>
								<Label class="flex items-center gap-2 text-xs font-normal">
									<RadioGroup.Item value="exact" id="cutMode-exact" />
									{m.quick_cut_cut_mode_exact()}
								</Label>
							</RadioGroup.Root>
						</div>

						{#if preflight && !preflight.eligible}
							<p class="mt-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
								{preflight.reason}
							</p>
						{:else if preflight}
							<p class="mt-2 rounded bg-muted px-2 py-1 text-xs">{preflight.reason}</p>
						{/if}

						{#if hasOverlapError}
							<p class="mt-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
								{m.quick_cut_overlap_error()}
							</p>
							<Button
								size="xs"
								variant="outline"
								onclick={normalize}
								class="mt-2 min-h-11 md:min-h-7">{m.quick_cut_normalize()}</Button
							>
						{/if}

						<div class="mt-4">
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
						</div>

						<div class="mt-4 grid gap-2 sm:grid-cols-2">
							<Button size="sm" variant="outline" onclick={openFiles} class="min-h-11"
								>{m.quick_cut_open_multiple()}</Button
							>
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
						<div class="mt-2 grid gap-2 sm:grid-cols-2">
							<Button size="sm" variant="outline" onclick={handleImportProject} class="min-h-11"
								>{m.quick_cut_import_project()}</Button
							>
							<Button
								size="sm"
								variant="outline"
								onclick={handleExportProject}
								disabled={!project}
								class="min-h-11">{m.quick_cut_export_project()}</Button
							>
						</div>
						<Button
							size="sm"
							variant="outline"
							onclick={handleSendToOpenPost}
							disabled={!preflight?.eligible}
							class="mt-2 min-h-11 w-full">{m.quick_cut_send_to_openpost()}</Button
						>
					</div>

					<ExportPanel progress={exportProgress} cancel={cancelExport} isExporting={exporting} />

					<div class="flex flex-wrap gap-2">
						<Button
							size="sm"
							disabled={exporting ||
								segmentsForExport.length === 0 ||
								!individualPreflight?.eligible}
							onclick={handleExportAll}
							class="min-h-11 flex-1">{m.quick_cut_export_all()}</Button
						>
						{#if merge}
							<Button
								size="sm"
								variant="secondary"
								disabled={exporting || segmentsForExport.length < 2 || !mergedPreflight?.eligible}
								onclick={handleExportMerged}
								class="min-h-11 flex-1">{m.quick_cut_export_merged()}</Button
							>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</main>

	<footer
		class="flex flex-wrap justify-center gap-x-3 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground"
	>
		<span
			><kbd>{shortcutLabel(keyboardShortcuts.bindings.MARK_IN)}</kbd>/<kbd
				>{shortcutLabel(keyboardShortcuts.bindings.MARK_OUT)}</kbd
			>
			{m.quick_cut_in()}/{m.quick_cut_out()}</span
		>
		<span
			><kbd>{shortcutLabel(keyboardShortcuts.bindings.PLAY_PAUSE)}</kbd>
			{m.video_editor_shortcuts_command_play_pause()}</span
		>
		<span
			><kbd>{shortcutLabel(keyboardShortcuts.bindings.PREVIOUS_FRAME)}</kbd>/<kbd
				>{shortcutLabel(keyboardShortcuts.bindings.NEXT_FRAME)}</kbd
			>
			{m.quick_cut_frame_back()}/{m.quick_cut_frame_forward()}</span
		>
		<span
			><kbd>{shortcutLabel(keyboardShortcuts.bindings.QUICK_CUT_TOGGLE_LOOP)}</kbd>
			{m.quick_cut_loop_label()}</span
		>
		<span
			><kbd>{shortcutLabel(keyboardShortcuts.bindings.QUICK_CUT_ADD_SEGMENT)}</kbd>
			{m.quick_cut_add_segment()}</span
		>
	</footer>

	<DestructiveConfirmDialog
		bind:open={sourceRemovalDialogOpen}
		title={m.quick_cut_remove_source_title({ name: pendingSourceRemoval?.name ?? '' })}
		description={sourceRemovalDescription()}
		confirmLabel={m.quick_cut_remove_source()}
		onConfirm={confirmSourceRemoval}
	/>
</div>
