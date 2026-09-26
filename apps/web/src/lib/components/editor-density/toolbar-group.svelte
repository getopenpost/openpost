<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		ariaLabel,
		class: className = '',
		children
	}: {
		ariaLabel?: string;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<!-- A toolbar without an accessible name is worse than no toolbar landmark:
     screen readers announce a bare "toolbar" with no way to tell it apart
     from sibling toolbars. Only claim the role when a name is provided. -->
<div
	role={ariaLabel ? 'toolbar' : undefined}
	aria-label={ariaLabel}
	class={cn(
		'flex h-[var(--editor-25,25px)] w-fit items-center gap-px rounded-[var(--editor-radius,5px)] border bg-muted p-px [@media(pointer:coarse)]:h-11',
		className
	)}
	data-editor-toolbar-group
>
	{@render children()}
</div>
