<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import ColorPicker from '$lib/components/color-picker.svelte';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import type {
		TimelineItem,
		KeyframeProperty,
		BackgroundPatternKind
	} from '$lib/video-editor/project/types';
	import {
		setBackground,
		updateBackground,
		updateBackgroundBackgroundColor,
		updateBackgroundColors,
		updateBackgroundDensity,
		updateBackgroundForeground,
		updateBackgroundForegroundOpacity,
		updateBackgroundOffsetX,
		updateBackgroundOffsetY,
		updateBackgroundPatternKind,
		updateBackgroundRotation,
		updateBackgroundScale,
		updateBackgroundSmoothness
	} from '$lib/video-editor/timeline/actions/backgrounds';
	import ShaderBackgroundControls from './shader-background-controls.svelte';
	import { backgroundPresetLabel as presetLabel } from '../backgrounds/labels';
	import { BACKGROUND_PRESETS } from '$lib/video-editor/backgrounds/presets';
	import { clampBackground } from '../backgrounds/types';
	import { shaderBackgroundSupport } from '../backgrounds/shader-support.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedProperty } from '$lib/video-editor/timeline/actions/keyframes';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();
	const bg = $derived(item.background!);
	onMount(() => {
		shaderBackgroundSupport.check();
	});

	function commitKeyframeOr(
		keyframeProp: KeyframeProperty | undefined,
		value: number,
		fallback: () => void
	): void {
		if (keyframeProp && autoKeyframeStore.isEnabled(item.id, keyframeProp)) {
			setAnimatedProperty(item.id, keyframeProp, timelineStore.currentFrame, value, true);
			onedit();
			return;
		}
		fallback();
		onedit();
	}

	function applyPreset(id: string): void {
		const preset = BACKGROUND_PRESETS.find((p) => p.id === id);
		if (!preset) return;
		if (preset.background.kind === 'shader' && !shaderBackgroundSupport.check()) return;
		setBackground(item.id, preset.background);
		onedit();
	}
</script>

<section
	class="flex flex-col gap-3 rounded-[10px] border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-2.5"
	aria-label={m.video_editor_background_inspector()}
>
	<h3 class="text-[10px] font-semibold tracking-wider text-[var(--video-editor-muted)] uppercase">
		{m.video_editor_backgrounds_title()}
	</h3>

	<AppSelect
		value={BACKGROUND_PRESETS.find(
			(preset) =>
				JSON.stringify(clampBackground(preset.background)) === JSON.stringify(clampBackground(bg))
		)?.id ?? ''}
		placeholder={m.video_editor_gpu_option_custom()}
		options={BACKGROUND_PRESETS.map((preset) => ({
			value: preset.id,
			label: presetLabel(preset.id),
			disabled: preset.background.kind === 'shader' && !shaderBackgroundSupport.available
		}))}
		ariaLabel={m.video_editor_background_preset()}
		onValueChange={applyPreset}
	/>

	{#if bg.kind === 'shader'}
		<ShaderBackgroundControls
			background={bg}
			onchange={(patch) => {
				updateBackground(item.id, patch);
				onedit();
			}}
		/>
	{:else if bg.kind === 'mesh-gradient'}
		<div class="grid grid-cols-2 gap-1.5 max-[360px]:grid-cols-1">
			{#each [0, 1, 2, 3] as idx (idx)}
				<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
					{m.video_editor_background_color_label({ index: idx + 1 })}
					<ColorPicker
						value={bg.colors[idx] ?? '#000000'}
						label={m.video_editor_background_color_label({ index: idx + 1 })}
						live={false}
						onChange={(value) => {
							const next: [string, string, string, string] = [
								bg.colors[0] ?? '#000000',
								bg.colors[1] ?? '#000000',
								bg.colors[2] ?? '#000000',
								bg.colors[3] ?? '#000000'
							];
							next[idx] = value;
							updateBackgroundColors(item.id, next);
							onedit();
						}}
					/>
				</label>
			{/each}
		</div>

		<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
			<span class="flex justify-between"
				><span>{m.video_editor_background_smoothness()}</span><span class="tabular-nums"
					>{bg.smoothness.toFixed(2)}</span
				></span
			>
			<Slider
				value={bg.smoothness}
				min={0}
				max={1}
				step={0.01}
				ariaLabel={m.video_editor_background_smoothness()}
				onValueCommit={(v) =>
					commitKeyframeOr('backgroundSmoothness', v, () => updateBackgroundSmoothness(item.id, v))}
			/>
		</label>
	{:else}
		<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
			{m.video_editor_background_pattern_kind()}
			<AppSelect
				class="mt-0.5 h-8 w-full text-xs"
				value={bg.pattern}
				options={[
					{ value: 'dots', label: m.video_editor_background_pattern_dots() },
					{ value: 'grid', label: m.video_editor_background_pattern_grid() },
					{
						value: 'stripes',
						label: m.video_editor_background_pattern_stripes()
					},
					{
						value: 'checker',
						label: m.video_editor_background_pattern_checker()
					}
				]}
				ariaLabel={m.video_editor_background_pattern_kind()}
				onValueChange={(v) => {
					if (v === 'dots' || v === 'grid' || v === 'stripes' || v === 'checker') {
						updateBackgroundPatternKind(item.id, v);
						onedit();
					}
				}}
			/>
		</label>
		<div class="grid grid-cols-2 gap-1.5 max-[360px]:grid-cols-1">
			<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
				{m.video_editor_background_foreground()}
				<ColorPicker
					value={bg.foreground}
					label={m.video_editor_background_foreground()}
					live={false}
					onChange={(value) => {
						updateBackgroundForeground(item.id, value);
						onedit();
					}}
				/>
			</label>
			<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
				{m.video_editor_background_background_color()}
				<ColorPicker
					value={bg.background}
					label={m.video_editor_background_background_color()}
					live={false}
					onChange={(value) => {
						updateBackgroundBackgroundColor(item.id, value);
						onedit();
					}}
				/>
			</label>
		</div>

		<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
			<span class="flex justify-between"
				><span>{m.video_editor_background_density()}</span><span class="tabular-nums"
					>{bg.density.toFixed(2)}</span
				></span
			>
			<Slider
				value={bg.density}
				min={0.05}
				max={1}
				step={0.01}
				ariaLabel={m.video_editor_background_density()}
				onValueCommit={(v) =>
					commitKeyframeOr('backgroundDensity', v, () => updateBackgroundDensity(item.id, v))}
			/>
		</label>
		<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
			<span class="flex justify-between"
				><span>{m.video_editor_background_fg_opacity()}</span><span class="tabular-nums"
					>{Math.round(bg.foregroundOpacity * 100)}%</span
				></span
			>
			<Slider
				value={bg.foregroundOpacity}
				min={0}
				max={1}
				step={0.01}
				ariaLabel={m.video_editor_background_fg_opacity()}
				onValueCommit={(v) =>
					commitKeyframeOr('backgroundForegroundOpacity', v, () =>
						updateBackgroundForegroundOpacity(item.id, v)
					)}
			/>
		</label>
	{/if}

	<div class="grid grid-cols-2 gap-1.5 max-[360px]:grid-cols-1">
		<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
			<span class="flex justify-between"
				><span>{m.video_editor_background_rotation()}</span><span class="tabular-nums"
					>{Math.round(bg.rotation)}°</span
				></span
			>
			<Slider
				value={bg.rotation}
				min={-180}
				max={180}
				step={1}
				ariaLabel={m.video_editor_background_rotation()}
				onValueCommit={(v) =>
					commitKeyframeOr('backgroundRotation', v, () => updateBackgroundRotation(item.id, v))}
			/>
		</label>
		<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
			<span class="flex justify-between"
				><span>{m.video_editor_background_scale()}</span><span class="tabular-nums"
					>{bg.scale.toFixed(2)}×</span
				></span
			>
			<Slider
				value={bg.scale}
				min={0.25}
				max={4}
				step={0.01}
				ariaLabel={m.video_editor_background_scale()}
				onValueCommit={(v) =>
					commitKeyframeOr('backgroundScale', v, () => updateBackgroundScale(item.id, v))}
			/>
		</label>
	</div>

	<div class="grid grid-cols-2 gap-1.5 max-[360px]:grid-cols-1">
		<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
			<span class="flex justify-between"
				><span>{m.video_editor_background_offset_x()}</span><span class="tabular-nums"
					>{bg.offsetX.toFixed(2)}</span
				></span
			>
			<Slider
				value={bg.offsetX}
				min={-0.5}
				max={0.5}
				step={0.01}
				ariaLabel={m.video_editor_background_offset_x()}
				onValueCommit={(v) =>
					commitKeyframeOr('backgroundOffsetX', v, () => updateBackgroundOffsetX(item.id, v))}
			/>
		</label>
		<label class="flex flex-col gap-1 text-[10px] text-[var(--video-editor-muted)]">
			<span class="flex justify-between"
				><span>{m.video_editor_background_offset_y()}</span><span class="tabular-nums"
					>{bg.offsetY.toFixed(2)}</span
				></span
			>
			<Slider
				value={bg.offsetY}
				min={-0.5}
				max={0.5}
				step={0.01}
				ariaLabel={m.video_editor_background_offset_y()}
				onValueCommit={(v) =>
					commitKeyframeOr('backgroundOffsetY', v, () => updateBackgroundOffsetY(item.id, v))}
			/>
		</label>
	</div>

	{#if bg.kind !== 'shader'}
		<p class="text-[10px] leading-4 text-[var(--video-editor-muted)]">
			{m.video_editor_background_hint()}
		</p>
	{/if}
</section>
