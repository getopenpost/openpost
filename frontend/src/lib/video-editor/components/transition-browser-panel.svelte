<!-- Transition catalog and previews adapted from FreeCut's MIT-licensed picker. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import type { TransitionDirection } from '$lib/video-editor/project/types';
	import { transitionRegistry } from '$lib/video-editor/transitions';
	import { localizedTransitionLabel } from '$lib/video-editor/transitions/labels';
	import {
		clearTransitionDragData,
		setTransitionDragData,
		TRANSITION_DRAG_MIME,
		type TransitionDragData
	} from '$lib/video-editor/timeline/transition-drop';
	import TransitionThumbnail from './transition-thumbnail.svelte';

	let {
		onapply
	}: {
		onapply: (presentation: string, direction?: TransitionDirection) => void;
	} = $props();

	let scroller = $state<HTMLElement | null>(null);
	let activeId = $state<string | null>(null);

	const categoryOrder = ['basic', 'dissolve', 'motion', 'wipe', 'iris', 'shape', 'custom'];
	const categoryLabels = $derived<Record<string, string>>({
		basic: m.video_editor_transition_category_basic(),
		dissolve: m.video_editor_transition_category_dissolve(),
		motion: m.video_editor_transition_category_motion(),
		wipe: m.video_editor_transition_category_wipe(),
		slide: m.video_editor_transition_category_slide(),
		flip: m.video_editor_transition_category_flip(),
		mask: m.video_editor_transition_category_mask(),
		iris: m.video_editor_transition_category_iris(),
		shape: m.video_editor_transition_category_shape(),
		light: m.video_editor_transition_category_light(),
		chromatic: m.video_editor_transition_category_chromatic(),
		custom: m.video_editor_transition_category_custom()
	});
	const groups = $derived(
		categoryOrder
			.map((category) => ({
				category,
				label: categoryLabels[category] ?? category,
				items: transitionRegistry
					.getDefinitions()
					.filter((definition) => definition.category === category)
			}))
			.filter((group) => group.items.length > 0)
	);

	function dragData(presentation: string, label: string, direction?: TransitionDirection) {
		return { presentation, label, direction } satisfies TransitionDragData;
	}

	function startDrag(
		event: DragEvent,
		presentation: string,
		label: string,
		direction?: TransitionDirection
	): void {
		if (!event.dataTransfer) return;
		const payload = dragData(presentation, label, direction);
		event.dataTransfer.effectAllowed = 'copy';
		event.dataTransfer.setData(TRANSITION_DRAG_MIME, JSON.stringify(payload));
		setTransitionDragData(payload);
	}

	onDestroy(clearTransitionDragData);
</script>

<div
	bind:this={scroller}
	class="transition-browser min-h-0 flex-1 overflow-y-auto p-2"
	aria-label={m.video_editor_transition()}
>
	<p class="mb-2 text-[10px] leading-4 text-[oklch(0.62_0.012_55)]">
		{m.video_editor_transition_add_or_drag()}
	</p>
	{#each groups as group (group.category)}
		<section class="mb-4 last:mb-0">
			<h3
				class="mb-2 text-[10px] font-semibold tracking-[0.12em] text-[oklch(0.62_0.012_55)] uppercase"
			>
				{group.label}
			</h3>
			<div class="transition-grid">
				{#each group.items as definition (definition.id)}
					{@const label = localizedTransitionLabel(definition.id, definition.label)}
					{@const direction = definition.directions?.[0] as TransitionDirection | undefined}
					<button
						type="button"
						draggable="true"
						class="transition-card"
						data-transition-catalog-id={definition.id}
						aria-label={label}
						title={label}
						onclick={() => onapply(definition.id, direction)}
						ondragstart={(event) => startDrag(event, definition.id, label, direction)}
						ondragend={clearTransitionDragData}
						onpointerenter={() => (activeId = definition.id)}
						onpointerleave={() => {
							if (activeId === definition.id) activeId = null;
						}}
						onfocus={() => (activeId = definition.id)}
						onblur={() => {
							if (activeId === definition.id) activeId = null;
						}}
					>
						<TransitionThumbnail
							presentationId={definition.id}
							{direction}
							viewport={scroller}
							active={activeId === definition.id}
						/>
						<span>{label}</span>
					</button>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.transition-browser {
		container-type: inline-size;
		scrollbar-color: oklch(0.35 0.015 55) transparent;
		scrollbar-width: thin;
	}
	.transition-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.375rem;
	}
	@container (min-width: 360px) {
		.transition-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.transition-card {
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
	.transition-card:active {
		cursor: grabbing;
	}
	.transition-card:hover,
	.transition-card:focus-visible {
		border-color: oklch(0.52 0.09 45);
		background: oklch(0.205 0.012 50);
		color: white;
	}
	.transition-card:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 1px;
	}
	.transition-card > span {
		display: block;
		overflow: hidden;
		padding-top: 0.35rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
