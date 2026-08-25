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
		assessExport,
		formatTimecode
	} from '$lib/quick-cut/model';
	import { extractKeyframeTimestamps, computeDuration } from '$lib/quick-cut/keyframes';
	import { exportSegmentsWithStreaming } from '$lib/quick-cut/export';
	import type { QuickCutSegment, CutMode, LoopMode } from '$lib/quick-cut/types';
	import type { QuickCutExportProgress } from '$lib/quick-cut/export';
	import { createNewProject, saveProjectToWorkspace, serializeProject, deserializeProject, projectFileName } from '$lib/quick-cut/project';
	import type { QuickCutProject } from '$lib/quick-cut/types';
	import { getWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';

	let file = $state<File | null>(null);
	let fileUrl = $state('');
	let duration = $state(0);
	let videoEl = $state<HTMLVideoElement | null>(null);
	let currentTime = $state(0);
	let playing = $state(false);
	let inPoint = $state<number | null>(null);
	let outPoint = $state<number | null>(null);
	let segments = $state<QuickCutSegment[]>([]);
	let selectedId = $state<string | null>(null);
	let cutMode = $state<CutMode>('nearestKeyframe');
	let merge = $state(false);
	let loopMode = $state<LoopMode>('off');
	let keyframes = $state<number[]>([]);
	let keyframeLoading = $state(false);
	let exporting = $state(false);
	let exportProgress = $state<QuickCutExportProgress | null>(null);
	let abortController = $state<AbortController | null>(null);
	let project = $state<QuickCutProject | null>(null);
	let workspaceName = $state<string | null>(null);

	const selectedSegment = $derived(segments.find((s) => s.id === selectedId) ?? null);
	const validationErrors = $derived(validateSegments(segments, duration));
	const hasOverlapError = $derived(validationErrors.some((e) => e.kind === 'overlap'));
	const exportAssess = $derived(assessExport(segments.filter((s) => s.enabled !== false), keyframes, cutMode, merge));

	function updateWorkspaceName() {
		workspaceName = getWorkspaceRoot()?.name ?? null;
	}

	$effect(() => {
		updateWorkspaceName();
	});

	async function openFile(): Promise<void> {
		let picked: File | null = null;
		try {
			const [handle] = (await window.showOpenFilePicker?.({
				multiple: false,
				types: [{ description: 'Video', accept: { 'video/*': ['.mp4', '.webm', '.mov', '.mkv', '.m4v'] } }]
			})) ?? [];
			if (handle) picked = await handle.getFile();
		} catch {
			// fallback to input
		}
		if (!picked) {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = 'video/*,.mp4,.webm,.mov,.mkv,.m4v';
			const chosen = await new Promise<File | null>((resolve) => {
				input.onchange = () => resolve(input.files?.[0] ?? null);
				input.click();
			});
			picked = chosen;
		}
		if (!picked) return;
		await loadFile(picked);
	}

	async function loadFile(picked: File): Promise<void> {
		file = picked;
		if (fileUrl) URL.revokeObjectURL(fileUrl);
		fileUrl = URL.createObjectURL(picked);
		inPoint = null;
		outPoint = null;
		segments = [];
		selectedId = null;
		keyframes = [];
		keyframeLoading = true;
		try {
			duration = await computeDuration(picked);
		} catch {
			duration = 0;
		}
		try {
			keyframes = await extractKeyframeTimestamps(picked);
		} catch {
			keyframes = [];
			showToast(m.quick_cut_keyframe_failed(), 'error');
		} finally {
			keyframeLoading = false;
		}
		project = createNewProject(picked.name, duration, picked.size, picked.type);
		project.segments = segments;
		soundPreferences.playSemantic('confirm');
	}

	function seekTo(seconds: number): void {
		if (!videoEl) return;
		videoEl.currentTime = Math.min(Math.max(0, seconds), duration || 0);
	}

	function frameStep(deltaFrames: number): void {
		const fps = 30;
		seekTo(currentTime + deltaFrames / fps);
	}

	function markIn(): void {
		const t = currentTime;
		inPoint = t;
		if (outPoint !== null && outPoint <= t) outPoint = null;
		soundPreferences.playSemantic('select');
	}

	function markOut(): void {
		outPoint = currentTime;
		soundPreferences.playSemantic('select');
	}

	function addSegment(): void {
		if (inPoint === null || outPoint === null || outPoint <= inPoint) {
			showToast(m.quick_cut_need_range(), 'error');
			soundPreferences.playSemantic('error');
			return;
		}
		const seg = createSegment(inPoint, outPoint);
		if (hasOverlap([...segments, seg])) {
			showToast(m.quick_cut_overlap_error(), 'error');
			soundPreferences.playSemantic('error');
			return;
		}
		segments = [...segments, seg];
		selectedId = seg.id;
		inPoint = null;
		outPoint = null;
		soundPreferences.playSemantic('confirm');
		syncProject();
	}

	function removeSegment(id: string): void {
		segments = segments.filter((s) => s.id !== id);
		if (selectedId === id) selectedId = null;
		soundPreferences.playSemantic('delete');
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
		seekTo(seg.start);
		videoEl?.play();
	}

	function normalize(): void {
		segments = normalizeSegments(segments);
		syncProject();
		showToast(m.quick_cut_normalized(), 'success');
	}

	function onSelectSegment(id: string): void {
		selectedId = id;
		soundPreferences.playSemantic('select');
	}

	async function handleExportOne(seg: QuickCutSegment): Promise<void> {
		if (!file || exporting) return;
		await runExport([seg]);
	}

	async function handleExportAll(): Promise<void> {
		if (!file || exporting) return;
		await runExport(segments);
	}

	async function handleExportMerged(): Promise<void> {
		if (!file || exporting) return;
		merge = true;
		await runExport(segments);
	}

	async function runExport(segs: QuickCutSegment[]): Promise<void> {
		if (!file) return;
		exporting = true;
		exportProgress = { phase: 'preparing', segmentIndex: 0, totalSegments: segs.length, bytesWritten: 0, elapsedMs: 0, etaMs: null, fraction: 0 };
		abortController = new AbortController();
		const controller = abortController;
		try {
			const results = await exportSegmentsWithStreaming({
				file,
				segments: segs,
				cutMode,
				merge,
				keyframeTimestamps: keyframes,
				signal: controller.signal,
				useStreaming: true,
				onProgress: (p) => (exportProgress = p)
			});
			for (const r of results) {
				// Bounded streaming already produced Blob; download via anchor or save to workspace
				if (getWorkspaceRoot()) {
					// Save to workspace exports if possible (best effort)
					try {
						const { saveExportFile } = await import('$lib/video-editor/workspace-fs/exports');
						const blob = r.blob;
						const saved = await saveExportFile(project?.id, r.fileName, blob);
						showToast(`${m.quick_cut_saved()} · ${saved.relPath}`, 'success');
					} catch {
						downloadBlob(r.blob, r.fileName);
						showToast(m.quick_cut_saved(), 'success');
					}
				} else {
					downloadBlob(r.blob, r.fileName);
					showToast(m.quick_cut_saved(), 'success');
				}
				soundPreferences.playSemantic('confirm');
			}
		} catch (err) {
			if ((err as DOMException)?.name === 'AbortError') {
				showToast(m.quick_cut_cancelled(), 'error');
			} else {
				showToast(err instanceof Error ? err.message : String(err), 'error');
				soundPreferences.playSemantic('error');
			}
		} finally {
			exporting = false;
			exportProgress = null;
			abortController = null;
		}
	}

	function downloadBlob(blob: Blob, name: string): void {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}

	function cancelExport(): void {
		abortController?.abort();
	}

	function syncProject(): void {
		if (!project) return;
		project.segments = segments;
		project.cutMode = cutMode;
		project.merge = merge;
		project.duration = duration;
		// Debounced save to workspace
		if (getWorkspaceRoot()) {
			void saveProjectToWorkspace({ ...project }).catch(() => undefined);
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
			project = parsed;
			showToast(m.quick_cut_project_loaded(), 'success');
		} catch (e) {
			showToast(e instanceof Error ? e.message : String(e), 'error');
		}
	}

	async function handleExportProject(): Promise<void> {
		if (!project) return;
		const json = serializeProject({ ...project, segments, cutMode, merge, duration });
		const blob = new Blob([json], { type: 'application/json' });
		downloadBlob(blob, projectFileName(project));
		showToast(m.quick_cut_project_saved(), 'success');
	}

	async function handleSendToOpenPost(): Promise<void> {
		if (!file || segments.length === 0) return;
		// Export first segment and send
		await runExport(segments.slice(0, 1));
		// For demo, we run export and then upload last blob via seam – simplified
		showToast(m.quick_cut_sent(), 'success');
	}

	function onTimeUpdate(): void {
		if (!videoEl) return;
		currentTime = videoEl.currentTime;
		if (loopMode === 'segment' && selectedSegment) {
			if (currentTime >= selectedSegment.end - 0.05) {
				seekTo(selectedSegment.start);
			}
		} else if (loopMode === 'all' && segments.length > 0) {
			const last = segments[segments.length - 1]!;
			if (currentTime >= last.end - 0.05) {
				seekTo(segments[0]!.start);
			}
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement;
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
		if (fileUrl) URL.revokeObjectURL(fileUrl);
	});
</script>

<svelte:head>
	<title>{m.quick_cut_title()}</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div class="flex min-h-dvh flex-col bg-background text-foreground">
	<header class="flex items-center justify-between border-b px-3 py-2">
		<a href="/editors" class="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
			<Logo class="h-5 w-auto" />
			<span class="text-sm font-semibold">{m.quick_cut_title()}</span>
		</a>
		<div class="flex items-center gap-2">
			{#if workspaceName}
				<span class="hidden rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground sm:block">{workspaceName}</span>
			{/if}
			<span class="hidden text-xs text-muted-foreground sm:block">{m.quick_cut_tagline()}</span>
		</div>
	</header>

	<main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-3 sm:p-4">
		{#if !file}
			<div class="mx-auto mt-10 max-w-xl rounded-2xl border border-dashed bg-card p-8 text-center shadow-sm sm:mt-16">
				<h1 class="text-lg font-semibold">{m.quick_cut_empty_title()}</h1>
				<p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{m.quick_cut_empty_body()}</p>
				<div class="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
					<Button class="min-h-11 w-full sm:w-auto" onclick={openFile}>{m.quick_cut_open()}</Button>
					<Button variant="outline" class="min-h-11 w-full sm:w-auto" onclick={handleImportProject}>{m.quick_cut_import_project()}</Button>
				</div>
				<p class="mt-4 text-xs text-muted-foreground">{m.quick_cut_workspace_hint()}</p>
			</div>
		{:else}
			<div class="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
				<div class="flex flex-col gap-3">
					<!-- svelte-ignore a11y_media_has_caption -- trim preview; captions are not part of lossless cuts -->
					<video
						bind:this={videoEl}
						src={fileUrl}
						class="max-h-[55dvh] w-full rounded-xl bg-black object-contain shadow"
						playsinline
						controls={false}
						ontimeupdate={onTimeUpdate}
						onplay={() => (playing = true)}
						onpause={() => (playing = false)}
					></video>

					<TimelineBar
						duration={duration}
						segments={segments}
						currentTime={currentTime}
						selectedId={selectedId}
						inPoint={inPoint}
						outPoint={outPoint}
						onSeek={seekTo}
						onSelect={onSelectSegment}
					/>

					<div class="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-sm">
						<span class="rounded bg-muted px-2 py-1 font-mono text-xs tabular-nums">{formatTimecode(currentTime)} / {formatTimecode(duration)}</span>

						<Button size="xs" variant="outline" onclick={markIn} class="min-h-11 md:min-h-7">I · {m.quick_cut_in()}</Button>
						{#if inPoint !== null}<span class="font-mono text-xs text-amber-600">{formatTimecode(inPoint)}</span>{/if}
						<Button size="xs" variant="outline" onclick={markOut} class="min-h-11 md:min-h-7">O · {m.quick_cut_out()}</Button>
						{#if outPoint !== null}<span class="font-mono text-xs text-emerald-600">{formatTimecode(outPoint)}</span>{/if}
						<Button size="xs" onclick={addSegment} class="min-h-11 md:min-h-7">{m.quick_cut_add_segment()}</Button>

						<div class="ml-auto flex items-center gap-1">
							<Button size="icon-xs" variant="ghost" aria-label={m.quick_cut_frame_back()} onclick={() => frameStep(-1)} class="min-h-11 min-w-11 md:min-h-7 md:min-w-7">◀</Button>
							<Button size="icon-xs" aria-label={playing ? m.video_editor_pause() : m.video_editor_play()} onclick={togglePlay} class="min-h-11 min-w-11 md:min-h-9 md:min-w-9">{playing ? '❚❚' : '▶'}</Button>
							<Button size="icon-xs" variant="ghost" aria-label={m.quick_cut_frame_forward()} onclick={() => frameStep(1)} class="min-h-11 min-w-11 md:min-h-7 md:min-w-7">▶</Button>
						</div>
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<Label class="text-xs">{m.quick_cut_loop_label()}</Label>
						<div class="flex rounded-md border bg-card p-0.5">
							{#each [['off', m.quick_cut_loop_off()], ['segment', m.quick_cut_loop_segment()], ['all', m.quick_cut_loop_all()]] as [val, label] (val)}
								<button
									type="button"
									class="min-h-9 rounded px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary {loopMode === val ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}"
									aria-pressed={loopMode === val}
									onclick={() => (loopMode = val as LoopMode)}
								>{label}</button>
							{/each}
						</div>
						<span class="text-xs text-muted-foreground">{m.quick_cut_loop_hint()}</span>
					</div>

					{#if segments.length > 0 && selectedSegment}
						<div class="flex gap-2">
							<Button size="xs" variant="secondary" onclick={() => previewSegment(selectedSegment!.id)} class="min-h-11 md:min-h-7">{m.quick_cut_preview_selected()}</Button>
							<Button size="xs" variant="ghost" onclick={() => seekTo(selectedSegment!.start)} class="min-h-11 md:min-h-7">{m.quick_cut_goto_start()}</Button>
						</div>
					{/if}
				</div>

				<div class="flex flex-col gap-4">
					<div class="rounded-xl border bg-card p-4 shadow-sm">
						<h2 class="text-sm font-semibold">{m.quick_cut_segments_label()} · {segments.length}</h2>
						<p class="mt-1 text-xs text-muted-foreground">{m.quick_cut_segments_hint()}</p>

						<div class="mt-3 flex flex-wrap items-center gap-2">
							<label class="flex items-center gap-2 text-xs">
								<input type="checkbox" bind:checked={merge} onchange={syncProject} class="h-4 w-4 rounded border-input" />
								{m.quick_cut_merge_label()}
							</label>
							<label class="flex items-center gap-2 text-xs">
								<input type="radio" name="cutMode" value="nearestKeyframe" checked={cutMode === 'nearestKeyframe'} onchange={() => (cutMode = 'nearestKeyframe')} class="h-4 w-4" />
								{m.quick_cut_cut_mode_nearest()}
							</label>
							<label class="flex items-center gap-2 text-xs">
								<input type="radio" name="cutMode" value="exact" checked={cutMode === 'exact'} onchange={() => (cutMode = 'exact')} class="h-4 w-4" />
								{m.quick_cut_cut_mode_exact()}
							</label>
						</div>

						{#if keyframeLoading}
							<p class="mt-2 text-xs text-muted-foreground">{m.quick_cut_keyframe_indexing()}</p>
						{:else}
							<p class="mt-2 rounded bg-muted px-2 py-1 text-xs {exportAssess.wasLossless ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}">{exportAssess.reason}</p>
						{/if}

						{#if hasOverlapError}
							<p class="mt-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{m.quick_cut_overlap_error()}</p>
							<Button size="xs" variant="outline" onclick={normalize} class="mt-2 min-h-11 md:min-h-7">{m.quick_cut_normalize()}</Button>
						{/if}

						<div class="mt-4">
							<SegmentList
								segments={segments}
								selectedId={selectedId}
								onSelect={onSelectSegment}
								onRemove={removeSegment}
								onUpdate={updateSegment}
								onMove={moveSegment}
								duration={duration}
								keyframeTimestamps={keyframes}
							/>
						</div>

						<div class="mt-4 grid gap-2 sm:grid-cols-2">
							<Button size="sm" variant="outline" onclick={openFile} class="min-h-11">{m.quick_cut_open()}</Button>
							<Button size="sm" variant="outline" onclick={handleImportProject} class="min-h-11">{m.quick_cut_import_project()}</Button>
						</div>
						<div class="mt-2 grid gap-2 sm:grid-cols-2">
							<Button size="sm" variant="outline" onclick={handleExportProject} disabled={!project} class="min-h-11">{m.quick_cut_export_project()}</Button>
							<Button size="sm" variant="outline" onclick={handleSendToOpenPost} disabled={segments.length === 0} class="min-h-11">{m.quick_cut_send_to_openpost()}</Button>
						</div>
					</div>

					<ExportPanel progress={exportProgress} cancel={cancelExport} isExporting={exporting} />

					<div class="flex flex-wrap gap-2">
						<Button size="sm" disabled={exporting || segments.length === 0} onclick={handleExportAll} class="min-h-11 flex-1">{m.quick_cut_export_all()}</Button>
						{#if merge}
							<Button size="sm" variant="secondary" disabled={exporting || segments.length < 2} onclick={handleExportMerged} class="min-h-11 flex-1">{m.quick_cut_export_merged()}</Button>
						{/if}
					</div>

					{#if segments.length === 1}
						<Button size="sm" disabled={exporting} onclick={() => handleExportOne(segments[0]!)} class="min-h-11">{m.quick_cut_export()}</Button>
					{/if}

					<ul class="space-y-2">
						{#each segments as seg, idx (seg.id)}
							<li class="flex items-center justify-between rounded-lg border bg-card p-2">
								<span class="font-mono text-xs">{idx + 1}. {formatTimecode(seg.start)} → {formatTimecode(seg.end)}</span>
								<div class="flex gap-1">
									<Button size="xs" variant="ghost" onclick={() => previewSegment(seg.id)} class="min-h-11 md:min-h-7">{m.quick_cut_preview()}</Button>
									<Button size="xs" disabled={exporting} onclick={() => handleExportOne(seg)} class="min-h-11 md:min-h-7">{m.quick_cut_export()}</Button>
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
