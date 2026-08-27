<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
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

	const ducking = $derived(normalizeAudioDucking((item as TimelineItem & { audioDucking?: AudioDuckingSettings }).audioDucking) ?? null);
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
		updateItemProperties(item.id, { audioDucking: next } as Partial<TimelineItem>, 'UPDATE_CLIP_AUDIO_DUCKING');
		onedit();
	}

	function toggleEnabled(): void {
		if (enabled) commit(undefined);
		else commit({ duckOthersDb: -9, attackSec: DUCKING_DEFAULT_ATTACK_SEC, releaseSec: DUCKING_DEFAULT_RELEASE_SEC });
	}

	function commitDuckDb(value: number): void {
		const clamped = Math.min(0, Math.max(DUCKING_MIN_DB, Number.isFinite(value) ? value : -9));
		if (clamped >= 0) return;
		commit({ duckOthersDb: clamped, attackSec, releaseSec, ...(targetTrackIds.length ? { targetTrackIds } : {}) });
	}

	function commitAttack(value: number): void {
		const v = Math.min(DUCKING_MAX_ATTACK_SEC, Math.max(0, Number.isFinite(value) ? value : DUCKING_DEFAULT_ATTACK_SEC));
		commit({ duckOthersDb: duckDb, attackSec: v, releaseSec, ...(targetTrackIds.length ? { targetTrackIds } : {}) });
	}

	function commitRelease(value: number): void {
		const v = Math.min(DUCKING_MAX_RELEASE_SEC, Math.max(0, Number.isFinite(value) ? value : DUCKING_DEFAULT_RELEASE_SEC));
		commit({ duckOthersDb: duckDb, attackSec, releaseSec: v, ...(targetTrackIds.length ? { targetTrackIds } : {}) });
	}

	function toggleTrack(trackId: string, checked: boolean): void {
		const set = new Set(targetTrackIds);
		if (checked) set.add(trackId);
		else set.delete(trackId);
		const next = [...set];
		commit({ duckOthersDb: duckDb, attackSec, releaseSec, ...(next.length ? { targetTrackIds: next } : {}) });
	}
</script>

<details class="group rounded-md border border-white/10 bg-black/10" open={enabled}>
	<summary
		class="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
	>
		<span class="font-medium text-white/85">Duck other audio</span>
		<span class="text-[10px] text-white/45">{enabled ? `${duckDb} dB` : 'Off'}</span>
	</summary>
	<div class="space-y-3 border-t border-white/10 p-2">
		<p class="text-[11px] leading-relaxed text-white/60">
			While this clip plays, other tracks are lowered. The clip itself is never ducked. Attack fades into the dip, release fades back out.
		</p>

		<div class="flex items-center justify-between gap-2">
			<span class="text-[10px] text-white/70">Enable ducking</span>
			<Button
				type="button"
				size="sm"
				variant={enabled ? 'secondary' : 'outline'}
				class="h-7 px-2 text-[10px]"
				aria-pressed={enabled}
				onclick={toggleEnabled}
			>
				{enabled ? 'On' : 'Off'}
			</Button>
		</div>

		{#if enabled}
			<div class="grid grid-cols-2 gap-1.5">
				<label class="text-[10px] text-white/60">
					Duck amount (dB)
					<Input
						class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
						type="number"
						min={DUCKING_MIN_DB}
						max={0}
						step="1"
						value={duckDb}
						onchange={(e) => commitDuckDb(e.currentTarget.valueAsNumber)}
					/>
					<span class="text-[9px] text-white/40">-60 to 0, lower is more dip</span>
				</label>
				<div class="text-[10px] text-white/50 flex flex-col justify-end pb-1">
					<span>Current: {duckDb} dB</span>
				</div>
				<label class="text-[10px] text-white/60">
					Attack (s)
					<Input
						class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
						type="number"
						min="0"
						max={DUCKING_MAX_ATTACK_SEC}
						step="0.01"
						value={attackSec}
						onchange={(e) => commitAttack(e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="text-[10px] text-white/60">
					Release (s)
					<Input
						class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
						type="number"
						min="0"
						max={DUCKING_MAX_RELEASE_SEC}
						step="0.01"
						value={releaseSec}
						onchange={(e) => commitRelease(e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>

			{#if availableTracks.length > 0}
				<div class="space-y-1.5">
					<div class="text-[10px] font-medium text-white/70">Only duck these tracks</div>
					<p class="text-[9px] text-white/40">Leave empty to duck every other audible track.</p>
					<div class="grid grid-cols-1 gap-1 max-h-28 overflow-y-auto rounded bg-white/[0.03] p-1.5">
						{#each availableTracks as track (track.id)}
							<label class="flex items-center gap-1.5 text-[11px] text-white/75">
								<input
									type="checkbox"
									checked={targetTrackIds.includes(track.id)}
									onchange={(e) => toggleTrack(track.id, (e.currentTarget as HTMLInputElement).checked)}
									class="h-3.5 w-3.5 rounded border-white/20 bg-black/30"
								/>
								<span class="truncate">{track.name} <span class="text-white/40">({track.kind ?? 'track'})</span></span>
							</label>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</details>
