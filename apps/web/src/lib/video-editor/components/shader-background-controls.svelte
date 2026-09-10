<script lang="ts">
	import PaperBackgroundControls from './paper-background-controls.svelte';
	import ColorPicker from '$lib/components/color-picker.svelte';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import type { ShaderBackground } from '../project/types';
	import { shaderColorCount } from '../backgrounds/shaders';

	let {
		background,
		onchange
	}: {
		background: ShaderBackground;
		onchange: (patch: Partial<ShaderBackground>) => void;
	} = $props();
	let detailLabel = $derived(
		background.shader === 'mesh'
			? m.video_editor_gpu_param_distortion()
			: background.shader === 'swirl'
				? m.video_editor_shader_twist()
				: background.shader === 'clouds'
					? m.video_editor_property_softness()
					: m.video_editor_effects_brightness()
	);
</script>

{#if background.shader.startsWith('paper:')}
	<PaperBackgroundControls {background} {onchange} />
{:else}
	<div class="grid grid-cols-2 gap-2">
		{#each background.colors.slice(0, shaderColorCount(background.shader)) as color, index (index)}
			<ColorPicker
				value={color}
				label={m.video_editor_background_color_label({ index: index + 1 })}
				live={false}
				onChange={(value) => {
					const colors: ShaderBackground['colors'] = [...background.colors];
					colors[index] = value;
					onchange({ colors });
				}}
			/>
		{/each}
	</div>

	{#each [{ key: 'speed', label: m.video_editor_lottie_speed(), value: background.speed, max: 3, step: 0.05 }, { key: 'phase', label: m.video_editor_shader_phase(), value: background.phase, max: 60, step: 0.1 }, { key: 'detail', label: detailLabel, value: background.detail, max: 1, step: 0.01 }] as control (control.key)}
		<div class="space-y-2">
			<div class="flex justify-between gap-2 text-xs">
				<span>{control.label}</span>
				<span class="text-muted-foreground tabular-nums">{control.value.toFixed(2)}</span>
			</div>
			<Slider
				value={control.value}
				min={0}
				max={control.max}
				step={control.step}
				ariaLabel={control.label}
				onValueCommit={(value) => onchange({ [control.key]: value })}
			/>
		</div>
	{/each}
	<p class="text-xs leading-relaxed text-muted-foreground">
		{m.video_editor_shader_still_hint()}
	</p>
{/if}
