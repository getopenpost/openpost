<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from '$lib/utils.js';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	type Props = WithoutChildren<WithElementRef<HTMLTextareaAttributes>> & {
		unstyled?: boolean;
	};

	let {
		ref = $bindable(null),
		value = $bindable(),
		unstyled = false,
		class: className,
		'data-slot': dataSlot = 'textarea',
		...restProps
	}: Props = $props();
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		!unstyled &&
			'flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-field-border bg-field px-2 py-2 text-base text-field-foreground transition-colors [transition-duration:var(--theme-duration-fast)] outline-none placeholder:text-muted-foreground hover:bg-field-hover focus-visible:border-ring focus-visible:bg-field-focus focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-field-disabled disabled:text-field-disabled-foreground aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-xs/relaxed dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
		className
	)}
	bind:value
	{...restProps}></textarea>
