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
				class={cn('absolute h-full bg-primary data-[orientation=vertical]:w-full', rangeClass)}
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
