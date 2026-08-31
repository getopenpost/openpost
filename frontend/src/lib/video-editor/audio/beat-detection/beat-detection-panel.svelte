<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { beatDetectionService as defaultBeatDetectionService } from './beat-detection-service.svelte';
	import type { BeatDetectionService } from './beat-detection-service.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import MusicIcon from '@lucide/svelte/icons/music';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import XIcon from '@lucide/svelte/icons/x';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import CheckIcon from '@lucide/svelte/icons/check';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { effectiveMediaTracks } from '$lib/video-editor/timeline/utils/track-groups';
	import {
		isBeatSyncEligibleItem,
		splitItemOnBeatMarkersAtomic,
		syncTracksToBeatMarkersAtomic,
		type BeatCadence,
		type BeatSyncMode
	} from './beat-sync';

	let { selectedItemId = $bindable<string | null>(null), service = defaultBeatDetectionService } =
		$props<{
			selectedItemId?: string | null;
			service?: BeatDetectionService;
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
	let targetTrackIds = $state<string[]>([]);
	let syncMode = $state<BeatSyncMode>('smart');
	let cadence = $state<BeatCadence>(1);
	let offsetMs = $state(0);
	let editStatus = $state('');

	const beatFrames = $derived(
		service.beatSourceItemId === selectedClip?.id && service.beatFrames.length > 0
			? service.beatFrames
			: timelineStore.markers
					.filter(
						(marker) =>
							(marker.kind === 'beat' || marker.kind === 'downbeat') &&
							marker.sourceItemId === selectedClip?.id
					)
					.map((marker) => marker.frame)
	);
	const sourceLinkedGroupId = $derived(selectedClip?.linkedGroupId);
	const availableTargetTracks = $derived(
		effectiveMediaTracks(timelineStore.tracks)
			.filter((track) => track.id !== selectedClip?.trackId)
			.filter((track) =>
				timelineStore.items.some(
					(item) =>
						item.trackId === track.id &&
						isBeatSyncEligibleItem(item) &&
						(!sourceLinkedGroupId || item.linkedGroupId !== sourceLinkedGroupId)
				)
			)
			.toSorted((left, right) => left.order - right.order)
	);
	const targetClipCount = $derived(
		timelineStore.items.filter(
			(item) =>
				targetTrackIds.includes(item.trackId) &&
				isBeatSyncEligibleItem(item) &&
				(!sourceLinkedGroupId || item.linkedGroupId !== sourceLinkedGroupId)
		).length
	);

	$effect(() => {
		const available = new Set(availableTargetTracks.map((track) => track.id));
		const next = targetTrackIds.filter((trackId) => available.has(trackId));
		if (next.length !== targetTrackIds.length) targetTrackIds = next;
	});

	$effect(() => {
		if (service.error) errorAnnounce = service.error;
	});

	async function run() {
		errorAnnounce = '';
		try {
			await service.analyzeSelectedClip(selectedClip?.id ?? null);
		} catch {
			// error stored on service
		}
	}

	function cancel() {
		service.cancel();
	}

	function toggleTargetTrack(trackId: string, checked: boolean): void {
		targetTrackIds = checked
			? [...new Set([...targetTrackIds, trackId])]
			: targetTrackIds.filter((candidate) => candidate !== trackId);
		editStatus = '';
	}

	function selectSyncMode(value: string): void {
		if (value === 'smart' || value === 'one-per-beat' || value === 'preserve-duration') {
			syncMode = value;
		}
	}

	function selectCadence(value: string): void {
		const next = Number(value);
		if (next === 1 || next === 2 || next === 4) cadence = next;
	}

	function syncClips(): void {
		if (!selectedClip || targetTrackIds.length === 0) return;
		const result = syncTracksToBeatMarkersAtomic({
			trackIds: targetTrackIds,
			beatFrames,
			config: {
				mode: syncMode,
				cadence,
				offsetFrames: Math.round(
					(Math.max(-500, Math.min(500, offsetMs)) / 1000) * timelineStore.fps
				)
			},
			excludedItemIds: [selectedClip.id]
		});
		editStatus =
			result.changed > 0
				? m.video_editor_beat_sync_result({ count: result.changed })
				: result.skippedLocked > 0
					? m.video_editor_beat_sync_locked()
					: m.video_editor_beat_sync_none();
	}

	function splitSourceOnBeats(): void {
		if (!selectedClip) return;
		const count = splitItemOnBeatMarkersAtomic(selectedClip.id, beatFrames, 4);
		editStatus =
			count > 0 ? m.video_editor_beat_split_result({ count }) : m.video_editor_beat_split_none();
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
		<span class="ml-auto text-xs text-[oklch(0.65_0.01_55)]">
			{m.video_editor_beat_panel_hint()}
		</span>
	</div>

	<p class="text-xs leading-snug text-[oklch(0.68_0.01_55)]">
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

		{#if service.isAnalyzing}
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

	<div aria-live="polite" aria-atomic="true" class="min-h-5 text-xs">
		{#if service.isAnalyzing}
			<span class="inline-flex items-center gap-1.5 text-[oklch(0.75_0.12_220)]">
				<LoaderCircleIcon
					class="size-3.5 animate-spin motion-reduce:animate-none"
					aria-hidden="true"
				/>
				{service.progress ?? m.video_editor_beat_analyzing()}
			</span>
		{:else if service.status === 'success' && service.lastResult}
			<span class="text-[oklch(0.72_0.14_140)]">
				{service.lastResult.message}
				{#if service.lastResult.bpm}
					· {m.video_editor_beat_bpm_value({
						bpm: Math.round(service.lastResult.bpm ?? 0)
					})}
				{/if}
			</span>
		{:else if service.status === 'error' && service.error}
			<span role="alert" class="text-[oklch(0.68_0.18_25)]">
				{service.error}
			</span>
		{:else if service.status === 'cancelled'}
			<span class="text-[oklch(0.65_0.01_55)]">
				{service.lastResult?.message ?? m.video_editor_beat_cancelled()}
			</span>
		{:else if timelineStore.markers.length > 0}
			<span class="text-[oklch(0.65_0.01_55)]">
				{m.video_editor_beat_markers_count({ count: timelineStore.markers.length })}
			</span>
		{/if}
	</div>

	{#if selectedClip && beatFrames.length > 0}
		<div class="grid gap-2 border-t border-white/10 pt-2 lg:grid-cols-[minmax(0,1fr)_auto]">
			<div class="min-w-0 space-y-2">
				<div class="flex items-center justify-between gap-2">
					<h3 class="text-xs font-medium text-white">
						{m.video_editor_beat_sync_title()}
					</h3>
					<span class="text-xs text-white/45">
						{m.video_editor_beat_sync_beat_count({ count: beatFrames.length })}
					</span>
				</div>

				{#if availableTargetTracks.length > 0}
					<div
						class="flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-y-auto"
						role="group"
						aria-label={m.video_editor_beat_sync_targets()}
					>
						{#each availableTargetTracks as track (track.id)}
							<label
								for={`beat-sync-${track.id}`}
								class="flex min-h-11 min-w-32 flex-1 items-center gap-2 rounded px-2 text-xs text-white/75 hover:bg-white/5"
							>
								<Checkbox
									id={`beat-sync-${track.id}`}
									checked={targetTrackIds.includes(track.id)}
									disabled={track.locked}
									onCheckedChange={(checked) => toggleTargetTrack(track.id, Boolean(checked))}
									aria-label={track.name}
								/>
								<span class="min-w-0 flex-1 truncate">{track.name}</span>
								<span class="text-xs text-white/35">
									{timelineStore.items.filter((item) => item.trackId === track.id).length}
								</span>
							</label>
						{/each}
					</div>

					<div class="grid gap-2 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_7rem_auto]">
						<label class="space-y-1 text-xs text-white/55">
							<span>{m.video_editor_beat_sync_mode()}</span>
							<AppSelect
								class="h-9 w-full text-xs"
								value={syncMode}
								options={[
									{ value: 'smart', label: m.video_editor_beat_sync_mode_smart() },
									{ value: 'one-per-beat', label: m.video_editor_beat_sync_mode_one() },
									{ value: 'preserve-duration', label: m.video_editor_beat_sync_mode_preserve() }
								]}
								ariaLabel={m.video_editor_beat_sync_mode()}
								onValueChange={selectSyncMode}
							/>
						</label>
						<label class="space-y-1 text-xs text-white/55">
							<span>{m.video_editor_beat_sync_cadence()}</span>
							<AppSelect
								class="h-9 w-full text-xs"
								value={String(cadence)}
								options={[
									{ value: '1', label: m.video_editor_beat_sync_every_beat() },
									{ value: '2', label: m.video_editor_beat_sync_every_second() },
									{ value: '4', label: m.video_editor_beat_sync_every_fourth() }
								]}
								ariaLabel={m.video_editor_beat_sync_cadence()}
								onValueChange={selectCadence}
							/>
						</label>
						<label class="space-y-1 text-xs text-white/55">
							<span>{m.video_editor_beat_sync_offset()}</span>
							<Input
								class="h-9 bg-[oklch(0.22_0.01_50)] text-xs"
								type="number"
								min="-500"
								max="500"
								step="10"
								value={offsetMs}
								aria-label={m.video_editor_beat_sync_offset()}
								onchange={(event) => (offsetMs = event.currentTarget.valueAsNumber || 0)}
							/>
						</label>
						<Button
							variant="default"
							size="sm"
							class="min-h-11 self-end"
							disabled={targetClipCount === 0}
							onclick={syncClips}
						>
							<CheckIcon class="size-3.5" />
							{m.video_editor_beat_sync_action({ count: targetClipCount })}
						</Button>
					</div>
				{:else}
					<p class="text-xs text-white/45">{m.video_editor_beat_sync_no_tracks()}</p>
				{/if}
			</div>

			<div class="flex items-end">
				<Button
					variant="outline"
					size="sm"
					class="min-h-11 gap-1.5"
					title={m.video_editor_beat_split_hint()}
					onclick={splitSourceOnBeats}
				>
					<ScissorsIcon class="size-3.5" />
					{m.video_editor_beat_split_every_four()}
				</Button>
			</div>
		</div>

		{#if editStatus}
			<p class="text-xs text-[oklch(0.72_0.14_140)]" role="status">{editStatus}</p>
		{/if}
	{/if}
</section>
