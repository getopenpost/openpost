<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import {
		buildTimelineDensityBuckets,
		timelineNavigatorMetrics,
		timelineNavigatorPan,
		timelineNavigatorResize
	} from '$lib/video-editor/timeline/timeline-viewport';

	let {
		timelineWidth,
		viewportWidth,
		scrollLeft,
		headerWidth,
		contentFrames,
		zoomLevel,
		items,
		onscroll,
		onzoom
	}: {
		timelineWidth: number;
		viewportWidth: number;
		scrollLeft: number;
		headerWidth: number;
		contentFrames: number;
		zoomLevel: number;
		items: readonly TimelineItem[];
		onscroll: (scrollLeft: number) => void;
		onzoom: (zoomLevel: number, scrollLeft: number) => void;
	} = $props();

	type DragTarget = 'thumb' | 'left' | 'right';
	interface DragSnapshot {
		target: DragTarget;
		pointerId: number;
		startX: number;
		startScrollLeft: number;
		startZoomLevel: number;
		thumbLeft: number;
		thumbWidth: number;
		thumbTravel: number;
		maxScrollLeft: number;
		trackWidth: number;
	}
	interface DragPreview {
		thumbLeft: number;
		thumbWidth: number;
		scrollLeft: number;
		zoomLevel?: number;
	}

	let trackNode: HTMLDivElement | null = $state(null);
	let trackWidth = $state(0);
	let dragTarget: DragTarget | null = $state(null);
	let dragSnapshot: DragSnapshot | null = null;
	let pendingPreview: DragPreview | null = null;
	let dragPreview: DragPreview | null = $state(null);
	let animationFrame: number | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let pointerMediaQuery: MediaQueryList | null = null;
	let pointerMediaListener: (() => void) | null = null;
	let coarsePointer = $state(false);

	const metrics = $derived(
		timelineNavigatorMetrics({
			timelineWidth,
			viewportWidth,
			trackWidth,
			scrollLeft,
			minThumbWidth: coarsePointer ? 88 : undefined
		})
	);
	const renderedThumbLeft = $derived(dragPreview?.thumbLeft ?? metrics.thumbLeft);
	const renderedThumbWidth = $derived(dragPreview?.thumbWidth ?? metrics.thumbWidth);
	const scrollPercent = $derived(
		metrics.maxScrollLeft > 0 ? Math.round((scrollLeft / metrics.maxScrollLeft) * 100) : 0
	);
	const overviewBuckets = $derived(buildTimelineDensityBuckets(items, 256));

	function bucketColor(item: TimelineItem): string {
		switch (item.type) {
			case 'audio':
				return 'bg-[oklch(0.62_0.11_145_/_0.5)]';
			case 'text':
			case 'subtitle':
				return 'bg-[oklch(0.7_0.12_85_/_0.52)]';
			case 'image':
			case 'shape':
				return 'bg-[oklch(0.65_0.12_300_/_0.5)]';
			default:
				return 'bg-[oklch(0.66_0.12_45_/_0.5)]';
		}
	}

	function flushPreview(): void {
		animationFrame = null;
		const preview = pendingPreview;
		pendingPreview = null;
		if (!preview) return;
		dragPreview = preview;
		if (preview.zoomLevel === undefined) onscroll(preview.scrollLeft);
		else onzoom(preview.zoomLevel, preview.scrollLeft);
	}

	function schedulePreview(preview: DragPreview): void {
		pendingPreview = preview;
		if (animationFrame === null) animationFrame = requestAnimationFrame(flushPreview);
	}

	function startDrag(event: PointerEvent, target: DragTarget): void {
		if (event.button !== 0 || trackWidth <= 0) return;
		event.preventDefault();
		event.stopPropagation();
		dragSnapshot = {
			target,
			pointerId: event.pointerId,
			startX: event.clientX,
			startScrollLeft: scrollLeft,
			startZoomLevel: zoomLevel,
			thumbLeft: metrics.thumbLeft,
			thumbWidth: metrics.thumbWidth,
			thumbTravel: metrics.thumbTravel,
			maxScrollLeft: metrics.maxScrollLeft,
			trackWidth
		};
		dragTarget = target;
		window.addEventListener('pointermove', moveDrag);
		window.addEventListener('pointerup', finishPointerDrag);
		window.addEventListener('pointercancel', cancelPointerDrag);
		window.addEventListener('keydown', onWindowKeydown);
	}

	function moveDrag(event: PointerEvent): void {
		const snapshot = dragSnapshot;
		if (!snapshot || event.pointerId !== snapshot.pointerId) return;
		const deltaX = event.clientX - snapshot.startX;
		if (snapshot.target === 'thumb') {
			const pan = timelineNavigatorPan({
				startThumbLeft: snapshot.thumbLeft,
				deltaX,
				thumbTravel: snapshot.thumbTravel,
				maxScrollLeft: snapshot.maxScrollLeft
			});
			schedulePreview({
				thumbLeft: pan.thumbLeft,
				thumbWidth: snapshot.thumbWidth,
				scrollLeft: pan.scrollLeft
			});
			return;
		}
		const resized = timelineNavigatorResize({
			handle: snapshot.target,
			deltaX,
			startThumbLeft: snapshot.thumbLeft,
			startThumbWidth: snapshot.thumbWidth,
			trackWidth: snapshot.trackWidth,
			viewportWidth,
			headerWidth,
			contentFrames,
			minThumbWidth: coarsePointer ? 88 : undefined
		});
		schedulePreview({
			thumbLeft: resized.thumbLeft,
			thumbWidth: resized.thumbWidth,
			scrollLeft: resized.scrollLeft,
			zoomLevel: resized.zoomLevel
		});
	}

	function stopDrag(cancelled: boolean): void {
		const snapshot = dragSnapshot;
		if (!snapshot) return;
		if (animationFrame !== null) {
			cancelAnimationFrame(animationFrame);
			animationFrame = null;
		}
		if (!cancelled) flushPreview();
		else if (snapshot.target === 'thumb') onscroll(snapshot.startScrollLeft);
		else onzoom(snapshot.startZoomLevel, snapshot.startScrollLeft);
		pendingPreview = null;
		dragPreview = null;
		dragSnapshot = null;
		dragTarget = null;
		window.removeEventListener('pointermove', moveDrag);
		window.removeEventListener('pointerup', finishPointerDrag);
		window.removeEventListener('pointercancel', cancelPointerDrag);
		window.removeEventListener('keydown', onWindowKeydown);
	}

	function finishPointerDrag(event: PointerEvent): void {
		if (event.pointerId === dragSnapshot?.pointerId) stopDrag(false);
	}

	function cancelPointerDrag(event: PointerEvent): void {
		if (event.pointerId === dragSnapshot?.pointerId) stopDrag(true);
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		stopDrag(true);
	}

	function clickTrack(event: MouseEvent): void {
		if (!trackNode || dragTarget || metrics.thumbTravel <= 0) return;
		const x = event.clientX - trackNode.getBoundingClientRect().left;
		const thumbLeft = Math.min(metrics.thumbTravel, Math.max(0, x - metrics.thumbWidth / 2));
		onscroll((thumbLeft / metrics.thumbTravel) * metrics.maxScrollLeft);
	}

	function onTrackKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault();
		onscroll(event.key === 'Home' ? 0 : metrics.maxScrollLeft);
	}

	function onThumbKeydown(event: KeyboardEvent): void {
		const step = event.shiftKey ? viewportWidth : Math.max(1, viewportWidth * 0.1);
		let next: number | null = null;
		if (event.key === 'ArrowLeft') next = scrollLeft - step;
		else if (event.key === 'ArrowRight') next = scrollLeft + step;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = metrics.maxScrollLeft;
		if (next === null) return;
		event.preventDefault();
		event.stopPropagation();
		onscroll(Math.min(metrics.maxScrollLeft, Math.max(0, next)));
	}

	function onHandleKeydown(event: KeyboardEvent, handle: 'left' | 'right'): void {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		event.stopPropagation();
		const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 20 : 5);
		const resized = timelineNavigatorResize({
			handle,
			deltaX: delta,
			startThumbLeft: metrics.thumbLeft,
			startThumbWidth: metrics.thumbWidth,
			trackWidth,
			viewportWidth,
			headerWidth,
			contentFrames,
			minThumbWidth: coarsePointer ? 88 : undefined
		});
		onzoom(resized.zoomLevel, resized.scrollLeft);
	}

	onMount(() => {
		if (!trackNode) return;
		trackWidth = trackNode.clientWidth;
		resizeObserver = new ResizeObserver(([entry]) => {
			if (entry) trackWidth = entry.contentRect.width;
		});
		resizeObserver.observe(trackNode);
		pointerMediaQuery = window.matchMedia('(pointer: coarse)');
		pointerMediaListener = () => (coarsePointer = pointerMediaQuery?.matches ?? false);
		pointerMediaListener();
		pointerMediaQuery.addEventListener('change', pointerMediaListener);
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		if (pointerMediaListener)
			pointerMediaQuery?.removeEventListener('change', pointerMediaListener);
		if (dragSnapshot) stopDrag(true);
		if (animationFrame !== null) cancelAnimationFrame(animationFrame);
	});
</script>

<div
	class="editor-protected-surface h-6 border-t border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] px-2 py-1 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:py-0"
	data-editor-protected="timeline-navigator"
	data-timeline-navigator
	role="group"
	aria-label={m.video_editor_timeline_navigator()}
>
	<div
		bind:this={trackNode}
		class="relative h-full overflow-hidden rounded-sm bg-[var(--video-editor-control)]"
		role="toolbar"
		tabindex="0"
		aria-label={m.video_editor_timeline_navigator()}
		aria-controls="video-editor-timeline-scroll"
		onclick={clickTrack}
		onkeydown={onTrackKeydown}
	>
		{#each overviewBuckets as bucket (bucket.index)}
			<span
				class="pointer-events-none absolute inset-y-0.5 min-w-px rounded-[1px] {bucketColor(
					bucket.items[0]!
				)}"
				style="left:{(bucket.from / Math.max(1, contentFrames)) *
					100}%;width:{(bucket.durationInFrames / Math.max(1, contentFrames)) * 100}%"
				aria-hidden="true"
			></span>
		{/each}
		<div
			class="absolute top-0 z-10 flex h-full touch-none items-center justify-between rounded-sm border border-[var(--video-editor-focus-border)] bg-[var(--video-editor-selection)] shadow-[0_0_0_1px_var(--video-editor-border)] {dragTarget
				? 'cursor-grabbing'
				: 'cursor-grab hover:bg-[var(--video-editor-control-hover)]'}"
			style="left:{renderedThumbLeft}px;width:{renderedThumbWidth}px"
			role="scrollbar"
			tabindex="0"
			aria-label={m.video_editor_timeline_navigator_view()}
			aria-orientation="horizontal"
			aria-controls="video-editor-timeline-scroll"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={scrollPercent}
			data-timeline-navigator-thumb
			onpointerdown={(event) => startDrag(event, 'thumb')}
			onkeydown={onThumbKeydown}
			onclick={(event) => event.stopPropagation()}
		>
			<button
				type="button"
				class="relative z-20 flex h-full w-3 shrink-0 cursor-ew-resize items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [@media(pointer:coarse)]:w-11"
				aria-label={m.video_editor_timeline_navigator_zoom_start()}
				onpointerdown={(event) => startDrag(event, 'left')}
				onkeydown={(event) => onHandleKeydown(event, 'left')}
				onclick={(event) => event.stopPropagation()}
			>
				<span class="size-1 rounded-full bg-[var(--video-editor-text)] opacity-85"></span>
			</button>
			<span
				class="h-0.5 w-8 max-w-[35%] rounded-full bg-[var(--video-editor-text)] opacity-30"
				aria-hidden="true"
			></span>
			<button
				type="button"
				class="relative z-20 flex h-full w-3 shrink-0 cursor-ew-resize items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [@media(pointer:coarse)]:w-11"
				aria-label={m.video_editor_timeline_navigator_zoom_end()}
				onpointerdown={(event) => startDrag(event, 'right')}
				onkeydown={(event) => onHandleKeydown(event, 'right')}
				onclick={(event) => event.stopPropagation()}
			>
				<span class="size-1 rounded-full bg-[var(--video-editor-text)] opacity-85"></span>
			</button>
		</div>
	</div>
</div>
