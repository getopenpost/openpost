<script lang="ts">
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { m } from '$lib/paraglide/messages';
	import type { GpuEffect } from '$lib/video-editor/effects/types';
	import {
		isEffectAtDefaults,
		removeEffectOnItems,
		resetEffectOnItems,
		setEffectEnabledOnItems
	} from '$lib/video-editor/timeline/actions/effects';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let {
		itemId,
		itemIds = [],
		effectId,
		label,
		badge,
		onedit
	}: {
		itemId: string | null;
		itemIds?: string[];
		effectId: string;
		label: string;
		badge?: string;
		onedit: () => void;
	} = $props();

	const effect = $derived(
		itemId
			? (timelineStore.itemById
					.get(itemId)
					?.effects?.find(
						(candidate): candidate is GpuEffect =>
							candidate.type === 'gpu' && candidate.effectId === effectId
					) ?? null)
			: null
	);
	const targetItemIds = $derived.by(() => {
		const requested = itemId && itemIds.includes(itemId) ? itemIds : itemId ? [itemId] : [];
		return [...new Set(requested)].filter((id) => timelineStore.itemById.get(id)?.type !== 'audio');
	});
	const isDefault = $derived(!effect || isEffectAtDefaults(effect));

	function reset(): void {
		if (!itemId || !effect) return;
		if (resetEffectOnItems(itemId, targetItemIds, effect.id)) onedit();
	}

	function toggle(): void {
		if (!itemId || !effect) return;
		if (setEffectEnabledOnItems(itemId, targetItemIds, effect.id, !effect.enabled)) onedit();
	}

	function remove(): void {
		if (!itemId || !effect) return;
		if (removeEffectOnItems(itemId, targetItemIds, effect.id)) onedit();
	}
</script>

<header
	class="flex h-8 shrink-0 items-center justify-between gap-2 border-y border-white/10 bg-white/[0.025] px-2"
>
	<h3 class="min-w-0 truncate text-xs font-medium text-white/90">{label}</h3>
	<div class="flex min-w-0 items-center justify-end gap-0.5">
		{#if badge}
			<span class="mr-1 font-mono text-[9px] tracking-wide text-white/35">{badge}</span>
		{/if}
		<button
			type="button"
			class="effect-action"
			disabled={!effect || isDefault}
			title={m.video_editor_effects_reset()}
			aria-label={m.video_editor_effects_reset()}
			onclick={reset}
		>
			<RotateCcwIcon class="size-3" />
		</button>
		<button
			type="button"
			class="effect-action"
			disabled={!effect}
			title={effect?.enabled ? m.video_editor_effects_disable() : m.video_editor_effects_enable()}
			aria-label={effect?.enabled
				? m.video_editor_effects_disable()
				: m.video_editor_effects_enable()}
			onclick={toggle}
		>
			{#if effect?.enabled}
				<EyeIcon class="size-3" />
			{:else}
				<EyeOffIcon class="size-3" />
			{/if}
		</button>
		<button
			type="button"
			class="effect-action"
			disabled={!effect}
			title={m.video_editor_effects_remove()}
			aria-label={m.video_editor_effects_remove()}
			onclick={remove}
		>
			<Trash2Icon class="size-3" />
		</button>
	</div>
</header>

<style>
	.effect-action {
		display: flex;
		height: 1.5rem;
		width: 1.5rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		color: rgb(255 255 255 / 60%);
	}

	.effect-action:hover:not(:disabled) {
		background: rgb(255 255 255 / 8%);
		color: white;
	}

	.effect-action:focus-visible {
		outline: 2px solid rgb(251 146 60);
		outline-offset: 1px;
	}

	.effect-action:disabled {
		cursor: not-allowed;
		opacity: 0.3;
	}
</style>
