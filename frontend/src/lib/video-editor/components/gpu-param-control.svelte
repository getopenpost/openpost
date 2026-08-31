<script lang="ts">
	import AppSelect from '$lib/components/app-select.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import type { GpuParamSchema, GpuParamValue } from '$lib/video-editor/effects/gpu/types';
	import { gpuOptionLabel, gpuParamLabel } from '$lib/video-editor/effects/gpu/i18n';
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import { m } from '$lib/paraglide/messages';

	let {
		param,
		value,
		effectLabel,
		oncommit,
		keyframe
	}: {
		param: GpuParamSchema;
		value: GpuParamValue | undefined;
		effectLabel: string;
		oncommit: (value: GpuParamValue) => void;
		keyframe?: {
			autoEnabled: boolean;
			hasTrack: boolean;
			atCurrentFrame: boolean;
			canKeyframe: boolean;
			onToggleAuto: () => void;
			onToggleKeyframe: () => void;
		};
	} = $props();

	let draftNumber = $state(0);
	let draftText = $state('');
	let draftColor = $state('');
	let editingNumber = $state(false);
	let editingText = $state(false);
	let editingColor = $state(false);

	const numericValue = $derived(
		Number.isFinite(Number(value ?? param.default))
			? Number(value ?? param.default)
			: Number(param.default)
	);
	const stringValue = $derived(String(value ?? param.default));
	const booleanValue = $derived((value ?? param.default) === true);
	const localizedParamLabel = $derived(gpuParamLabel(param));
	const localizedOptions = $derived(
		param.type === 'select'
			? param.options.map((option) => ({ ...option, label: gpuOptionLabel(option) }))
			: []
	);
	const keyframeLabel = $derived(`${effectLabel}: ${localizedParamLabel}`);

	$effect(() => {
		if (!editingNumber) draftNumber = numericValue;
	});

	$effect(() => {
		if (!editingText) draftText = stringValue;
	});

	$effect(() => {
		if (!editingColor) draftColor = stringValue;
	});

	function commitText(): void {
		editingText = false;
		oncommit(draftText);
	}

	function commitColor(): void {
		editingColor = false;
		oncommit(draftColor);
	}
</script>

{#snippet keyframeControls()}
	{#if keyframe}
		<button
			type="button"
			class={`size-6 shrink-0 rounded text-[10px] font-semibold hover:bg-[oklch(0.3_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] ${keyframe.autoEnabled ? 'bg-[oklch(0.66_0.14_45_/_0.2)] text-[oklch(0.78_0.14_45)]' : ''}`}
			aria-pressed={keyframe.autoEnabled}
			aria-label={keyframe.autoEnabled
				? m.video_editor_effects_auto_key_disable({ parameter: keyframeLabel })
				: m.video_editor_effects_auto_key_enable({ parameter: keyframeLabel })}
			title={keyframe.autoEnabled
				? m.video_editor_effects_auto_key_disable({ parameter: keyframeLabel })
				: m.video_editor_effects_auto_key_enable({ parameter: keyframeLabel })}
			onclick={keyframe.onToggleAuto}>A</button
		>
		<button
			type="button"
			class={`flex size-6 shrink-0 items-center justify-center rounded hover:bg-[oklch(0.3_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-35 ${keyframe.hasTrack ? 'text-[oklch(0.78_0.14_45)]' : ''}`}
			disabled={!keyframe.canKeyframe}
			aria-label={keyframe.atCurrentFrame
				? m.video_editor_effects_keyframe_remove({ parameter: keyframeLabel })
				: m.video_editor_effects_keyframe_add({ parameter: keyframeLabel })}
			title={keyframe.atCurrentFrame
				? m.video_editor_effects_keyframe_remove({ parameter: keyframeLabel })
				: m.video_editor_effects_keyframe_add({ parameter: keyframeLabel })}
			onclick={keyframe.onToggleKeyframe}
		>
			<DiamondIcon class={`size-2.5 ${keyframe.atCurrentFrame ? 'fill-current' : ''}`} />
		</button>
	{/if}
{/snippet}

{#if !param.type || param.type === 'number'}
	<label class="flex items-center gap-2 text-xs">
		<span class="w-20 shrink-0 truncate text-[oklch(0.65_0.015_55)]" title={localizedParamLabel}>
			{localizedParamLabel}
		</span>
		<Slider
			class="min-w-0 flex-1"
			min={param.min}
			max={param.max}
			step={param.step}
			value={draftNumber}
			ariaLabel={`${effectLabel}: ${localizedParamLabel}`}
			onValueChange={(next) => {
				editingNumber = true;
				draftNumber = next;
			}}
			onValueCommit={(next) => {
				editingNumber = false;
				draftNumber = next;
				oncommit(next);
			}}
		/>
		<output class="w-10 shrink-0 text-right text-[oklch(0.65_0.015_55)] tabular-nums">
			{draftNumber.toFixed(param.step < 0.1 ? 2 : param.step < 1 ? 1 : 0)}
		</output>
		{@render keyframeControls()}
	</label>
{:else if param.type === 'boolean'}
	<label class="flex min-h-8 items-center justify-between gap-2 text-xs">
		<span class="text-[oklch(0.65_0.015_55)]">{localizedParamLabel}</span>
		<Checkbox
			checked={booleanValue}
			aria-label={`${effectLabel}: ${localizedParamLabel}`}
			onCheckedChange={(checked) => oncommit(checked === true)}
		/>
	</label>
{:else if param.type === 'select'}
	<label class="flex items-center gap-2 text-xs">
		<span class="w-20 shrink-0 truncate text-[oklch(0.65_0.015_55)]" title={localizedParamLabel}>
			{localizedParamLabel}
		</span>
		<AppSelect
			class="h-8 min-w-0 flex-1 text-xs"
			value={stringValue}
			options={localizedOptions}
			ariaLabel={`${effectLabel}: ${localizedParamLabel}`}
			onValueChange={oncommit}
		/>
	</label>
{:else if param.type === 'color'}
	<div class="flex min-h-8 items-center gap-2 text-xs">
		<span class="w-20 shrink-0 truncate text-[oklch(0.65_0.015_55)]" title={localizedParamLabel}>
			{localizedParamLabel}
		</span>
		<Input
			type="color"
			class="h-7 w-10 cursor-pointer rounded border border-[oklch(0.32_0.015_55)] bg-transparent p-0.5"
			value={stringValue.slice(0, 7)}
			aria-label={`${effectLabel}: ${localizedParamLabel}`}
			onchange={(event) => {
				const alpha = stringValue.length === 9 ? stringValue.slice(7) : '';
				oncommit(`${event.currentTarget.value}${alpha}`);
			}}
		/>
		<Input
			class="h-7 min-w-0 flex-1 px-2 font-mono text-[10px]"
			value={draftColor}
			maxlength={9}
			spellcheck={false}
			aria-label={`${effectLabel}: ${localizedParamLabel} ${m.video_editor_gpu_color_hex()}`}
			onfocus={() => (editingColor = true)}
			oninput={(event) => (draftColor = event.currentTarget.value)}
			onblur={commitColor}
			onkeydown={(event) => {
				if (event.key === 'Enter') event.currentTarget.blur();
			}}
		/>
		{@render keyframeControls()}
	</div>
{:else if param.type === 'text'}
	<label class="flex flex-col gap-1 text-xs">
		<span class="text-[oklch(0.65_0.015_55)]">{localizedParamLabel}</span>
		<Input
			class="h-8 text-xs"
			value={draftText}
			maxlength={param.maxLength}
			aria-label={`${effectLabel}: ${localizedParamLabel}`}
			onfocus={() => (editingText = true)}
			oninput={(event) => (draftText = event.currentTarget.value)}
			onblur={commitText}
			onkeydown={(event) => {
				if (event.key === 'Enter') event.currentTarget.blur();
			}}
		/>
	</label>
{/if}
