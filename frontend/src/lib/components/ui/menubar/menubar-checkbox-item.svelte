<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { Snippet } from "svelte";
	import RiSubtractLine from 'remixicon-svelte/icons/subtract-line';
	import RiCheckLine from 'remixicon-svelte/icons/check-line';

	let {
		ref = $bindable(null),
		class: className,
		checked = $bindable(false),
		indeterminate = $bindable(false),
		inset,
		children: childrenProp,
		...restProps
	}: WithoutChildrenOrChild<MenubarPrimitive.CheckboxItemProps> & {
		inset?: boolean;
		children?: Snippet;
	} = $props();
</script>

<MenubarPrimitive.CheckboxItem
	bind:ref
	bind:checked
	bind:indeterminate
	data-slot="menubar-checkbox-item"
	data-inset={inset}
	class={cn(
		"focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground min-h-7 gap-2 rounded-md py-1.5 pr-2 pl-7.5 text-xs data-inset:pl-7.5 relative flex cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
	{...restProps}
>
	{#snippet children({ checked: checked, indeterminate: indeterminate })}
		<span
			class="left-2 size-4 [&_svg:not([class*='size-'])]:size-4 pointer-events-none absolute flex items-center justify-center"
		>
			{#if indeterminate}
				<RiSubtractLine  />
			{:else if checked}
				<RiCheckLine  />
			{/if}
		</span>
		{@render childrenProp?.()}
	{/snippet}
</MenubarPrimitive.CheckboxItem>
