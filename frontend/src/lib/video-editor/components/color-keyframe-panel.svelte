<script lang="ts">
	import { onDestroy } from 'svelte';
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import AppSelect from '$lib/components/app-select.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { KeyframeProperty } from '$lib/video-editor/project/types';
	import {
		effectPropertyBaseValue,
		effectPropertyLabel,
		isEffectKeyframeProperty
	} from '$lib/video-editor/effects/effect-keyframes';
	import { getAnimatablePropertiesForItem } from '$lib/video-editor/timeline/animated-properties';
	import {
		editorKeyframes,
		keyframeIdentity,
		type EditorKeyframe
	} from '$lib/video-editor/timeline/keyframe-editor';
	import {
		activeValueAt,
		removeKeyframes,
		setKeyframe
	} from '$lib/video-editor/timeline/actions/keyframes';
	import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
	import { keyframeSelectionStore } from '$lib/video-editor/timeline/stores/keyframe-selection-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import KeyframeDopesheet from './keyframe-dopesheet.svelte';
	import KeyframeValueGraph from './keyframe-value-graph.svelte';

	type View = 'sheet' | 'graph';
	const MODE_STORAGE_KEY = 'timeline:keyframeEditorMode';
	const SOURCE_PROPERTY_COLUMN_WIDTH = 336;
	const MIN_TIMELINE_WIDTH = 96;

	let { itemId, onedit }: { itemId: string | null; onedit: () => void } = $props();
	let root = $state<HTMLElement | null>(null);
	let width = $state(440);
	let view = $state<View>(loadView());
	let activeProperty = $state<KeyframeProperty | null>(null);

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const properties = $derived.by((): KeyframeProperty[] => {
		if (!item) return [];
		return getAnimatablePropertiesForItem(item).filter(isEffectKeyframeProperty);
	});
	const propertyOptions = $derived(
		properties.map((property) => ({ value: property, label: label(property) }))
	);
	const allKeyframes = $derived.by(() =>
		item ? properties.flatMap((property) => editorKeyframes(item, property)) : []
	);
	const selectedIds = $derived(item ? keyframeSelectionStore.forItem(item.id) : new Set<string>());
	const selectedKeyframes = $derived(
		allKeyframes.filter((keyframe) => selectedIds.has(keyframeIdentity(keyframe)))
	);
	const propertyColumnWidth = $derived(
		Math.min(SOURCE_PROPERTY_COLUMN_WIDTH, Math.max(136, width - MIN_TIMELINE_WIDTH))
	);
	const pixelsPerFrame = $derived(
		item
			? Math.max(0.001, (width - propertyColumnWidth - 16) / Math.max(1, item.durationInFrames - 1))
			: 1
	);

	$effect(() => {
		if (!root) return;
		const observer = new ResizeObserver(([entry]) => {
			width = Math.max(240, Math.round(entry?.contentRect.width ?? 440));
		});
		observer.observe(root);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (activeProperty && properties.includes(activeProperty)) return;
		activeProperty = properties[0] ?? null;
		keyframeSelectionStore.clear();
	});

	onDestroy(() => {
		if (item && keyframeSelectionStore.itemId === item.id) keyframeSelectionStore.clear();
	});

	function loadView(): View {
		try {
			return localStorage.getItem(MODE_STORAGE_KEY) === 'graph' ? 'graph' : 'sheet';
		} catch {
			return 'sheet';
		}
	}

	function setView(next: View): void {
		view = next;
		try {
			localStorage.setItem(MODE_STORAGE_KEY, next === 'sheet' ? 'dopesheet' : next);
		} catch {
			// The editor still works when storage is unavailable.
		}
	}

	function label(property: KeyframeProperty): string {
		return item ? (effectPropertyLabel(item, property) ?? property) : property;
	}

	function addKeyframe(property: KeyframeProperty): void {
		if (!item) return;
		const relativeFrame = Math.max(
			0,
			Math.min(item.durationInFrames - 1, timelineStore.currentFrame - item.from)
		);
		const value =
			activeValueAt(item, property, timelineStore.currentFrame) ??
			effectPropertyBaseValue(item, property);
		if (value === null || !setKeyframe(item.id, property, relativeFrame, value)) return;
		activeProperty = property;
		onedit();
	}

	function selectKeyframe(keyframe: EditorKeyframe | null): void {
		if (keyframe) activeProperty = keyframe.property;
	}

	function deleteSelected(): void {
		if (!item || selectedKeyframes.length === 0) return;
		if (!removeKeyframes(item.id, selectedKeyframes)) return;
		keyframeSelectionStore.clear();
		onedit();
	}

	function timelineX(absoluteFrame: number): number {
		if (!item) return propertyColumnWidth + 8;
		const relativeFrame = Math.max(
			0,
			Math.min(item.durationInFrames - 1, absoluteFrame - item.from)
		);
		return propertyColumnWidth + 8 + relativeFrame * pixelsPerFrame;
	}
</script>

<section
	bind:this={root}
	class="flex h-full min-h-0 flex-col"
	aria-label={m.video_editor_keyframe_sheet_title()}
>
	<header
		class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3"
	>
		<div class="min-w-0">
			<h3 class="truncate text-xs font-semibold">{m.video_editor_keyframe_sheet_title()}</h3>
			{#if item}
				<p class="truncate text-[9px] text-white/35">
					{item.label} <span class="font-mono">({item.id.slice(0, 8)})</span>
				</p>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-1">
			<div class="flex overflow-hidden rounded-sm border border-white/12" role="tablist">
				<button
					type="button"
					class="view-button {view === 'sheet' ? 'view-button-active' : ''}"
					role="tab"
					aria-selected={view === 'sheet'}
					onclick={() => setView('sheet')}
				>
					{m.video_editor_keyframe_view_dopesheet()}
				</button>
				<button
					type="button"
					class="view-button border-l border-white/12 {view === 'graph'
						? 'view-button-active'
						: ''}"
					role="tab"
					aria-selected={view === 'graph'}
					onclick={() => setView('graph')}
				>
					{m.video_editor_keyframe_view_graph()}
				</button>
			</div>
			<button
				type="button"
				class="icon-button"
				disabled={selectedKeyframes.length === 0}
				aria-label={m.common_delete()}
				title={m.common_delete()}
				onclick={deleteSelected}
			>
				<Trash2Icon class="size-3" />
			</button>
		</div>
	</header>

	{#if !item}
		<p class="m-auto px-4 text-center text-xs text-white/40">{m.video_editor_select_clip()}</p>
	{:else if properties.length === 0}
		<div class="m-auto max-w-52 px-4 text-center">
			<DiamondIcon class="mx-auto mb-2 size-5 text-white/25" />
			<p class="text-xs text-white/45">Add a color effect to animate its controls.</p>
		</div>
	{:else if view === 'graph' && activeProperty}
		<div class="flex min-h-0 flex-1 flex-col">
			<div
				class="flex h-8 shrink-0 items-center gap-2 border-b border-white/8 px-2 text-[10px] text-white/50"
			>
				<span class="shrink-0">{m.video_editor_keyframe_property()}</span>
				<AppSelect
					class="h-6! min-w-0 flex-1 rounded-sm border-white/10 bg-black/35 px-1 text-[10px] text-white/80 shadow-none hover:bg-white/5"
					value={activeProperty}
					options={propertyOptions}
					ariaLabel={m.video_editor_keyframe_property()}
					onValueChange={(value) => {
						activeProperty = value as KeyframeProperty;
						keyframeSelectionStore.clear();
					}}
				/>
				<button
					type="button"
					class="icon-button"
					aria-label={m.video_editor_keyframe_sheet_add({ property: label(activeProperty) })}
					title={m.video_editor_keyframe_sheet_add({ property: label(activeProperty) })}
					onclick={() => addKeyframe(activeProperty!)}
				>
					<PlusIcon class="size-3" />
				</button>
			</div>
			<div class="min-h-0 flex-1 overflow-hidden">
				<KeyframeValueGraph
					{item}
					property={activeProperty}
					currentFrame={timelineStore.currentFrame}
					onscrub={setCurrentFrame}
					onselect={selectKeyframe}
					{onedit}
				/>
			</div>
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-hidden">
			<KeyframeDopesheet
				{item}
				availableProperties={properties}
				currentFrame={timelineStore.currentFrame}
				{pixelsPerFrame}
				timelineWidth={width}
				{timelineX}
				presentation="side"
				{propertyColumnWidth}
				initialFilter="all"
				onscrub={setCurrentFrame}
				onselect={selectKeyframe}
				onactiveproperty={(property) => (activeProperty = property)}
				{onedit}
			/>
		</div>
	{/if}
</section>

<style>
	.view-button {
		height: 1.5rem;
		padding-inline: 0.45rem;
		font-size: 0.5625rem;
		color: rgb(255 255 255 / 48%);
	}
	.view-button:hover,
	.icon-button:hover:not(:disabled) {
		background: rgb(255 255 255 / 7%);
		color: rgb(255 255 255 / 86%);
	}
	.view-button-active {
		background: rgb(251 146 60 / 18%);
		color: rgb(253 186 116);
	}
	.icon-button {
		display: flex;
		height: 1.5rem;
		width: 1.5rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.125rem;
		color: rgb(255 255 255 / 48%);
	}
	.icon-button:focus-visible,
	.view-button:focus-visible {
		outline: 2px solid rgb(251 146 60);
		outline-offset: -2px;
	}
	.icon-button:disabled {
		opacity: 0.3;
	}
</style>
