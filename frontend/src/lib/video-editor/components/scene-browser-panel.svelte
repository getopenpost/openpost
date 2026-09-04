<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { onDestroy, onMount } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { showToast } from '$lib/toast';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { nearestColorFamily } from '$lib/video-editor/media/scene-search/color-boost';
	import { isSceneAnalyzableMedia } from '$lib/video-editor/media/scene-search/scene-analysis-client';
	import { sceneBrowser } from '$lib/video-editor/media/scene-search/scene-browser.svelte';
	import { insertSceneAtPlayhead } from '$lib/video-editor/media/scene-search/scene-insert';
	import {
		clearSceneDragData,
		setSceneDragData
	} from '$lib/video-editor/media/scene-search/scene-drag';
	import {
		clusterPaletteEntries,
		flattenLibraryPalettes
	} from '$lib/video-editor/media/scene-search/library-palette';
	import type { MediaScene } from '$lib/video-editor/media/scene-search/types';
	import SceneThumbnail from './scene-thumbnail.svelte';

	let batchBusy = $state(false);
	let queryTimer: ReturnType<typeof setTimeout> | null = null;
	const scenes = $derived(sceneBrowser.rankedScenes());
	const analyzableMedia = $derived(mediaPool.mediaList.filter(isSceneAnalyzableMedia));
	const activeProgress = $derived.by(() => {
		const id = sceneBrowser.analyzingMediaIds[0];
		if (!id) return null;
		return { id, media: mediaPool.get(id), progress: sceneBrowser.progress(id) };
	});
	const libraryColors = $derived(
		clusterPaletteEntries(flattenLibraryPalettes(sceneBrowser.allPalettes), 10)
	);

	$effect(() => {
		for (const media of analyzableMedia) void sceneBrowser.load(media.id);
	});

	$effect(() => {
		const query = sceneBrowser.query;
		if (queryTimer) clearTimeout(queryTimer);
		queryTimer = setTimeout(() => void sceneBrowser.prepareSemanticQuery(query), 180);
		return () => {
			if (queryTimer) clearTimeout(queryTimer);
		};
	});

	onMount(() => void sceneBrowser.loadAll());
	onDestroy(clearSceneDragData);

	function formatTime(seconds: number): string {
		const total = Math.max(0, Math.floor(seconds));
		const hours = Math.floor(total / 3600);
		const minutes = Math.floor((total % 3600) / 60);
		const secs = total % 60;
		return hours > 0
			? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
			: `${minutes}:${String(secs).padStart(2, '0')}`;
	}

	async function analyze(force: boolean): Promise<void> {
		if (batchBusy || analyzableMedia.length === 0) return;
		batchBusy = true;
		try {
			await sceneBrowser.analyzeBatch(force);
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				showToast(m.video_editor_scene_analysis_error({ name: '' }), 'error');
			}
		} finally {
			batchBusy = false;
		}
	}

	function addScene(sceneId: string): void {
		const scene = sceneBrowser.getScene(sceneId);
		const media = scene ? mediaPool.get(scene.mediaId) : undefined;
		if (!scene || !media) return;
		insertSceneAtPlayhead(scene, media);
		editorSession.scheduleAutosave();
		showToast(m.video_editor_scene_added(), 'success');
	}

	function cancelAnalysis(): void {
		const mediaId = sceneBrowser.analyzingMediaIds[0];
		if (mediaId) sceneBrowser.cancel(mediaId);
	}

	function searchColor(swatch: { l: number; a: number; b: number }): void {
		if (sceneBrowser.colorMode) {
			sceneBrowser.referencePalette = [{ ...swatch, weight: 1 }];
			sceneBrowser.sortMode = 'relevance';
			return;
		}
		const family = nearestColorFamily(swatch);
		if (!family) return;
		sceneBrowser.scope = null;
		sceneBrowser.query = family;
		sceneBrowser.sortMode = 'relevance';
	}

	function findSimilarPalette(scene: MediaScene): void {
		if (!scene.palette?.length) return;
		sceneBrowser.referencePalette = scene.palette.map((entry) => ({ ...entry }));
		sceneBrowser.colorMode = true;
		sceneBrowser.sortMode = 'relevance';
	}

	function startSceneDrag(event: DragEvent, scene: MediaScene): void {
		if (!event.dataTransfer) return;
		const payload = { type: 'timeline-scene' as const, scene };
		setSceneDragData(payload);
		event.dataTransfer.effectAllowed = 'copy';
		event.dataTransfer.setData('application/json', JSON.stringify(payload));
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="space-y-2 border-b border-[var(--video-editor-border)] px-2 pb-2">
		<label class="relative block">
			<ThemeIcon
				role="search"
				class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--video-editor-muted)]"
			/>
			<Input
				type="search"
				data-scene-browser-search
				class="h-8 w-full rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] pr-2 pl-7 text-xs placeholder:text-[var(--video-editor-muted)] focus-visible:border-[var(--video-editor-focus-border)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--video-editor-focus)_25%,transparent)]"
				placeholder={m.video_editor_scene_search()}
				bind:value={sceneBrowser.query}
			/>
		</label>
		<div class="flex gap-1">
			<Select.Root
				type="single"
				value={sceneBrowser.scope ?? ''}
				onValueChange={(v) => (sceneBrowser.scope = v || null)}
			>
				<Select.Trigger
					aria-label={m.video_editor_scene_scope_all()}
					class="h-7 min-w-0 flex-1 justify-between rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] px-2 text-[11px] shadow-none"
				>
					<span class="truncate"
						>{sceneBrowser.scope
							? (mediaPool.get(sceneBrowser.scope)?.fileName ?? sceneBrowser.scope)
							: m.video_editor_scene_scope_all()}</span
					>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="">{m.video_editor_scene_scope_all()}</Select.Item>
					{#each sceneBrowser.analyzedMediaIds as mediaId (mediaId)}
						<Select.Item value={mediaId}>{mediaPool.get(mediaId)?.fileName ?? mediaId}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<button
				type="button"
				class="flex h-7 items-center gap-1 rounded-md border border-[var(--video-editor-border)] px-2 text-[11px] hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:opacity-50"
				disabled={batchBusy || analyzableMedia.length === 0}
				title={m.video_editor_scene_analyze()}
				onclick={() => analyze(false)}
			>
				{#if batchBusy}
					<ProtectedIcon icon="loading" class="size-3 animate-spin motion-reduce:animate-none" />
				{:else}
					<ThemeIcon role="sparkles" class="size-3" />
				{/if}
				<span>{m.video_editor_scene_analyze()}</span>
			</button>
			<button
				type="button"
				class:active={sceneBrowser.colorMode}
				class="flex h-7 items-center rounded-md border border-[var(--video-editor-border)] px-2 text-[11px] hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [&.active]:border-[var(--video-editor-focus-border)] [&.active]:bg-[var(--video-editor-selection)]"
				aria-label={sceneBrowser.colorMode
					? m.video_editor_scene_colors_hide()
					: m.video_editor_scene_colors()}
				onclick={() => (sceneBrowser.colorMode = !sceneBrowser.colorMode)}
			>
				<ThemeIcon role="appearance" class="size-3" />
			</button>
		</div>
		{#if sceneBrowser.colorMode && libraryColors.length > 0}
			<div class="space-y-1" aria-label={m.video_editor_scene_library_colors()}>
				<div class="flex items-center justify-between text-[10px] text-[var(--video-editor-muted)]">
					<span>{m.video_editor_scene_library_colors()}</span>
					{#if sceneBrowser.referencePalette}
						<button
							type="button"
							class="hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
							onclick={() => (sceneBrowser.referencePalette = null)}
						>
							{m.video_editor_scene_palette_clear()}
						</button>
					{/if}
				</div>
				<div class="grid grid-cols-10 gap-1">
					{#each libraryColors as swatch}
						<button
							type="button"
							class="aspect-square rounded-sm border border-[var(--video-editor-border)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
							style:background={`lab(${swatch.l}% ${swatch.a} ${swatch.b})`}
							aria-label={m.video_editor_scene_palette_search()}
							onclick={() => searchColor(swatch)}
						></button>
					{/each}
				</div>
			</div>
		{/if}
		{#if activeProgress?.progress}
			<div class="space-y-1" aria-live="polite">
				<div class="truncate text-[10px] text-[var(--video-editor-muted)]">
					{m.video_editor_scene_analyzing({
						name: activeProgress.media?.fileName ?? '',
						progress: activeProgress.progress.percent
					})}
				</div>
				<div class="h-1 overflow-hidden rounded-full bg-[var(--video-editor-control)]">
					<div
						class="h-full rounded-full bg-[var(--video-editor-primary)] transition-[width]"
						style:width={`${activeProgress.progress.percent}%`}
					></div>
				</div>
				<button
					type="button"
					class="text-[10px] text-[var(--video-editor-muted)] hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
					onclick={cancelAnalysis}
				>
					{m.video_editor_analysis_cancel()}
				</button>
			</div>
		{/if}
	</div>

	<div
		class="flex items-center justify-between border-b border-[var(--video-editor-border)] px-2 py-1.5 text-[10px] text-[var(--video-editor-muted)]"
	>
		<span>
			{m.video_editor_scene_count({ count: scenes.length })} ·
			{m.video_editor_scene_media_count({ count: sceneBrowser.analyzedMediaIds.length })}
		</span>
		<div class="flex items-center gap-1">
			<Select.Root type="single" bind:value={sceneBrowser.sortMode}>
				<Select.Trigger
					aria-label={m.video_editor_scene_sort_relevance()}
					class="h-6 justify-between rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] px-1 text-[10px] shadow-none"
				>
					<span class="truncate"
						>{sceneBrowser.sortMode === 'relevance'
							? m.video_editor_scene_sort_relevance()
							: sceneBrowser.sortMode === 'time'
								? m.video_editor_scene_sort_time()
								: m.video_editor_scene_sort_name()}</span
					>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="relevance">{m.video_editor_scene_sort_relevance()}</Select.Item>
					<Select.Item value="time">{m.video_editor_scene_sort_time()}</Select.Item>
					<Select.Item value="name">{m.video_editor_scene_sort_name()}</Select.Item>
				</Select.Content>
			</Select.Root>
			<button
				type="button"
				class:active={sceneBrowser.viewMode === 'grid'}
				class="rounded p-1 hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [&.active]:bg-[var(--video-editor-selection)] [&.active]:text-[var(--video-editor-text)]"
				aria-label={m.video_editor_scene_view_grid()}
				onclick={() => (sceneBrowser.viewMode = 'grid')}
			>
				<ThemeIcon role="layout" class="size-3.5" />
			</button>
			<button
				type="button"
				class:active={sceneBrowser.viewMode === 'list'}
				class="rounded p-1 hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [&.active]:bg-[var(--video-editor-selection)] [&.active]:text-[var(--video-editor-text)]"
				aria-label={m.video_editor_scene_view_list()}
				onclick={() => (sceneBrowser.viewMode = 'list')}
			>
				<ThemeIcon role="layout" class="size-3.5" />
			</button>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if scenes.length > 0}
			<div class:grid={sceneBrowser.viewMode === 'grid'} class="grid-cols-2 gap-2">
				{#each scenes as ranked (ranked.id)}
					{@const scene = sceneBrowser.getScene(ranked.id)}
					{#if scene}
						<article
							class="group mb-1 overflow-hidden rounded-md border border-transparent bg-[var(--video-editor-panel)] hover:border-[var(--video-editor-focus-border)]"
							class:flex={sceneBrowser.viewMode === 'list'}
							draggable="true"
							ondragstart={(event) => startSceneDrag(event, scene)}
							ondragend={clearSceneDragData}
						>
							<div
								class="relative aspect-video min-w-0 overflow-hidden bg-[var(--video-editor-control)]"
								class:w-28={sceneBrowser.viewMode === 'list'}
								class:w-full={sceneBrowser.viewMode === 'grid'}
							>
								<SceneThumbnail
									relPath={scene.thumbRelPath}
									revision={sceneBrowser.analysis(scene.mediaId)?.analyzedAt}
								/>
								<span
									class="absolute right-1 bottom-1 rounded bg-[var(--video-editor-control)] px-1 font-mono text-[9px] text-[var(--video-editor-text)]"
								>
									{formatTime(scene.startSec)}
								</span>
								<button
									type="button"
									class="focus-visible:outline-inset absolute inset-0 flex items-center justify-center bg-[var(--video-editor-control)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
									aria-label={`${m.video_editor_scene_add()}: ${scene.text || m.video_editor_scene_label({ number: scene.index + 1 })}`}
									onclick={() => addScene(scene.id)}
								>
									<span
										class="flex size-7 items-center justify-center rounded-full bg-[var(--video-editor-primary)] text-[var(--video-editor-text)] shadow-md"
									>
										<ThemeIcon role="add" class="size-4" />
									</span>
								</button>
							</div>
							<div class="min-w-0 flex-1 space-y-1 p-1.5">
								<p class="line-clamp-2 text-[11px] leading-snug">
									{scene.text || m.video_editor_scene_label({ number: scene.index + 1 })}
								</p>
								<p
									class="truncate text-[9px] text-[var(--video-editor-muted)]"
									title={ranked.mediaFileName}
								>
									{ranked.mediaFileName} · {formatTime(scene.endSec - scene.startSec)}
								</p>
								{#if sceneBrowser.query || sceneBrowser.referencePalette}
									<div
										class="flex flex-wrap gap-1"
										aria-label={m.video_editor_scene_match_signals()}
									>
										{#if ranked.signals.keywordMatched}
											<span
												class="rounded bg-[var(--video-editor-control-hover)] px-1 py-0.5 text-[8px] text-[var(--video-editor-muted)]"
											>
												{m.video_editor_scene_match_keyword()}
											</span>
										{/if}
										{#if ranked.signals.textScore !== undefined}
											<span class="rounded bg-sky-400/10 px-1 py-0.5 text-[8px] text-sky-200">
												{m.video_editor_scene_match_meaning()}
											</span>
										{/if}
										{#if ranked.signals.imageScore !== undefined}
											<span class="rounded bg-violet-400/10 px-1 py-0.5 text-[8px] text-violet-200">
												{m.video_editor_scene_match_visual()}
											</span>
										{/if}
										{#if ranked.signals.colorMatch}
											<span class="rounded bg-amber-400/10 px-1 py-0.5 text-[8px] text-amber-200">
												{m.video_editor_scene_match_color()}
											</span>
										{/if}
										{#if ranked.signals.paletteDistance !== undefined}
											<span class="rounded bg-rose-400/10 px-1 py-0.5 text-[8px] text-rose-200">
												{m.video_editor_scene_match_palette()}
											</span>
										{/if}
									</div>
								{/if}
								{#if scene.palette?.length}
									<div class="flex items-center gap-0.5">
										<button
											type="button"
											class="mr-0.5 rounded p-0.5 text-[var(--video-editor-muted)] hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
											aria-label={m.video_editor_scene_palette_similar()}
											onclick={() => findSimilarPalette(scene)}
										>
											<ThemeIcon role="appearance" class="size-3" />
										</button>
										{#each scene.palette.slice(0, 4) as swatch}
											<button
												type="button"
												class="size-3 rounded-sm border border-[var(--video-editor-border)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
												style:background={`lab(${swatch.l}% ${swatch.a} ${swatch.b})`}
												aria-label={m.video_editor_scene_palette_search()}
												onclick={() => searchColor(swatch)}
											></button>
										{/each}
									</div>
								{/if}
							</div>
						</article>
					{/if}
				{/each}
			</div>
		{:else}
			<div
				class="flex h-full min-h-36 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[var(--video-editor-muted)]"
			>
				<ThemeIcon role="sparkles" class="size-5" />
				<p>
					{sceneBrowser.totalScenes > 0
						? m.video_editor_scene_no_matches()
						: m.video_editor_scene_empty()}
				</p>
				{#if sceneBrowser.totalScenes > 0}
					<button
						type="button"
						class="rounded px-2 py-1 text-[10px] text-[var(--video-editor-primary)] hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
						onclick={() => analyze(true)}
					>
						{m.video_editor_scene_reanalyze()}
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
