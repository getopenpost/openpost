<script lang="ts">
	import { Slider } from '$lib/components/ui/slider';
	import { cn } from '$lib/utils';
	import ScrubField from './scrub-field.svelte';
	import { sliderValueFromPointer } from './slider-track-math';

	let {
		label,
		value,
		min = 0,
		max = 100,
		step = 1,
		precision = 2,
		resetValue,
		valueWidth,
		disabled = false,
		trackClass = '',
		rangeClass = '',
		class: className = '',
		onbegin,
		onValueChange,
		onValueCommit,
		onValueCancel
	}: {
		label: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		precision?: number;
		resetValue?: number;
		valueWidth?: string;
		disabled?: boolean;
		trackClass?: string;
		rangeClass?: string;
		class?: string;
		onbegin?: () => void;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
		onValueCancel?: () => void;
	} = $props();

	function reset(): void {
		if (disabled || resetValue === undefined) return;
		onbegin?.();
		onValueCommit?.(resetValue);
	}

	// Visual thumb width in px (the transparent hit area is larger). Kept in
	// sync with the shared Slider thumb visuals (md:size-3.5 / after:size-3.5).
	const TRACK_THUMB_WIDTH_PX = 14;

	let trackDrag: { pointerId: number; lastValue: number } | null = $state(null);

	function landFromClientX(container: HTMLElement, clientX: number): number | null {
		const track = container.querySelector('[data-slot="slider-track"]');
		if (!(track instanceof HTMLElement)) return null;
		const rect = track.getBoundingClientRect();
		return sliderValueFromPointer(
			{ clientX, trackLeft: rect.left, trackWidth: rect.width, thumbWidthPx: TRACK_THUMB_WIDTH_PX },
			{ min, max, step }
		);
	}

	function trackTarget(event: PointerEvent) {
		const container = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
		if (!container) return null;
		const target = event.target instanceof HTMLElement ? event.target : null;
		return { container, target };
	}

	function handleTrackPointerDown(event: PointerEvent): void {
		if (disabled || !event.isPrimary) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const resolved = trackTarget(event);
		if (!resolved) return;
		// Thumb drags stay on the shared Slider's native gesture.
		if (resolved.target?.closest?.('[data-slot="slider-thumb"]')) return;
		const container = resolved.container;
		const next = landFromClientX(container, event.clientX);
		if (next === null || !Number.isFinite(next)) return;
		event.preventDefault();
		event.stopPropagation();
		onbegin?.();
		onValueChange?.(next);
		try {
			container.setPointerCapture(event.pointerId);
		} catch {
			// Pointer capture is best-effort; the click still commits below.
		}
		trackDrag = { pointerId: event.pointerId, lastValue: next };
	}

	function handleTrackPointerMove(event: PointerEvent): void {
		if (!trackDrag || event.pointerId !== trackDrag.pointerId) return;
		const resolved = trackTarget(event);
		if (!resolved) return;
		const container = resolved.container;
		const next = landFromClientX(container, event.clientX);
		if (next === null || !Number.isFinite(next)) return;
		trackDrag.lastValue = next;
		onValueChange?.(next);
	}

	function handleTrackPointerUp(event: PointerEvent): void {
		if (!trackDrag || event.pointerId !== trackDrag.pointerId) return;
		const lastValue = trackDrag.lastValue;
		trackDrag = null;
		onValueCommit?.(lastValue);
	}

	function handleTrackPointerCancel(event: PointerEvent): void {
		if (!trackDrag || event.pointerId !== trackDrag.pointerId) return;
		trackDrag = null;
		onValueCancel?.();
	}
</script>

<div
	class={cn(
		'flex h-[var(--editor-22,22px)] items-center gap-1.5 [@media(pointer:coarse)]:h-auto [@media(pointer:coarse)]:min-h-11',
		className
	)}
	data-editor-slider-row
>
	<span class="min-w-0 flex-1 truncate text-[11px]" title={label}>{label}</span>
	<div
		role="group"
		aria-label={label}
		class="flex min-w-0 flex-2 touch-none items-center"
		ondblclick={reset}
		onpointerdown={handleTrackPointerDown}
		onpointermove={handleTrackPointerMove}
		onpointerup={handleTrackPointerUp}
		onpointercancel={handleTrackPointerCancel}
		title={label}
	>
		<Slider
			{value}
			{min}
			{max}
			{step}
			{disabled}
			ariaLabel={label}
			{onValueChange}
			{onValueCommit}
			{onValueCancel}
			{trackClass}
			{rangeClass}
			class="h-[var(--editor-22,22px)] md:h-[var(--editor-22,22px)] [@media(pointer:coarse)]:h-11"
		/>
	</div>
	<ScrubField
		ariaLabel={label}
		{value}
		{min}
		{max}
		{step}
		{precision}
		{valueWidth}
		{resetValue}
		{disabled}
		{onbegin}
		{onValueChange}
		{onValueCommit}
		{onValueCancel}
	/>
</div>
