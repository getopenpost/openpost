<!-- Type-specific, undoable clip inspector with FreeCut-compatible auto-key rules. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { setAnimatedProperty } from '$lib/video-editor/timeline/actions/keyframes';
	import {
		setItemSpeed,
		setItemsReversed,
		updateItemProperties
	} from '$lib/video-editor/timeline/actions/items';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import {
		cancelReverseConform,
		conformReversePreview,
		reverseConformStatus,
		subscribeReverseConform,
		type ReverseConformStatus
	} from '$lib/video-editor/media/reverse-conform-service';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
	import ShapePropertiesPanel from './shape-properties-panel.svelte';
	import CornerPinPropertiesPanel from './corner-pin-properties-panel.svelte';
	import LottiePropertiesPanel from './lottie-properties-panel.svelte';
	import TextPropertiesPanel from './text-properties-panel.svelte';
	import SubtitlePropertiesPanel from './subtitle-properties-panel.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import CompositionControlOverrides from './composition-control-overrides.svelte';
	import { resolveAnimatedItemLocalAt } from '$lib/video-editor/timeline/animated-properties';
	import { getSynchronizedLinkedItems } from '$lib/video-editor/timeline/utils/linked-items';
	import { dbToLinearGain, linearGainToDb } from '$lib/video-editor/media/clip-fades';
	import {
		clampAudioPitchCents,
		clampAudioPitchSemitones
	} from '$lib/video-editor/audio/audio-pitch';
	import AudioEqPanel from './audio-eq-panel.svelte';
	import AudioDuckingPanel from './audio-ducking-panel.svelte';

	let {
		itemId,
		onedit,
		oncreatevoice
	}: {
		itemId: string | null;
		onedit: () => void;
		oncreatevoice?: (itemId: string, text: string) => void;
	} = $props();
	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const audioItem = $derived.by(() => {
		if (!item || (item.type !== 'video' && item.type !== 'audio')) return undefined;
		if (item.type === 'audio') return item;
		return (
			getSynchronizedLinkedItems(timelineStore.items, item.id).find(
				(candidate) => candidate.type === 'audio'
			) ?? item
		);
	});
	let conformStatus = $state<ReverseConformStatus>({
		state: 'idle',
		progress: 0
	});

	$effect(() => {
		const mediaId = item?.mediaId;
		if (!mediaId) {
			conformStatus = { state: 'idle', progress: 0 };
			return;
		}
		conformStatus = reverseConformStatus(mediaId);
		return subscribeReverseConform(mediaId, (status) => (conformStatus = status));
	});

	interface NumericField {
		property: KeyframeProperty;
		label: string;
		min: number;
		max: number;
		step: number;
	}

	const transformFields: NumericField[] = [
		{ property: 'x', label: 'X', min: -2, max: 2, step: 0.01 },
		{ property: 'y', label: 'Y', min: -2, max: 2, step: 0.01 },
		{
			property: 'width',
			label: m.video_editor_property_width(),
			min: 1,
			max: 7680,
			step: 1
		},
		{
			property: 'height',
			label: m.video_editor_property_height(),
			min: 1,
			max: 4320,
			step: 1
		},
		{
			property: 'anchorX',
			label: m.video_editor_property_anchor_x(),
			min: -7680,
			max: 7680,
			step: 1
		},
		{
			property: 'anchorY',
			label: m.video_editor_property_anchor_y(),
			min: -4320,
			max: 4320,
			step: 1
		},
		{
			property: 'rotation',
			label: m.video_editor_rotation(),
			min: -360,
			max: 360,
			step: 1
		},
		{
			property: 'opacity',
			label: m.video_editor_clip_opacity(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cornerRadius',
			label: m.video_editor_property_radius(),
			min: 0,
			max: 1000,
			step: 1
		}
	];

	const cropFields: NumericField[] = [
		{
			property: 'cropLeft',
			label: m.video_editor_align_left(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cropRight',
			label: m.video_editor_align_right(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cropTop',
			label: m.video_editor_property_top(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cropBottom',
			label: m.video_editor_property_bottom(),
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			property: 'cropSoftness',
			label: m.video_editor_property_softness(),
			min: 0,
			max: 1,
			step: 0.01
		}
	];

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

	function commitTransformPatch(patch: NonNullable<TimelineItem['transform']>): void {
		if (!item) return;
		updateItemProperties(
			item.id,
			{ transform: { ...item.transform, ...patch } },
			'UPDATE_CLIP_TRANSFORM'
		);
		onedit();
	}

	function commitSpeed(value: number): void {
		if (!item || !Number.isFinite(value)) return;
		if (setItemSpeed(item.id, Math.min(10, Math.max(0.1, Math.round(value * 100) / 100)))) {
			onedit();
		}
	}

	function commitAudioPatch(patch: Partial<TimelineItem>): void {
		if (!audioItem) return;
		updateItemProperties(audioItem.id, patch, 'UPDATE_CLIP_AUDIO');
		onedit();
	}

	function commitVisualFade(field: 'fadeIn' | 'fadeOut', value: number): void {
		if (!item || !Number.isFinite(value)) return;
		commitText({
			[field]: Math.min(item.durationInFrames / timelineStore.fps, Math.max(0, value))
		});
	}

	function commitAudioFade(field: 'audioFadeIn' | 'audioFadeOut', value: number): void {
		if (!audioItem || !Number.isFinite(value)) return;
		commitAudioPatch({
			[field]: Math.min(audioItem.durationInFrames / timelineStore.fps, Math.max(0, value))
		});
	}

	function commitGainDb(db: number): void {
		if (!audioItem || !Number.isFinite(db)) return;
		if (
			setAnimatedProperty(
				audioItem.id,
				'volume',
				timelineStore.currentFrame,
				dbToLinearGain(db),
				autoKeyframeStore.isEnabled(audioItem.id, 'volume')
			)
		) {
			onedit();
		}
	}

	function commitPitch(field: 'audioPitchSemitones' | 'audioPitchCents', value: number): void {
		if (!Number.isFinite(value)) return;
		commitAudioPatch({
			[field]:
				field === 'audioPitchSemitones'
					? clampAudioPitchSemitones(value)
					: clampAudioPitchCents(value)
		});
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

	function toggleReverse(): void {
		if (!item) return;
		const willReverse = item.isReversed !== true;
		if (setItemsReversed([item.id], willReverse).length === 0) return;
		onedit();
		if (!willReverse || !item.mediaId) return;
		const media = mediaPool.get(item.mediaId);
		if (media?.tags.includes('video')) void conformReversePreview(media).catch(() => undefined);
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
			<section>
				<h3
					class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
				>
					{m.video_editor_property_transform()}
				</h3>
				<div class="grid grid-cols-2 gap-1">
					{#each transformFields as field (field.property)}
						<div class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
							<span class="flex items-center justify-between gap-1">
								<label for={`clip-property-${item.id}-${field.property}`}>{field.label}</label>
								<button
									type="button"
									class:active={autoKeyframeStore.isEnabled(item.id, field.property)}
									class="rounded px-1 text-[9px] text-[oklch(0.58_0.01_55)] hover:bg-[oklch(0.28_0.015_50)] [&.active]:bg-[oklch(0.66_0.14_45)] [&.active]:text-black"
									aria-label={m.video_editor_property_auto_key({
										property: field.label
									})}
									onclick={() => autoKeyframeStore.toggle(item.id, field.property)}>A</button
								>
							</span>
							<Input
								id={`clip-property-${item.id}-${field.property}`}
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
								type="number"
								min={field.min}
								max={field.max}
								step={field.step}
								value={valueFor(item, field.property)}
								onchange={(event) =>
									commitNumeric(field.property, event.currentTarget.valueAsNumber)}
							/>
						</div>
					{/each}
				</div>
				<div class="mt-1 grid grid-cols-2 gap-1">
					<Button
						type="button"
						size="sm"
						variant={item.transform?.flipHorizontal ? 'secondary' : 'outline'}
						class="h-8 justify-between px-2 text-xs"
						aria-pressed={item.transform?.flipHorizontal === true}
						onclick={() =>
							commitTransformPatch({
								flipHorizontal: !item.transform?.flipHorizontal
							})}
					>
						<span>{m.video_editor_property_flip_x()}</span>
					</Button>
					<Button
						type="button"
						size="sm"
						variant={item.transform?.flipVertical ? 'secondary' : 'outline'}
						class="h-8 justify-between px-2 text-xs"
						aria-pressed={item.transform?.flipVertical === true}
						onclick={() =>
							commitTransformPatch({
								flipVertical: !item.transform?.flipVertical
							})}
					>
						<span>{m.video_editor_property_flip_y()}</span>
					</Button>
				</div>
			</section>
		{/if}

		{#if item.type === 'video' || item.type === 'image' || item.type === 'lottie'}
			<section>
				<h3
					class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
				>
					{m.video_editor_crop()}
				</h3>
				<div class="grid grid-cols-2 gap-1">
					{#each cropFields as field (field.property)}
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
			</section>
		{/if}

		{#if item.type === 'shape'}
			<ShapePropertiesPanel {item} {onedit} />
		{/if}

		{#if item.type === 'lottie'}
			<LottiePropertiesPanel {item} {onedit} />
		{/if}

		{#if ['video', 'image', 'lottie', 'text', 'shape', 'subtitle', 'composition'].includes(item.type)}
			<CornerPinPropertiesPanel {item} {onedit} />
		{/if}

		{#if item.type === 'video' || item.type === 'audio'}
			<section class="space-y-2">
				<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
					{m.video_editor_clip_playback()}
				</h3>
				<div class="block text-[10px] text-[oklch(0.7_0.01_55)]">
					<label for={`clip-speed-${item.id}`}>{m.video_editor_clip_speed()}</label>
					<div class="relative mt-0.5">
						<Input
							id={`clip-speed-${item.id}`}
							class="w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 pr-6 text-xs"
							type="number"
							min="0.1"
							max="10"
							step="0.05"
							value={item.speed ?? 1}
							onchange={(event) => commitSpeed(event.currentTarget.valueAsNumber)}
						/>
						<span
							class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-white/45"
							>×</span
						>
					</div>
				</div>
				<Button
					type="button"
					size="sm"
					variant={item.isReversed ? 'secondary' : 'outline'}
					class="h-8 w-full justify-between text-xs"
					aria-label={m.video_editor_clip_reverse()}
					aria-pressed={item.isReversed === true}
					onclick={toggleReverse}
				>
					<span>{m.video_editor_clip_reverse()}</span>
					<span class="text-[10px] opacity-70">
						{item.isReversed ? m.video_editor_clip_reverse_on() : m.video_editor_clip_reverse_off()}
					</span>
				</Button>
				{#if item.isReversed && (conformStatus.state === 'preparing' || conformStatus.state === 'rendering')}
					<div class="rounded border border-white/10 bg-black/20 p-2">
						<div class="flex items-center justify-between gap-2 text-[10px] text-white/75">
							<span>{m.video_editor_clip_reverse_preparing()}</span>
							<span>{Math.round(conformStatus.progress * 100)}%</span>
						</div>
						<div class="mt-1 h-1 overflow-hidden rounded bg-white/10">
							<div
								class="h-full bg-[oklch(0.66_0.14_45)] transition-[width] motion-reduce:transition-none"
								style:width={`${Math.round(conformStatus.progress * 100)}%`}
							></div>
						</div>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							class="mt-1 h-6 px-1.5 text-[10px]"
							onclick={() => item.mediaId && cancelReverseConform(item.mediaId)}
						>
							{m.common_cancel()}
						</Button>
					</div>
				{:else if item.isReversed && conformStatus.state === 'ready'}
					<p class="text-[10px] text-[oklch(0.74_0.1_145)]">
						{m.video_editor_clip_reverse_ready()}
					</p>
				{:else if item.isReversed && (conformStatus.state === 'error' || conformStatus.state === 'canceled')}
					<p class="text-[10px] text-[oklch(0.72_0.14_30)]">
						{m.video_editor_clip_reverse_fallback()}
					</p>
				{/if}
			</section>

			{#if item.type === 'video'}
				<section>
					<h3
						class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
					>
						{m.video_editor_property_video()}
					</h3>
					<div class="grid grid-cols-2 gap-1">
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
							{m.video_editor_clip_fade_in_seconds()}
							<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min="0"
								max={item.durationInFrames / timelineStore.fps}
								step="0.05"
								value={item.fadeIn ?? 0}
								onchange={(event) => commitVisualFade('fadeIn', event.currentTarget.valueAsNumber)}
							/>
						</label>
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
							{m.video_editor_clip_fade_out_seconds()}
							<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min="0"
								max={item.durationInFrames / timelineStore.fps}
								step="0.05"
								value={item.fadeOut ?? 0}
								onchange={(event) => commitVisualFade('fadeOut', event.currentTarget.valueAsNumber)}
							/>
						</label>
					</div>
				</section>
			{/if}

			{#if audioItem}
				<section>
					<h3
						class="mb-1 text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
					>
						{m.video_editor_property_audio()}
					</h3>
					<div class="grid grid-cols-2 gap-1">
						<div class="col-span-2 text-[10px] text-[oklch(0.7_0.01_55)]">
							<span class="flex items-center justify-between gap-1">
								<label for={`clip-gain-${audioItem.id}`}>{m.video_editor_clip_gain_db()}</label>
								<button
									type="button"
									class:active={autoKeyframeStore.isEnabled(audioItem.id, 'volume')}
									class="rounded px-1 text-[9px] text-[oklch(0.58_0.01_55)] hover:bg-[oklch(0.28_0.015_50)] [&.active]:bg-[oklch(0.66_0.14_45)] [&.active]:text-black"
									aria-label={m.video_editor_property_auto_key({
										property: m.video_editor_clip_gain_db()
									})}
									onclick={() => autoKeyframeStore.toggle(audioItem.id, 'volume')}>A</button
								>
							</span>
							<Input
								id={`clip-gain-${audioItem.id}`}
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min="-60"
								max="12"
								step="0.1"
								value={Number(linearGainToDb(valueFor(audioItem, 'volume')).toFixed(1))}
								onchange={(event) => commitGainDb(event.currentTarget.valueAsNumber)}
							/>
						</div>
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
							Pitch (semitones)
							<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min="-12"
								max="12"
								step="1"
								value={audioItem.audioPitchSemitones ?? 0}
								onchange={(event) =>
									commitPitch('audioPitchSemitones', event.currentTarget.valueAsNumber)}
							/>
						</label>
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
							Fine pitch (cents)
							<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min="-100"
								max="100"
								step="1"
								value={audioItem.audioPitchCents ?? 0}
								onchange={(event) =>
									commitPitch('audioPitchCents', event.currentTarget.valueAsNumber)}
							/>
						</label>
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
							{m.video_editor_clip_fade_in_seconds()}
							<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min="0"
								max={audioItem.durationInFrames / timelineStore.fps}
								step="0.05"
								value={audioItem.audioFadeIn ?? 0}
								onchange={(event) =>
									commitAudioFade('audioFadeIn', event.currentTarget.valueAsNumber)}
							/>
						</label>
						<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
							{m.video_editor_clip_fade_out_seconds()}
							<Input
								class="mt-0.5 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-xs"
								type="number"
								min="0"
								max={audioItem.durationInFrames / timelineStore.fps}
								step="0.05"
								value={audioItem.audioFadeOut ?? 0}
								onchange={(event) =>
									commitAudioFade('audioFadeOut', event.currentTarget.valueAsNumber)}
							/>
						</label>
					</div>
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
					<div class="mt-2">
						<AudioEqPanel item={audioItem} {onedit} />
					</div>
					<div class="mt-2">
						<AudioDuckingPanel item={audioItem} {onedit} />
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
				<TextPropertiesPanel {item} {onedit} {oncreatevoice} />
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
