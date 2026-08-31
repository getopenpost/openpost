<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { GpuEffect } from '$lib/video-editor/effects/types';
	import type { GpuParamValues } from '$lib/video-editor/effects/gpu/types';
	import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { upsertGpuEffectParamsOnItems } from '$lib/video-editor/timeline/actions/effects';
	import ColorEffectHeader from './color-effect-header.svelte';
	import GpuCurvesEditor from './gpu-curves-editor.svelte';

	const EFFECT_ID = 'gpu-curves';
	const SYNTHETIC_EFFECT_ID = '__color-curves__';

	let {
		itemId,
		itemIds = [],
		onedit
	}: { itemId: string | null; itemIds?: string[]; onedit: () => void } = $props();

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const storedEffect = $derived(
		item?.effects?.find(
			(effect): effect is GpuEffect => effect.type === 'gpu' && effect.effectId === EFFECT_ID
		)
	);
	const displayEffect = $derived<GpuEffect>(
		storedEffect ?? {
			id: SYNTHETIC_EFFECT_ID,
			type: 'gpu',
			effectId: EFFECT_ID,
			enabled: true,
			params: getGpuEffectDefaultParams(EFFECT_ID)
		}
	);
	const targetItemIds = $derived.by(() => {
		const requested = itemId && itemIds.includes(itemId) ? itemIds : itemId ? [itemId] : [];
		return [...new Set(requested)].filter((id) => timelineStore.itemById.get(id)?.type !== 'audio');
	});

	function draft(params: GpuParamValues | null): void {
		if (!itemId) return;
		if (!params || !storedEffect) {
			colorPreviewStore.clearEffectDraft(itemId, storedEffect?.id);
			return;
		}
		const effectIds = targetItemIds.flatMap((id) => {
			const effect = timelineStore.itemById
				.get(id)
				?.effects?.find(
					(candidate) => candidate.type === 'gpu' && candidate.effectId === EFFECT_ID
				);
			return effect?.type === 'gpu' ? [effect.id] : [];
		});
		colorPreviewStore.setEffectDraft(itemId, storedEffect, params, effectIds);
	}

	function commit(params: GpuParamValues): void {
		if (!itemId) return;
		colorPreviewStore.clearEffectDraft(itemId, storedEffect?.id);
		if (upsertGpuEffectParamsOnItems(targetItemIds, EFFECT_ID, params)) onedit();
	}
</script>

<section
	class="flex h-full min-h-0 flex-col"
	aria-label={m['video_editor_gpu_effect_gpu-curves']()}
>
	<ColorEffectHeader
		{itemId}
		{itemIds}
		effectId={EFFECT_ID}
		label={m['video_editor_gpu_effect_gpu-curves']()}
		badge="RGB"
		{onedit}
	/>
	<div class="min-h-0 flex-1 overflow-auto p-2">
		<GpuCurvesEditor compact gpuEffect={displayEffect} ondraft={draft} oncommit={commit} />
	</div>
</section>
