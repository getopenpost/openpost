<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		segments = [],
		live = false,
		class: className = '',
		children
	}: {
		segments?: string[];
		live?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<footer
	role={live ? 'status' : 'contentinfo'}
	class={cn(
		'flex h-[var(--editor-25,25px)] items-center gap-3 overflow-hidden border-t px-2 font-mono text-[10px] whitespace-nowrap tabular-nums',
		className
	)}
	data-editor-status-line
>
	{#if children}
		{@render children()}
	{:else}
		{#each segments as segment (segment)}
			<span class="truncate">{segment}</span>
		{/each}
	{/if}
</footer>
