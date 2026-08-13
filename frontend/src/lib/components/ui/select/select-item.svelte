<script lang="ts">
	import { Select as SelectPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';
	import RiCheckLine from 'remixicon-svelte/icons/check-line';

	let {
		ref = $bindable(null),
		class: className,
		value,
		label,
		children: childrenProp,
		...restProps
	}: WithoutChild<SelectPrimitive.ItemProps> = $props();
</script>

<SelectPrimitive.Item
	bind:ref
	{value}
	data-slot="select-item"
	data-cuelume-toggle="tick"
	class={cn(
		"relative flex min-h-9 w-full cursor-default items-center gap-2 rounded-lg px-3 py-1.5 pr-9 text-sm/relaxed outline-hidden transition-colors duration-75 select-none focus:bg-primary/10 focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground data-highlighted:bg-primary/10 data-highlighted:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:font-medium [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
		className
	)}
	{...restProps}
>
	{#snippet children({ selected, highlighted })}
		<span class="absolute end-3 flex size-4 items-center justify-center text-primary">
			{#if selected}
				<RiCheckLine class="cn-select-item-indicator-icon" />
			{/if}
		</span>
		{#if childrenProp}
			{@render childrenProp({ selected, highlighted })}
		{:else}
			{label || value}
		{/if}
	{/snippet}
</SelectPrimitive.Item>
