<script lang="ts">
	import { onMount } from 'svelte';
	import { annotate } from 'rough-notation';
	let { children } = $props();
	let element: HTMLSpanElement;
	const MIN_HORIZONTAL_PADDING = 9;
	const HORIZONTAL_PADDING_RATIO = 0.04;
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
			color: 'var(--marketing-soft-ink)',
			strokeWidth: 2,
			padding: padding(),
			iterations: 1,
			multiline: false,
			animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
			animationDuration: 550
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

<span bind:this={element}>{@render children()}</span>

<style>
	span {
		display: inline-block;
		white-space: nowrap;
	}
</style>
