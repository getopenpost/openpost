<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { cn } from '$lib/utils';

	let {
		summary,
		open = $bindable(false),
		class: className = '',
		summaryClass = '',
		children
	}: {
		/** Sentence-case label; never rendered uppercase. */
		summary: string;
		open?: boolean;
		class?: string;
		summaryClass?: string;
		children: Snippet;
	} = $props();
</script>

<details bind:open class={cn('group', className)}>
	<summary
		class={cn(
			'flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md py-2 text-sm font-medium text-foreground select-none focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden',
			summaryClass
		)}
	>
		<ThemeIcon
			role="chevron-down"
			class="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
		/>
		<span class="min-w-0 truncate">{summary}</span>
	</summary>
	<div class="pt-2">
		{@render children()}
	</div>
</details>
