<!--
Quick Cut: fast lossless trimming. Open a file, mark in/out, export the
selected range without re-encoding (mediabunny stream copy). UX inspired by
LosslessCut (GPL - behavioral reference only, no code ported).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import { onDestroy, tick } from 'svelte';
	import SegmentList from '$lib/quick-cut/components/SegmentList.svelte';
	import TimelineBar from '$lib/quick-cut/components/TimelineBar.svelte';
	import ExportPanel from '$lib/quick-cut/components/ExportPanel.svelte';
	import StreamSelector from '$lib/quick-cut/components/StreamSelector.svelte';
	import {
		createSegment,
		validateSegments,
		hasOverlap,
		normalizeSegments,
		reorderSegment,
		formatTimecode
	} from '$lib/quick-cut/model';
	import { probeSourceFile } from '$lib/quick-cut/source';
	import {
		preflightExport,
		exportSegments,
		copyScratchToWorkspace,
		discardScratchFile
	} from '$lib/quick-cut/export';
	import type { QuickCutSource, QuickCutSegment, CutMode, LoopMode } from '$lib/quick-cut/types';
	import type { QuickCutExportProgress } from '$lib/quick-cut/export';
	import {
		createNewProject,
		saveProjectToWorkspace,
		serializeProject,
		deserializeProject,
		projectFileName,
		persistSourceHandles
	} from '$lib/quick-cut/project';
	import type { QuickCutProject } from '$lib/quick-cut/types';
	import { getWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { sendToOpenPost } from '$lib/video-editor/send-to-openpost';

	let sources = $state<QuickCutSource[]>([]);
	let sourceUrls = $state<Map<string, string>>(new Map());
	let activeSourceId = $state<string | null>(null);
	let segments = $state<QuickCutSegment[]>([]);
	let selectedId = $state<string | null>(null);
	let cutMode = $state<CutMode>('nearestKeyframe');
	let merge = $state(false);
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
	let previewWait: AbortController | null = null;

	const activeSource = $derived(sources.find((s) => s.id === activeSourceId) ?? sources[0] ?? null);
	const selectedSegment = $derived(segments.find((s) => s.id === selectedId) ?? null);
	const enabledSegments = $derived(segments.filter((segment) => segment.enabled !== false));
	const validationErrors = $derived(validateSegments(enabledSegments, 0, sources));
	const hasOverlapError = $derived(validationErrors.some((e) => e.kind === 'overlap'));
	const preflight = $derived.by(() => {
		// sync preflight cannot be async; we compute sync reason via model assess, but final preflight is async for quota
		// For UI we show quick sync check
		if (enabledSegments.length === 0)
			return { eligible: false, reason: m.quick_cut_no_segments(), requiresTranscode: false };
		// Use model validation for quick feedback
		if (hasOverlapError)
			return { eligible: false, reason: m.quick_cut_overlap_error(), requiresTranscode: false };
		return { eligible: true, reason: '', requiresTranscode: false };
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
		if (hasOverlap([...segments, seg])) {
			showToast(m.quick_cut_overlap_error(), 'error');
			soundPreferences.play('error');
			return;
		}
		segments = [...segments, seg];
		selectedId = seg.id;
		inPoint = null;
		outPoint = null;
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
		if (hasOverlap(next)) {
			showToast(m.quick_cut_overlap_error(), 'error');
			return;
		}
		segments = next;
		syncProject();
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
		if (loopMode === 'segment' && selectedSegment?.enabled !== false) {
			startPreview([selectedSegment.id], true);
			return;
		}
		void videoEl.play();
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
		if (exporting) return;
		await runExport([seg], false);
	}

	async function handleExportAll(): Promise<void> {
		if (exporting) return;
		await runExport(enabledSegments, false);
	}

	async function handleExportMerged(): Promise<void> {
		if (exporting) return;
		await runExport(enabledSegments, true);
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
		project.sources = sources.map((s) => {
			const { handle: _h, file: _f, ...m } = s;
			return m;
		});
		if (!getWorkspaceRoot()) return;
		const revision = ++saveRevision;
		saveState = 'saving';
		const toSave = structuredClone(project);
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
			// Try to create object URLs for those with handles
			for (const s of sources) {
				if (s.handle) {
					try {
						const file = await s.handle.getFile();
						s.file = file;
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

	async function handleSendToOpenPost(): Promise<void> {
		if (enabledSegments.length === 0 || sources.length === 0 || exporting) return;
		await runExport(enabledSegments, merge, 'send');
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
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target) return;
		if (
			target.matches('input, textarea, select, button, [contenteditable="true"], [role="textbox"]')
		)
			return;
		if (event.key === 'i' || event.key === 'I') {
			event.preventDefault();
			markIn();
		} else if (event.key === 'o' || event.key === 'O') {
			event.preventDefault();
			markOut();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			addSegment();
		} else if (event.code === 'Space') {
			event.preventDefault();
			togglePlay();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			frameStep(event.shiftKey ? -30 : -1);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			frameStep(event.shiftKey ? 30 : 1);
		} else if (event.key === 'l' || event.key === 'L') {
			event.preventDefault();
			loopMode = loopMode === 'off' ? 'segment' : loopMode === 'segment' ? 'all' : 'off';
		}
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
			<div class="flex min-w-0 flex-wrap gap-2">
				{#each sources as src, idx (src.id)}
					<button
						type="button"
						class="flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-full border px-3 py-1 text-xs {activeSourceId ===
						src.id
							? 'border-primary bg-primary text-primary-foreground'
							: 'bg-card hover:bg-accent'}"
						aria-pressed={activeSourceId === src.id}
						onclick={() => switchActiveSource(src.id)}
					>
						<span class="truncate font-medium"
							>{m.quick_cut_source_label({ index: idx + 1 })} · {src.name}</span
						>
						{#if !src.file && !src.handle}
							<span class="rounded bg-destructive px-1 text-[10px] text-destructive-foreground"
								>{m.quick_cut_source_missing()}</span
							>
						{/if}
					</button>
				{/each}
				<Button size="xs" variant="outline" onclick={openFiles} class="min-h-11"
					>{m.quick_cut_add_source()}</Button
				>
			</div>

			<div class="flex min-w-0 flex-col gap-3">
				{#each sources as src (src.id)}
					<StreamSelector source={src} onChange={(patch) => updateSourceStreams(src.id, patch)} />
				{/each}
			</div>

			<div class="grid min-w-0 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
				<div class="flex min-w-0 flex-col gap-3">
					<!-- svelte-ignore a11y_media_has_caption -- trim preview; captions are not part of lossless cuts -->
					<video
						bind:this={videoEl}
						src={videoSrc}
						class="max-h-[55dvh] w-full rounded-xl bg-black object-contain shadow"
						playsinline
						controls={false}
						ontimeupdate={onTimeUpdate}
						onplay={() => (playing = true)}
						onpause={() => (playing = false)}
					></video>

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
							>I · {m.quick_cut_in()}</Button
						>
						{#if inPoint}<span class="font-mono text-xs text-amber-600"
								>{formatTimecode(inPoint.time)}</span
							>{/if}
						<Button size="xs" variant="outline" onclick={markOut} class="min-h-11 md:min-h-7"
							>O · {m.quick_cut_out()}</Button
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
							{m.quick_cut_segments_label()} · {enabledSegments.length}
						</h2>
						<p class="mt-1 text-xs text-muted-foreground">{m.quick_cut_segments_hint()}</p>

						<div class="mt-3 flex flex-wrap items-center gap-2">
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
							/>
						</div>

						<div class="mt-4 grid gap-2 sm:grid-cols-2">
							<Button size="sm" variant="outline" onclick={openFiles} class="min-h-11"
								>{m.quick_cut_open_multiple()}</Button
							>
							<Button size="sm" variant="outline" onclick={handleImportProject} class="min-h-11"
								>{m.quick_cut_import_project()}</Button
							>
						</div>
						<div class="mt-2 grid gap-2 sm:grid-cols-2">
							<Button
								size="sm"
								variant="outline"
								onclick={handleExportProject}
								disabled={!project}
								class="min-h-11">{m.quick_cut_export_project()}</Button
							>
							<Button
								size="sm"
								variant="outline"
								onclick={handleSendToOpenPost}
								disabled={enabledSegments.length === 0}
								class="min-h-11">{m.quick_cut_send_to_openpost()}</Button
							>
						</div>
					</div>

					<ExportPanel progress={exportProgress} cancel={cancelExport} isExporting={exporting} />

					<div class="flex flex-wrap gap-2">
						<Button
							size="sm"
							disabled={exporting || enabledSegments.length === 0}
							onclick={handleExportAll}
							class="min-h-11 flex-1">{m.quick_cut_export_all()}</Button
						>
						{#if merge}
							<Button
								size="sm"
								variant="secondary"
								disabled={exporting || enabledSegments.length < 2}
								onclick={handleExportMerged}
								class="min-h-11 flex-1">{m.quick_cut_export_merged()}</Button
							>
						{/if}
					</div>

					{#if segments.length === 1}
						<Button
							size="sm"
							disabled={exporting || segments[0]!.enabled === false}
							onclick={() => handleExportOne(segments[0]!)}
							class="min-h-11">{m.quick_cut_export()}</Button
						>
					{/if}

					<ul class="space-y-2">
						{#each segments as seg, idx (seg.id)}
							{@const src = sources.find((s) => s.id === seg.sourceId)}
							<li
								class="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-2 sm:flex-row sm:items-center sm:justify-between"
							>
								<span class="min-w-0 font-mono text-xs break-all"
									>{idx + 1}. {src?.name ?? ''}
									{formatTimecode(seg.start)} → {formatTimecode(seg.end)}</span
								>
								<div class="flex shrink-0 gap-1">
									<Button
										size="xs"
										variant="ghost"
										onclick={() => previewSegment(seg.id)}
										disabled={seg.enabled === false}
										class="min-h-11 md:min-h-7">{m.quick_cut_preview()}</Button
									>
									<Button
										size="xs"
										disabled={exporting || seg.enabled === false}
										onclick={() => handleExportOne(seg)}
										class="min-h-11 md:min-h-7">{m.quick_cut_export()}</Button
									>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			</div>
		{/if}
	</main>

	<footer class="border-t px-3 py-2 text-center text-xs text-muted-foreground">
		{m.quick_cut_keyboard_hint()}
	</footer>
</div>
