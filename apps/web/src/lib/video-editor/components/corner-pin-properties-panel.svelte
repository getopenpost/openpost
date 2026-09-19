<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { Input } from '$lib/components/ui/input';
	import type { TimelineItem, TimelineItemCornerPin } from '$lib/video-editor/project/types';
	import {
		resolveCornerPinForSize,
		withCornerPinReferenceSize,
		type CornerPinKey,
		type CornerPinOffsets
	} from '$lib/video-editor/preview/corner-pin';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();
	const width = $derived(Math.max(1, item.transform?.width ?? item.cornerPin?.referenceWidth ?? 1));
	const height = $derived(
		Math.max(1, item.transform?.height ?? item.cornerPin?.referenceHeight ?? 1)
	);
	const zero: CornerPinOffsets = {
		topLeft: [0, 0],
		topRight: [0, 0],
		bottomRight: [0, 0],
		bottomLeft: [0, 0]
	};
	const pin = $derived(resolveCornerPinForSize(item.cornerPin, width, height) ?? zero);
	const corners: Array<{ key: CornerPinKey; label: string }> = [
		{ key: 'topLeft', label: 'TL' },
		{ key: 'topRight', label: 'TR' },
		{ key: 'bottomRight', label: 'BR' },
		{ key: 'bottomLeft', label: 'BL' }
	];

	function commit(cornerPin: TimelineItemCornerPin | undefined): void {
		updateItemProperties(item.id, { cornerPin }, 'UPDATE_CORNER_PIN');
		onedit();
	}

	function setCoordinate(corner: CornerPinKey, axis: 0 | 1, value: number): void {
		if (!Number.isFinite(value)) return;
		const nextCorner: [number, number] = [...pin[corner]];
		nextCorner[axis] = value;
		commit(withCornerPinReferenceSize({ ...pin, [corner]: nextCorner }, width, height));
	}
</script>

<section class="flex flex-col gap-2">
	<div class="flex h-[25px] items-center justify-between gap-2">
		<h3
			class="text-[10px] font-semibold tracking-wider text-[var(--video-editor-muted)] uppercase"
			title={m.video_editor_corner_pin_hint()}
		>
			{m.video_editor_corner_pin()}
		</h3>
		{#if item.cornerPin}
			<button
				type="button"
				class="flex size-[22px] items-center justify-center rounded-[4px] text-[var(--video-editor-muted)] hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [@media(pointer:coarse)]:size-11"
				aria-label={m.video_editor_corner_pin_reset()}
				title={m.video_editor_corner_pin_reset()}
				onclick={() => commit(undefined)}
				><ProtectedIcon icon="editor-rotate-left" class="size-3.5" /></button
			>
		{/if}
	</div>
	{#each corners as corner (corner.key)}
		<div class="grid h-[25px] grid-cols-[1.5rem_1fr_1fr] items-center gap-1">
			<span class="text-[10px] font-medium text-[var(--video-editor-text)]">{corner.label}</span>
			<Input
				type="number"
				min="-2000"
				max="2000"
				step="1"
				aria-label={`${corner.label} X`}
				title={`${corner.label} X`}
				class="h-[25px] w-full rounded bg-[var(--video-editor-field)] px-1.5 text-[11px] text-[var(--video-editor-field-text)] tabular-nums"
				value={pin[corner.key][0]}
				onchange={(event) => setCoordinate(corner.key, 0, event.currentTarget.valueAsNumber)}
			/>
			<Input
				type="number"
				min="-2000"
				max="2000"
				step="1"
				aria-label={`${corner.label} Y`}
				title={`${corner.label} Y`}
				class="h-[25px] w-full rounded bg-[var(--video-editor-field)] px-1.5 text-[11px] text-[var(--video-editor-field-text)] tabular-nums"
				value={pin[corner.key][1]}
				onchange={(event) => setCoordinate(corner.key, 1, event.currentTarget.valueAsNumber)}
			/>
		</div>
	{/each}
</section>
