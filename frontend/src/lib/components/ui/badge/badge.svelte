<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span
	bind:this={ref}
	data-slot="badge"
	class={cn(
		'inline-flex items-center rounded-md border border-primary/20 bg-primary/8 px-2 py-0.5 text-xs font-medium text-foreground shadow-[0_1px_0_color-mix(in_oklch,var(--primary)_34%,black)]',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</span>
