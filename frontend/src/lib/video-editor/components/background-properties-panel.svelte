<!-- Compact, responsive, accessible background inspector using shared primitives. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { Button } from '$lib/components/ui/button';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Label } from '$lib/components/ui/label';
	import type {
		TimelineItem,
		KeyframeProperty,
		BackgroundPatternKind
	} from '$lib/video-editor/project/types';
	import {
		setBackground,
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
	import { BACKGROUND_PRESETS } from '$lib/video-editor/backgrounds/presets';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedProperty } from '$lib/video-editor/timeline/actions/keyframes';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();
	const bg = $derived(item.background!);

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

	function presetLabel(id: string): string {
		switch (id) {
			case 'mesh-sunset':
				return m.video_editor_background_preset_mesh_sunset();
			case 'mesh-ocean':
				return m.video_editor_background_preset_mesh_ocean();
			case 'mesh-forest':
				return m.video_editor_background_preset_mesh_forest();
			case 'mesh-neon':
				return m.video_editor_background_preset_mesh_neon();
			case 'pattern-dots':
				return m.video_editor_background_preset_pattern_dots();
			case 'pattern-grid':
				return m.video_editor_background_preset_pattern_grid();
			case 'pattern-stripes':
				return m.video_editor_background_preset_pattern_stripes();
			case 'pattern-checker':
				return m.video_editor_background_preset_pattern_checker();
			default:
				return id;
		}
	}

	function applyPreset(id: string): void {
		const preset = BACKGROUND_PRESETS.find((p) => p.id === id);
		if (!preset) return;
		setBackground(item.id, preset.background);
		onedit();
	}
</script>

<section
	class="flex flex-col gap-3 rounded-[10px] border border-[oklch(0.25_0.015_55)] bg-[oklch(0.2_0.01_50)] p-2.5"
	aria-label={m.video_editor_background_inspector()}
>
	<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_backgrounds_title()}
	</h3>

	<div class="flex flex-col gap-1.5">
		<Label class="text-[10px] text-[oklch(0.7_0.01_55)]" for="bg-preset"
			>{m.video_editor_background_preset()}</Label
		>
		<div
			class="grid grid-cols-4 gap-1.5 max-[360px]:grid-cols-2"
			role="group"
			aria-label={m.video_editor_background_preset()}
			id="bg-preset"
		>
			{#each BACKGROUND_PRESETS as preset (preset.id)}
				<Button
					variant="outline"
					size="sm"
					class="h-14 flex-col gap-0.5 truncate px-1 text-[10px] leading-3"
					aria-label={presetLabel(preset.id)}
					onclick={() => applyPreset(preset.id)}
				>
					<span
						aria-hidden="true"
						class="h-6 w-full rounded-sm border border-white/10"
						style:background={preset.background.kind === 'mesh-gradient'
							? `linear-gradient(135deg, ${preset.background.colors[0]}, ${preset.background.colors[1]}, ${preset.background.colors[2]}, ${preset.background.colors[3]})`
							: preset.background.background}
					></span>
					<span class="truncate">{presetLabel(preset.id)}</span>
				</Button>
			{/each}
		</div>
	</div>

	<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
		{m.video_editor_background_kind()}
		<AppSelect
			class="mt-0.5 h-8 w-full text-xs"
			value={bg.kind}
			options={[
				{ value: 'mesh-gradient', label: m.video_editor_background_kind_mesh() },
				{ value: 'pattern', label: m.video_editor_background_kind_pattern() }
			]}
			ariaLabel={m.video_editor_background_kind()}
			onValueChange={(value) => {
				if (value === 'mesh-gradient' && bg.kind !== 'mesh-gradient') {
					setBackground(item.id, {
						kind: 'mesh-gradient',
						colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
						smoothness: 0.55,
						rotation: bg.rotation ?? 0,
						scale: bg.scale ?? 1,
						offsetX: bg.offsetX ?? 0,
						offsetY: bg.offsetY ?? 0
					});
					onedit();
				} else if (value === 'pattern' && bg.kind !== 'pattern') {
					setBackground(item.id, {
						kind: 'pattern',
						pattern: 'dots',
						foreground: '#ff7a18',
						background: '#0f0f0f',
						scale: 1,
						rotation: bg.rotation ?? 0,
						offsetX: bg.offsetX ?? 0,
						offsetY: bg.offsetY ?? 0,
						density: 0.5,
						foregroundOpacity: 1
					});
					onedit();
				}
			}}
		/>
	</label>

	{#if bg.kind === 'mesh-gradient'}
		<div class="grid grid-cols-2 gap-1.5 max-[360px]:grid-cols-1">
			{#each [0, 1, 2, 3] as idx (idx)}
				<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_background_color_label({ index: idx + 1 })}
					<Input
						type="color"
						class="h-8 w-full rounded bg-transparent"
						value={bg.colors[idx] ?? '#000000'}
						aria-label={m.video_editor_background_color_label({ index: idx + 1 })}
						onchange={(e) => {
							const next: [string, string, string, string] = [
								bg.colors[0] ?? '#000000',
								bg.colors[1] ?? '#000000',
								bg.colors[2] ?? '#000000',
								bg.colors[3] ?? '#000000'
							];
							next[idx] = e.currentTarget.value;
							updateBackgroundColors(item.id, next);
							onedit();
						}}
					/>
				</label>
			{/each}
		</div>

		<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
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
		<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_background_pattern_kind()}
			<AppSelect
				class="mt-0.5 h-8 w-full text-xs"
				value={bg.pattern}
				options={[
					{ value: 'dots', label: m.video_editor_background_pattern_dots() },
					{ value: 'grid', label: m.video_editor_background_pattern_grid() },
					{ value: 'stripes', label: m.video_editor_background_pattern_stripes() },
					{ value: 'checker', label: m.video_editor_background_pattern_checker() }
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
			<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_background_foreground()}
				<Input
					type="color"
					class="h-8 w-full rounded bg-transparent"
					value={bg.foreground}
					aria-label={m.video_editor_background_foreground()}
					onchange={(e) => {
						updateBackgroundForeground(item.id, e.currentTarget.value);
						onedit();
					}}
				/>
			</label>
			<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_background_background_color()}
				<Input
					type="color"
					class="h-8 w-full rounded bg-transparent"
					value={bg.background}
					aria-label={m.video_editor_background_background_color()}
					onchange={(e) => {
						updateBackgroundBackgroundColor(item.id, e.currentTarget.value);
						onedit();
					}}
				/>
			</label>
		</div>

		<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
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
		<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
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
		<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
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
		<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
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
		<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
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
		<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.7_0.01_55)]">
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

	<p class="text-[10px] leading-4 text-[oklch(0.65_0.015_55)]">
		{m.video_editor_background_hint()}
	</p>
</section>
