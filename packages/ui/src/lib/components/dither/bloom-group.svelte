<script lang="ts">
	import { bloomLayerStyle, styleString } from '@openpost/dither/engine';
	import type { Bloom } from '@openpost/dither/engine';
	import type { Snippet } from 'svelte';
	import type { SVGAttributes } from 'svelte/elements';

	/**
	 * An SVG group drawn as a glow: put solid copies of shapes inside and render
	 * it before the real fills. Renders nothing when off.
	 */
	let {
		bloom,
		children,
		...rest
	}: { bloom: Bloom; children: Snippet } & SVGAttributes<SVGGElement> = $props();
	const layer = $derived(bloomLayerStyle(bloom));
</script>

{#if layer}
	<g aria-hidden="true" {...rest} style={styleString(layer)}>{@render children()}</g>
{/if}
