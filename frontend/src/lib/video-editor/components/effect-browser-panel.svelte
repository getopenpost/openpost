<script lang="ts">
	import { onDestroy } from 'svelte';
	import LayersIcon from '@lucide/svelte/icons/layers-3';
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';
	import {
		addAdjustmentLayerWithEffects,
		addEffectTemplates
	} from '$lib/video-editor/timeline/actions/effects';
	import { getGpuCategoriesWithEffects } from '$lib/video-editor/effects/gpu/registry';
	import { gpuEffectLabel } from '$lib/video-editor/effects/gpu/i18n';
	import { BUILT_IN_EFFECT_PRESETS } from '$lib/video-editor/effects/effect-presets';
	import {
		canApplyDroppedEffectsToItem,
		clearEffectDragData,
		setEffectDragData,
		type EffectDragData,
		type EffectTemplate
	} from '$lib/video-editor/timeline/effect-drop';
	import EffectThumbnail from './effect-thumbnail.svelte';

	let {
		selectedItemIds = [],
		oninserted,
		onedit
	}: {
		selectedItemIds?: string[];
		oninserted: (itemId: string) => void;
		onedit: () => void;
	} = $props();

	let scroller = $state<HTMLElement | null>(null);
	let activeId = $state<string | null>(null);

	const categoryLabels = $derived<Record<string, string>>({
		color: m.video_editor_gpu_category_color(),
		blur: m.video_editor_gpu_category_blur(),
		distort: m.video_editor_gpu_category_distort(),
		stylize: m.video_editor_gpu_category_stylize(),
		keying: m.video_editor_gpu_category_keying()
	});
	const presetLabels = $derived<Record<string, string>>({
		'trigger-wave-layer': m.video_editor_effect_preset_trigger_wave_layer(),
		crt: m.video_editor_effect_preset_crt(),
		'retro-tv': m.video_editor_effect_preset_retro_tv(),
		vintage: m.video_editor_effect_preset_vintage(),
		noir: m.video_editor_effect_preset_noir(),
		cold: m.video_editor_effect_preset_cold(),
		warm: m.video_editor_effect_preset_warm(),
		dramatic: m.video_editor_effect_preset_dramatic(),
		faded: m.video_editor_effect_preset_faded()
	});

	const groups = $derived([
		{
			id: 'presets',
			label: m.video_editor_effects_presets(),
			items: BUILT_IN_EFFECT_PRESETS.map((preset) => ({
				id: `preset:${preset.id}`,
				label: presetLabels[preset.id] ?? preset.name,
				effects: preset.effects.map(cloneTemplate)
			}))
		},
		...getGpuCategoriesWithEffects().map((group) => ({
			id: group.category,
			label: categoryLabels[group.category] ?? group.category,
			items: group.effects.map((effect) => ({
				id: effect.id,
				label: gpuEffectLabel(effect),
				effectId: effect.id,
				effects: [{ kind: 'gpu' as const, effectId: effect.id }]
			}))
		}))
	]);

	function cloneTemplate(template: EffectTemplate): EffectTemplate {
		return template.kind === 'gpu'
			? { ...template, params: template.params ? { ...template.params } : undefined }
			: { ...template };
	}

	function compatibleSelection(): string[] {
		return [...new Set(selectedItemIds)].filter((id) => {
			const item = timelineStore.itemById.get(id);
			return item
				? canApplyDroppedEffectsToItem(item) &&
						!isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)
				: false;
		});
	}

	function createAdjustment(label: string, effects: readonly EffectTemplate[] = []): void {
		const id = addAdjustmentLayerWithEffects(label, effects.map(cloneTemplate));
		oninserted(id);
		onedit();
	}

	function apply(label: string, effects: readonly EffectTemplate[]): void {
		const targets = compatibleSelection();
		if (targets.length > 0 && addEffectTemplates(targets, effects.map(cloneTemplate))) {
			onedit();
			return;
		}
		createAdjustment(label, effects);
	}

	function startDrag(event: DragEvent, label: string, effects: readonly EffectTemplate[]): void {
		if (!event.dataTransfer) return;
		const payload: EffectDragData = {
			type: 'timeline-effect',
			label,
			effects: effects.map(cloneTemplate)
		};
		event.dataTransfer.effectAllowed = 'copy';
		event.dataTransfer.setData('application/json', JSON.stringify(payload));
		setEffectDragData(payload);
	}

	onDestroy(clearEffectDragData);
</script>

<div
	bind:this={scroller}
	class="effect-browser min-h-0 flex-1 overflow-y-auto p-2"
	aria-label={m.video_editor_effects()}
>
	<p class="mb-2 text-[10px] leading-4 text-[oklch(0.62_0.012_55)]">
		{m.video_editor_effects_add_or_drag()}
	</p>
	<button
		type="button"
		class="mb-3 flex min-h-16 w-full items-center gap-3 rounded-lg border border-[oklch(0.29_0.012_55)] bg-[oklch(0.17_0.008_55)] px-3 text-left text-xs text-[oklch(0.72_0.01_55)] hover:border-[oklch(0.52_0.09_45)] hover:bg-[oklch(0.205_0.012_50)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		onclick={() => createAdjustment(m.video_editor_adjustment_layer())}
	>
		<span class="grid size-10 place-items-center rounded-md border border-white/10 bg-white/5">
			<LayersIcon class="size-5" aria-hidden="true" />
		</span>
		<span>{m.video_editor_add_adjustment_layer()}</span>
	</button>

	{#each groups as group (group.id)}
		<section class="mb-4 last:mb-0">
			<h3
				class="mb-2 text-[10px] font-semibold tracking-[0.12em] text-[oklch(0.62_0.012_55)] uppercase"
			>
				{group.label}
			</h3>
			<div class="effect-grid">
				{#each group.items as item (item.id)}
					<button
						type="button"
						draggable="true"
						class="effect-card"
						data-effect-catalog-id={item.id}
						aria-label={item.label}
						title={m.video_editor_effects_add_or_drag()}
						onclick={() => apply(item.label, item.effects)}
						ondragstart={(event) => startDrag(event, item.label, item.effects)}
						ondragend={clearEffectDragData}
						onpointerenter={() => (activeId = item.id)}
						onpointerleave={() => {
							if (activeId === item.id) activeId = null;
						}}
						onfocus={() => (activeId = item.id)}
						onblur={() => {
							if (activeId === item.id) activeId = null;
						}}
					>
						<EffectThumbnail
							effectId={item.effectId}
							effects={item.effectId ? undefined : item.effects}
							viewport={scroller}
							active={activeId === item.id}
							class="aspect-video w-full rounded"
						/>
						<span>{item.label}</span>
					</button>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.effect-browser {
		container-type: inline-size;
		scrollbar-color: oklch(0.35 0.015 55) transparent;
		scrollbar-width: thin;
	}
	.effect-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.375rem;
	}
	@container (min-width: 360px) {
		.effect-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.effect-card {
		min-width: 0;
		cursor: grab;
		border: 1px solid oklch(0.29 0.012 55);
		border-radius: 0.5rem;
		background: oklch(0.17 0.008 55);
		padding: 0.3rem;
		color: oklch(0.68 0.01 55);
		font-size: 0.625rem;
		text-align: center;
	}
	.effect-card:active {
		cursor: grabbing;
	}
	.effect-card:hover,
	.effect-card:focus-visible {
		border-color: oklch(0.52 0.09 45);
		background: oklch(0.205 0.012 50);
		color: white;
	}
	.effect-card:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 1px;
	}
	.effect-card > span {
		display: block;
		overflow: hidden;
		padding-top: 0.35rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
