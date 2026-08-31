<script lang="ts">
	import { cn } from '$lib/utils.js';
	import { ContextMenu as ContextMenuPrimitive } from 'bits-ui';
	import RiArrowRightSLine from 'remixicon-svelte/icons/arrow-right-s-line';

	let {
		ref = $bindable(null),
		class: className,
		inset,
		children,
		...restProps
	}: ContextMenuPrimitive.SubTriggerProps & { inset?: boolean } = $props();
</script>

<ContextMenuPrimitive.SubTrigger
	bind:ref
	data-slot="context-menu-sub-trigger"
	data-inset={inset}
	class={cn(
		'flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7.5 data-open:bg-accent data-open:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3.5',
		className
	)}
	{...restProps}
>
	{@render children?.()}
	<RiArrowRightSLine class="ml-auto" />
</ContextMenuPrimitive.SubTrigger>
