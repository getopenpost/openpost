<script lang="ts">
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import DropdownMenuPortal from './dropdown-menu-portal.svelte';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import type { ComponentProps } from 'svelte';

	let {
		ref = $bindable(null),
		sideOffset = 4,
		align = 'start',
		preventScroll = false,
		portalProps,
		onOpenAutoFocus,
		class: className,
		...restProps
	}: DropdownMenuPrimitive.ContentProps & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DropdownMenuPortal>>;
	} = $props();

	function handleOpenAutoFocus(event: Event) {
		onOpenAutoFocus?.(event);
		if (event.defaultPrevented) return;
		event.preventDefault();
		const content = ref;
		const previousFocus = document.activeElement;
		// Bits defers opening focus to a frame. A keyboard choice made before that
		// frame must keep focus instead of being reset to the first item.
		requestAnimationFrame(() => {
			if (!content || ref !== content || !content.isConnected) return;
			if (content.dataset.state !== 'open' || content.contains(document.activeElement)) return;
			if (document.activeElement !== previousFocus) return;
			content.focus();
		});
	}
</script>

<DropdownMenuPortal {...portalProps}>
	<DropdownMenuPrimitive.Content
		bind:ref
		data-slot="dropdown-menu-content"
		{sideOffset}
		{align}
		{preventScroll}
		onOpenAutoFocus={handleOpenAutoFocus}
		class={cn(
			'relative z-50 w-(--bits-dropdown-menu-anchor-width) min-w-32 animate-none! overflow-visible rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
			className
		)}
		{...restProps}
	/>
</DropdownMenuPortal>
