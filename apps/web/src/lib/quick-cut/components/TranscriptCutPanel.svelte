<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import TranscriptionControls from '$lib/video-editor/components/transcription-controls.svelte';
	import { BrowserTranscriber } from '$lib/video-editor/transcript/engine/transcriber';
	import type {
		EngineTranscriptWord,
		TranscriptionSelection,
		TranscribeProgress,
		ResolvedTranscriptionEngine
	} from '$lib/video-editor/transcript/engine/types';
	import type { QuickCutSource, QuickCutSegment } from '../types';
	let {
		source,
		segments,
		currentTime,
		disabled = false,
		onsave,
		onremove,
		onseek
	}: {
		source: QuickCutSource;
		segments: QuickCutSegment[];
		currentTime: number;
		disabled?: boolean;
		onsave: (sourceId: string, transcript: NonNullable<QuickCutSource['transcript']>) => void;
		onremove: (sourceId: string, ranges: Array<{ start: number; end: number }>) => void;
		onseek: (time: number) => void;
	} = $props();
	const audioTrackIndex = $derived(
		source.selectedAudioTrackIndices?.[0] ?? source.audioStreams[0]?.index
	);
	const words = $derived(
		source.transcript?.audioTrackIndex === audioTrackIndex ? source.transcript.words : []
	);
	let selected = $state<Set<number>>(new Set());
	let anchor = $state<number | null>(null);
	let busy = $state(false);
	let error = $state('');
	let progress = $state<TranscribeProgress | null>(null);
	let backend = $state<'webgpu' | 'wasm' | null>(null);
	let fallback = $state<ResolvedTranscriptionEngine | null>(null);
	let controller: AbortController | null = null;
	const canTranscribe = $derived(
		Boolean(
			(source.file || source.handle) &&
			audioTrackIndex !== undefined &&
			source.selectedAudioTrackIndices?.length !== 0
		)
	);
	function isKept(word: EngineTranscriptWord): boolean {
		return segments.some(
			(segment) =>
				segment.sourceId === source.id &&
				segment.enabled !== false &&
				segment.start < word.end &&
				segment.end > word.start
		);
	}
	function cancel(): void {
		controller?.abort();
		controller = null;
		busy = false;
	}
	onDestroy(cancel);
	async function transcribe(selection: TranscriptionSelection): Promise<void> {
		cancel();
		const request = new AbortController();
		controller = request;
		busy = true;
		error = '';
		selected = new Set();
		try {
			const file = source.file ?? (await source.handle?.getFile());
			if (!file || audioTrackIndex === undefined) return;
			const sourceId = source.id;
			const trackIndex = audioTrackIndex;
			progress = { stage: 'decoding', progress: 0 };
			const job = new BrowserTranscriber().transcribe(file, {
				...selection,
				audioTrackIndex: trackIndex,
				signal: request.signal,
				onProgress: (event) => (progress = event),
				onRuntimeInfo: (info) => (backend = info.backend ?? null),
				onFallback: (value) => (fallback = value)
			});
			const transcript = await job.collect();
			request.signal.throwIfAborted();
			onsave(sourceId, {
				audioTrackIndex: trackIndex,
				words: transcript
					.flatMap((segment) =>
						segment.words?.length
							? segment.words
							: [{ text: segment.text, start: segment.start, end: segment.end }]
					)
					.filter(
						(word) =>
							Number.isFinite(word.start) &&
							Number.isFinite(word.end) &&
							word.end > word.start &&
							word.start >= 0 &&
							word.start < source.duration
					)
					.map((word) => ({ ...word, end: Math.min(source.duration, word.end) }))
			});
		} catch (cause) {
			if (!request.signal.aborted) error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			if (controller === request) {
				controller = null;
				busy = false;
			}
		}
	}
	function select(index: number, extend: boolean): void {
		const next = new Set(selected);
		if (extend && anchor !== null) {
			for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++)
				if (words[i] && isKept(words[i]!)) next.add(i);
		} else {
			if (next.has(index)) next.delete(index);
			else next.add(index);
			anchor = index;
		}
		selected = next;
		onseek(words[index]!.start);
	}
	function remove(): void {
		onremove(
			source.id,
			words.filter((word, index) => selected.has(index) && isKept(word))
		);
		selected = new Set();
	}
</script>

<div class="flex h-full min-h-0 flex-col gap-3">
	<p class="text-xs text-muted-foreground">{m.quick_cut_transcript_hint()}</p>
	<details open={words.length === 0}>
		<summary class="cursor-pointer py-1 text-xs font-medium">{m.quick_cut_transcribe()}</summary>
		<TranscriptionControls
			startLabel={m.quick_cut_transcribe()}
			{canTranscribe}
			busy={busy || disabled}
			{progress}
			{backend}
			{fallback}
			onstart={transcribe}
			oncancel={cancel}
		/>
	</details>
	{#if error}<p role="alert" class="text-xs text-destructive">{error}</p>{/if}
	{#if words.length > 0}
		<div class="flex items-center gap-2">
			<Button size="sm" disabled={selected.size === 0 || disabled} onclick={remove}
				>{m.quick_cut_remove_words({ count: selected.size })}</Button
			>
			<Button
				size="sm"
				variant="ghost"
				disabled={selected.size === 0}
				onclick={() => (selected = new Set())}>{m.common_clear()}</Button
			>
		</div>
		<div
			class="min-h-0 flex-1 overflow-y-auto leading-loose"
			role="group"
			aria-label={m.video_editor_transcript()}
		>
			{#each words as word, index (index)}
				<button
					type="button"
					class="transcript-word rounded px-1 py-1 text-sm focus-visible:outline-2 focus-visible:outline-primary"
					class:removed={!isKept(word)}
					class:selected={selected.has(index)}
					class:current={currentTime >= word.start && currentTime < word.end}
					aria-pressed={selected.has(index)}
					disabled={!isKept(word) || disabled}
					onclick={(event) => select(index, event.shiftKey)}>{word.text.trim()}</button
				>
			{/each}
		</div>
	{/if}
</div>

<style>
	.transcript-word:hover {
		background: var(--accent);
	}
	.transcript-word.current {
		box-shadow: inset 0 -2px var(--primary);
	}
	.transcript-word.selected {
		background: var(--primary);
		color: var(--primary-foreground);
	}
	.transcript-word.removed {
		text-decoration: line-through;
		color: var(--muted-foreground);
		opacity: 0.55;
	}
	@media (pointer: coarse) {
		.transcript-word {
			min-height: 44px;
		}
	}
</style>
