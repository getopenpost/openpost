<!--
	Composition ruler: frame ticks, playhead and scrub ghost, work-area and
	composition-end dimming. Scrub gestures stay with the timeline owner.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let {
		visibleRange,
		pxPerFrame,
		timelineX,
		timelineWidth,
		durationFrames,
		previewFrame,
		regions,
		onscrub,
		onseek
	}: {
		visibleRange: { start: number; end: number };
		pxPerFrame: number;
		timelineX: (frame: number) => number;
		timelineWidth: number;
		durationFrames: number;
		previewFrame: number | null;
		regions: { hasActive: boolean; inP: number | null; outP: number | null };
		onscrub: (event: PointerEvent) => void;
		onseek: (frame: number) => void;
	} = $props();

	const rulerTicks = $derived.by(() => {
		const start = Math.floor(visibleRange.start);
		const end = Math.ceil(visibleRange.end);
		const target = Math.ceil(80 / pxPerFrame);
		const options = [1, 5, 10, 30, 60, 150, 300, 600, 1_800, 3_600];
		const step = options.find((option) => option >= target) ?? 3_600;
		const ticks: number[] = [];
		for (let frame = start - (start % step); frame <= end; frame += step)
			if (frame >= 0) ticks.push(frame);
		return ticks.slice(0, 128);
	});
</script>

<div
	class="composition-ruler"
	role="group"
	aria-label={m.video_editor_composition_timeline_ruler()}
	onpointerdown={onscrub}
	data-testid="composition-ruler"
>
	{#each rulerTicks as tick (tick)}
		<button
			type="button"
			class="ruler-tick"
			style="left:{timelineX(tick)}px"
			aria-label={`${tick}`}
			onclick={() => onseek(tick)}
			data-testid={`ruler-tick-${tick}`}
		>
			<span class="tick-line"></span>
			<span class="tick-label">{tick}</span>
		</button>
	{/each}
	<div
		class="ruler-playhead"
		style="left:{timelineX(timelineStore.currentFrame)}px"
		data-testid="composition-playhead"
		aria-hidden="true"
	></div>
	{#if previewFrame !== null}
		<div
			class="ruler-playhead ghost"
			style="left:{timelineX(previewFrame)}px"
			data-testid="composition-playhead-ghost"
			aria-hidden="true"
		></div>
	{/if}
	{#if regions.hasActive}
		<div
			class="active-region-dim left"
			style="width:{timelineX(regions.inP ?? 0)}px"
			data-testid="composition-active-dim-left"
		></div>
		<div
			class="active-region-dim right"
			style="left:{timelineX(regions.outP ?? durationFrames)}px; width:{Math.max(
				0,
				timelineWidth - timelineX(regions.outP ?? durationFrames)
			)}px"
			data-testid="composition-active-dim-right"
		></div>
	{/if}
	<div
		class="comp-end-dim"
		style="left:{timelineX(durationFrames)}px; width:{Math.max(
			0,
			timelineWidth - timelineX(durationFrames)
		)}px"
		data-testid="composition-end-dim"
	></div>
</div>

<style>
	.composition-ruler {
		position: sticky;
		top: 0;
		z-index: 2;
		height: 28px;
		border-bottom: 1px solid var(--video-editor-border);
		background: var(--video-editor-panel);
		overflow: hidden;
		cursor: pointer;
	}
	.ruler-tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 48px;
		margin-left: -24px;
		border: 0;
		background: transparent;
		color: var(--video-editor-muted);
		cursor: pointer;
		min-width: 44px;
		min-height: 28px;
	}
	.ruler-tick:focus-visible {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: -2px;
	}
	.tick-line {
		position: absolute;
		left: 50%;
		top: 16px;
		width: 1px;
		bottom: 0;
		background: var(--video-editor-border);
	}
	.tick-label {
		position: absolute;
		left: 50%;
		top: 2px;
		transform: translateX(-50%);
		font-size: 0.58rem;
		font-variant-numeric: tabular-nums;
	}
	.ruler-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: oklch(0.66 0.14 45);
		pointer-events: none;
	}
	.ruler-playhead.ghost {
		background: oklch(0.66 0.14 45 / 0.45);
		width: 1px;
		border-left: 1px dashed oklch(0.66 0.14 45);
	}
	.active-region-dim {
		position: absolute;
		top: 0;
		bottom: 0;
		background: color-mix(in oklch, var(--video-editor-panel) 45%, transparent);
		pointer-events: none;
	}
	.comp-end-dim {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 1px solid var(--video-editor-border);
		background: color-mix(in oklch, var(--video-editor-panel) 55%, transparent);
		pointer-events: none;
	}
	@media (pointer: coarse) {
		.ruler-tick {
			min-height: 44px;
		}
	}
</style>
