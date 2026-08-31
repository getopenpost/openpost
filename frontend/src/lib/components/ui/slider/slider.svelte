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
		onValueCancel,
		onKeydown,
		class: className,
		trackClass = '',
		rangeClass = ''
	}: {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		disabled?: boolean;
		ariaLabel?: string;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
		onValueCancel?: () => void;
		onKeydown?: (event: KeyboardEvent) => void;
		class?: string;
		trackClass?: string;
		rangeClass?: string;
	} = $props();

	let keyboardGestureActive = false;
	let pendingKeyboardCommit: number | null = null;

	function isSliderKey(key: string): boolean {
		return (
			key === 'ArrowLeft' ||
			key === 'ArrowRight' ||
			key === 'ArrowUp' ||
			key === 'ArrowDown' ||
			key === 'PageUp' ||
			key === 'PageDown' ||
			key === 'Home' ||
			key === 'End'
		);
	}

	function handleValueCommit(nextValue: number): void {
		if (keyboardGestureActive) {
			pendingKeyboardCommit = nextValue;
			return;
		}
		onValueCommit?.(nextValue);
	}

	function flushKeyboardCommit(): void {
		keyboardGestureActive = false;
		if (pendingKeyboardCommit === null) return;
		const nextValue = pendingKeyboardCommit;
		pendingKeyboardCommit = null;
		onValueCommit?.(nextValue);
	}

	function cancelGesture(): void {
		keyboardGestureActive = false;
		pendingKeyboardCommit = null;
		onValueCancel?.();
	}
</script>

<SliderPrimitive.Root
	data-slot="slider-root"
	type="single"
	bind:value
	{min}
	{max}
	{step}
	{disabled}
	{onValueChange}
	onValueCommit={handleValueCommit}
	onkeydowncapture={(event) => {
		if (event.key === 'Escape') {
			cancelGesture();
		} else if (isSliderKey(event.key)) {
			keyboardGestureActive = true;
		}
	}}
	onkeydown={(event) => onKeydown?.(event)}
	onkeyup={(event) => {
		if (isSliderKey(event.key)) flushKeyboardCommit();
	}}
	onfocusout={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) flushKeyboardCommit();
	}}
	onpointercancel={cancelGesture}
	class={cn(
		'relative flex h-11 w-full touch-none items-center select-none md:h-5 data-disabled:cursor-not-allowed data-disabled:opacity-50 [@media(pointer:coarse)]:h-11',
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
				class={cn('absolute h-full bg-primary data-[orientation=vertical]:w-full', rangeClass)}
			/>
		</span>
		{#each thumbItems as thumb (thumb.index)}
			<SliderPrimitive.Thumb
				index={thumb.index}
				aria-label={ariaLabel}
				data-slot="slider-thumb"
				class="relative block size-11 shrink-0 rounded-full border-0 bg-transparent shadow-none ring-ring/50 transition-[color,box-shadow] after:absolute after:top-1/2 after:left-1/2 after:size-3.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:border-2 after:border-primary after:bg-background after:shadow-sm after:content-[''] hover:ring-4 focus-visible:ring-4 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 md:size-3.5 md:border-2 md:border-primary md:bg-background md:shadow-sm md:after:hidden [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:border-0 [@media(pointer:coarse)]:bg-transparent [@media(pointer:coarse)]:shadow-none [@media(pointer:coarse)]:after:block"
			/>
		{/each}
	{/snippet}
</SliderPrimitive.Root>
