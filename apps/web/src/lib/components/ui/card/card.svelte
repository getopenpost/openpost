<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = 'default',
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		size?: 'default' | 'sm';
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	class={cn(
		'group/card flex flex-col gap-4 overflow-hidden rounded-lg border border-border bg-card py-4 text-xs/relaxed text-card-foreground [box-shadow:var(--theme-shadow-card)] transition-[background-color,border-color,box-shadow] [transition-duration:var(--theme-duration-normal)] has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
