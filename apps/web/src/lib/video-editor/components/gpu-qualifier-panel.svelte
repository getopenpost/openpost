<!--
	Bespoke secondary-qualifier pane: hue-band strip plus grouped Key / Matte /
	Correction rows. Ported from FreeCut (MIT) `GpuSecondaryQualifierPanel`;
	row controls reuse GpuParamControl so keyframe toggles behave like the
	generic stack rows. Drafts preview live; commits are one undo step.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import type {
		GpuParamSchema,
		GpuParamValue,
		GpuShaderDefinition
	} from '$lib/video-editor/effects/gpu/types';
	import { gpuParamLabel } from '$lib/video-editor/effects/gpu/i18n';
	import { readNumber, type GpuParamValues } from '$lib/video-editor/effects/gpu/types';
	import GpuHueBandControl from './gpu-hue-band-control.svelte';
	import GpuParamControl from './gpu-param-control.svelte';

	const HUE_KEYS = ['hueCenter', 'hueWidth', 'hueSoftness'] as const;
	const MATTE_KEYS = [
		'satLow',
		'satHigh',
		'satSoftness',
		'lumaLow',
		'lumaHigh',
		'lumaSoftness'
	] as const;
	const CORRECTION_KEYS = ['exposure', 'saturation', 'temperature', 'tint', 'strength'] as const;

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

	function numberValue(name: string, fallback: number): number {
		return readNumber(values, name, fallback);
	}

	function schemaFor(name: string): GpuParamSchema | undefined {
		return schemaByName.get(name);
	}

	function toggleBoolean(name: string): void {
		if (disabled) return;
		oncommit(name, values[name] !== true);
	}
</script>

<div
	class="pt-1 pb-1 text-[10px] font-medium tracking-wide text-[var(--video-editor-muted)] uppercase"
>
	{m.video_editor_qualifier_key()}
</div>
<div class="pb-1" class:opacity-50={disabled}>
	<GpuHueBandControl
		center={numberValue('hueCenter', 0)}
		width={numberValue('hueWidth', 35)}
		softness={numberValue('hueSoftness', 20)}
		{disabled}
		label={`${effectLabel}: ${m.video_editor_qualifier_hue_band()}`}
		onlive={(next) => ondraft({ hueCenter: next })}
		oncommit={(next) => {
			ondraft(null);
			oncommit('hueCenter', next);
		}}
	/>
</div>
{#each HUE_KEYS as name (name)}
	{@const param = schemaFor(name)}
	{#if param}
		<GpuParamControl
			{param}
			value={values[name]}
			{effectLabel}
			oncommit={(value) => oncommit(name, value)}
			keyframe={keyframe(name)}
		/>
	{/if}
{/each}

<div
	class="pt-2 pb-1 text-[10px] font-medium tracking-wide text-[var(--video-editor-muted)] uppercase"
>
	{m.video_editor_qualifier_matte()}
</div>
<div class="flex gap-1 pb-1">
	{#each ['showMask', 'invertMask'] as name (name)}
		{@const param = schemaFor(name)}
		{@const active = values[name] === true}
		{@const label = param ? gpuParamLabel(param) : name}
		<button
			type="button"
			class="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded border border-[var(--video-editor-border)] px-2 text-xs focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:opacity-40 {active
				? 'bg-[var(--video-editor-primary)] text-[var(--video-editor-primary-text)]'
				: 'hover:bg-[var(--video-editor-control-hover)]'}"
			{disabled}
			aria-pressed={active}
			title={label}
			onclick={() => toggleBoolean(name)}
		>
			{#if name === 'showMask'}
				{#if active}<ThemeIcon role="eye" class="size-3" />{:else}<ThemeIcon
						role="eye-off"
						class="size-3"
					/>{/if}
			{/if}
			<span class="truncate">{label}</span>
		</button>
	{/each}
</div>
{#each MATTE_KEYS as name (name)}
	{@const param = schemaFor(name)}
	{#if param}
		<GpuParamControl
			{param}
			value={values[name]}
			{effectLabel}
			oncommit={(value) => oncommit(name, value)}
			keyframe={keyframe(name)}
		/>
	{/if}
{/each}

<div
	class="pt-2 pb-1 text-[10px] font-medium tracking-wide text-[var(--video-editor-muted)] uppercase"
>
	{m.video_editor_qualifier_correction()}
</div>
{#each CORRECTION_KEYS as name (name)}
	{@const param = schemaFor(name)}
	{#if param}
		<GpuParamControl
			{param}
			value={values[name]}
			{effectLabel}
			oncommit={(value) => oncommit(name, value)}
			keyframe={keyframe(name)}
		/>
	{/if}
{/each}
