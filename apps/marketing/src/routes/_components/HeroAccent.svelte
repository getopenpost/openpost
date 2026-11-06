<script lang="ts">
	import { ditherSurface } from '@openpost/dither';
	import { onMount } from 'svelte';
	let { children } = $props();
	let element: HTMLSpanElement;
	let shown = $state(false);
	onMount(() => {
		// Reveal once the words are on screen so headings below the fold still draw in.
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				shown = true;
				observer.disconnect();
			},
			{ threshold: 0.6 }
		);
		observer.observe(element);
		return () => observer.disconnect();
	});
</script>

<span class="accent" bind:this={element}
	>{@render children()}<span
		class="swash"
		class:shown
		use:ditherSurface={{ direction: 'up' }}
		aria-hidden="true"
	></span></span
>

<style>
	.accent {
		position: relative;
		isolation: isolate;
		display: inline-block;
		white-space: nowrap;
	}
	.swash {
		position: absolute;
		z-index: -1;
		left: -0.04em;
		right: -0.04em;
		bottom: -0.1em;
		height: 0.2em;
		background: var(--marketing-soft-ink);
		mask-image: var(--dither-mask);
		mask-size: var(--dither-mask-size, 8px 64px);
		mask-repeat: repeat-x;
		clip-path: inset(0 100% 0 0);
		pointer-events: none;
	}
	.swash.shown {
		clip-path: inset(0 0 0 0);
		transition: clip-path 560ms steps(14, end);
	}
	@media (prefers-reduced-motion: reduce) {
		.swash.shown {
			transition: none;
		}
	}
	@media (forced-colors: active) {
		.swash {
			background: CanvasText;
			mask-image: none;
		}
	}
</style>
