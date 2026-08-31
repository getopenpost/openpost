<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import {
		clearLocalModelCache,
		inspectAllLocalModelCaches,
		type LocalModelCacheSummary
	} from '$lib/video-editor/local-ai/model-cache';
	import {
		inspectLocalAiRuntimes,
		unloadAllLocalAiRuntimes
	} from '$lib/video-editor/local-ai/runtime-registry';

	let { disabled = false }: { disabled?: boolean } = $props();

	let open = $state(false);
	let loading = $state(false);
	let summaries = $state<LocalModelCacheSummary[]>([]);
	let clearingId = $state<string | null>(null);
	let loadedRuntimeCount = $state(0);
	let unloadingRuntimes = $state(false);
	let runtimeMessage = $state('');
	let cacheMessage = $state('');

	function modelLabel(summary: LocalModelCacheSummary): string {
		switch (summary.id) {
			case 'whisper':
				return 'Whisper';
			case 'parakeet':
				return 'Parakeet';
			case 'rife-interpolation':
				return m.video_editor_local_model_frame_interpolation();
			case 'scene-captions':
				return m.video_editor_local_model_scene_captions();
			case 'semantic-search':
				return m.video_editor_local_model_semantic_search();
			case 'visual-search':
				return m.video_editor_local_model_visual_search();
			case 'kokoro-tts':
				return m.video_editor_local_model_kokoro_voices();
			case 'supertonic-tts':
				return m.video_editor_local_model_supertonic_voices();
			case 'moss-tts':
				return m.video_editor_local_model_moss_voices();
			case 'ace-step-music':
				return m.video_editor_local_model_ace_step_music();
			default:
				return summary.label;
		}
	}

	function refreshRuntimeCount(): void {
		loadedRuntimeCount = inspectLocalAiRuntimes().filter((runtime) => runtime.loaded).length;
	}

	function formatBytes(bytes: number): string {
		if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
		if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
	}

	async function refresh(): Promise<void> {
		loading = true;
		try {
			summaries = await inspectAllLocalModelCaches();
			refreshRuntimeCount();
		} finally {
			loading = false;
		}
	}

	function toggle(): void {
		open = !open;
		if (open && summaries.length === 0) void refresh();
		else if (open) refreshRuntimeCount();
	}

	async function unloadRuntimes(): Promise<void> {
		if (unloadingRuntimes || loadedRuntimeCount === 0) return;
		unloadingRuntimes = true;
		runtimeMessage = '';
		try {
			const result = await unloadAllLocalAiRuntimes();
			runtimeMessage =
				result.failures.length > 0
					? m.video_editor_local_models_unload_failed()
					: m.video_editor_local_models_unloaded({ count: result.unloadedIds.length });
		} finally {
			unloadingRuntimes = false;
			refreshRuntimeCount();
		}
	}

	async function remove(summary: LocalModelCacheSummary): Promise<void> {
		if (clearingId) return;
		clearingId = summary.id;
		cacheMessage = '';
		try {
			await clearLocalModelCache(summary);
			await refresh();
		} catch {
			cacheMessage = m.video_editor_models_remove_failed();
		} finally {
			clearingId = null;
		}
	}
</script>

<div class="col-span-2 border-t border-[oklch(0.27_0.012_55)] pt-1">
	<button
		type="button"
		class="flex w-full items-center justify-between rounded px-1 py-0.5 text-[10px] text-[oklch(0.66_0.015_55)] hover:bg-[oklch(0.23_0.012_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		aria-expanded={open}
		{disabled}
		onclick={toggle}
	>
		<span>{m.video_editor_models_manage()}</span>
		<span aria-hidden="true">{open ? '−' : '+'}</span>
	</button>
	{#if open}
		<div class="mt-1 space-y-1" aria-live="polite">
			<div class="flex items-center gap-1 rounded bg-[oklch(0.2_0.01_55)] px-1.5 py-1">
				<div class="min-w-0 flex-1">
					<div class="text-[10px] text-[oklch(0.82_0.008_70)]">
						{m.video_editor_local_models_memory()}
					</div>
					<div class="text-[9px] text-[oklch(0.55_0.01_55)]">
						{m.video_editor_local_models_loaded({ count: loadedRuntimeCount })}
					</div>
				</div>
				<Button
					size="xs"
					variant="ghost"
					disabled={disabled || unloadingRuntimes || loadedRuntimeCount === 0}
					onclick={() => void unloadRuntimes()}
				>
					{unloadingRuntimes
						? m.video_editor_local_models_unloading()
						: m.video_editor_local_models_unload()}
				</Button>
			</div>
			{#if runtimeMessage}
				<p class="px-1 text-[9px] text-[oklch(0.62_0.012_55)]" role="status">
					{runtimeMessage}
				</p>
			{/if}
			{#if cacheMessage}
				<p class="px-1 text-[9px] text-[var(--video-editor-danger)]" role="alert">
					{cacheMessage}
				</p>
			{/if}
			{#if loading && summaries.length === 0}
				<div class="flex items-center gap-1 px-1 py-2 text-[10px] text-[oklch(0.6_0.012_55)]">
					<LoaderIcon class="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
					{m.video_editor_local_models_checking()}
				</div>
			{:else}
				{#each summaries as summary (summary.id)}
					<div class="flex items-center gap-1 rounded bg-[oklch(0.2_0.01_55)] px-1.5 py-1">
						<div class="min-w-0 flex-1">
							<div class="truncate text-[10px] text-[oklch(0.82_0.008_70)]">
								{modelLabel(summary)}
							</div>
							<div class="text-[9px] text-[oklch(0.55_0.01_55)]">
								{#if summary.inspectionState !== 'ready'}
									{m.video_editor_models_load_failed()}
								{:else if summary.downloaded}
									{summary.sizeStatus === 'unavailable'
										? m.video_editor_models_cached()
										: formatBytes(summary.totalBytes)}
								{:else}
									{m.video_editor_models_not_cached()}
								{/if}
							</div>
						</div>
						{#if summary.downloaded}
							<Button
								size="xs"
								variant="ghost"
								disabled={disabled || clearingId !== null}
								onclick={() => void remove(summary)}
							>
								{clearingId === summary.id
									? m.video_editor_local_models_removing()
									: m.video_editor_models_remove()}
							</Button>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
