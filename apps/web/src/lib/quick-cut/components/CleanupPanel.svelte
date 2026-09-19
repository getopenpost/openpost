<script lang="ts">
	import ProgressMeter from '$lib/components/progress-meter.svelte';
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { m } from '$lib/paraglide/messages';
	import { analyzeAudioBlob } from '$lib/video-editor/audio/analysis-client';
	import { loadSpeechCleanupSettings } from '$lib/video-editor/transcript/speech-cleanup-settings';
	import type { AudioSilenceRange } from '$lib/video-editor/audio/audio-silence';
	import type { QuickCutSource } from '../types';
	import { formatTimecode } from '../model';
	let {
		source,
		disabled = false,
		onapply,
		onpreview,
		onreview
	}: {
		source: QuickCutSource;
		disabled?: boolean;
		onapply: (sourceId: string, ranges: AudioSilenceRange[]) => void;
		onpreview: (range: AudioSilenceRange) => void;
		onreview: (ranges: AudioSilenceRange[]) => void;
	} = $props();
	const defaults = loadSpeechCleanupSettings();
	let mode = $state<'signal' | 'speech'>('signal');
	let minSilenceMs = $state(defaults.minSilenceMs);
	let paddingMs = $state(defaults.paddingStartMs);
	let threshold = $state(defaults.silenceThresholdDb);
	let autoThresholds = $state(defaults.autoThresholds);
	let ranges = $state<AudioSilenceRange[]>([]);
	let selected = $state<Set<number>>(new Set());
	let busy = $state(false);
	let analyzed = $state(false);
	let progress = $state(0);
	let error = $state('');
	let analyzedSignature = $state('');
	let controller: AbortController | null = null;
	const signature = $derived(
		JSON.stringify([
			mode,
			minSilenceMs,
			paddingMs,
			threshold,
			autoThresholds,
			source.selectedAudioTrackIndices
		])
	);
	const chosen = $derived(ranges.filter((_, index) => selected.has(index)));
	const current = $derived(analyzedSignature === signature);
	const hasAudio = $derived(
		source.audioStreams.length > 0 && source.selectedAudioTrackIndices?.length !== 0
	);
	$effect(() => onreview(current ? chosen : []));
	function cancel(): void {
		controller?.abort();
		controller = null;
		busy = false;
	}
	onDestroy(() => {
		cancel();
		onreview([]);
	});
	async function analyze(): Promise<void> {
		cancel();
		const request = new AbortController();
		controller = request;
		busy = true;
		error = '';
		analyzed = false;
		ranges = [];
		const settingsSignature = signature;
		try {
			const file = source.file ?? (await source.handle?.getFile());
			if (!file) throw new Error(m.quick_cut_reconnect_source());
			const result = await analyzeAudioBlob(file, {
				mode,
				signal: request.signal,
				audioTrackIndices:
					source.selectedAudioTrackIndices ?? source.audioStreams.map((track) => track.index),
				minSilenceMs,
				paddingStartMs: paddingMs,
				paddingEndMs: paddingMs,
				autoThresholds,
				silenceThresholdDb: threshold,
				audioThresholdDb: threshold + 10,
				onProgress: (value) => (progress = value)
			});
			request.signal.throwIfAborted();
			ranges = result;
			selected = new Set(result.map((_, index) => index));
			analyzedSignature = settingsSignature;
			analyzed = true;
		} catch (cause) {
			if (!request.signal.aborted) error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (controller === request) {
				controller = null;
				busy = false;
			}
		}
	}
</script>

<div class="flex h-full min-h-0 flex-col gap-3">
	<div class="grid grid-cols-2 gap-1" role="group" aria-label={m.quick_cut_cleanup()}>
		<Button
			size="sm"
			variant={mode === 'signal' ? 'secondary' : 'ghost'}
			aria-pressed={mode === 'signal'}
			disabled={busy}
			onclick={() => (mode = 'signal')}>{m.video_editor_remove_silence()}</Button
		>
		<Button
			size="sm"
			variant={mode === 'speech' ? 'secondary' : 'ghost'}
			aria-pressed={mode === 'speech'}
			disabled={busy}
			onclick={() => (mode = 'speech')}>{m.editor_cleanup_speech()}</Button
		>
	</div>
	<p class="text-xs text-muted-foreground">
		{mode === 'speech' ? m.editor_cleanup_speech_hint() : m.editor_cleanup_signal_hint()}
	</p>
	<div class="grid grid-cols-2 gap-2">
		<label class="text-xs"
			>{m.video_editor_cleanup_min_silence()}<Input
				type="number"
				min="100"
				max="10000"
				step="50"
				bind:value={minSilenceMs}
				disabled={busy}
			/></label
		>
		<label class="text-xs"
			>{m.quick_cut_breathing_room()}<Input
				type="number"
				min="0"
				max="2000"
				step="25"
				bind:value={paddingMs}
				disabled={busy}
			/></label
		>
	</div>
	{#if mode === 'signal'}
		<label class="flex items-center gap-2 text-xs"
			><Checkbox
				bind:checked={autoThresholds}
				disabled={busy}
			/>{m.video_editor_cleanup_auto_thresholds()}</label
		>
		{#if !autoThresholds}<label class="text-xs"
				>{m.video_editor_cleanup_silence_threshold()}<Input
					type="number"
					min="-80"
					max="-20"
					bind:value={threshold}
					disabled={busy}
				/></label
			>{/if}
	{/if}
	{#if busy}
		<ProgressMeter fraction={progress} label={m.video_editor_cleanup_analyzing()} />
		<Button size="sm" variant="outline" onclick={cancel}>{m.common_cancel()}</Button>
	{:else}
		<Button
			size="sm"
			variant="outline"
			disabled={!hasAudio ||
				disabled ||
				!Number.isFinite(minSilenceMs) ||
				minSilenceMs < 100 ||
				minSilenceMs > 10000 ||
				!Number.isFinite(paddingMs) ||
				paddingMs < 0 ||
				paddingMs > 2000 ||
				(!autoThresholds && (!Number.isFinite(threshold) || threshold < -80 || threshold > -20))}
			onclick={analyze}>{m.quick_cut_find_cuts()}</Button
		>
	{/if}
	{#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
	{#if analyzed && current}
		<p class="text-xs text-muted-foreground" role="status">
			{m.quick_cut_cut_review({
				count: chosen.length,
				duration: chosen.reduce((sum, r) => sum + r.end - r.start, 0).toFixed(1)
			})}
		</p>
		<div class="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
			{#each ranges as range, index (index)}
				<div class="flex items-center gap-2 py-1">
					<Checkbox
						checked={selected.has(index)}
						aria-label={m.quick_cut_select_cut({ index: index + 1 })}
						onCheckedChange={(checked) => {
							const next = new Set(selected);
							if (checked) next.add(index);
							else next.delete(index);
							selected = next;
						}}
					/>
					<Button
						size="sm"
						variant="ghost"
						class="flex-1 justify-start font-mono text-xs"
						onclick={() => onpreview(range)}
						>{formatTimecode(range.start)} – {formatTimecode(range.end)}</Button
					>
				</div>
			{/each}
		</div>
		<Button
			size="sm"
			disabled={chosen.length === 0 || disabled}
			onclick={() => {
				onapply(source.id, chosen);
				ranges = [];
				analyzed = false;
			}}>{m.quick_cut_apply_cuts()}</Button
		>
	{/if}
</div>
