<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef, type WithoutChildren } from '$lib/utils.js';
	import RiMoreLine from 'remixicon-svelte/icons/more-line';

	let {
		ref = $bindable(null),
		class: className,
		label = 'More pages',
		...restProps
	}: WithoutChildren<WithElementRef<HTMLAttributes<HTMLSpanElement>>> & {
		label?: string;
	} = $props();
</script>

<span
	bind:this={ref}
	aria-hidden="true"
	data-slot="pagination-ellipsis"
	class={cn(
		"flex size-7 items-center justify-center [&_svg:not([class*='size-'])]:size-3.5",
		className
	)}
	{...restProps}
>
	<RiMoreLine />
	<span class="sr-only">{label}</span>
</span>
