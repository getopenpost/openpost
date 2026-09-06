<script lang="ts">
	import { Slider } from '$lib/components/ui/slider';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import EditorScrubbableNumberInput from './editor-scrubbable-number-input.svelte';

	let {
		label,
		value,
		min,
		max,
		step,
		defaultValue = 0,
		displayScale = 1,
		decimals = 2,
		mixedLabel,
		resetLabel,
		disabled = false,
		onbegin,
		onpreview,
		oncommit,
		oncancel
	}: {
		label: string;
		value: number | null;
		min: number;
		max: number;
		step: number;
		defaultValue?: number;
		displayScale?: number;
		decimals?: number;
		mixedLabel: string;
		resetLabel: string;
		disabled?: boolean;
		onbegin?: () => void;
		onpreview: (value: number) => void;
		oncommit: (value: number) => void;
		oncancel?: () => void;
	} = $props();

	const displayValue = $derived(value === null ? null : value * displayScale);
	const displayStep = $derived(step * displayScale);

	function previewDisplay(next: number): void {
		onpreview(next / displayScale);
	}

	function commitDisplay(next: number): void {
		oncommit(next / displayScale);
	}
</script>

<div class="grid gap-1" data-editor-color-control>
	<div class="flex min-w-0 items-center gap-2">
		<span class="min-w-0 flex-1 truncate text-xs font-medium" title={label}>{label}</span>
		<EditorScrubbableNumberInput
			ariaLabel={label}
			value={displayValue}
			min={min * displayScale}
			max={max * displayScale}
			step={displayStep}
			{decimals}
			placeholder={mixedLabel}
			{disabled}
			class="h-8 w-16 px-1.5 text-right text-xs tabular-nums [@media(pointer:coarse)]:h-11"
			{onbegin}
			onlive={previewDisplay}
			oncommit={commitDisplay}
			{oncancel}
		/>
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			class="shrink-0 [@media(pointer:coarse)]:size-11"
			disabled={disabled || value === defaultValue}
			aria-label={`${resetLabel}: ${label}`}
			title={`${resetLabel}: ${label}`}
			onclick={() => oncommit(defaultValue)}
		>
			<ThemeIcon role="undo" />
		</Button>
	</div>
	<Slider
		{min}
		{max}
		{step}
		value={value ?? defaultValue}
		{disabled}
		ariaLabel={label}
		onValueChange={(next) => {
			onbegin?.();
			onpreview(next);
		}}
		onValueCommit={oncommit}
		onValueCancel={oncancel}
	/>
</div>
