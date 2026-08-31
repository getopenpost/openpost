<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { TimelineItem } from '../project/types';
	import { updateItemProperties } from '../timeline/actions/items';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import {
		CAPTION_STYLE_PRESETS,
		detectActiveCaptionPreset,
		resolveCaptionStylePatch,
		type CaptionStylePresetId
	} from '../typography/caption-style-presets';
	import { captionStylePresetLabel } from '../typography/caption-style-i18n';

	let {
		item,
		canvasWidth,
		canvasHeight,
		onedit
	}: {
		item: TimelineItem;
		canvasWidth: number;
		canvasHeight: number;
		onedit: () => void;
	} = $props();

	const activeItem = $derived(timelineStore.itemById.get(item.id) ?? item);
	const activePreset = $derived(
		detectActiveCaptionPreset(activeItem, canvasWidth, canvasHeight)?.id ?? null
	);

	const fontOptions: AppSelectOption[] = [
		'Inter',
		'Roboto',
		'Roboto Slab',
		'Manrope',
		'Anton',
		'Bebas Neue',
		'Inter Tight',
		'Orbitron'
	].map((font) => ({ value: font, label: font }));
	const alignmentOptions = $derived<AppSelectOption[]>([
		{ value: 'left', label: m.video_editor_align_left() },
		{ value: 'center', label: m.video_editor_align_center() },
		{ value: 'right', label: m.video_editor_align_right() }
	]);

	function commit(patch: Partial<TimelineItem>, command = 'UPDATE_CAPTION_STYLE'): void {
		updateItemProperties(activeItem.id, patch, command);
		onedit();
	}

	function applyPreset(id: CaptionStylePresetId): void {
		const preset = CAPTION_STYLE_PRESETS.find((candidate) => candidate.id === id);
		if (!preset) return;
		commit(
			resolveCaptionStylePatch(preset, canvasWidth, canvasHeight, activeItem.transform),
			'APPLY_CAPTION_STYLE_PRESET'
		);
	}

	const karaokeMode = $derived(
		activeItem.captionHighlightMode === 'karaoke' ? 'karaoke' : 'normal'
	);

	function commitKaraokeMode(mode: 'normal' | 'karaoke'): void {
		const patch: Partial<TimelineItem> = { captionHighlightMode: mode };
		if (mode === 'karaoke') {
			patch.karaokeActiveColor = activeItem.karaokeActiveColor ?? '#FFD400';
			patch.karaokeActiveBackground = activeItem.karaokeActiveBackground;
		}
		commit(patch, 'UPDATE_CAPTION_HIGHLIGHT_MODE');
	}
</script>

<section class="video-editor-theme space-y-2" aria-labelledby={`caption-style-${activeItem.id}`}>
	<h3
		id={`caption-style-${activeItem.id}`}
		class="text-[10px] font-semibold tracking-wider text-[var(--video-editor-muted)] uppercase"
	>
		{m.video_editor_caption_style()}
	</h3>

	<div class="space-y-1">
		<span id={`caption-presets-${activeItem.id}`} class="field-label">
			{m.video_editor_caption_presets()}
		</span>
		<div class="preset-strip" aria-labelledby={`caption-presets-${activeItem.id}`}>
			{#each CAPTION_STYLE_PRESETS as preset (preset.id)}
				<button
					type="button"
					class:active={activePreset === preset.id}
					aria-pressed={activePreset === preset.id}
					onclick={() => applyPreset(preset.id)}
				>
					<span class="preset-preview" data-preset={preset.id} aria-hidden="true">
						<span>{m.video_editor_caption_preview()}</span>
					</span>
					<span class="preset-name">{captionStylePresetLabel(preset.id)}</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="grid grid-cols-2 gap-1.5">
		<label class="field-label col-span-2">
			{m.video_editor_text_font()}
			<AppSelect
				value={activeItem.fontFamily ?? 'Inter'}
				options={fontOptions}
				ariaLabel={m.video_editor_text_font()}
				class="mt-0.5 h-8 w-full text-xs"
				onValueChange={(fontFamily) => commit({ fontFamily })}
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
				value={activeItem.fontSize ?? 60}
				onchange={(event) => commit({ fontSize: event.currentTarget.valueAsNumber })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_text_alignment()}
			<AppSelect
				value={activeItem.textAlign ?? 'center'}
				options={alignmentOptions}
				ariaLabel={m.video_editor_text_alignment()}
				class="mt-0.5 h-8 w-full text-xs"
				onValueChange={(textAlign) => commit({ textAlign: textAlign as TimelineItem['textAlign'] })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_text_color()}
			<Input
				class="mt-0.5 h-8 w-full bg-transparent"
				type="color"
				value={activeItem.color ?? '#ffffff'}
				onchange={(event) => commit({ color: event.currentTarget.value })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_text_stroke_color()}
			<Input
				class="mt-0.5 h-8 w-full bg-transparent"
				type="color"
				value={activeItem.strokeColor ?? '#000000'}
				onchange={(event) => commit({ strokeColor: event.currentTarget.value })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_property_stroke()}
			<Input
				class="field-input"
				type="number"
				min="0"
				max="30"
				step="0.5"
				value={activeItem.strokeWidth ?? 0}
				onchange={(event) => commit({ strokeWidth: event.currentTarget.valueAsNumber })}
			/>
		</label>
		<label class="field-label">
			{m.video_editor_property_line_height()}
			<Input
				class="field-input"
				type="number"
				min="0.5"
				max="4"
				step="0.05"
				value={activeItem.lineHeight ?? 1.25}
				onchange={(event) => commit({ lineHeight: event.currentTarget.valueAsNumber })}
			/>
		</label>
	</div>

	<!-- Karaoke word highlight: deliberate mode with active-word colors; fallback stays normal. -->
	<div class="space-y-1">
		<span id={`caption-highlight-${activeItem.id}`} class="field-label">
			{m.video_editor_caption_highlight_mode()}
		</span>
		<div
			class="grid grid-cols-2 gap-1"
			role="group"
			aria-labelledby={`caption-highlight-${activeItem.id}`}
		>
			<Button
				type="button"
				size="sm"
				variant={karaokeMode === 'normal' ? 'secondary' : 'ghost'}
				aria-pressed={karaokeMode === 'normal'}
				onclick={() => commitKaraokeMode('normal')}
			>
				{m.video_editor_caption_highlight_normal()}
			</Button>
			<Button
				type="button"
				size="sm"
				variant={karaokeMode === 'karaoke' ? 'secondary' : 'ghost'}
				aria-pressed={karaokeMode === 'karaoke'}
				onclick={() => commitKaraokeMode('karaoke')}
			>
				{m.video_editor_caption_highlight_karaoke()}
			</Button>
		</div>
		<p class="text-[10px] leading-snug text-[var(--video-editor-muted)]">
			{m.video_editor_caption_highlight_karaoke_hint()}
		</p>
		{#if karaokeMode === 'karaoke'}
			<div class="grid grid-cols-2 gap-1.5">
				<label class="field-label">
					{m.video_editor_caption_karaoke_active_color()}
					<Input
						class="mt-0.5 h-8 w-full bg-transparent"
						type="color"
						value={activeItem.karaokeActiveColor ?? '#FFD400'}
						onchange={(event) =>
							commit(
								{ karaokeActiveColor: event.currentTarget.value },
								'UPDATE_KARAOKE_ACTIVE_COLOR'
							)}
					/>
				</label>
				<label class="field-label">
					{m.video_editor_caption_karaoke_active_background()}
					<div class="mt-0.5 flex items-center gap-1">
						<Input
							class="h-8 w-full bg-transparent"
							type="color"
							value={activeItem.karaokeActiveBackground ?? '#FFD400'}
							disabled={!activeItem.karaokeActiveBackground}
							onchange={(event) =>
								commit(
									{ karaokeActiveBackground: event.currentTarget.value },
									'UPDATE_KARAOKE_ACTIVE_BACKGROUND'
								)}
						/>
						<Button
							type="button"
							size="sm"
							variant={activeItem.karaokeActiveBackground ? 'ghost' : 'secondary'}
							class="h-8 px-2 text-[10px]"
							onclick={() =>
								commit(
									{
										karaokeActiveBackground: activeItem.karaokeActiveBackground
											? undefined
											: (activeItem.karaokeActiveBackground ?? '#FFD400')
									},
									'UPDATE_KARAOKE_ACTIVE_BACKGROUND'
								)}
						>
							{activeItem.karaokeActiveBackground
								? m.video_editor_caption_karaoke_active_background_none()
								: m.video_editor_caption_karaoke_active_background()}
						</Button>
					</div>
				</label>
			</div>
		{/if}
	</div>

	<div class="grid grid-cols-3 gap-1" role="group" aria-label={m.video_editor_caption_style()}>
		<Button
			type="button"
			size="sm"
			variant={(activeItem.fontWeight ?? 600) >= 700 ? 'secondary' : 'ghost'}
			aria-pressed={(activeItem.fontWeight ?? 600) >= 700}
			onclick={() =>
				commit({
					fontWeight: (activeItem.fontWeight ?? 600) >= 700 ? 600 : 700
				})}
		>
			{m.video_editor_caption_bold()}
		</Button>
		<Button
			type="button"
			size="sm"
			variant={activeItem.fontStyle === 'italic' ? 'secondary' : 'ghost'}
			aria-pressed={activeItem.fontStyle === 'italic'}
			onclick={() =>
				commit({
					fontStyle: activeItem.fontStyle === 'italic' ? 'normal' : 'italic'
				})}
		>
			{m.video_editor_text_italic()}
		</Button>
		<Button
			type="button"
			size="sm"
			variant={activeItem.underline ? 'secondary' : 'ghost'}
			aria-pressed={activeItem.underline ?? false}
			onclick={() => commit({ underline: !activeItem.underline })}
		>
			{m.video_editor_text_underline()}
		</Button>
	</div>
</section>

<style>
	.field-label {
		display: block;
		font-size: 0.625rem;
		line-height: 1rem;
		color: var(--video-editor-muted);
	}
	:global(.field-input) {
		width: 100%;
		height: 2rem;
		margin-top: 0.125rem;
		border-color: var(--video-editor-border);
		background: var(--video-editor-control);
		padding-inline: 0.375rem;
		font-size: 0.75rem;
		color: var(--video-editor-text);
	}
	.preset-strip {
		display: flex;
		gap: 0.375rem;
		overflow-x: auto;
		padding: 0.125rem 0.125rem 0.375rem;
		scrollbar-color: var(--video-editor-border) transparent;
		scrollbar-width: thin;
	}
	.preset-strip > button {
		width: 5.25rem;
		flex: 0 0 5.25rem;
		border: 1px solid var(--video-editor-border);
		border-radius: 0.5rem;
		padding: 0.25rem;
		color: var(--video-editor-muted);
		text-align: left;
	}
	.preset-strip > button:hover,
	.preset-strip > button:focus-visible {
		border-color: var(--video-editor-focus-border);
		color: var(--video-editor-text);
	}
	.preset-strip > button:focus-visible {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: 1px;
	}
	.preset-strip > button.active {
		border-color: var(--video-editor-focus);
		box-shadow: inset 0 0 0 1px var(--video-editor-focus);
	}
	.preset-preview {
		display: grid;
		height: 2.75rem;
		place-items: center;
		overflow: hidden;
		border-radius: 0.25rem;
		background: #050505;
		padding: 0.25rem;
		color: white;
		font-size: 0.48rem;
		line-height: 1.1;
		text-align: center;
	}
	.preset-preview[data-preset='netflix'] span {
		border-radius: 0.15rem;
		background: rgb(0 0 0 / 55%);
		padding: 0.18rem 0.25rem;
		font-family: 'Inter Variable', sans-serif;
		font-weight: 600;
	}
	.preset-preview[data-preset='youtube'] span {
		font-family: 'Roboto', sans-serif;
		font-weight: 500;
		text-shadow: 0 2px 5px black;
	}
	.preset-preview[data-preset='bold-yellow'] span {
		color: #ffd400;
		font-family: 'Roboto Slab', serif;
		font-weight: 700;
		-webkit-text-stroke: 0.35px black;
	}
	.preset-preview[data-preset='minimal-stroke'] span {
		font-family: 'Manrope Variable', sans-serif;
		-webkit-text-stroke: 0.35px black;
	}
	.preset-preview[data-preset='tiktok'] span {
		font-family: 'Anton', sans-serif;
		font-size: 0.7rem;
		letter-spacing: 0.04em;
		text-shadow: 0 2px 3px black;
		-webkit-text-stroke: 0.45px black;
	}
	.preset-name {
		display: block;
		overflow: hidden;
		padding: 0.25rem 0.125rem 0;
		font-size: 0.5625rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (pointer: coarse) {
		.preset-strip > button {
			min-height: 2.75rem;
		}
	}
</style>
