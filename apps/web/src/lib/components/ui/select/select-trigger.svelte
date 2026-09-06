<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';
	import { ThemeIcon } from '$lib/themes/icons/index.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		...restProps
	}: WithoutChild<SelectPrimitive.TriggerProps> & {
		size?: 'sm' | 'default';
	} = $props();
</script>

<SelectPrimitive.Trigger
	bind:ref
	data-slot="select-trigger"
	data-size={size}
	data-cuelume-toggle="toggle"
	class={cn(
		"flex w-fit items-center justify-between gap-2 rounded-lg border border-field-border bg-field px-2.5 py-1.5 text-xs/relaxed whitespace-nowrap text-field-foreground transition-[background-color,border-color] [transition-duration:var(--theme-duration-fast)] [transition-timing-function:var(--theme-easing)] outline-none hover:bg-field-hover focus-visible:border-ring focus-visible:bg-field-focus focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-field-disabled disabled:text-field-disabled-foreground aria-expanded:border-ring aria-expanded:bg-field-focus aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-11 data-[size=sm]:h-11 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 md:data-[size=default]:h-[var(--theme-control-height)] md:data-[size=sm]:h-[var(--theme-compact-control-height)] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [@media(pointer:coarse)]:h-11",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<ThemeIcon role="chevron-down" class="pointer-events-none size-3.5 text-muted-foreground" />
</SelectPrimitive.Trigger>
