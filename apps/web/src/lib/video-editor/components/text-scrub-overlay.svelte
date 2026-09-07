<script lang="ts">
	/**
	 * Text-only scrub overlay, ported from FreeCut (MIT)
	 * `features/preview/components/dom-text-scrub-overlay.tsx`.
	 *
	 * While scrubbing (paused with a preview frame), text/subtitle timelines
	 * should not force full media seeks. This overlay paints only the visible
	 * text items through the shared canvas raster, coalesced to one paint per
	 * animation frame, above the media layers without intercepting pointer.
	 */
	import { renderSubtitleRaster, renderTextItemRaster } from '$lib/video-editor/media/text-raster';
	import { visibleScrubTextItems } from '$lib/video-editor/preview/text-scrub-items';
	import { resolveAnimatedItemAt } from '$lib/video-editor/timeline/animated-properties';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	interface Props {
		visible: boolean;
		frame: number;
		width: number;
		height: number;
		fps: number;
	}

	let { visible, frame, width, height, fps }: Props = $props();

	let canvas: HTMLCanvasElement | null = $state(null);
	let pendingFrame: number | null = $state(null);
	let rafId: number | null = null;
	let lastPaintedFrame: number | null = null;
	let lastPaintedSize = '';

	function paint(targetFrame: number, target: HTMLCanvasElement): void {
		const safeWidth = Math.max(1, Math.round(width));
		const safeHeight = Math.max(1, Math.round(height));
		if (target.width !== safeWidth) target.width = safeWidth;
		if (target.height !== safeHeight) target.height = safeHeight;
		const context = target.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, safeWidth, safeHeight);
		const items = visibleScrubTextItems(timelineStore.items, targetFrame);
		if (items.length === 0) return;
		// renderTextItemRaster clears its context, so each item paints offscreen
		// first and composites onto the overlay canvas.
		const scratch = document.createElement('canvas');
		scratch.width = safeWidth;
		scratch.height = safeHeight;
		const scratchContext = scratch.getContext('2d');
		if (!scratchContext) return;
		for (const item of items) {
			const resolved = resolveAnimatedItemAt(item, targetFrame, {
				fps,
				frameWidth: safeWidth,
				frameHeight: safeHeight,
				items: timelineStore.items
			});
			if (resolved.type === 'text') {
				renderTextItemRaster(scratchContext, resolved, safeWidth, safeHeight, {
					absoluteFrame: targetFrame
				});
			} else {
				renderSubtitleRaster(scratchContext, resolved.text ?? '', resolved, safeWidth, safeHeight);
			}
			context.drawImage(scratch, 0, 0);
		}
	}

	function flush(): void {
		rafId = null;
		const next = pendingFrame;
		pendingFrame = null;
		const target = canvas;
		if (next === null || target === null) return;
		const sizeKey = `${Math.round(width)}x${Math.round(height)}`;
		if (next === lastPaintedFrame && sizeKey === lastPaintedSize) return;
		lastPaintedFrame = next;
		lastPaintedSize = sizeKey;
		paint(next, target);
	}

	function queuePaint(nextFrame: number): void {
		pendingFrame = Math.max(0, Math.round(nextFrame));
		if (rafId === null) rafId = requestAnimationFrame(flush);
	}

	$effect(() => {
		if (!visible) {
			lastPaintedFrame = null;
			return;
		}
		if (canvas) queuePaint(frame);
	});

	$effect(() => {
		return () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			pendingFrame = null;
		};
	});
</script>

<canvas
	bind:this={canvas}
	aria-hidden="true"
	data-text-scrub-overlay
	class="pointer-events-none absolute inset-0 size-full"
	style="z-index: 6; contain: layout paint style;"
></canvas>
