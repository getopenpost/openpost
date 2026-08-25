<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import { captureSnapshot } from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import {
		activeMixerTrackIds,
		readMixerMasterLevels,
		readMixerTrackLevels,
		setMixerMaster,
		setMixerTrackPreviewGain
	} from '$lib/video-editor/audio/audio-mixer';
	import {
		MIXER_MAX_DB,
		MIXER_MIN_DB,
		advanceMeterBallistics,
		createMeterBallistics,
		formatMixerDb,
		meterLevelToPercent,
		mixerDbToFaderPercent,
		mixerDbToGain,
		mixerFaderPercentToDb,
		mixerGainToDb,
		type MeterBallistics
	} from '$lib/video-editor/audio/mixer-utils';
	import LockIcon from '@lucide/svelte/icons/lock-keyhole';
	import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';

	type FaderTarget = { kind: 'track'; trackId: string } | { kind: 'master' };
	interface FaderGesture {
		target: FaderTarget;
		pointerId: number;
		element: HTMLElement;
		before: TimelineSnapshot;
		startDb: number;
		draftDb: number;
		offsetPercent: number;
	}

	const SCALE_MARKS = [12, 0, -12, -24, -36, -48, -60] as const;
	const MASTER_TARGET = { kind: 'master' } as const;
	let root = $state<HTMLElement | null>(null);
	let gesture: FaderGesture | null = null;
	let queuedPointerY: number | null = null;
	let faderAnimationFrame: number | null = null;
	let meterAnimationFrame: number | null = null;
	let lastMeterPaint = 0;
	const meterStates = new Map<string, MeterBallistics>();

	const audioTracks = $derived(
		timelineStore.tracks.filter(
			(track) =>
				!track.isGroup &&
				(track.kind === 'audio' ||
					(track.kind === undefined &&
						timelineStore.items.some((item) => item.trackId === track.id && item.type === 'audio')))
		)
	);

	function targetDb(target: FaderTarget): number {
		if (target.kind === 'master') return timelineStore.masterVolumeDb;
		return mixerGainToDb(
			timelineStore.tracks.find((track) => track.id === target.trackId)?.volume ?? 1
		);
	}

	function targetKey(target: FaderTarget): string {
		return target.kind === 'master' ? 'master' : target.trackId;
	}

	function setFaderVisual(target: FaderTarget, db: number): void {
		if (!root) return;
		const key = CSS.escape(targetKey(target));
		const knob = root.querySelector<HTMLElement>(`[data-fader-knob="${key}"]`);
		const readout = root.querySelector<HTMLElement>(`[data-fader-readout="${key}"]`);
		if (knob) knob.style.bottom = `${mixerDbToFaderPercent(db)}%`;
		if (readout) readout.textContent = formatMixerDb(db);
	}

	function previewFader(target: FaderTarget, startDb: number, db: number): void {
		setFaderVisual(target, db);
		if (target.kind === 'master') {
			setMixerMaster(db, timelineStore.masterMuted);
			return;
		}
		const draftGain = mixerDbToGain(db);
		setMixerTrackPreviewGain(target.trackId, draftGain);
	}

	function dbAtPointer(element: HTMLElement, clientY: number, offsetPercent: number): number {
		const rect = element.getBoundingClientRect();
		if (rect.height <= 0) return 0;
		const pointerPercent = ((rect.bottom - clientY) / rect.height) * 100;
		return (
			Math.round(
				mixerFaderPercentToDb(Math.min(100, Math.max(0, pointerPercent + offsetPercent))) * 10
			) / 10
		);
	}

	function flushFaderFrame(): void {
		faderAnimationFrame = null;
		if (!gesture || queuedPointerY === null) return;
		gesture.draftDb = dbAtPointer(gesture.element, queuedPointerY, gesture.offsetPercent);
		queuedPointerY = null;
		previewFader(gesture.target, gesture.startDb, gesture.draftDb);
	}

	function queueFaderPointer(clientY: number): void {
		queuedPointerY = clientY;
		if (faderAnimationFrame === null) {
			faderAnimationFrame = requestAnimationFrame(flushFaderFrame);
		}
	}

	function startFader(event: PointerEvent, target: FaderTarget): void {
		if (gesture) cancelFader();
		// SAFETY: startFader is bound to the fader element; currentTarget is that HTMLElement.
		const element = event.currentTarget as HTMLElement;
		const startDb = targetDb(target);
		const rect = element.getBoundingClientRect();
		const pointerPercent =
			rect.height > 0 ? ((rect.bottom - event.clientY) / rect.height) * 100 : 0;
		const startPercent = mixerDbToFaderPercent(startDb);
		const distancePx = (Math.abs(startPercent - pointerPercent) / 100) * rect.height;
		gesture = {
			target,
			pointerId: event.pointerId,
			element,
			before: captureSnapshot(),
			startDb,
			draftDb: startDb,
			offsetPercent: distancePx <= 14 ? startPercent - pointerPercent : 0
		};
		element.setPointerCapture(event.pointerId);
		queueFaderPointer(event.clientY);
		event.preventDefault();
	}

	function moveFader(event: PointerEvent): void {
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		queueFaderPointer(event.clientY);
	}

	function commitTrackVolume(trackId: string, db: number, before?: TimelineSnapshot): void {
		const apply = () => {
			timelineStore._setTracks(
				timelineStore.tracks.map((track) =>
					track.id === trackId ? { ...track, volume: mixerDbToGain(db) } : track
				)
			);
		};
		if (before) {
			apply();
			commandHistory.addUndoEntry(
				{ type: 'UPDATE_TRACK_VOLUME', payload: { trackId, volumeDb: db } },
				before
			);
		} else {
			commandHistory.execute(
				{ type: 'UPDATE_TRACK_VOLUME', payload: { trackId, volumeDb: db } },
				apply
			);
		}
	}

	function commitMasterVolume(db: number, before?: TimelineSnapshot): void {
		const apply = () => timelineStore._setMasterVolumeDb(db);
		if (before) {
			apply();
			commandHistory.addUndoEntry(
				{ type: 'UPDATE_MASTER_VOLUME', payload: { volumeDb: db } },
				before
			);
		} else {
			commandHistory.execute({ type: 'UPDATE_MASTER_VOLUME' }, apply);
		}
	}

	function finishFader(event: PointerEvent): void {
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		queuedPointerY = event.clientY;
		if (faderAnimationFrame !== null) cancelAnimationFrame(faderAnimationFrame);
		flushFaderFrame();
		const finished = gesture;
		gesture = null;
		if (finished.element.hasPointerCapture(event.pointerId)) {
			finished.element.releasePointerCapture(event.pointerId);
		}
		if (finished.target.kind === 'master') {
			commitMasterVolume(finished.draftDb, finished.before);
			setMixerMaster(finished.draftDb, timelineStore.masterMuted);
		} else {
			commitTrackVolume(finished.target.trackId, finished.draftDb, finished.before);
			setMixerTrackPreviewGain(finished.target.trackId, mixerDbToGain(finished.draftDb));
		}
	}

	function cancelFader(): void {
		if (!gesture) return;
		if (faderAnimationFrame !== null) cancelAnimationFrame(faderAnimationFrame);
		faderAnimationFrame = null;
		queuedPointerY = null;
		const cancelled = gesture;
		gesture = null;
		if (cancelled.element.hasPointerCapture(cancelled.pointerId)) {
			cancelled.element.releasePointerCapture(cancelled.pointerId);
		}
		setFaderVisual(cancelled.target, cancelled.startDb);
		if (cancelled.target.kind === 'master') {
			setMixerMaster(timelineStore.masterVolumeDb, timelineStore.masterMuted);
		} else {
			setMixerTrackPreviewGain(cancelled.target.trackId, mixerDbToGain(cancelled.startDb));
		}
	}

	function resetFader(target: FaderTarget): void {
		if (target.kind === 'master') {
			commitMasterVolume(0);
			setMixerMaster(0, timelineStore.masterMuted);
		} else {
			commitTrackVolume(target.trackId, 0);
			setMixerTrackPreviewGain(target.trackId, 1);
		}
	}

	function keyboardFader(event: KeyboardEvent, target: FaderTarget): void {
		let next: number | null = null;
		const current = targetDb(target);
		const step = event.shiftKey ? 0.1 : 1;
		if (event.key === 'ArrowUp') next = current + step;
		if (event.key === 'ArrowDown') next = current - step;
		if (event.key === 'PageUp') next = current + 6;
		if (event.key === 'PageDown') next = current - 6;
		if (event.key === 'Home') next = MIXER_MAX_DB;
		if (event.key === 'End') next = MIXER_MIN_DB;
		if (event.key === '0') next = 0;
		if (next === null) return;
		event.preventDefault();
		next = Math.min(MIXER_MAX_DB, Math.max(MIXER_MIN_DB, Math.round(next * 10) / 10));
		if (target.kind === 'master') {
			commitMasterVolume(next);
			setMixerMaster(next, timelineStore.masterMuted);
		} else {
			commitTrackVolume(target.trackId, next);
		}
	}

	function updateTrackFlag(trackId: string, flag: 'muted' | 'solo'): void {
		const track = timelineStore.tracks.find((candidate) => candidate.id === trackId);
		if (!track || isTrackEffectivelyLocked(trackId, timelineStore.tracks)) return;
		commandHistory.execute(
			{ type: flag === 'muted' ? 'UPDATE_TRACK_MUTE' : 'UPDATE_TRACK_SOLO', payload: { trackId } },
			() =>
				timelineStore._setTracks(
					timelineStore.tracks.map((candidate) =>
						candidate.id === trackId ? { ...candidate, [flag]: !candidate[flag] } : candidate
					)
				)
		);
	}

	function toggleMasterMute(): void {
		commandHistory.execute({ type: 'UPDATE_MASTER_MUTE' }, () =>
			timelineStore._setMasterMuted(!timelineStore.masterMuted)
		);
		setMixerMaster(timelineStore.masterVolumeDb, timelineStore.masterMuted);
	}

	function paintMeter(key: string, state: MeterBallistics, now: number): void {
		if (!root) return;
		const escaped = CSS.escape(key);
		for (const [channel, level, peak] of [
			['left', state.left, state.peakLeft],
			['right', state.right, state.peakRight]
		] as const) {
			const fill = root.querySelector<HTMLElement>(
				`[data-meter-fill="${escaped}"][data-channel="${channel}"]`
			);
			const peakLine = root.querySelector<HTMLElement>(
				`[data-meter-peak="${escaped}"][data-channel="${channel}"]`
			);
			if (fill) fill.style.height = `${meterLevelToPercent(level)}%`;
			if (peakLine) peakLine.style.bottom = `${meterLevelToPercent(peak)}%`;
		}
		const clip = root.querySelector<HTMLElement>(`[data-meter-clip="${escaped}"]`);
		if (clip) clip.dataset.active = String(state.clippedUntil > now);
	}

	function meterFrame(now: number): void {
		meterAnimationFrame = requestAnimationFrame(meterFrame);
		if (now - lastMeterPaint < 32) return;
		lastMeterPaint = now;
		const active = new Set(activeMixerTrackIds());
		for (const track of audioTracks) {
			const state = meterStates.get(track.id) ?? createMeterBallistics();
			meterStates.set(track.id, state);
			const levels = active.has(track.id) ? readMixerTrackLevels(track.id) : { left: 0, right: 0 };
			advanceMeterBallistics(state, levels.left, levels.right, now);
			paintMeter(track.id, state, now);
		}
		const masterState = meterStates.get('master') ?? createMeterBallistics();
		meterStates.set('master', masterState);
		const master = readMixerMasterLevels();
		advanceMeterBallistics(masterState, master.left, master.right, now);
		paintMeter('master', masterState, now);
	}

	function windowKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !gesture) return;
		event.preventDefault();
		cancelFader();
	}

	onMount(() => {
		setMixerMaster(timelineStore.masterVolumeDb, timelineStore.masterMuted);
		meterAnimationFrame = requestAnimationFrame(meterFrame);
	});

	onDestroy(() => {
		cancelFader();
		if (meterAnimationFrame !== null) cancelAnimationFrame(meterAnimationFrame);
	});
</script>

<svelte:window onkeydown={windowKeydown} />

<section
	bind:this={root}
	class="border-y border-[oklch(0.25_0.015_55)] bg-[oklch(0.135_0.008_55)]"
	aria-label={m.video_editor_mixer()}
	data-audio-mixer
>
	<div class="flex h-56 min-w-0 overflow-x-auto overscroll-x-contain px-2 py-2">
		<div class="relative mr-1 w-6 shrink-0" aria-hidden="true">
			{#each SCALE_MARKS as mark}
				<span
					class="absolute right-0 -translate-y-1/2 font-mono text-[8px] text-white/35 tabular-nums"
					style:bottom={`${mixerDbToFaderPercent(mark)}%`}>{mark}</span
				>
			{/each}
		</div>

		{#each audioTracks as track (track.id)}
			{@const db = mixerGainToDb(track.volume ?? 1)}
			{@const target = { kind: 'track', trackId: track.id } as const}
			{@const locked = isTrackEffectivelyLocked(track.id, timelineStore.tracks)}
			<div class="channel-strip" data-mixer-track={track.id}>
				<div class="flex min-w-0 items-center gap-1">
					<span class="min-w-0 flex-1 truncate text-[10px] font-medium" title={track.name}
						>{track.name}</span
					>
					{#if locked}<LockIcon class="size-3 shrink-0 text-amber-300/80" />{/if}
				</div>
				<div class="grid grid-cols-2 gap-1">
					<button
						type="button"
						class="channel-button data-[active=true]:border-amber-300/60 data-[active=true]:bg-amber-400/20 data-[active=true]:text-amber-100"
						data-active={track.solo}
						aria-pressed={track.solo}
						aria-label={track.solo
							? m.video_editor_mixer_track_unsolo({ name: track.name })
							: m.video_editor_mixer_track_solo({ name: track.name })}
						disabled={locked}
						onclick={() => updateTrackFlag(track.id, 'solo')}>S</button
					>
					<button
						type="button"
						class="channel-button data-[active=true]:border-red-300/60 data-[active=true]:bg-red-500/25 data-[active=true]:text-red-100"
						data-active={track.muted}
						aria-pressed={track.muted}
						aria-label={track.muted
							? m.video_editor_mixer_track_unmute({ name: track.name })
							: m.video_editor_mixer_track_mute({ name: track.name })}
						disabled={locked}
						onclick={() => updateTrackFlag(track.id, 'muted')}>M</button
					>
				</div>
				<div class="flex min-h-0 flex-1 justify-center gap-2">
					<div class="flex w-3 gap-px" aria-hidden="true">
						{#each ['left', 'right'] as channel}
							<div class="meter-well">
								<div data-meter-fill={track.id} data-channel={channel} class="meter-fill"></div>
								<div data-meter-peak={track.id} data-channel={channel} class="meter-peak"></div>
							</div>
						{/each}
					</div>
					<div
						class="fader disabled:cursor-not-allowed disabled:opacity-40"
						class:pointer-events-none={locked}
						role="slider"
						tabindex={locked ? -1 : 0}
						aria-label={m.video_editor_mixer_track_volume({ name: track.name })}
						aria-valuemin={MIXER_MIN_DB}
						aria-valuemax={MIXER_MAX_DB}
						aria-valuenow={db}
						aria-valuetext={formatMixerDb(db)}
						onpointerdown={(event) => startFader(event, target)}
						onpointermove={moveFader}
						onpointerup={finishFader}
						onpointercancel={cancelFader}
						onlostpointercapture={cancelFader}
						ondblclick={() => resetFader(target)}
						onkeydown={(event) => keyboardFader(event, target)}
					>
						<div class="fader-rail"></div>
						<div class="fader-unity" style:bottom={`${mixerDbToFaderPercent(0)}%`}></div>
						<div
							class="fader-knob"
							data-fader-knob={track.id}
							style:bottom={`${mixerDbToFaderPercent(db)}%`}
						></div>
					</div>
				</div>
				<div class="flex items-center justify-center gap-1">
					<span class="db-readout" data-fader-readout={track.id}>{formatMixerDb(db)}</span>
					<span
						class="clip-light"
						data-meter-clip={track.id}
						data-active="false"
						title={m.video_editor_mixer_clipping()}
					></span>
				</div>
			</div>
		{/each}

		<div class="channel-strip master-strip" data-mixer-master>
			<div class="truncate text-[10px] font-semibold tracking-wide text-amber-100 uppercase">
				{m.video_editor_mixer_master()}
			</div>
			<button
				type="button"
				class="channel-button data-[active=true]:border-red-300/60 data-[active=true]:bg-red-500/25 data-[active=true]:text-red-100"
				data-active={timelineStore.masterMuted}
				aria-pressed={timelineStore.masterMuted}
				aria-label={timelineStore.masterMuted
					? m.video_editor_mixer_master_unmute()
					: m.video_editor_mixer_master_mute()}
				onclick={toggleMasterMute}>M</button
			>
			<div class="flex min-h-0 flex-1 justify-center gap-2">
				<div class="flex w-3 gap-px" aria-hidden="true">
					{#each ['left', 'right'] as channel}
						<div class="meter-well">
							<div data-meter-fill="master" data-channel={channel} class="meter-fill"></div>
							<div data-meter-peak="master" data-channel={channel} class="meter-peak"></div>
						</div>
					{/each}
				</div>
				<div
					class="fader"
					role="slider"
					tabindex="0"
					aria-label={m.video_editor_mixer_master_volume()}
					aria-valuemin={MIXER_MIN_DB}
					aria-valuemax={MIXER_MAX_DB}
					aria-valuenow={timelineStore.masterVolumeDb}
					aria-valuetext={formatMixerDb(timelineStore.masterVolumeDb)}
					onpointerdown={(event) => startFader(event, MASTER_TARGET)}
					onpointermove={moveFader}
					onpointerup={finishFader}
					onpointercancel={cancelFader}
					onlostpointercapture={cancelFader}
					ondblclick={() => resetFader(MASTER_TARGET)}
					onkeydown={(event) => keyboardFader(event, MASTER_TARGET)}
				>
					<div class="fader-rail"></div>
					<div class="fader-unity" style:bottom={`${mixerDbToFaderPercent(0)}%`}></div>
					<div
						class="fader-knob bg-amber-100"
						data-fader-knob="master"
						style:bottom={`${mixerDbToFaderPercent(timelineStore.masterVolumeDb)}%`}
					></div>
				</div>
			</div>
			<div class="flex items-center justify-center gap-1">
				<span class="db-readout text-amber-100" data-fader-readout="master"
					>{formatMixerDb(timelineStore.masterVolumeDb)}</span
				>
				<span
					class="clip-light"
					data-meter-clip="master"
					data-active="false"
					title={m.video_editor_mixer_clipping()}
				></span>
			</div>
		</div>
	</div>
</section>

<style>
	.channel-strip {
		display: flex;
		width: 5.5rem;
		min-width: 5.5rem;
		flex-direction: column;
		gap: 0.3rem;
		border-right: 1px solid oklch(0.25 0.015 55);
		padding: 0 0.45rem;
	}
	.master-strip {
		margin-left: 0.25rem;
		border-right: 0;
		border-left: 1px solid oklch(0.5 0.08 70 / 0.5);
		background: oklch(0.2 0.025 65 / 0.28);
	}
	.channel-button {
		min-height: 1.75rem;
		min-width: 1.75rem;
		border: 1px solid oklch(0.32 0.015 55);
		border-radius: 0.25rem;
		background: oklch(0.2 0.01 55);
		font-size: 0.625rem;
		font-weight: 700;
		color: oklch(0.72 0.01 55);
	}
	.channel-button:focus-visible,
	.fader:focus-visible {
		outline: 2px solid oklch(0.72 0.14 55);
		outline-offset: 1px;
	}
	.channel-button:disabled {
		opacity: 0.4;
	}
	.fader {
		position: relative;
		width: 2.75rem;
		min-height: 5.5rem;
		cursor: ns-resize;
		touch-action: none;
		user-select: none;
	}
	.fader-rail {
		position: absolute;
		inset-block: 0.45rem;
		left: 50%;
		width: 2px;
		transform: translateX(-50%);
		background: oklch(0.32 0.01 55);
	}
	.fader-unity {
		position: absolute;
		left: 0.35rem;
		right: 0.35rem;
		height: 1px;
		background: oklch(0.7 0.02 55 / 0.45);
	}
	.fader-knob {
		position: absolute;
		left: 50%;
		width: 2.35rem;
		height: 0.85rem;
		transform: translate(-50%, 50%);
		border: 1px solid oklch(0.25 0.01 55);
		border-radius: 0.2rem;
		background: oklch(0.86 0.01 55);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.45);
	}
	.fader-knob::after {
		position: absolute;
		top: 50%;
		left: 0.2rem;
		right: 0.2rem;
		height: 1px;
		content: '';
		background: oklch(0.35 0.01 55);
	}
	.meter-well {
		position: relative;
		flex: 1;
		overflow: hidden;
		border-radius: 1px;
		background: oklch(0.08 0.005 55);
	}
	.meter-fill {
		position: absolute;
		inset-inline: 0;
		bottom: 0;
		height: 0;
		background: linear-gradient(to top, #22c55e 0 72%, #facc15 72% 88%, #ef4444 88%);
		mask-image: repeating-linear-gradient(to top, #000 0 3px, transparent 3px 4px);
	}
	.meter-peak {
		position: absolute;
		inset-inline: 0;
		bottom: 0;
		height: 2px;
		background: white;
	}
	.db-readout {
		min-width: 2.5rem;
		font-family: ui-monospace, monospace;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: oklch(0.72 0.01 55);
	}
	.clip-light {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 999px;
		background: oklch(0.45 0.04 25);
	}
	:global(.clip-light[data-active='true']) {
		background: oklch(0.65 0.22 25);
		box-shadow: 0 0 5px oklch(0.65 0.22 25);
	}
	@media (pointer: coarse) {
		.channel-button,
		.fader {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}
	}
</style>
