<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import {
		findTimelineDensityBucketItem,
		type TimelineDensityBucket
	} from '$lib/video-editor/timeline/timeline-viewport';

	let {
		buckets,
		selectedItemIds,
		locked,
		timelineX,
		frameToPx,
		onpointeritem,
		onselectitem
	}: {
		buckets: readonly TimelineDensityBucket[];
		selectedItemIds: readonly string[];
		locked: boolean;
		timelineX: (frame: number) => number;
		frameToPx: (frame: number) => number;
		onpointeritem: (event: PointerEvent, item: TimelineItem) => void;
		onselectitem: (event: MouseEvent, item: TimelineItem) => void;
	} = $props();

	const selectedIds = $derived(new Set(selectedItemIds));

	function bucketColor(item: TimelineItem): string {
		switch (item.type) {
			case 'audio':
				return 'border-[oklch(0.62_0.12_145)] bg-[oklch(0.48_0.1_145_/_0.72)]';
			case 'text':
			case 'subtitle':
				return 'border-[oklch(0.76_0.12_85)] bg-[oklch(0.55_0.11_85_/_0.7)]';
			case 'image':
			case 'shape':
				return 'border-[oklch(0.7_0.12_300)] bg-[oklch(0.5_0.1_300_/_0.7)]';
			case 'adjustment':
				return 'border-violet-400/70 bg-violet-950/70';
			default:
				return 'border-[oklch(0.7_0.13_45)] bg-[oklch(0.48_0.11_45_/_0.72)]';
		}
	}

	function itemAtPointer(event: PointerEvent, bucket: TimelineDensityBucket): TimelineItem {
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
		return findTimelineDensityBucketItem(
			bucket,
			bucket.from + Math.min(1, Math.max(0, ratio)) * bucket.durationInFrames
		);
	}
</script>

<div
	class="absolute inset-0"
	style="contain:layout style paint"
	data-timeline-density-overview
	data-density-bucket-count={buckets.length}
>
	{#each buckets as bucket (bucket.index)}
		{@const selected = bucket.items.some((item) => selectedIds.has(item.id))}
		<button
			type="button"
			class="absolute inset-y-px min-w-px overflow-hidden rounded-[2px] border {bucketColor(
				bucket.items[0]!
			)} {locked
				? 'cursor-not-allowed opacity-55'
				: 'cursor-pointer hover:brightness-125'} {selected
				? 'ring-1 ring-[oklch(0.82_0.15_65)]'
				: ''}"
			style="left:{timelineX(bucket.from)}px;width:{Math.max(
				1,
				frameToPx(bucket.durationInFrames)
			)}px"
			aria-label={m.video_editor_timeline_density_bucket({ count: bucket.items.length })}
			aria-disabled={locked}
			tabindex={selected || bucket.index === 0 ? 0 : -1}
			data-timeline-density-bucket={bucket.index}
			data-density-item-count={bucket.items.length}
			data-editor-shortcuts-enabled
			onpointerdown={(event) => {
				if (locked || event.button !== 0) return;
				event.stopPropagation();
				onpointeritem(event, itemAtPointer(event, bucket));
			}}
			onclick={(event) => {
				event.stopPropagation();
				if (locked || event.detail !== 0) return;
				onselectitem(event, bucket.items[0]!);
			}}
		></button>
	{/each}
</div>
