<script lang="ts">
	import { DitherShader } from '@openpost/ui/components/dither';

	/** Distance in CSS pixels from the top of the field to the resting horizon. */
	let { horizon = 220 }: { horizon?: number } = $props();

	const BELOW = 300;
	// A glowing horizon that swells slowly behind the product frame. Distances are in CSS
	// pixels so the glow keeps its shape at every width; the shader owns the dither cells.
	const FIELD = `
float field(vec2 uv, vec2 res, float t) {
  float cellPx = heightPx / res.y;
  float px = uv.x * res.x * cellPx;
  float y = (1.0 - uv.y) * heightPx;
  float wave = 12.0 * sin(px * 0.0052 + t * 0.35)
    + 7.0 * sin(px * 0.0131 - t * 0.22)
    + 3.0 * sin(px * 0.031 + t * 0.6);
  float shimmer = 0.82 + 0.18 * sin(px * 0.021 - t * 0.5);
  float d = y - (horizonPx + wave);
  float reach = d < 0.0 ? 48.0 : 40.0;
  // The floor lets the glow reach zero well before the field's edge.
  return clamp(exp(-abs(d) / reach) * shimmer - 0.14, 0.0, 1.0);
}
`;
	const PALETTE = [
		'transparent',
		'color-mix(in oklch, var(--marketing-soft-ink) 55%, transparent)',
		'--marketing-soft-ink'
	] as const;
</script>

<DitherShader
	field={FIELD}
	palette={PALETTE}
	uniforms={{ heightPx: horizon + BELOW, horizonPx: horizon }}
	fps={20}
	class="hero-horizon"
	style="--horizon-offset: {horizon}px; --horizon-below: {BELOW}px"
>
	{#snippet fallback()}{/snippet}
</DitherShader>

<style>
	:global(.hero-horizon) {
		position: absolute !important;
		z-index: -1;
		top: calc(var(--horizon-offset) * -1);
		left: 50%;
		width: 100vw;
		height: calc(var(--horizon-offset) + var(--horizon-below));
		transform: translateX(-50%);
	}
	@media (forced-colors: active) {
		:global(.hero-horizon) {
			display: none;
		}
	}
</style>
