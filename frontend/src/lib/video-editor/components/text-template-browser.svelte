<!-- Text recipes adapted from FreeCut's MIT-licensed media sidebar. -->
<script lang="ts">
	import TypeIcon from '@lucide/svelte/icons/type';
	import { m } from '$lib/paraglide/messages';
	import { addTextItem, addTextTemplateItem } from '$lib/video-editor/timeline/actions/items';
	import { TEXT_STYLE_PRESETS, type TextStylePresetLayout } from '../typography/text-style-presets';
	import { localizedTextStylePresetCopy } from '../typography/text-style-preset-copy';
	import {
		clearGeneratedItemDragData,
		textGeneratedItemDragData,
		writeGeneratedItemDragData
	} from '$lib/video-editor/timeline/generated-item-drag';

	let { oninserted }: { oninserted: (itemId: string) => void } = $props();

	const groups: Array<{ layout: TextStylePresetLayout; label: () => string }> = [
		{ layout: 'single', label: m.video_editor_text_layout_single },
		{ layout: 'two', label: m.video_editor_text_layout_two },
		{ layout: 'three', label: m.video_editor_text_layout_three }
	];

	function insertPlainText(): void {
		oninserted(addTextItem(m.video_editor_text_default_label()));
	}

	function startDrag(
		event: DragEvent,
		label: string,
		presetId?: (typeof TEXT_STYLE_PRESETS)[number]['id']
	): void {
		if (!event.dataTransfer) return;
		writeGeneratedItemDragData(event.dataTransfer, textGeneratedItemDragData(label, presetId));
	}
</script>

<div
	class="text-browser min-h-0 flex-1 overflow-y-auto p-2"
	aria-label={m.video_editor_text_templates()}
>
	{#each groups as group (group.layout)}
		<section class="mb-4 last:mb-0">
			<h3
				class="mb-2 text-[10px] font-semibold tracking-[0.12em] text-[oklch(0.62_0.012_55)] uppercase"
			>
				{group.label()}
			</h3>
			<div class="template-grid">
				{#if group.layout === 'single'}
					<button
						type="button"
						class="template-card"
						draggable="true"
						onclick={insertPlainText}
						ondragstart={(event) => startDrag(event, m.video_editor_text_default_label())}
						ondragend={clearGeneratedItemDragData}
						aria-label={m.video_editor_add_text()}
					>
						<span class="template-canvas add-text" aria-hidden="true">
							<TypeIcon class="size-4 opacity-70" />
							<span>{m.video_editor_text_default_label()}</span>
						</span>
						<span class="template-name">{m.video_editor_add_text()}</span>
					</button>
				{/if}
				{#each TEXT_STYLE_PRESETS.filter((preset) => preset.layout === group.layout) as preset (preset.id)}
					{@const copy = localizedTextStylePresetCopy(preset.id)}
					<button
						type="button"
						class="template-card"
						draggable="true"
						onclick={() => oninserted(addTextTemplateItem(preset.id, copy))}
						ondragstart={(event) => startDrag(event, copy.label, preset.id)}
						ondragend={clearGeneratedItemDragData}
						aria-label={`${m.video_editor_add_text()}: ${copy.label}`}
					>
						<span class="template-canvas" data-kind={preset.previewKind} aria-hidden="true">
							{#if copy.sample.eyebrow}<span class="eyebrow">{copy.sample.eyebrow}</span>{/if}
							<span class="title">{copy.sample.title}</span>
							{#if copy.sample.subtitle}<span class="subtitle">{copy.sample.subtitle}</span>{/if}
						</span>
						<span class="template-name">{copy.label}</span>
					</button>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.text-browser {
		container-type: inline-size;
		scrollbar-color: oklch(0.35 0.015 55) transparent;
		scrollbar-width: thin;
	}
	.template-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.375rem;
	}
	@container (min-width: 360px) {
		.template-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.template-card {
		min-width: 0;
		border: 1px solid oklch(0.29 0.012 55);
		border-radius: 0.5rem;
		padding: 0.25rem;
		text-align: left;
		color: oklch(0.72 0.01 55);
		background: oklch(0.17 0.008 55);
		cursor: grab;
	}
	.template-card:active {
		cursor: grabbing;
	}
	.template-card:hover,
	.template-card:focus-visible {
		border-color: oklch(0.52 0.09 45);
		background: oklch(0.205 0.012 50);
		color: white;
	}
	.template-card:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 1px;
	}
	.template-canvas {
		display: flex;
		aspect-ratio: 16 / 9;
		width: 100%;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border: 1px solid oklch(0.3 0.02 260);
		border-radius: 0.3rem;
		background: #020617;
		padding: 0.25rem;
		color: white;
		line-height: 1;
	}
	.template-canvas.add-text {
		gap: 0.2rem;
		font-size: 0.45rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #94a3b8;
	}
	.template-canvas .eyebrow {
		font-size: 0.34rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: #fbbf24;
	}
	.template-canvas .title {
		font-size: 0.58rem;
		font-weight: 700;
	}
	.template-canvas .subtitle {
		margin-top: 0.15rem;
		font-size: 0.36rem;
		color: #cbd5e1;
	}
	.template-canvas[data-kind='lower-third'],
	.template-canvas[data-kind='speaker'] {
		align-items: flex-start;
		justify-content: flex-end;
		background: #111827;
		padding-inline: 0.45rem;
	}
	.template-canvas[data-kind='poster'] .title {
		font-size: 0.76rem;
		font-weight: 400;
		text-transform: uppercase;
		color: #fef3c7;
		text-shadow: 0 2px 8px #7f1d1d;
	}
	.template-canvas[data-kind='outline-pill'] .title,
	.template-canvas[data-kind='badge'] .title {
		border: 1px solid #38bdf8;
		border-radius: 999px;
		padding: 0.25rem 0.4rem;
		font-size: 0.4rem;
		letter-spacing: 0.08em;
	}
	.template-canvas[data-kind='cinematic'] .title {
		font-weight: 400;
		letter-spacing: 0.18em;
		color: #f8e6b8;
	}
	.template-canvas[data-kind='quote'] {
		background: #1f2937;
		font-family: 'Playfair Display Variable', serif;
		font-style: italic;
	}
	.template-canvas[data-kind='neon'] {
		background: #082f49;
		color: #67e8f9;
		text-shadow: 0 0 6px #22d3ee;
	}
	.template-canvas[data-kind='breaking'] .eyebrow,
	.template-canvas[data-kind='event'] .eyebrow {
		color: #fca5a5;
	}
	.template-canvas[data-kind='launch'] .eyebrow {
		color: #67e8f9;
	}
	.template-name {
		display: block;
		overflow: hidden;
		padding: 0.3rem 0.125rem 0.1rem;
		font-size: 0.625rem;
		text-align: center;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (pointer: coarse) {
		.template-card {
			min-height: 5.5rem;
		}
	}
</style>
