<!--
	Dashed drop placeholders for one timeline track: scenes, generated items,
	stickers, stock, Lottie, effect adjustment layers and media placement.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type {
		TimelineDropTargets,
		TimelineTrackDropPreview
	} from './timeline-drop-targets.svelte';

	let {
		drops,
		trackId,
		clipStyle,
		timelineX,
		frameToPx
	}: {
		drops: TimelineDropTargets;
		trackId: string;
		clipStyle: (item: { from: number; durationInFrames: number; type: string }) => string;
		timelineX: (frame: number) => number;
		frameToPx: (frame: number) => number;
	} = $props();

	const media = $derived(drops.mediaDropPreview);
	const placeholders = $derived(
		[
			{
				preview: drops.generatedItemDropPreview,
				type: 'text',
				marker: 'data-generated-item-drop-preview',
				tone: 'border-fuchsia-300 bg-fuchsia-950/80'
			},
			{
				preview: drops.stickerDropPreview,
				type: 'image',
				marker: 'data-sticker-drop-preview',
				tone: 'border-amber-300 bg-amber-950/80'
			},
			{
				preview: drops.stockDropPreview,
				type: 'video',
				marker: 'data-stock-drop-preview',
				tone: 'border-sky-300 bg-sky-950/80'
			},
			{
				preview: drops.lottieDropPreview,
				type: 'video',
				marker: 'data-lottie-drop-preview',
				tone: 'border-violet-300 bg-violet-950/80'
			},
			{
				preview: drops.effectAdjustmentDropPreview,
				type: 'adjustment',
				marker: 'data-effect-adjustment-drop-preview',
				tone: 'border-[oklch(0.72_0.14_45)] bg-[oklch(0.3_0.08_45_/_0.84)]'
			}
		].filter(
			(entry): entry is typeof entry & { preview: TimelineTrackDropPreview } =>
				entry.preview?.trackId === trackId
		)
	);
</script>

{#if drops.sceneDropPreview?.trackId === trackId}
	<div
		class="pointer-events-none absolute top-1 z-20 h-[calc(100%-8px)] overflow-hidden rounded-sm border border-dashed border-[oklch(0.72_0.13_45)] bg-[oklch(0.4_0.04_250_/_0.78)] px-2 py-1 text-xs text-white shadow-lg"
		style={clipStyle({
			from: drops.sceneDropPreview.from,
			durationInFrames: drops.sceneDropPreview.durationInFrames,
			type: 'video'
		})}
		data-scene-drop-preview
	>
		<span class="block truncate">{drops.sceneDropPreview.label}</span>
		<span class="sr-only" role="status" aria-live="polite">
			{m.video_editor_scene_drop_ready()}
		</span>
	</div>
{/if}
{#each placeholders as { preview, type, marker, tone } (marker)}
	<div
		class="pointer-events-none absolute top-1 z-20 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-sm border border-dashed px-2 py-1 text-xs text-white shadow-lg {tone}"
		style={clipStyle({ from: preview.from, durationInFrames: preview.durationInFrames, type })}
		{...{ [marker]: '' }}
	>
		<span class="block truncate">{preview.label}</span>
	</div>
{/each}
{#if media && (media.trackId === trackId || media.secondaryTrackId === trackId)}
	<div
		class="pointer-events-none absolute top-1 z-20 flex h-[calc(100%-8px)] items-center overflow-hidden rounded-sm border border-dashed px-2 py-1 text-xs text-white shadow-lg {media.valid
			? 'border-[oklch(0.72_0.14_145)] bg-[oklch(0.32_0.09_145_/_0.86)]'
			: 'border-red-400 bg-red-500/25'}"
		style={`left:${timelineX(media.from)}px;width:${frameToPx(media.durationInFrames)}px`}
		data-media-drop-preview
		data-valid={String(media.valid)}
		data-reason={media.reason ?? undefined}
		data-secondary={String(media.secondaryTrackId === trackId)}
	>
		<span class="block truncate">{media.label}</span>
	</div>
{/if}
