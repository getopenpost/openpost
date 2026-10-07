<script lang="ts">
	import { cn, type WithElementRef } from '../../utils.js';
	import type { HTMLAttributes } from 'svelte/elements';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { Button } from '../button/index.js';
	import { getUiMessages } from '../../messages.js';
	const m = getUiMessages();

	let {
		ref = $bindable(null),
		class: className,
		children,
		showCloseButton = false,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		showCloseButton?: boolean;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-footer"
	class={cn('flex flex-col-reverse gap-2 gap-2 sm:flex-row sm:justify-end', className)}
	{...restProps}
>
	{@render children?.()}
	{#if showCloseButton}
		<DialogPrimitive.Close>
			{#snippet child({ props })}
				<Button variant="outline" {...props}>{m.common_close()}</Button>
			{/snippet}
		</DialogPrimitive.Close>
	{/if}
</div>
