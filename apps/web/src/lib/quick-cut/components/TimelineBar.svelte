<script lang="ts">
	import type { QuickCutSegment, QuickCutSource, QuickCutMarker } from '../types';
	import { m } from '$lib/paraglide/messages';
	import QuickCutWaveform from './QuickCutWaveform.svelte';
	import {
		panTimelineViewport,
		revealTimelineTime,
		timelineTimeAtFraction,
		visibleTimelineDuration,
		zoomTimelineViewport,
		type TimelineViewport
	} from '../timeline-viewport';

	let {
		activeSource,
		segments,
		currentTime,
		selectedId,
		inPoint,
		outPoint,
		markers = [],
		reviewRanges = [],
		viewport,
		onViewportChange,
		onSeek,
		onSelect
	}: {
		activeSource: QuickCutSource | null;
		segments: QuickCutSegment[];
		currentTime: number;
		selectedId: string | null;
		inPoint: { sourceId: string; time: number } | null;
		outPoint: { sourceId: string; time: number } | null;
		markers?: QuickCutMarker[];
		reviewRanges?: Array<{ start: number; end: number }>;
		viewport: TimelineViewport;
		onViewportChange: (viewport: TimelineViewport) => void;
		onSeek: (t: number) => void;
		onSelect: (id: string) => void;
	} = $props();

	const duration = $derived(activeSource?.duration ?? 0);
	const visibleDuration = $derived(visibleTimelineDuration(duration, viewport.zoom));
	const viewEnd = $derived(Math.min(duration, viewport.start + visibleDuration));
	const visibleKeyframes = $derived(
		(activeSource?.keyframeTimestamps ?? []).filter(
			(time) => time >= viewport.start && time <= viewEnd
		)
	);

	$effect(() => {
		if (viewport.zoom <= 1) return;
		const nextViewport = revealTimelineTime(viewport, duration, currentTime);
		if (nextViewport.start !== viewport.start || nextViewport.zoom !== viewport.zoom) {
			onViewportChange(nextViewport);
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
			onViewportChange(zoomTimelineViewport(viewport, duration, nextZoom, pointerFraction(event)));
			return;
		}
		const width = event.currentTarget instanceof HTMLElement ? event.currentTarget.clientWidth : 0;
		onViewportChange(panTimelineViewport(viewport, duration, event.deltaX + event.deltaY, width));
	}
</script>

<div class="min-w-0 space-y-1.5">
	{#if activeSource}
		<div
			class="relative h-24 w-full overflow-hidden rounded border bg-background"
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
				onkeydown={(event) => {
					if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
						event.preventDefault();
						onSeek(
							Math.max(
								0,
								Math.min(
									duration,
									currentTime + (event.key === 'ArrowLeft' ? -1 : 1) / (activeSource?.fps || 30)
								)
							)
						);
					} else if (event.key === 'Home') {
						event.preventDefault();
						onSeek(0);
					} else if (event.key === 'End') {
						event.preventDefault();
						onSeek(duration);
					}
				}}
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
					class="absolute top-0 z-20 h-4 rounded-sm border text-left transition {selectedId ===
					seg.id
						? 'border-primary bg-primary/20 shadow'
						: 'border-primary/30 bg-primary/10 hover:bg-primary/15'}"
					style={`left:${pct(seg.start)}%; width:${Math.max(1, pct(seg.end) - pct(seg.start))}%`}
					aria-label={`${m.quick_cut_segment()} ${seg.start.toFixed(1)}-${seg.end.toFixed(1)}`}
					onclick={() => onSelect(seg.id)}
				></button>
			{/each}

			{#each reviewRanges as range, index (index)}
				<div
					class="pointer-events-none absolute inset-y-0 z-[15] border-x border-destructive bg-destructive/20"
					style={`left:${pct(range.start)}%;width:${pct(range.end) - pct(range.start)}%`}
				></div>
			{/each}
			{#each markers.filter((marker) => marker.sourceId === activeSource.id && marker.time >= viewport.start && marker.time <= viewEnd) as marker (marker.id)}
				<button
					type="button"
					class="absolute top-5 z-20 h-5 w-3 -translate-x-1/2 rounded-sm text-warning-foreground before:absolute before:inset-y-0 before:left-1/2 before:w-1 before:-translate-x-1/2 before:bg-warning focus-visible:outline-2 focus-visible:outline-primary [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
					style={`left:${pct(marker.time)}%`}
					aria-label={marker.name}
					title={marker.name}
					onclick={() => onSeek(marker.time)}
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
