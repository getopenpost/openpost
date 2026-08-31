<script lang="ts">
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import {
		cancelReverseConform,
		conformReversePreview,
		reverseConformStatus,
		subscribeReverseConform,
		type ReverseConformStatus
	} from '$lib/video-editor/media/reverse-conform-service';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import {
		setItemsReversed,
		setItemsSpeed,
		setItemsSpeedLive
	} from '$lib/video-editor/timeline/actions/items';
	import {
		commandHistory,
		executeAtomic
	} from '$lib/video-editor/timeline/commands/command-store.svelte';
	import {
		captureSnapshot,
		restoreSnapshot
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { getSynchronizedLinkedItems } from '$lib/video-editor/timeline/utils/linked-items';
	import ScrubbableNumberInput from './scrubbable-number-input.svelte';
	import SpeedRampEditor from './speed-ramp-editor.svelte';

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
					candidate !== undefined && (candidate.type === 'video' || candidate.type === 'audio')
			);
	});
	const videoItems = $derived(items.filter((item) => item.type === 'video'));
	const selectedIds = $derived(items.map((item) => item.id));
	const primaryVideo = $derived(videoItems.find((item) => item.id === itemId) ?? videoItems[0]);
	const speedCurveItem = $derived(items.find((item) => item.id === itemId) ?? items[0]);
	const canEditSpeedCurve = $derived.by(() => {
		if (!speedCurveItem) return false;
		const synchronizedIds = new Set(
			getSynchronizedLinkedItems(timelineStore.items, speedCurveItem.id).map((item) => item.id)
		);
		return items.every((item) => synchronizedIds.has(item.id));
	});
	const speedValue = $derived(mixedValue(items, (item) => item.speed ?? 1));
	let gesture = $state<{
		kind: 'speed' | 'fadeIn' | 'fadeOut';
		before: TimelineSnapshot;
		changed: boolean;
	} | null>(null);
	let conformStatus = $state<ReverseConformStatus>({ state: 'idle', progress: 0 });

	$effect(() => {
		const mediaId = primaryVideo?.mediaId;
		if (!mediaId) {
			conformStatus = { state: 'idle', progress: 0 };
			return;
		}
		conformStatus = reverseConformStatus(mediaId);
		return subscribeReverseConform(mediaId, (status) => (conformStatus = status));
	});

	function mixedValue(
		source: TimelineItem[],
		valueFor: (item: TimelineItem) => number
	): number | null {
		if (source.length === 0) return null;
		const values = source.map(valueFor);
		const first = values[0] ?? 0;
		return values.every((value) => Math.abs(value - first) < 0.005) ? first : null;
	}

	function beginGesture(kind: 'speed' | 'fadeIn' | 'fadeOut'): void {
		if (gesture?.kind === kind) return;
		if (gesture) restoreSnapshot(gesture.before);
		gesture = { kind, before: captureSnapshot(), changed: false };
	}

	function writeSpeed(value: number): void {
		if (!Number.isFinite(value)) return;
		beginGesture('speed');
		const result = setItemsSpeedLive(selectedIds, value);
		if (gesture) gesture.changed ||= result.changed > 0;
	}

	function fadeLimit(): number {
		return Math.max(
			0,
			Math.min(5, ...videoItems.map((item) => item.durationInFrames / timelineStore.fps))
		);
	}

	function writeFade(field: 'fadeIn' | 'fadeOut', value: number): void {
		if (!Number.isFinite(value)) return;
		beginGesture(field);
		const safe = Math.max(0, Math.min(fadeLimit(), value));
		const updates = videoItems
			.filter((item) => Math.abs((item[field] ?? 0) - safe) >= 0.0001)
			.map((item) => ({ id: item.id, patch: { [field]: safe } }));
		if (updates.length === 0) return;
		timelineStore._updateItems(updates);
		if (gesture) gesture.changed = true;
	}

	function commitGesture(kind: 'speed' | 'fadeIn' | 'fadeOut', value: number): void {
		if (!gesture) {
			if (kind === 'speed') writeSpeed(value);
			else writeFade(kind, value);
		}
		const current = gesture;
		if (!current || current.kind !== kind) return;
		commandHistory.addUndoEntry(
			{
				type: kind === 'speed' ? 'SET_ITEMS_SPEED' : 'SET_VISUAL_FADES',
				payload: { ids: selectedIds, property: kind }
			},
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
		const result = setItemsSpeed(selectedIds, 1);
		if (result.changed > 0) onedit();
	}

	function resetFade(field: 'fadeIn' | 'fadeOut'): void {
		const targets = videoItems.filter((item) => (item[field] ?? 0) > 0.0001);
		if (targets.length === 0) return;
		executeAtomic('RESET_VISUAL_FADE', () => {
			timelineStore._updateItems(targets.map((item) => ({ id: item.id, patch: { [field]: 0 } })));
		});
		onedit();
	}

	function reverseState(): boolean | null {
		if (items.length === 0) return false;
		const first = items[0]?.isReversed === true;
		return items.every((item) => (item.isReversed === true) === first) ? first : null;
	}

	function toggleReverse(): void {
		const reversed = reverseState() === true;
		const changed = setItemsReversed(selectedIds, !reversed);
		if (changed.length === 0) return;
		onedit();
		if (reversed) return;
		for (const item of videoItems) {
			if (!item.mediaId) continue;
			const media = mediaPool.get(item.mediaId);
			if (media?.tags.includes('video')) void conformReversePreview(media).catch(() => undefined);
		}
	}
</script>

{#if items.length > 0}
	<section
		class="overflow-hidden rounded-md border border-white/8 bg-white/[0.025]"
		data-testid="clip-playback-section"
	>
		<h3
			class="flex h-8 items-center gap-2 border-b border-white/7 px-2.5 text-[10px] font-semibold tracking-wider text-white/58 uppercase"
		>
			<GaugeIcon class="size-3.5 text-white/42" aria-hidden="true" />
			{m.video_editor_clip_playback()}
		</h3>
		<div class="divide-y divide-white/6">
			<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
				<span class="text-[10px] font-medium text-white/48">{m.video_editor_clip_speed()}</span>
				<div class="flex min-w-0 items-center gap-1">
					<Slider
						class="h-7 min-w-8 flex-1 [&_[data-slot=slider-thumb]]:shadow-none"
						min={0.1}
						max={10}
						step={0.01}
						value={speedValue ?? 1}
						ariaLabel={m.video_editor_clip_speed()}
						onValueChange={(nextValue) => {
							beginGesture('speed');
							writeSpeed(nextValue);
						}}
						onValueCommit={(nextValue) => commitGesture('speed', nextValue)}
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
							class="h-7 w-full rounded border border-white/8 bg-black/18 py-1 pr-4 pl-1.5 text-right text-[11px] tabular-nums outline-none"
							onbegin={() => beginGesture('speed')}
							onlive={writeSpeed}
							oncommit={(value) => commitGesture('speed', value)}
							oncancel={cancelGesture}
						/>
						<span
							class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[9px] text-white/30"
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

			{#if canEditSpeedCurve && speedCurveItem}
				<SpeedRampEditor itemId={speedCurveItem.id} itemIds={selectedIds} {onedit} />
			{/if}

			{#if videoItems.length > 0}
				{#each [{ field: 'fadeIn', label: m.video_editor_clip_fade_in_seconds() }, { field: 'fadeOut', label: m.video_editor_clip_fade_out_seconds() }] as control (control.field)}
					{@const field = control.field as 'fadeIn' | 'fadeOut'}
					{@const value = mixedValue(videoItems, (item) => item[field] ?? 0)}
					<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
						<span class="text-[10px] font-medium text-white/48">{control.label}</span>
						<div class="flex min-w-0 items-center gap-1">
							<Slider
								class="h-7 min-w-8 flex-1 [&_[data-slot=slider-thumb]]:shadow-none"
								min={0}
								max={fadeLimit()}
								step={0.05}
								value={value ?? 0}
								ariaLabel={control.label}
								onValueChange={(nextValue) => {
									beginGesture(field);
									writeFade(field, nextValue);
								}}
								onValueCommit={(nextValue) => commitGesture(field, nextValue)}
								onValueCancel={cancelGesture}
								onKeydown={(event) => event.stopPropagation()}
							/>
							<div class="relative w-[4.6rem] shrink-0">
								<ScrubbableNumberInput
									ariaLabel={control.label}
									{value}
									placeholder={m.video_editor_property_mixed()}
									min={0}
									max={fadeLimit()}
									step={0.05}
									decimals={2}
									class="h-7 w-full rounded border border-white/8 bg-black/18 py-1 pr-4 pl-1.5 text-right text-[11px] tabular-nums outline-none"
									onbegin={() => beginGesture(field)}
									onlive={(next) => writeFade(field, next)}
									oncommit={(next) => commitGesture(field, next)}
									oncancel={cancelGesture}
								/>
								<span
									class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[9px] text-white/30"
									>s</span
								>
							</div>
							<button
								type="button"
								class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
								aria-label={m.video_editor_motion_override_reset({ name: control.label })}
								onclick={() => resetFade(field)}
							>
								<RotateCcwIcon class="size-3.5" aria-hidden="true" />
							</button>
						</div>
					</div>
				{/each}
			{/if}

			<div class="space-y-2 px-2.5 py-2">
				<Button
					type="button"
					size="sm"
					variant={reverseState() === true ? 'secondary' : 'outline'}
					class="h-8 w-full justify-between text-xs"
					aria-label={m.video_editor_clip_reverse()}
					aria-pressed={reverseState() === true}
					onclick={toggleReverse}
				>
					<span>{m.video_editor_clip_reverse()}</span>
					<span class="text-[10px] opacity-70">
						{reverseState() === null
							? m.video_editor_property_mixed()
							: reverseState()
								? m.video_editor_clip_reverse_on()
								: m.video_editor_clip_reverse_off()}
					</span>
				</Button>
				{#if primaryVideo?.isReversed && (conformStatus.state === 'preparing' || conformStatus.state === 'rendering')}
					<div class="rounded border border-white/10 bg-black/20 p-2">
						<div class="flex items-center justify-between gap-2 text-[10px] text-white/75">
							<span>{m.video_editor_clip_reverse_preparing()}</span>
							<span>{Math.round(conformStatus.progress * 100)}%</span>
						</div>
						<div class="mt-1 h-1 overflow-hidden rounded bg-white/10">
							<div
								class="h-full bg-[oklch(0.66_0.14_45)]"
								style:width={`${Math.round(conformStatus.progress * 100)}%`}
							></div>
						</div>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							class="mt-1 h-6 px-1.5 text-[10px]"
							onclick={() => primaryVideo?.mediaId && cancelReverseConform(primaryVideo.mediaId)}
							>{m.common_cancel()}</Button
						>
					</div>
				{:else if primaryVideo?.isReversed && conformStatus.state === 'ready'}
					<p class="text-[10px] text-[oklch(0.74_0.1_145)]">
						{m.video_editor_clip_reverse_ready()}
					</p>
				{:else if primaryVideo?.isReversed && (conformStatus.state === 'error' || conformStatus.state === 'canceled')}
					<p class="text-[10px] text-[oklch(0.72_0.14_30)]">
						{m.video_editor_clip_reverse_fallback()}
					</p>
				{/if}
			</div>
		</div>
	</section>
{/if}
