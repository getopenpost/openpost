<script lang="ts">
	import AppSelect from '$lib/components/app-select.svelte';
	import { SliderRow } from '$lib/components/editor-density';
	import { useImageEditor } from '../editor.svelte';
	import { DEFAULT_LENS_EFFECT } from '../lens-effects';
	import type { ImageEditorLayer, ImageEditorLensEffect } from '../types';
	import { m } from '$lib/paraglide/messages';
	let { layer }: { layer: ImageEditorLayer } = $props();
	const editor = useImageEditor();
	let effect = $derived(layer.image?.lens_effect);
	let disabled = $derived(!editor.canEdit || editor.isLayerLocked(layer.id));
	function update(patch: Partial<ImageEditorLensEffect>, field?: string) {
		if (!layer.image) return;
		editor.updateLayer(
			layer.id,
			{ image: { ...layer.image, lens_effect: { ...(effect ?? DEFAULT_LENS_EFFECT), ...patch } } },
			field ? `lens:${layer.id}:${field}` : undefined
		);
	}
</script>

<section class="space-y-3 border-t pt-4" aria-label={m.image_editor_lens_effect()}>
	<label class="grid gap-1 text-xs">
		<span class="font-medium">{m.image_editor_lens_effect()}</span>
		<AppSelect
			value={effect?.kind ?? 'none'}
			ariaLabel={m.image_editor_lens_effect()}
			{disabled}
			options={[
				{ value: 'none', label: m.image_editor_mask_none() },
				{ value: 'flare', label: m.image_editor_lens_flare() },
				{ value: 'starburst', label: m.image_editor_lens_starburst() },
				{ value: 'mist', label: m.image_editor_lens_mist() },
				{ value: 'prism', label: m.image_editor_lens_prism() },
				{ value: 'bokeh', label: m.image_editor_lens_bokeh() }
			]}
			onValueChange={(value) => {
				if (!layer.image) return;
				if (value === 'none')
					editor.updateLayer(layer.id, { image: { ...layer.image, lens_effect: undefined } });
				else update({ kind: value as ImageEditorLensEffect['kind'] });
			}}
		/>
	</label>
	{#if effect}
		<p class="text-xs text-muted-foreground">{m.image_editor_lens_help()}</p>
		{#each [{ key: 'amount', label: m.image_editor_lens_amount() }, { key: 'threshold', label: m.image_editor_lens_threshold() }, { key: 'size', label: m.image_editor_lens_size() }] as field (field.key)}
			<SliderRow
				label={field.label}
				value={effect[field.key as 'amount' | 'threshold' | 'size'] * 100}
				min={0}
				max={100}
				step={1}
				precision={0}
				{disabled}
				onValueChange={(value) => update({ [field.key]: value / 100 }, field.key)}
				onValueCommit={(value) => update({ [field.key]: value / 100 }, field.key)}
			/>
		{/each}
		{#if effect.kind !== 'mist'}
			<SliderRow
				label={m.image_editor_lens_angle()}
				value={effect.angle}
				min={-180}
				max={180}
				step={1}
				precision={0}
				{disabled}
				onValueChange={(angle) => update({ angle }, 'angle')}
				onValueCommit={(angle) => update({ angle }, 'angle')}
			/>
		{/if}
		{#if effect.kind === 'starburst' || effect.kind === 'bokeh'}
			<SliderRow
				label={m.image_editor_lens_blades()}
				value={effect.blades}
				min={3}
				max={8}
				step={1}
				precision={0}
				{disabled}
				onValueChange={(blades) => update({ blades }, 'blades')}
				onValueCommit={(blades) => update({ blades }, 'blades')}
			/>
		{/if}
	{/if}
</section>
