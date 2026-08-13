<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import RiSearchLine from 'remixicon-svelte/icons/search-line';

	let {
		ref = $bindable(null),
		class: className,
		value = $bindable(''),
		...restProps
	}: CommandPrimitive.InputProps = $props();
</script>

<div data-slot="command-input-wrapper" class="p-2 pb-1">
	<InputGroup.Root
		class="h-10! rounded-lg border-primary/30 bg-background shadow-none focus-within:border-primary focus-within:ring-primary/20"
	>
		<CommandPrimitive.Input
			{value}
			data-slot="command-input"
			class={cn(
				'w-full text-xs/relaxed outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
				className
			)}
			{...restProps}
		>
			{#snippet child({ props })}
				<InputGroup.Input {...props} bind:value bind:ref />
			{/snippet}
		</CommandPrimitive.Input>
		<InputGroup.Addon>
			<RiSearchLine class="size-3.5 shrink-0 opacity-50" />
		</InputGroup.Addon>
	</InputGroup.Root>
</div>
