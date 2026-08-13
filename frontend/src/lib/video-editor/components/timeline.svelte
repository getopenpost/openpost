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
	import { subscribeToSourceArtifacts } from '../artifacts';
	import { layoutTimelineIntervals } from '../timeline-layout';
	import { onMount } from 'svelte';
	import FoldHorizontalIcon from '@lucide/svelte/icons/fold-horizontal';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import ImageIcon from '@lucide/svelte/icons/image';
	import MusicIcon from '@lucide/svelte/icons/music-2';
	import ShapesIcon from '@lucide/svelte/icons/shapes';
	import TypeIcon from '@lucide/svelte/icons/type';

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
	const rulerTicks = $derived.by(() => {
		const targetCount = Math.max(2, Math.min(80, Math.floor(widthPX / 96)));
		const rawIntervalUS = durationUS / targetCount;
		const niceIntervalsUS = [
			100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 15_000_000,
			30_000_000, 60_000_000, 120_000_000, 300_000_000, 600_000_000, 1_800_000_000, 3_600_000_000
		];
		const intervalUS =
			niceIntervalsUS.find((candidate) => candidate >= rawIntervalUS) ??
			Math.ceil(rawIntervalUS / 3_600_000_000) * 3_600_000_000;
		const ticks: Array<{ timeUS: number; left: number; label: string }> = [];
		for (let timeUS = 0; timeUS < durationUS; timeUS += intervalUS) {
			ticks.push({
				timeUS,
				left: (timeUS / durationUS) * widthPX,
				label: rulerTimeLabel(timeUS, intervalUS)
			});
		}
		if (ticks.at(-1)?.timeUS !== durationUS) {
			ticks.push({
				timeUS: durationUS,
				left: widthPX,
				label: rulerTimeLabel(durationUS, intervalUS)
			});
		}
		return ticks;
	});
	let draggingClipID = $state('');
	let seeking = $state(false);
	let trimming = $state<{
		clipID: string;
		edge: 'start' | 'end';
		lastClientX: number;
	} | null>(null);
	let pendingTrimPointer: { clientX: number; altKey: boolean } | null = null;
	let trimFrame = 0;
	type TimingDrag = {
		kind: 'visual' | 'audio' | 'caption' | 'marker';
		id: string;
		edge: 'move' | 'start' | 'end';
		pointerStartX: number;
		originalStartUS: number;
		originalEndUS: number;
	};
	let timingDrag = $state<TimingDrag | null>(null);
	let pendingTimingPointer: { clientX: number; altKey: boolean } | null = null;
	let timingFrame = 0;
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
		let artifactSignature = '';
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
		const unsubscribe = subscribeToSourceArtifacts((progress) => {
			if (progress.project_id !== projectID) return;
			const signature = `${progress.source_id}:${progress.artifact.thumbnail_complete}:${progress.artifact.waveform_complete}`;
			if (signature === artifactSignature) return;
			artifactSignature = signature;
			void refresh();
		});
		return () => {
			stopped = true;
			cancelAnimationFrame(trimFrame);
			cancelAnimationFrame(timingFrame);
			unsubscribe();
			for (const url of Object.values(thumbnailURLs)) URL.revokeObjectURL(url);
		};
	});

	function clipWidth(duration: number): number {
		return Math.max(48, (duration / durationUS) * widthPX);
	}

	function trimHandlesFit(duration: number): boolean {
		// Two 44 px touch targets need room for a usable clip-selection target in
		// the middle. Very short clips remain selectable; zooming the timeline
		// reveals their trim handles once there is enough room.
		return clipWidth(duration) >= 96;
	}

	function clipOffset(start: number): number {
		return (start / durationUS) * widthPX;
	}

	function intervalLayout(
		items: Array<{ id: string; start_us: number; duration_us: number }>,
		minimumWidthPX = 48
	) {
		return layoutTimelineIntervals(items, durationUS, widthPX, minimumWidthPX);
	}

	function visualLabel(item: VideoProjectDocumentV1['visual_tracks'][number]['items'][number]) {
		if (item.type === 'text') return item.text || m.video_editor_overlay_text();
		if (item.type === 'media' || item.type === 'camera') {
			return (
				project.sources[item.source_id]?.original_name ||
				(item.type === 'camera' ? m.video_editor_source_camera() : m.video_editor_source_image())
			);
		}
		if (!('shape' in item)) return m.video_editor_overlay_item();
		const labels = {
			rectangle: m.video_editor_shape_rectangle(),
			ellipse: m.video_editor_shape_ellipse(),
			arrow: m.video_editor_shape_arrow(),
			highlight: m.video_editor_shape_highlight(),
			'click-pulse': m.video_editor_shape_click_pulse(),
			redaction: m.video_editor_shape_redaction(),
			progress: m.video_editor_shape_progress()
		};
		return labels[item.shape.kind];
	}

	function audioLabel(item: VideoProjectDocumentV1['audio_tracks'][number]['items'][number]) {
		return project.sources[item.source_id]?.original_name || m.video_editor_audio_item();
	}

	function timeLabel(timestampUS: number): string {
		const seconds = Math.floor(timestampUS / 1_000_000);
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	function rulerTimeLabel(timestampUS: number, intervalUS: number): string {
		if (intervalUS < 1_000_000) {
			const precision = intervalUS < 250_000 ? 2 : 1;
			return `${(timestampUS / 1_000_000).toFixed(precision)}s`;
		}
		return timeLabel(timestampUS);
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
		snapStatus = m.video_editor_snapped_to({ time: timeLabel(closest.timeUS) });
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
		pendingTrimPointer = { clientX: event.clientX, altKey: event.altKey };
		if (!trimFrame) trimFrame = requestAnimationFrame(flushTrim);
	}

	function flushTrim(): void {
		trimFrame = 0;
		if (!trimming || !pendingTrimPointer) return;
		const pointer = pendingTrimPointer;
		pendingTrimPointer = null;
		const deltaPX = pointer.clientX - trimming.lastClientX;
		if (Math.abs(deltaPX) < 0.5) return;
		trimming.lastClientX = pointer.clientX;
		const derived = derivedClips.find((item) => item.clip_id === trimming?.clipID);
		if (!derived) return;
		const boundaryUS =
			trimming.edge === 'start' ? derived.timeline_start_us : derived.timeline_end_us;
		const proposedUS = boundaryUS + Math.round((deltaPX / widthPX) * durationUS);
		const result = snappedTime(proposedUS, `primary:${trimming.clipID}:`, pointer.altKey);
		onTrim(trimming.clipID, trimming.edge, result.valueUS - boundaryUS);
	}

	function endTrim(event: PointerEvent): void {
		if (!trimming) return;
		if (trimFrame) cancelAnimationFrame(trimFrame);
		flushTrim();
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
		pendingTimingPointer = { clientX: event.clientX, altKey: event.altKey };
		if (!timingFrame) timingFrame = requestAnimationFrame(flushTimingDrag);
	}

	function flushTimingDrag(): void {
		timingFrame = 0;
		if (!timingDrag || !pendingTimingPointer) return;
		const pointer = pendingTimingPointer;
		pendingTimingPointer = null;
		const deltaUS = Math.round(
			((pointer.clientX - timingDrag.pointerStartX) / widthPX) * durationUS
		);
		const duration = timingDrag.originalEndUS - timingDrag.originalStartUS;
		const excludedID = `${timingDrag.kind}:${timingDrag.id}`;
		if (timingDrag.kind === 'marker') {
			const proposed = Math.max(0, Math.min(durationUS, timingDrag.originalStartUS + deltaUS));
			const result = snappedTime(proposed, excludedID, pointer.altKey);
			applyTiming(timingDrag, result.valueUS, result.valueUS);
			return;
		}
		if (timingDrag.edge === 'move') {
			let startUS = Math.max(
				0,
				Math.min(durationUS - duration, timingDrag.originalStartUS + deltaUS)
			);
			let endUS = startUS + duration;
			const startSnap = snappedTime(startUS, excludedID, pointer.altKey);
			if (startSnap.snapped) {
				startUS = startSnap.valueUS;
				endUS = startUS + duration;
			} else {
				const endSnap = snappedTime(endUS, excludedID, pointer.altKey);
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
			const result = snappedTime(proposed, excludedID, pointer.altKey);
			applyTiming(timingDrag, result.valueUS, timingDrag.originalEndUS);
			return;
		}
		const proposed = Math.max(
			timingDrag.originalStartUS + 50_000,
			Math.min(durationUS, timingDrag.originalEndUS + deltaUS)
		);
		const result = snappedTime(proposed, excludedID, pointer.altKey);
		applyTiming(timingDrag, timingDrag.originalStartUS, result.valueUS);
	}

	function endTimingDrag(event: PointerEvent): void {
		if (!timingDrag) return;
		if (timingFrame) cancelAnimationFrame(timingFrame);
		flushTimingDrag();
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

	function seekFromPointer(event: PointerEvent): void {
		const ruler = event.currentTarget as HTMLElement;
		const bounds = ruler.getBoundingClientRect();
		const progress = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
		playheadUS = Math.round(progress * durationUS);
	}

	function beginSeek(event: PointerEvent): void {
		event.preventDefault();
		seeking = true;
		seekFromPointer(event);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function continueSeek(event: PointerEvent): void {
		if (seeking) seekFromPointer(event);
	}

	function endSeek(event: PointerEvent): void {
		if (!seeking) return;
		seekFromPointer(event);
		seeking = false;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function seekWithKeyboard(event: KeyboardEvent): void {
		const frame = frameUS(event.shiftKey ? 10 : 1);
		if (event.key === 'Home') playheadUS = 0;
		else if (event.key === 'End') playheadUS = durationUS;
		else if (event.key === 'ArrowLeft') playheadUS = Math.max(0, playheadUS - frame);
		else if (event.key === 'ArrowRight') playheadUS = Math.min(durationUS, playheadUS + frame);
		else return;
		event.preventDefault();
	}
</script>

<section
	class="flex h-full min-h-0 flex-col border-t bg-background"
	aria-labelledby="timeline-title"
>
	<div class="flex min-h-12 flex-nowrap items-center gap-1 overflow-x-auto border-b px-2 sm:px-3">
		<h2 id="timeline-title" class="mr-1 shrink-0 text-xs font-medium text-muted-foreground">
			{m.video_editor_timeline()}
		</h2>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={!selectedClipID}
			onclick={onSplit}
			aria-label={m.video_editor_split()}
			title={`${m.video_editor_split()} (S)`}
		>
			<ScissorsIcon class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={!selectedClipID || project.primary_sequence[0]?.id === selectedClipID}
			onclick={() => onMove(-1)}
			aria-label={m.video_editor_move_clip_left()}
			title={`${m.video_editor_move_clip_left()} (Alt+←)`}
		>
			<ChevronLeftIcon class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={!selectedClipID || project.primary_sequence.at(-1)?.id === selectedClipID}
			onclick={() => onMove(1)}
			aria-label={m.video_editor_move_clip_right()}
			title={`${m.video_editor_move_clip_right()} (Alt+→)`}
		>
			<ChevronRightIcon class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={!selectedClipID ||
				project.primary_sequence.find((item) => item.id === selectedClipID)?.kind === 'gap'}
			onclick={onLeaveGap}
			aria-label={m.video_editor_leave_gap()}
			title={`${m.video_editor_leave_gap()} (Delete)`}
		>
			<TrashIcon class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			disabled={!selectedClipID}
			onclick={onRippleDelete}
			aria-label={m.video_editor_ripple_delete()}
			title={`${m.video_editor_ripple_delete()} (Shift+Delete)`}
		>
			<FoldHorizontalIcon class="size-4" />
		</Button>
		<Button
			variant="ghost"
			size="icon-sm"
			onclick={addMarker}
			aria-label={m.video_editor_add_marker()}
			title={m.video_editor_add_marker()}
		>
			<MapPinIcon class="size-4" />
		</Button>
		{#if selectedMarker}
			<div class="flex min-w-44 flex-1 items-center gap-1 sm:max-w-64">
				<Input
					value={selectedMarker.label}
					aria-label={m.video_editor_rename_marker()}
					onchange={(event) =>
						onUpdateMarker(selectedMarker.id, { label: event.currentTarget.value })}
				/>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={m.video_editor_delete_marker()}
					onclick={() => {
						onDeleteMarker(selectedMarker.id);
						selectedMarkerID = '';
					}}
				>
					<TrashIcon class="size-4" />
				</Button>
			</div>
		{/if}
		<div class="ml-auto flex w-32 shrink-0 items-center gap-2 sm:w-40">
			<ZoomInIcon class="size-4 text-muted-foreground" />
			<Slider
				bind:value={zoom}
				min={0.5}
				max={4}
				step={0.1}
				ariaLabel={m.video_editor_zoom_timeline()}
			/>
		</div>
	</div>

	<div class="min-h-36 overflow-auto bg-muted/20">
		<p class="sr-only" aria-live="polite">{snapStatus}</p>
		<div
			class="relative grid min-h-full grid-cols-[7rem_minmax(0,1fr)]"
			style:min-width={`${widthPX + 112}px`}
		>
			<div
				class="sticky left-0 z-40 flex h-8 items-center border-r border-b bg-[#171719] px-2 font-mono text-[10px] text-zinc-400 tabular-nums"
			>
				<span class="text-orange-400">{timeLabel(playheadUS)}</span>
				<span class="mx-1 text-zinc-600">/</span>
				<span>{timeLabel(durationUS)}</span>
			</div>
			<button
				type="button"
				role="slider"
				class="relative h-8 cursor-ew-resize touch-none border-b bg-[#171719] text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-inset"
				style:width={`${widthPX}px`}
				aria-label={m.video_editor_timeline()}
				aria-valuemin={0}
				aria-valuemax={durationUS}
				aria-valuenow={playheadUS}
				aria-valuetext={timeLabel(playheadUS)}
				onpointerdown={beginSeek}
				onpointermove={continueSeek}
				onpointerup={endSeek}
				onpointercancel={endSeek}
				onkeydown={seekWithKeyboard}
			>
				{#each rulerTicks as tick (tick.timeUS)}
					<span
						class="pointer-events-none absolute inset-y-0 border-l border-white/10 font-mono text-[9px] text-zinc-500"
						style:left={`${tick.left}px`}
					>
						<span class="absolute top-1 left-1 whitespace-nowrap">{tick.label}</span>
					</span>
				{/each}
			</button>
			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs font-medium backdrop-blur"
			>
				{m.video_editor_primary_sequence()}
			</div>
			<div class="relative h-20 border-b" style:width={`${widthPX}px`}>
				{#each derivedClips as item (item.clip_id)}
					{@const clip = project.primary_sequence[item.index]!}
					<div
						role="group"
						aria-label={isPrimarySequenceClip(clip)
							? (project.sources[clip.source_id]?.original_name ?? clip.id)
							: m.video_editor_gap()}
						draggable="true"
						class={[
							'absolute top-2 h-14 min-w-12 overflow-hidden rounded-md border text-xs',
							isPrimarySequenceClip(clip) ? '' : 'border-dashed bg-muted/50',
							selectedClipID === clip.id
								? 'z-20 border-primary bg-primary/15 text-foreground'
								: 'z-0 border-border bg-card hover:bg-muted'
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
							data-video-editor-clip-select
							class="absolute inset-0 flex items-center px-3 text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
							aria-pressed={selectedClipID === clip.id}
							onclick={() => onSelectClip(clip.id)}
						>
							<span class="truncate"
								>{isPrimarySequenceClip(clip)
									? (project.sources[clip.source_id]?.original_name ?? clip.id)
									: m.video_editor_gap()}</span
							>
						</button>
						{#if isPrimarySequenceClip(clip) && trimHandlesFit(item.duration_us)}
							<button
								type="button"
								class="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none border-r border-primary/60 bg-primary/20 opacity-80 after:absolute after:-inset-x-[18px] after:inset-y-0 hover:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:after:hidden"
								aria-label={m.video_editor_trim_start()}
								title={m.video_editor_trim_keyboard()}
								onpointerdown={(event) => beginTrim(event, clip.id, 'start')}
								onpointermove={continueTrim}
								onpointerup={endTrim}
								onpointercancel={endTrim}
								onkeydown={(event) => keyboardTrim(event, clip.id, 'start')}
							></button>
							<button
								type="button"
								class="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none border-l border-primary/60 bg-primary/20 opacity-80 after:absolute after:-inset-x-[18px] after:inset-y-0 hover:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:after:hidden"
								aria-label={m.video_editor_trim_end()}
								title={m.video_editor_trim_keyboard()}
								onpointerdown={(event) => beginTrim(event, clip.id, 'end')}
								onpointermove={continueTrim}
								onpointerup={endTrim}
								onpointercancel={endTrim}
								onkeydown={(event) => keyboardTrim(event, clip.id, 'end')}
							></button>
						{/if}
					</div>
				{/each}
			</div>

			<div
				class="sticky left-0 z-20 border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
			>
				{m.video_editor_markers_lane()}
			</div>
			<div class="relative h-10 border-b" style:width={`${widthPX}px`}>
				{#each project.markers as marker (marker.id)}
					<button
						type="button"
						class={[
							'absolute top-1 flex h-8 min-w-11 -translate-x-1/2 cursor-ew-resize touch-none items-center justify-center rounded-md border px-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:min-w-8',
							selectedMarkerID === marker.id
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200'
						]}
						style:left={`${clipOffset(marker.time_us)}px`}
						style:border-color={marker.color}
						aria-label={`${marker.label}, ${timeLabel(marker.time_us)}`}
						aria-pressed={selectedMarkerID === marker.id}
						title={m.video_editor_marker_keyboard()}
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

			{#each project.visual_tracks as track (track.id)}
				{@const visualLayout = intervalLayout(
					track.items.map((item) => ({
						id: item.id,
						start_us: item.timeline_start_us,
						duration_us: item.duration_us
					}))
				)}
				<div
					class="sticky left-0 z-20 truncate border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
					title={track.name || m.video_editor_overlays_lane()}
					data-video-editor-track-kind="visual"
					data-video-editor-track-id={track.id}
				>
					{track.name || m.video_editor_overlays_lane()}
				</div>
				<div
					class="relative border-b"
					style:width={`${widthPX}px`}
					style:height={`${visualLayout.lane_count * 36 + 8}px`}
				>
					{#each track.items as item (item.id)}
						{@const placement = visualLayout.placements.get(item.id)!}
						{@const label = visualLabel(item)}
						<div
							role="group"
							aria-label={label}
							class={[
								'absolute h-7 min-w-12 overflow-hidden rounded border text-[11px]',
								item.type === 'text'
									? selectedVisualItemID === item.id
										? 'border-amber-500 bg-amber-500/25 text-amber-900 dark:text-amber-100'
										: 'border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200'
									: item.type === 'media' || item.type === 'camera'
										? selectedVisualItemID === item.id
											? 'border-indigo-500 bg-indigo-500/25 text-indigo-900 dark:text-indigo-100'
											: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-900 dark:text-indigo-200'
										: selectedVisualItemID === item.id
											? 'border-violet-500 bg-violet-500/25 text-violet-900 dark:text-violet-100'
											: 'border-violet-500/35 bg-violet-500/10 text-violet-900 dark:text-violet-200'
							]}
							style:left={`${placement.left_px}px`}
							style:top={`${placement.lane * 36 + 4}px`}
							style:width={`${placement.width_px}px`}
						>
							<button
								type="button"
								class="flex size-full cursor-grab touch-none items-center gap-1.5 px-3 py-1 text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing"
								aria-pressed={selectedVisualItemID === item.id}
								aria-label={label}
								title={`${label} · ${m.video_editor_timing_keyboard()}`}
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
								{#if item.type === 'text'}
									<TypeIcon class="size-3.5 shrink-0" />
								{:else if item.type === 'media' || item.type === 'camera'}
									<ImageIcon class="size-3.5 shrink-0" />
								{:else}
									<ShapesIcon class="size-3.5 shrink-0" />
								{/if}
								<span class="truncate">{label}</span>
							</button>
							<button
								type="button"
								class="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none border-r border-violet-600/60 bg-violet-500/20 after:absolute after:-inset-x-[18px] after:inset-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:after:hidden"
								aria-label={m.video_editor_adjust_item_start()}
								title={m.video_editor_timing_keyboard()}
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
								class="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none border-l border-violet-600/60 bg-violet-500/20 after:absolute after:-inset-x-[18px] after:inset-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:after:hidden"
								aria-label={m.video_editor_adjust_item_end()}
								title={m.video_editor_timing_keyboard()}
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
			{/each}

			{#each project.audio_tracks as track (track.id)}
				{@const audioLayout = intervalLayout(
					track.items.map((item) => ({
						id: item.id,
						start_us: item.timeline_start_us,
						duration_us: item.duration_us
					}))
				)}
				<div
					class="sticky left-0 z-20 truncate border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
					title={track.name || m.video_editor_audio_lane()}
					data-video-editor-track-kind="audio"
					data-video-editor-track-id={track.id}
				>
					{track.name || m.video_editor_audio_lane()}
				</div>
				<div
					class="relative border-b"
					style:width={`${widthPX}px`}
					style:height={`${audioLayout.lane_count * 36 + 8}px`}
				>
					{#each track.items as item (item.id)}
						{@const placement = audioLayout.placements.get(item.id)!}
						{@const label = audioLabel(item)}
						<div
							role="group"
							aria-label={label}
							class={[
								'absolute top-2 h-7 min-w-12 overflow-hidden rounded border text-[11px] text-emerald-800 dark:text-emerald-200',
								selectedAudioItemID === item.id
									? 'border-emerald-600 bg-emerald-500/25'
									: 'border-emerald-500/30 bg-emerald-500/10'
							]}
							style:left={`${placement.left_px}px`}
							style:top={`${placement.lane * 36 + 4}px`}
							style:width={`${placement.width_px}px`}
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
								class="relative z-[1] flex size-full cursor-grab touch-none items-center gap-1.5 px-3 text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing"
								aria-pressed={selectedAudioItemID === item.id}
								aria-label={label}
								title={`${label} · ${m.video_editor_timing_keyboard()}`}
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
								<MusicIcon class="size-3.5 shrink-0" />
								<span class="truncate">{label}</span>
							</button>
							<button
								type="button"
								class="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none border-r border-emerald-600/60 bg-emerald-500/20 after:absolute after:-inset-x-[18px] after:inset-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:after:hidden"
								aria-label={m.video_editor_adjust_item_start()}
								title={m.video_editor_timing_keyboard()}
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
								class="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none border-l border-emerald-600/60 bg-emerald-500/20 after:absolute after:-inset-x-[18px] after:inset-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:after:hidden"
								aria-label={m.video_editor_adjust_item_end()}
								title={m.video_editor_timing_keyboard()}
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
			{/each}

			{#each project.caption_tracks as track (track.id)}
				{@const captionLayout = intervalLayout(
					track.cues.map((cue) => ({
						id: cue.id,
						start_us: cue.start_us,
						duration_us: cue.end_us - cue.start_us
					}))
				)}
				<div
					class="sticky left-0 z-20 truncate border-r bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur"
					title={track.name || m.video_editor_captions_lane()}
					data-video-editor-track-kind="caption"
					data-video-editor-track-id={track.id}
				>
					{track.name || m.video_editor_captions_lane()}
				</div>
				<div
					class="relative border-b"
					style:width={`${widthPX}px`}
					style:height={`${captionLayout.lane_count * 44 + 8}px`}
				>
					{#each track.cues as cue (cue.id)}
						{@const placement = captionLayout.placements.get(cue.id)!}
						<div
							role="group"
							aria-label={cue.text}
							class={[
								'absolute top-2 h-9 min-w-12 overflow-hidden rounded border text-xs text-sky-800 dark:text-sky-200',
								selectedCaptionCueID === cue.id
									? 'border-sky-600 bg-sky-500/25'
									: 'border-sky-500/30 bg-sky-500/10'
							]}
							style:left={`${placement.left_px}px`}
							style:top={`${placement.lane * 44 + 4}px`}
							style:width={`${placement.width_px}px`}
						>
							<button
								type="button"
								class="flex size-full cursor-grab touch-none items-center gap-1.5 px-3 py-1 text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:cursor-grabbing"
								aria-pressed={selectedCaptionCueID === cue.id}
								title={m.video_editor_timing_keyboard()}
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
								<CaptionsIcon class="size-3.5 shrink-0" />
								<span class="truncate">{cue.text}</span>
							</button>
							<button
								type="button"
								class="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize touch-none border-r border-sky-600/60 bg-sky-500/20 after:absolute after:-inset-x-[18px] after:inset-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:after:hidden"
								aria-label={m.video_editor_adjust_caption_start()}
								title={m.video_editor_timing_keyboard()}
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
								class="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize touch-none border-l border-sky-600/60 bg-sky-500/20 after:absolute after:-inset-x-[18px] after:inset-y-0 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:after:hidden"
								aria-label={m.video_editor_adjust_caption_end()}
								title={m.video_editor_timing_keyboard()}
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
			{/each}
			<div
				class="pointer-events-none absolute top-8 bottom-0 z-40 w-px bg-orange-500"
				style:left={`${112 + clipOffset(playheadUS)}px`}
				aria-hidden="true"
			>
				<span
					class="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-orange-500"
				></span>
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
