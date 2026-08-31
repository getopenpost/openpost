<script lang="ts">
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import { ContextMenu as ContextMenuPrimitive } from 'bits-ui';
	import type { ComponentProps } from 'svelte';
	import ContextMenuPortal from './context-menu-portal.svelte';

	let {
		ref = $bindable(null),
		sideOffset = 4,
		preventScroll = false,
		portalProps,
		class: className,
		...restProps
	}: ContextMenuPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof ContextMenuPortal>>;
	} = $props();
</script>

<ContextMenuPortal {...portalProps}>
	<ContextMenuPrimitive.Content
		bind:ref
		data-slot="context-menu-content"
		{sideOffset}
		{preventScroll}
		class={cn(
			'relative z-50 min-w-36 animate-none! overflow-visible rounded-lg bg-popover/70 p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[variant=destructive]:text-destructive data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
			className
		)}
		{...restProps}
	/>
</ContextMenuPortal>
