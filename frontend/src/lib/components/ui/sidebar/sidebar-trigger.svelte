<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import RiSideBarLine from 'remixicon-svelte/icons/side-bar-line';
	import { cn } from '$lib/utils.js';
	import type { ComponentProps } from 'svelte';
	import { useSidebar } from './context.svelte.js';
	import { m } from '$lib/paraglide/messages';

	let {
		ref = $bindable(null),
		class: className,
		onclick,
		...restProps
	}: ComponentProps<typeof Button> & {
		onclick?: (e: MouseEvent) => void;
	} = $props();

	const sidebar = useSidebar();
</script>

<Button
	bind:ref
	data-sidebar="trigger"
	data-slot="sidebar-trigger"
	variant="ghost"
	size="icon-sm"
	class={cn('cn-sidebar-trigger', className)}
	type="button"
	onclick={(e) => {
		onclick?.(e);
		sidebar.toggle();
	}}
	{...restProps}
>
	<RiSideBarLine />
	<span class="sr-only">{m.common_toggle_sidebar()}</span>
</Button>
