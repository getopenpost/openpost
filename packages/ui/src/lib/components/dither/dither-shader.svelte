<script lang="ts">
	import { cssColor, DEFAULT_PALETTE, mountDitherShader } from '@openpost/dither/engine';
	import type { DitherShaderOptions, DitherShaderState } from '@openpost/dither/engine';
	import { untrack, type Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/**
	 * A dithered full-bleed canvas driven by a GLSL `field`. Pauses offscreen
	 * and in hidden tabs, holds a still frame under reduced motion and follows
	 * the theme. Shows `fallback` (flat paper by default) until WebGL draws.
	 */
	let {
		field,
		colorField,
		uniforms,
		matrix,
		levels,
		cell,
		palette,
		speed,
		animate,
		fps,
		stillTime,
		fallback,
		class: className = '',
		...rest
	}: Omit<DitherShaderOptions, 'onState'> & {
		fallback?: Snippet;
		class?: string;
	} & Omit<HTMLAttributes<HTMLDivElement>, 'children'> = $props();

	let root: HTMLDivElement;
	let state = $state<DitherShaderState>('fallback');
	const options = $derived<DitherShaderOptions>({
		animate,
		cell,
		colorField,
		field,
		fps,
		levels,
		matrix,
		onState: (next) => (state = next),
		palette,
		speed,
		stillTime,
		uniforms
	});

	let mounted: ReturnType<typeof mountDitherShader> | undefined;
	$effect(() => {
		const instance = untrack(() => mountDitherShader(root, { ...options }));
		mounted = instance;
		return () => {
			mounted = undefined;
			instance.destroy();
		};
	});
	$effect(() => {
		const next = { ...options };
		untrack(() => mounted?.update(next));
	});
</script>

<div
	bind:this={root}
	aria-hidden="true"
	data-state={state}
	class="dither-shader {className}"
	{...rest}
>
	<div class="dither-fallback">
		{#if fallback}
			{@render fallback()}
		{:else}
			<div class="dither-paper" style:background-color={cssColor((palette ?? DEFAULT_PALETTE)[0])}></div>
		{/if}
	</div>
</div>

<style>
	.dither-shader {
		position: relative;
		overflow: hidden;
		pointer-events: none;
	}
	.dither-shader :global(canvas[data-dither-canvas]) {
		position: absolute;
		top: 0;
		left: 0;
		display: block;
		image-rendering: pixelated;
		opacity: 1;
		transition: opacity 700ms ease-out;
	}
	.dither-shader[data-state='fallback'] :global(canvas[data-dither-canvas]) {
		opacity: 0;
		transition-duration: 0ms;
	}
	.dither-fallback,
	.dither-paper {
		position: absolute;
		inset: 0;
	}
	.dither-fallback {
		opacity: 0;
		transition: opacity 0ms 700ms;
	}
	.dither-shader[data-state='fallback'] .dither-fallback {
		opacity: 1;
		transition-delay: 0ms;
	}
	@media (prefers-reduced-motion: reduce) {
		.dither-shader :global(canvas[data-dither-canvas]) {
			transition: none;
		}
	}
</style>
