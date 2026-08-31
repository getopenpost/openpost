<script lang="ts">
	import { onDestroy } from 'svelte';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { m } from '$lib/paraglide/messages';
	import type { MediaMetadata } from '$lib/video-editor/media/types';
	import { resolveMediaBlob } from '$lib/video-editor/media/import.svelte';
	import {
		chooseEmbeddedSubtitleTrack,
		formatEmbeddedSubtitleTrackLabel,
		insertEmbeddedSubtitleTrack,
		scanEmbeddedSubtitleTracks,
		type EmbeddedSubtitleInsertResult,
		type EmbeddedSubtitleScanResult
	} from '$lib/video-editor/media/embedded-subtitle-service';
	import type { EmbeddedSubtitleTrack } from '$lib/video-editor/media/embedded-subtitles';

	let {
		media,
		open = $bindable(false),
		canvasWidth,
		canvasHeight,
		oninsert = () => undefined,
		resolve = resolveMediaBlob,
		scan = scanEmbeddedSubtitleTracks,
		insert = insertEmbeddedSubtitleTrack
	}: {
		media: MediaMetadata | null;
		open?: boolean;
		canvasWidth: number;
		canvasHeight: number;
		oninsert?: (result: EmbeddedSubtitleInsertResult) => void;
		resolve?: typeof resolveMediaBlob;
		scan?: typeof scanEmbeddedSubtitleTracks;
		insert?: typeof insertEmbeddedSubtitleTrack;
	} = $props();

	type PickerState = 'idle' | 'scanning' | 'ready' | 'empty' | 'error';

	let pickerState = $state<PickerState>('idle');
	let result = $state<EmbeddedSubtitleScanResult | null>(null);
	let selectedTrackNumber = $state('');
	let errorMessage = $state('');
	let bytesRead = $state(0);
	let totalBytes = $state(0);
	let scannedMediaId = $state<string | null>(null);
	let scanController: AbortController | null = null;
	let scanVersion = 0;

	const progressPercent = $derived(
		totalBytes > 0 ? Math.min(100, Math.round((bytesRead / totalBytes) * 100)) : 0
	);
	const selectedTrack = $derived(
		result?.tracks.find((track) => String(track.trackNumber) === selectedTrackNumber) ?? null
	);

	function formatBytes(value: number): string {
		if (value < 1024) return `${value} B`;
		if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
		if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
		return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	function resetScan(): void {
		scanController?.abort();
		scanController = null;
		result = null;
		selectedTrackNumber = '';
		errorMessage = '';
		bytesRead = 0;
		totalBytes = 0;
		pickerState = 'idle';
	}

	async function startScan(target: MediaMetadata): Promise<void> {
		resetScan();
		scannedMediaId = target.id;
		pickerState = 'scanning';
		totalBytes = target.fileSize;
		const version = ++scanVersion;
		const controller = new AbortController();
		scanController = controller;
		try {
			const blob = await resolve(target);
			if (version !== scanVersion || controller.signal.aborted) return;
			totalBytes = blob.size;
			const next = await scan(target, blob, {
				signal: controller.signal,
				onProgress: (progress) => {
					if (version !== scanVersion) return;
					bytesRead = progress.bytesRead;
					totalBytes = progress.totalBytes;
				}
			});
			if (version !== scanVersion || controller.signal.aborted) return;
			result = next;
			const preferred = chooseEmbeddedSubtitleTrack(next.tracks);
			selectedTrackNumber = preferred ? String(preferred.trackNumber) : '';
			pickerState = next.tracks.length > 0 ? 'ready' : 'empty';
		} catch (error) {
			if (version !== scanVersion || controller.signal.aborted) return;
			errorMessage = error instanceof Error ? error.message : m.video_editor_subtitle_scan_failed();
			pickerState = 'error';
		} finally {
			if (version === scanVersion) scanController = null;
		}
	}

	function retry(): void {
		if (media) void startScan(media);
	}

	function commitSelection(): void {
		if (!media || !selectedTrack) return;
		const inserted = insert(media, selectedTrack, { canvasWidth, canvasHeight });
		oninsert(inserted);
		open = false;
	}

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
	}

	$effect(() => {
		if (!open || !media) {
			scanVersion += 1;
			resetScan();
			scannedMediaId = null;
			return;
		}
		if (scannedMediaId === media.id) return;
		void startScan(media);
	});

	onDestroy(() => {
		scanVersion += 1;
		scanController?.abort();
	});
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="video-editor-theme border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] text-[var(--video-editor-text)] sm:max-w-lg"
	>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base text-[var(--video-editor-text)]">
				<CaptionsIcon class="size-4 text-[var(--video-editor-focus)]" aria-hidden="true" />
				{m.video_editor_embedded_subtitles_title()}
			</Dialog.Title>
			<Dialog.Description class="text-[var(--video-editor-muted)]">
				{m.video_editor_embedded_subtitles_description({ name: media?.fileName ?? '' })}
			</Dialog.Description>
		</Dialog.Header>

		{#if pickerState === 'scanning'}
			<div
				class="space-y-3 rounded-lg border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] p-4"
				aria-live="polite"
			>
				<div class="flex items-center justify-between gap-3 text-xs">
					<span class="flex items-center gap-2 font-medium">
						<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
						{m.video_editor_subtitle_scanning()}
					</span>
					<span class="text-[var(--video-editor-muted)] tabular-nums">{progressPercent}%</span>
				</div>
				<progress class="subtitle-progress h-1.5 w-full" max="100" value={progressPercent}>
					{progressPercent}%
				</progress>
				<p class="text-[11px] text-[var(--video-editor-muted)] tabular-nums">
					{formatBytes(bytesRead)} / {formatBytes(totalBytes)}
				</p>
			</div>
		{:else if pickerState === 'ready' && result}
			<div class="space-y-3">
				<div class="flex items-center justify-between gap-2">
					<p class="text-xs text-[var(--video-editor-muted)]">
						{result.tracks.length === 1
							? m.video_editor_subtitle_track_found()
							: m.video_editor_subtitle_tracks_found({ count: result.tracks.length })}
					</p>
					{#if result.fromCache}
						<Badge
							class="border-[var(--video-editor-border)] bg-[var(--video-editor-control)] text-[var(--video-editor-muted)]"
						>
							{m.video_editor_subtitle_cached()}
						</Badge>
					{/if}
				</div>
				<RadioGroup.Root
					value={selectedTrackNumber}
					onValueChange={(value) => (selectedTrackNumber = value)}
					class="max-h-72 space-y-2 overflow-y-auto pr-1"
					aria-label={m.video_editor_subtitle_choose_track()}
				>
					{#each result.tracks as track (track.trackNumber)}
						<label
							class={[
								'flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
								selectedTrackNumber === String(track.trackNumber)
									? 'border-[var(--video-editor-focus)] bg-[color-mix(in_oklch,var(--video-editor-focus)_10%,transparent)]'
									: 'border-[var(--video-editor-border)] bg-[var(--video-editor-control)] hover:bg-[var(--video-editor-control-hover)]'
							]}
						>
							<RadioGroup.Item
								value={String(track.trackNumber)}
								aria-label={formatEmbeddedSubtitleTrackLabel(track)}
								class="mt-0.5 border-[var(--video-editor-border)] bg-[var(--video-editor-canvas)] data-[state=checked]:border-[var(--video-editor-focus)] data-[state=checked]:text-[var(--video-editor-focus)]"
							/>
							<span class="min-w-0 flex-1">
								<span class="flex flex-wrap items-center gap-1.5 text-xs font-medium">
									{track.name?.trim() ||
										track.language ||
										m.video_editor_subtitle_track_number({ number: track.trackNumber })}
									{#if track.forced}<Badge>{m.video_editor_subtitle_forced()}</Badge>{/if}
									{#if track.default}<Badge>{m.video_editor_subtitle_default()}</Badge>{/if}
								</span>
								<span class="mt-1 block text-[11px] text-[var(--video-editor-muted)]">
									{track.language} · {track.codecId} · {track.cues.length === 1
										? m.video_editor_subtitle_one_cue()
										: m.video_editor_subtitle_cue_count({ count: track.cues.length })}
								</span>
							</span>
						</label>
					{/each}
				</RadioGroup.Root>
			</div>
		{:else if pickerState === 'empty'}
			<div
				class="rounded-lg border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] p-5 text-center"
			>
				<CaptionsIcon
					class="mx-auto mb-2 size-5 text-[var(--video-editor-muted)]"
					aria-hidden="true"
				/>
				<p class="font-medium">{m.video_editor_subtitle_no_tracks()}</p>
				<p class="mt-1 text-[11px] text-[var(--video-editor-muted)]">
					{m.video_editor_subtitle_no_tracks_hint()}
				</p>
			</div>
		{:else if pickerState === 'error'}
			<div class="rounded-lg border border-red-400/40 bg-red-500/10 p-4" role="alert">
				<p class="font-medium text-red-200">{m.video_editor_subtitle_scan_failed()}</p>
				<p class="mt-1 text-[11px] break-words text-red-200/80">{errorMessage}</p>
				<Button class="mt-3" variant="outline" size="sm" onclick={retry}>
					<RefreshIcon class="size-3.5" aria-hidden="true" />
					{m.common_retry()}
				</Button>
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="ghost" onclick={() => handleOpenChange(false)}>{m.common_cancel()}</Button>
			<Button disabled={pickerState !== 'ready' || !selectedTrack} onclick={commitSelection}>
				{selectedTrack
					? selectedTrack.cues.length === 1
						? m.video_editor_subtitle_insert_one_cue()
						: m.video_editor_subtitle_insert_cues({ count: selectedTrack.cues.length })
					: m.video_editor_subtitle_insert()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.subtitle-progress {
		appearance: none;
		overflow: hidden;
		border-radius: 999px;
		background: var(--video-editor-canvas);
	}

	.subtitle-progress::-webkit-progress-bar {
		background: var(--video-editor-canvas);
	}

	.subtitle-progress::-webkit-progress-value {
		background: var(--video-editor-focus);
	}

	.subtitle-progress::-moz-progress-bar {
		background: var(--video-editor-focus);
	}
</style>
