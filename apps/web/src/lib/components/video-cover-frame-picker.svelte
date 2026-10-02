<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';
	import type { ComposerSettingValue } from '$lib/components/compose/modes';
	import {
		captureVideoFrame,
		clampCoverFrameTimestamp,
		formatCoverFrameTimestamp
	} from '$lib/video/cover-frame';

	export interface GeneratedCoverFrame {
		sourceMediaId: string;
		timestampMs: number;
	}

	interface Props {
		mediaId: string;
		value?: ComposerSettingValue;
		mode: 'timestamp' | 'image';
		label: string;
		onTimestampChange?: (timestampMs: number) => void;
		onFileChange?: (file: File, metadata: GeneratedCoverFrame) => void | Promise<void>;
		onEditFrame?: (file: File, metadata: GeneratedCoverFrame) => Promise<void>;
	}

	let { mediaId, value, mode, label, onTimestampChange, onFileChange, onEditFrame }: Props =
		$props();

	let candidateVideo = $state<HTMLVideoElement>();
	let candidates = $state<Array<{ timestamp: number; url: string }>>([]);
	let candidateGeneration = 0;
	let editing = $state(false);
	let videoElement = $state<HTMLVideoElement>();
	let durationMs = $state(0);
	let timestampMs = $state(0);
	let ready = $state(false);
	let applying = $state(false);
	let loadFailed = $state(false);
	let applyFailed = $state(false);
	let appliedTimestampMs = $state<number | null>(null);

	const sourceURL = $derived(getAuthenticatedMediaByID(mediaId));
	const selectedTimestampMs = $derived(
		mode === 'timestamp' && (Number.isFinite(value) || String(value) === value)
			? Number(value)
			: null
	);

	async function loadCandidates() {
		const video = candidateVideo;
		if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
		const generation = ++candidateGeneration;
		for (const candidate of candidates) URL.revokeObjectURL(candidate.url);
		candidates = [];
		try {
			for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
				const timestamp = clampCoverFrameTimestamp(
					video.duration * 1000 * fraction,
					video.duration * 1000
				);
				const blob = await captureVideoFrame(video, timestamp, 240);
				if (generation !== candidateGeneration) return;
				candidates = [...candidates, { timestamp, url: URL.createObjectURL(blob) }];
			}
		} catch {
			// The main preview and manual frame selection remain usable if sampling fails.
		}
	}

	onDestroy(() => {
		candidateGeneration += 1;
		for (const candidate of candidates) URL.revokeObjectURL(candidate.url);
	});

	function handleLoadedMetadata() {
		if (!videoElement || !Number.isFinite(videoElement.duration) || videoElement.duration <= 0) {
			handleLoadError();
			return;
		}
		durationMs = Math.round(videoElement.duration * 1000);
		const initial = Number.isFinite(selectedTimestampMs)
			? Number(selectedTimestampMs)
			: Math.min(Math.round(durationMs * 0.1), 1_000);
		setTimestamp(initial);
		ready = true;
		loadFailed = false;
	}

	function handleLoadError() {
		ready = false;
		loadFailed = true;
	}

	function setTimestamp(nextTimestampMs: number) {
		timestampMs = clampCoverFrameTimestamp(nextTimestampMs, durationMs);
		if (videoElement && Math.abs(videoElement.currentTime * 1000 - timestampMs) > 10) {
			videoElement.currentTime = timestampMs / 1000;
		}
		applyFailed = false;
	}

	async function editFrame() {
		if (!videoElement || !ready || applying || editing || !onEditFrame) return;
		editing = true;
		applyFailed = false;
		try {
			const blob = await captureVideoFrame(videoElement, timestampMs);
			await onEditFrame(
				new File([blob], `cover-frame-${timestampMs}.jpg`, { type: 'image/jpeg' }),
				{
					sourceMediaId: mediaId,
					timestampMs
				}
			);
		} catch {
			applyFailed = true;
		} finally {
			editing = false;
		}
	}

	async function applyFrame() {
		if (!videoElement || !ready || applying || editing) return;
		applying = true;
		applyFailed = false;
		try {
			if (mode === 'timestamp') {
				onTimestampChange?.(timestampMs);
			} else {
				const blob = await captureVideoFrame(videoElement, timestampMs);
				const file = new File([blob], `cover-frame-${timestampMs}.jpg`, {
					type: 'image/jpeg',
					lastModified: Date.now()
				});
				await onFileChange?.(file, { sourceMediaId: mediaId, timestampMs });
			}
			appliedTimestampMs = timestampMs;
		} catch {
			applyFailed = true;
		} finally {
			applying = false;
		}
	}
</script>

<div class="mt-2 space-y-3 rounded-md border bg-muted/20 p-3">
	<video
		bind:this={candidateVideo}
		src={sourceURL}
		hidden
		muted
		playsinline
		preload="metadata"
		onloadedmetadata={loadCandidates}
	></video>
	<p class="text-xs text-muted-foreground">{m.compose_cover_frame_help()}</p>

	<div class="overflow-hidden rounded-md bg-black">
		<video
			bind:this={videoElement}
			src={sourceURL}
			class="h-48 w-full object-contain"
			muted
			playsinline
			preload="metadata"
			onloadedmetadata={handleLoadedMetadata}
			onerror={handleLoadError}
			aria-label={m.compose_cover_frame_preview({ setting: label })}
		></video>
	</div>

	{#if loadFailed}
		<p class="text-xs text-destructive" role="alert">
			{m.compose_cover_frame_load_failed()}
		</p>
	{:else if !ready}
		<p class="text-xs text-muted-foreground" aria-live="polite">
			{m.compose_cover_frame_loading()}
		</p>
	{:else}
		{#if candidates.length > 0}
			<div
				class="grid grid-cols-3 gap-1 sm:grid-cols-5"
				role="group"
				aria-label={m.compose_cover_frames()}
			>
				{#each candidates as candidate (candidate.url)}
					<button
						type="button"
						class="min-h-11 min-w-0 overflow-hidden rounded border border-transparent text-xs focus-visible:outline-2 focus-visible:outline-primary aria-pressed:border-primary"
						aria-label={m.compose_cover_frame_choose({
							time: formatCoverFrameTimestamp(candidate.timestamp)
						})}
						aria-pressed={timestampMs === candidate.timestamp}
						disabled={applying || editing}
						onclick={() => setTimestamp(candidate.timestamp)}
					>
						<img src={candidate.url} alt="" class="aspect-video w-full bg-black object-contain" />
						<span class="block py-1 tabular-nums"
							>{formatCoverFrameTimestamp(candidate.timestamp)}</span
						>
					</button>
				{/each}
			</div>
		{/if}
		<div class="space-y-2">
			<Slider
				value={timestampMs}
				min={0}
				max={Math.max(durationMs - 1, 0)}
				step={100}
				disabled={applying || editing}
				ariaLabel={m.compose_cover_frame_time()}
				onValueChange={setTimestamp}
			/>
			<div class="flex justify-between text-xs text-muted-foreground tabular-nums">
				<span>{formatCoverFrameTimestamp(timestampMs)}</span>
				<span>{formatCoverFrameTimestamp(durationMs)}</span>
			</div>
		</div>

		<Button
			type="button"
			variant="outline"
			size="sm"
			class="min-h-11 w-full sm:w-auto"
			disabled={applying || editing}
			onclick={applyFrame}
		>
			{#if applying}
				<ProtectedIcon icon="loading" class="size-4 animate-spin" />
				{m.compose_cover_frame_applying()}
			{:else}
				{m.compose_cover_frame_use()}
			{/if}
		</Button>
		{#if mode === 'image' && onEditFrame}
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="min-h-11 w-full sm:ml-2 sm:w-auto"
				disabled={applying || editing}
				onclick={editFrame}
			>
				{#if editing}<ProtectedIcon icon="loading" class="size-4 animate-spin" />{/if}
				{m.compose_cover_frame_edit()}
			</Button>
		{/if}
	{/if}

	{#if applyFailed}
		<p class="text-xs text-destructive" role="alert">
			{m.compose_cover_frame_apply_failed()}
		</p>
	{:else if appliedTimestampMs !== null}
		<p class="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
			<ProtectedIcon icon="success" class="size-3.5 text-success-foreground" />
			{m.compose_cover_frame_selected({
				time: formatCoverFrameTimestamp(appliedTimestampMs)
			})}
		</p>
	{:else if mode === 'image' && typeof value === 'string' && value}
		<p class="text-xs text-muted-foreground">{m.compose_cover_image_selected()}</p>
		<img
			src={getAuthenticatedMediaByID(value)}
			alt={m.compose_cover_image_selected()}
			class="max-h-40 max-w-full rounded object-contain"
		/>
	{/if}
</div>
