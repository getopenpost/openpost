<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { scaleRatioFromEdge } from '$lib/video-editor/timeline/keyframe-scale-retime';

	let {
		minFrame,
		maxFrame,
		itemFrom,
		pixelsPerFrame,
		timelineX,
		disabled = false,
		onscalechange,
		onscaleend,
		onscalecancel
	}: {
		minFrame: number;
		maxFrame: number;
		itemFrom: number;
		pixelsPerFrame: number;
		timelineX: (absoluteFrame: number) => number;
		disabled?: boolean;
		onscalechange: (preview: { anchorFrame: number; requestedScale: number }) => void;
		onscaleend: (committed: {
			anchorFrame: number;
			requestedScale: number;
			duplicate: boolean;
		}) => void;
		onscalecancel: () => void;
	} = $props();

	type ScaleDrag = {
		pointerId: number;
		edge: 'start' | 'end';
		startX: number;
		duplicate: boolean;
		anchorFrame: number;
		farFrame: number;
		started: boolean;
	};

	let drag = $state<ScaleDrag | null>(null);

	const leftPx = $derived(timelineX(itemFrom + minFrame));
	const rightPx = $derived(timelineX(itemFrom + maxFrame));

	function startScale(edge: 'start' | 'end', event: PointerEvent): void {
		if (event.button !== 0 || disabled) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.currentTarget instanceof Element) {
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// Synthetic pointer sequences may not own capture.
			}
		}
		drag = {
			pointerId: event.pointerId,
			edge,
			startX: event.clientX,
			duplicate: event.altKey,
			anchorFrame: edge === 'end' ? minFrame : maxFrame,
			farFrame: edge === 'end' ? maxFrame : minFrame,
			started: false
		};
	}

	function moveScale(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (!drag.started && Math.abs(event.clientX - drag.startX) <= 3) return;
		drag.started = true;
		const deltaFrames = (event.clientX - drag.startX) / Math.max(0.001, pixelsPerFrame);
		const farFrameNew = drag.farFrame + deltaFrames;
		onscalechange({
			anchorFrame: drag.anchorFrame,
			requestedScale: scaleRatioFromEdge({
				anchorFrame: drag.anchorFrame,
				farFrame: drag.farFrame,
				farFrameNew
			})
		});
	}

	function cancelScale(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		drag = null;
		onscalecancel();
	}

	function endScale(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const finished = drag;
		drag = null;
		if (!finished.started) return;
		const deltaFrames = (event.clientX - finished.startX) / Math.max(0.001, pixelsPerFrame);
		onscaleend({
			anchorFrame: finished.anchorFrame,
			requestedScale: scaleRatioFromEdge({
				anchorFrame: finished.anchorFrame,
				farFrame: finished.farFrame,
				farFrameNew: finished.farFrame + deltaFrames
			}),
			duplicate: finished.duplicate
		});
	}
</script>

<div
	class="relative h-6 shrink-0 border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.15_0.008_55)]"
	role="region"
	aria-label={m.video_editor_keyframe_sheet_scale_strip_label()}
	data-timing-strip
>
	<div
		class="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[oklch(0.66_0.14_45_/_0.35)]"
		style="left:{leftPx}px;width:{Math.max(2, rightPx - leftPx)}px"
		data-timing-strip-span
	></div>
	<button
		type="button"
		class="absolute top-1/2 z-10 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-[oklch(0.66_0.14_45)] bg-[oklch(0.2_0.008_55)] py-1 text-[8px] leading-none text-[oklch(0.82_0.12_55)] hover:bg-[oklch(0.66_0.14_45_/_0.35)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:cursor-not-allowed disabled:opacity-45"
		style="left:{leftPx}px"
		aria-label={m.video_editor_keyframe_sheet_scale_start()}
		data-scale-handle="start"
		{disabled}
		onpointerdown={(event) => startScale('start', event)}
		onpointermove={moveScale}
		onpointerup={endScale}
		onpointercancel={cancelScale}>◀</button
	>
	<button
		type="button"
		class="absolute top-1/2 z-10 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-sm border border-[oklch(0.66_0.14_45)] bg-[oklch(0.2_0.008_55)] py-1 text-[8px] leading-none text-[oklch(0.82_0.12_55)] hover:bg-[oklch(0.66_0.14_45_/_0.35)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:cursor-not-allowed disabled:opacity-45"
		style="left:{rightPx}px"
		aria-label={m.video_editor_keyframe_sheet_scale_end()}
		data-scale-handle="end"
		{disabled}
		onpointerdown={(event) => startScale('end', event)}
		onpointermove={moveScale}
		onpointerup={endScale}
		onpointercancel={cancelScale}>▶</button
	>
</div>
