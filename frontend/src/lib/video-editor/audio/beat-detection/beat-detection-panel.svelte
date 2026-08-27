<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { beatDetectionService } from './beat-detection-service.svelte';
	import { Button } from '$lib/components/ui/button';
	import AppSelect from '$lib/components/app-select.svelte';
	import MusicIcon from '@lucide/svelte/icons/music';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import type { TimelineItem } from '$lib/video-editor/project/types';

	let { selectedItemId = $bindable<string | null>(null) } = $props<{
		selectedItemId?: string | null;
	}>();

	const mediaItems = $derived(
		timelineStore.items.filter((item) => item.type === 'audio' || item.type === 'video')
	);

	const selectedClip = $derived<TimelineItem | null>(
		(selectedItemId ? timelineStore.itemById.get(selectedItemId) : undefined) ??
			mediaItems.find(
				(item) =>
					timelineStore.currentFrame >= item.from &&
					timelineStore.currentFrame < item.from + item.durationInFrames
			) ??
			mediaItems[0] ??
			null
	);

	let errorAnnounce = $state('');

	$effect(() => {
		if (beatDetectionService.error) errorAnnounce = beatDetectionService.error;
	});

	async function run() {
		errorAnnounce = '';
		try {
			await beatDetectionService.analyzeSelectedClip(selectedClip?.id ?? null);
		} catch {
			// error stored on service
		}
	}

	function cancel() {
		beatDetectionService.cancel();
	}
</script>

<section
	class="flex flex-col gap-2 rounded-lg border border-[oklch(0.25_0.01_55)] bg-[oklch(0.17_0.01_55)] px-3 py-2"
	aria-labelledby="beat-detection-heading"
>
	<div class="flex items-center gap-2">
		<MusicIcon class="size-4 shrink-0 text-[oklch(0.75_0.12_220)]" aria-hidden="true" />
		<h2 id="beat-detection-heading" class="text-xs font-medium text-white">
			{m.video_editor_beat_panel_title()}
		</h2>
		<span class="ml-auto text-[11px] text-[oklch(0.65_0.01_55)]">
			{m.video_editor_beat_panel_hint()}
		</span>
	</div>

	<p class="text-[11px] leading-snug text-[oklch(0.68_0.01_55)]">
		{m.video_editor_beat_panel_description()}
	</p>

	<div class="flex flex-wrap items-center gap-2">
		<label class="flex min-w-0 flex-1 items-center gap-2">
			<span class="sr-only">{m.video_editor_beat_clip_label()}</span>
			<AppSelect
				class="h-7 min-w-36 flex-1 text-xs"
				value={selectedClip?.id ?? ''}
				options={mediaItems.map((item) => ({
					value: item.id,
					label: `${item.label} · ${item.type}`
				}))}
				ariaLabel={m.video_editor_beat_clip_label()}
				placeholder={m.video_editor_beat_no_clips()}
				onValueChange={(value) => {
					selectedItemId = value || null;
				}}
			/>
		</label>

		{#if beatDetectionService.isAnalyzing}
			<Button
				variant="outline"
				size="sm"
				class="h-7 shrink-0 gap-1.5"
				aria-label={m.video_editor_beat_cancel()}
				onclick={cancel}
			>
				<XIcon class="size-3.5" />
				{m.video_editor_beat_cancel()}
			</Button>
		{:else}
			<Button
				variant="default"
				size="sm"
				class="h-7 shrink-0 gap-1.5"
				disabled={!selectedClip}
				aria-label={m.video_editor_beat_detect()}
				title={!selectedClip
					? m.video_editor_beat_no_selection()
					: m.video_editor_beat_detect_hint()}
				onclick={run}
			>
				<FlagIcon class="size-3.5" />
				{m.video_editor_beat_detect()}
			</Button>
		{/if}
	</div>

	<div aria-live="polite" aria-atomic="true" class="min-h-5 text-[11px]">
		{#if beatDetectionService.isAnalyzing}
			<span class="inline-flex items-center gap-1.5 text-[oklch(0.75_0.12_220)]">
				<LoaderCircleIcon
					class="size-3.5 animate-spin motion-reduce:animate-none"
					aria-hidden="true"
				/>
				{beatDetectionService.progress ?? m.video_editor_beat_analyzing()}
			</span>
		{:else if beatDetectionService.status === 'success' && beatDetectionService.lastResult}
			<span class="text-[oklch(0.72_0.14_140)]">
				{beatDetectionService.lastResult.message}
				{#if beatDetectionService.lastResult.bpm}
					· {m.video_editor_beat_bpm_value({
						bpm: Math.round(beatDetectionService.lastResult.bpm ?? 0)
					})}
				{/if}
			</span>
		{:else if beatDetectionService.status === 'error' && beatDetectionService.error}
			<span role="alert" class="text-[oklch(0.68_0.18_25)]">
				{beatDetectionService.error}
			</span>
		{:else if beatDetectionService.status === 'cancelled'}
			<span class="text-[oklch(0.65_0.01_55)]">
				{beatDetectionService.lastResult?.message ?? m.video_editor_beat_cancelled()}
			</span>
		{:else if timelineStore.markers.length > 0}
			<span class="text-[oklch(0.65_0.01_55)]">
				{m.video_editor_beat_markers_count({ count: timelineStore.markers.length })}
			</span>
		{/if}
	</div>
</section>
