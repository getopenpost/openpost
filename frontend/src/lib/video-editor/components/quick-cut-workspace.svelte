<!--
THESIS: Long recordings become a short list of kept sections with the source always visible.
OWN-WORLD: Dark editing desk, one amber keep color, compact transport controls, and a source-scale timeline.
STORY: Mark the useful ranges, verify keyframe-safe starts, then copy the streams without a render wait.
FIRST VIEWPORT: Large source preview, transport and cut actions, original-time strip, kept-section list, fast export.
FORM: LosslessCut-style focused operate surface; no asset library, effects browser, or composition inspector.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		derivePrimarySequence,
		isPrimarySequenceClip,
		projectDurationUS,
		type VideoProjectDocumentV1
	} from '@openpost/video-project';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import {
		ensureSourceArtifacts,
		getSourceArtifactIndex,
		subscribeToSourceArtifacts,
		type SourceArtifactIndex
	} from '../artifacts';
	import { listProjectAssets, readProjectFile } from '../storage';
	import { localVideoSourceURL } from '../source-url';
	import {
		isKeyframeAligned,
		nearestKeyframeUS,
		quickCutCompatibility,
		resolveKeyframeAlignment
	} from '../lossless';
	import CheckIcon from 'lucide-svelte/icons/check';
	import DownloadIcon from 'lucide-svelte/icons/download';
	import FilmIcon from 'lucide-svelte/icons/film';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PauseIcon from 'lucide-svelte/icons/pause';
	import PlayIcon from 'lucide-svelte/icons/play';
	import ScissorsIcon from 'lucide-svelte/icons/scissors';
	import SparklesIcon from 'lucide-svelte/icons/sparkles';
	import TrashIcon from 'lucide-svelte/icons/trash-2';

	interface Props {
		project: VideoProjectDocumentV1;
		projectID: string;
		playheadUS?: number;
		playing: boolean;
		selectedClipID: string;
		fastExportBusy: boolean;
		fastExportProgress: number;
		onSeek: (timestampUS: number) => void;
		onSelectClip: (clipID: string) => void;
		onTogglePlayback: () => void;
		onSplit: () => void;
		onDelete: () => void;
		onTrim: (clipID: string, edge: 'start' | 'end', deltaUS: number) => void;
		onSetSourceBoundary: (clipID: string, edge: 'start' | 'end', sourceTimestampUS: number) => void;
		onFastExport: () => void;
		onExportSegment: (clipID: string) => void;
		onPreciseExport: () => void;
		onOpenEditor: () => void;
	}

	let {
		project,
		projectID,
		playheadUS = $bindable(0),
		playing,
		selectedClipID,
		fastExportBusy,
		fastExportProgress,
		onSeek,
		onSelectClip,
		onTogglePlayback,
		onSplit,
		onDelete,
		onTrim,
		onSetSourceBoundary,
		onFastExport,
		onExportSegment,
		onPreciseExport,
		onOpenEditor
	}: Props = $props();
	let videoElement = $state<HTMLVideoElement>();
	let sourceURL = $state('');
	let keyframesUS = $state.raw<number[]>([]);
	let waveformPeaks = $state.raw<number[]>([]);
	let thumbnailURL = $state('');
	let artifact = $state.raw<SourceArtifactIndex | null>(null);
	let artifactError = $state('');
	const compatibility = $derived(quickCutCompatibility(project));
	const source = $derived(project.sources[compatibility.segments[0]?.source_id ?? '']);
	const sourceDurationUS = $derived(Math.max(1, source?.duration_us ?? 1));
	const durationUS = $derived(Math.max(1, projectDurationUS(project)));
	const sequenceTiming = $derived(derivePrimarySequence(project));
	const activeTiming = $derived(
		sequenceTiming.find(
			(item) =>
				item.kind === 'clip' &&
				playheadUS >= item.timeline_start_us &&
				playheadUS <= item.timeline_end_us
		) ?? sequenceTiming.find((item) => item.clip_id === selectedClipID)
	);
	const activeClip = $derived.by(() => {
		if (!activeTiming) return undefined;
		const item = project.primary_sequence[activeTiming.index];
		return item && isPrimarySequenceClip(item) ? item : undefined;
	});
	const sourcePlayheadUS = $derived(
		activeClip && activeTiming
			? activeClip.source_in_us + Math.max(0, playheadUS - activeTiming.timeline_start_us)
			: 0
	);
	const keyframeSafe = $derived(isKeyframeAligned(keyframesUS, activeClip?.source_in_us ?? 0));
	const allKeyframesSafe = $derived(
		artifact?.index_complete === true &&
			keyframesUS.length > 0 &&
			compatibility.segments.every((segment) =>
				resolveKeyframeAlignment(keyframesUS, segment.source_start_us)
			)
	);

	onMount(() => {
		let stopped = false;
		const controller = new AbortController();
		const unsubscribe = subscribeToSourceArtifacts((progress) => {
			if (progress.project_id !== projectID || progress.source_id !== source?.id || stopped) return;
			artifact = progress.artifact;
			keyframesUS = progress.artifact.keyframes_us;
			waveformPeaks = progress.artifact.waveform_peaks;
			void refreshVisualAssets().catch(() => undefined);
		});
		void loadArtifacts();
		async function loadArtifacts() {
			if (!source) return;
			try {
				sourceURL = await localVideoSourceURL(source, projectID, false);
				artifact = await getSourceArtifactIndex(projectID, source.id);
				if (artifact) {
					keyframesUS = artifact.keyframes_us;
					waveformPeaks = artifact.waveform_peaks;
				}
				await refreshVisualAssets();
				artifact = await ensureSourceArtifacts(projectID, source, {
					profile: 'index',
					signal: controller.signal
				});
				if (artifact) keyframesUS = artifact.keyframes_us;
			} catch (cause) {
				if (!controller.signal.aborted) {
					artifactError =
						cause instanceof Error ? cause.message : m.video_editor_quick_index_failed();
				}
			}
		}
		async function refreshVisualAssets() {
			if (!source) return;
			const assets = await listProjectAssets(projectID, source.id);
			const waveform = assets.find((item) => item.kind === 'waveform');
			const thumbnail = assets.find((item) => item.kind === 'thumbnail');
			if (waveform) {
				const file = await readProjectFile(waveform.path);
				if (file && !stopped) waveformPeaks = JSON.parse(await file.text()) as number[];
			}
			if (thumbnail) {
				const file = await readProjectFile(thumbnail.path);
				if (file && !stopped) {
					if (thumbnailURL) URL.revokeObjectURL(thumbnailURL);
					thumbnailURL = URL.createObjectURL(file);
				}
			}
		}
		return () => {
			stopped = true;
			controller.abort();
			unsubscribe();
			if (thumbnailURL) URL.revokeObjectURL(thumbnailURL);
		};
	});

	onDestroy(() => {
		videoElement?.pause();
	});

	$effect(() => {
		if (!videoElement || !sourceURL) return;
		const expected = sourcePlayheadUS / 1_000_000;
		if (Math.abs(videoElement.currentTime - expected) > (playing ? 0.16 : 0.025)) {
			videoElement.currentTime = expected;
		}
		if (playing) void videoElement.play().catch(() => undefined);
		else videoElement.pause();
	});

	function setInPoint(): void {
		if (!activeClip || !activeTiming) return;
		onTrim(activeClip.id, 'start', playheadUS - activeTiming.timeline_start_us);
	}

	function setOutPoint(): void {
		if (!activeClip || !activeTiming) return;
		onTrim(activeClip.id, 'end', playheadUS - activeTiming.timeline_end_us);
	}

	function snapInPoint(): void {
		if (!activeClip || !activeTiming) return;
		const nearest = nearestKeyframeUS(keyframesUS, activeClip.source_in_us);
		if (nearest === null) return;
		onSetSourceBoundary(activeClip.id, 'start', nearest);
		onSeek(activeTiming.timeline_start_us);
	}

	function seekSource(event: PointerEvent): void {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const sourceTime = Math.max(
			0,
			Math.min(sourceDurationUS, ((event.clientX - rect.left) / rect.width) * sourceDurationUS)
		);
		let closestTimeline = 0;
		let closestDistance = Number.POSITIVE_INFINITY;
		let closestClipID = '';
		for (const segment of compatibility.segments) {
			const bounded = Math.max(
				segment.source_start_us,
				Math.min(segment.source_end_us, sourceTime)
			);
			const distance = Math.abs(bounded - sourceTime);
			if (distance >= closestDistance) continue;
			closestDistance = distance;
			closestTimeline = segment.timeline_start_us + bounded - segment.source_start_us;
			closestClipID = segment.clip_id;
		}
		if (closestClipID) onSelectClip(closestClipID);
		onSeek(closestTimeline);
	}

	function formatTime(timestampUS: number): string {
		const totalSeconds = Math.max(0, timestampUS / 1_000_000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = Math.floor(totalSeconds % 60);
		const frames = Math.floor((totalSeconds % 1) * 30);
		return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
	}

	function attachVideo(node: HTMLVideoElement): () => void {
		videoElement = node;
		return () => {
			if (videoElement === node) videoElement = undefined;
		};
	}
</script>

<div
	class="grid min-h-0 flex-1 grid-rows-[minmax(14rem,1fr)_minmax(13rem,42dvh)] bg-[#101012] text-zinc-100 sm:grid-rows-[minmax(18rem,1fr)_minmax(13rem,40dvh)] lg:grid-cols-[minmax(0,1fr)_18rem] lg:grid-rows-1"
>
	<main class="flex min-h-0 flex-col">
		<div class="flex min-h-0 flex-1 items-center justify-center bg-[#08080a] p-4 sm:p-6">
			<div
				class="relative max-h-full max-w-full overflow-hidden rounded-md bg-black shadow-[0_18px_60px_rgb(0_0_0/0.5)]"
				style:aspect-ratio={`${Math.max(1, source?.width ?? 16)} / ${Math.max(1, source?.height ?? 9)}`}
			>
				{#if sourceURL}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						{@attach attachVideo}
						src={sourceURL}
						class="size-full object-contain"
						playsinline
						preload="auto"
						aria-label={source?.original_name}
					></video>
				{:else}
					<div class="flex aspect-video min-w-72 items-center justify-center text-sm text-zinc-500">
						<LoaderIcon class="mr-2 size-4 animate-spin" />
						{m.common_loading()}
					</div>
				{/if}
			</div>
		</div>

		<div class="border-t border-white/10 bg-[#17171a]">
			<div
				class="flex min-h-14 flex-wrap items-center justify-center gap-1 border-b border-white/10 px-3 py-2"
			>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={onTogglePlayback}
					aria-label={playing ? m.video_editor_pause() : m.video_editor_play()}
				>
					{#if playing}<PauseIcon class="size-4" />{:else}<PlayIcon class="size-4" />{/if}
				</Button>
				<span class="mx-2 font-mono text-xs text-zinc-300 tabular-nums"
					>{formatTime(playheadUS)} / {formatTime(durationUS)}</span
				>
				<span class="mx-1 hidden h-5 w-px bg-white/10 sm:block"></span>
				<Button
					variant="ghost"
					size="sm"
					onclick={setInPoint}
					disabled={!activeClip || playheadUS <= (activeTiming?.timeline_start_us ?? 0)}
					>{m.video_editor_quick_mark_in()}</Button
				>
				<Button
					variant="ghost"
					size="sm"
					onclick={setOutPoint}
					disabled={!activeClip || playheadUS >= (activeTiming?.timeline_end_us ?? 0)}
					>{m.video_editor_quick_mark_out()}</Button
				>
				<Button variant="ghost" size="sm" onclick={onSplit} disabled={!activeClip}
					><ScissorsIcon class="size-4" />{m.video_editor_quick_split()}</Button
				>
				<Button variant="ghost" size="sm" onclick={onDelete} disabled={!activeClip}
					><TrashIcon class="size-4" />{m.video_editor_quick_remove()}</Button
				>
			</div>

			<div class="space-y-3 p-3 sm:p-4" aria-label={m.video_editor_quick_source_timeline()}>
				<div class="flex items-center justify-between gap-3">
					<div>
						<h2 class="text-xs font-semibold text-zinc-200">
							{m.video_editor_quick_source_timeline()}
						</h2>
						<p class="mt-0.5 text-[11px] text-zinc-500">
							{m.video_editor_quick_source_time({ time: formatTime(sourcePlayheadUS) })}
						</p>
					</div>
					{#if activeClip && keyframesUS.length}
						<Button variant="ghost" size="xs" onclick={snapInPoint} disabled={keyframeSafe}>
							<SparklesIcon class="size-3.5" />{m.video_editor_quick_snap_keyframe()}
						</Button>
					{/if}
				</div>
				<Slider
					value={playheadUS}
					min={0}
					max={durationUS}
					step={Math.max(1, Math.round(1_000_000 / 60))}
					onValueChange={onSeek}
					ariaLabel={m.video_editor_timeline()}
				/>
				<button
					type="button"
					class="relative h-16 w-full overflow-hidden rounded-md bg-[#242429] text-left ring-offset-[#17171a] focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:outline-none"
					onpointerdown={seekSource}
					aria-label={m.video_editor_quick_source_timeline()}
				>
					{#if thumbnailURL}
						<div
							class="absolute inset-0 opacity-25"
							style:background-image={`url(${thumbnailURL})`}
							style:background-size="auto 100%"
						></div>
					{/if}
					{#if waveformPeaks.length}
						<div
							class="absolute inset-x-0 top-1/2 flex h-10 -translate-y-1/2 items-center opacity-50"
						>
							{#each waveformPeaks as peak, index (index)}
								<span
									class="min-w-px flex-1 bg-zinc-400"
									style:height={`${Math.max(2, peak * 36)}px`}
								></span>
							{/each}
						</div>
					{/if}
					{#each compatibility.segments as segment (segment.clip_id)}
						<span
							class={[
								'absolute inset-y-0 border-x border-orange-300/60 bg-orange-400/24',
								segment.clip_id === selectedClipID && 'ring-2 ring-orange-300 ring-inset'
							]}
							style:left={`${(segment.source_start_us / sourceDurationUS) * 100}%`}
							style:width={`${((segment.source_end_us - segment.source_start_us) / sourceDurationUS) * 100}%`}
						></span>
					{/each}
					<span
						class="absolute inset-y-0 z-10 w-px bg-white"
						style:left={`${(sourcePlayheadUS / sourceDurationUS) * 100}%`}
					></span>
				</button>
			</div>
		</div>
	</main>

	<aside
		class="min-h-0 overflow-y-auto border-t border-white/10 bg-[#1c1c20] p-4 lg:border-t-0 lg:border-l"
		aria-label={m.video_editor_quick_kept_sections()}
	>
		<div class="flex items-center gap-2">
			<FilmIcon class="size-4 text-orange-400" />
			<h2 class="font-semibold">{m.video_editor_quick_kept_sections()}</h2>
		</div>
		<p class="mt-1 text-xs leading-5 text-zinc-400">
			{compatibility.segments.length} · {formatTime(durationUS)}
		</p>
		<div class="mt-4 space-y-1.5">
			{#each compatibility.segments as segment, index (segment.clip_id)}
				<div
					class={[
						'flex min-h-12 w-full items-center rounded-md text-sm transition-colors',
						segment.clip_id === selectedClipID
							? 'bg-orange-400/16 text-orange-100'
							: 'bg-white/[0.035] text-zinc-300'
					]}
				>
					<button
						type="button"
						class="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-l-md px-3 text-left hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:outline-none"
						onclick={() => {
							onSelectClip(segment.clip_id);
							onSeek(segment.timeline_start_us);
						}}
					>
						<span class="font-mono text-xs text-zinc-500">{String(index + 1).padStart(2, '0')}</span
						>
						<span class="min-w-0 flex-1">
							<span class="block font-medium"
								>{m.video_editor_quick_section({ number: index + 1 })}</span
							>
							<span class="block truncate text-[11px] text-zinc-500"
								>{formatTime(segment.source_start_us)} → {formatTime(segment.source_end_us)}</span
							>
						</span>
					</button>
					<Button
						variant="ghost"
						size="icon-sm"
						class="mr-1 shrink-0"
						disabled={fastExportBusy ||
							!artifact?.index_complete ||
							!isKeyframeAligned(keyframesUS, segment.source_start_us)}
						onclick={() => onExportSegment(segment.clip_id)}
						aria-label={m.video_editor_quick_export_section({ number: index + 1 })}
						title={m.video_editor_quick_export_section({ number: index + 1 })}
					>
						<DownloadIcon class="size-4" />
					</Button>
				</div>
			{/each}
		</div>

		<div class="mt-5 border-t border-white/10 pt-4">
			{#if artifact && !artifact.index_complete}
				<div class="mb-4" aria-live="polite">
					<div class="flex items-center justify-between gap-3 text-xs text-zinc-400">
						<span>{m.video_editor_quick_indexing()}</span>
						<span class="font-mono tabular-nums">{Math.round(artifact.progress * 100)}%</span>
					</div>
					<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
						<div
							class="h-full bg-orange-400 transition-[width] duration-150"
							style:width={`${Math.round(artifact.progress * 100)}%`}
						></div>
					</div>
				</div>
			{/if}
			{#if artifactError}
				<p class="mb-4 text-xs leading-5 text-red-300" role="alert">{artifactError}</p>
			{/if}
			{#if compatibility.compatible}
				<p class="flex gap-2 text-xs leading-5 text-zinc-400">
					<CheckIcon
						class="mt-0.5 size-3.5 shrink-0 text-emerald-400"
					/>{m.video_editor_quick_lossless_ready()}
				</p>
				{#if keyframesUS.length}
					<p
						class={[
							'mt-2 text-xs leading-5',
							allKeyframesSafe ? 'text-emerald-400' : 'text-amber-300'
						]}
					>
						{allKeyframesSafe
							? m.video_editor_quick_keyframe_ready()
							: m.video_editor_quick_keyframe_adjust()}
					</p>
				{/if}
			{:else}
				<p class="text-xs leading-5 text-amber-300">{m.video_editor_quick_lossless_blocked()}</p>
			{/if}
			{#if fastExportBusy}
				<div class="mt-4" aria-live="polite">
					<div class="h-1.5 overflow-hidden rounded-full bg-white/10">
						<div
							class="h-full bg-orange-400"
							style:width={`${Math.round(fastExportProgress * 100)}%`}
						></div>
					</div>
					<p class="mt-2 text-xs text-zinc-400">
						{m.video_editor_quick_exporting()}
						{Math.round(fastExportProgress * 100)}%
					</p>
				</div>
			{/if}
			<Button
				class="mt-4 w-full"
				disabled={!compatibility.compatible ||
					!artifact?.index_complete ||
					!allKeyframesSafe ||
					fastExportBusy}
				onclick={onFastExport}
			>
				{#if fastExportBusy}<LoaderIcon class="size-4 animate-spin" />{:else}<SparklesIcon
						class="size-4"
					/>{/if}
				{m.video_editor_quick_fast_export()}
			</Button>
			{#if compatibility.compatible && artifact?.index_complete && !allKeyframesSafe}
				<p class="mt-3 text-xs leading-5 text-zinc-400">
					{m.video_editor_quick_precise_description()}
				</p>
				<Button class="mt-2 w-full" variant="outline" onclick={onPreciseExport}>
					{m.video_editor_quick_precise_export()}
				</Button>
			{/if}
			<Button class="mt-2 w-full" variant="outline" onclick={onOpenEditor}
				>{m.video_editor_quick_open_full()}</Button
			>
		</div>
	</aside>
</div>
