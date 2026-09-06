<script lang="ts">
	import type { QuickCutSegment, QuickCutSource } from '../types';
	import { m } from '$lib/paraglide/messages';
	import QuickCutWaveform from './QuickCutWaveform.svelte';
	import {
		clampTimelineViewport,
		panTimelineViewport,
		revealTimelineTime,
		timelineTimeAtFraction,
		visibleTimelineDuration,
		zoomTimelineViewport
	} from '../timeline-viewport';

	let {
		activeSource,
		segments,
		currentTime,
		selectedId,
		inPoint,
		outPoint,
		onSeek,
		onSelect
	}: {
		activeSource: QuickCutSource | null;
		segments: QuickCutSegment[];
		currentTime: number;
		selectedId: string | null;
		inPoint: { sourceId: string; time: number } | null;
		outPoint: { sourceId: string; time: number } | null;
		onSeek: (t: number) => void;
		onSelect: (id: string) => void;
	} = $props();

	const duration = $derived(activeSource?.duration ?? 0);
	let viewport = $state({ start: 0, zoom: 1 });
	const visibleDuration = $derived(visibleTimelineDuration(duration, viewport.zoom));
	const viewEnd = $derived(Math.min(duration, viewport.start + visibleDuration));
	const zoomPercent = $derived(Math.round(viewport.zoom * 100));
	const visibleKeyframes = $derived(
		(activeSource?.keyframeTimestamps ?? []).filter(
			(time) => time >= viewport.start && time <= viewEnd
		)
	);

	$effect(() => {
		resetViewport(activeSource?.id);
	});

	function resetViewport(_sourceId: string | undefined): void {
		viewport = { start: 0, zoom: 1 };
	}

	$effect(() => {
		if (viewport.zoom <= 1) return;
		const nextViewport = revealTimelineTime(viewport, duration, currentTime);
		if (nextViewport.start !== viewport.start || nextViewport.zoom !== viewport.zoom) {
			viewport = nextViewport;
		}
	});

	function pct(t: number): number {
		if (visibleDuration <= 0) return 0;
		return Math.max(0, Math.min(100, ((t - viewport.start) / visibleDuration) * 100));
	}

	const visibleSegments = $derived(
		segments.filter(
			(segment) =>
				segment.sourceId === activeSource?.id &&
				segment.end >= viewport.start &&
				segment.start <= viewEnd
		)
	);

	function pointerFraction(event: PointerEvent | WheelEvent): number {
		if (!(event.currentTarget instanceof HTMLElement)) return 0;
		const rect = event.currentTarget.getBoundingClientRect();
		return rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
	}

	function seekFromPointer(event: PointerEvent): void {
		onSeek(timelineTimeAtFraction(viewport, duration, pointerFraction(event)));
	}

	function pointerDown(event: PointerEvent): void {
		if (!(event.currentTarget instanceof HTMLElement) || event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		seekFromPointer(event);
	}

	function pointerMove(event: PointerEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
		event.preventDefault();
		seekFromPointer(event);
	}

	function pointerUp(event: PointerEvent): void {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	function wheel(event: WheelEvent): void {
		event.preventDefault();
		if (event.ctrlKey || event.metaKey) {
			const nextZoom = viewport.zoom * Math.exp(-event.deltaY * 0.002);
			viewport = zoomTimelineViewport(viewport, duration, nextZoom, pointerFraction(event));
			return;
		}
		const width = event.currentTarget instanceof HTMLElement ? event.currentTarget.clientWidth : 0;
		viewport = panTimelineViewport(viewport, duration, event.deltaX + event.deltaY, width);
	}

	function zoomBy(multiplier: number): void {
		viewport = zoomTimelineViewport(viewport, duration, viewport.zoom * multiplier, 0.5);
	}
</script>

<div class="min-w-0 space-y-2">
	{#if activeSource}
		<div class="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
			<span class="min-w-0 truncate"
				>{m.quick_cut_source_label({ index: 1 })} · {activeSource.name} · {activeSource.width}×{activeSource.height}</span
			>
			<div class="flex shrink-0 items-center gap-1">
				<button
					type="button"
					class="flex size-7 items-center justify-center rounded border hover:bg-accent disabled:opacity-40"
					aria-label={m.quick_cut_zoom_out()}
					disabled={viewport.zoom <= 1}
					onclick={() => zoomBy(0.5)}>−</button
				>
				<button
					type="button"
					class="min-h-7 rounded px-1.5 font-mono tabular-nums hover:bg-accent"
					aria-label={m.quick_cut_zoom_reset()}
					onclick={() => (viewport = clampTimelineViewport({ start: 0, zoom: 1 }, duration))}
					>{zoomPercent}%</button
				>
				<button
					type="button"
					class="flex size-7 items-center justify-center rounded border hover:bg-accent disabled:opacity-40"
					aria-label={m.quick_cut_zoom_in()}
					disabled={viewport.zoom >= 32}
					onclick={() => zoomBy(2)}>+</button
				>
				<span class="ml-1 font-mono tabular-nums">{activeSource.duration.toFixed(1)}s</span>
			</div>
		</div>
		<div
			class="relative h-14 w-full overflow-hidden rounded-xl border bg-card shadow-inner"
			role="group"
			aria-label={m.quick_cut_timeline_label()}
			onwheel={wheel}
		>
			<QuickCutWaveform
				source={activeSource}
				viewStartSeconds={viewport.start}
				viewEndSeconds={viewEnd}
			/>
			<button
				type="button"
				class="absolute inset-0 z-10 cursor-ew-resize touch-none"
				aria-label={m.quick_cut_seek_timeline()}
				onpointerdown={pointerDown}
				onpointermove={pointerMove}
				onpointerup={pointerUp}
				onpointercancel={pointerUp}
			></button>

			{#if visibleKeyframes.length <= 200}
				{#each visibleKeyframes as keyframe (keyframe)}
					<div
						class="pointer-events-none absolute top-0 bottom-0 z-[5] w-px bg-muted-foreground/25"
						style={`left:${pct(keyframe)}%`}
					></div>
				{/each}
			{/if}

			{#each visibleSegments as seg (seg.id)}
				<button
					type="button"
					class="absolute top-2 bottom-2 z-20 rounded-md border text-left transition {selectedId ===
					seg.id
						? 'border-primary bg-primary/20 shadow'
						: 'border-primary/30 bg-primary/10 hover:bg-primary/15'}"
					style={`left:${pct(seg.start)}%; width:${Math.max(1, pct(seg.end) - pct(seg.start))}%`}
					aria-label={`${m.quick_cut_segment()} ${seg.start.toFixed(1)}-${seg.end.toFixed(1)}`}
					onclick={() => onSelect(seg.id)}
				></button>
			{/each}

			{#if inPoint && inPoint.sourceId === activeSource.id}
				<div
					class="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-amber-500"
					style={`left:${pct(inPoint.time)}%`}
				></div>
			{/if}
			{#if outPoint && outPoint.sourceId === activeSource.id}
				<div
					class="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-emerald-500"
					style={`left:${pct(outPoint.time)}%`}
				></div>
			{/if}

			<div
				class="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-foreground shadow"
				style={`left:${pct(currentTime)}%`}
			>
				<div
					class="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-foreground"
				></div>
			</div>
		</div>
		<div class="flex justify-between font-mono text-xs text-muted-foreground tabular-nums">
			<span
				>{Math.floor(viewport.start / 60)}:{(viewport.start % 60).toFixed(1).padStart(4, '0')}</span
			>
			<span>{Math.floor(viewEnd / 60)}:{(viewEnd % 60).toFixed(1).padStart(4, '0')}</span>
		</div>
	{:else}
		<p class="text-sm text-muted-foreground">{m.quick_cut_no_segments()}</p>
	{/if}
</div>
