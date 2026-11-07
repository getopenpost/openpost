<script lang="ts">
	import { cssColor, ditherMaskStyle, styleString } from '@openpost/dither/engine';
	import type { DitherColor, DitherMatrix } from '@openpost/dither/engine';
	import DitherShader from './dither-shader.svelte';

	/**
	 * A dithered edge that dissolves a section into a solid colour: 16 nested
	 * Bayer bands, or a slowly drifting shader field with `animate`. Place it
	 * inside a positioned section. Ported from dithercn's `dither-fade` (MIT).
	 */
	let {
		side = 'bottom',
		size = 160,
		color = '--dither-paper',
		matrix = 'bayer4',
		cell,
		animate = false,
		class: className = ''
	}: {
		/** The edge that dissolves. */
		side?: 'top' | 'bottom' | 'left' | 'right';
		/** Depth of the fade: CSS pixels or any length. */
		size?: number | string;
		/** The colour it dissolves into, usually the next section's background. */
		color?: DitherColor;
		matrix?: DitherMatrix;
		cell?: number;
		animate?: boolean;
		class?: string;
	} = $props();

	const BANDS = 16;
	// Bands start closer together near the solid edge, so the fade eases out.
	const BAND_STARTS = Array.from({ length: BANDS }, (_, index) => ((index + 0.5) / BANDS) ** (1 / 1.6) * 100);
	const SIDES = { bottom: 0, left: 3, right: 2, top: 1 } as const;
	const FIELD = `
float field(vec2 uv, vec2 res, float t) {
  float s;
  float along;
  if (fadeSide < 0.5) {
    s = 1.0 - uv.y;
    along = uv.x * res.x / res.y;
  } else if (fadeSide < 1.5) {
    s = uv.y;
    along = uv.x * res.x / res.y;
  } else if (fadeSide < 2.5) {
    s = uv.x;
    along = uv.y * res.y / res.x;
  } else {
    s = 1.0 - uv.x;
    along = uv.y * res.y / res.x;
  }
  float drift = (fbm(vec2(along * 1.6 + t * 0.05, s * 1.2 - t * 0.03)) - 0.5) * 0.35;
  return pow(clamp(s + drift * (1.0 - s), 0.0, 1.0), 1.6);
}
`;
	const depth = $derived(typeof size === 'number' ? `${size}px` : size);
	const vertical = $derived(side === 'top' || side === 'bottom');
	const extent = $derived(vertical ? `height: ${depth}` : `width: ${depth}`);
	const clipFrom = (start: number) => {
		const at = `${start.toFixed(2)}%`;
		if (side === 'bottom') return `inset(${at} 0 0 0)`;
		if (side === 'top') return `inset(0 0 ${at} 0)`;
		if (side === 'left') return `inset(0 ${at} 0 0)`;
		return `inset(0 0 0 ${at})`;
	};
</script>

{#if animate}
	<DitherShader
		field={FIELD}
		palette={['transparent', color]}
		{matrix}
		{cell}
		uniforms={{ fadeSide: SIDES[side] }}
		class="dither-fade {side} {className}"
		style={extent}
	/>
{:else}
	<div aria-hidden="true" class="dither-fade {side} {className}" style={extent}>
		{#each BAND_STARTS as start, index (start)}
			<div
				class="band"
				style={styleString(
					ditherMaskStyle((index + 1) / BANDS, { matrix, ...(cell === undefined ? {} : { cell }) }),
					{ 'background-color': cssColor(color), 'clip-path': clipFrom(start) }
				)}
			></div>
		{/each}
	</div>
{/if}

<style>
	:global(.dither-fade) {
		position: absolute;
		overflow: hidden;
		pointer-events: none;
	}
	:global(.dither-fade.bottom) {
		inset-inline: 0;
		bottom: 0;
	}
	:global(.dither-fade.top) {
		inset-inline: 0;
		top: 0;
	}
	:global(.dither-fade.left) {
		inset-block: 0;
		left: 0;
	}
	:global(.dither-fade.right) {
		inset-block: 0;
		right: 0;
	}
	.band {
		position: absolute;
		inset: 0;
	}
	@media (forced-colors: active) {
		:global(.dither-fade) {
			display: none;
		}
	}
</style>
