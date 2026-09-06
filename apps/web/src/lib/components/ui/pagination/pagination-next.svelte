<script lang="ts">
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { ThemeIcon } from '$lib/themes/icons/index.js';

	let {
		ref = $bindable(null),
		class: className,
		label = 'Next',
		ariaLabel = 'Go to next page',
		...restProps
	}: PaginationPrimitive.NextButtonProps & {
		label?: string;
		ariaLabel?: string;
	} = $props();
</script>

<PaginationPrimitive.NextButton
	bind:ref
	aria-label={ariaLabel}
	class={cn(buttonVariants({ variant: 'ghost', size: 'default' }), 'pr-2!', className)}
	{...restProps}
>
	<span class="cn-pagination-next-text hidden sm:block">{label}</span>
	<ThemeIcon role="chevron-right" data-icon="inline-end" />
</PaginationPrimitive.NextButton>
