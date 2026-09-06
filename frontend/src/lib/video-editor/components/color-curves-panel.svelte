<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { GpuEffect } from '$lib/video-editor/effects/types';
	import type { GpuParamValues } from '$lib/video-editor/effects/gpu/types';
	import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import { resolveAnimatedEffectsAt } from '$lib/video-editor/effects/effect-keyframes';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedGpuEffectParamsOnItems } from '$lib/video-editor/timeline/actions/keyframes';
	import ColorEffectHeader from './color-effect-header.svelte';
	import GpuCurvesEditor from './gpu-curves-editor.svelte';

	const EFFECT_ID = 'gpu-curves';
	const SYNTHETIC_EFFECT_ID = '__color-curves__';

	let {
		itemId,
		itemIds = [],
		onedit,
		forceAutoKey = false
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		forceAutoKey?: boolean;
	} = $props();

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const storedEffect = $derived(
		item?.effects?.find(
			(effect): effect is GpuEffect => effect.type === 'gpu' && effect.effectId === EFFECT_ID
		)
	);
	const displayEffect = $derived<GpuEffect>(
		(item ? resolveAnimatedEffectsAt(item, timelineStore.currentFrame) : undefined)?.find(
			(effect): effect is GpuEffect => effect.type === 'gpu' && effect.effectId === EFFECT_ID
		) ?? {
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
		if (!params) {
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
		colorPreviewStore.setEffectDraft(itemId, displayEffect, params, effectIds, targetItemIds);
	}

	function commit(params: GpuParamValues): void {
		if (!itemId) return;
		colorPreviewStore.clearEffectDraft(itemId, storedEffect?.id);
		if (
			setAnimatedGpuEffectParamsOnItems(
				targetItemIds,
				EFFECT_ID,
				timelineStore.currentFrame,
				params,
				(id, property) => forceAutoKey || autoKeyframeStore.isEnabled(id, property)
			)
		)
			onedit();
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
