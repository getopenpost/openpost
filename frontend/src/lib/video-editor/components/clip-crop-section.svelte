<script lang="ts">
	import CropIcon from '@lucide/svelte/icons/crop';
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import {
		cropPropertyValuePixels,
		cropSoftnessReferenceDimension,
		cropSourceDimensions,
		type CropKeyframeProperty,
		type CropSourceDimensions
	} from '$lib/video-editor/media/crop-properties';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { resolveAnimatedItemLocalAt } from '$lib/video-editor/timeline/animated-properties';
	import {
		beginAnimatedPropertyEdit,
		cancelAnimatedPropertyEdit,
		commitAnimatedPropertyEdit,
		setAnimatedProperties,
		updateAnimatedPropertiesLive
	} from '$lib/video-editor/timeline/actions/keyframes';
	import { executeAtomic } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import ScrubbableNumberInput from './scrubbable-number-input.svelte';

	let {
		itemId,
		itemIds = [],
		onedit
	}: { itemId: string; itemIds?: string[]; onedit: () => void } = $props();

	const items = $derived.by(() => {
		const selectedIds = itemIds.length > 0 ? itemIds : [itemId];
		return [...new Set(selectedIds)]
			.map((id) => timelineStore.itemById.get(id))
			.filter(
				(candidate): candidate is TimelineItem =>
					candidate !== undefined &&
					['video', 'image', 'lottie', 'composition'].includes(candidate.type)
			);
	});
	const selectedIds = $derived(items.map((item) => item.id));
	let gesture = $state<TimelineSnapshot | null>(null);

	const controls: Array<{
		property: CropKeyframeProperty;
		label: () => string;
		shortLabel: string;
		axis: 'horizontal' | 'vertical' | 'softness';
	}> = [
		{
			property: 'cropLeft',
			label: m.video_editor_align_left,
			shortLabel: 'L',
			axis: 'horizontal'
		},
		{
			property: 'cropRight',
			label: m.video_editor_align_right,
			shortLabel: 'R',
			axis: 'horizontal'
		},
		{
			property: 'cropTop',
			label: m.video_editor_property_top,
			shortLabel: 'T',
			axis: 'vertical'
		},
		{
			property: 'cropBottom',
			label: m.video_editor_property_bottom,
			shortLabel: 'B',
			axis: 'vertical'
		},
		{
			property: 'cropSoftness',
			label: m.video_editor_property_softness,
			shortLabel: 'S',
			axis: 'softness'
		}
	];

	function dimensionsFor(item: TimelineItem): CropSourceDimensions {
		const media = item.mediaId ? mediaPool.get(item.mediaId) : undefined;
		const projectWidth = editorSession.project?.metadata.width ?? 1920;
		const projectHeight = editorSession.project?.metadata.height ?? 1080;
		return cropSourceDimensions(
			{
				...item,
				sourceWidth: item.sourceWidth ?? media?.width,
				sourceHeight: item.sourceHeight ?? media?.height
			},
			projectWidth,
			projectHeight
		);
	}

	function resolvedCrop(item: TimelineItem): TimelineItem['crop'] {
		const frameWidth = editorSession.project?.metadata.width ?? 1920;
		const frameHeight = editorSession.project?.metadata.height ?? 1080;
		return resolveAnimatedItemLocalAt(item, timelineStore.currentFrame, {
			fps: timelineStore.fps,
			frameWidth,
			frameHeight,
			items: timelineStore.items
		}).crop;
	}

	function valueFor(item: TimelineItem, property: CropKeyframeProperty): number {
		return cropPropertyValuePixels(resolvedCrop(item), property, dimensionsFor(item));
	}

	function mixedValue(property: CropKeyframeProperty): number | null {
		if (items.length === 0) return null;
		const values = items.map((item) => valueFor(item, property));
		const first = values[0] ?? 0;
		return values.every((value) => Math.abs(value - first) < 0.5) ? first : null;
	}

	function maxFor(axis: 'horizontal' | 'vertical' | 'softness'): number {
		const dimensions = items.map(dimensionsFor);
		if (dimensions.length === 0) return 1;
		if (axis === 'horizontal') return Math.min(...dimensions.map((value) => value.width));
		if (axis === 'vertical') return Math.min(...dimensions.map((value) => value.height));
		return Math.max(...dimensions.map(cropSoftnessReferenceDimension));
	}

	function autoKeyEnabled(property: CropKeyframeProperty): boolean {
		return (
			items.length > 0 && items.every((item) => autoKeyframeStore.isEnabled(item.id, property))
		);
	}

	function toggleAutoKey(property: CropKeyframeProperty): void {
		const enabled = !autoKeyEnabled(property);
		for (const item of items) {
			if (autoKeyframeStore.isEnabled(item.id, property) !== enabled) {
				autoKeyframeStore.toggle(item.id, property);
			}
		}
	}

	function beginGesture(): void {
		gesture ??= beginAnimatedPropertyEdit();
	}

	function writeLive(property: CropKeyframeProperty, value: number): void {
		if (!Number.isFinite(value)) return;
		beginGesture();
		for (const item of items) {
			updateAnimatedPropertiesLive(
				item.id,
				timelineStore.currentFrame,
				{ [property]: Math.round(value) },
				(key) => autoKeyframeStore.isEnabled(item.id, key)
			);
		}
	}

	function commitGesture(property: CropKeyframeProperty, value: number): void {
		if (!Number.isFinite(value) || items.length === 0) return;
		if (!gesture) writeLive(property, value);
		const before = gesture;
		if (!before) return;
		commitAnimatedPropertyEdit(before, selectedIds, [property]);
		gesture = null;
		onedit();
	}

	function cancelGesture(): void {
		if (!gesture) return;
		cancelAnimatedPropertyEdit(gesture);
		gesture = null;
	}

	function reset(property: CropKeyframeProperty): void {
		let changed = false;
		executeAtomic('RESET_CLIP_CROP', () => {
			for (const item of items) {
				changed =
					setAnimatedProperties(item.id, timelineStore.currentFrame, { [property]: 0 }, (key) =>
						autoKeyframeStore.isEnabled(item.id, key)
					) || changed;
			}
		});
		if (changed) onedit();
	}
</script>

{#if items.length > 0}
	<section
		class="overflow-hidden rounded-md border border-white/8 bg-white/[0.025]"
		data-testid="clip-crop-section"
	>
		<h3
			class="flex h-8 items-center gap-2 border-b border-white/7 px-2.5 text-[10px] font-semibold tracking-wider text-white/58 uppercase"
		>
			<CropIcon class="size-3.5 text-white/42" aria-hidden="true" />
			{m.video_editor_crop()}
		</h3>
		<div class="divide-y divide-white/6">
			{#each controls as control (control.property)}
				{@const value = mixedValue(control.property)}
				{@const maximum = maxFor(control.axis)}
				<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
					<span class="text-[10px] font-medium text-white/48">{control.label()}</span>
					<div class="flex min-w-0 items-center gap-1">
						<Slider
							class="h-7 min-w-8 flex-1 [&_[data-slot=slider-thumb]]:shadow-none"
							min={control.axis === 'softness' ? -maximum : 0}
							max={maximum}
							step={1}
							value={value ?? 0}
							ariaLabel={control.label()}
							onValueChange={(nextValue) => {
								beginGesture();
								writeLive(control.property, nextValue);
							}}
							onValueCommit={(nextValue) => commitGesture(control.property, nextValue)}
							onValueCancel={cancelGesture}
							onKeydown={(event) => event.stopPropagation()}
						/>
						<div class="relative w-[4.6rem] shrink-0">
							<span
								class="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-[9px] font-semibold text-white/35"
								>{control.shortLabel}</span
							>
							<ScrubbableNumberInput
								ariaLabel={control.label()}
								{value}
								placeholder={m.video_editor_property_mixed()}
								min={control.axis === 'softness' ? -maximum : 0}
								max={maximum}
								step={1}
								decimals={0}
								class="h-7 w-full rounded border border-white/8 bg-black/18 py-1 pr-5 pl-4 text-right text-[11px] tabular-nums outline-none"
								onbegin={beginGesture}
								onlive={(next) => writeLive(control.property, next)}
								oncommit={(next) => commitGesture(control.property, next)}
								oncancel={cancelGesture}
							/>
							<span
								class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[9px] text-white/30"
								>px</span
							>
						</div>
						<button
							type="button"
							class:active={autoKeyEnabled(control.property)}
							class="grid size-6 shrink-0 place-items-center rounded text-white/38 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:text-[oklch(0.78_0.16_55)]"
							aria-label={m.video_editor_property_auto_key({ property: control.label() })}
							aria-pressed={autoKeyEnabled(control.property)}
							onclick={() => toggleAutoKey(control.property)}
						>
							<DiamondIcon
								class={`size-2.5 ${autoKeyEnabled(control.property) ? 'fill-current' : ''}`}
								aria-hidden="true"
							/>
						</button>
						<button
							type="button"
							class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							aria-label={m.video_editor_motion_override_reset({ name: control.label() })}
							onclick={() => reset(control.property)}
						>
							<RotateCcwIcon class="size-3.5" aria-hidden="true" />
						</button>
					</div>
				</div>
			{/each}
		</div>
	</section>
{/if}
