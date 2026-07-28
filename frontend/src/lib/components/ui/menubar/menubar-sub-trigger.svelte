<script lang="ts">
	import { Menubar as MenubarPrimitive } from "bits-ui";
	import { cn, type WithoutChild } from "$lib/utils.js";
	import RiArrowRightSLine from 'remixicon-svelte/icons/arrow-right-s-line';

	let {
		ref = $bindable(null),
		class: className,
		inset = undefined,
		children,
		...restProps
	}: WithoutChild<MenubarPrimitive.SubTriggerProps> & {
		inset?: boolean;
	} = $props();
</script>

<MenubarPrimitive.SubTrigger
	bind:ref
	data-slot="menubar-sub-trigger"
	data-inset={inset}
	class={cn(
		"focus:bg-accent focus:text-accent-foreground data-open:bg-accent data-open:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground min-h-7 gap-2 rounded-md px-2 py-1 text-xs data-inset:pl-7.5 [&_svg:not([class*='size-'])]:size-3.5 flex cursor-default items-center outline-none select-none",
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<RiArrowRightSLine class="cn-rtl-flip ml-auto size-4" />
</MenubarPrimitive.SubTrigger>
