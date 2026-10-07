<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../../utils.js';
	let {
		ref = $bindable(null),
		value = $bindable(),
		children,
		class: className,
		...restProps
	}: WithElementRef<HTMLSelectAttributes> = $props();
</script>
<select
	bind:this={ref}
	bind:value
	data-slot="select-trigger"
	class={cn('h-[var(--theme-control-height)] w-full min-w-0 rounded-md border border-field-border bg-field px-3 py-1 text-sm text-field-foreground outline-none transition-colors [transition-duration:var(--theme-duration-fast)] hover:bg-field-hover focus-visible:border-ring focus-visible:bg-field-focus focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-field-disabled disabled:text-field-disabled-foreground [@media(pointer:coarse)]:min-h-11', className)}
	{...restProps}
>
	{@render children?.()}
</select>
