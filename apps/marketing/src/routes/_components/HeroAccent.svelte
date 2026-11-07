<script lang="ts">
	import { ditherThreshold } from '@openpost/dither/paint';
	import { onMount } from 'svelte';
	import { annotate } from 'rough-notation';
	let { children } = $props();
	let element: HTMLSpanElement;
	const MIN_HORIZONTAL_PADDING = 9;
	const HORIZONTAL_PADDING_RATIO = 0.04;
	const CELL = 2;
	// Bayer coverage for the sketched stroke. Dense enough to read as a line, open enough to show pixels.
	const COVERAGE = 0.56;
	const uid = $props.id();
	const patternId = `accent-dither-${uid}`;
	const cells = Array.from({ length: 16 }, (_, index) => ({
		x: index % 4,
		y: Math.floor(index / 4)
	}))
		.filter(({ x, y }) => COVERAGE > ditherThreshold(x, y))
		.map(({ x, y }) => ({ x: x * CELL, y: y * CELL }));

	onMount(() => {
		// Rough ellipses vary with their radius, so long words need proportional breathing room.
		const padding = (): [number, number] => [
			5,
			Math.max(
				MIN_HORIZONTAL_PADDING,
				element.getBoundingClientRect().width * HORIZONTAL_PADDING_RATIO
			)
		];
		const annotation = annotate(element, {
			type: 'circle',
			// rough-notation writes this into each path's stroke, so the sketch paints with the Bayer tile.
			color: `url(#${patternId})`,
			strokeWidth: 7,
			padding: padding(),
			iterations: 2,
			multiline: false,
			animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
			animationDuration: 700
		});
		let disposed = false;
		const resizeObserver = new ResizeObserver(() => {
			annotation.padding = padding();
		});
		resizeObserver.observe(element);
		void document.fonts.ready.then(() => {
			if (!disposed) {
				annotation.padding = padding();
				annotation.show();
			}
		});
		return () => {
			disposed = true;
			resizeObserver.disconnect();
			annotation.remove();
		};
	});
</script>

<svg class="accent-defs" width="0" height="0" aria-hidden="true" focusable="false">
	<pattern
		id={patternId}
		width={CELL * 4}
		height={CELL * 4}
		patternUnits="userSpaceOnUse"
		shape-rendering="crispEdges"
	>
		{#each cells as cell (`${cell.x}:${cell.y}`)}
			<rect x={cell.x} y={cell.y} width={CELL} height={CELL} />
		{/each}
	</pattern>
</svg><span bind:this={element}>{@render children()}</span>

<style>
	span {
		display: inline-block;
		white-space: nowrap;
	}
	.accent-defs {
		position: absolute;
		width: 0;
		height: 0;
		overflow: hidden;
	}
	.accent-defs rect {
		fill: var(--marketing-soft-ink);
	}
	@media (forced-colors: active) {
		.accent-defs rect {
			fill: CanvasText;
		}
	}
</style>
