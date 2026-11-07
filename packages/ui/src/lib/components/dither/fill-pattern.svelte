<script lang="ts">
	import { cssColor, fillPatternSpec } from '@openpost/dither/engine';
	import type { DitherColor, DitherMatrix, FillRamp, FillVariant } from '@openpost/dither/engine';

	/**
	 * An SVG `<pattern>` for any fill variant. Place it inside `<defs>` and fill
	 * shapes with `url(#id)`. Ported from dithercn's `FillPattern` and
	 * `DitherPattern`.
	 */
	let {
		id,
		fill = 'gradient',
		color = 'ink',
		cell = 2,
		level = 1,
		floor = 0.0625,
		matrix = 'bayer4',
		ramp,
		background
	}: {
		id: string;
		fill?: FillVariant;
		color?: DitherColor;
		cell?: number;
		/** Gradient: coverage at the dense edge, or the even level without a ramp. */
		level?: number;
		floor?: number;
		matrix?: DitherMatrix;
		ramp?: FillRamp;
		/** Colour behind the ink. Default transparent. */
		background?: DitherColor;
	} = $props();

	const spec = $derived(
		fillPatternSpec({ cell, fill, floor, level, matrix, ...(ramp ? { ramp } : {}) })
	);
</script>

<pattern
	{id}
	x={spec.x}
	y={spec.y}
	width={spec.width}
	height={spec.height}
	patternUnits="userSpaceOnUse"
	shape-rendering="crispEdges"
>
	{#if background}
		<rect width={spec.width} height={spec.height} style:fill={cssColor(background)} />
	{/if}
	<path d={spec.path} transform="scale({spec.cell})" style:fill={cssColor(color)} />
</pattern>
