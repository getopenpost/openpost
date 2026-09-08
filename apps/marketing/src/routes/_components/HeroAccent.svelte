<script lang="ts">
	import { onMount } from 'svelte';
	import { annotate } from 'rough-notation';
	let { children } = $props();
	let element: HTMLSpanElement;
	onMount(() => {
		const annotation = annotate(element, {
			type: 'underline',
			color: 'var(--primary)',
			strokeWidth: 2,
			padding: 3,
			iterations: 1,
			multiline: true,
			animate: !matchMedia('(prefers-reduced-motion: reduce)').matches,
			animationDuration: 550
		});
		let disposed = false;
		void document.fonts.ready.then(() => {
			if (!disposed) annotation.show();
		});
		return () => {
			disposed = true;
			annotation.remove();
		};
	});
</script>

<span bind:this={element}>{@render children()}</span>
