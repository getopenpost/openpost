<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { Slider } from '$lib/components/ui/slider';
	import { Textarea } from '$lib/components/ui/textarea';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import LocalModelCacheControl from './local-model-cache-control.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		ACE_STEP_HIGH_DOWNLOAD_BYTES,
		ACE_STEP_MAX_DURATION_SECONDS,
		ACE_STEP_MIN_DURATION_SECONDS,
		ACE_STEP_STANDARD_DOWNLOAD_BYTES,
		generateLocalMusic,
		inspectMusicGenerationStorage,
		inspectMusicGenerationSupport,
		musicGenerationTags,
		type GenerateLocalMusicOptions,
		type GeneratedMusic,
		type MusicGenerationStorageStatus,
		type MusicGenerationSupport
	} from '$lib/video-editor/local-ai/music/ace-step-service';
	import {
		commitGeneratedAudio,
		type CommitGeneratedAudioOptions
	} from '$lib/video-editor/local-ai/commit-generated-audio';
	import { mediaTaskId, mediaTasks } from '$lib/video-editor/media/media-tasks.svelte';
	import type { LocalGenerationProgress } from '$lib/video-editor/local-ai/types';
	import type { AudioQuality } from 'ai-music-js';

	type GenerateMusic = (options: GenerateLocalMusicOptions) => Promise<GeneratedMusic>;
	type CommitAudio = typeof commitGeneratedAudio;
	type InspectStorage = typeof inspectMusicGenerationStorage;

	let {
		projectId,
		oninserted,
		generateMusic = generateLocalMusic,
		commitAudio = commitGeneratedAudio,
		inspectStorage = inspectMusicGenerationStorage,
		supported
	}: {
		projectId: string;
		oninserted: (itemId: string) => void;
		generateMusic?: GenerateMusic;
		commitAudio?: CommitAudio;
		inspectStorage?: InspectStorage;
		supported?: boolean;
	} = $props();

	interface Generation {
		id: string;
		result: GeneratedMusic;
		url: string;
		mediaId?: string;
		saving: boolean;
	}

	const presets = [
		{
			label: m.video_editor_local_music_preset_cinematic(),
			prompt:
				'Cinematic electronic instrumental, rising pulse, deep drums, clear edit points, polished mix'
		},
		{
			label: m.video_editor_local_music_preset_upbeat(),
			prompt:
				'Upbeat modern pop instrumental, bright guitars and synths, crisp drums, memorable hook'
		},
		{
			label: m.video_editor_local_music_preset_ambient(),
			prompt: 'Calm ambient instrumental, warm pads, sparse piano, gentle motion, no percussion'
		},
		{
			label: m.video_editor_local_music_preset_lofi(),
			prompt: 'Relaxed lo-fi hip hop instrumental, dusty drums, warm keys, subtle vinyl texture'
		}
	];

	let prompt = $state(presets[0].prompt);
	let durationSeconds = $state(10);
	let audioQuality = $state<AudioQuality>('standard');
	let generating = $state(false);
	let progress = $state<LocalGenerationProgress | null>(null);
	let error = $state('');
	let support = $state<MusicGenerationSupport | null>(null);
	let storage = $state<MusicGenerationStorageStatus | null>(null);
	let checkingStorage = $state(false);
	let storageRevision = 0;
	let generations = $state<Generation[]>([]);
	let abortController: AbortController | null = null;
	const downloadBytes = $derived(
		audioQuality === 'high' ? ACE_STEP_HIGH_DOWNLOAD_BYTES : ACE_STEP_STANDARD_DOWNLOAD_BYTES
	);

	function formatBytes(bytes: number): string {
		if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
		return `${Math.round(bytes / 1_000_000)} MB`;
	}

	function selectPreset(value: string): void {
		const preset = presets[Number(value)];
		if (preset) prompt = preset.prompt;
	}

	function changeQuality(value: string): void {
		if (value !== 'standard' && value !== 'high') return;
		audioQuality = value;
		void refreshStorage();
	}

	async function refreshStorage(): Promise<void> {
		const revision = ++storageRevision;
		checkingStorage = true;
		try {
			const next = await inspectStorage(audioQuality);
			if (revision === storageRevision) storage = next;
		} catch {
			if (revision === storageRevision) storage = null;
		} finally {
			if (revision === storageRevision) checkingStorage = false;
		}
	}

	function supportMessage(): string {
		if (support?.reason === 'secure-context-required') {
			return m.video_editor_local_music_secure_context();
		}
		if (support?.reason === 'webgpu-unavailable') {
			return m.video_editor_local_music_webgpu_required();
		}
		return m.video_editor_local_music_desktop_required();
	}

	async function generate(): Promise<void> {
		if (
			generating ||
			!support?.supported ||
			checkingStorage ||
			storage?.sufficient === false ||
			!prompt.trim()
		)
			return;
		generating = true;
		error = '';
		progress = null;
		const abort = new AbortController();
		abortController = abort;
		const taskId = mediaTaskId('music-generation', projectId);
		const revision = mediaTasks.start({
			id: taskId,
			kind: 'music-generation',
			label: m.video_editor_local_music(),
			stage: 'preparing',
			progress: 0,
			totalBytes: downloadBytes,
			onCancel: () => abort.abort()
		});
		try {
			const result = await generateMusic({
				prompt,
				durationSeconds,
				audioQuality,
				signal: abort.signal,
				onProgress: (next) => {
					progress = next;
					mediaTasks.update(
						taskId,
						{
							stage: next.message,
							progress: next.progress,
							receivedBytes: next.receivedBytes,
							totalBytes: next.totalBytes ?? downloadBytes
						},
						revision
					);
				}
			});
			generations = [
				{
					id: crypto.randomUUID(),
					result,
					url: URL.createObjectURL(result.blob),
					saving: false
				},
				...generations
			];
		} catch (caught) {
			if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
				error = caught instanceof Error ? caught.message : String(caught);
			}
		} finally {
			mediaTasks.finish(taskId, revision);
			if (abortController === abort) abortController = null;
			generating = false;
			progress = null;
		}
	}

	async function save(generation: Generation, insert: boolean): Promise<void> {
		if (generation.saving) return;
		generation.saving = true;
		error = '';
		try {
			const options: CommitGeneratedAudioOptions = {
				projectId,
				tags: musicGenerationTags(generation.result),
				existingMediaId: generation.mediaId,
				...(insert && { insertAtFrame: timelineStore.currentFrame })
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

	onMount(() => {
		if (supported !== undefined) {
			support = { supported };
			if (supported) void refreshStorage();
			return;
		}
		void inspectMusicGenerationSupport().then((result) => {
			support = result;
			if (result.supported) void refreshStorage();
		});
	});

	onDestroy(() => {
		abortController?.abort();
		for (const generation of generations) URL.revokeObjectURL(generation.url);
	});
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="local-music-panel">
	<div class="border-b border-[oklch(0.24_0.012_55)] px-2 py-1.5">
		<h2 class="text-xs font-semibold text-white">{m.video_editor_local_music()}</h2>
		<p class="mt-0.5 text-[9px] leading-tight text-[oklch(0.58_0.012_55)]">
			{m.video_editor_local_music_description()}
		</p>
	</div>

	<div class="space-y-1.5 border-b border-[oklch(0.24_0.012_55)] p-2">
		<div>
			<label for="local-music-preset" class="block text-[10px] text-[oklch(0.66_0.015_55)]">
				{m.video_editor_local_music_starting_point()}
			</label>
			<Select.Root type="single" disabled={generating} onValueChange={selectPreset}>
				<Select.Trigger
					id="local-music-preset"
					aria-label={m.video_editor_local_music_starting_point()}
					class="mt-0.5 h-8 w-full justify-between rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-2 text-[11px] text-white shadow-none hover:translate-y-0 hover:bg-[oklch(0.21_0.01_55)] data-placeholder:text-[oklch(0.45_0.01_55)]"
				>
					<span class="truncate">{presets[0].label}</span>
				</Select.Trigger>
				<Select.Content class="video-editor-theme bg-[oklch(0.18_0.008_55)] text-white">
					{#each presets as preset, index}
						<Select.Item value={String(index)}>{preset.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div>
			<label for="local-music-prompt" class="block text-[10px] text-[oklch(0.66_0.015_55)]">
				{m.video_editor_local_music_prompt()}
			</label>
			<Textarea
				id="local-music-prompt"
				class="mt-0.5 min-h-20 resize-y rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.18_0.008_55)] px-2 py-1.5 text-[11px] leading-relaxed text-white placeholder:text-[oklch(0.45_0.01_55)] focus-visible:border-[oklch(0.66_0.14_45)]"
				bind:value={prompt}
				disabled={generating}
				maxlength={1000}
				placeholder={m.video_editor_local_music_prompt_placeholder()}
			/>
		</div>

		<div class="grid grid-cols-[1fr_7.25rem] gap-1.5">
			<div>
				<label for="local-music-duration" class="text-[10px] text-[oklch(0.66_0.015_55)]">
					{m.video_editor_local_music_duration()}
				</label>
				<Slider
					value={durationSeconds}
					min={ACE_STEP_MIN_DURATION_SECONDS}
					max={ACE_STEP_MAX_DURATION_SECONDS}
					step={1}
					disabled={generating}
					ariaLabel={m.video_editor_local_music_duration()}
					onValueChange={(v) => (durationSeconds = v)}
					class="mt-0.5"
				/>
				<span class="block text-center text-[9px] text-[oklch(0.72_0.012_55)]">
					{durationSeconds}s
				</span>
			</div>
			<div>
				<label for="local-music-quality" class="text-[10px] text-[oklch(0.66_0.015_55)]">
					{m.video_editor_local_music_quality()}
				</label>
				<Select.Root
					type="single"
					value={audioQuality}
					disabled={generating}
					onValueChange={changeQuality}
				>
					<Select.Trigger
						id="local-music-quality"
						aria-label={m.video_editor_local_music_quality()}
						class="mt-0.5 h-8 w-full justify-between rounded border border-[oklch(0.29_0.015_55)] bg-[oklch(0.21_0.01_55)] px-2 text-[11px] text-white shadow-none hover:translate-y-0 hover:bg-[oklch(0.21_0.01_55)]"
					>
						{audioQuality === 'high'
							? m.video_editor_local_music_high()
							: m.video_editor_local_music_standard()}
					</Select.Trigger>
					<Select.Content class="video-editor-theme bg-[oklch(0.18_0.008_55)] text-white">
						<Select.Item value="standard">{m.video_editor_local_music_standard()}</Select.Item>
						<Select.Item value="high">{m.video_editor_local_music_high()}</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<div
			class="rounded border border-[oklch(0.31_0.04_55)] bg-[oklch(0.21_0.025_55)] px-1.5 py-1 text-[9px] leading-snug text-[oklch(0.73_0.035_70)]"
		>
			{m.video_editor_local_music_download_notice({ size: formatBytes(downloadBytes) })}
		</div>
		{#if checkingStorage}
			<p class="text-[9px] text-[oklch(0.58_0.012_55)]" role="status">
				{m.video_editor_local_music_storage_checking()}
			</p>
		{:else if storage && !storage.sufficient}
			<p
				class="rounded bg-[oklch(0.25_0.06_25)] px-1.5 py-1 text-[10px] text-[oklch(0.82_0.1_25)]"
				role="alert"
			>
				{m.video_editor_local_music_storage_shortfall({
					available: formatBytes(storage.effectiveAvailableBytes ?? 0),
					required: formatBytes(storage.missingBytes + storage.headroomBytes)
				})}
			</p>
		{:else if storage && storage.readyBytes > 0}
			<p class="text-[9px] text-[oklch(0.62_0.04_145)]" role="status">
				{m.video_editor_local_music_storage_ready({
					ready: formatBytes(storage.readyBytes),
					total: formatBytes(storage.expectedBytes)
				})}
			</p>
		{/if}

		{#if support === null}
			<p class="text-[10px] text-[oklch(0.58_0.012_55)]" role="status">
				{m.video_editor_local_music_checking()}
			</p>
		{:else if !support.supported}
			<p
				class="rounded bg-[oklch(0.24_0.045_65)] px-1.5 py-1 text-[10px] text-[oklch(0.84_0.08_70)]"
				role="status"
			>
				{supportMessage()}
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
					class="mb-0.5 flex items-center justify-between gap-2 text-[9px] text-[oklch(0.66_0.015_55)]"
				>
					<span class="min-w-0 truncate">{progress.message}</span>
					{#if progress.progress !== null}<span>{Math.round(progress.progress * 100)}%</span>{/if}
				</div>
				<div
					class="h-1 overflow-hidden rounded-full bg-[oklch(0.27_0.012_55)]"
					role="progressbar"
					aria-label={progress.message}
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
				{#if progress.receivedBytes && progress.totalBytes}
					<p class="mt-0.5 text-right text-[9px] text-[oklch(0.5_0.01_55)]">
						{formatBytes(progress.receivedBytes)} / {formatBytes(progress.totalBytes)}
					</p>
				{/if}
			</div>
		{/if}

		<Button
			size="sm"
			class="w-full"
			variant={generating ? 'outline' : 'secondary'}
			disabled={!generating &&
				(!support?.supported || checkingStorage || storage?.sufficient === false || !prompt.trim())}
			onclick={generating ? () => abortController?.abort() : () => void generate()}
		>
			{#if generating}<LoaderIcon
					class="size-3 animate-spin motion-reduce:animate-none"
					aria-hidden="true"
				/>{/if}
			{generating ? m.video_editor_local_music_cancel() : m.video_editor_local_music_generate()}
		</Button>
		<LocalModelCacheControl disabled={generating} />
	</div>

	<div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
		{#if generations.length === 0}
			<p class="py-6 text-center text-[10px] text-[oklch(0.5_0.01_55)]">
				{m.video_editor_local_music_empty()}
			</p>
		{/if}
		{#each generations as generation (generation.id)}
			<article class="rounded border border-[oklch(0.26_0.012_55)] bg-[oklch(0.18_0.008_55)] p-1.5">
				<div class="mb-1 flex items-start justify-between gap-1">
					<div class="min-w-0">
						<p class="line-clamp-2 text-[10px] leading-tight text-[oklch(0.76_0.012_55)]">
							{generation.result.prompt}
						</p>
						<p class="mt-0.5 text-[9px] text-[oklch(0.5_0.01_55)]">
							{generation.result.duration.toFixed(0)}s · {generation.result.audioQuality} · {m.video_editor_local_music_seed(
								{ seed: generation.result.seed }
							)}
						</p>
					</div>
					<button
						type="button"
						class="shrink-0 rounded p-1 text-[oklch(0.55_0.01_55)] hover:bg-[oklch(0.25_0.012_55)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
						onclick={() => remove(generation)}
						aria-label={m.video_editor_local_music_remove_preview()}
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
							: m.video_editor_local_music_save()}
					</Button>
					<Button
						size="xs"
						variant="secondary"
						disabled={generation.saving}
						onclick={() => void save(generation, true)}
					>
						<PlusIcon class="size-3" aria-hidden="true" />
						{m.video_editor_local_music_save_insert()}
					</Button>
				</div>
			</article>
		{/each}
	</div>
</div>
