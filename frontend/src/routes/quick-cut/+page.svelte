<!--
Quick Cut: fast lossless trimming. Open a file, mark in/out, export the
selected range without re-encoding (mediabunny stream copy). UX inspired by
LosslessCut (GPL — behavioral reference only, no code ported).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import Logo from '$lib/components/Logo.svelte';
	import { showToast } from '$lib/toast';
	import { onDestroy } from 'svelte';
	import SegmentList from '$lib/quick-cut/components/SegmentList.svelte';
	import TimelineBar from '$lib/quick-cut/components/TimelineBar.svelte';
	import ExportPanel from '$lib/quick-cut/components/ExportPanel.svelte';
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

	const activeSource = $derived(sources.find((s) => s.id === activeSourceId) ?? sources[0] ?? null);
	const selectedSegment = $derived(segments.find((s) => s.id === selectedId) ?? null);
	const validationErrors = $derived(validateSegments(segments, 0, sources));
	const hasOverlapError = $derived(validationErrors.some((e) => e.kind === 'overlap'));
	const preflight = $derived.by(() => {
		// sync preflight cannot be async; we compute sync reason via model assess, but final preflight is async for quota
		// For UI we show quick sync check
		if (segments.length === 0)
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

	function switchActiveSource(id: string): void {
		activeSourceId = id;
		currentTime = 0;
		if (videoEl) videoEl.currentTime = 0;
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

	function moveSegment(from: number, to: number): void {
		segments = reorderSegment(segments, from, to);
		syncProject();
	}

	function togglePlay(): void {
		if (!videoEl) return;
		if (playing) videoEl.pause();
		else void videoEl.play();
	}

	function previewSegment(id: string): void {
		const seg = segments.find((s) => s.id === id);
		if (!seg) return;
		selectedId = id;
		if (seg.sourceId !== activeSourceId) switchActiveSource(seg.sourceId);
		// Need to wait for src switch
		requestAnimationFrame(() => {
			seekTo(seg.start);
			videoEl?.play();
		});
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

	async function runExport(toExport: QuickCutSegment[], doMerge: boolean): Promise<void> {
		if (sources.length === 0 || toExport.length === 0) return;
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
				return;
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
				try {
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
				} finally {
					await discardScratchFile(art.scratchPath).catch(() => undefined);
				}
			}
		} catch (err) {
			for (const a of artifacts) await discardScratchFile(a.scratchPath).catch(() => undefined);
			if (err instanceof DOMException && err.name === 'AbortError')
				showToast(m.quick_cut_cancelled(), 'error');
			else {
				showToast(err instanceof Error ? err.message : String(err), 'error');
				soundPreferences.play('error');
			}
		} finally {
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
		await runExport(segments, false);
	}

	async function handleExportMerged(): Promise<void> {
		if (exporting) return;
		await runExport(segments, true);
	}

	function cancelExport(): void {
		abortController?.abort();
	}

	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveQueue: Promise<void> = Promise.resolve();

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
		saveState = 'saving';
		const toSave = { ...project };
		saveQueue = saveQueue
			.then(() => saveProjectToWorkspace(toSave))
			.then(() => {
				saveState = 'saved';
				setTimeout(() => {
					if (saveState === 'saved') saveState = 'idle';
				}, 1500);
			})
			.catch(() => {
				saveState = 'error';
				showToast(m.quick_cut_save_failed(), 'error');
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
		if (segments.length === 0 || sources.length === 0) return;
		try {
			await runExport(segments, merge);
			showToast(m.quick_cut_sent(), 'success');
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError')
				showToast(m.quick_cut_cancelled(), 'error');
			else showToast(e instanceof Error ? e.message : String(e), 'error');
		}
	}

	function onTimeUpdate(): void {
		if (!videoEl) return;
		currentTime = videoEl.currentTime;
		if (loopMode === 'segment' && selectedSegment) {
			if (
				selectedSegment.sourceId === activeSourceId &&
				currentTime >= selectedSegment.end - 0.05
			) {
				seekTo(selectedSegment.start);
			}
		} else if (loopMode === 'all' && segments.length > 0) {
			const last = segments[segments.length - 1]!;
			const first = segments[0]!;
			if (currentTime >= activeSource!.duration - 0.05) {
				// Find next segment after current active source's last? For all loop, go to first segment's source
				if (activeSourceId === last.sourceId && currentTime >= last.end - 0.05) {
					if (first.sourceId !== activeSourceId) switchActiveSource(first.sourceId);
					requestAnimationFrame(() => seekTo(first.start));
				}
			}
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target instanceof HTMLElement ? event.target : null;
		if (!target) return;
		if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
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

	<main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-3 sm:p-4">
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
			<div class="flex flex-wrap gap-2">
				{#each sources as src, idx (src.id)}
					<button
						type="button"
						class="flex min-h-11 items-center gap-2 rounded-full border px-3 py-1 text-xs {activeSourceId ===
						src.id
							? 'border-primary bg-primary text-primary-foreground'
							: 'bg-card hover:bg-accent'}"
						aria-pressed={activeSourceId === src.id}
						onclick={() => switchActiveSource(src.id)}
					>
						<span class="font-medium"
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

			<div class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
				<div class="flex flex-col gap-3">
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

				<div class="flex flex-col gap-4">
					<div class="rounded-xl border bg-card p-4 shadow-sm">
						<h2 class="text-sm font-semibold">
							{m.quick_cut_segments_label()} · {segments.length}
						</h2>
						<p class="mt-1 text-xs text-muted-foreground">{m.quick_cut_segments_hint()}</p>

						<div class="mt-3 flex flex-wrap items-center gap-2">
							<label class="flex items-center gap-2 text-xs">
								<input
									type="checkbox"
									bind:checked={merge}
									onchange={syncProject}
									class="h-4 w-4 rounded border-input"
								/>
								{m.quick_cut_merge_label()}
							</label>
							<label class="flex items-center gap-2 text-xs">
								<input
									type="radio"
									name="cutMode"
									value="nearestKeyframe"
									checked={cutMode === 'nearestKeyframe'}
									onchange={() => (cutMode = 'nearestKeyframe')}
									class="h-4 w-4"
								/>
								{m.quick_cut_cut_mode_nearest()}
							</label>
							<label class="flex items-center gap-2 text-xs">
								<input
									type="radio"
									name="cutMode"
									value="exact"
									checked={cutMode === 'exact'}
									onchange={() => (cutMode = 'exact')}
									class="h-4 w-4"
								/>
								{m.quick_cut_cut_mode_exact()}
							</label>
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
								disabled={segments.length === 0}
								class="min-h-11">{m.quick_cut_send_to_openpost()}</Button
							>
						</div>
					</div>

					<ExportPanel progress={exportProgress} cancel={cancelExport} isExporting={exporting} />

					<div class="flex flex-wrap gap-2">
						<Button
							size="sm"
							disabled={exporting || segments.length === 0}
							onclick={handleExportAll}
							class="min-h-11 flex-1">{m.quick_cut_export_all()}</Button
						>
						{#if merge}
							<Button
								size="sm"
								variant="secondary"
								disabled={exporting || segments.length < 2}
								onclick={handleExportMerged}
								class="min-h-11 flex-1">{m.quick_cut_export_merged()}</Button
							>
						{/if}
					</div>

					{#if segments.length === 1}
						<Button
							size="sm"
							disabled={exporting}
							onclick={() => handleExportOne(segments[0]!)}
							class="min-h-11">{m.quick_cut_export()}</Button
						>
					{/if}

					<ul class="space-y-2">
						{#each segments as seg, idx (seg.id)}
							{@const src = sources.find((s) => s.id === seg.sourceId)}
							<li class="flex items-center justify-between rounded-lg border bg-card p-2">
								<span class="font-mono text-xs"
									>{idx + 1}. {src?.name ?? ''}
									{formatTimecode(seg.start)} → {formatTimecode(seg.end)}</span
								>
								<div class="flex gap-1">
									<Button
										size="xs"
										variant="ghost"
										onclick={() => previewSegment(seg.id)}
										class="min-h-11 md:min-h-7">{m.quick_cut_preview()}</Button
									>
									<Button
										size="xs"
										disabled={exporting}
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
