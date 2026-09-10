<script lang="ts">
	import type { ShaderBackground } from '../project/types';
	import { getPaperShader, paperControls } from '../effects/paper/catalog';
	import type { GpuParamSchema } from '../effects/gpu/types';
	import GpuParamControl from './gpu-param-control.svelte';
	import { paperLabel } from '../effects/paper/i18n';
	import { m } from '$lib/paraglide/messages';

	let {
		background,
		onchange
	}: { background: ShaderBackground; onchange: (patch: Partial<ShaderBackground>) => void } =
		$props();
	const shader = $derived(getPaperShader(background.shader.slice(6))!);
	const controls = $derived(paperControls(shader));
	const motion: readonly GpuParamSchema[] = [
		{ name: 'speed', label: 'Speed', min: 0, max: 3, step: 0.05, default: 0.5 },
		{ name: 'phase', label: 'Starting phase', min: 0, max: 60, step: 0.1, default: 0 }
	];
</script>

{#if shader.animated}
	{#each motion as control (control.name)}
		<GpuParamControl
			param={control}
			value={control.name === 'speed' ? background.speed : background.phase}
			effectLabel={paperLabel(shader.label)}
			oncommit={(value) => onchange({ [control.name]: value })}
		/>
	{/each}
	<p class="text-xs leading-relaxed text-muted-foreground">{m.video_editor_shader_still_hint()}</p>
{/if}

{#each controls as control (control.name)}
	{#if !control.visibleWhen || control.visibleWhen(background.parameters ?? {})}
		<GpuParamControl
			param={control}
			value={background.parameters?.[control.name]}
			effectLabel={paperLabel(shader.label)}
			oncommit={(value) =>
				onchange({ parameters: { ...background.parameters, [control.name]: value } })}
		/>
	{/if}
{/each}
