<script lang="ts">
	/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-conditional-empty-object-spread */
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { m } from '$lib/paraglide/messages';
	import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		DUCKING_DEFAULT_ATTACK_SEC,
		DUCKING_DEFAULT_RELEASE_SEC,
		DUCKING_MAX_ATTACK_SEC,
		DUCKING_MAX_RELEASE_SEC,
		DUCKING_MIN_DB,
		normalizeAudioDucking,
		type AudioDuckingSettings
	} from '$lib/video-editor/audio/audio-ducking';

	let { item, onedit = () => {} }: { item: TimelineItem; onedit?: () => void } = $props();

	const ducking = $derived(
		normalizeAudioDucking(
			(item as TimelineItem & { audioDucking?: AudioDuckingSettings }).audioDucking
		) ?? null
	);
	const enabled = $derived(ducking !== null);
	const duckDb = $derived(ducking?.duckOthersDb ?? -9);
	const attackSec = $derived(ducking?.attackSec ?? DUCKING_DEFAULT_ATTACK_SEC);
	const releaseSec = $derived(ducking?.releaseSec ?? DUCKING_DEFAULT_RELEASE_SEC);
	const targetTrackIds = $derived(ducking?.targetTrackIds ?? []);

	const availableTracks = $derived(
		timelineStore.tracks
			.filter((t) => !t.isGroup && t.id !== item.trackId)
			.toSorted((a, b) => a.order - b.order)
	);

	function commit(next: AudioDuckingSettings | undefined): void {
		updateItemProperties(
			item.id,
			{ audioDucking: next } as Partial<TimelineItem>,
			'UPDATE_CLIP_AUDIO_DUCKING'
		);
		onedit();
	}

	function toggleEnabled(): void {
		if (enabled) commit(undefined);
		else
			commit({
				duckOthersDb: -9,
				attackSec: DUCKING_DEFAULT_ATTACK_SEC,
				releaseSec: DUCKING_DEFAULT_RELEASE_SEC
			});
	}

	function commitDuckDb(value: number): void {
		const clamped = Math.min(0, Math.max(DUCKING_MIN_DB, Number.isFinite(value) ? value : -9));
		if (clamped >= 0) return;
		commit({
			duckOthersDb: clamped,
			attackSec,
			releaseSec,
			...(targetTrackIds.length ? { targetTrackIds } : {})
		});
	}

	function commitAttack(value: number): void {
		const v = Math.min(
			DUCKING_MAX_ATTACK_SEC,
			Math.max(0, Number.isFinite(value) ? value : DUCKING_DEFAULT_ATTACK_SEC)
		);
		commit({
			duckOthersDb: duckDb,
			attackSec: v,
			releaseSec,
			...(targetTrackIds.length ? { targetTrackIds } : {})
		});
	}

	function commitRelease(value: number): void {
		const v = Math.min(
			DUCKING_MAX_RELEASE_SEC,
			Math.max(0, Number.isFinite(value) ? value : DUCKING_DEFAULT_RELEASE_SEC)
		);
		commit({
			duckOthersDb: duckDb,
			attackSec,
			releaseSec: v,
			...(targetTrackIds.length ? { targetTrackIds } : {})
		});
	}

	function toggleTrack(trackId: string, checked: boolean): void {
		const set = new Set(targetTrackIds);
		if (checked) set.add(trackId);
		else set.delete(trackId);
		const next = [...set];
		commit({
			duckOthersDb: duckDb,
			attackSec,
			releaseSec,
			...(next.length ? { targetTrackIds: next } : {})
		});
	}
</script>

<details class="group rounded-md border border-white/10 bg-black/10" open={enabled}>
	<summary
		class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		aria-label={m.video_editor_duck_title()}
	>
		<span class="font-medium text-white/85">{m.video_editor_duck_title()}</span>
		<span class="text-[10px] text-white/45" aria-live="polite"
			>{enabled ? `${duckDb} dB` : m.video_editor_duck_off()}</span
		>
	</summary>
	<div class="space-y-3 border-t border-white/10 p-2">
		<p class="text-[11px] leading-relaxed text-white/60">
			{m.video_editor_duck_description()}
		</p>

		<div class="flex min-h-11 items-center justify-between gap-2">
			<span class="text-[11px] font-medium text-white/70">{m.video_editor_duck_enable()}</span>
			<Button
				type="button"
				size="sm"
				variant={enabled ? 'secondary' : 'outline'}
				class="min-h-11 min-w-11 px-3 text-xs"
				aria-pressed={enabled}
				aria-label={m.video_editor_duck_enable()}
				onclick={toggleEnabled}
			>
				{enabled ? m.video_editor_duck_on() : m.video_editor_duck_off()}
			</Button>
		</div>

		{#if enabled}
			<div class="grid grid-cols-2 gap-2">
				<label class="flex flex-col gap-1 text-[11px] text-white/60">
					<span>{m.video_editor_duck_amount()}</span>
					<Input
						class="h-11 w-full bg-[oklch(0.22_0.01_50)] text-xs"
						type="number"
						min={DUCKING_MIN_DB}
						max={0}
						step="1"
						value={duckDb}
						aria-label={m.video_editor_duck_amount()}
						onchange={(e) => commitDuckDb(e.currentTarget.valueAsNumber)}
					/>
					<span class="text-[9px] text-white/40">{m.video_editor_duck_amount_hint()}</span>
				</label>
				<div class="flex min-h-11 items-end pb-4 text-[11px] text-white/50">
					<span aria-live="polite">{m.video_editor_duck_current({ db: String(duckDb) })}</span>
				</div>
				<label class="flex flex-col gap-1 text-[11px] text-white/60">
					<span>{m.video_editor_duck_attack()}</span>
					<Input
						class="h-11 w-full bg-[oklch(0.22_0.01_50)] text-xs"
						type="number"
						min="0"
						max={DUCKING_MAX_ATTACK_SEC}
						step="0.01"
						value={attackSec}
						aria-label={m.video_editor_duck_attack()}
						onchange={(e) => commitAttack(e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="flex flex-col gap-1 text-[11px] text-white/60">
					<span>{m.video_editor_duck_release()}</span>
					<Input
						class="h-11 w-full bg-[oklch(0.22_0.01_50)] text-xs"
						type="number"
						min="0"
						max={DUCKING_MAX_RELEASE_SEC}
						step="0.01"
						value={releaseSec}
						aria-label={m.video_editor_duck_release()}
						onchange={(e) => commitRelease(e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>

			{#if availableTracks.length > 0}
				<div class="space-y-2">
					<div class="text-[11px] font-medium text-white/70">{m.video_editor_duck_targets()}</div>
					<p class="text-[10px] text-white/40">{m.video_editor_duck_targets_hint()}</p>
					<div class="grid max-h-32 grid-cols-1 gap-1 overflow-y-auto rounded bg-white/[0.03] p-2">
						{#each availableTracks as track (track.id)}
							<label
								for={`duck-target-${item.id}-${track.id}`}
								class="flex min-h-11 items-center gap-2 rounded px-1 text-[11px] text-white/75 focus-within:bg-white/5 hover:bg-white/5"
							>
								<Checkbox
									id={`duck-target-${item.id}-${track.id}`}
									checked={targetTrackIds.includes(track.id)}
									onCheckedChange={(v) => toggleTrack(track.id, Boolean(v))}
									aria-label={track.name}
									class="shrink-0"
								/>
								<span class="min-w-0 flex-1 truncate"
									>{track.name} <span class="text-white/40">({track.kind ?? 'track'})</span></span
								>
							</label>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</details>
