<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLDetailsAttributes } from 'svelte/elements';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes/contracts.js';
	import { cn } from '$lib/utils';

	type Props = Omit<HTMLDetailsAttributes, 'open' | 'class'> & {
		/** Sentence-case label; never rendered uppercase. */
		summary: string;
		/** Optional muted help line under the summary. */
		description?: string;
		open?: boolean;
		class?: string;
		summaryClass?: string;
		/** Bordered row treatment for grouped settings. */
		boxed?: boolean;
		/** Optional muted icon before the summary label. */
		icon?: ThemeIconRole;
		/** End-of-row content, such as a status hint or quiet badge. */
		summaryEnd?: Snippet;
		/** Reports user toggles; combine with one-way `open` for controlled usage. */
		onToggle?: (open: boolean) => void;
		children: Snippet;
	};

	let {
		summary,
		description = '',
		open = $bindable(false),
		class: className = '',
		summaryClass = '',
		boxed = false,
		icon,
		summaryEnd,
		onToggle,
		children,
		...restProps
	}: Props = $props();
</script>

<details
	bind:open
	class={cn('group', boxed && 'rounded-lg border', className)}
	ontoggle={(event) => onToggle?.((event.currentTarget as HTMLDetailsElement).open)}
	{...restProps}
>
	<summary
		class={cn(
			'flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md py-2 text-sm font-medium text-foreground select-none focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden',
			boxed && 'px-4 py-3',
			summaryClass
		)}
	>
		<ThemeIcon
			role="chevron-down"
			class="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
		/>
		{#if icon}<ThemeIcon role={icon} class="size-4 shrink-0 text-muted-foreground" />{/if}
		<span class="min-w-0 flex-1">
			<span class="block truncate">{summary}</span>
			{#if description}
				<span class="mt-0.5 block text-sm leading-6 font-normal text-muted-foreground">
					{description}
				</span>
			{/if}
		</span>
		{#if summaryEnd}
			<span class="ml-auto shrink-0">{@render summaryEnd()}</span>
		{/if}
	</summary>
	<div class="pt-2">
		{@render children()}
	</div>
</details>
