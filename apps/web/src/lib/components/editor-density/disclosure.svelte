<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		Content as CollapsibleContent,
		Root as CollapsibleRoot,
		Trigger as CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import { ThemeIcon } from '$lib/themes/icons';
	import { cn } from '$lib/utils';

	let {
		label,
		summary,
		open = $bindable(false),
		disabled = false,
		class: className = '',
		actions,
		children
	}: {
		label: string;
		summary?: string;
		open?: boolean;
		disabled?: boolean;
		class?: string;
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<CollapsibleRoot
	bind:open
	{disabled}
	class={cn('border-b first:border-t', className)}
	data-editor-disclosure
>
	<div
		class="flex min-h-[var(--editor-25,25px)] items-center gap-1 [@media(pointer:coarse)]:min-h-11"
	>
		<CollapsibleTrigger
			class="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--editor-radius,5px)] px-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:h-11"
			aria-label={summary ? `${label}: ${summary}` : label}
		>
			<ThemeIcon
				role="chevron-down"
				class={cn('size-3 shrink-0 transition-transform', open && '-rotate-180')}
			/>
			<span class="truncate text-[11px] font-medium tracking-wide uppercase">{label}</span>
			{#if !open && summary}
				<span
					class="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-muted-foreground tabular-nums"
					>{summary}</span
				>
			{/if}
		</CollapsibleTrigger>
		{#if actions}
			<span class="flex shrink-0 items-center" data-editor-disclosure-actions
				>{@render actions()}</span
			>
		{/if}
	</div>
	<CollapsibleContent class="pb-1.5">
		{@render children()}
	</CollapsibleContent>
</CollapsibleRoot>
