<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import type { EasingType, SpeedRampPoint, TimelineItem } from '$lib/video-editor/project/types';
	import {
		addItemsSpeedPoint,
		removeItemsSpeedPoint,
		updateItemsSpeedPoint
	} from '$lib/video-editor/timeline/actions/items';
	import { applyEasing } from '$lib/video-editor/timeline/easing';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let { itemId, itemIds, onedit }: { itemId: string; itemIds: string[]; onedit: () => void } =
		$props();

	const selectedIds = $derived(itemIds.length > 0 ? itemIds : [itemId]);
	const item = $derived(timelineStore.itemById.get(itemId));
	const points = $derived(
		[...(item?.speedRamp ?? [])].sort((left, right) => left.sourceFrame - right.sourceFrame)
	);
	const canAdd = $derived(
		item !== undefined &&
			(item.type === 'video' || item.type === 'audio') &&
			timelineStore.currentFrame >= item.from &&
			timelineStore.currentFrame <= item.from + item.durationInFrames
	);
	const easingOptions: AppSelectOption[] = [
		{ value: 'linear' as const, label: m.video_editor_keyframe_easing_linear() },
		{ value: 'hold' as const, label: m.video_editor_keyframe_easing_hold() },
		{ value: 'ease-in' as const, label: m.video_editor_keyframe_easing_in() },
		{ value: 'ease-out' as const, label: m.video_editor_keyframe_easing_out() },
		{ value: 'ease-in-out' as const, label: m.video_editor_keyframe_easing_in_out() },
		{ value: 'cubic-bezier' as const, label: m.video_editor_keyframe_easing_bezier() },
		{ value: 'spring' as const, label: m.video_editor_keyframe_easing_spring() }
	];

	function pointLabel(index: number): string {
		return `${m.video_editor_clip_speed()} ${index + 1}`;
	}

	function formatSourceTime(point: SpeedRampPoint, source: TimelineItem | undefined): string {
		const fps = source?.sourceFps ?? timelineStore.fps;
		const totalSeconds = point.sourceFrame / fps;
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = Math.floor(totalSeconds % 60);
		const milliseconds = Math.round((totalSeconds % 1) * 1000);
		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
	}

	function addPoint(): void {
		const result = addItemsSpeedPoint(selectedIds, timelineStore.currentFrame);
		if (result.changed.length > 0) onedit();
	}

	function updatePoint(pointId: string, patch: { speed?: number; easing?: EasingType }): void {
		const result = updateItemsSpeedPoint(selectedIds, pointId, patch);
		if (result.changed.length > 0) onedit();
	}

	function removePoint(pointId: string): void {
		const result = removeItemsSpeedPoint(selectedIds, pointId);
		if (result.changed.length > 0) onedit();
	}

	function speedY(speed: number): number {
		const normalized = (Math.log2(Math.max(0.1, speed)) - Math.log2(0.1)) / Math.log2(160);
		return 42 - normalized * 34;
	}

	function sourceX(sourceFrame: number): number {
		const sourceStart = item?.sourceStart ?? 0;
		const sourceEnd = item?.sourceEnd ?? sourceStart + 1;
		return 8 + ((sourceFrame - sourceStart) / Math.max(1, sourceEnd - sourceStart)) * 184;
	}

	function curvePath(): string {
		if (points.length === 0) return '';
		const commands: string[] = [];
		for (let index = 0; index < points.length - 1; index += 1) {
			const point = points[index]!;
			const next = points[index + 1]!;
			for (let sample = 0; sample <= 12; sample += 1) {
				if (index > 0 && sample === 0) continue;
				const progress = sample / 12;
				const eased = applyEasing(progress, point.easing);
				const sourceFrame = point.sourceFrame + (next.sourceFrame - point.sourceFrame) * progress;
				const speed = point.speed + (next.speed - point.speed) * eased;
				commands.push(
					`${commands.length === 0 ? 'M' : 'L'} ${sourceX(sourceFrame)} ${speedY(speed)}`
				);
			}
		}
		return commands.join(' ');
	}
</script>

<div class="space-y-2 px-2.5 py-2" data-testid="speed-ramp-editor">
	<div class="flex items-center justify-between gap-2">
		<span class="text-[10px] font-medium text-white/48">{m.video_editor_clip_speed_curve()}</span>
		<button
			type="button"
			class="inline-flex h-7 items-center gap-1 rounded border border-white/10 bg-white/[0.035] px-2 text-[10px] font-medium text-white/68 hover:border-white/18 hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:cursor-not-allowed disabled:opacity-35"
			disabled={!canAdd}
			onclick={addPoint}
		>
			<PlusIcon class="size-3" aria-hidden="true" />
			{m.video_editor_path_add_point()}
		</button>
	</div>

	{#if points.length > 0}
		<svg
			viewBox="0 0 200 50"
			class="h-14 w-full rounded border border-white/7 bg-black/16"
			role="img"
			aria-label={m.video_editor_clip_speed()}
		>
			<path d="M 8 42 H 192" stroke="currentColor" class="text-white/8" />
			<path d={curvePath()} fill="none" stroke="oklch(0.72 0.15 50)" stroke-width="1.75" />
			{#each points as point}
				<circle
					cx={sourceX(point.sourceFrame)}
					cy={speedY(point.speed)}
					r="2.75"
					fill="oklch(0.8 0.13 55)"
					stroke="oklch(0.16 0.01 50)"
					stroke-width="1"
				/>
			{/each}
		</svg>

		<div class="space-y-1">
			{#each points as point, index (point.id)}
				<div class="grid grid-cols-[3.7rem_minmax(0,1fr)_1.1fr_1.75rem] items-center gap-1">
					<span
						class="truncate text-[9px] text-white/36 tabular-nums"
						title={formatSourceTime(point, item)}
					>
						{formatSourceTime(point, item)}
					</span>
					<div class="relative min-w-0">
						<Input
							type="number"
							min="0.1"
							max="16"
							step="0.05"
							value={point.speed}
							aria-label={pointLabel(index)}
							class="h-7 w-full rounded border border-white/8 bg-black/18 py-1 pr-4 pl-1.5 text-right text-[10px] text-white/76 tabular-nums outline-none focus:border-[oklch(0.66_0.14_45)]"
							onchange={(event) =>
								updatePoint(point.id, { speed: event.currentTarget.valueAsNumber })}
						/>
						<span
							class="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-[8px] text-white/28"
							>×</span
						>
					</div>
					<AppSelect
						value={point.easing}
						options={easingOptions}
						ariaLabel={m.video_editor_keyframe_graph_segment_easing({
							frame: point.sourceFrame
						})}
						class="h-7 min-w-0 rounded border border-white/8 bg-black/18 px-1 text-[9px] text-white/68 outline-none focus:border-[oklch(0.66_0.14_45)]"
						onValueChange={(value) => updatePoint(point.id, { easing: value as EasingType })}
					/>
					<button
						type="button"
						class="grid size-7 place-items-center rounded text-white/28 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						aria-label={`${m.common_delete()} ${pointLabel(index)}`}
						onclick={() => removePoint(point.id)}
					>
						<Trash2Icon class="size-3.25" aria-hidden="true" />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
