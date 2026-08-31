<!-- Type-specific, undoable clip inspector with FreeCut-compatible auto-key rules. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedProperty } from '$lib/video-editor/timeline/actions/keyframes';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
	import ShapePropertiesPanel from './shape-properties-panel.svelte';
	import BackgroundPropertiesPanel from './background-properties-panel.svelte';
	import CornerPinPropertiesPanel from './corner-pin-properties-panel.svelte';
	import LottiePropertiesPanel from './lottie-properties-panel.svelte';
	import TextPropertiesPanel from './text-properties-panel.svelte';
	import SubtitlePropertiesPanel from './subtitle-properties-panel.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import CompositionControlOverrides from './composition-control-overrides.svelte';
	import { resolveAnimatedItemLocalAt } from '$lib/video-editor/timeline/animated-properties';
	import { getSynchronizedLinkedItems } from '$lib/video-editor/timeline/utils/linked-items';
	import AudioDuckingPanel from './audio-ducking-panel.svelte';
	import AudioEffectsPanel from './audio-effects-panel.svelte';
	import {
		clampNoiseReductionAmount,
		resolveNoiseReductionSettings
	} from '$lib/video-editor/audio/audio-noise-reduction';
	import AudioEqPanel from './audio-eq-panel.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Slider } from '$lib/components/ui/slider';
	import { Label } from '$lib/components/ui/label';
	import ClipTransformSection from './clip-transform-section.svelte';
	import ClipCropSection from './clip-crop-section.svelte';
	import ClipPlaybackSection from './clip-playback-section.svelte';
	import ClipAudioCoreSection from './clip-audio-core-section.svelte';
	import AnimatedImagePlaybackSection from './animated-image-playback-section.svelte';

	let nrDraftAmount = $state<number | null>(null);
	// Reset draft when selection or persisted amount changes
	$effect(() => {
		void audioItem?.audioNoiseReductionAmount;
		void audioItem?.audioNoiseReductionEnabled;
		nrDraftAmount = null;
	});

	let {
		itemId,
		itemIds = [],
		onedit,
		oncreatevoice
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		oncreatevoice?: (itemId: string, text: string) => void;
	} = $props();
	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const audioItems = $derived.by(() => {
		const selectedIds = itemIds.length > 0 ? itemIds : itemId ? [itemId] : [];
		const selected = [...new Set(selectedIds)]
			.map((id) => timelineStore.itemById.get(id))
			.filter((candidate): candidate is TimelineItem => candidate !== undefined);
		const selectedAudio = selected.filter((candidate) => candidate.type === 'audio');
		if (selectedAudio.length > 0) return selectedAudio;
		const resolved = new Map<string, TimelineItem>();
		for (const candidate of selected) {
			if (candidate.type !== 'video') continue;
			const companion = getSynchronizedLinkedItems(timelineStore.items, candidate.id).find(
				(linked) => linked.type === 'audio'
			);
			resolved.set((companion ?? candidate).id, companion ?? candidate);
		}
		return [...resolved.values()];
	});
	const audioItem = $derived(audioItems[0]);

	interface NumericField {
		property: KeyframeProperty;
		label: string;
		min: number;
		max: number;
		step: number;
	}

	const textFields: NumericField[] = [
		{
			property: 'fontSize',
			label: m.video_editor_property_size(),
			min: 8,
			max: 500,
			step: 1
		},
		{
			property: 'fontWeight',
			label: m.video_editor_property_weight(),
			min: 100,
			max: 900,
			step: 100
		},
		{
			property: 'lineHeight',
			label: m.video_editor_property_line_height(),
			min: 0.5,
			max: 4,
			step: 0.05
		},
		{
			property: 'letterSpacing',
			label: m.video_editor_property_tracking(),
			min: -10,
			max: 50,
			step: 0.1
		},
		{
			property: 'paddingX',
			label: m.video_editor_property_padding_x(),
			min: 0,
			max: 500,
			step: 1
		},
		{
			property: 'paddingY',
			label: m.video_editor_property_padding_y(),
			min: 0,
			max: 500,
			step: 1
		},
		{
			property: 'borderRadius',
			label: m.video_editor_property_box_radius(),
			min: 0,
			max: 500,
			step: 1
		},
		{
			property: 'strokeWidth',
			label: m.video_editor_property_stroke(),
			min: 0,
			max: 30,
			step: 0.5
		},
		{
			property: 'textShadowOffsetX',
			label: m.video_editor_text_shadow_x(),
			min: -100,
			max: 100,
			step: 1
		},
		{
			property: 'textShadowOffsetY',
			label: m.video_editor_text_shadow_y(),
			min: -100,
			max: 100,
			step: 1
		},
		{
			property: 'textShadowBlur',
			label: m.video_editor_text_shadow_blur(),
			min: 0,
			max: 160,
			step: 1
		}
	];
	const textAlignmentOptions: AppSelectOption[] = [
		{ value: 'left', label: m.video_editor_align_left() },
		{ value: 'center', label: m.video_editor_align_center() },
		{ value: 'right', label: m.video_editor_align_right() }
	];
	const verticalAlignmentOptions: AppSelectOption[] = [
		{ value: 'top', label: m.video_editor_property_top() },
		{ value: 'middle', label: m.video_editor_align_center() },
		{ value: 'bottom', label: m.video_editor_property_bottom() }
	];

	function valueFor(source: TimelineItem, property: KeyframeProperty): number {
		const frameWidth = editorSession.project?.metadata.width ?? 1920;
		const frameHeight = editorSession.project?.metadata.height ?? 1080;
		const resolved = resolveAnimatedItemLocalAt(source, timelineStore.currentFrame, {
			fps: timelineStore.fps,
			frameWidth,
			frameHeight,
			items: timelineStore.items
		});
		switch (property) {
			case 'x':
				return resolved.transform?.x ?? defaultValue(property);
			case 'y':
				return resolved.transform?.y ?? defaultValue(property);
			case 'width':
				return resolved.transform?.width ?? source.sourceWidth ?? frameWidth;
			case 'height':
				return resolved.transform?.height ?? source.sourceHeight ?? frameHeight;
			case 'scaleX':
				return resolved.transform?.scaleX ?? 1;
			case 'scaleY':
				return resolved.transform?.scaleY ?? 1;
			case 'anchorX':
				return (
					resolved.transform?.anchorX ??
					(resolved.transform?.width ?? source.sourceWidth ?? frameWidth) / 2
				);
			case 'anchorY':
				return (
					resolved.transform?.anchorY ??
					(resolved.transform?.height ?? source.sourceHeight ?? frameHeight) / 2
				);
			case 'rotation':
				return resolved.transform?.rotation ?? defaultValue(property);
			case 'opacity':
				return resolved.transform?.opacity ?? defaultValue(property);
			case 'cornerRadius':
				return resolved.transform?.cornerRadius ?? defaultValue(property);
			case 'cropLeft':
				return resolved.crop?.left ?? 0;
			case 'cropRight':
				return resolved.crop?.right ?? 0;
			case 'cropTop':
				return resolved.crop?.top ?? 0;
			case 'cropBottom':
				return resolved.crop?.bottom ?? 0;
			case 'cropSoftness':
				return resolved.crop?.softness ?? 0;
			case 'volume':
				return resolved.volume ?? 1;
			case 'fontSize':
				return source.fontSize ?? defaultValue(property);
			case 'fontWeight':
				return source.fontWeight ?? defaultValue(property);
			case 'lineHeight':
				return source.lineHeight ?? defaultValue(property);
			case 'letterSpacing':
				return source.letterSpacing ?? 0;
			case 'paddingX':
				return source.paddingX ?? 0;
			case 'paddingY':
				return source.paddingY ?? 0;
			case 'borderRadius':
				return source.borderRadius ?? 0;
			case 'strokeWidth':
				return source.strokeWidth ?? 0;
			case 'textShadowOffsetX':
				return source.textShadow?.offsetX ?? 0;
			case 'textShadowOffsetY':
				return source.textShadow?.offsetY ?? 0;
			case 'textShadowBlur':
				return source.textShadow?.blur ?? 0;
		}
		return defaultValue(property);
	}

	function defaultValue(property: KeyframeProperty): number {
		if (property === 'opacity' || property === 'volume') return 1;
		if (property === 'fontSize') return 48;
		if (property === 'fontWeight') return 600;
		if (property === 'lineHeight') return 1.2;
		return 0;
	}

	function commitNumeric(property: KeyframeProperty, value: number): void {
		if (!itemId || !Number.isFinite(value)) return;
		if (
			setAnimatedProperty(
				itemId,
				property,
				timelineStore.currentFrame,
				value,
				autoKeyframeStore.isEnabled(itemId, property)
			)
		)
			onedit();
	}

	function commitText(patch: Partial<TimelineItem>): void {
		if (!itemId) return;
		updateItemProperties(itemId, patch, 'UPDATE_CLIP_PROPERTIES');
		onedit();
	}

	function commitAudioPatch(patch: Partial<TimelineItem>): void {
		if (!audioItem) return;
		updateItemProperties(audioItem.id, patch, 'UPDATE_CLIP_AUDIO');
		onedit();
	}

	function commitTextShadowColor(color: string): void {
		const current = itemId ? timelineStore.itemById.get(itemId) : undefined;
		commitText({
			textShadow: {
				blur: current?.textShadow?.blur ?? 0,
				color,
				offsetX: current?.textShadow?.offsetX ?? 0,
				offsetY: current?.textShadow?.offsetY ?? 0
			}
		});
	}
</script>

{#if item}
	<div class="flex flex-col gap-3" aria-label={m.video_editor_clip_properties()}>
		{#if item.type === 'adjustment'}
			<p class="text-xs leading-relaxed text-[oklch(0.7_0.01_55)]">
				{m.video_editor_adjustment_layer_hint()}
			</p>
		{:else if item.type !== 'audio'}
			{#if item.type === 'composition'}
				<CompositionControlOverrides {item} {onedit} />
			{/if}
			<ClipTransformSection itemId={item.id} {itemIds} {onedit} />
		{/if}

		<ClipCropSection itemId={item.id} {itemIds} {onedit} />

		{#if item.type === 'image'}
			<AnimatedImagePlaybackSection itemId={item.id} {itemIds} {onedit} />
		{/if}

		{#if item.type === 'shape'}
			<ShapePropertiesPanel {item} {onedit} />
		{/if}

		{#if item.type === 'background'}
			<BackgroundPropertiesPanel {item} {onedit} />
		{/if}

		{#if item.type === 'lottie'}
			<LottiePropertiesPanel {item} {onedit} />
		{/if}

		{#if ['video', 'image', 'lottie', 'text', 'shape', 'subtitle', 'composition'].includes(item.type)}
			<CornerPinPropertiesPanel {item} {onedit} />
		{/if}

		{#if item.type === 'video' || item.type === 'audio'}
			<ClipPlaybackSection itemId={item.id} {itemIds} {onedit} />
			<ClipAudioCoreSection itemId={item.id} {itemIds} {onedit} />

			{#if audioItem}
				<section>
					<details class="mt-2 rounded-md border border-white/10 bg-black/10">
						<summary
							class="flex min-h-8 cursor-pointer list-none items-center justify-between px-2 text-[10px] text-white/70 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						>
							<span>{m.video_editor_audio_fade_shape()}</span><span class="text-white/40"
								>{m.video_editor_audio_fade_shape_description()}</span
							>
						</summary>
						<div class="grid grid-cols-2 gap-1 border-t border-white/10 p-2">
							{#each [{ label: m.video_editor_audio_fade_in_curve(), field: 'audioFadeInCurve', value: audioItem.audioFadeInCurve ?? 0, min: -1, max: 1 }, { label: m.video_editor_audio_fade_out_curve(), field: 'audioFadeOutCurve', value: audioItem.audioFadeOutCurve ?? 0, min: -1, max: 1 }, { label: m.video_editor_audio_fade_in_bias(), field: 'audioFadeInCurveX', value: audioItem.audioFadeInCurveX ?? 0.52, min: 0.04, max: 0.96 }, { label: m.video_editor_audio_fade_out_bias(), field: 'audioFadeOutCurveX', value: audioItem.audioFadeOutCurveX ?? 0.52, min: 0.04, max: 0.96 }] as control (control.field)}
								<label class="text-[10px] text-white/60">
									{control.label}
									<Input
										class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
										type="number"
										min={control.min}
										max={control.max}
										step="0.01"
										value={control.value}
										onchange={(event) =>
											commitAudioPatch({
												[control.field]: Math.max(
													control.min,
													Math.min(control.max, event.currentTarget.valueAsNumber)
												)
											})}
									/>
								</label>
							{/each}
						</div>
					</details>
					<div class="mt-2 space-y-2">
						<AudioEqPanel items={audioItems} {onedit} />
						<AudioEffectsPanel item={audioItem} />
						<AudioDuckingPanel item={audioItem} {onedit} />
					</div>
					<div
						class="mt-2 rounded-md border border-white/10 bg-black/10 p-2"
						data-testid="noise-reduction-panel"
					>
						<div class="flex items-center justify-between gap-2">
							<h4 class="text-[10px] font-semibold tracking-wider text-white/70 uppercase">
								{m.video_editor_audio_noise_title()}
							</h4>
							<span class="text-[10px] text-white/40"
								>{m.video_editor_audio_noise_description()}</span
							>
						</div>
						{#if audioItem}
							{@const nr = resolveNoiseReductionSettings(audioItem)}
							<div class="mt-2 flex items-center gap-2">
								<div class="flex items-center gap-2">
									<Checkbox
										checked={nr.enabled}
										aria-label={m.video_editor_audio_noise_enable()}
										onCheckedChange={(checked) =>
											commitAudioPatch({
												audioNoiseReductionEnabled: checked === true,
												audioNoiseReductionAmount: nr.amount
											})}
									/>
									<Label class="text-[11px] text-white/80"
										>{m.video_editor_audio_noise_enable()}</Label
									>
								</div>
								<span class="ml-auto text-[10px] text-white/50" aria-live="polite">
									{nr.enabled
										? m.video_editor_audio_noise_applied({ amount: String(nr.amount) })
										: m.video_editor_audio_noise_bypassed()}
								</span>
							</div>
							<div class="mt-2 space-y-1">
								<Label for={`nr-${audioItem.id}`} class="text-[10px] text-white/60"
									>{m.video_editor_audio_noise_amount()}</Label
								>
								<Slider
									value={nrDraftAmount ?? nr.amount}
									min={0}
									max={100}
									step={1}
									disabled={!nr.enabled}
									ariaLabel={m.video_editor_audio_noise_aria()}
									onValueChange={(v) => {
										nrDraftAmount = clampNoiseReductionAmount(v);
									}}
									onValueCommit={(v) => {
										const clamped = clampNoiseReductionAmount(v);
										nrDraftAmount = null;
										commitAudioPatch({
											audioNoiseReductionAmount: clamped,
											audioNoiseReductionEnabled: true
										});
									}}
								/>
								<p class="mt-1 text-[10px] leading-snug text-white/40">
									{m.video_editor_audio_noise_amount_hint({
										amount: String(nrDraftAmount ?? nr.amount)
									})}
								</p>
							</div>
						{/if}
					</div>
				</section>
			{/if}
		{/if}

		{#if item.type === 'text'}
			<section>
				<h3
					class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
				>
					{m.video_editor_tool_text()}
				</h3>
				<TextPropertiesPanel {item} {itemIds} {onedit} {oncreatevoice} />
				<div class="mt-2 grid grid-cols-2 gap-1">
					{#each textFields as field (field.property)}
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
							>{field.label}<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min={field.min}
								max={field.max}
								step={field.step}
								value={valueFor(item, field.property)}
								onchange={(event) =>
									commitNumeric(field.property, event.currentTarget.valueAsNumber)}
							/></label
						>
					{/each}
				</div>
				<div class="mt-1 grid grid-cols-2 gap-1">
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_text_color()}<Input
							class="block h-8 w-full rounded bg-transparent"
							type="color"
							value={item.color ?? '#ffffff'}
							onchange={(event) => commitText({ color: event.currentTarget.value })}
						/></label
					>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_text_background()}<Input
							class="block h-8 w-full rounded bg-transparent"
							type="color"
							value={item.backgroundColor ?? '#000000'}
							onchange={(event) => commitText({ backgroundColor: event.currentTarget.value })}
						/><button
							type="button"
							class="mt-0.5 w-full rounded px-1 py-1 text-[9px] text-[oklch(0.62_0.01_55)] hover:bg-[oklch(0.28_0.015_50)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-40"
							disabled={!item.backgroundColor}
							onclick={() => commitText({ backgroundColor: undefined })}
							>{m.video_editor_text_clear_background()}</button
						></label
					>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_text_stroke_color()}<Input
							class="block h-8 w-full rounded bg-transparent"
							type="color"
							value={item.strokeColor ?? '#000000'}
							onchange={(event) => commitText({ strokeColor: event.currentTarget.value })}
						/></label
					>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]"
						>{m.video_editor_text_shadow_color()}<Input
							class="block h-8 w-full rounded bg-transparent"
							type="color"
							value={item.textShadow?.color ?? '#000000'}
							onchange={(event) => commitTextShadowColor(event.currentTarget.value)}
						/></label
					>
				</div>
				<div class="mt-1 grid grid-cols-2 gap-1">
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_text_alignment()}
						<AppSelect
							value={item.textAlign ?? 'center'}
							options={textAlignmentOptions}
							ariaLabel={m.video_editor_text_alignment()}
							class="mt-0.5 h-8 w-full text-xs"
							onValueChange={(textAlign) =>
								commitText({
									textAlign: textAlign as TimelineItem['textAlign']
								})}
						/>
					</label>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_text_vertical_alignment()}
						<AppSelect
							value={item.verticalAlign ?? 'middle'}
							options={verticalAlignmentOptions}
							ariaLabel={m.video_editor_text_vertical_alignment()}
							class="mt-0.5 h-8 w-full text-xs"
							onValueChange={(verticalAlign) =>
								commitText({
									verticalAlign: verticalAlign as TimelineItem['verticalAlign']
								})}
						/>
					</label>
				</div>
			</section>
		{/if}

		{#if item.type === 'subtitle'}
			<SubtitlePropertiesPanel
				{item}
				canvasWidth={editorSession.project?.metadata.width ?? 1920}
				canvasHeight={editorSession.project?.metadata.height ?? 1080}
				{onedit}
			/>
		{/if}
	</div>
{/if}
