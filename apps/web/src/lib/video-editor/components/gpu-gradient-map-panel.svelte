<!--
	Bespoke gradient-map pane: palette select, live gradient preview bar, custom
	stop list with color pickers plus add/remove, and the mix slider. Ported
	from FreeCut (MIT) `GpuGradientMapPanel`. Stop edits draft live and commit
	one undoable update; the stop list never drops below two entries.
-->
<script lang="ts">
	import AppSelect from '$lib/components/app-select.svelte';
	import ColorPicker from '$lib/components/color-picker.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { GpuParamValue, GpuShaderDefinition } from '$lib/video-editor/effects/gpu/types';
	import { gpuOptionLabel, gpuParamLabel } from '$lib/video-editor/effects/gpu/i18n';
	import {
		customStopsList,
		resolveGradientPreviewHexes,
		serializeGradientStops
	} from '$lib/video-editor/effects/gradient-stops';
	import { readString, type GpuParamValues } from '$lib/video-editor/effects/gpu/types';
	import GpuParamControl from './gpu-param-control.svelte';

	let {
		effectLabel,
		definition,
		values,
		disabled = false,
		oncommit,
		ondraft,
		keyframe
	}: {
		effectLabel: string;
		definition: GpuShaderDefinition;
		values: GpuParamValues;
		disabled?: boolean;
		oncommit: (paramName: string, value: GpuParamValue) => void;
		ondraft: (params: GpuParamValues | null) => void;
		keyframe: (paramName: string) =>
			| {
					autoEnabled: boolean;
					hasTrack: boolean;
					atCurrentFrame: boolean;
					canKeyframe: boolean;
					onToggleAuto: () => void;
					onToggleKeyframe: () => void;
			  }
			| undefined;
	} = $props();

	const schemaByName = $derived(new Map(definition.schema.map((param) => [param.name, param])));
	const presetParam = $derived(schemaByName.get('preset'));
	const mixParam = $derived(schemaByName.get('mix'));
	const stopsParam = $derived(schemaByName.get('customStops'));
	const preset = $derived(readString(values, 'preset', String(presetParam?.default ?? 'inferno')));
	const stops = $derived(customStopsList(values));
	const previewHexes = $derived(
		resolveGradientPreviewHexes(preset, readString(values, 'customStops', ''))
	);
	const presetOptions = $derived(
		presetParam?.type === 'select'
			? presetParam.options.map((option) => ({ ...option, label: gpuOptionLabel(option) }))
			: []
	);
	const stopsLabel = $derived(stopsParam ? gpuParamLabel(stopsParam) : 'Custom Stops');

	function commitStops(next: string[]): void {
		ondraft(null);
		oncommit('customStops', serializeGradientStops(next));
	}

	function draftStops(next: string[]): void {
		ondraft({ customStops: serializeGradientStops(next) });
	}

	function setStop(index: number, hex: string): void {
		const next = [...stops];
		next[index] = hex;
		commitStops(next);
	}

	function liveStop(index: number, hex: string): void {
		const next = [...stops];
		next[index] = hex;
		draftStops(next);
	}

	function addStop(): void {
		if (disabled) return;
		commitStops([...stops, stops[stops.length - 1] ?? '#ffffff']);
	}

	function removeStop(index: number): void {
		if (disabled || stops.length <= 2) return;
		commitStops(stops.filter((_, stopIndex) => stopIndex !== index));
	}
</script>

{#if presetParam}
	<label class="flex items-center gap-2 text-xs" class:opacity-50={disabled}>
		<span
			class="w-20 shrink-0 truncate text-[var(--video-editor-muted)]"
			title={gpuParamLabel(presetParam)}
		>
			{gpuParamLabel(presetParam)}
		</span>
		<AppSelect
			class="h-8 min-w-0 flex-1 text-xs"
			value={preset}
			options={presetOptions}
			ariaLabel={`${effectLabel}: ${gpuParamLabel(presetParam)}`}
			onValueChange={(value) => oncommit('preset', value)}
		/>
	</label>
{/if}

<div class="pb-1" aria-hidden="true">
	<div
		class="h-3 w-full rounded-sm border border-[var(--video-editor-border)]"
		style:background={`linear-gradient(to right, ${previewHexes.join(', ')})`}
	></div>
</div>

{#if preset === 'custom'}
	{#each stops as hex, index (index)}
		<div class="flex min-h-8 items-center gap-2 text-xs" class:opacity-50={disabled}>
			<span class="w-20 shrink-0 truncate text-[var(--video-editor-muted)]">
				{stopsLabel}
				{index + 1}
			</span>
			<ColorPicker
				label={`${effectLabel}: ${stopsLabel} ${index + 1}`}
				value={hex.slice(0, 7)}
				variant="swatch"
				{disabled}
				onChange={(next) => liveStop(index, next)}
				onCommit={(next) => setStop(index, next)}
			/>
			<button
				type="button"
				class="flex size-6 shrink-0 items-center justify-center rounded hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:opacity-35"
				disabled={disabled || stops.length <= 2}
				aria-label={m.video_editor_gradient_remove_stop()}
				title={m.video_editor_gradient_remove_stop()}
				onclick={() => removeStop(index)}
			>
				<ThemeIcon role="delete" class="size-3" />
			</button>
		</div>
	{/each}
	<div class="flex items-center gap-1 py-1">
		<button
			type="button"
			class="flex h-6 min-w-0 flex-1 items-center justify-center gap-1.5 rounded border border-[var(--video-editor-border)] text-xs hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:opacity-40"
			{disabled}
			onclick={addStop}
		>
			<ThemeIcon role="add" class="size-3" />
			{m.video_editor_gradient_add_stop()}
		</button>
	</div>
{/if}

{#if mixParam}
	<GpuParamControl
		param={mixParam}
		value={values.mix}
		{effectLabel}
		oncommit={(value) => oncommit('mix', value)}
		keyframe={keyframe('mix')}
	/>
{/if}
