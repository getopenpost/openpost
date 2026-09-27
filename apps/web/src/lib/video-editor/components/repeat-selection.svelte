<script lang="ts">
	import { formatTimelinePreviewTimecode } from '../preview/timeline-preview-scrub';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import { transitionsStore } from '../timeline/actions/transitions.svelte';
	import { execute } from '../timeline/commands/command-store.svelte';
	import { expandSelectionWithLinkedItems } from '../timeline/utils/linked-items';
	import { planRepeatedItems } from '../timeline/repeat-items';
	import { snapshotTimelineState } from '../timeline/utils/state-snapshot.svelte';
	let { selectedIds, oninserted }: { selectedIds: string[]; oninserted: (ids: string[]) => void } =
		$props();
	let copies = $state(2);
	let gap = $state(0);
	let end = $state<number | undefined>(undefined);
	const plan = $derived(
		planRepeatedItems({
			items: snapshotTimelineState(timelineStore.items),
			tracks: timelineStore.tracks,
			transitions: snapshotTimelineState(transitionsStore.list),
			selectedIds: expandSelectionWithLinkedItems(timelineStore.items, selectedIds),
			endFrame: end === undefined ? undefined : Math.round(end * timelineStore.fps),
			copies,
			gapFrames: Math.round(gap * timelineStore.fps)
		})
	);
	function repeat(): void {
		const placement = plan;
		if (!placement) return;
		execute('REPEAT_ITEMS', () => {
			timelineStore._setItems([...timelineStore.items, ...placement.items]);
			transitionsStore.setAll([...transitionsStore.list, ...placement.transitions]);
		});
		oninserted(placement.items.map((item) => item.id));
	}
</script>

<details class="border-t border-[var(--video-editor-border)] pt-2">
	<summary class="cursor-pointer text-xs [@media(pointer:coarse)]:min-h-11"
		>{m.video_editor_repeat()}</summary
	>
	<div class="mt-2 grid gap-2">
		<div class="grid grid-cols-2 gap-2">
			<label class="grid gap-1 text-xs"
				>{m.video_editor_repeat_copies()}<Input
					type="number"
					min={1}
					max={100}
					step={1}
					bind:value={copies}
				/></label
			>
			<label class="grid gap-1 text-xs"
				>{m.video_editor_repeat_gap()}<Input
					type="number"
					min={0}
					max={3600}
					step={0.1}
					bind:value={gap}
				/></label
			>
		</div>
		<label class="grid gap-1 text-xs"
			>{m.video_editor_repeat_end()}<Input
				type="number"
				min={0}
				step={0.1}
				bind:value={end}
			/></label
		>
		<p class="text-xs text-[var(--video-editor-muted)]" aria-live="polite">
			{plan
				? m.video_editor_repeat_preview({
						count: String(plan.items.length),
						end: (plan.endFrame / timelineStore.fps).toFixed(1)
					})
				: m.video_editor_repeat_blocked()}
		</p>
		{#if plan}
			<ol
				aria-label={m.video_editor_preview_suggestion()}
				class="max-h-24 overflow-y-auto rounded border border-[var(--video-editor-border)] p-1 text-[10px]"
			>
				{#each plan.items as item (item.id)}
					<li class="flex items-center justify-between gap-2 px-1 py-0.5">
						<span class="truncate">{item.label}</span>
						<span class="shrink-0 font-mono text-[var(--video-editor-muted)]"
							>{formatTimelinePreviewTimecode(item.from, timelineStore.fps)} · {formatTimelinePreviewTimecode(
								item.from + item.durationInFrames,
								timelineStore.fps
							)}</span
						>
					</li>
				{/each}
			</ol>
		{/if}
		<Button size="sm" variant="outline" disabled={!plan} onclick={repeat}
			>{m.video_editor_repeat()}</Button
		>
	</div>
</details>
