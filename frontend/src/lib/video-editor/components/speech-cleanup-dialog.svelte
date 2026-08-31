<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { analyzeSilenceSignal } from '$lib/video-editor/media/silence';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
	import type { SourceRange } from '$lib/video-editor/timeline/actions/range-removal';
	import { sourceSecondsToTimelineFrame } from '$lib/video-editor/timeline/utils/media-item-frames';
	import {
		collectTranscriptSourceWords,
		DEFAULT_FILLER_REMOVAL_SETTINGS,
		detectFillerRanges,
		detectTranscriptSilenceRanges,
		FILLER_REMOVAL_PRESETS,
		type FillerRange,
		type FillerRemovalPresetId,
		type FillerRemovalSettings
	} from '$lib/video-editor/transcript/speech-cleanup';
	import {
		applyFillerRangeRemoval,
		applySilenceRangeRemoval
	} from '$lib/video-editor/transcript/speech-cleanup-actions';
	import {
		scoreFillerRangesWithAudioConfidence,
		type FillerAudioConfidenceOptions
	} from '$lib/video-editor/transcript/filler-audio-confidence';

	type CleanupMode = 'fillers' | 'silence';
	type SilenceMode = 'signal' | 'transcript';
	type ReviewRange = {
		id: string;
		mediaId: string;
		start: number;
		end: number;
		label: string;
		filler?: FillerRange;
	};

	let {
		open = $bindable(false),
		itemIds,
		initialMode = 'fillers',
		onapplied,
		scoreFillerRanges = scoreFillerRangesWithAudioConfidence
	}: {
		open?: boolean;
		itemIds: string[];
		initialMode?: CleanupMode;
		onapplied: (removedCount: number) => void;
		scoreFillerRanges?: (
			ranges: ReturnType<typeof detectFillerRanges>,
			options?: FillerAudioConfidenceOptions
		) => ReturnType<typeof scoreFillerRangesWithAudioConfidence>;
	} = $props();

	let mode = $state<CleanupMode>('fillers');
	let silenceMode = $state<SilenceMode>('signal');
	let fillerPreset = $state<FillerRemovalPresetId>('balanced');
	let fillerSettings = $state<FillerRemovalSettings>({ ...DEFAULT_FILLER_REMOVAL_SETTINGS });
	let fillerWordsDraft = $state(DEFAULT_FILLER_REMOVAL_SETTINGS.fillerWords.join(', '));
	let fillerPhrasesDraft = $state(DEFAULT_FILLER_REMOVAL_SETTINGS.fillerPhrases.join(', '));
	let minSilenceMs = $state(500);
	let paddingStartMs = $state(100);
	let paddingEndMs = $state(100);
	let autoThresholds = $state(true);
	let silenceThresholdDb = $state(-45);
	let audioThresholdDb = $state(-35);
	let reviewRanges = $state<ReviewRange[]>([]);
	let selectedIds = $state<Set<string>>(new Set());
	let analyzing = $state(false);
	let progress = $state(0);
	let analysisError = $state('');
	let reviewSignature = $state('');
	let opened = false;
	let abortController: AbortController | null = null;

	const selectedRanges = $derived(reviewRanges.filter((range) => selectedIds.has(range.id)));
	const selectedDuration = $derived(
		selectedRanges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0)
	);
	const hasTimedTranscript = $derived(
		collectTranscriptSourceWords(timelineStore.items, itemIds, timelineStore.fps).length > 0
	);
	const reviewIsCurrent = $derived(reviewSignature === cleanupSettingsSignature());

	$effect(() => {
		if (open && !opened) {
			opened = true;
			mode = initialMode;
			void analyze();
		} else if (!open && opened) {
			opened = false;
			cancelAnalysis();
			editorSession.pausePlayback();
		}
	});

	function parseEntries(value: string): string[] {
		return Array.from(
			new Set(
				value
					.split(',')
					.map((entry) => entry.trim().toLowerCase().replace(/\s+/g, ' '))
					.filter(Boolean)
			)
		).toSorted((left, right) => left.localeCompare(right));
	}

	function formatDuration(seconds: number): string {
		if (seconds < 10) return `${seconds.toFixed(1)}s`;
		const minutes = Math.floor(seconds / 60);
		const remainder = Math.round(seconds - minutes * 60);
		return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
	}

	function formatTimestamp(seconds: number): string {
		const minutes = Math.floor(Math.max(0, seconds) / 60);
		const remainder = Math.max(0, seconds) - minutes * 60;
		return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
	}

	function selectedCountLabel(count: number): string {
		return count === 1
			? m.video_editor_cleanup_selected_one()
			: m.video_editor_cleanup_selected_many({ count });
	}

	function mediaLabel(mediaId: string): string {
		return timelineStore.items.find((item) => item.mediaId === mediaId)?.label ?? mediaId;
	}

	function selectAll(ranges: ReviewRange[]): void {
		reviewRanges = ranges;
		selectedIds = new Set(ranges.map((range) => range.id));
	}

	function applyFillerPreset(id: FillerRemovalPresetId): void {
		const preset = FILLER_REMOVAL_PRESETS.find((candidate) => candidate.id === id);
		if (!preset) return;
		fillerPreset = id;
		fillerSettings = {
			...preset.settings,
			fillerWords: [...preset.settings.fillerWords],
			fillerPhrases: [...preset.settings.fillerPhrases]
		};
		fillerWordsDraft = fillerSettings.fillerWords.join(', ');
		fillerPhrasesDraft = fillerSettings.fillerPhrases.join(', ');
		void analyzeFillers();
	}

	function fillerPresetLabel(id: FillerRemovalPresetId): string {
		if (id === 'conservative') return m.video_editor_cleanup_preset_conservative();
		if (id === 'aggressive') return m.video_editor_cleanup_preset_aggressive();
		return m.video_editor_cleanup_preset_balanced();
	}

	function currentFillerSettings(): FillerRemovalSettings {
		return {
			...fillerSettings,
			fillerWords: parseEntries(fillerWordsDraft),
			fillerPhrases: parseEntries(fillerPhrasesDraft)
		};
	}

	function cleanupSettingsSignature(): string {
		return JSON.stringify(
			mode === 'fillers'
				? { mode, settings: currentFillerSettings() }
				: {
						mode,
						silenceMode,
						minSilenceMs,
						paddingStartMs,
						paddingEndMs,
						autoThresholds,
						silenceThresholdDb,
						audioThresholdDb
					}
		);
	}

	async function analyzeFillers(): Promise<void> {
		abortController?.abort();
		const controller = new AbortController();
		abortController = controller;
		analyzing = true;
		progress = 0;
		analysisError = '';
		const words = collectTranscriptSourceWords(timelineStore.items, itemIds, timelineStore.fps);
		if (words.length === 0) {
			selectAll([]);
			reviewSignature = cleanupSettingsSignature();
			abortController = null;
			analyzing = false;
			return;
		}
		const settings = currentFillerSettings();
		fillerSettings = settings;
		const detected = detectFillerRanges(words, settings);
		const detectedRanges = Object.values(detected).flat();
		selectAll(
			detectedRanges.map((range) => ({
				id: `filler:${range.id}`,
				mediaId: range.mediaId,
				start: range.start,
				end: range.end,
				label: range.text,
				filler: range
			}))
		);
		try {
			const scored = await scoreFillerRanges(detected, {
				signal: controller.signal,
				onProgress: (event) => (progress = event.progress)
			});
			if (controller.signal.aborted) return;
			const confidenceOrder = { high: 0, medium: 1, unknown: 2, low: 3 } as const;
			const ranges = Object.values(scored)
				.flat()
				.toSorted(
					(left, right) =>
						confidenceOrder[left.audioConfidence?.level ?? 'unknown'] -
						confidenceOrder[right.audioConfidence?.level ?? 'unknown']
				)
				.map((range) => ({
					id: `filler:${range.id}`,
					mediaId: range.mediaId,
					start: range.start,
					end: range.end,
					label: range.text,
					filler: range
				}));
			reviewRanges = ranges;
			selectedIds = new Set(
				ranges
					.filter((range) => range.filler?.audioConfidence?.level !== 'low')
					.map((range) => range.id)
			);
			reviewSignature = cleanupSettingsSignature();
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				analysisError = m.video_editor_cleanup_confidence_unavailable();
				reviewSignature = cleanupSettingsSignature();
			}
		} finally {
			if (abortController === controller) {
				abortController = null;
				analyzing = false;
			}
		}
	}

	function confidenceLabel(range: ReviewRange): string | null {
		const level = range.filler?.audioConfidence?.level;
		if (!level) return null;
		if (level === 'high') return m.video_editor_cleanup_confidence_high();
		if (level === 'medium') return m.video_editor_cleanup_confidence_medium();
		if (level === 'low') return m.video_editor_cleanup_confidence_low();
		return m.video_editor_cleanup_confidence_unknown();
	}

	async function analyzeSilence(): Promise<void> {
		analysisError = '';
		if (silenceMode === 'transcript') {
			const byMedia = detectTranscriptSilenceRanges(
				timelineStore.items,
				itemIds,
				timelineStore.fps,
				{
					minSilenceMs,
					paddingStartMs,
					paddingEndMs
				}
			);
			selectAll(
				Object.entries(byMedia).flatMap(([mediaId, ranges]) =>
					ranges.map((range, index) => ({
						id: `silence:${mediaId}:${range.start}:${range.end}:${index}`,
						mediaId,
						start: range.start,
						end: range.end,
						label: m.video_editor_cleanup_silence_range()
					}))
				)
			);
			reviewSignature = cleanupSettingsSignature();
			return;
		}

		abortController?.abort();
		const controller = new AbortController();
		abortController = controller;
		analyzing = true;
		progress = 0;
		const analysisSignature = cleanupSettingsSignature();
		try {
			const result = await analyzeSilenceSignal(itemIds, {
				signal: controller.signal,
				onProgress: (next) => (progress = next),
				autoThresholds,
				silenceThresholdDb,
				audioThresholdDb,
				minSilenceMs,
				paddingStartMs,
				paddingEndMs,
				minAudioMs: 80,
				smoothingMs: 50,
				windowMs: 20
			});
			if (controller.signal.aborted) return;
			selectAll(
				Object.entries(result.rangesByMediaId).flatMap(([mediaId, ranges]) =>
					ranges.map((range, index) => ({
						id: `silence:${mediaId}:${range.start}:${range.end}:${index}`,
						mediaId,
						start: range.start,
						end: range.end,
						label: m.video_editor_cleanup_silence_range()
					}))
				)
			);
			reviewSignature = analysisSignature;
			if (result.failedMediaIds.length > 0)
				analysisError = m.video_editor_cleanup_partial_failure({
					count: result.failedMediaIds.length
				});
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError'))
				analysisError = error instanceof Error ? error.message : String(error);
		} finally {
			if (abortController === controller) {
				abortController = null;
				analyzing = false;
			}
		}
	}

	async function analyze(): Promise<void> {
		cancelAnalysis();
		if (mode === 'fillers') await analyzeFillers();
		else await analyzeSilence();
	}

	function cancelAnalysis(): void {
		abortController?.abort();
		abortController = null;
		analyzing = false;
	}

	function switchMode(next: CleanupMode): void {
		if (mode === next) return;
		mode = next;
		void analyze();
	}

	function switchSilenceMode(next: SilenceMode): void {
		if (silenceMode === next) return;
		silenceMode = next;
		void analyzeSilence();
	}

	function toggleRange(id: string): void {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	function previewRange(range: ReviewRange): void {
		const item = itemIds
			.map((id) => timelineStore.itemById.get(id))
			.find((candidate) => candidate?.mediaId === range.mediaId);
		if (!item) return;
		const start = sourceSecondsToTimelineFrame(item, range.start, timelineStore.fps);
		const end = sourceSecondsToTimelineFrame(item, range.end, timelineStore.fps);
		const context = Math.max(1, Math.round(timelineStore.fps * 0.25));
		const playStart = Math.max(item.from, start - context);
		const playEnd = Math.min(item.from + item.durationInFrames, end + context);
		editorSession.pausePlayback();
		setCurrentFrame(playStart);
		editorSession.syncTimelineClock();
		editorSession.startPlayback({ start: playStart, end: Math.max(playStart + 1, playEnd) });
	}

	function selectedSilenceRanges() {
		const result: Record<string, SourceRange[]> = {};
		for (const range of selectedRanges) {
			(result[range.mediaId] ??= []).push({ start: range.start, end: range.end });
		}
		return result;
	}

	function applyCleanup(): void {
		if (selectedRanges.length === 0 || !reviewIsCurrent) return;
		editorSession.pausePlayback();
		const result =
			mode === 'fillers'
				? applyFillerRangeRemoval(
						itemIds,
						selectedRanges.flatMap((range) => (range.filler ? [range.filler] : []))
					)
				: applySilenceRangeRemoval(itemIds, selectedSilenceRanges());
		if (result.removedItemCount === 0) return;
		onapplied(result.removedItemCount);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme flex max-h-[min(82vh,760px)] w-[min(94vw,620px)] flex-col overflow-hidden border-[oklch(0.31_0.018_55)] bg-[oklch(0.16_0.012_50)] p-0 text-[var(--video-editor-text)] shadow-2xl"
	>
		<Dialog.Header class="border-b border-[oklch(0.27_0.014_55)] px-5 pt-5 pr-12 pb-4">
			<Dialog.Title class="flex items-center gap-2 text-base">
				<SparklesIcon class="size-4 text-[var(--video-editor-focus)]" aria-hidden="true" />
				{m.video_editor_cleanup_title()}
			</Dialog.Title>
			<Dialog.Description class="max-w-lg text-xs leading-relaxed text-[var(--video-editor-muted)]">
				{m.video_editor_cleanup_description()}
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			<div class="grid grid-cols-2 rounded-lg bg-[oklch(0.2_0.012_50)] p-1" role="tablist">
				<Button
					type="button"
					variant={mode === 'fillers' ? 'secondary' : 'ghost'}
					class="h-8 text-xs"
					role="tab"
					aria-selected={mode === 'fillers'}
					onclick={() => switchMode('fillers')}>{m.video_editor_filler_review()}</Button
				>
				<Button
					type="button"
					variant={mode === 'silence' ? 'secondary' : 'ghost'}
					class="h-8 text-xs"
					role="tab"
					aria-selected={mode === 'silence'}
					onclick={() => switchMode('silence')}>{m.video_editor_silence_review()}</Button
				>
			</div>

			{#if mode === 'fillers'}
				<section class="mt-4 space-y-4" aria-label={m.video_editor_filler_review()}>
					<p class="text-[11px] leading-4 text-[var(--video-editor-muted)]">
						{m.video_editor_cleanup_confidence_help()}
					</p>
					<div class="grid grid-cols-3 gap-1 rounded-lg border border-[oklch(0.28_0.014_55)] p-1">
						{#each FILLER_REMOVAL_PRESETS as preset (preset.id)}
							<Button
								type="button"
								variant={fillerPreset === preset.id ? 'secondary' : 'ghost'}
								class="h-8 text-xs"
								onclick={() => applyFillerPreset(preset.id)}>{fillerPresetLabel(preset.id)}</Button
							>
						{/each}
					</div>
					<details class="rounded-lg border border-[oklch(0.28_0.014_55)] p-3">
						<summary class="cursor-pointer text-xs font-medium"
							>{m.video_editor_cleanup_words()}</summary
						>
						<div class="mt-3 space-y-3">
							<label class="block text-[11px] text-[var(--video-editor-muted)]">
								{m.video_editor_cleanup_single_words()}
								<Input bind:value={fillerWordsDraft} class="mt-1 h-8 text-xs" />
							</label>
							<label class="block text-[11px] text-[var(--video-editor-muted)]">
								{m.video_editor_cleanup_phrases()}
								<Input bind:value={fillerPhrasesDraft} class="mt-1 h-8 text-xs" />
							</label>
						</div>
					</details>
				</section>
			{:else}
				<section class="mt-4 space-y-4" aria-label={m.video_editor_silence_review()}>
					<div class="grid grid-cols-2 gap-1 rounded-lg border border-[oklch(0.28_0.014_55)] p-1">
						<Button
							type="button"
							variant={silenceMode === 'signal' ? 'secondary' : 'ghost'}
							class="h-8 text-xs"
							onclick={() => switchSilenceMode('signal')}
							>{m.video_editor_cleanup_audio_signal()}</Button
						>
						<Button
							type="button"
							variant={silenceMode === 'transcript' ? 'secondary' : 'ghost'}
							class="h-8 text-xs"
							disabled={!hasTimedTranscript}
							onclick={() => switchSilenceMode('transcript')}
							>{m.video_editor_cleanup_transcript_gaps()}</Button
						>
					</div>
					<div class="grid gap-3 sm:grid-cols-3">
						<label class="text-[11px] text-[var(--video-editor-muted)]">
							{m.video_editor_cleanup_min_silence()}
							<Input
								bind:value={minSilenceMs}
								type="number"
								min="100"
								max="10000"
								step="50"
								class="mt-1 h-8 text-xs"
							/>
						</label>
						<label class="text-[11px] text-[var(--video-editor-muted)]">
							{m.video_editor_cleanup_keep_after()}
							<Input
								bind:value={paddingStartMs}
								type="number"
								min="0"
								max="2000"
								step="25"
								class="mt-1 h-8 text-xs"
							/>
						</label>
						<label class="text-[11px] text-[var(--video-editor-muted)]">
							{m.video_editor_cleanup_keep_before()}
							<Input
								bind:value={paddingEndMs}
								type="number"
								min="0"
								max="2000"
								step="25"
								class="mt-1 h-8 text-xs"
							/>
						</label>
					</div>
					{#if silenceMode === 'signal'}
						<details class="rounded-lg border border-[oklch(0.28_0.014_55)] p-3">
							<summary class="cursor-pointer text-xs font-medium"
								>{m.video_editor_cleanup_detection()}</summary
							>
							<div class="mt-3 grid gap-3 sm:grid-cols-2">
								<label class="flex items-center gap-2 text-xs">
									<Checkbox
										bind:checked={autoThresholds}
										aria-label={m.video_editor_cleanup_auto_thresholds()}
									/>
									{m.video_editor_cleanup_auto_thresholds()}
								</label>
								<div></div>
								<label class="text-[11px] text-[var(--video-editor-muted)]">
									{m.video_editor_cleanup_silence_level()}
									<Input
										bind:value={silenceThresholdDb}
										disabled={autoThresholds}
										type="number"
										min="-80"
										max="-20"
										class="mt-1 h-8 text-xs"
									/>
								</label>
								<label class="text-[11px] text-[var(--video-editor-muted)]">
									{m.video_editor_cleanup_speech_level()}
									<Input
										bind:value={audioThresholdDb}
										disabled={autoThresholds}
										type="number"
										min="-77"
										max="-6"
										class="mt-1 h-8 text-xs"
									/>
								</label>
							</div>
						</details>
					{/if}
				</section>
			{/if}

			<div class="mt-4 flex items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="text-sm font-medium">
						{selectedCountLabel(selectedRanges.length)}
					</p>
					<p class="text-[11px] text-[var(--video-editor-muted)]">
						{m.video_editor_cleanup_duration({ duration: formatDuration(selectedDuration) })}
					</p>
				</div>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={analyzing}
					onclick={() => void analyze()}
				>
					{#if analyzing}<LoaderIcon
							class="size-3.5 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>{/if}
					{m.video_editor_cleanup_update()}
				</Button>
			</div>

			{#if analyzing}
				<div class="mt-3" aria-live="polite">
					<div class="h-1.5 overflow-hidden rounded-full bg-[oklch(0.24_0.012_50)]">
						<div
							class="h-full bg-[var(--video-editor-focus)] transition-[width]"
							style:width={`${Math.round(progress * 100)}%`}
						></div>
					</div>
					<div
						class="mt-1 flex items-center justify-between text-[11px] text-[var(--video-editor-muted)]"
					>
						<span>{m.video_editor_analysis_progress({ progress: Math.round(progress * 100) })}</span
						>
						<button
							type="button"
							class="underline hover:text-[var(--video-editor-text)]"
							onclick={cancelAnalysis}>{m.video_editor_analysis_cancel()}</button
						>
					</div>
				</div>
			{/if}

			{#if analysisError}
				<p
					class="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
					role="alert"
				>
					{analysisError}
				</p>
			{/if}

			{#if !reviewIsCurrent && !analyzing}
				<p class="mt-3 text-[11px] text-amber-200" role="status">
					{m.video_editor_cleanup_settings_changed()}
				</p>
			{/if}

			{#if !analyzing && reviewRanges.length === 0}
				<div
					class="mt-3 rounded-lg border border-dashed border-[oklch(0.31_0.014_55)] px-4 py-6 text-center"
				>
					<p class="text-sm font-medium">
						{mode === 'fillers'
							? m.video_editor_cleanup_no_fillers()
							: m.video_editor_cleanup_no_silence()}
					</p>
					{#if mode === 'fillers' && !hasTimedTranscript}
						<p class="mt-1 text-xs text-[var(--video-editor-muted)]">
							{m.video_editor_cleanup_transcribe_first()}
						</p>
					{/if}
				</div>
			{:else if reviewRanges.length > 0}
				<div
					class="mt-3 max-h-64 divide-y divide-[oklch(0.26_0.012_55)] overflow-y-auto rounded-lg border border-[oklch(0.28_0.014_55)]"
				>
					{#each reviewRanges as range (range.id)}
						<div class="flex min-w-0 items-center gap-3 px-3 py-2.5 hover:bg-[oklch(0.2_0.012_50)]">
							<button
								type="button"
								class="grid size-4 shrink-0 place-items-center rounded border"
								style:background-color={selectedIds.has(range.id)
									? 'var(--video-editor-focus)'
									: 'transparent'}
								style:border-color={selectedIds.has(range.id)
									? 'var(--video-editor-focus)'
									: 'oklch(0.42 0.02 55)'}
								data-selected={selectedIds.has(range.id)}
								aria-label={m.video_editor_cleanup_include({ label: range.label })}
								aria-pressed={selectedIds.has(range.id)}
								onclick={() => toggleRange(range.id)}
							>
								{#if selectedIds.has(range.id)}<CheckIcon
										class="size-3 text-black"
										aria-hidden="true"
									/>{/if}
							</button>
							<div class="min-w-0 flex-1">
								<div class="flex min-w-0 items-center gap-2">
									<p class="truncate text-xs font-medium">{range.label}</p>
									{#if confidenceLabel(range)}
										<span
											class="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-[var(--video-editor-muted)]"
											data-confidence={range.filler?.audioConfidence?.level}
										>
											{confidenceLabel(range)}
										</span>
									{/if}
								</div>
								<p class="truncate text-[10px] text-[var(--video-editor-muted)]">
									{mediaLabel(range.mediaId)} · {formatTimestamp(range.start)} · {formatDuration(
										range.end - range.start
									)}
								</p>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								aria-label={m.video_editor_cleanup_preview({ label: range.label })}
								onclick={() => previewRange(range)}
							>
								<PlayIcon class="size-3.5" aria-hidden="true" />
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<Dialog.Footer
			class="border-t border-[oklch(0.27_0.014_55)] bg-[oklch(0.17_0.012_50)] px-5 py-3"
		>
			<Button type="button" variant="ghost" onclick={() => (open = false)}
				>{m.common_cancel()}</Button
			>
			<Button
				type="button"
				disabled={selectedRanges.length === 0 || analyzing || !reviewIsCurrent}
				onclick={applyCleanup}
			>
				{mode === 'fillers' ? m.video_editor_apply_fillers() : m.video_editor_apply_silences()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
