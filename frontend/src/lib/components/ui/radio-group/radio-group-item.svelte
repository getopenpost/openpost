<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<RadioGroupPrimitive.Item
	bind:ref
	data-slot="radio-group-item"
	data-cuelume-toggle="toggle"
	class={cn(
		'peer relative flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background shadow-xs transition-[color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:text-primary dark:bg-input/30',
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		{#if checked}
			<span data-slot="radio-group-indicator" class="size-2 rounded-full bg-current"></span>
		{/if}
	{/snippet}
</RadioGroupPrimitive.Item>
