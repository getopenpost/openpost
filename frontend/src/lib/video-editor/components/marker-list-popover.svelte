<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { m } from '$lib/paraglide/messages';
	import { formatTimelinePreviewTimecode } from '$lib/video-editor/preview/timeline-preview-scrub';
	import { clearAllMarkers, removeMarker } from '$lib/video-editor/timeline/actions/items';
	import { markerDisplayName } from '$lib/video-editor/timeline/markers';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import type { TimelineMarker } from '$lib/video-editor/project/types';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import ListIcon from '@lucide/svelte/icons/list';
	import { ThemeIcon } from '$lib/themes/icons';

	let {
		onselect,
		onedit
	}: {
		onselect: (marker: TimelineMarker) => void;
		onedit: () => void;
	} = $props();

	let open = $state(false);
	const sortedMarkers = $derived(
		[...timelineStore.markers].sort(
			(left, right) => left.frame - right.frame || left.id.localeCompare(right.id)
		)
	);

	function markerName(marker: TimelineMarker, index: number): string {
		return markerDisplayName(marker, index, (number) => m.video_editor_marker_number({ number }));
	}

	function chooseMarker(marker: TimelineMarker): void {
		onselect(marker);
		open = false;
	}

	function deleteMarker(markerId: string): void {
		if (!timelineStore.markers.some((marker) => marker.id === markerId)) return;
		removeMarker(markerId);
		onedit();
	}

	function clearMarkers(): void {
		if (!clearAllMarkers()) return;
		onedit();
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="ghost"
				size="icon"
				class="relative size-7 rounded [@media(pointer:coarse)]:size-11"
				aria-label={m.video_editor_marker_list_count({ count: timelineStore.markers.length })}
				title={m.video_editor_marker_list()}
			>
				<ListIcon class="size-3.5" aria-hidden="true" />
				{#if timelineStore.markers.length > 0}
					<span
						class="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-selection px-0.5 text-center text-[8px] leading-3.5 font-semibold text-selection-foreground"
						aria-hidden="true"
					>
						{timelineStore.markers.length > 99 ? '99+' : timelineStore.markers.length}
					</span>
				{/if}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="start"
		side="top"
		class="video-editor-theme w-72 max-w-[calc(100vw-1rem)] border-border bg-popover p-0 text-popover-foreground"
	>
		<div class="flex items-center justify-between border-b border-border px-3 py-2">
			<div>
				<p class="text-xs font-semibold">{m.video_editor_marker_list()}</p>
				<p class="text-[10px] text-[var(--video-editor-muted)]">
					{m.video_editor_marker_list_count({ count: timelineStore.markers.length })}
				</p>
			</div>
			<FlagIcon class="size-4 text-[var(--timeline-playhead)]" aria-hidden="true" />
		</div>

		{#if sortedMarkers.length === 0}
			<div class="px-4 py-5 text-center">
				<p class="text-xs font-medium">{m.video_editor_marker_list_empty()}</p>
				<p class="mt-1 text-[10px] text-[var(--video-editor-muted)]">
					{m.video_editor_marker_list_hint()}
				</p>
			</div>
		{:else}
			<div class="max-h-64 overflow-y-auto p-1.5">
				{#each sortedMarkers as marker, index (marker.id)}
					{@const name = markerName(marker, index)}
					<div
						class="group flex min-h-9 items-stretch rounded-md"
						class:bg-selection={timelineStore.selectedMarkerId === marker.id}
					>
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 text-left hover:bg-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
							aria-pressed={timelineStore.selectedMarkerId === marker.id}
							onclick={() => chooseMarker(marker)}
						>
							<span
								class="size-2.5 shrink-0 rounded-full border border-[var(--canvas-pasteboard)]/25"
								style={`background:${marker.color}`}
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1 truncate text-xs">{name}</span>
							<span class="shrink-0 font-mono text-[10px] text-[var(--video-editor-muted)]">
								{formatTimelinePreviewTimecode(marker.frame, timelineStore.fps)}
							</span>
						</button>
						<button
							type="button"
							class="grid w-8 shrink-0 place-items-center rounded-r-md text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive focus-visible:z-10 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-destructive [@media(pointer:coarse)]:w-11"
							aria-label={m.video_editor_marker_list_remove({ name })}
							onclick={() => deleteMarker(marker.id)}
						>
							<ThemeIcon role="delete" class="size-3.5" />
						</button>
					</div>
				{/each}
			</div>
			<div class="border-t border-border p-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					class="w-full justify-center text-destructive hover:bg-destructive/10 hover:text-destructive"
					onclick={clearMarkers}
				>
					{m.video_editor_marker_list_clear()}
				</Button>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
