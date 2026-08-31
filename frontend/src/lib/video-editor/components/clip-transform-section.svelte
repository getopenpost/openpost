<script lang="ts">
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import LinkIcon from '@lucide/svelte/icons/link-2';
	import MoveIcon from '@lucide/svelte/icons/move';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import UnlinkIcon from '@lucide/svelte/icons/unlink-2';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
	import { ALL_BLEND_MODES, type BlendMode } from '$lib/video-editor/effects/gpu/blend-modes';
	import { getBlendModeOptions } from '$lib/video-editor/effects/gpu/blend-mode-options';
	import { resolveAnimatedItemLocalAt } from '$lib/video-editor/timeline/animated-properties';
	import {
		beginAnimatedPropertyEdit,
		cancelAnimatedPropertyEdit,
		commitAnimatedPropertyEdit,
		setAnimatedProperties,
		updateAnimatedPropertiesLive
	} from '$lib/video-editor/timeline/actions/keyframes';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
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
					candidate !== undefined && candidate.type !== 'audio' && candidate.type !== 'adjustment'
			);
	});
	const selectedIds = $derived(items.map((item) => item.id));
	const blendOptions = $derived(getBlendModeOptions());
	let gesture = $state<TimelineSnapshot | null>(null);

	function valueFor(item: TimelineItem, property: KeyframeProperty): number {
		const frameWidth = editorSession.project?.metadata.width ?? 1920;
		const frameHeight = editorSession.project?.metadata.height ?? 1080;
		const resolved = resolveAnimatedItemLocalAt(item, timelineStore.currentFrame, {
			fps: timelineStore.fps,
			frameWidth,
			frameHeight,
			items: timelineStore.items
		});
		switch (property) {
			case 'x':
			case 'y':
			case 'rotation':
			case 'cornerRadius':
				return resolved.transform?.[property] ?? 0;
			case 'width':
				return resolved.transform?.width ?? item.sourceWidth ?? frameWidth;
			case 'height':
				return resolved.transform?.height ?? item.sourceHeight ?? frameHeight;
			case 'anchorX':
				return (
					resolved.transform?.anchorX ??
					(resolved.transform?.width ?? item.sourceWidth ?? frameWidth) / 2
				);
			case 'anchorY':
				return (
					resolved.transform?.anchorY ??
					(resolved.transform?.height ?? item.sourceHeight ?? frameHeight) / 2
				);
			case 'opacity':
				return resolved.transform?.opacity ?? 1;
			default:
				return 0;
		}
	}

	function mixedValue(property: KeyframeProperty): number | null {
		if (items.length === 0) return null;
		const values = items.map((item) => valueFor(item, property));
		const first = values[0] ?? 0;
		return values.every((value) => Math.abs(value - first) < 0.1) ? first : null;
	}

	function itemAspectLocked(item: TimelineItem): boolean {
		return item.transform?.aspectRatioLocked ?? item.type !== 'text';
	}

	function aspectLocked(): boolean {
		return items.length > 0 && items.every(itemAspectLocked);
	}

	function autoKeyEnabled(property: KeyframeProperty): boolean {
		return (
			items.length > 0 && items.every((item) => autoKeyframeStore.isEnabled(item.id, property))
		);
	}

	function toggleAutoKey(property: KeyframeProperty): void {
		const enabled = !autoKeyEnabled(property);
		for (const item of items) {
			if (autoKeyframeStore.isEnabled(item.id, property) !== enabled) {
				autoKeyframeStore.toggle(item.id, property);
			}
		}
	}

	function valuesFor(property: KeyframeProperty, value: number) {
		if (property !== 'width' && property !== 'height') {
			return { [property]: value };
		}
		const width = mixedValue('width');
		const height = mixedValue('height');
		if (!aspectLocked() || width === null || height === null || height <= 0) {
			return { [property]: value };
		}
		const ratio = width / height;
		return property === 'width'
			? { width: value, height: Math.max(1, Math.round(value / ratio)) }
			: { width: Math.max(1, Math.round(value * ratio)), height: value };
	}

	function beginGesture(): void {
		gesture ??= beginAnimatedPropertyEdit();
	}

	function writeLive(property: KeyframeProperty, value: number): void {
		if (!Number.isFinite(value)) return;
		beginGesture();
		const values = valuesFor(property, value);
		for (const item of items) {
			updateAnimatedPropertiesLive(item.id, timelineStore.currentFrame, values, (key) =>
				autoKeyframeStore.isEnabled(item.id, key)
			);
		}
	}

	function commitGesture(property: KeyframeProperty, value: number): void {
		if (!Number.isFinite(value) || items.length === 0) return;
		if (!gesture) writeLive(property, value);
		const before = gesture;
		if (!before) return;
		// SAFETY: valuesFor only creates keys from the closed KeyframeProperty input type.
		const properties = Object.keys(valuesFor(property, value)) as KeyframeProperty[];
		commitAnimatedPropertyEdit(before, selectedIds, properties);
		gesture = null;
		onedit();
	}

	function cancelGesture(): void {
		if (!gesture) return;
		cancelAnimatedPropertyEdit(gesture);
		gesture = null;
	}

	function reset(
		valuesForItem: (item: TimelineItem) => Partial<Record<KeyframeProperty, number>>
	): void {
		let changed = false;
		executeAtomic('RESET_CLIP_TRANSFORM', () => {
			for (const item of items) {
				changed =
					setAnimatedProperties(
						item.id,
						timelineStore.currentFrame,
						valuesForItem(item),
						(property) => autoKeyframeStore.isEnabled(item.id, property)
					) || changed;
			}
		});
		if (changed) onedit();
	}

	function resetSize(): void {
		const frameWidth = editorSession.project?.metadata.width ?? 1920;
		const frameHeight = editorSession.project?.metadata.height ?? 1080;
		reset((item) => {
			if (item.type === 'shape' || item.type === 'text') {
				const size = Math.min(valueFor(item, 'width'), valueFor(item, 'height'));
				return { width: size, height: size };
			}
			const media = item.mediaId ? mediaPool.get(item.mediaId) : undefined;
			return {
				width: item.sourceWidth ?? media?.width ?? frameWidth,
				height: item.sourceHeight ?? media?.height ?? frameHeight
			};
		});
	}

	function toggleAspectLock(): void {
		const locked = !aspectLocked();
		executeAtomic('SET_CLIP_ASPECT_LOCK', () => {
			for (const item of items) {
				updateItemProperties(
					item.id,
					{ transform: { ...item.transform, aspectRatioLocked: locked } },
					'SET_CLIP_ASPECT_LOCK'
				);
			}
		});
		onedit();
	}

	function toggleFlip(property: 'flipHorizontal' | 'flipVertical'): void {
		const enabled = items.every((item) => item.transform?.[property] === true);
		executeAtomic('FLIP_CLIPS', () => {
			for (const item of items) {
				updateItemProperties(
					item.id,
					{ transform: { ...item.transform, [property]: !enabled } },
					'FLIP_CLIPS'
				);
			}
		});
		onedit();
	}

	function mixedBlendMode(): BlendMode | undefined {
		if (items.length === 0) return 'normal';
		const first = items[0]?.blendMode ?? 'normal';
		return items.every((item) => (item.blendMode ?? 'normal') === first) ? first : undefined;
	}

	function hasShapeMask(): boolean {
		return items.some((item) => item.type === 'shape' && item.isMask === true);
	}

	function setBlendMode(value: string): void {
		const mode = ALL_BLEND_MODES.find((candidate) => candidate === value);
		if (!mode || hasShapeMask()) return;
		let changed = false;
		executeAtomic('SET_ITEM_BLEND_MODE', () => {
			for (const item of items) {
				if ((item.blendMode ?? 'normal') === mode) continue;
				changed = true;
				updateItemProperties(item.id, { blendMode: mode }, 'SET_ITEM_BLEND_MODE');
			}
		});
		if (changed) onedit();
	}
</script>

{#snippet numberControl(
	property: KeyframeProperty,
	shortLabel: string,
	ariaLabel: string,
	unit: string,
	min: number | undefined,
	max: number | undefined
)}
	<div class="flex min-w-0 flex-1 items-center gap-0.5">
		<div class="relative min-w-0 flex-1">
			<span
				class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[9px] font-semibold text-white/38"
				>{shortLabel}</span
			>
			<ScrubbableNumberInput
				{ariaLabel}
				value={mixedValue(property)}
				placeholder={m.video_editor_property_mixed()}
				{min}
				{max}
				step={1}
				decimals={0}
				class="h-7 w-full rounded border border-white/8 bg-black/18 py-1 pr-7 pl-5 text-right text-[11px] text-white/88 tabular-nums transition-colors outline-none hover:border-white/14 focus:border-[oklch(0.66_0.14_45)] focus:ring-1 focus:ring-[oklch(0.66_0.14_45/0.35)]"
				onbegin={beginGesture}
				onlive={(value) => writeLive(property, value)}
				oncommit={(value) => commitGesture(property, value)}
				oncancel={cancelGesture}
			/>
			<span
				class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[9px] text-white/30"
				>{unit}</span
			>
		</div>
		<button
			type="button"
			class:active={autoKeyEnabled(property)}
			class="grid size-6 shrink-0 place-items-center rounded text-white/38 transition-colors hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:text-[oklch(0.78_0.16_55)]"
			aria-label={m.video_editor_property_auto_key({ property: ariaLabel })}
			aria-pressed={autoKeyEnabled(property)}
			onclick={() => toggleAutoKey(property)}
		>
			<DiamondIcon
				class={`size-2.5 ${autoKeyEnabled(property) ? 'fill-current' : ''}`}
				aria-hidden="true"
			/>
		</button>
	</div>
{/snippet}

<div class="flex flex-col gap-2" data-testid="clip-transform-panel">
	<section
		class="overflow-hidden rounded-md border border-white/8 bg-white/[0.025]"
		data-testid="clip-transform-section"
	>
		<h3
			class="flex h-8 items-center gap-2 border-b border-white/7 px-2.5 text-[10px] font-semibold tracking-wider text-white/58 uppercase"
		>
			<MoveIcon class="size-3.5 text-white/42" aria-hidden="true" />
			{m.video_editor_property_transform()}
		</h3>
		<div class="divide-y divide-white/6">
			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 px-2.5 py-2">
				<span class="pt-1.5 text-[10px] font-medium text-white/48"
					>{m.video_editor_property_position()}</span
				>
				<div class="flex min-w-0 items-start gap-1">
					<div class="grid min-w-0 flex-1 grid-cols-2 gap-1">
						{@render numberControl(
							'x',
							'X',
							m.video_editor_position_x(),
							'px',
							undefined,
							undefined
						)}
						{@render numberControl(
							'y',
							'Y',
							m.video_editor_position_y(),
							'px',
							undefined,
							undefined
						)}
					</div>
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						aria-label={m.video_editor_property_reset_position()}
						onclick={() => reset(() => ({ x: 0, y: 0 }))}
					>
						<RotateCcwIcon class="size-3.5" aria-hidden="true" />
					</button>
				</div>
			</div>

			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 px-2.5 py-2">
				<span class="pt-1.5 text-[10px] font-medium text-white/48"
					>{m.video_editor_property_size()}</span
				>
				<div class="flex min-w-0 items-start gap-1">
					<div class="grid min-w-0 flex-1 grid-cols-2 gap-1">
						{@render numberControl('width', 'W', m.video_editor_property_width(), 'px', 1, 7680)}
						{@render numberControl('height', 'H', m.video_editor_property_height(), 'px', 1, 7680)}
					</div>
					<button
						type="button"
						class:active={aspectLocked()}
						class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:text-[oklch(0.78_0.16_55)]"
						aria-label={aspectLocked()
							? m.video_editor_property_unlock_aspect()
							: m.video_editor_property_lock_aspect()}
						aria-pressed={aspectLocked()}
						onclick={toggleAspectLock}
					>
						{#if aspectLocked()}<LinkIcon class="size-3.5" aria-hidden="true" />{:else}<UnlinkIcon
								class="size-3.5"
								aria-hidden="true"
							/>{/if}
					</button>
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						aria-label={m.video_editor_property_reset_size()}
						onclick={resetSize}
					>
						<RotateCcwIcon class="size-3.5" aria-hidden="true" />
					</button>
				</div>
			</div>

			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 px-2.5 py-2">
				<span class="pt-1.5 text-[10px] font-medium text-white/48">{m.video_editor_rotation()}</span
				>
				<div class="flex min-w-0 items-center gap-1">
					<Slider
						class="h-7 min-w-10 flex-1 [&_[data-slot=slider-thumb]]:shadow-none"
						min={-180}
						max={180}
						step={1}
						value={mixedValue('rotation') ?? 0}
						ariaLabel={m.video_editor_rotation()}
						onValueChange={(nextValue) => {
							beginGesture();
							writeLive('rotation', nextValue);
						}}
						onValueCommit={(nextValue) => commitGesture('rotation', nextValue)}
						onValueCancel={cancelGesture}
						onKeydown={(event) => event.stopPropagation()}
					/>
					<div class="w-[5.6rem] shrink-0">
						{@render numberControl('rotation', '', m.video_editor_rotation(), '°', -360, 360)}
					</div>
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						aria-label={m.video_editor_property_reset_rotation()}
						onclick={() => reset(() => ({ rotation: 0 }))}
					>
						<RotateCcwIcon class="size-3.5" aria-hidden="true" />
					</button>
				</div>
			</div>

			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 px-2.5 py-2">
				<span class="pt-1.5 text-[10px] font-medium text-white/48"
					>{m.video_editor_property_anchor()}</span
				>
				<div class="flex min-w-0 items-start gap-1">
					<div class="grid min-w-0 flex-1 grid-cols-2 gap-1">
						{@render numberControl(
							'anchorX',
							'X',
							m.video_editor_property_anchor_x(),
							'px',
							undefined,
							undefined
						)}
						{@render numberControl(
							'anchorY',
							'Y',
							m.video_editor_property_anchor_y(),
							'px',
							undefined,
							undefined
						)}
					</div>
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						aria-label={m.video_editor_property_reset_anchor()}
						onclick={() =>
							reset((item) => ({
								anchorX: valueFor(item, 'width') / 2,
								anchorY: valueFor(item, 'height') / 2
							}))}
					>
						<RotateCcwIcon class="size-3.5" aria-hidden="true" />
					</button>
				</div>
			</div>

			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
				<span class="text-[10px] font-medium text-white/48">{m.video_editor_property_flip()}</span>
				<div class="grid grid-cols-2 gap-1">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						class="h-7 justify-center border border-white/8 px-2 text-[10px]"
						aria-pressed={items.every((item) => item.transform?.flipHorizontal === true)}
						onclick={() => toggleFlip('flipHorizontal')}>{m.video_editor_property_flip_x()}</Button
					>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						class="h-7 justify-center border border-white/8 px-2 text-[10px]"
						aria-pressed={items.every((item) => item.transform?.flipVertical === true)}
						onclick={() => toggleFlip('flipVertical')}>{m.video_editor_property_flip_y()}</Button
					>
				</div>
			</div>
		</div>
	</section>

	<section class="overflow-hidden rounded-md border border-white/8 bg-white/[0.025]">
		<h3
			class="flex h-8 items-center border-b border-white/7 px-2.5 text-[10px] font-semibold tracking-wider text-white/58 uppercase"
		>
			{m.video_editor_property_appearance()}
		</h3>
		<div class="divide-y divide-white/6">
			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
				<span class="text-[10px] font-medium text-white/48">{m.video_editor_clip_opacity()}</span>
				<div class="flex min-w-0 items-center gap-1">
					<Slider
						class="h-7 min-w-10 flex-1 [&_[data-slot=slider-thumb]]:shadow-none"
						min={0}
						max={100}
						step={1}
						value={(mixedValue('opacity') ?? 1) * 100}
						ariaLabel={m.video_editor_clip_opacity()}
						onValueChange={(nextValue) => {
							beginGesture();
							writeLive('opacity', nextValue / 100);
						}}
						onValueCommit={(nextValue) => commitGesture('opacity', nextValue / 100)}
						onValueCancel={cancelGesture}
						onKeydown={(event) => event.stopPropagation()}
					/>
					<div class="relative w-[4.5rem] shrink-0">
						<ScrubbableNumberInput
							ariaLabel={m.video_editor_clip_opacity()}
							value={mixedValue('opacity') === null ? null : (mixedValue('opacity') ?? 1) * 100}
							placeholder={m.video_editor_property_mixed()}
							min={0}
							max={100}
							step={1}
							decimals={0}
							class="h-7 w-full rounded border border-white/8 bg-black/18 py-1 pr-5 pl-1.5 text-right text-[11px] tabular-nums outline-none"
							onbegin={beginGesture}
							onlive={(value) => writeLive('opacity', value / 100)}
							oncommit={(value) => commitGesture('opacity', value / 100)}
							oncancel={cancelGesture}
						/>
						<span
							class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[9px] text-white/30"
							>%</span
						>
					</div>
					<button
						type="button"
						class:active={autoKeyEnabled('opacity')}
						class="grid size-6 shrink-0 place-items-center rounded text-white/38 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:text-[oklch(0.78_0.16_55)]"
						aria-label={m.video_editor_property_auto_key({
							property: m.video_editor_clip_opacity()
						})}
						aria-pressed={autoKeyEnabled('opacity')}
						onclick={() => toggleAutoKey('opacity')}
					>
						<DiamondIcon
							class={`size-2.5 ${autoKeyEnabled('opacity') ? 'fill-current' : ''}`}
							aria-hidden="true"
						/>
					</button>
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						aria-label={m.video_editor_property_reset_opacity()}
						onclick={() => reset(() => ({ opacity: 1 }))}
					>
						<RotateCcwIcon class="size-3.5" aria-hidden="true" />
					</button>
				</div>
			</div>
			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
				<span class="text-[10px] font-medium text-white/48">{m.video_editor_blend_mode()}</span>
				<AppSelect
					class="h-7 min-w-0 text-xs"
					value={hasShapeMask() ? 'normal' : mixedBlendMode()}
					options={blendOptions}
					placeholder={m.video_editor_property_mixed()}
					ariaLabel={m.video_editor_blend_mode()}
					disabled={hasShapeMask()}
					onValueChange={setBlendMode}
				/>
			</div>
			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
				<span class="text-[10px] font-medium text-white/48">{m.video_editor_property_radius()}</span
				>
				<div class="flex min-w-0 items-center gap-1">
					{@render numberControl(
						'cornerRadius',
						'',
						m.video_editor_property_radius(),
						'px',
						0,
						1000
					)}
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						aria-label={m.video_editor_property_reset_radius()}
						onclick={() => reset(() => ({ cornerRadius: 0 }))}
					>
						<RotateCcwIcon class="size-3.5" aria-hidden="true" />
					</button>
				</div>
			</div>
		</div>
	</section>
</div>
