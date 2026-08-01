<script lang="ts">
	import {
		derivePrimarySequence,
		isPrimarySequenceClip,
		projectDurationUS,
		type VideoProjectDocumentV1
	} from '@openpost/video-project';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { listProjectAssets, readProjectFile } from '../storage';
	import { onMount } from 'svelte';
	import MapPinIcon from 'lucide-svelte/icons/map-pin';
	import PlusIcon from 'lucide-svelte/icons/plus';
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
		onLeaveGap: () => void;
		onMove: (delta: number) => void;
		onReorder: (clipID: string, index: number) => void;
		onTrim: (clipID: string, edge: 'start' | 'end', deltaUS: number) => void;
		onVisualTiming: (itemID: string, startUS: number, durationUS: number) => void;
		onAudioTiming: (itemID: string, startUS: number, durationUS: number) => void;
		onCaptionTiming: (cueID: string, startUS: number, endUS: number) => void;
		onAddMarker: (timeUS: number) => string;
		onUpdateMarker: (markerID: string, values: { time_us?: number; label?: string }) => void;
		onDeleteMarker: (markerID: string) => void;
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
		onLeaveGap,
		onMove,
		onReorder,
		onTrim,
		onVisualTiming,
		onAudioTiming,
		onCaptionTiming,
		onAddMarker,
		onUpdateMarker,
		onDeleteMarker
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
	type TimingDrag = {
		kind: 'visual' | 'audio' | 'caption' | 'marker';
		id: string;
		edge: 'move' | 'start' | 'end';
		pointerStartX: number;
		originalStartUS: number;
		originalEndUS: number;
	};
	let timingDrag = $state<TimingDrag | null>(null);
	let selectedMarkerID = $state('');
	let snapGuideUS = $state<number | null>(null);
	let snapStatus = $state('');
	const selectedMarker = $derived(
		project.markers.find((marker) => marker.id === selectedMarkerID) ?? null
	);
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

	function frameUS(multiplier = 1): number {
		return (
			Math.max(
				1,
				Math.round((1_000_000 * project.timebase.fps_denominator) / project.timebase.fps_numerator)
			) * multiplier
		);
	}

	function snapCandidates(excludedID = ''): Array<{ timeUS: number; key: string }> {
		const candidates: Array<{ timeUS: number; key: string }> = [
			{ timeUS: 0, key: 'project:start' },
			{ timeUS: durationUS, key: 'project:end' },
			{ timeUS: playheadUS, key: 'playhead' }
		];
		for (const item of derivedClips) {
			candidates.push(
				{ timeUS: item.timeline_start_us, key: `primary:${item.clip_id}:start` },
				{ timeUS: item.timeline_end_us, key: `primary:${item.clip_id}:end` }
			);
		}
		for (const cue of project.caption_tracks.flatMap((track) => track.cues)) {
			candidates.push(
				{ timeUS: cue.start_us, key: `caption:${cue.id}:start` },
				{ timeUS: cue.end_us, key: `caption:${cue.id}:end` }
			);
		}
		for (const marker of project.markers) {
			candidates.push({ timeUS: marker.time_us, key: `marker:${marker.id}` });
		}
		return candidates.filter((candidate) => !candidate.key.startsWith(excludedID));
	}

	function snappedTime(
		valueUS: number,
		excludedID: string,
		disabled: boolean
	): { valueUS: number; snapped: boolean } {
		if (disabled) {
			snapGuideUS = null;
			snapStatus = '';
			return { valueUS, snapped: false };
		}
		const thresholdUS = Math.max(1, Math.round((8 / widthPX) * durationUS));
		let closest: { timeUS: number; distance: number } | null = null;
		for (const candidate of snapCandidates(excludedID)) {
			const distance = Math.abs(candidate.timeUS - valueUS);
			if (distance <= thresholdUS && (!closest || distance < closest.distance)) {
				closest = { timeUS: candidate.timeUS, distance };
			}
		}
		if (!closest) {
			snapGuideUS = null;
			snapStatus = '';
			return { valueUS, snapped: false };
		}
		snapGuideUS = closest.timeUS;
		snapStatus = m.video_studio_snapped_to({ time: timeLabel(closest.timeUS) });
		return { valueUS: closest.timeUS, snapped: true };
	}

	function beginTrim(event: PointerEvent, clipID: string, edge: 'start' | 'end'): void {
		event.preventDefault();
		event.stopPropagation();
		onSelectClip(clipID);
		trimming = { clipID, edge, lastClientX: event.clientX };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function continueTrim(event: PointerEvent): void {
		if (!trimming) return;
		const deltaPX = event.clientX - trimming.lastClientX;
		if (Math.abs(deltaPX) < 0.5) return;
		trimming.lastClientX = event.clientX;
		const derived = derivedClips.find((item) => item.clip_id === trimming?.clipID);
		if (!derived) return;
		const boundaryUS =
			trimming.edge === 'start' ? derived.timeline_start_us : derived.timeline_end_us;
		const proposedUS = boundaryUS + Math.round((deltaPX / widthPX) * durationUS);
		const result = snappedTime(proposedUS, `primary:${trimming.clipID}:`, event.altKey);
		onTrim(trimming.clipID, trimming.edge, result.valueUS - boundaryUS);
	}

	function endTrim(event: PointerEvent): void {
		if (!trimming) return;
		trimming = null;
		snapGuideUS = null;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
	}

	function keyboardTrim(event: KeyboardEvent, clipID: string, edge: 'start' | 'end'): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		event.stopPropagation();
		onSelectClip(clipID);
		onTrim(clipID, edge, (event.key === 'ArrowLeft' ? -1 : 1) * frameUS(event.shiftKey ? 10 : 1));
	}

	function beginTimingDrag(event: PointerEvent, drag: Omit<TimingDrag, 'pointerStartX'>): void {
		event.preventDefault();
		event.stopPropagation();
		timingDrag = { ...drag, pointerStartX: event.clientX };
		if (drag.kind === 'visual') onSelectVisualItem(drag.id);
		else if (drag.kind === 'audio') onSelectAudioItem(drag.id);
		else if (drag.kind === 'caption') onSelectCaptionCue(drag.id);
		else selectedMarkerID = drag.id;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function applyTiming(
		drag: Omit<TimingDrag, 'pointerStartX'>,
		startUS: number,
		endUS: number
	): void {
		const minimumDuration = drag.kind === 'marker' ? 0 : drag.kind === 'caption' ? 50_000 : 100_000;
		const boundedStart = Math.max(
			0,
			Math.min(Math.max(0, durationUS - minimumDuration), Math.round(startUS))
		);
		const boundedEnd = Math.max(
			boundedStart + minimumDuration,
			Math.min(durationUS, Math.round(endUS))
		);
		if (drag.kind === 'visual') {
			onVisualTiming(drag.id, boundedStart, Math.max(100_000, boundedEnd - boundedStart));
		} else if (drag.kind === 'audio') {
			onAudioTiming(drag.id, boundedStart, Math.max(100_000, boundedEnd - boundedStart));
		} else if (drag.kind === 'caption') {
			onCaptionTiming(drag.id, boundedStart, Math.max(boundedStart + 50_000, boundedEnd));
		} else {
			onUpdateMarker(drag.id, { time_us: boundedStart });
		}
	}

	function continueTimingDrag(event: PointerEvent): void {
		if (!timingDrag) return;
		const deltaUS = Math.round(((event.clientX - timingDrag.pointerStartX) / widthPX) * durationUS);
		const duration = timingDrag.originalEndUS - timingDrag.originalStartUS;
		const excludedID = `${timingDrag.kind}:${timingDrag.id}`;
		if (timingDrag.kind === 'marker') {
			const proposed = Math.max(0, Math.min(durationUS, timingDrag.originalStartUS + deltaUS));
			const result = snappedTime(proposed, excludedID, event.altKey);
			applyTiming(timingDrag, result.valueUS, result.valueUS);
			return;
		}
		if (timingDrag.edge === 'move') {
			let startUS = Math.max(
				0,
				Math.min(durationUS - duration, timingDrag.originalStartUS + deltaUS)
			);
			let endUS = startUS + duration;
			const startSnap = snappedTime(startUS, excludedID, event.altKey);
			if (startSnap.snapped) {
				startUS = startSnap.valueUS;
				endUS = startUS + duration;
			} else {
				const endSnap = snappedTime(endUS, excludedID, event.altKey);
				if (endSnap.snapped) {
					endUS = endSnap.valueUS;
					startUS = endUS - duration;
				}
			}
			applyTiming(timingDrag, startUS, endUS);
			return;
		}
		if (timingDrag.edge === 'start') {
			const proposed = Math.max(
				0,
				Math.min(timingDrag.originalEndUS - 50_000, timingDrag.originalStartUS + deltaUS)
			);
			const result = snappedTime(proposed, excludedID, event.altKey);
			applyTiming(timingDrag, result.valueUS, timingDrag.originalEndUS);
			return;
		}
		const proposed = Math.max(
			timingDrag.originalStartUS + 50_000,
			Math.min(durationUS, timingDrag.originalEndUS + deltaUS)
		);
		const result = snappedTime(proposed, excludedID, event.altKey);
		applyTiming(timingDrag, timingDrag.originalStartUS, result.valueUS);
	}

	function endTimingDrag(event: PointerEvent): void {
		if (!timingDrag) return;
		timingDrag = null;
		snapGuideUS = null;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function keyboardTiming(event: KeyboardEvent, drag: Omit<TimingDrag, 'pointerStartX'>): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		event.stopPropagation();
		const delta = (event.key === 'ArrowLeft' ? -1 : 1) * frameUS(event.shiftKey ? 10 : 1);
		const duration = drag.originalEndUS - drag.originalStartUS;
		if (drag.kind === 'marker') {
			applyTiming(drag, drag.originalStartUS + delta, drag.originalStartUS + delta);
			return;
		}
		if (drag.edge === 'move') {
			const start = Math.max(0, Math.min(durationUS - duration, drag.originalStartUS + delta));
			applyTiming(drag, start, start + duration);
		} else if (drag.edge === 'start') {
			applyTiming(
				drag,
				Math.min(drag.originalEndUS - 50_000, drag.originalStartUS + delta),
				drag.originalEndUS
			);
		} else {
			applyTiming(
				drag,
				drag.originalStartUS,
				Math.max(drag.originalStartUS + 50_000, drag.originalEndUS + delta)
			);
		}
	}

	function addMarker(): void {
		selectedMarkerID = onAddMarker(playheadUS);
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
			disabled={!selectedClipID ||
				project.primary_sequence.find((item) => item.id === selectedClipID)?.kind === 'gap'}
			onclick={onLeaveGap}
			title={`${m.video_studio_leave_gap()} (Delete)`}
		>
			<TrashIcon class="size-4" />
			<span class="hidden xl:inline">{m.video_studio_leave_gap()}</span>
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
		<Button variant="ghost" size="sm" onclick={addMarker} title={m.video_studio_add_marker()}>
			<PlusIcon class="size-4" />
			<MapPinIcon class="size-4" />
			<span class="hidden xl:inline">{m.video_studio_add_marker()}</span>
		</Button>
		{#if selectedMarker}
			<div class="flex min-w-44 flex-1 items-center gap-1 sm:max-w-64">
				<Input
					value={selectedMarker.label}
					aria-label={m.video_studio_rename_marker()}
					onchange={(event) =>
						onUpdateMarker(selectedMarker.id, { label: event.currentTarget.value })}
				/>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={m.video_studio_delete_marker()}
					onclick={() => {
						onDeleteMarker(selectedMarker.id);
						selectedMarkerID = '';
					}}
				>
					<TrashIcon class="size-4" />
				</Button>
			</div>
		{/if}
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
		<p class="sr-only" aria-live="polite">{snapStatus}</p>
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
						role="group"
						aria-label={isPrimarySequenceClip(clip)
							? (project.sources[clip.source_id]?.original_name ?? clip.id)
							: m.video_studio_gap()}
						draggable="true"
						class={[
							'absolute top-2 h-14 min-w-12 overflow-hidden rounded-md border text-xs',
							isPrimarySequenceClip(clip) ? '' : 'border-dashed bg-muted/50',
							selectedClipID === clip.id
								? 'border-primary bg-primary/15 text-foreground'
								: 'border-border bg-card hover:bg-muted'
						]}
						style:left={`${clipOffset(item.timeline_start_us)}px`}
						style:width={`${clipWidth(item.duration_us)}px`}
						style:background-image={isPrimarySequenceClip(clip) && thumbnailURLs[clip.source_id]
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
								>{isPrimarySequenceClip(clip)
									? (project.sources[clip.source_id]?.original_name ?? clip.id)
									: m.video_studio_gap()}</span
							>
						</button>
						{#if isPrimarySequenceClip(clip)}
							<button
								type="button"
								class="absolute inset-y-0 left-0 z-10 w-5 cursor-ew-resize border-r border-primary/60 bg-primary/20 opacity-80 hover:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
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
								class="absolute inset-y-0 right-0 z-10 w-5 cursor-ew-resize border-l border-primary/60 bg-primary/20 opacity-80 hover:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
								aria-label={m.video_studio_trim_end()}
								title={m.video_studio_trim_keyboard()}
								onpointerdown={(event) => beginTrim(event, clip.id, 'end')}
								onpointermove={continueTrim}
								onpointerup={endTrim}
								onpointercancel={endTrim}
								onkeydown={(event) => keyboardTrim(event, clip.id, 'end')}
							></button>
						{/if}
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
				{m.video_studio_markers_lane()}
			</div>
			<div class="relative h-10 border-b" style:width={`${widthPX}px`}>
				{#each project.markers as marker (marker.id)}
					<button
						type="button"
						class={[
							'absolute top-1 flex h-8 min-w-8 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-md border px-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
							selectedMarkerID === marker.id
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200'
						]}
						style:left={`${clipOffset(marker.time_us)}px`}
						style:border-color={marker.color}
						aria-label={`${marker.label}, ${timeLabel(marker.time_us)}`}
						aria-pressed={selectedMarkerID === marker.id}
						title={m.video_studio_marker_keyboard()}
						onclick={() => (selectedMarkerID = marker.id)}
						onpointerdown={(event) =>
							beginTimingDrag(event, {
								kind: 'marker',
								id: marker.id,
								edge: 'move',
								originalStartUS: marker.time_us,
								originalEndUS: marker.time_us
							})}
						onpointermove={continueTimingDrag}
						onpointerup={endTimingDrag}
						onpointercancel={endTimingDrag}
						onkeydown={(event) =>
							keyboardTiming(event, {
								kind: 'marker',
								id: marker.id,
								edge: 'move',
								originalStartUS: marker.time_us,
								originalEndUS: marker.time_us
							})}
					>
						<MapPinIcon class="size-4" />
						<span class="sr-only">{marker.label}</span>
					</button>
				{/each}
			</div>

			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
			>
				{m.video_studio_overlays_lane()}
			</div>
			<div class="relative h-12 border-b" style:width={`${widthPX}px`}>
				{#each project.visual_tracks.flatMap((track) => track.items) as item (item.id)}
					<div
						role="group"
						aria-label={item.type === 'text' ? item.text : item.type}
						class={[
							'absolute top-2 h-7 min-w-9 overflow-hidden rounded border text-[11px] text-violet-800 dark:text-violet-200',
							selectedVisualItemID === item.id
								? 'border-violet-600 bg-violet-500/25'
								: 'border-violet-500/30 bg-violet-500/10'
						]}
						style:left={`${clipOffset(item.timeline_start_us)}px`}
						style:width={`${Math.max(48, clipOffset(item.duration_us))}px`}
					>
						<button
							type="button"
							class="size-full cursor-grab truncate px-3 py-1 text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing"
							aria-pressed={selectedVisualItemID === item.id}
							title={m.video_studio_timing_keyboard()}
							onclick={() => onSelectVisualItem(item.id)}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'visual',
									id: item.id,
									edge: 'move',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'visual',
									id: item.id,
									edge: 'move',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
						>
							{item.type === 'text' ? item.text : item.type}
						</button>
						<button
							type="button"
							class="absolute inset-y-0 left-0 z-10 w-5 cursor-ew-resize border-r border-violet-600/60 bg-violet-500/20 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-label={m.video_studio_adjust_item_start()}
							title={m.video_studio_timing_keyboard()}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'visual',
									id: item.id,
									edge: 'start',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'visual',
									id: item.id,
									edge: 'start',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
						></button>
						<button
							type="button"
							class="absolute inset-y-0 right-0 z-10 w-5 cursor-ew-resize border-l border-violet-600/60 bg-violet-500/20 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-label={m.video_studio_adjust_item_end()}
							title={m.video_studio_timing_keyboard()}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'visual',
									id: item.id,
									edge: 'end',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'visual',
									id: item.id,
									edge: 'end',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
						></button>
					</div>
				{/each}
			</div>

			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
			>
				{m.video_studio_audio_lane()}
			</div>
			<div class="relative h-12 border-b" style:width={`${widthPX}px`}>
				{#each project.audio_tracks.flatMap( (track) => track.items.map( (item) => ({ ...item, trackName: track.name }) ) ) as item (item.id)}
					<div
						role="group"
						aria-label={item.trackName}
						class={[
							'absolute top-2 h-7 min-w-12 overflow-hidden rounded border text-[11px] text-emerald-800 dark:text-emerald-200',
							selectedAudioItemID === item.id
								? 'border-emerald-600 bg-emerald-500/25'
								: 'border-emerald-500/30 bg-emerald-500/10'
						]}
						style:left={`${clipOffset(item.timeline_start_us)}px`}
						style:width={`${Math.max(48, clipOffset(item.duration_us))}px`}
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
						<button
							type="button"
							class="relative z-[1] flex size-full cursor-grab items-center px-3 text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing"
							aria-pressed={selectedAudioItemID === item.id}
							title={m.video_studio_timing_keyboard()}
							onclick={() => onSelectAudioItem(item.id)}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'audio',
									id: item.id,
									edge: 'move',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'audio',
									id: item.id,
									edge: 'move',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
						>
							<span class="truncate">{item.trackName}</span>
						</button>
						<button
							type="button"
							class="absolute inset-y-0 left-0 z-10 w-5 cursor-ew-resize border-r border-emerald-600/60 bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-label={m.video_studio_adjust_item_start()}
							title={m.video_studio_timing_keyboard()}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'audio',
									id: item.id,
									edge: 'start',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'audio',
									id: item.id,
									edge: 'start',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
						></button>
						<button
							type="button"
							class="absolute inset-y-0 right-0 z-10 w-5 cursor-ew-resize border-l border-emerald-600/60 bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-label={m.video_studio_adjust_item_end()}
							title={m.video_studio_timing_keyboard()}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'audio',
									id: item.id,
									edge: 'end',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'audio',
									id: item.id,
									edge: 'end',
									originalStartUS: item.timeline_start_us,
									originalEndUS: item.timeline_start_us + item.duration_us
								})}
						></button>
					</div>
				{/each}
			</div>

			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
			>
				{m.video_studio_captions_lane()}
			</div>
			<div class="relative h-14" style:width={`${widthPX}px`}>
				{#each project.caption_tracks.flatMap((track) => track.cues) as cue (cue.id)}
					<div
						role="group"
						aria-label={cue.text}
						class={[
							'absolute top-2 h-9 min-w-12 overflow-hidden rounded border text-xs text-sky-800 dark:text-sky-200',
							selectedCaptionCueID === cue.id
								? 'border-sky-600 bg-sky-500/25'
								: 'border-sky-500/30 bg-sky-500/10'
						]}
						style:left={`${clipOffset(cue.start_us)}px`}
						style:width={`${Math.max(48, clipOffset(cue.end_us - cue.start_us))}px`}
					>
						<button
							type="button"
							class="size-full cursor-grab truncate px-3 py-1 text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing"
							aria-pressed={selectedCaptionCueID === cue.id}
							title={m.video_studio_timing_keyboard()}
							onclick={() => onSelectCaptionCue(cue.id)}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'caption',
									id: cue.id,
									edge: 'move',
									originalStartUS: cue.start_us,
									originalEndUS: cue.end_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'caption',
									id: cue.id,
									edge: 'move',
									originalStartUS: cue.start_us,
									originalEndUS: cue.end_us
								})}
						>
							{cue.text}
						</button>
						<button
							type="button"
							class="absolute inset-y-0 left-0 z-10 w-5 cursor-ew-resize border-r border-sky-600/60 bg-sky-500/20 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-label={m.video_studio_adjust_caption_start()}
							title={m.video_studio_timing_keyboard()}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'caption',
									id: cue.id,
									edge: 'start',
									originalStartUS: cue.start_us,
									originalEndUS: cue.end_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'caption',
									id: cue.id,
									edge: 'start',
									originalStartUS: cue.start_us,
									originalEndUS: cue.end_us
								})}
						></button>
						<button
							type="button"
							class="absolute inset-y-0 right-0 z-10 w-5 cursor-ew-resize border-l border-sky-600/60 bg-sky-500/20 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-label={m.video_studio_adjust_caption_end()}
							title={m.video_studio_timing_keyboard()}
							onpointerdown={(event) =>
								beginTimingDrag(event, {
									kind: 'caption',
									id: cue.id,
									edge: 'end',
									originalStartUS: cue.start_us,
									originalEndUS: cue.end_us
								})}
							onpointermove={continueTimingDrag}
							onpointerup={endTimingDrag}
							onpointercancel={endTimingDrag}
							onkeydown={(event) =>
								keyboardTiming(event, {
									kind: 'caption',
									id: cue.id,
									edge: 'end',
									originalStartUS: cue.start_us,
									originalEndUS: cue.end_us
								})}
						></button>
					</div>
				{/each}
			</div>
			{#if snapGuideUS !== null}
				<div
					class="pointer-events-none absolute inset-y-0 z-30 w-px bg-orange-500 shadow-[0_0_0_1px_rgb(249_115_22_/_0.18)]"
					style:left={`${112 + clipOffset(snapGuideUS)}px`}
					aria-hidden="true"
				></div>
			{/if}
		</div>
	</div>
</section>
