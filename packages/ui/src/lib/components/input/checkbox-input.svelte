<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '../../utils.js';
	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: WithElementRef<Omit<HTMLInputAttributes, 'type'>> = $props();
</script>
<input
	bind:this={ref}
	bind:checked
	type="checkbox"
	data-slot="checkbox"
	data-state={checked ? 'checked' : 'unchecked'}
	class={cn('size-4 shrink-0 rounded-sm border border-field-border bg-field accent-action-focal focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50', className)}
	{...restProps}
/>
