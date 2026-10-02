<script lang="ts">
	import { onDestroy } from 'svelte';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import type { EasingType, SpeedRampPoint, TimelineItem } from '$lib/video-editor/project/types';
	import {
		addItemsSpeedPoint,
		speedPointSourceFrameRange,
		removeItemsSpeedPoint,
		updateItemsSpeedPoint
	} from '$lib/video-editor/timeline/actions/items';
	import { applyEasing } from '$lib/video-editor/timeline/easing';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { ThemeIcon } from '$lib/themes/icons';

	let { itemId, itemIds, onedit }: { itemId: string; itemIds: string[]; onedit: () => void } =
		$props();

	let collision = $state.raw<{ item: TimelineItem | undefined; frame: number } | null>(null);
	const selectedIds = $derived(itemIds.length > 0 ? itemIds : [itemId]);
	const item = $derived(timelineStore.itemById.get(itemId));
	const authoredPoints = $derived(
		[...(item?.speedRamp ?? [])].sort((left, right) => left.sourceFrame - right.sourceFrame)
	);
	let drag = $state.raw<{
		pointId: string;
		item: TimelineItem;
		itemIds: string[];
		pointerId: number;
		target: HTMLButtonElement;
		sourceFrame: number;
		speed: number;
	} | null>(null);
	const points = $derived(
		drag && drag.item === item
			? authoredPoints.map((point) =>
					point.id === drag!.pointId
						? { ...point, sourceFrame: drag!.sourceFrame, speed: drag!.speed }
						: point
				)
			: authoredPoints
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
		collision =
			result.changed.length === 0 && result.occupied
				? { item, frame: timelineStore.currentFrame }
				: null;
		if (result.changed.length > 0) onedit();
	}

	function updatePoint(
		pointId: string,
		patch: { sourceFrame?: number; speed?: number; easing?: EasingType }
	): void {
		const result = updateItemsSpeedPoint(selectedIds, pointId, patch);
		if (result.changed.length > 0) onedit();
	}

	function startDrag(
		point: SpeedRampPoint,
		event: PointerEvent & { currentTarget: HTMLButtonElement }
	): void {
		if (event.button !== 0 || !item) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag = {
			pointId: point.id,
			item,
			itemIds: [...selectedIds],
			pointerId: event.pointerId,
			target: event.currentTarget,
			sourceFrame: point.sourceFrame,
			speed: point.speed
		};
	}
	function moveDrag(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (drag.item !== item) {
			cancelDrag();
			return;
		}
		const bounds = drag.target.parentElement!.getBoundingClientRect();
		const x = ((event.clientX - bounds.left) / bounds.width) * 200;
		const y = ((event.clientY - bounds.top) / bounds.height) * 50;
		const range = speedPointSourceFrameRange(drag.item, drag.pointId);
		const frame =
			(drag.item.sourceStart ?? 0) +
			(x / 200) * ((drag.item.sourceEnd ?? 1) - (drag.item.sourceStart ?? 0));
		drag = {
			...drag,
			sourceFrame: range
				? Math.max(range.min, Math.min(range.max, Math.round(frame)))
				: drag.sourceFrame,
			speed: Math.max(0.1, Math.min(16, Math.round(0.1 * 160 ** ((50 - y) / 50) * 100) / 100))
		};
	}
	function cancelDrag(): void {
		const current = drag;
		drag = null;
		if (current?.target.hasPointerCapture(current.pointerId))
			current.target.releasePointerCapture(current.pointerId);
	}
	function finishDrag(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		moveDrag(event);
		const current = drag;
		cancelDrag();
		if (!current || current.item !== item) return;
		const result = updateItemsSpeedPoint(current.itemIds, current.pointId, {
			sourceFrame: current.sourceFrame,
			speed: current.speed
		});
		if (result.changed.length > 0) onedit();
	}
	function pointKey(point: SpeedRampPoint, event: KeyboardEvent): void {
		if (event.key === 'Escape' && drag) {
			event.preventDefault();
			event.stopPropagation();
			cancelDrag();
			return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const step = event.shiftKey ? 10 : 1;
		const patch =
			event.key === 'ArrowLeft' || event.key === 'ArrowRight'
				? { sourceFrame: point.sourceFrame + (event.key === 'ArrowRight' ? step : -step) }
				: {
						speed:
							Math.round((point.speed + (event.key === 'ArrowUp' ? step : -step) * 0.05) * 100) /
							100
					};
		updatePoint(point.id, patch);
	}

	onDestroy(cancelDrag);
	function removePoint(pointId: string): void {
		const result = removeItemsSpeedPoint(selectedIds, pointId);
		if (result.changed.length > 0) onedit();
	}

	function speedY(speed: number): number {
		const normalized = (Math.log2(Math.max(0.1, speed)) - Math.log2(0.1)) / Math.log2(160);
		return 50 - normalized * 50;
	}

	function sourceX(sourceFrame: number): number {
		const sourceStart = item?.sourceStart ?? 0;
		const sourceEnd = item?.sourceEnd ?? sourceStart + 1;
		return ((sourceFrame - sourceStart) / Math.max(1, sourceEnd - sourceStart)) * 200;
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

<div class="space-y-1.5 px-2 py-1.5" data-testid="speed-ramp-editor">
	<div class="flex items-center justify-between gap-2">
		<span class="text-[10px] font-medium text-[var(--video-editor-muted)]"
			>{m.video_editor_clip_speed_curve()}</span
		>
		<button
			type="button"
			class="inline-flex h-[22px] items-center gap-1 rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] px-2 text-[10px] font-medium text-[var(--video-editor-muted)] hover:border-[var(--video-editor-focus-border)] hover:bg-[var(--video-editor-control-hover)] hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:cursor-not-allowed disabled:opacity-35"
			disabled={!canAdd}
			onclick={addPoint}
		>
			<ThemeIcon role="add" class="size-3" />
			{m.video_editor_path_add_point()}
		</button>
	</div>

	{#if collision && collision.item === item && collision.frame === timelineStore.currentFrame}
		<p role="status" class="text-[10px] text-[var(--video-editor-muted)]">
			{m.video_editor_speed_point_occupied()}
		</p>
	{/if}
	{#if points.length > 0}
		<div
			class="relative h-32 rounded border border-white/7 bg-black/16"
			role="group"
			aria-label={m.video_editor_clip_speed()}
		>
			<div class="absolute inset-[22px]">
				<svg
					viewBox="0 0 200 50"
					class="h-full w-full"
					preserveAspectRatio="none"
					data-editor-protected="speed-curve"
					aria-hidden="true"
				>
					<path d="M 0 50 H 200" stroke="currentColor" class="text-white/8" />
					<path
						d={curvePath()}
						fill="none"
						stroke="oklch(0.72 0.15 50)"
						stroke-width="1.75"
						vector-effect="non-scaling-stroke"
					/>
				</svg>
				{#each points as point, index (point.id)}
					<button
						type="button"
						aria-label={pointLabel(index)}
						title={`${formatSourceTime(point, item)} · ${point.speed}×`}
						class="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center rounded focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
						style:left={`${sourceX(point.sourceFrame) / 2}%`}
						style:top={`${speedY(point.speed) * 2}%`}
						onpointerdown={(event) => startDrag(point, event)}
						onpointermove={moveDrag}
						onpointerup={finishDrag}
						onpointercancel={cancelDrag}
						onlostpointercapture={cancelDrag}
						onkeydown={(event) => pointKey(point, event)}
					>
						<span
							class="size-1.5 rounded-full border border-[oklch(0.16_0.01_50)] bg-[oklch(0.8_0.13_55)]"
						></span>
					</button>
				{/each}
			</div>
		</div>

		<p class="text-[10px] text-[var(--video-editor-muted)]">{m.video_editor_speed_curve_hint()}</p>
		<div class="space-y-1">
			<div
				class="grid grid-cols-[3.7rem_minmax(0,1fr)_1.1fr_1.75rem] gap-1 text-[9px] text-[var(--video-editor-muted)]"
			>
				<span>{m.video_editor_marker_frame()}</span><span>{m.video_editor_clip_speed()}</span><span
					>{m.video_editor_keyframe_easing()}</span
				>
			</div>
			{#each points as point, index (point.id)}
				{@const range = item ? speedPointSourceFrameRange(item, point.id) : null}
				<div class="grid grid-cols-[3.7rem_minmax(0,1fr)_1.1fr_1.75rem] items-center gap-1">
					<Input
						type="number"
						min={range?.min}
						max={range?.max}
						step="1"
						value={point.sourceFrame}
						disabled={!range}
						aria-label={m.video_editor_speed_point_time({ index: index + 1 })}
						title={formatSourceTime(point, item)}
						class="h-[22px] w-full rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-field)] px-1 text-right text-[10px] text-[var(--video-editor-field-text)] tabular-nums outline-none focus:border-[var(--video-editor-focus-border)]"
						onchange={(event) => {
							updatePoint(point.id, { sourceFrame: event.currentTarget.valueAsNumber });
							event.currentTarget.value = String(
								timelineStore.itemById
									.get(itemId)
									?.speedRamp?.find((candidate) => candidate.id === point.id)?.sourceFrame ??
									point.sourceFrame
							);
						}}
					/>
					<div class="relative min-w-0">
						<Input
							type="number"
							min="0.1"
							max="16"
							step="0.05"
							value={point.speed}
							aria-label={pointLabel(index)}
							class="h-[22px] w-full rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-field)] py-1 pr-4 pl-1.5 text-right text-[10px] text-[var(--video-editor-field-text)] tabular-nums outline-none focus:border-[var(--video-editor-focus-border)]"
							onchange={(event) =>
								updatePoint(point.id, { speed: event.currentTarget.valueAsNumber })}
						/>
						<span
							class="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-[8px] text-[var(--video-editor-muted)]"
							>×</span
						>
					</div>
					<AppSelect
						value={point.easing}
						options={easingOptions}
						ariaLabel={m.video_editor_keyframe_graph_segment_easing({
							frame: point.sourceFrame
						})}
						class="h-[22px] min-w-0 rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-field)] px-1 text-[9px] text-[var(--video-editor-field-text)] outline-none focus:border-[var(--video-editor-focus-border)]"
						onValueChange={(value) => updatePoint(point.id, { easing: value as EasingType })}
					/>
					<button
						type="button"
						class="grid size-[22px] place-items-center rounded text-[var(--video-editor-muted)] hover:bg-[var(--video-editor-control-hover)] hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
						aria-label={`${m.common_delete()} ${pointLabel(index)}`}
						onclick={() => removePoint(point.id)}
					>
						<ThemeIcon role="delete" class="size-3.25" />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
