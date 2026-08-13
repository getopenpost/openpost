<!--
THESIS: Local model storage should be explicit, understandable, and easy to remove.
OWN-WORLD: OpenPost settings rows, structural dividers, warm surfaces, and restrained actions.
STORY: See what each model enables, its exact size, whether it is cached, and remove it safely.
FIRST VIEWPORT: Back navigation, privacy explanation, total cached size, and both model rows.
FORM: Settings surface; no technical cache names, promotional cards, or automatic downloads.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { loadVideoEditorConfig, type VideoEditorConfig } from '$lib/video-editor/api';
	import { cachedVideoEditorModels, removeVideoEditorModel } from '$lib/video-editor/model-manager';
	import type { ModelCacheMetadata } from '$lib/video-editor/types';
	import { formatBytes } from '$lib/video-editor/project';
	import { m } from '$lib/paraglide/messages';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	let config = $state<VideoEditorConfig | null>(null);
	let cached = $state<ModelCacheMetadata[]>([]);
	let loading = $state(true);
	let removing = $state('');
	let error = $state('');

	const cachedBytes = $derived(cached.reduce((total, item) => total + item.size_bytes, 0));

	onMount(() => {
		void load();
	});

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			[config, cached] = await Promise.all([loadVideoEditorConfig(), cachedVideoEditorModels()]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_models_load_failed();
		} finally {
			loading = false;
		}
	}

	async function remove(modelID: string): Promise<void> {
		if (!config || removing) return;
		removing = modelID;
		error = '';
		try {
			await removeVideoEditorModel(config, modelID);
			cached = await cachedVideoEditorModels();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_models_remove_failed();
		} finally {
			removing = '';
		}
	}
</script>

<svelte:head>
	<title>{m.video_editor_models_meta_title()}</title>
</svelte:head>

<div class="video-editor-theme min-h-dvh bg-background text-foreground">
	<header class="border-b">
		<div class="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:px-6">
			<a href={resolve('/')} class="flex min-h-11 items-center" aria-label={m.common_openpost()}>
				<Logo width={112} height={33} />
			</a>
			<span class="hidden text-sm text-muted-foreground sm:inline">/ {m.video_editor_title()}</span>
			<div class="ml-auto"><LanguageSwitcher compact /></div>
		</div>
	</header>

	<main class="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
		<Button href="/video-editor" variant="ghost" size="sm" class="-ml-2">
			<ArrowLeftIcon class="size-4" />
			{m.video_editor_back()}
		</Button>
		<div class="mt-5 max-w-2xl">
			<h1 class="text-2xl font-semibold tracking-tight">{m.video_editor_models_heading()}</h1>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">
				{m.video_editor_models_description()}
			</p>
		</div>

		{#if error}<InlineNotice class="mt-5" tone="error" message={error} />{/if}

		{#if loading}
			<div class="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
				<LoaderIcon class="size-4 animate-spin" />
				{m.video_editor_loading()}
			</div>
		{:else if config}
			<section
				class="mt-8 overflow-hidden rounded-lg border bg-card"
				aria-labelledby="model-list-title"
			>
				<div class="border-b px-4 py-3 sm:px-5">
					<h2 id="model-list-title" class="font-medium">{m.video_editor_models_downloaded()}</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.video_editor_models_total({ size: formatBytes(cachedBytes) })}
					</p>
				</div>
				{#each config.model_manifest ?? [] as model (model.id)}
					{@const state = cached.find((item) => item.id === model.id)}
					<div
						class="flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:px-5"
					>
						<div class="min-w-0 flex-1">
							<p class="font-medium">
								{model.kind === 'transcription'
									? m.video_editor_model_transcription()
									: m.video_editor_model_vad()}
							</p>
							<p class="mt-1 text-xs leading-5 text-muted-foreground">
								{formatBytes(model.size_bytes)} · {model.license_name} ·
								{state ? m.video_editor_models_cached() : m.video_editor_models_not_cached()}
							</p>
						</div>
						{#if state}
							<Button
								variant="outline"
								size="sm"
								disabled={Boolean(removing)}
								onclick={() => void remove(model.id)}
							>
								{#if removing === model.id}
									<LoaderIcon class="size-4 animate-spin" />
								{:else}
									<TrashIcon class="size-4" />
								{/if}
								{m.video_editor_models_remove()}
							</Button>
						{/if}
					</div>
				{/each}
			</section>
			<InlineNotice class="mt-5" tone="info" message={m.video_editor_models_privacy_notice()} />
		{/if}
	</main>
</div>
