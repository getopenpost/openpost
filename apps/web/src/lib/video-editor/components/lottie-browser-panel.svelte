<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import { showToast } from '$lib/toast';
	import { importRemoteLottie } from '$lib/video-editor/media/import.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { insertMediaAtFrame } from '$lib/video-editor/timeline/actions/insert-media';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		fetchLottieAnimations,
		lottieFilesAttribution,
		offsetToCursor,
		type LottieBrowseCategory,
		type LottieFilesAnimation
	} from '$lib/video-editor/lottie/lottiefiles-api';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';

	const PAGE_SIZE = 24;
	const categories: LottieBrowseCategory[] = ['featured', 'popular', 'recent'];
	type LottieBrowserPanelProps = {
		projectId: string;
		oninserted?: (itemId: string) => void;
		fetchAnimations?: typeof fetchLottieAnimations;
		importAnimation?: typeof importRemoteLottie;
	};
	let {
		projectId,
		oninserted,
		fetchAnimations = fetchLottieAnimations,
		importAnimation = importRemoteLottie
	}: LottieBrowserPanelProps = $props();
	let category = $state<LottieBrowseCategory>('featured');
	let inputValue = $state('');
	let query = $state('');
	let items = $state<LottieFilesAnimation[]>([]);
	let status = $state<'loading' | 'idle' | 'error'>('loading');
	let error = $state('');
	let page = $state(0);
	let totalCount = $state(0);
	let importingIds = $state(new Set<string>());
	let importedIds = $state(new Set<string>());
	let importedMediaIds = $state<Record<string, string>>({});
	let failedIds = $state(new Set<string>());
	let previewFailedIds = $state(new Set<string>());
	let controller: AbortController | null = null;
	let requestId = 0;
	const totalPages = $derived(Math.max(1, Math.ceil(totalCount / PAGE_SIZE)));

	function withId(values: Set<string>, id: string, present: boolean): Set<string> {
		const next = new Set(values);
		if (present) next.add(id);
		else next.delete(id);
		return next;
	}

	async function loadPage(
		nextPage: number,
		activeCategory: LottieBrowseCategory = category,
		activeQuery: string = query
	): Promise<void> {
		controller?.abort();
		controller = new AbortController();
		const signal = controller.signal;
		const revision = ++requestId;
		status = 'loading';
		error = '';
		try {
			const target = Math.max(0, nextPage);
			const result = await fetchAnimations({
				category: activeCategory,
				query: activeQuery,
				after: target === 0 ? null : offsetToCursor(target * PAGE_SIZE - 1),
				first: PAGE_SIZE,
				signal
			});
			if (signal.aborted || revision !== requestId) return;
			items = result.items;
			totalCount = result.totalCount;
			page = target;
			status = 'idle';
		} catch (reason) {
			if (signal.aborted || revision !== requestId) return;
			status = 'error';
			error = reason instanceof Error ? reason.message : m.video_editor_lottiefiles_error();
		}
	}

	$effect(() => {
		const value = inputValue.trim();
		const timeout = window.setTimeout(() => (query = value), 300);
		return () => window.clearTimeout(timeout);
	});

	$effect(() => {
		void loadPage(0, category, query);
	});

	onDestroy(() => controller?.abort());

	async function addAnimation(animation: LottieFilesAnimation): Promise<void> {
		if (importingIds.has(animation.id) || (importedIds.has(animation.id) && !oninserted)) return;
		const insertionFrame = timelineStore.currentFrame;
		importingIds = withId(importingIds, animation.id, true);
		failedIds = withId(failedIds, animation.id, false);
		try {
			const mediaId =
				importedMediaIds[animation.id] ??
				(await importAnimation({
					projectId,
					url: animation.lottieUrl,
					fileName: animation.name,
					attribution: lottieFilesAttribution(animation)
				}));
			importedMediaIds = { ...importedMediaIds, [animation.id]: mediaId };
			const media = mediaPool.get(mediaId);
			if (oninserted && media) oninserted(insertMediaAtFrame(media, insertionFrame));
			importedIds = withId(importedIds, animation.id, true);
			showToast(
				oninserted
					? m.video_editor_stock_added({ name: animation.name })
					: m.video_editor_lottiefiles_added({ name: animation.name }),
				'success'
			);
		} catch (reason) {
			failedIds = withId(failedIds, animation.id, true);
			showToast(
				reason instanceof Error ? reason.message : m.video_editor_lottiefiles_import_error(),
				'error'
			);
		} finally {
			importingIds = withId(importingIds, animation.id, false);
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" aria-label={m.video_editor_lottiefiles()}>
	<div class="flex flex-col gap-2 border-b border-[var(--video-editor-border)] p-2">
		<label class="relative block">
			<span class="sr-only">{m.video_editor_lottiefiles_search()}</span>
			<ThemeIcon
				role="search"
				class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--video-editor-muted)]"
			/>
			<Input
				class="h-8 w-full rounded bg-[var(--video-editor-panel)] pr-8 pl-7 text-xs"
				placeholder={m.video_editor_lottiefiles_search()}
				bind:value={inputValue}
			/>
			{#if inputValue}
				<button
					type="button"
					class="absolute top-1/2 right-1.5 rounded p-1 text-[var(--video-editor-muted)] hover:bg-[var(--video-editor-control-hover)] hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
					aria-label={m.video_editor_lottiefiles_clear()}
					onclick={() => (inputValue = '')}
				>
					<ThemeIcon role="close" class="size-3" />
				</button>
			{/if}
		</label>
		{#if !inputValue.trim()}
			<div class="grid grid-cols-3 gap-1">
				{#each categories as value (value)}
					<button
						type="button"
						class:active={category === value}
						class="rounded px-1 py-1 text-[10px] font-medium text-[var(--video-editor-muted)] hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [&.active]:bg-[var(--video-editor-primary)] [&.active]:text-[var(--video-editor-primary-text)]"
						onclick={() => (category = value)}
					>
						{value === 'featured'
							? m.video_editor_lottiefiles_featured()
							: value === 'popular'
								? m.video_editor_lottiefiles_popular()
								: m.video_editor_lottiefiles_recent()}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if status === 'loading' && items.length === 0}
			<div class="flex h-24 items-center justify-center">
				<ProtectedIcon
					icon="loading"
					class="size-5 animate-spin text-[var(--video-editor-primary)] motion-reduce:animate-none"
				/>
			</div>
		{:else if status === 'error'}
			<div class="flex flex-col items-center gap-2 py-8 text-center">
				<p class="text-xs leading-5 text-[var(--video-editor-muted)]">{error}</p>
				<button
					type="button"
					class="rounded bg-[var(--video-editor-control-hover)] px-2.5 py-1 text-xs hover:bg-[var(--video-editor-selection)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
					onclick={() => void loadPage(page)}>{m.video_editor_lottiefiles_retry()}</button
				>
			</div>
		{:else if items.length === 0}
			<p class="py-8 text-center text-xs text-[var(--video-editor-muted)]">
				{m.video_editor_lottiefiles_empty()}
			</p>
		{:else}
			<ul class:opacity-60={status === 'loading'} class="grid grid-cols-2 gap-2">
				{#each items as animation (animation.id)}
					{@const isImporting = importingIds.has(animation.id)}
					{@const isImported = importedIds.has(animation.id)}
					{@const isFailed = failedIds.has(animation.id)}
					<li class="group min-w-0">
						<button
							type="button"
							class="relative aspect-square w-full overflow-hidden rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] hover:border-[var(--video-editor-focus-border)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:cursor-default"
							style:background-color={animation.bgColor ?? undefined}
							disabled={isImporting || (isImported && !oninserted)}
							aria-label={`${
								isImported && !oninserted
									? m.video_editor_lottiefiles_added_short()
									: isFailed
										? m.video_editor_lottiefiles_retry_import()
										: oninserted
											? m.video_editor_stock_add_playhead()
											: m.video_editor_lottiefiles_add()
							}: ${animation.name}`}
							onclick={() => void addAnimation(animation)}
						>
							{#if animation.gifUrl && !previewFailedIds.has(animation.id)}
								<img
									crossorigin="anonymous"
									src={animation.gifUrl}
									alt={animation.name}
									loading="lazy"
									class="size-full object-contain"
									onerror={() => (previewFailedIds = withId(previewFailedIds, animation.id, true))}
								/>
							{:else}
								<ProtectedIcon
									icon="editor-animation"
									class="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-[var(--video-editor-muted)]"
								/>
							{/if}
							{#if !isImporting && (!isImported || oninserted) && !isFailed}
								<span
									class="absolute inset-0 flex items-center justify-center bg-[var(--video-editor-control)] opacity-0 transition-opacity group-hover:opacity-100"
								>
									<ThemeIcon role="add" class="size-5 text-[var(--video-editor-text)]" />
								</span>
							{:else if isImporting}
								<span
									class="absolute inset-0 flex items-center justify-center bg-[var(--video-editor-control)]"
								>
									<ProtectedIcon
										icon="loading"
										class="size-5 animate-spin text-[var(--video-editor-text)] motion-reduce:animate-none"
									/>
								</span>
							{:else if isImported}
								<span
									class="absolute top-1 right-1 rounded-full bg-[var(--video-editor-primary)] p-0.5 text-[var(--video-editor-primary-text)]"
								>
									<ProtectedIcon icon="success" class="size-3" />
								</span>
							{:else}
								<span class="absolute inset-0 flex items-center justify-center bg-red-950/40">
									<ThemeIcon role="refresh" class="size-5 text-[var(--video-editor-text)]" />
								</span>
							{/if}
						</button>
						<p class="mt-1 truncate px-0.5 text-[10px] font-medium" title={animation.name}>
							{animation.name}
						</p>
						{#if animation.author}
							<p class="truncate px-0.5 text-[9px] text-[var(--video-editor-muted)]">
								{m.video_editor_lottiefiles_by({ author: animation.author })}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if totalPages > 1 && status !== 'error'}
		<div
			class="flex items-center justify-between border-t border-[var(--video-editor-border)] px-2 py-1.5"
		>
			<button
				type="button"
				class="rounded p-1 text-[var(--video-editor-muted)] hover:bg-[var(--video-editor-control-hover)] disabled:opacity-30"
				disabled={page === 0 || status === 'loading'}
				aria-label={m.video_editor_lottiefiles_previous()}
				onclick={() => void loadPage(page - 1)}
			>
				<ThemeIcon role="chevron-left" class="size-4" />
			</button>
			<span class="text-[10px] text-[var(--video-editor-muted)] tabular-nums">
				{m.video_editor_lottiefiles_page({ page: page + 1, total: totalPages })}
			</span>
			<button
				type="button"
				class="rounded p-1 text-[var(--video-editor-muted)] hover:bg-[var(--video-editor-control-hover)] disabled:opacity-30"
				disabled={page >= totalPages - 1 || status === 'loading'}
				aria-label={m.video_editor_lottiefiles_next()}
				onclick={() => void loadPage(page + 1)}
			>
				<ThemeIcon role="chevron-right" class="size-4" />
			</button>
		</div>
	{/if}
	<p
		class="border-t border-[var(--video-editor-border)] px-2 py-1.5 text-[9px] leading-4 text-[var(--video-editor-muted)]"
	>
		<span>{m.video_editor_lottiefiles_license()}</span>
		<a
			href="https://lottiefiles.com/page/license"
			target="_blank"
			rel="noreferrer"
			class="ml-1 underline hover:text-[var(--video-editor-text)]"
			>{m.video_editor_lottiefiles_license_link()}</a
		>.
	</p>
</div>
