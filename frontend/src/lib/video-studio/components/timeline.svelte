<script lang="ts">
	import {
		derivePrimarySequence,
		projectDurationUS,
		type VideoProjectDocumentV1
	} from '@openpost/video-project';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { listProjectAssets, readProjectFile } from '../storage';
	import { onMount } from 'svelte';
	import ScissorsIcon from 'lucide-svelte/icons/scissors';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import ZoomInIcon from 'lucide-svelte/icons/zoom-in';
	import ChevronLeftIcon from 'lucide-svelte/icons/chevron-left';
	import ChevronRightIcon from 'lucide-svelte/icons/chevron-right';

	interface Props {
		project: VideoProjectDocumentV1;
		projectID?: string;
		playheadUS?: number;
		selectedClipID?: string;
		selectedVisualItemID?: string;
		selectedAudioItemID?: string;
		selectedCaptionCueID?: string;
		zoom?: number;
		onSelectClip: (clipID: string) => void;
		onSelectVisualItem: (itemID: string) => void;
		onSelectAudioItem: (itemID: string) => void;
		onSelectCaptionCue: (cueID: string) => void;
		onSplit: () => void;
		onRippleDelete: () => void;
		onMove: (delta: number) => void;
		onReorder: (clipID: string, index: number) => void;
		onTrim: (clipID: string, edge: 'start' | 'end', deltaUS: number) => void;
	}

	let {
		project,
		projectID = '',
		playheadUS = $bindable(0),
		selectedClipID = '',
		selectedVisualItemID = '',
		selectedAudioItemID = '',
		selectedCaptionCueID = '',
		zoom = $bindable(1),
		onSelectClip,
		onSelectVisualItem,
		onSelectAudioItem,
		onSelectCaptionCue,
		onSplit,
		onRippleDelete,
		onMove,
		onReorder,
		onTrim
	}: Props = $props();
	const durationUS = $derived(Math.max(1, projectDurationUS(project)));
	const derivedClips = $derived(derivePrimarySequence(project));
	const widthPX = $derived(Math.max(720, (durationUS / 1_000_000) * 36 * zoom));
	let draggingClipID = $state('');
	let trimming = $state<{
		clipID: string;
		edge: 'start' | 'end';
		lastClientX: number;
	} | null>(null);
	let thumbnailURLs = $state<Record<string, string>>({});
	let waveformPeaks = $state<Record<string, number[]>>({});

	onMount(() => {
		let stopped = false;
		const refresh = async () => {
			if (!projectID) return;
			const assets = await listProjectAssets(projectID);
			const nextThumbnails: Record<string, string> = {};
			const nextWaveforms: Record<string, number[]> = {};
			for (const asset of assets) {
				if (stopped) return;
				if (asset.kind === 'thumbnail' && !nextThumbnails[asset.source_id]) {
					const file = await readProjectFile(asset.path);
					if (file) nextThumbnails[asset.source_id] = URL.createObjectURL(file);
				}
				if (asset.kind === 'waveform' && !nextWaveforms[asset.source_id]) {
					const file = await readProjectFile(asset.path);
					if (!file) continue;
					try {
						nextWaveforms[asset.source_id] = JSON.parse(await file.text()) as number[];
					} catch {
						// A stale waveform is disposable and will be regenerated.
					}
				}
			}
			for (const url of Object.values(thumbnailURLs)) URL.revokeObjectURL(url);
			thumbnailURLs = nextThumbnails;
			waveformPeaks = nextWaveforms;
		};
		void refresh();
		const delayedRefresh = window.setTimeout(() => void refresh(), 3_000);
		return () => {
			stopped = true;
			window.clearTimeout(delayedRefresh);
			for (const url of Object.values(thumbnailURLs)) URL.revokeObjectURL(url);
		};
	});

	function clipWidth(duration: number): number {
		return Math.max(48, (duration / durationUS) * widthPX);
	}

	function clipOffset(start: number): number {
		return (start / durationUS) * widthPX;
	}

	function timeLabel(timestampUS: number): string {
		const seconds = Math.floor(timestampUS / 1_000_000);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	function beginTrim(event: PointerEvent, clipID: string, edge: 'start' | 'end'): void {
		event.preventDefault();
		event.stopPropagation();
		onSelectClip(clipID);
		trimming = { clipID, edge, lastClientX: event.clientX };
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function continueTrim(event: PointerEvent): void {
		if (!trimming) return;
		const deltaPX = event.clientX - trimming.lastClientX;
		if (Math.abs(deltaPX) < 0.5) return;
		trimming.lastClientX = event.clientX;
		onTrim(trimming.clipID, trimming.edge, Math.round((deltaPX / widthPX) * durationUS));
	}

	function endTrim(event: PointerEvent): void {
		if (!trimming) return;
		trimming = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	function keyboardTrim(
		event: KeyboardEvent,
		clipID: string,
		edge: 'start' | 'end'
	): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		event.stopPropagation();
		onSelectClip(clipID);
		const frameUS = Math.max(
			1,
			Math.round(
				(1_000_000 * project.timebase.fps_denominator) / project.timebase.fps_numerator
			)
		);
		onTrim(
			clipID,
			edge,
			(event.key === 'ArrowLeft' ? -1 : 1) * frameUS * (event.shiftKey ? 10 : 1)
		);
	}
</script>

<section class="flex min-h-0 flex-col border-t bg-background" aria-labelledby="timeline-title">
	<div class="flex min-h-12 flex-wrap items-center gap-1 border-b px-2 sm:px-3">
		<h2 id="timeline-title" class="mr-2 text-sm font-medium">{m.video_studio_timeline()}</h2>
		<Button
			variant="ghost"
			size="sm"
			disabled={!selectedClipID}
			onclick={onSplit}
			title={`${m.video_studio_split()} (S)`}
		>
			<ScissorsIcon class="size-4" />
			<span class="hidden sm:inline">{m.video_studio_split()}</span>
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={!selectedClipID || project.primary_sequence[0]?.id === selectedClipID}
			onclick={() => onMove(-1)}
			aria-label={m.video_studio_move_clip_left()}
			title={`${m.video_studio_move_clip_left()} (Alt+←)`}
		>
			<ChevronLeftIcon class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={!selectedClipID || project.primary_sequence.at(-1)?.id === selectedClipID}
			onclick={() => onMove(1)}
			aria-label={m.video_studio_move_clip_right()}
			title={`${m.video_studio_move_clip_right()} (Alt+→)`}
		>
			<ChevronRightIcon class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="sm"
			disabled={!selectedClipID}
			onclick={onRippleDelete}
			title={`${m.video_studio_ripple_delete()} (Shift+Delete)`}
		>
			<TrashIcon class="size-4" />
			<span class="hidden sm:inline">{m.video_studio_ripple_delete()}</span>
		</Button>
		<div class="ml-auto flex w-40 items-center gap-2">
			<ZoomInIcon class="size-4 text-muted-foreground" />
			<Slider
				bind:value={zoom}
				min={0.5}
				max={4}
				step={0.1}
				ariaLabel={m.video_studio_zoom_timeline()}
			/>
		</div>
	</div>

	<div class="border-b px-3 py-2">
		<Slider
			value={playheadUS}
			min={0}
			max={durationUS}
			step={Math.max(1, Math.round(1_000_000 / project.timebase.fps_numerator))}
			ariaLabel={m.video_studio_timeline()}
			onValueChange={(value) => (playheadUS = value)}
			onValueCommit={(value) => (playheadUS = value)}
		/>
		<div class="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
			<span>{timeLabel(playheadUS)}</span>
			<span>{timeLabel(durationUS)}</span>
		</div>
	</div>

	<div class="min-h-36 overflow-auto bg-muted/20">
		<div
			class="relative grid min-h-full grid-cols-[7rem_minmax(0,1fr)]"
			style:min-width={`${widthPX + 112}px`}
		>
			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs font-medium backdrop-blur"
			>
				{m.video_studio_primary_sequence()}
			</div>
			<div class="relative h-20 border-b" style:width={`${widthPX}px`}>
				{#each derivedClips as item (item.clip_id)}
					{@const clip = project.primary_sequence[item.index]!}
					<div
						draggable="true"
						class={[
							'absolute top-2 h-14 min-w-12 overflow-hidden rounded-md border text-xs',
							selectedClipID === clip.id
								? 'border-primary bg-primary/15 text-foreground'
								: 'border-border bg-card hover:bg-muted'
						]}
						style:left={`${clipOffset(item.timeline_start_us)}px`}
						style:width={`${clipWidth(item.duration_us)}px`}
						style:background-image={thumbnailURLs[clip.source_id]
							? `linear-gradient(90deg, rgb(0 0 0 / 55%), rgb(0 0 0 / 20%)), url("${thumbnailURLs[clip.source_id]}")`
							: undefined}
						style:background-size="cover"
						style:background-position="center"
						ondragstart={(event) => {
							draggingClipID = clip.id;
							event.dataTransfer?.setData('text/plain', clip.id);
							if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
						}}
						ondragover={(event) => {
							event.preventDefault();
							if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
						}}
						ondrop={(event) => {
							event.preventDefault();
							const sourceID = event.dataTransfer?.getData('text/plain') || draggingClipID;
							if (sourceID && sourceID !== clip.id) onReorder(sourceID, item.index);
							draggingClipID = '';
						}}
						ondragend={() => (draggingClipID = '')}
					>
						<button
							type="button"
							class="flex size-full items-center px-3 text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-pressed={selectedClipID === clip.id}
							onclick={() => onSelectClip(clip.id)}
						>
							<span class="truncate"
								>{project.sources[clip.source_id]?.original_name ?? clip.id}</span
							>
						</button>
						<button
							type="button"
							class="absolute inset-y-0 left-0 z-10 w-3 cursor-ew-resize border-r border-primary/60 bg-primary/20 opacity-80 hover:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-label={m.video_studio_trim_start()}
							title={m.video_studio_trim_keyboard()}
							onpointerdown={(event) => beginTrim(event, clip.id, 'start')}
							onpointermove={continueTrim}
							onpointerup={endTrim}
							onpointercancel={endTrim}
							onkeydown={(event) => keyboardTrim(event, clip.id, 'start')}
						></button>
						<button
							type="button"
							class="absolute inset-y-0 right-0 z-10 w-3 cursor-ew-resize border-l border-primary/60 bg-primary/20 opacity-80 hover:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-label={m.video_studio_trim_end()}
							title={m.video_studio_trim_keyboard()}
							onpointerdown={(event) => beginTrim(event, clip.id, 'end')}
							onpointermove={continueTrim}
							onpointerup={endTrim}
							onpointercancel={endTrim}
							onkeydown={(event) => keyboardTrim(event, clip.id, 'end')}
						></button>
					</div>
				{/each}
				<div
					class="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary"
					style:left={`${clipOffset(playheadUS)}px`}
					aria-hidden="true"
				></div>
			</div>

			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
			>
				{m.video_studio_overlays_lane()}
			</div>
			<div class="relative h-12 border-b" style:width={`${widthPX}px`}>
				{#each project.visual_tracks.flatMap((track) => track.items) as item (item.id)}
					<button
						type="button"
						class={[
							'absolute top-2 h-7 truncate rounded border px-2 py-1 text-left text-[11px] text-violet-800 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none dark:text-violet-200',
							selectedVisualItemID === item.id
								? 'border-violet-600 bg-violet-500/25'
								: 'border-violet-500/30 bg-violet-500/10'
						]}
						style:left={`${clipOffset(item.timeline_start_us)}px`}
						style:width={`${Math.max(36, clipOffset(item.duration_us))}px`}
						aria-pressed={selectedVisualItemID === item.id}
						onclick={() => onSelectVisualItem(item.id)}
					>
						{item.type === 'text' ? item.text : item.type}
					</button>
				{/each}
			</div>

			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
			>
				{m.video_studio_audio_lane()}
			</div>
			<div class="relative h-12 border-b" style:width={`${widthPX}px`}>
				{#each project.audio_tracks.flatMap( (track) => track.items.map( (item) => ({ ...item, trackName: track.name }) ) ) as item (item.id)}
					<button
						type="button"
						class={[
							'absolute top-2 flex h-7 items-center overflow-hidden rounded border px-2 text-left text-[11px] text-emerald-800 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none dark:text-emerald-200',
							selectedAudioItemID === item.id
								? 'border-emerald-600 bg-emerald-500/25'
								: 'border-emerald-500/30 bg-emerald-500/10'
						]}
						style:left={`${clipOffset(item.timeline_start_us)}px`}
						style:width={`${Math.max(36, clipOffset(item.duration_us))}px`}
						aria-pressed={selectedAudioItemID === item.id}
						onclick={() => onSelectAudioItem(item.id)}
					>
						{#if waveformPeaks[item.source_id]?.length}
							<div
								class="pointer-events-none absolute inset-0 flex items-center gap-px px-1 opacity-45"
								aria-hidden="true"
							>
								{#each waveformPeaks[item.source_id]!.filter((_, index) => index % 18 === 0) as peak, index (`${item.id}:${index}`)}
									<span
										class="min-w-px flex-1 rounded-full bg-emerald-600"
										style:height={`${Math.max(8, peak * 90)}%`}
									></span>
								{/each}
							</div>
						{/if}
						<span class="truncate">{item.trackName}</span>
					</button>
				{/each}
			</div>

			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
			>
				{m.video_studio_captions_lane()}
			</div>
			<div class="relative h-14" style:width={`${widthPX}px`}>
				{#each project.caption_tracks.flatMap((track) => track.cues) as cue (cue.id)}
					<button
						type="button"
						class={[
							'absolute top-2 h-9 truncate rounded border px-2 py-1 text-left text-xs text-sky-800 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none dark:text-sky-200',
							selectedCaptionCueID === cue.id
								? 'border-sky-600 bg-sky-500/25'
								: 'border-sky-500/30 bg-sky-500/10'
						]}
						style:left={`${clipOffset(cue.start_us)}px`}
						style:width={`${Math.max(36, clipOffset(cue.end_us - cue.start_us))}px`}
						aria-pressed={selectedCaptionCueID === cue.id}
						onclick={() => onSelectCaptionCue(cue.id)}
					>
						{cue.text}
					</button>
				{/each}
			</div>
		</div>
	</div>
</section>
