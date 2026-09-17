<script lang="ts">
	import {
		Content as MenuContent,
		Item as MenuItem,
		Root as MenuRoot,
		Trigger as MenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { ThemeIcon } from '$lib/themes/icons';
	import { cn } from '$lib/utils';
	import { longestLabel, widestMenuWidthPx } from './menu-measure';

	let {
		label,
		value,
		options,
		disabled = false,
		align = 'start',
		class: className = '',
		onSelect
	}: {
		label: string;
		value: string;
		options: { value: string; label: string; disabled?: boolean }[];
		disabled?: boolean;
		align?: 'start' | 'center' | 'end';
		class?: string;
		onSelect?: (value: string) => void;
	} = $props();

	const selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? value);
	const triggerMinWidth = $derived(`${widestMenuWidthPx(options.map((option) => option.label))}px`);
</script>

<MenuRoot>
	<MenuTrigger {disabled} aria-label={label} title={longestLabel(options.map((o) => o.label))}>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				{disabled}
				style="min-width: {triggerMinWidth};"
				class={cn(
					'flex h-[var(--editor-25,25px)] items-center gap-1 rounded-[var(--editor-radius,5px)] border bg-muted px-1.5 text-[11px] tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:h-11',
					className
				)}
			>
				<span class="min-w-0 flex-1 truncate text-left">{selectedLabel}</span>
				<ThemeIcon role="chevron-down" class="size-3 shrink-0" />
			</button>
		{/snippet}
	</MenuTrigger>
	<MenuContent {align} style="min-width: {triggerMinWidth};">
		{#each options as option (option.value)}
			<MenuItem
				disabled={option.disabled}
				onclick={() => onSelect?.(option.value)}
				class="text-[11px]"
			>
				<span class="min-w-0 flex-1 truncate">{option.label}</span>
				{#if option.value === value}
					<ThemeIcon role="check" class="size-3 shrink-0" />
				{/if}
			</MenuItem>
		{/each}
	</MenuContent>
</MenuRoot>
