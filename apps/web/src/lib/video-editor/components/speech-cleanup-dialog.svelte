<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { applyRecordingCleanup } from '../transcript/recording-cleanup';
	import type { RetakeSuggestion } from '../transcript/retake-suggestions';
	import { analyzeRecordingCleanup } from '../transcript/analyze-recording';
	import {
		recordingAnalysisItemIds,
		recordingReviewFingerprint,
		selectedRecordingDuration
	} from '../transcript/recording-review';
	import CleanupTranscription from './cleanup-transcription.svelte';
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { analyzeSilenceSignal } from '$lib/video-editor/media/silence';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
	import type { SourceRange } from '$lib/video-editor/timeline/actions/range-removal';
	import { sourceSecondsToTimelineFrame } from '$lib/video-editor/timeline/utils/media-item-frames';
	import {
		collectTranscriptSourceWords,
		detectFillerRanges,
		detectTranscriptSilenceRanges,
		FILLER_REMOVAL_PRESETS,
		type FillerRange,
		type FillerRemovalPresetId,
		type FillerRemovalSettings
	} from '$lib/video-editor/transcript/speech-cleanup';
	import {
		loadSpeechCleanupSettings,
		saveSpeechCleanupSettings
	} from '$lib/video-editor/transcript/speech-cleanup-settings';
	import {
		applyFillerRangeRemoval,
		applySilenceRangeRemoval
	} from '$lib/video-editor/transcript/speech-cleanup-actions';
	import {
		scoreFillerRangesWithAudioConfidence,
		type FillerAudioConfidenceOptions
	} from '$lib/video-editor/transcript/filler-audio-confidence';

	type CleanupMode = 'recording' | 'fillers' | 'silence';
	type SilenceMode = 'signal' | 'speech' | 'transcript';
	type ReviewRange = {
		id: string;
		mediaId: string;
		start: number;
		end: number;
		label: string;
		filler?: FillerRange;
		sourceItemId?: string;
		retake?: RetakeSuggestion;
	};

	let {
		open = $bindable(false),
		itemIds,
		initialMode = 'recording',
		onapplied,
		scoreFillerRanges = scoreFillerRangesWithAudioConfidence
	}: {
		open?: boolean;
		itemIds: string[];
		initialMode?: CleanupMode;
		onapplied: (removedCount: number, appliedMode?: CleanupMode) => void;
		scoreFillerRanges?: (
			ranges: ReturnType<typeof detectFillerRanges>,
			options?: FillerAudioConfidenceOptions
		) => ReturnType<typeof scoreFillerRangesWithAudioConfidence>;
	} = $props();

	const storedCleanupSettings = loadSpeechCleanupSettings();

	let mode = $state<CleanupMode>('recording');
	let cleanVoice = $state(false);
	let reviewedFingerprint = $state('');
	let stopPreview: (() => void) | null = null;
	let silenceMode = $state<SilenceMode>(storedCleanupSettings.silenceMode);
	let fillerPreset = $state<FillerRemovalPresetId>(storedCleanupSettings.fillerPreset);
	let fillerSettings = $state<FillerRemovalSettings>({
		...storedCleanupSettings.fillerSettings,
		fillerWords: [...storedCleanupSettings.fillerSettings.fillerWords],
		fillerPhrases: [...storedCleanupSettings.fillerSettings.fillerPhrases]
	});
	let fillerWordsDraft = $state(storedCleanupSettings.fillerSettings.fillerWords.join(', '));
	let fillerPhrasesDraft = $state(storedCleanupSettings.fillerSettings.fillerPhrases.join(', '));
	let minSilenceMs = $state(storedCleanupSettings.minSilenceMs);
	let paddingStartMs = $state(storedCleanupSettings.paddingStartMs);
	let paddingEndMs = $state(storedCleanupSettings.paddingEndMs);
	let autoThresholds = $state(storedCleanupSettings.autoThresholds);
	let silenceThresholdDb = $state(storedCleanupSettings.silenceThresholdDb);
	let audioThresholdDb = $state(storedCleanupSettings.audioThresholdDb);
	let reviewRanges = $state<ReviewRange[]>([]);
	let selectedIds = $state<Set<string>>(new Set());
	let analyzing = $state(false);
	let progress = $state(0);
	let analysisError = $state('');
	let analyzedCount = $state(0);
	let failedCount = $state(0);
	let reviewSignature = $state('');
	let opened = false;
	let abortController: AbortController | null = null;

	const selectedRanges = $derived(reviewRanges.filter((range) => selectedIds.has(range.id)));
	const selectedDuration = $derived(
		mode === 'recording'
			? selectedRecordingDuration(
					timelineStore.items,
					recordingAnalysisItemIds(timelineStore.items, itemIds),
					timelineStore.fps,
					selectedRanges.flatMap((range) =>
						range.sourceItemId
							? [
									{
										...range,
										sourceItemId: range.sourceItemId,
										kind: range.retake
											? ('retake' as const)
											: range.filler
												? ('filler' as const)
												: ('pause' as const)
									}
								]
							: []
					)
				)
			: selectedRanges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0)
	);
	const hasTimedTranscript = $derived(
		collectTranscriptSourceWords(timelineStore.items, itemIds, timelineStore.fps).length > 0
	);
	const reviewIsCurrent = $derived(
		reviewSignature === cleanupSettingsSignature() &&
			(mode !== 'recording' ||
				reviewedFingerprint ===
					recordingReviewFingerprint(
						timelineStore.items,
						timelineStore.tracks,
						itemIds,
						timelineStore.fps
					))
	);

	$effect(() => {
		if (open && !opened) {
			opened = true;
			mode = initialMode;
			void analyze();
		} else if (!open && opened) {
			opened = false;
			cancelAnalysis();
			stopPreview?.();
			editorSession.pausePlayback();
		}
	});

	onDestroy(() => {
		cancelAnalysis();
		stopPreview?.();
		editorSession.pausePlayback();
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
		persistCleanupSettings();
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

	function persistCleanupSettings(): void {
		saveSpeechCleanupSettings({
			fillerPreset,
			fillerSettings: currentFillerSettings(),
			silenceMode,
			minSilenceMs,
			paddingStartMs,
			paddingEndMs,
			autoThresholds,
			silenceThresholdDb,
			audioThresholdDb
		});
	}

	async function analyzeFillers(): Promise<void> {
		abortController?.abort();
		const controller = new AbortController();
		abortController = controller;
		analyzing = true;
		progress = 0;
		analysisError = '';
		const words = collectTranscriptSourceWords(timelineStore.items, itemIds, timelineStore.fps);
		analyzedCount = itemIds.length;
		failedCount = 0;
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
			const confidenceOrder = {
				high: 0,
				medium: 1,
				unknown: 2,
				low: 3
			} as const;
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
		cancelAnalysis();
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
			analyzedCount = itemIds.length;
			failedCount = 0;
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
				mode: silenceMode === 'speech' ? 'speech' : 'signal',
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
			analyzedCount = result.analyzedMediaIds.length;
			failedCount = result.failedMediaIds.length;
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

	async function analyzeRecording(): Promise<void> {
		const controller = new AbortController();
		abortController = controller;
		analyzing = true;
		analysisError = '';
		progress = 0;
		const signature = cleanupSettingsSignature();
		try {
			const result = await analyzeRecordingCleanup(itemIds, {
				signal: controller.signal,
				onProgress: (value) => (progress = value)
			});
			if (controller.signal.aborted) return;
			reviewRanges = result.ranges
				.map((range) => ({
					...range,
					id: `${range.sourceItemId}:${range.kind}:${range.start}:${range.end}`,
					label:
						range.retake?.repeatedText ??
						range.filler?.text ??
						m.video_editor_cleanup_silence_range()
				}))
				.toSorted((a, b) => a.sourceItemId.localeCompare(b.sourceItemId) || a.start - b.start);
			selectedIds = new Set(reviewRanges.filter((range) => !range.retake).map((range) => range.id));
			reviewSignature = signature;
			reviewedFingerprint = result.fingerprint;
			analyzedCount = result.analyzedCount;
			failedCount = result.failedCount;
			if (failedCount)
				analysisError = m.video_editor_cleanup_partial_failure({
					count: failedCount
				});
		} catch (error) {
			if (!controller.signal.aborted)
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
		stopPreview?.();
		editorSession.pausePlayback();
		reviewSignature = '';
		reviewedFingerprint = '';
		reviewRanges = [];
		selectedIds = new Set();
		analyzedCount = 0;
		failedCount = 0;
		persistCleanupSettings();
		if (mode === 'recording') await analyzeRecording();
		else if (mode === 'fillers') await analyzeFillers();
		else await analyzeSilence();
	}

	function cancelAnalysis(): void {
		abortController?.abort();
		abortController = null;
		analyzing = false;
	}

	function switchMode(next: string): void {
		if (next !== 'recording' && next !== 'fillers' && next !== 'silence') return;
		if (mode === next) return;
		mode = next;
		void analyze();
	}

	function switchSilenceMode(next: SilenceMode): void {
		if (silenceMode === next) return;
		silenceMode = next;
		persistCleanupSettings();
		void analyzeSilence();
	}

	function toggleRange(id: string): void {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	function canPreviewCut(range: ReviewRange): boolean {
		const item = timelineStore.items.find((candidate) => candidate.id === range.sourceItemId);
		if (!item) return false;
		const first = sourceSecondsToTimelineFrame(item, range.start, timelineStore.fps);
		const last = sourceSecondsToTimelineFrame(item, range.end, timelineStore.fps);
		const context = timelineStore.fps * 1.5;
		const start = Math.max(item.from, Math.min(first, last) - context);
		const end = Math.min(item.from + item.durationInFrames, Math.max(first, last) + context);
		const linkedIds = new Set(
			timelineStore.items
				.filter(
					(candidate) =>
						candidate.id === item.id ||
						(item.linkedGroupId && candidate.linkedGroupId === item.linkedGroupId)
				)
				.map((candidate) => candidate.id)
		);
		// A clock jump auditions a whole scene. Only offer it when that scene is the edited source.
		return timelineStore.items.every(
			(candidate) =>
				candidate.from >= end ||
				candidate.from + candidate.durationInFrames <= start ||
				linkedIds.has(candidate.id) ||
				(candidate.captionSource?.clipId && linkedIds.has(candidate.captionSource.clipId))
		);
	}

	function previewRange(range: ReviewRange, treatment: 'original' | 'cut' = 'original'): void {
		if (!reviewIsCurrent || (treatment === 'cut' && !canPreviewCut(range))) return;
		stopPreview?.();
		const item = (
			mode === 'recording' ? recordingAnalysisItemIds(timelineStore.items, itemIds) : itemIds
		)
			.map((id) => timelineStore.itemById.get(id))
			.find((candidate) =>
				range.sourceItemId
					? candidate?.id === range.sourceItemId
					: candidate?.mediaId === range.mediaId
			);
		if (!item) return;
		const boundaryA = sourceSecondsToTimelineFrame(item, range.start, timelineStore.fps);
		const boundaryB = sourceSecondsToTimelineFrame(item, range.end, timelineStore.fps);
		const start = Math.min(boundaryA, boundaryB);
		const end = Math.max(boundaryA, boundaryB);
		const context = Math.max(1, Math.round(timelineStore.fps * 1.5));
		const playStart = Math.max(item.from, start - context);
		const playEnd = Math.min(item.from + item.durationInFrames, end + context);
		editorSession.pausePlayback();
		setCurrentFrame(playStart);
		editorSession.syncTimelineClock();
		if (treatment === 'cut') {
			let skipped = false;
			let active = true;
			const unsubscribe = editorSession.clock.on('framechange', (frame) => {
				if (skipped || frame < start) return;
				skipped = true;
				queueMicrotask(() => {
					if (!active) return;
					if (end >= playEnd) editorSession.pausePlayback();
					else editorSession.clock.seek(end);
				});
			});
			const ended = editorSession.clock.on('ended', () => stopPreview?.());
			const paused = editorSession.clock.on('pause', () => stopPreview?.());
			stopPreview = () => {
				active = false;
				unsubscribe();
				ended();
				paused();
				stopPreview = null;
			};
		}
		editorSession.startPlayback({
			start: playStart,
			end: Math.max(playStart + 1, playEnd)
		});
	}

	function selectedSilenceRanges() {
		const result: Record<string, SourceRange[]> = {};
		for (const range of selectedRanges) {
			(result[range.mediaId] ??= []).push({
				start: range.start,
				end: range.end
			});
		}
		return result;
	}

	function applyCleanup(): void {
		if (
			analyzing ||
			(!selectedRanges.length && !(mode === 'recording' && cleanVoice)) ||
			!reviewIsCurrent
		)
			return;
		editorSession.pausePlayback();
		stopPreview?.();
		if (mode === 'recording') {
			const result = applyRecordingCleanup({
				itemIds,
				cleanVoice,
				ranges: selectedRanges.flatMap((range) =>
					range.sourceItemId
						? [
								{
									sourceItemId: range.sourceItemId,
									start: range.start,
									end: range.end
								}
							]
						: []
				)
			});
			if (!result.removedCount && !result.voiceCount) return;
			onapplied(result.removedCount, mode);
			open = false;
			return;
		}
		const result =
			mode === 'fillers'
				? applyFillerRangeRemoval(
						itemIds,
						selectedRanges.flatMap((range) => (range.filler ? [range.filler] : []))
					)
				: applySilenceRangeRemoval(itemIds, selectedSilenceRanges());
		if (result.removedItemCount === 0) return;
		onapplied(result.removedRangeCount);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme flex max-h-[min(82vh,760px)] w-[min(94vw,620px)] max-w-[min(94vw,620px)] flex-col gap-0 overflow-hidden border-border bg-popover p-0 text-popover-foreground shadow-2xl sm:max-w-[620px]"
	>
		<Dialog.Header class="border-b border-border px-5 pt-5 pr-12 pb-4">
			<Dialog.Title class="flex items-center gap-2 text-base">
				<ThemeIcon role="sparkles" class="size-4 text-[var(--video-editor-focus)]" />
				{mode === 'recording' ? m.recording_cleanup_action() : m.video_editor_cleanup_title()}
			</Dialog.Title>
			<Dialog.Description class="max-w-lg text-xs leading-relaxed text-[var(--video-editor-muted)]">
				{mode === 'recording' ? m.recording_cleanup_hint() : m.video_editor_cleanup_description()}
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			<Tabs.Root value={mode} onValueChange={switchMode}>
				<Tabs.List class="grid w-full grid-cols-3" aria-label={m.video_editor_cleanup_title()}>
					<Tabs.Trigger value="recording">{m.recording_cleanup_tab()}</Tabs.Trigger>
					<Tabs.Trigger value="fillers" aria-label={m.video_editor_filler_review()}
						>{m.video_editor_cleanup_fillers_short()}</Tabs.Trigger
					>
					<Tabs.Trigger value="silence" aria-label={m.video_editor_silence_review()}
						>{m.video_editor_cleanup_silence_short()}</Tabs.Trigger
					>
				</Tabs.List>
				<Tabs.Content value={mode}>
					{#if mode === 'recording'}
						<section class="mt-4 space-y-3" aria-label={m.recording_cleanup_tab()}>
							<label class="flex items-start gap-3 py-2">
								<Checkbox bind:checked={cleanVoice} aria-label={m.recording_cleanup_voice()} />
								<span class="min-w-0 text-sm"
									>{m.recording_cleanup_voice()}
									<span class="mt-1 block text-xs text-muted-foreground"
										>{m.recording_cleanup_voice_hint()}</span
									>
								</span>
							</label>
							<CleanupTranscription
								{itemIds}
								onready={() => {
									if (open) void analyze();
								}}
							/>
						</section>
					{:else if mode === 'fillers'}
						<section class="mt-4 space-y-4" aria-label={m.video_editor_filler_review()}>
							<p class="text-[11px] leading-4 text-[var(--video-editor-muted)]">
								{m.video_editor_cleanup_confidence_help()}
							</p>
							<div class="grid grid-cols-3 gap-1 rounded-lg border border-border p-1">
								{#each FILLER_REMOVAL_PRESETS as preset (preset.id)}
									<Button
										type="button"
										variant={fillerPreset === preset.id ? 'secondary' : 'ghost'}
										class="h-8 text-xs"
										onclick={() => applyFillerPreset(preset.id)}
										>{fillerPresetLabel(preset.id)}</Button
									>
								{/each}
							</div>
							<details class="rounded-lg border border-border p-3">
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
							<div class="flex flex-wrap gap-1 rounded-lg border border-border p-1">
								<Button
									type="button"
									variant={silenceMode === 'signal' ? 'secondary' : 'ghost'}
									class="h-8 text-xs"
									onclick={() => switchSilenceMode('signal')}
									>{m.video_editor_cleanup_audio_signal()}</Button
								>
								<Button
									variant={silenceMode === 'speech' ? 'secondary' : 'ghost'}
									size="sm"
									onclick={() => switchSilenceMode('speech')}
								>
									{m.editor_cleanup_speech()}
								</Button>
								<Button
									type="button"
									variant={silenceMode === 'transcript' ? 'secondary' : 'ghost'}
									class="h-8 text-xs"
									disabled={!hasTimedTranscript}
									onclick={() => switchSilenceMode('transcript')}
									>{m.video_editor_cleanup_transcript_gaps()}</Button
								>
							</div>
							{#if silenceMode !== 'transcript'}<p class="text-xs text-muted-foreground">
									{silenceMode === 'speech'
										? m.editor_cleanup_speech_hint()
										: m.editor_cleanup_signal_hint()}
								</p>{/if}
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
								<details class="rounded-lg border border-border p-3">
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
											<span class="flex items-center justify-between">
												{m.video_editor_cleanup_silence_level()}
												<output>{silenceThresholdDb} dB</output>
											</span>
											<Slider
												bind:value={silenceThresholdDb}
												disabled={autoThresholds}
												min={-80}
												max={-20}
												step={1}
												ariaLabel={m.video_editor_cleanup_silence_level()}
												onValueCommit={() => persistCleanupSettings()}
												class="mt-2"
											/>
										</label>
										<label class="text-[11px] text-[var(--video-editor-muted)]">
											<span class="flex items-center justify-between">
												{m.video_editor_cleanup_speech_level()}
												<output>{audioThresholdDb} dB</output>
											</span>
											<Slider
												bind:value={audioThresholdDb}
												disabled={autoThresholds}
												min={-77}
												max={-6}
												step={1}
												ariaLabel={m.video_editor_cleanup_speech_level()}
												onValueCommit={() => persistCleanupSettings()}
												class="mt-2"
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
								{m.video_editor_cleanup_duration({
									duration: formatDuration(selectedDuration)
								})}
							</p>
						</div>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={analyzing}
							onclick={() => void analyze()}
						>
							{#if analyzing}<ProtectedIcon
									icon="loading"
									class="size-3.5 animate-spin motion-reduce:animate-none"
								/>{/if}
							{m.video_editor_cleanup_update()}
						</Button>
					</div>

					{#if analyzing}
						<div class="mt-3" aria-live="polite">
							<div class="h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full bg-[var(--video-editor-focus)] transition-[width] motion-reduce:transition-none"
									style:width={`${Math.round(progress * 100)}%`}
								></div>
							</div>
							<div
								class="mt-1 flex items-center justify-between text-[11px] text-[var(--video-editor-muted)]"
							>
								<span
									>{m.video_editor_analysis_progress({
										progress: Math.round(progress * 100)
									})}</span
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
							class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
							role="alert"
						>
							{analysisError}
						</p>
					{/if}

					{#if !analyzing && (analyzedCount > 0 || failedCount > 0)}
						<p class="mt-3 text-[11px] text-[var(--video-editor-muted)]" role="status">
							{m.video_editor_cleanup_media_status({
								analyzed: analyzedCount,
								failed: failedCount
							})}
						</p>
					{/if}

					{#if !reviewIsCurrent && !analyzing && (mode !== 'recording' || reviewSignature)}
						<p class="mt-3 text-[11px] text-warning-foreground" role="status">
							{mode === 'recording'
								? m.recording_cleanup_changed()
								: m.video_editor_cleanup_settings_changed()}
						</p>
					{/if}

					{#if !analyzing && reviewRanges.length === 0 && (mode !== 'recording' || (reviewIsCurrent && !analysisError))}
						<div class="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center">
							<p class="text-sm font-medium">
								{mode === 'recording'
									? m.recording_cleanup_no_changes()
									: mode === 'fillers'
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
						<div class="mt-3 divide-y divide-border rounded-lg border border-border">
							{#each reviewRanges as range (range.id)}
								<div
									class="grid min-w-0 grid-cols-[auto_1fr_auto] items-start gap-2 px-3 py-2.5 hover:bg-accent"
								>
									<Checkbox
										checked={selectedIds.has(range.id)}
										class="size-6 [@media(pointer:coarse)]:size-11"
										aria-label={m.video_editor_cleanup_include({
											label: range.label
										})}
										onCheckedChange={() => toggleRange(range.id)}
									/>
									<div class="min-w-0 flex-1">
										<div class="flex min-w-0 items-center gap-2">
											<p class="text-xs font-medium break-words">
												{range.label}
											</p>
											{#if confidenceLabel(range)}
												<span
													class="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground"
													data-confidence={range.filler?.audioConfidence?.level}
												>
													{confidenceLabel(range)}
												</span>
											{/if}
										</div>
										{#if range.retake}
											<p class="mt-1 text-xs text-muted-foreground">
												{m.recording_cleanup_possible_restart()}
											</p>
											<p class="mt-1 text-xs leading-relaxed">
												{range.retake.beforeText}
											</p>
											<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
												{m.recording_cleanup_restart_context({
													text: range.retake.afterText
												})}
											</p>
										{/if}
										<p class="truncate text-[10px] text-[var(--video-editor-muted)]">
											{mediaLabel(range.mediaId)} · {formatTimestamp(range.start)} · {formatDuration(
												range.end - range.start
											)}
										</p>
									</div>
									<div class="col-start-2 col-end-4 flex justify-end gap-1">
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											class="[@media(pointer:coarse)]:size-11"
											disabled={!reviewIsCurrent || analyzing}
											aria-label={m.video_editor_cleanup_preview({
												label: range.label
											})}
											onclick={() => previewRange(range)}
										>
											<ProtectedIcon icon="play" class="size-3.5" />
										</Button>
										{#if mode === 'recording' && canPreviewCut(range)}
											<Button
												variant="ghost"
												size="sm"
												class="[@media(pointer:coarse)]:min-h-11"
												disabled={!reviewIsCurrent || analyzing}
												aria-label={m.recording_cleanup_preview_cut({
													label: range.label
												})}
												onclick={() => previewRange(range, 'cut')}
												>{m.recording_cleanup_after()}</Button
											>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		</div>

		<Dialog.Footer class="border-t border-border bg-card px-5 py-3">
			<Button type="button" variant="ghost" onclick={() => (open = false)}
				>{m.common_cancel()}</Button
			>
			<Button
				type="button"
				disabled={(!selectedRanges.length && !(mode === 'recording' && cleanVoice)) ||
					analyzing ||
					!reviewIsCurrent}
				onclick={applyCleanup}
			>
				{mode === 'recording'
					? m.recording_cleanup_apply()
					: mode === 'fillers'
						? m.video_editor_apply_fillers()
						: m.video_editor_apply_silences()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
