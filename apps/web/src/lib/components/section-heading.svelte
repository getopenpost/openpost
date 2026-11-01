<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	type Props = {
		/** Heading level. Section groups default to h2; sub-groups use h3 without flattening hierarchy. */
		level?: 2 | 3 | 4;
		/** Default section size, or the compact size for dense editor panels. */
		size?: 'section' | 'compact';
		/** Forwarded so existing section aria-labelledby wiring keeps working. */
		id?: string;
		class?: string;
		children?: Snippet;
	};

	let { level = 2, size = 'section', id, class: className, children }: Props = $props();

	const sizeClass = $derived(
		size === 'compact'
			? 'text-xs font-semibold text-muted-foreground'
			: 'text-base leading-6 font-semibold'
	);
</script>

{#if level === 3}
	<h3 {id} data-slot="section-heading" data-size={size} class={cn(sizeClass, className)}>
		{@render children?.()}
	</h3>
{:else if level === 4}
	<h4 {id} data-slot="section-heading" data-size={size} class={cn(sizeClass, className)}>
		{@render children?.()}
	</h4>
{:else}
	<h2 {id} data-slot="section-heading" data-size={size} class={cn(sizeClass, className)}>
		{@render children?.()}
	</h2>
{/if}
