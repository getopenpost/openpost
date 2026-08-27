<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { Slider } from '$lib/components/ui/slider';
	import { Textarea } from '$lib/components/ui/textarea';
	import LocalModelCacheControl from '$lib/video-editor/components/local-model-cache-control.svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		LOCAL_TTS_ENGINE_OPTIONS,
		LOCAL_TTS_EXPRESSIVE_TAG_OPTIONS,
		LOCAL_TTS_LANGUAGE_OPTIONS,
		defaultLocalTtsVoice,
		generateLocalSpeech,
		isLocalTtsSupported,
		localTtsSpeedRange,
		localTtsTags,
		localTtsVoiceOptions,
		type LocalTtsEngine,
		type LocalTtsGenerateOptions
	} from '$lib/video-editor/local-ai/tts/registry';
	import {
		getStoredLocalTtsEngine,
		setStoredLocalTtsEngine
	} from '$lib/video-editor/local-ai/tts/preferences';
	import {
		commitGeneratedAudio,
		type CommitGeneratedAudioOptions
	} from '$lib/video-editor/local-ai/commit-generated-audio';
	import type {
		GeneratedAudio,
		LocalGenerationProgress,
		TextVoiceRequest
	} from '$lib/video-editor/local-ai/types';
	import { mediaTaskId, mediaTasks } from '$lib/video-editor/media/media-tasks.svelte';
	import LocalMusicPanel from './local-music-panel.svelte';
	import { transcriptionLanguageUiLabel } from '$lib/video-editor/transcript/engine/model-i18n';

	type GenerateSpeech = (options: LocalTtsGenerateOptions) => Promise<GeneratedAudio>;
	type CommitAudio = typeof commitGeneratedAudio;

	let {
		projectId,
		oninserted,
		generateSpeech = generateLocalSpeech,
		commitAudio = commitGeneratedAudio,
		supported,
		textVoiceRequest = null
	}: {
		projectId: string;
		oninserted: (itemId: string) => void;
		generateSpeech?: GenerateSpeech;
		commitAudio?: CommitAudio;
		supported?: boolean;
		textVoiceRequest?: TextVoiceRequest | null;
	} = $props();

	interface Generation {
		id: string;
		result: GeneratedAudio;
		url: string;
		engine: LocalTtsEngine;
		voice: string;
		sourceTextItemId?: string;
		mediaId?: string;
		saving: boolean;
	}

	const initialEngine = getStoredLocalTtsEngine();
	let text = $state('');
	let engine = $state<LocalTtsEngine>(initialEngine);
	let voice = $state(defaultLocalTtsVoice(initialEngine));
	let language = $state('auto');
	let speed = $state(1);
	let generating = $state(false);
	let progress = $state<LocalGenerationProgress | null>(null);
	let error = $state('');
	let generations = $state<Generation[]>([]);
	let activeTab = $state<'voice' | 'music'>('voice');
	let voiceTab: HTMLButtonElement;
	let musicTab: HTMLButtonElement;
	let scriptTextarea = $state<HTMLTextAreaElement | null>(null);
	let abortController: AbortController | null = null;
	let sourceTextItemId = $state<string | null>(null);
	let handledTextVoiceRequestId = $state<string | null>(null);
	const voiceOptions = $derived(localTtsVoiceOptions(engine));
	const speedRange = $derived(localTtsSpeedRange(engine));
	const engineSupported = $derived(supported ?? isLocalTtsSupported(engine));
	const engineDescription = $derived(
		engine === 'kokoro'
			? m.video_editor_local_ai_kokoro_description()
			: engine === 'moss'
				? m.video_editor_local_ai_moss_description()
				: m.video_editor_local_ai_supertonic_description()
	);

	$effect(() => {
		if (!textVoiceRequest || textVoiceRequest.id === handledTextVoiceRequestId) return;
		handledTextVoiceRequestId = textVoiceRequest.id;
		sourceTextItemId = textVoiceRequest.sourceTextItemId;
		text = textVoiceRequest.text;
		activeTab = 'voice';
	});

	function changeEngine(value: string): void {
		const nextEngine = LOCAL_TTS_ENGINE_OPTIONS.find((option) => option.value === value)?.value;
		if (!nextEngine) return;
		engine = nextEngine;
		setStoredLocalTtsEngine(engine);
		voice = defaultLocalTtsVoice(engine);
		const range = localTtsSpeedRange(engine);
		speed = Math.min(range.max, Math.max(range.min, speed));
	}

	function stageLabel(stage: LocalGenerationProgress['stage']): string {
		if (stage === 'downloading') return m.video_editor_local_ai_downloading();
		if (stage === 'preparing') return m.video_editor_local_ai_preparing();
		if (stage === 'finalizing') return m.video_editor_local_ai_finalizing();
		return m.video_editor_local_ai_generating();
	}

	function expressiveTagLabel(tag: string): string {
		if (tag === '<laugh>') return m.video_editor_local_ai_expressive_laugh();
		if (tag === '<breath>') return m.video_editor_local_ai_expressive_breath();
		return m.video_editor_local_ai_expressive_sigh();
	}

	function insertExpressiveTag(tag: string): void {
		if (!scriptTextarea) return;
		const start = scriptTextarea.selectionStart ?? text.length;
		const end = scriptTextarea.selectionEnd ?? start;
		text = `${text.slice(0, start)}${tag}${text.slice(end)}`;
		queueMicrotask(() => {
			const nextPosition = start + tag.length;
			scriptTextarea.focus();
			scriptTextarea.setSelectionRange(nextPosition, nextPosition);
		});
	}

	function handleTabKeydown(event: KeyboardEvent): void {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'voice' : 'music';
		activeTab = next;
		queueMicrotask(() => (next === 'voice' ? voiceTab : musicTab).focus());
	}

	async function generate(): Promise<void> {
		if (generating || !engineSupported || !text.trim()) return;
		generating = true;
		error = '';
		progress = null;
		const abort = new AbortController();
		abortController = abort;
		const taskId = mediaTaskId('voice-generation', projectId);
		const taskRevision = mediaTasks.start({
			id: taskId,
			kind: 'voice-generation',
			label: m.video_editor_local_ai_voice(),
			stage: 'preparing',
			progress: null,
			onCancel: () => abort.abort()
		});
		try {
			const requestedEngine = engine;
			const requestedVoice = voice;
			const requestedSourceTextItemId = sourceTextItemId ?? undefined;
			const result = await generateSpeech({
				engine: requestedEngine,
				text,
				voice: requestedVoice,
				language,
				speed,
				signal: abort.signal,
				onProgress: (next) => {
					progress = next;
					mediaTasks.update(
						taskId,
						{
							stage: next.stage,
							progress: next.progress,
							receivedBytes: next.receivedBytes,
							totalBytes: next.totalBytes
						},
						taskRevision
					);
				}
			});
			generations = [
				{
					id: crypto.randomUUID(),
					result,
					url: URL.createObjectURL(result.blob),
					engine: requestedEngine,
					voice: requestedVoice,
					sourceTextItemId: requestedSourceTextItemId,
					saving: false
				},
				...generations
			];
		} catch (caught) {
			if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
				error = caught instanceof Error ? caught.message : String(caught);
			}
		} finally {
			mediaTasks.finish(taskId, taskRevision);
			if (abortController === abort) abortController = null;
			generating = false;
			progress = null;
		}
	}

	function cancel(): void {
		abortController?.abort();
	}

	async function save(generation: Generation, insert: boolean): Promise<void> {
		if (generation.saving) return;
		generation.saving = true;
		error = '';
		try {
			const options: CommitGeneratedAudioOptions = {
				projectId,
				tags: localTtsTags(generation.engine, generation.voice),
				existingMediaId: generation.mediaId,
				...(insert &&
					(generation.sourceTextItemId
						? { sourceTextItemId: generation.sourceTextItemId }
						: { insertAtFrame: timelineStore.currentFrame }))
			};
			const committed = await commitAudio(generation.result, options);
			generation.mediaId = committed.media.id;
			if (committed.itemId) oninserted(committed.itemId);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			generation.saving = false;
		}
	}

	function remove(generation: Generation): void {
		URL.revokeObjectURL(generation.url);
		generations = generations.filter((candidate) => candidate.id !== generation.id);
	}

	onDestroy(() => {
		abortController?.abort();
		for (const generation of generations) URL.revokeObjectURL(generation.url);
	});
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="local-ai-panel">
	<div
		class="grid grid-cols-2 gap-1 border-b border-[oklch(0.24_0.012_55)] p-1"
		role="tablist"
		aria-label={m.video_editor_local_ai_mode()}
	>
		<button
			bind:this={voiceTab}
			id="local-ai-voice-tab"
			type="button"
			role="tab"
			aria-selected={activeTab === 'voice'}
			aria-controls="local-ai-voice-panel"
			class="rounded px-2 py-1 text-[10px] font-medium focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] {activeTab ===
			'voice'
				? 'bg-[oklch(0.29_0.035_48)] text-white'
				: 'text-[oklch(0.62_0.012_55)] hover:bg-[oklch(0.22_0.012_55)]'}"
			onclick={() => (activeTab = 'voice')}
			onkeydown={handleTabKeydown}
		>
			{m.video_editor_local_ai_voice()}
		</button>
		<button
			bind:this={musicTab}
			id="local-ai-music-tab"
			type="button"
			role="tab"
			aria-selected={activeTab === 'music'}
			aria-controls="local-ai-music-panel"
			class="rounded px-2 py-1 text-[10px] font-medium focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] {activeTab ===
			'music'
				? 'bg-[oklch(0.29_0.035_48)] text-white'
				: 'text-[oklch(0.62_0.012_55)] hover:bg-[oklch(0.22_0.012_55)]'}"
			onclick={() => (activeTab = 'music')}
			onkeydown={handleTabKeydown}
		>
			{m.video_editor_local_music()}
		</button>
	</div>
	{#if activeTab === 'voice'}
		<div
			id="local-ai-voice-panel"
			class="flex min-h-0 flex-1 flex-col"
			role="tabpanel"
			aria-labelledby="local-ai-voice-tab"
		>
			<div class="border-b border-[oklch(0.24_0.012_55)] px-2 py-1.5">
				<h2 class="text-xs font-semibold text-white">{m.video_editor_local_ai_voice()}</h2>
				<p class="mt-0.5 text-[9px] leading-tight text-[oklch(0.58_0.012_55)]">
					{m.video_editor_local_ai_voice_description()}
				</p>
			</div>

			<div class="space-y-1.5 border-b border-[oklch(0.24_0.012_55)] p-2">
				{#if sourceTextItemId}
					<div
						class="flex items-center justify-between gap-2 rounded border border-[oklch(0.38_0.07_45)] bg-[oklch(0.22_0.025_45)] px-2 py-1 text-[10px] text-[oklch(0.82_0.04_65)]"
						role="status"
					>
						<span>{m.video_editor_local_ai_linked_text_hint()}</span>
						<button
							type="button"
							class="shrink-0 rounded px-1 py-0.5 text-[9px] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							onclick={() => (sourceTextItemId = null)}
						>
							{m.video_editor_local_ai_unlink_text()}
						</button>
					</div>
				{/if}
				<label for="local-ai-script" class="block text-[10px] text-[oklch(0.66_0.015_55)]">
					{m.video_editor_local_ai_script()}
				</label>
				<Textarea
					bind:ref={scriptTextarea}
					id="local-ai-script"
					class="mt-0.5 min-h-24 resize-y rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.18_0.008_55)] px-2 py-1.5 text-[11px] leading-relaxed text-white placeholder:text-[oklch(0.45_0.01_55)] focus-visible:border-[oklch(0.66_0.14_45)]"
					bind:value={text}
					disabled={generating}
					placeholder={m.video_editor_local_ai_script_placeholder()}
					maxlength={5000}
				/>
				{#if engine === 'supertonic'}
					<div
						role="group"
						class="flex flex-wrap items-center gap-1"
						aria-label={m.video_editor_local_ai_expressive_tags()}
					>
						<span class="text-[9px] text-[oklch(0.58_0.012_55)]">
							{m.video_editor_local_ai_expressive_tags()}
						</span>
						{#each LOCAL_TTS_EXPRESSIVE_TAG_OPTIONS as tag}
							<Button
								type="button"
								size="xs"
								variant="outline"
								class="min-h-6 px-2 text-[9px] [@media(pointer:coarse)]:min-h-11"
								disabled={generating}
								onclick={() => insertExpressiveTag(tag.value)}
							>
								{expressiveTagLabel(tag.value)}
							</Button>
						{/each}
					</div>
				{/if}

				<div>
					<label for="local-ai-engine" class="block text-[10px] text-[oklch(0.66_0.015_55)]">
						{m.video_editor_local_ai_engine()}
					</label>
					<Select.Root
						type="single"
						value={engine}
						disabled={generating}
						onValueChange={changeEngine}
					>
						<Select.Trigger
							id="local-ai-engine"
							aria-label={m.video_editor_local_ai_engine()}
							aria-describedby="local-ai-engine-description"
							class="mt-0.5 h-8 w-full justify-between rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-2 text-[11px] text-white shadow-none"
						>
							<span class="truncate"
								>{LOCAL_TTS_ENGINE_OPTIONS.find((o) => o.value === engine)?.label ?? engine}</span
							>
						</Select.Trigger>
						<Select.Content class="video-editor-theme bg-[oklch(0.18_0.008_55)] text-white">
							{#each LOCAL_TTS_ENGINE_OPTIONS as option}
								<Select.Item value={option.value}>{option.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<span
						id="local-ai-engine-description"
						class="mt-0.5 block text-[9px] leading-tight text-[oklch(0.52_0.01_55)]"
						>{engineDescription}</span
					>
				</div>

				<div class="grid grid-cols-[1fr_5rem] gap-1">
					<div>
						<label for="local-ai-voice" class="text-[10px] text-[oklch(0.66_0.015_55)]">
							{m.video_editor_local_ai_voice_label()}
						</label>
						<Select.Root type="single" bind:value={voice} disabled={generating}>
							<Select.Trigger
								id="local-ai-voice"
								aria-label={m.video_editor_local_ai_voice_label()}
								class="mt-0.5 h-8 w-full justify-between rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-2 text-[11px] text-white shadow-none"
							>
								<span class="truncate"
									>{voiceOptions.find((o) => o.value === voice)?.label ?? voice}</span
								>
							</Select.Trigger>
							<Select.Content class="video-editor-theme bg-[oklch(0.18_0.008_55)] text-white">
								{#each voiceOptions as option}
									<option value={option.value}>{option.label}</option>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div>
						<label for="local-ai-speed" class="text-[10px] text-[oklch(0.66_0.015_55)]">
							{m.video_editor_local_ai_speed()}
						</label>
						<Slider
							value={speed}
							min={speedRange.min}
							max={speedRange.max}
							step={0.05}
							disabled={generating}
							ariaLabel={m.video_editor_local_ai_speed()}
							onValueChange={(v) => (speed = v)}
							class="mt-0.5"
						/>
						<span class="block text-center text-[9px] text-[oklch(0.72_0.012_55)]"
							>{speed.toFixed(2)}×</span
						>
					</div>
				</div>
				{#if engine === 'supertonic'}
					<div>
						<label for="local-ai-language" class="block text-[10px] text-[oklch(0.66_0.015_55)]">
							{m.video_editor_local_ai_language()}
						</label>
						<Select.Root type="single" bind:value={language} disabled={generating}>
							<Select.Trigger
								id="local-ai-language"
								aria-label={m.video_editor_local_ai_language()}
								class="mt-0.5 h-8 w-full justify-between rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-2 text-[11px] text-white shadow-none"
							>
								<span class="truncate"
									>{transcriptionLanguageUiLabel(language === 'auto' ? '' : language)}</span
								>
							</Select.Trigger>
							<Select.Content class="video-editor-theme bg-[oklch(0.18_0.008_55)] text-white">
								{#each LOCAL_TTS_LANGUAGE_OPTIONS as option}
									<Select.Item value={option.value}
										>{transcriptionLanguageUiLabel(
											option.value === 'auto' ? '' : option.value
										)}</Select.Item
									>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				{/if}

				{#if !engineSupported}
					<p
						class="rounded bg-[oklch(0.24_0.045_65)] px-1.5 py-1 text-[10px] text-[oklch(0.84_0.08_70)]"
						role="status"
					>
						{m.video_editor_local_ai_webgpu_required()}
					</p>
				{/if}
				{#if error}
					<p
						class="rounded bg-[oklch(0.25_0.06_25)] px-1.5 py-1 text-[10px] text-[oklch(0.82_0.1_25)]"
						role="alert"
					>
						{error}
					</p>
				{/if}
				{#if generating && progress}
					<div aria-live="polite">
						<div
							class="mb-0.5 flex items-center justify-between text-[9px] text-[oklch(0.66_0.015_55)]"
						>
							<span
								>{stageLabel(progress.stage)}{progress.backend
									? ` · ${progress.backend.toUpperCase()}`
									: ''}</span
							>
							{#if progress.progress !== null}<span>{Math.round(progress.progress * 100)}%</span
								>{/if}
						</div>
						<div
							class="h-1 overflow-hidden rounded-full bg-[oklch(0.27_0.012_55)]"
							role="progressbar"
							aria-label={stageLabel(progress.stage)}
							aria-valuemin="0"
							aria-valuemax="100"
							aria-valuenow={progress.progress === null
								? undefined
								: Math.round(progress.progress * 100)}
						>
							<div
								class="h-full rounded-full bg-[oklch(0.66_0.14_45)] {progress.progress === null
									? 'w-1/3 animate-pulse motion-reduce:animate-none'
									: ''}"
								style:width={progress.progress === null
									? undefined
									: `${Math.max(2, progress.progress * 100)}%`}
							></div>
						</div>
					</div>
				{/if}
				<Button
					size="sm"
					class="w-full"
					variant={generating ? 'outline' : 'secondary'}
					disabled={!generating && (!engineSupported || !text.trim())}
					onclick={generating ? cancel : () => void generate()}
				>
					{#if generating}<LoaderIcon
							class="size-3 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>{/if}
					{generating ? m.video_editor_local_ai_cancel() : m.video_editor_local_ai_generate()}
				</Button>
				<LocalModelCacheControl disabled={generating} />
			</div>

			<div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
				{#if generations.length === 0}
					<p class="py-6 text-center text-[10px] text-[oklch(0.5_0.01_55)]">
						{m.video_editor_local_ai_empty()}
					</p>
				{/if}
				{#each generations as generation (generation.id)}
					<article
						class="rounded border border-[oklch(0.26_0.012_55)] bg-[oklch(0.18_0.008_55)] p-1.5"
					>
						<div class="mb-1 flex items-center justify-between gap-1">
							<span class="text-[10px] text-[oklch(0.76_0.012_55)]">
								{m.video_editor_local_ai_duration({
									seconds: generation.result.duration.toFixed(1)
								})}
							</span>
							<button
								type="button"
								class="rounded p-1 text-[oklch(0.55_0.01_55)] hover:bg-[oklch(0.25_0.012_55)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
								onclick={() => remove(generation)}
								aria-label={m.video_editor_local_ai_remove_preview()}
							>
								<TrashIcon class="size-3" aria-hidden="true" />
							</button>
						</div>
						<audio class="h-7 w-full" controls preload="metadata" src={generation.url}></audio>
						<div class="mt-1 grid grid-cols-2 gap-1">
							<Button
								size="xs"
								variant="outline"
								disabled={generation.saving || generation.mediaId !== undefined}
								onclick={() => void save(generation, false)}
							>
								{generation.mediaId
									? m.video_editor_local_ai_saved()
									: m.video_editor_local_ai_save()}
							</Button>
							<Button
								size="xs"
								variant="secondary"
								disabled={generation.saving}
								onclick={() => void save(generation, true)}
							>
								<PlusIcon class="size-3" aria-hidden="true" />
								{generation.sourceTextItemId
									? m.video_editor_local_ai_add_and_link()
									: m.video_editor_local_ai_add_timeline()}
							</Button>
						</div>
					</article>
				{/each}
			</div>
		</div>
	{:else}
		<div
			id="local-ai-music-panel"
			class="min-h-0 flex-1"
			role="tabpanel"
			aria-labelledby="local-ai-music-tab"
		>
			<LocalMusicPanel {projectId} {oninserted} />
		</div>
	{/if}
</div>
