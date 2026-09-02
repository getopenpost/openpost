<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type'> &
			({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		'data-slot': dataSlot = 'input',
		...restProps
	}: Props = $props();
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			'h-[var(--theme-control-height)] w-full min-w-0 rounded-md border border-field-border bg-field px-3 py-1 text-base text-field-foreground transition-colors [transition-duration:var(--theme-duration-fast)] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:bg-field-hover focus-visible:border-ring focus-visible:bg-field-focus focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-field-disabled disabled:text-field-disabled-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
			className
		)}
		type="file"
		bind:files
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			'h-[var(--theme-control-height)] w-full min-w-0 rounded-md border border-field-border bg-field px-3 py-1 text-base text-field-foreground transition-colors [transition-duration:var(--theme-duration-fast)] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:bg-field-hover focus-visible:border-ring focus-visible:bg-field-focus focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-transparent disabled:bg-field-disabled disabled:text-field-disabled-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
