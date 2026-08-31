<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import type { TextSpan, TextStylePresetId, TimelineItem } from '../project/types';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import { updateItemProperties } from '../timeline/actions/items';
	import {
		applyTextEffectPreset,
		applyTextStylePreset,
		setTextItemLayout,
		updateTextSpan,
		type TextEffectPresetId
	} from '../timeline/actions/text-layout';
	import { getTextItemLayoutMode, type TextLayoutMode } from '../typography/text-layout-drafts';
	import { buildTextItemLabelFromText } from '../typography/text-item-spans';
	import { getTextItemPlainText } from '../typography/text-item-spans';
	import { TEXT_STYLE_PRESETS } from '../typography/text-style-presets';
	import { localizedTextStylePresetCopy } from '../typography/text-style-preset-copy';

	let {
		item,
		itemIds = [],
		onedit,
		oncreatevoice
	}: {
		item: TimelineItem;
		itemIds?: string[];
		onedit: () => void;
		oncreatevoice?: (itemId: string, text: string) => void;
	} = $props();
	const activeItem = $derived(timelineStore.itemById.get(item.id) ?? item);
	const selectedTextItemIds = $derived.by(() => {
		const selectedIds = itemIds.length > 0 ? itemIds : [activeItem.id];
		const textIds = selectedIds.filter((id) => timelineStore.itemById.get(id)?.type === 'text');
		return textIds.length > 0 ? [...new Set(textIds)] : [activeItem.id];
	});
	const speakableText = $derived(getTextItemPlainText(activeItem).trim());
	const layout = $derived(getTextItemLayoutMode(activeItem));
	const canvas = $derived({
		width: editorSession.project?.metadata.width ?? 1920,
		height: editorSession.project?.metadata.height ?? 1080
	});

	const fontOptions = [
		'Inter',
		'Inter Tight',
		'Anton',
		'Bebas Neue',
		'Orbitron',
		'Playfair Display',
		'Space Grotesk',
		'Geist'
	] as const;
	const fontSelectOptions: AppSelectOption[] = fontOptions.map((font) => ({
		value: font,
		label: font
	}));
	const weightOptions = [
		{ value: 400, label: m.video_editor_text_weight_regular() },
		{ value: 500, label: m.video_editor_text_weight_medium() },
		{ value: 600, label: m.video_editor_text_weight_semibold() },
		{ value: 700, label: m.video_editor_text_weight_bold() }
	] as const;
	const weightSelectOptions: AppSelectOption[] = weightOptions.map((weight) => ({
		value: String(weight.value),
		label: weight.label
	}));

	function spanLabel(index: number, count: number): string {
		if (count >= 3) {
			if (index === 0) return m.video_editor_text_span_eyebrow();
			if (index === 1) return m.video_editor_text_span_title();
			return m.video_editor_text_span_subtitle();
		}
		return index === 0 ? m.video_editor_text_span_title() : m.video_editor_text_span_subtitle();
	}

	function commitLayout(next: TextLayoutMode): void {
		if (setTextItemLayout(activeItem.id, next)) onedit();
	}

	function commitPreset(presetId: TextStylePresetId, scale = 1): void {
		if (
			applyTextStylePreset(
				activeItem.id,
				presetId,
				canvas,
				scale,
				localizedTextStylePresetCopy(presetId)
			)
		)
			onedit();
	}

	function effectPresetLabel(id: TextEffectPresetId): string {
		switch (id) {
			case 'none':
				return m.video_editor_text_effect_none();
			case 'shadow':
				return m.video_editor_text_effect_shadow();
			case 'outline':
				return m.video_editor_text_effect_outline();
			case 'glow':
				return m.video_editor_text_effect_glow();
		}
	}

	function commitEffectPreset(presetId: TextEffectPresetId): void {
		if (applyTextEffectPreset(selectedTextItemIds, presetId) > 0) onedit();
	}

	function commitItem(patch: Partial<TimelineItem>): void {
		updateItemProperties(activeItem.id, patch, 'UPDATE_TEXT_CONTENT');
		onedit();
	}

	function commitPlainText(value: string): void {
		commitItem({
			text: value,
			textSpans: undefined,
			label: buildTextItemLabelFromText(value)
		});
	}

	function commitSpan(index: number, patch: Partial<TextSpan>): void {
		if (updateTextSpan(activeItem.id, index, patch)) onedit();
	}
</script>

<div class="space-y-2">
	{#if oncreatevoice}
		<Button
			type="button"
			size="sm"
			variant="outline"
			class="w-full"
			disabled={!speakableText}
			onclick={() => oncreatevoice?.(activeItem.id, speakableText)}
		>
			{m.video_editor_text_create_voice()}
		</Button>
	{/if}
	<div class="space-y-1">
		<span class="field-label">{m.video_editor_text_layout()}</span>
		<div class="layout-switch" role="group" aria-label={m.video_editor_text_layout()}>
			{#each [['single', m.video_editor_text_layout_single()], ['two', m.video_editor_text_layout_two()], ['three', m.video_editor_text_layout_three()]] as [value, label]}
				<button
					type="button"
					class:active={layout === value}
					aria-pressed={layout === value}
					onclick={() => commitLayout(value as TextLayoutMode)}>{label}</button
				>
			{/each}
		</div>
	</div>

	<div class="space-y-1">
		<span id="text-template-label" class="field-label">{m.video_editor_text_templates()}</span>
		<div class="template-strip" aria-labelledby="text-template-label">
			{#each TEXT_STYLE_PRESETS as preset (preset.id)}
				{@const copy = localizedTextStylePresetCopy(preset.id)}
				<button
					type="button"
					class:active={activeItem.textStylePresetId === preset.id}
					aria-label={m.video_editor_text_apply_template({
						name: copy.label
					})}
					aria-pressed={activeItem.textStylePresetId === preset.id}
					onclick={() => commitPreset(preset.id)}
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
	</div>

	{#if activeItem.textStylePresetId}
		<label class="field-label block">
			{m.video_editor_text_template_scale()}
			<Input
				class="field-input mt-0.5"
				type="number"
				min="0.5"
				max="6"
				step="0.05"
				value={activeItem.textStyleScale ?? 1}
				onchange={(event) =>
					commitPreset(activeItem.textStylePresetId!, event.currentTarget.valueAsNumber)}
			/>
		</label>
	{/if}

	<div class="space-y-1">
		<span id={`text-effects-${activeItem.id}`} class="field-label">
			{m.video_editor_effects()}
		</span>
		<div class="grid grid-cols-4 gap-1" aria-labelledby={`text-effects-${activeItem.id}`}>
			{#each ['none', 'shadow', 'outline', 'glow'] as presetId (presetId)}
				<Button
					type="button"
					size="sm"
					variant="outline"
					class="h-7 min-w-0 px-1 text-xs"
					onclick={() => commitEffectPreset(presetId as TextEffectPresetId)}
				>
					<span class="truncate">{effectPresetLabel(presetId as TextEffectPresetId)}</span>
				</Button>
			{/each}
		</div>
	</div>

	{#if activeItem.textSpans?.length}
		<div class="space-y-2">
			{#each activeItem.textSpans as span, index (`${index}:${span.text}`)}
				<div class="span-editor">
					<label class="field-label block" for={`text-span-${activeItem.id}-${index}`}>
						{spanLabel(index, activeItem.textSpans.length)}
					</label>
					<Textarea
						id={`text-span-${activeItem.id}-${index}`}
						class="mt-1 min-h-12 resize-y text-xs"
						value={span.text}
						onchange={(event) => commitSpan(index, { text: event.currentTarget.value })}
					></Textarea>
					<details class="span-style">
						<summary>{m.video_editor_text_span_style()}</summary>
						<div class="mt-2 grid grid-cols-2 gap-1.5">
							<label class="field-label col-span-2">
								{m.video_editor_text_font()}
								<AppSelect
									value={span.fontFamily ?? activeItem.fontFamily ?? 'Inter'}
									options={fontSelectOptions}
									ariaLabel={m.video_editor_text_font()}
									class="field-select"
									onValueChange={(fontFamily) => commitSpan(index, { fontFamily })}
								/>
							</label>
							<label class="field-label">
								{m.video_editor_property_size()}
								<Input
									class="field-input"
									type="number"
									min="8"
									max="500"
									step="1"
									value={span.fontSize ?? activeItem.fontSize ?? 60}
									onchange={(event) =>
										commitSpan(index, {
											fontSize: event.currentTarget.valueAsNumber
										})}
								/>
							</label>
							<label class="field-label">
								{m.video_editor_property_weight()}
								<AppSelect
									value={String(span.fontWeight ?? activeItem.fontWeight ?? 400)}
									options={weightSelectOptions}
									ariaLabel={m.video_editor_property_weight()}
									class="field-select"
									onValueChange={(fontWeight) =>
										commitSpan(index, { fontWeight: Number(fontWeight) })}
								/>
							</label>
							<label class="field-label">
								{m.video_editor_property_tracking()}
								<Input
									class="field-input"
									type="number"
									min="-20"
									max="100"
									step="1"
									value={span.letterSpacing ?? activeItem.letterSpacing ?? 0}
									onchange={(event) =>
										commitSpan(index, {
											letterSpacing: event.currentTarget.valueAsNumber
										})}
								/>
							</label>
							<label class="field-label">
								{m.video_editor_text_color()}
								<Input
									class="h-8 w-full bg-transparent"
									type="color"
									value={span.color ?? activeItem.color ?? '#ffffff'}
									onchange={(event) => commitSpan(index, { color: event.currentTarget.value })}
								/>
							</label>
						</div>
						<div class="mt-2 flex gap-1">
							<Button
								type="button"
								size="sm"
								variant={(span.fontStyle ?? activeItem.fontStyle) === 'italic'
									? 'secondary'
									: 'ghost'}
								aria-pressed={(span.fontStyle ?? activeItem.fontStyle) === 'italic'}
								onclick={() =>
									commitSpan(index, {
										fontStyle:
											(span.fontStyle ?? activeItem.fontStyle) === 'italic' ? 'normal' : 'italic'
									})}>{m.video_editor_text_italic()}</Button
							>
							<Button
								type="button"
								size="sm"
								variant={(span.underline ?? activeItem.underline) ? 'secondary' : 'ghost'}
								aria-pressed={span.underline ?? activeItem.underline ?? false}
								onclick={() =>
									commitSpan(index, {
										underline: !(span.underline ?? activeItem.underline ?? false)
									})}>{m.video_editor_text_underline()}</Button
							>
						</div>
					</details>
				</div>
			{/each}
		</div>
	{:else}
		<Textarea
			class="min-h-16 w-full resize-y text-xs"
			value={activeItem.text ?? ''}
			onchange={(event) => commitPlainText(event.currentTarget.value)}
		></Textarea>
		<div class="grid grid-cols-2 gap-1.5">
			<label class="field-label col-span-2">
				{m.video_editor_text_font()}
				<AppSelect
					value={activeItem.fontFamily ?? 'Inter'}
					options={fontSelectOptions}
					ariaLabel={m.video_editor_text_font()}
					class="field-select"
					onValueChange={(fontFamily) => commitItem({ fontFamily })}
				/>
			</label>
			<Button
				type="button"
				size="sm"
				variant={activeItem.fontStyle === 'italic' ? 'secondary' : 'ghost'}
				aria-pressed={activeItem.fontStyle === 'italic'}
				onclick={() =>
					commitItem({
						fontStyle: activeItem.fontStyle === 'italic' ? 'normal' : 'italic'
					})}>{m.video_editor_text_italic()}</Button
			>
			<Button
				type="button"
				size="sm"
				variant={activeItem.underline ? 'secondary' : 'ghost'}
				aria-pressed={activeItem.underline ?? false}
				onclick={() => commitItem({ underline: !activeItem.underline })}
				>{m.video_editor_text_underline()}</Button
			>
		</div>
	{/if}
</div>

<style>
	.field-label {
		font-size: 0.625rem;
		line-height: 1rem;
		color: oklch(0.7 0.01 55);
	}
	:global(.field-input),
	:global(.field-select) {
		width: 100%;
		min-width: 0;
		height: 2rem;
		margin-top: 0.125rem;
		border: 1px solid oklch(0.3 0.012 55);
		border-radius: 0.375rem;
		background: oklch(0.22 0.01 50);
		padding-inline: 0.375rem;
		font-size: 0.75rem;
		color: white;
	}
	:global(.field-input:focus-visible),
	:global(.field-select:focus-visible) {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 1px;
	}
	.layout-switch {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.125rem;
		padding: 0.125rem;
		border-radius: 0.5rem;
		background: oklch(0.18 0.01 55);
	}
	.layout-switch button {
		min-width: 0;
		height: 1.75rem;
		border-radius: 0.375rem;
		font-size: 0.625rem;
		color: oklch(0.68 0.015 55);
	}
	.layout-switch button:hover,
	.layout-switch button:focus-visible {
		background: oklch(0.25 0.015 55);
		color: white;
	}
	.layout-switch button:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
	}
	.layout-switch button.active {
		background: oklch(0.66 0.14 45);
		color: oklch(0.16 0.008 55);
	}
	.template-strip {
		display: flex;
		gap: 0.375rem;
		overflow-x: auto;
		padding: 0.125rem 0.125rem 0.375rem;
		scrollbar-color: oklch(0.35 0.015 55) transparent;
		scrollbar-width: thin;
	}
	.template-strip > button {
		width: 6rem;
		flex: 0 0 6rem;
		border: 1px solid oklch(0.29 0.012 55);
		border-radius: 0.5rem;
		padding: 0.25rem;
		text-align: left;
		color: oklch(0.72 0.01 55);
	}
	.template-strip > button:hover,
	.template-strip > button:focus-visible {
		border-color: oklch(0.48 0.08 45);
		color: white;
	}
	.template-strip > button:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 1px;
	}
	.template-strip > button.active {
		border-color: oklch(0.66 0.14 45);
		box-shadow: inset 0 0 0 1px oklch(0.66 0.14 45);
	}
	.template-canvas {
		display: flex;
		height: 3rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border-radius: 0.25rem;
		background: #020617;
		padding: 0.25rem;
		color: white;
		line-height: 1;
	}
	.template-canvas .eyebrow {
		font-size: 0.35rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #fbbf24;
	}
	.template-canvas .title {
		font-size: 0.58rem;
		font-weight: 700;
	}
	.template-canvas .subtitle {
		margin-top: 0.15rem;
		font-size: 0.38rem;
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
		font-size: 0.75rem;
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
	.template-canvas[data-kind='breaking'] .eyebrow {
		color: #fca5a5;
	}
	.template-canvas[data-kind='launch'] .eyebrow {
		color: #67e8f9;
	}
	.template-canvas[data-kind='event'] .eyebrow {
		color: #fca5a5;
	}
	.template-name {
		display: block;
		overflow: hidden;
		padding: 0.25rem 0.125rem 0;
		font-size: 0.5625rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.span-editor {
		border: 1px solid oklch(0.29 0.012 55);
		border-radius: 0.5rem;
		padding: 0.5rem;
	}
	.span-style {
		margin-top: 0.375rem;
	}
	.span-style summary {
		width: fit-content;
		cursor: pointer;
		font-size: 0.625rem;
		color: oklch(0.66 0.015 55);
	}
	.span-style summary:hover,
	.span-style summary:focus-visible {
		color: white;
		border-radius: 0.25rem;
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.layout-switch button,
		.template-strip > button,
		.span-style summary {
			min-height: 2.75rem;
		}
	}
</style>
