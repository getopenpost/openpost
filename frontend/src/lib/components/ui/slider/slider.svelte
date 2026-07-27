<script lang="ts">
	import { Slider as SliderPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	let {
		value = $bindable(0),
		min = 0,
		max = 100,
		step = 1,
		disabled = false,
		ariaLabel,
		onValueChange,
		onValueCommit,
		class: className,
		trackClass = ''
	}: {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		disabled?: boolean;
		ariaLabel?: string;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
		class?: string;
		trackClass?: string;
	} = $props();
</script>

<SliderPrimitive.Root
	type="single"
	bind:value
	{min}
	{max}
	{step}
	{disabled}
	{onValueChange}
	{onValueCommit}
	class={cn(
		'relative flex h-5 w-full touch-none items-center select-none data-disabled:cursor-not-allowed data-disabled:opacity-50',
		className
	)}
>
	{#snippet children({ thumbItems })}
		<span
			data-slot="slider-track"
			class={cn('relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted', trackClass)}
		>
			<SliderPrimitive.Range
				data-slot="slider-range"
				class="absolute h-full bg-primary data-[orientation=vertical]:w-full"
			/>
		</span>
		{#each thumbItems as thumb (thumb.index)}
			<SliderPrimitive.Thumb
				index={thumb.index}
				aria-label={ariaLabel}
				data-slot="slider-thumb"
				class="block size-3.5 shrink-0 rounded-full border-2 border-primary bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
			/>
		{/each}
	{/snippet}
</SliderPrimitive.Root>
