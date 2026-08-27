<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import LocalModelCacheControl from './local-model-cache-control.svelte';
	import {
		TRANSCRIPTION_LANGUAGE_OPTIONS,
		TRANSCRIPTION_MODEL_OPTIONS,
		TRANSCRIPTION_QUANTIZATION_OPTIONS
	} from '$lib/video-editor/transcript/engine/models';
	import {
		transcriptionLanguageUiLabel,
		transcriptionModelUiDescription,
		transcriptionModelUiLabel,
		transcriptionQuantizationUiLabel
	} from '$lib/video-editor/transcript/engine/model-i18n';
	import type {
		ResolvedTranscriptionEngine,
		TranscribeProgress,
		TranscriptionModel,
		TranscriptionQuantization,
		TranscriptionSelection
	} from '$lib/video-editor/transcript/engine/types';
	import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
	import type { TranscriptionJobStatus } from '$lib/video-editor/transcript/transcription-service.svelte';

	let {
		canTranscribe,
		busy,
		status,
		queuePosition,
		queueTotal,
		progress,
		backend,
		fallback,
		onstart,
		oncancel
	}: {
		canTranscribe: boolean;
		busy: boolean;
		status?: TranscriptionJobStatus;
		queuePosition?: number | null;
		queueTotal?: number;
		progress: TranscribeProgress | null;
		backend: 'webgpu' | 'wasm' | null;
		fallback: ResolvedTranscriptionEngine | null;
		onstart: (selection: TranscriptionSelection) => void;
		oncancel: () => void;
	} = $props();

	let model = $state<TranscriptionModel>(editorSettings.defaultTranscriptionModel);
	let language = $state(editorSettings.defaultTranscriptionLanguage);
	let quantization = $state<TranscriptionQuantization>(
		editorSettings.defaultTranscriptionQuantization
	);

	function formatBytes(bytes: number): string {
		if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
	}

	function stageLabel(value: TranscribeProgress): string {
		if (value.stage === 'downloading') return m.video_editor_transcribe_downloading();
		if (value.stage === 'preparing') return m.video_editor_transcribe_preparing();
		if (value.stage === 'decoding') return m.video_editor_transcribe_decoding();
		return m.video_editor_transcribing();
	}

	function start(): void {
		editorSettings.set('defaultTranscriptionModel', model);
		editorSettings.set('defaultTranscriptionLanguage', language);
		editorSettings.set('defaultTranscriptionQuantization', quantization);
		onstart({ model, language: language || undefined, quantization });
	}
</script>

<div
	class="grid grid-cols-2 gap-1 rounded-md border border-[oklch(0.25_0.015_55)] bg-[oklch(0.17_0.008_55)] p-1.5"
>
	<label class="col-span-2 text-[10px] text-[oklch(0.66_0.015_55)]">
		{m.video_editor_transcribe_model()}
		<Select.Root type="single" bind:value={model} disabled={busy}>
			<Select.Trigger
				class="mt-0.5 h-8 w-full justify-between rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-2 text-[11px] text-white shadow-none"
			>
				<span class="truncate">{transcriptionModelUiLabel(model)}</span>
			</Select.Trigger>
			<Select.Content class="video-editor-theme bg-[oklch(0.18_0.008_55)] text-white">
				{#each TRANSCRIPTION_MODEL_OPTIONS as option}
					<Select.Item value={option.value}>{transcriptionModelUiLabel(option.value)}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</label>
	<label class="text-[10px] text-[oklch(0.66_0.015_55)]">
		{m.video_editor_transcribe_language()}
		<Select.Root type="single" bind:value={language} disabled={busy}>
			<Select.Trigger
				class="mt-0.5 h-8 w-full justify-between rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-2 text-[11px] text-white shadow-none"
			>
				<span class="truncate">{transcriptionLanguageUiLabel(language)}</span>
			</Select.Trigger>
			<Select.Content class="video-editor-theme bg-[oklch(0.18_0.008_55)] text-white">
				{#each TRANSCRIPTION_LANGUAGE_OPTIONS as option}
					<Select.Item value={option.value}
						>{transcriptionLanguageUiLabel(option.value)}</Select.Item
					>
				{/each}
			</Select.Content>
		</Select.Root>
	</label>
	<label class="text-[10px] text-[oklch(0.66_0.015_55)]">
		{m.video_editor_transcribe_quality()}
		<Select.Root
			type="single"
			bind:value={quantization}
			disabled={busy || model === 'parakeet-tdt-v3'}
		>
			<Select.Trigger
				class="mt-0.5 h-8 w-full justify-between rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-2 text-[11px] text-white shadow-none"
			>
				<span class="truncate">{transcriptionQuantizationUiLabel(quantization)}</span>
			</Select.Trigger>
			<Select.Content class="video-editor-theme bg-[oklch(0.18_0.008_55)] text-white">
				{#each TRANSCRIPTION_QUANTIZATION_OPTIONS as option}
					<Select.Item value={option.value}
						>{transcriptionQuantizationUiLabel(option.value)}</Select.Item
					>
				{/each}
			</Select.Content>
		</Select.Root>
	</label>
	<p class="col-span-2 text-[9px] leading-tight text-[oklch(0.58_0.012_55)]">
		{transcriptionModelUiDescription(model)}
	</p>
	{#if fallback}
		<p
			class="col-span-2 rounded bg-[oklch(0.24_0.045_65)] px-1.5 py-1 text-[10px] text-[oklch(0.84_0.08_70)]"
			role="status"
		>
			{fallback.fallbackReason === 'out-of-memory'
				? m.video_editor_transcribe_memory_fallback({
						model: transcriptionModelUiLabel(fallback.model)
					})
				: m.video_editor_transcribe_fallback({
						model: transcriptionModelUiLabel(fallback.model)
					})}
		</p>
	{/if}
	{#if busy && status === 'queued'}
		<p
			class="col-span-2 rounded bg-[oklch(0.22_0.015_55)] px-1.5 py-1 text-[10px] text-[oklch(0.76_0.02_55)]"
			role="status"
		>
			{m.video_editor_transcribe_queued({
				position: queuePosition ?? 1,
				total: Math.max(queueTotal ?? 1, queuePosition ?? 1)
			})}
		</p>
	{/if}
	{#if busy && progress}
		<div class="col-span-2" aria-live="polite">
			<div class="mb-0.5 flex items-center justify-between text-[9px] text-[oklch(0.66_0.015_55)]">
				<span>{stageLabel(progress)}{backend ? ` · ${backend.toUpperCase()}` : ''}</span>
				<span>
					{Math.round(progress.progress * 100)}%
					{#if progress.receivedBytes != null && progress.totalBytes}
						· {formatBytes(progress.receivedBytes)} / {formatBytes(progress.totalBytes)}
					{/if}
				</span>
			</div>
			<div
				class="h-1 overflow-hidden rounded-full bg-[oklch(0.27_0.012_55)]"
				role="progressbar"
				aria-label={stageLabel(progress)}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(progress.progress * 100)}
			>
				<div
					class="h-full rounded-full bg-[oklch(0.66_0.14_45)] transition-[width]"
					style:width={`${Math.max(2, progress.progress * 100)}%`}
				></div>
			</div>
		</div>
	{/if}
	<Button
		size="sm"
		class="col-span-2 w-full"
		variant={busy ? 'outline' : 'secondary'}
		disabled={!canTranscribe}
		onclick={busy ? oncancel : start}
	>
		{busy ? m.video_editor_transcribe_cancel() : m.video_editor_transcribe()}
	</Button>
	<LocalModelCacheControl />
</div>
