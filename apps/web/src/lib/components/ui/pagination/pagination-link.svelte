<script lang="ts">
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import { buttonVariants, type ButtonSize } from '$lib/components/ui/button/index.js';
	let {
		ref = $bindable(null),
		class: className,
		size = 'icon',
		isActive,
		page,
		ariaLabel,
		children,
		...restProps
	}: PaginationPrimitive.PageProps & {
		size?: ButtonSize;
		isActive: boolean;
		ariaLabel?: string;
	} = $props();
</script>

{#snippet Fallback()}
	{page.value}
{/snippet}

<PaginationPrimitive.Page
	bind:ref
	{page}
	aria-current={isActive ? 'page' : undefined}
	data-slot="pagination-link"
	data-active={isActive}
	data-size={size}
	data-cuelume-toggle="page"
	class={cn(
		buttonVariants({ size, variant: isActive ? 'outline' : 'ghost' }),
		'cn-pagination-link',
		className
	)}
	{...restProps}
>
	{#snippet child({ props })}
		<button {...props} aria-label={ariaLabel ?? `Page ${page.value}`}>
			{#if children}
				{@render children?.()}
			{:else}
				{@render Fallback()}
			{/if}
		</button>
	{/snippet}
</PaginationPrimitive.Page>
