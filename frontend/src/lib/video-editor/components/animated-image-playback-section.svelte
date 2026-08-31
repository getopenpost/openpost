<script lang="ts">
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { isAnimatedImageMedia } from '$lib/video-editor/media/animated-image-plan';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import {
		setAnimatedImagesReversed,
		setAnimatedImageSpeed,
		setAnimatedImageSpeedLive
	} from '$lib/video-editor/timeline/actions/animated-image-playback';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import {
		captureSnapshot,
		restoreSnapshot
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
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
					candidate?.type === 'image' &&
					isAnimatedImageMedia(mediaPool.get(candidate.mediaId ?? ''))
			);
	});
	const selectedIds = $derived(items.map((item) => item.id));
	const speedValue = $derived(mixedValue((item) => item.speed ?? 1));
	let gesture = $state<{ before: TimelineSnapshot; changed: boolean } | null>(null);

	function mixedValue(valueFor: (item: TimelineItem) => number): number | null {
		if (items.length === 0) return null;
		const values = items.map(valueFor);
		const first = values[0] ?? 0;
		return values.every((value) => Math.abs(value - first) < 0.005) ? first : null;
	}

	function beginGesture(): void {
		if (gesture) return;
		gesture = { before: captureSnapshot(), changed: false };
	}

	function writeSpeed(value: number): void {
		if (!Number.isFinite(value)) return;
		beginGesture();
		const result = setAnimatedImageSpeedLive(selectedIds, value);
		if (gesture) gesture.changed ||= result.changed > 0;
	}

	function commitSpeed(value: number): void {
		if (!gesture) writeSpeed(value);
		const current = gesture;
		if (!current) return;
		commandHistory.addUndoEntry(
			{ type: 'SET_ANIMATED_IMAGE_SPEED', payload: { ids: selectedIds } },
			current.before
		);
		gesture = null;
		if (current.changed) onedit();
	}

	function cancelGesture(): void {
		if (!gesture) return;
		restoreSnapshot(gesture.before);
		gesture = null;
	}

	function resetSpeed(): void {
		const result = setAnimatedImageSpeed(selectedIds, 1);
		if (result.changed > 0) onedit();
	}

	function reverseState(): boolean | null {
		if (items.length === 0) return false;
		const first = items[0]?.isReversed === true;
		return items.every((item) => (item.isReversed === true) === first) ? first : null;
	}

	function toggleReverse(): void {
		const result = setAnimatedImagesReversed(selectedIds, reverseState() !== true);
		if (result.changed > 0) onedit();
	}
</script>

{#if items.length > 0}
	<section
		class="overflow-hidden rounded-md border border-white/8 bg-white/[0.025]"
		data-testid="animated-image-playback-section"
	>
		<h3
			class="flex h-8 items-center gap-2 border-b border-white/7 px-2.5 text-xs font-semibold tracking-wider text-white/58 uppercase"
		>
			<GaugeIcon class="size-3.5 text-white/42" aria-hidden="true" />
			{m.video_editor_clip_playback()}
		</h3>
		<div class="divide-y divide-white/6">
			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
				<span class="text-xs font-medium text-white/48">{m.video_editor_clip_speed()}</span>
				<div class="flex min-w-0 items-center gap-1">
					<Slider
						class="h-7 min-w-8 flex-1 [&_[data-slot=slider-thumb]]:shadow-none"
						min={0.1}
						max={10}
						step={0.01}
						value={speedValue ?? 1}
						ariaLabel={m.video_editor_clip_speed()}
						onValueChange={(nextValue) => {
							beginGesture();
							writeSpeed(nextValue);
						}}
						onValueCommit={commitSpeed}
						onValueCancel={cancelGesture}
						onKeydown={(event) => event.stopPropagation()}
					/>
					<div class="relative w-[4.6rem] shrink-0">
						<ScrubbableNumberInput
							ariaLabel={m.video_editor_clip_speed()}
							value={speedValue}
							placeholder={m.video_editor_property_mixed()}
							min={0.1}
							max={10}
							step={0.01}
							decimals={2}
							class="h-7 w-full rounded border border-white/8 bg-black/18 py-1 pr-4 pl-1.5 text-right text-xs tabular-nums outline-none"
							onbegin={beginGesture}
							onlive={writeSpeed}
							oncommit={commitSpeed}
							oncancel={cancelGesture}
						/>
						<span
							class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-xs text-white/30"
							>×</span
						>
					</div>
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						aria-label={m.video_editor_motion_override_reset({ name: m.video_editor_clip_speed() })}
						onclick={resetSpeed}
					>
						<RotateCcwIcon class="size-3.5" aria-hidden="true" />
					</button>
				</div>
			</div>
			<div class="px-2.5 py-2">
				<Button
					type="button"
					variant={reverseState() === true ? 'secondary' : 'outline'}
					class="h-8 w-full justify-between px-2 text-xs"
					aria-label={m.video_editor_clip_reverse()}
					aria-pressed={reverseState() === true}
					onclick={toggleReverse}
				>
					<span>{m.video_editor_clip_reverse()}</span>
					<span class="text-xs opacity-60">
						{reverseState() === null
							? m.video_editor_property_mixed()
							: reverseState()
								? m.video_editor_clip_reverse_on()
								: m.video_editor_clip_reverse_off()}
					</span>
				</Button>
			</div>
		</div>
	</section>
{/if}
