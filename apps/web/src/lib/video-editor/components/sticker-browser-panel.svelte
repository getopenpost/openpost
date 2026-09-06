<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { showToast } from '$lib/toast';
	import { commitImportedAsset } from '$lib/video-editor/media/commit-imported-asset';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		fluentEmojiAttribution,
		fluentEmojiStickerFile,
		fluentEmojiStickerPreviewUrl,
		loadFluentEmojiCatalog,
		searchFluentEmojiStickers,
		type FluentEmojiCatalog,
		type FluentEmojiSticker
	} from '$lib/video-editor/stickers/fluent-emoji';

	const PAGE_SIZE = 60;
	let {
		projectId,
		oninserted,
		loadCatalog = loadFluentEmojiCatalog,
		commitAsset = commitImportedAsset
	}: {
		projectId: string;
		oninserted: (itemId: string) => void;
		loadCatalog?: typeof loadFluentEmojiCatalog;
		commitAsset?: typeof commitImportedAsset;
	} = $props();
	let catalog = $state<FluentEmojiCatalog | null>(null);
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let error = $state('');
	let query = $state('');
	let visibleCount = $state(PAGE_SIZE);
	let lastQuery = $state('');
	let inserting = $state('');
	const matches = $derived(catalog ? searchFluentEmojiStickers(catalog, query) : []);
	const visible = $derived(matches.slice(0, visibleCount));

	onMount(() => void load());

	$effect(() => {
		if (query === lastQuery) return;
		lastQuery = query;
		visibleCount = PAGE_SIZE;
	});

	async function load(): Promise<void> {
		status = 'loading';
		error = '';
		try {
			catalog = await loadCatalog();
			status = 'ready';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_stickers_load_failed();
			status = 'error';
		}
	}

	async function addSticker(sticker: FluentEmojiSticker): Promise<void> {
		if (inserting || !projectId) return;
		inserting = sticker.name;
		try {
			const committed = await commitAsset(fluentEmojiStickerFile(sticker), {
				projectId,
				attribution: fluentEmojiAttribution(sticker),
				tags: ['sticker', 'fluent-emoji'],
				insertAtFrame: timelineStore.currentFrame,
				label: sticker.label
			});
			oninserted(committed.itemId);
			showToast(m.video_editor_sticker_added({ name: sticker.label }), 'success');
		} catch (cause) {
			showToast(
				cause instanceof Error ? cause.message : m.video_editor_sticker_add_failed(),
				'error'
			);
		} finally {
			inserting = '';
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" aria-label={m.video_editor_stickers()}>
	<div class="border-b border-[var(--video-editor-border)] p-2">
		<label class="relative block">
			<span class="sr-only">{m.video_editor_stickers_search()}</span>
			<ThemeIcon
				role="search"
				class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--video-editor-muted)]"
			/>
			<Input
				class="h-8 w-full rounded bg-[var(--video-editor-panel)] pl-7 text-xs"
				placeholder={m.video_editor_stickers_search()}
				bind:value={query}
			/>
		</label>
	</div>

	{#if status === 'loading'}
		<div
			class="flex flex-1 items-center justify-center gap-2 p-4 text-xs text-[var(--video-editor-muted)]"
			role="status"
		>
			<ProtectedIcon icon="loading" class="size-4 animate-spin motion-reduce:animate-none" />
			{m.video_editor_stickers_loading()}
		</div>
	{:else if status === 'error'}
		<div class="p-2">
			<InlineNotice tone="error" message={error}>
				{#snippet actions()}
					<Button size="sm" variant="outline" onclick={load}>{m.common_retry()}</Button>
				{/snippet}
			</InlineNotice>
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto p-2">
			<p class="mb-2 text-[10px] text-[var(--video-editor-muted)]" aria-live="polite">
				{query.trim()
					? m.video_editor_stickers_results({ count: matches.length })
					: m.video_editor_stickers_popular()}
			</p>
			{#if visible.length === 0}
				<p class="py-8 text-center text-xs text-[var(--video-editor-muted)]">
					{m.video_editor_stickers_empty()}
				</p>
			{:else}
				<div class="grid grid-cols-3 gap-1.5">
					{#each visible as sticker (sticker.name)}
						<button
							type="button"
							class="group relative flex min-h-20 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-1.5 text-center hover:border-[var(--video-editor-focus-border)] hover:bg-[var(--video-editor-panel)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:opacity-60"
							disabled={Boolean(inserting)}
							aria-label={m.video_editor_sticker_add({ name: sticker.label })}
							title={m.video_editor_sticker_add({ name: sticker.label })}
							onclick={() => addSticker(sticker)}
						>
							<img
								src={fluentEmojiStickerPreviewUrl(sticker)}
								alt=""
								class="size-11 object-contain transition-transform group-hover:scale-105"
								loading="lazy"
							/>
							<span class="w-full truncate text-[9px] text-[var(--video-editor-muted)]">
								{sticker.label}
							</span>
							{#if inserting === sticker.name}
								<span
									class="absolute inset-0 flex items-center justify-center bg-[var(--video-editor-control)]"
								>
									<ProtectedIcon
										icon="loading"
										class="size-4 animate-spin text-[var(--video-editor-text)] motion-reduce:animate-none"
									/>
								</span>
							{:else}
								<ThemeIcon
									role="add"
									class="absolute top-1 right-1 size-3 text-[var(--video-editor-text)] opacity-0 group-hover:opacity-100"
								/>
							{/if}
						</button>
					{/each}
				</div>
				{#if visible.length < matches.length}
					<Button
						variant="outline"
						size="sm"
						class="mt-2 w-full"
						onclick={() => (visibleCount += PAGE_SIZE)}
					>
						{m.video_editor_stickers_more()}
					</Button>
				{/if}
			{/if}
		</div>
		<p
			class="border-t border-[var(--video-editor-border)] px-2 py-1.5 text-[9px] text-[var(--video-editor-muted)]"
		>
			<a
				href="https://github.com/microsoft/fluentui-emoji"
				target="_blank"
				rel="noreferrer"
				class="hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
			>
				{m.video_editor_stickers_source()}
			</a>
		</p>
	{/if}
</div>
