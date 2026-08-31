<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';
	import RiArrowDownSLine from 'remixicon-svelte/icons/arrow-down-s-line';

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
		"flex w-fit items-center justify-between gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs/relaxed whitespace-nowrap transition-[background-color,border-color] duration-100 ease-out outline-none hover:border-primary/50 hover:bg-primary/5 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-primary aria-expanded:bg-primary/7 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-11 data-[size=sm]:h-11 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 md:data-[size=default]:h-8 md:data-[size=sm]:h-7 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [@media(pointer:coarse)]:h-11",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<RiArrowDownSLine class="pointer-events-none size-3.5 text-muted-foreground" />
</SelectPrimitive.Trigger>
