<script lang="ts">
	import { Slider } from '$lib/components/ui/slider';
	import { cn } from '$lib/utils';
	import ScrubField from './scrub-field.svelte';

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
</script>

<div
	class={cn('flex h-[var(--editor-22,22px)] items-center gap-1.5', className)}
	data-editor-slider-row
>
	<span class="min-w-0 flex-1 truncate text-[11px]" title={label}>{label}</span>
	<div
		role="group"
		aria-label={label}
		class="flex min-w-0 flex-2 items-center"
		ondblclick={reset}
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
			class="h-[var(--editor-22,22px)] md:h-[var(--editor-22,22px)]"
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
