<script lang="ts">
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import RiArrowLeftSLine from 'remixicon-svelte/icons/arrow-left-s-line';

	let {
		ref = $bindable(null),
		class: className,
		label = 'Previous',
		ariaLabel = 'Go to previous page',
		...restProps
	}: PaginationPrimitive.PrevButtonProps & {
		label?: string;
		ariaLabel?: string;
	} = $props();
</script>

<PaginationPrimitive.PrevButton
	bind:ref
	aria-label={ariaLabel}
	class={cn(buttonVariants({ variant: 'ghost', size: 'default' }), 'pl-2!', className)}
	{...restProps}
>
	<RiArrowLeftSLine data-icon="inline-start" />
	<span class="cn-pagination-previous-text hidden sm:block">{label}</span>
</PaginationPrimitive.PrevButton>
