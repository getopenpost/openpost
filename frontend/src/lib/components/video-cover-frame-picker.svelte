<script lang="ts">
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { m } from '$lib/paraglide/messages';
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
		value?: unknown;
		mode: 'timestamp' | 'image';
		label: string;
		onTimestampChange?: (timestampMs: number) => void;
		onFileChange?: (file: File, metadata: GeneratedCoverFrame) => void | Promise<void>;
	}

	let { mediaId, value, mode, label, onTimestampChange, onFileChange }: Props = $props();

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
		mode === 'timestamp' && (typeof value === 'number' || typeof value === 'string')
			? Number(value)
			: null
	);

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

	async function applyFrame() {
		if (!videoElement || !ready || applying) return;
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
		<p class="text-xs text-destructive" role="alert">{m.compose_cover_frame_load_failed()}</p>
	{:else if !ready}
		<p class="text-xs text-muted-foreground" aria-live="polite">
			{m.compose_cover_frame_loading()}
		</p>
	{:else}
		<div class="space-y-2">
			<Slider
				value={timestampMs}
				min={0}
				max={Math.max(durationMs - 1, 0)}
				step={100}
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
			disabled={applying}
			onclick={applyFrame}
		>
			{#if applying}
				<LoaderIcon class="size-4 animate-spin" aria-hidden="true" />
				{m.compose_cover_frame_applying()}
			{:else}
				{m.compose_cover_frame_use()}
			{/if}
		</Button>
	{/if}

	{#if applyFailed}
		<p class="text-xs text-destructive" role="alert">{m.compose_cover_frame_apply_failed()}</p>
	{:else if appliedTimestampMs !== null}
		<p class="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
			<CheckIcon class="size-3.5 text-emerald-600" aria-hidden="true" />
			{m.compose_cover_frame_selected({
				time: formatCoverFrameTimestamp(appliedTimestampMs)
			})}
		</p>
	{:else if mode === 'image' && typeof value === 'string' && value}
		<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<CheckIcon class="size-3.5 text-emerald-600" aria-hidden="true" />
			{m.compose_cover_image_selected()}
		</p>
	{/if}
</div>
