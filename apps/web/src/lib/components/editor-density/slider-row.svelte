<script lang="ts">
	import { Slider } from '$lib/components/ui/slider';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { cn } from '$lib/utils';
	import ScrubField from './scrub-field.svelte';
	import { sliderValueFromPointer } from './slider-track-math';
	import { formatFixed } from './scrub-math';

	let {
		label,
		showLabel = true,
		value,
		min = 0,
		max = 100,
		step = 1,
		precision = 2,
		displayScale = 1,
		suffix = '',
		resetValue,
		resetLabel,
		valueWidth,
		placeholder = '',
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
		showLabel?: boolean;
		/** Numeric model value; null renders `placeholder` (mixed selection). */
		value: number | null;
		min?: number;
		max?: number;
		step?: number;
		precision?: number;
		/**
		 * Multiplies the value for display only (e.g. 100 shows 0-1 values as
		 * 0-100 in the field and thumb announcements). Scrub-field edits are
		 * divided back before `onValueChange`/`onValueCommit` fire, which stay
		 * in model units, like the slider track.
		 */
		displayScale?: number;
		/** Unit shown after the field value; display-only, never parsed. */
		suffix?: string;
		resetValue?: number;
		/** Shows a reset button committing `resetValue` when provided. */
		resetLabel?: string;
		valueWidth?: string;
		/** Field placeholder, shown while `value` is null (mixed selection). */
		placeholder?: string;
		disabled?: boolean;
		trackClass?: string;
		rangeClass?: string;
		class?: string;
		onbegin?: () => void;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
		onValueCancel?: () => void;
	} = $props();

	// The slider track always works in model units; a mixed (null) value parks
	// the thumb at the reset value so the track still points somewhere stable.
	const sliderValue = $derived(value ?? resetValue ?? min);
	const thumbValueText = $derived(
		displayScale !== 1 || suffix !== ''
			? `${formatFixed(sliderValue * displayScale, precision)}${suffix !== '' ? ` ${suffix}` : ''}`
			: undefined
	);

	function scrubChange(next: number): void {
		onValueChange?.(next / displayScale);
	}

	function scrubCommit(next: number): void {
		onValueCommit?.(next / displayScale);
	}

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
	{#if showLabel}<span class="min-w-0 flex-1 truncate text-[11px]" title={label}>{label}</span>{/if}
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
			value={sliderValue}
			{min}
			{max}
			{step}
			{disabled}
			ariaLabel={label}
			ariaValueText={thumbValueText}
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
		value={value === null ? null : value * displayScale}
		min={min * displayScale}
		max={max * displayScale}
		step={step * displayScale}
		{precision}
		{suffix}
		{valueWidth}
		{placeholder}
		resetValue={resetValue === undefined ? undefined : resetValue * displayScale}
		{disabled}
		{onbegin}
		onValueChange={scrubChange}
		onValueCommit={scrubCommit}
		{onValueCancel}
	/>
	{#if resetLabel !== undefined && resetValue !== undefined}
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			class="shrink-0 [@media(pointer:coarse)]:size-11"
			disabled={disabled || value === resetValue}
			aria-label={`${resetLabel}: ${label}`}
			title={`${resetLabel}: ${label}`}
			onclick={reset}
		>
			<ThemeIcon role="undo" />
		</Button>
	{/if}
</div>
