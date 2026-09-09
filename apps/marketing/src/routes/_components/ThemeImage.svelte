<script lang="ts">
	import { mode } from 'mode-watcher';

	let {
		lightSrc,
		darkSrc,
		alt,
		width,
		height,
		loading = 'lazy',
		decoding = 'async',
		class: className
	}: {
		lightSrc: string;
		darkSrc: string;
		alt: string;
		width: number;
		height: number;
		loading?: 'eager' | 'lazy';
		decoding?: 'async' | 'auto' | 'sync';
		class?: string;
	} = $props();

	const darkMedia = $derived(
		mode.current === undefined
			? '(prefers-color-scheme: dark)'
			: mode.current === 'dark'
				? 'all'
				: 'not all'
	);
</script>

<picture>
	<source media={darkMedia} srcset={darkSrc} />
	<img src={lightSrc} {alt} {width} {height} {loading} {decoding} class={className} />
</picture>

<style>
	picture {
		display: contents;
	}
</style>
