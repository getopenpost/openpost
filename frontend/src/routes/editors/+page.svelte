<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { ContextMenu } from 'bits-ui';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		deleteImageEditorDesign,
		duplicateImageEditorDesign,
		listImageEditorDesigns,
		loadImageEditorDesign,
		saveImageEditorDesign,
		toggleImageEditorDesignFavorite
	} from '$lib/image-editor/api';
	import type { ImageEditorDesignSummary } from '$lib/image-editor/types';
	import {
		EDITOR_CATALOG_PAGE_SIZE,
		EditorCatalogCache,
		EditorCatalogRequestGate,
		editorCatalogKey,
		emptyEditorCatalog,
		isAbortError,
		mergeEditorCatalogItems,
		normalizeEditorCatalogQuery,
		resolveEditorCatalogSurface,
		type EditorCatalogItemKind,
		type EditorCatalogSnapshot
	} from '$lib/editor-catalog';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import PageContainer from '$lib/components/page-container.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import RenameDialog from '$lib/components/rename-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { createWorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';
	import { filterLocalVideoProjects } from '$lib/video-editor/project/workspace-project-catalog';
	import { createWorkspaceProjectCatalog } from '$lib/video-editor/project/workspace-project-catalog.svelte';
	import ClapperboardIcon from '@lucide/svelte/icons/clapperboard';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { m } from '$lib/paraglide/messages';

	type CatalogView = EditorCatalogSnapshot & {
		loading: boolean;
		refreshing: boolean;
		loadingMoreDesigns: boolean;
		error: string;
	};
	type DeleteTarget = {
		kind: EditorCatalogItemKind;
		workspaceID: string;
		key: string;
		item: ImageEditorDesignSummary;
	};
	type RenameTarget = DeleteTarget;

	const catalogCache = new EditorCatalogCache();
	const catalogRequests = new EditorCatalogRequestGate();
	const designPageRequests = new EditorCatalogRequestGate();
	const pendingDeletes = new SvelteSet<string>();
	const videoWorkspaceGate = createWorkspaceGate();
	const videoProjectCatalog = createWorkspaceProjectCatalog(videoWorkspaceGate);

	let search = $state('');
	let toastMessage = $state('');
	let toastTone = $state<'neutral' | 'success' | 'error'>('neutral');
	let deleteDialogOpen = $state(false);
	let deleteTarget = $state.raw<DeleteTarget | null>(null);
	let catalogReturnFocus = $state<HTMLElement | null>(null);
	let renameDialogOpen = $state(false);
	let renameTarget = $state.raw<RenameTarget | null>(null);
	let workspaceInitializationPending = $state(!workspaceCtx.currentWorkspace);
	let workspaceInitializationError = $state('');
	let catalog = $state.raw<CatalogView>(catalogView(emptyEditorCatalog('', ''), { loading: true }));
	let workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let query = $derived(normalizeEditorCatalogQuery(search));
	let activeCatalogKey = $derived(editorCatalogKey(workspaceID, query));
	let hasMoreDesigns = $derived(catalog.designOffset < catalog.designTotal);
	let imageCatalogSurface = $derived(
		resolveEditorCatalogSurface({
			loading: catalog.loading,
			error: catalog.error,
			designCount: catalog.designs.length
		})
	);
	let visibleVideoProjects = $derived(
		filterLocalVideoProjects(videoProjectCatalog.projects, query)
	);

	onMount(() => {
		if (!workspaceCtx.currentWorkspace) {
			void initializeWorkspace();
		} else {
			workspaceInitializationPending = false;
		}
		return invalidateCatalogRequests;
	});

	$effect(() => {
		const requestedWorkspaceID = workspaceID;
		const requestedQuery = query;
		const key = editorCatalogKey(requestedWorkspaceID, requestedQuery);

		invalidateCatalogRequests();
		deleteDialogOpen = false;
		deleteTarget = null;
		renameDialogOpen = false;
		renameTarget = null;

		const cached = requestedWorkspaceID
			? catalogCache.read(requestedWorkspaceID, requestedQuery)
			: undefined;
		catalog = catalogView(cached ?? emptyEditorCatalog(requestedWorkspaceID, requestedQuery), {
			loading: requestedWorkspaceID
				? !cached
				: workspaceInitializationPending || workspaceCtx.loading,
			refreshing: Boolean(cached),
			error: requestedWorkspaceID ? '' : workspaceInitializationError
		});
		if (!requestedWorkspaceID) return;

		const timeout = window.setTimeout(
			() => void loadCatalog(requestedWorkspaceID, requestedQuery, key),
			requestedQuery ? 250 : 0
		);
		return () => {
			window.clearTimeout(timeout);
			invalidateCatalogRequests();
		};
	});

	function catalogView(
		snapshot: EditorCatalogSnapshot,
		overrides: Partial<Omit<CatalogView, keyof EditorCatalogSnapshot>> = {}
	): CatalogView {
		return {
			...snapshot,
			loading: false,
			refreshing: false,
			loadingMoreDesigns: false,
			error: '',
			...overrides
		};
	}

	function catalogSnapshot(view: CatalogView): EditorCatalogSnapshot {
		return {
			workspaceID: view.workspaceID,
			query: view.query,
			designs: view.designs,
			designTotal: view.designTotal,
			designOffset: view.designOffset,
			canEditDesigns: view.canEditDesigns
		};
	}

	function invalidateCatalogRequests(): void {
		catalogRequests.invalidate();
		designPageRequests.invalidate();
	}

	function errorMessage(cause: unknown, fallback: string): string {
		return cause instanceof Error ? cause.message : fallback;
	}

	async function initializeWorkspace(): Promise<void> {
		workspaceInitializationPending = true;
		workspaceInitializationError = '';
		try {
			await workspaceCtx.initialize();
		} catch (cause) {
			if (!workspaceCtx.currentWorkspace) {
				workspaceInitializationError = errorMessage(cause, m.editors_load_failed());
			}
		} finally {
			workspaceInitializationPending = false;
		}
	}

	function retryCatalog(): void {
		if (workspaceID) void refreshCurrentCatalog(true);
		else void initializeWorkspace();
	}

	function pendingDeleteKey(
		workspace: string,
		kind: EditorCatalogItemKind,
		itemID: string
	): string {
		return JSON.stringify([workspace, kind, itemID]);
	}

	function excludePendingDeletes<T extends { id: string }>(
		items: T[],
		workspace: string,
		kind: EditorCatalogItemKind
	): T[] {
		return items.filter((item) => !pendingDeletes.has(pendingDeleteKey(workspace, kind, item.id)));
	}

	async function loadCatalog(
		requestedWorkspaceID: string,
		requestedQuery: string,
		key: string
	): Promise<void> {
		const token = catalogRequests.begin(key);
		try {
			const imageResult = await listImageEditorDesigns(requestedWorkspaceID, {
				search: requestedQuery,
				limit: EDITOR_CATALOG_PAGE_SIZE,
				offset: 0,
				signal: token.signal
			});
			if (!catalogRequests.accepts(token, activeCatalogKey)) return;
			const snapshot: EditorCatalogSnapshot = {
				workspaceID: requestedWorkspaceID,
				query: requestedQuery,
				designs: excludePendingDeletes(imageResult.designs, requestedWorkspaceID, 'design'),
				designTotal: imageResult.total,
				designOffset: imageResult.designs.length,
				canEditDesigns: imageResult.can_edit
			};
			catalogCache.write(snapshot);
			catalog = catalogView(snapshot);
		} catch (cause) {
			if (token.signal.aborted || isAbortError(cause)) return;
			if (!catalogRequests.accepts(token, activeCatalogKey)) return;
			catalog = {
				...catalog,
				loading: false,
				refreshing: false,
				error: errorMessage(cause, m.editors_load_failed())
			};
		}
	}

	async function refreshCurrentCatalog(preserveResults = true): Promise<void> {
		const requestedWorkspaceID = workspaceID;
		const requestedQuery = query;
		if (!requestedWorkspaceID) return;
		designPageRequests.invalidate();
		catalog = {
			...catalog,
			loading: !preserveResults,
			refreshing: preserveResults,
			error: ''
		};
		await loadCatalog(
			requestedWorkspaceID,
			requestedQuery,
			editorCatalogKey(requestedWorkspaceID, requestedQuery)
		);
	}

	async function loadMoreDesigns(): Promise<void> {
		const current = catalog;
		const key = editorCatalogKey(current.workspaceID, current.query);
		if (
			!current.workspaceID ||
			key !== activeCatalogKey ||
			current.loadingMoreDesigns ||
			current.designOffset >= current.designTotal
		) {
			return;
		}
		const offset = current.designOffset;
		const token = designPageRequests.begin(key);
		catalog = { ...current, loadingMoreDesigns: true, error: '' };
		try {
			const result = await listImageEditorDesigns(current.workspaceID, {
				search: current.query,
				limit: EDITOR_CATALOG_PAGE_SIZE,
				offset,
				signal: token.signal
			});
			if (!designPageRequests.accepts(token, activeCatalogKey)) return;
			const items = excludePendingDeletes(result.designs, current.workspaceID, 'design');
			const next: CatalogView = {
				...catalog,
				designs: mergeEditorCatalogItems(catalog.designs, items),
				designTotal: result.total,
				designOffset: result.designs.length === 0 ? result.total : offset + result.designs.length,
				canEditDesigns: result.can_edit,
				loadingMoreDesigns: false
			};
			catalogCache.write(catalogSnapshot(next));
			catalog = next;
		} catch (cause) {
			if (token.signal.aborted || isAbortError(cause)) return;
			if (!designPageRequests.accepts(token, activeCatalogKey)) return;
			catalog = {
				...catalog,
				loadingMoreDesigns: false,
				error: errorMessage(cause, m.editors_load_failed())
			};
		}
	}

	function formatDate(value: string | number): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
	}

	function formatDuration(seconds: number): string {
		const rounded = Math.max(0, Math.round(seconds));
		const hours = Math.floor(rounded / 3600);
		const minutes = Math.floor((rounded % 3600) / 60);
		const remainingSeconds = rounded % 60;
		return hours > 0
			? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
			: `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
	}

	function notify(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void {
		toastMessage = message;
		toastTone = tone;
	}

	async function duplicateDesign(design: ImageEditorDesignSummary): Promise<void> {
		const originWorkspaceID = workspaceID;
		if (!catalog.canEditDesigns || !originWorkspaceID) return;
		try {
			await duplicateImageEditorDesign(design.id);
			catalogCache.invalidateWorkspace(originWorkspaceID);
			if (workspaceID === originWorkspaceID) {
				await refreshCurrentCatalog(true);
				notify(m.image_editor_design_duplicated(), 'success');
			}
		} catch (cause) {
			if (workspaceID !== originWorkspaceID) return;
			notify(errorMessage(cause, m.image_editor_design_duplicate_failed()), 'error');
		}
	}

	async function toggleFavorite(design: ImageEditorDesignSummary): Promise<void> {
		const originWorkspaceID = workspaceID;
		const originKey = activeCatalogKey;
		if (!catalog.canEditDesigns || !originWorkspaceID) return;
		try {
			const favorite = await toggleImageEditorDesignFavorite(design.id);
			catalogCache.invalidateWorkspace(originWorkspaceID);
			if (workspaceID === originWorkspaceID && activeCatalogKey === originKey) {
				catalog = {
					...catalog,
					designs: catalog.designs.map((item) =>
						item.id === design.id ? { ...item, is_favorite: favorite } : item
					)
				};
				catalogCache.write(catalogSnapshot(catalog));
			}
		} catch (cause) {
			if (workspaceID !== originWorkspaceID) return;
			notify(errorMessage(cause, m.image_editor_design_favorite_failed()), 'error');
		}
	}

	function requestDeleteDesign(design: ImageEditorDesignSummary): void {
		if (!catalog.canEditDesigns || !workspaceID) return;
		deleteTarget = { kind: 'design', workspaceID, key: activeCatalogKey, item: design };
		deleteDialogOpen = true;
	}

	async function confirmDelete(): Promise<DestructiveActionOutcome> {
		const target = deleteTarget;
		if (
			!target ||
			target.workspaceID !== workspaceID ||
			target.key !== activeCatalogKey ||
			!catalog.canEditDesigns
		) {
			return { ok: false };
		}
		const itemKey = pendingDeleteKey(target.workspaceID, target.kind, target.item.id);
		pendingDeletes.add(itemKey);
		catalogCache.write(catalogSnapshot(catalog));
		const rollback = catalogCache.remove(target.workspaceID, target.kind, target.item.id);
		const optimistic = catalogCache.read(target.workspaceID, query);
		if (optimistic && target.key === activeCatalogKey) catalog = catalogView(optimistic);
		try {
			await deleteImageEditorDesign(target.item.id);
			pendingDeletes.delete(itemKey);
			catalogCache.invalidateWorkspace(target.workspaceID);
			if (workspaceID === target.workspaceID) {
				await refreshCurrentCatalog(true);
			}
			if (deleteTarget === target) deleteTarget = null;
			return {
				ok: true,
				successMessage: m.image_editor_design_deleted()
			};
		} catch (cause) {
			pendingDeletes.delete(itemKey);
			catalogCache.restore(rollback);
			if (workspaceID === target.workspaceID) {
				const restored = catalogCache.read(target.workspaceID, query);
				if (activeCatalogKey === target.key && restored) catalog = catalogView(restored);
				else await refreshCurrentCatalog(true);
			}
			return {
				ok: false,
				message: errorMessage(cause, m.image_editor_design_delete_failed())
			};
		}
	}

	function requestRenameDesign(design: ImageEditorDesignSummary): void {
		if (!catalog.canEditDesigns || !workspaceID) return;
		renameTarget = { kind: 'design', workspaceID, key: activeCatalogKey, item: design };
		renameDialogOpen = true;
	}

	async function renameProject(title: string): Promise<void> {
		const target = renameTarget;
		if (
			!target ||
			target.workspaceID !== workspaceID ||
			target.key !== activeCatalogKey ||
			!catalog.canEditDesigns
		) {
			throw new Error(m.editors_rename_failed());
		}
		try {
			const current = await loadImageEditorDesign(target.item.id);
			const updated = await saveImageEditorDesign(
				current.id,
				current.revision,
				{ ...current.document, title },
				current.cover_preview_media_id
			);
			catalogCache.invalidateWorkspace(target.workspaceID);
			if (workspaceID !== target.workspaceID || activeCatalogKey !== target.key) return;
			catalog = {
				...catalog,
				designs: catalog.designs.map((design) =>
					design.id === current.id
						? {
								...design,
								title: updated.document.title,
								revision: updated.revision,
								updated_at: updated.updated_at
							}
						: design
				)
			};
			catalogCache.write(catalogSnapshot(catalog));
			notify(m.editors_renamed(), 'success');
		} catch (cause) {
			throw new Error(errorMessage(cause, m.editors_rename_failed()));
		}
	}

	const contextContentClass =
		'z-50 min-w-48 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none';
	const contextItemClass =
		'flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45';
</script>

<svelte:head><title>{m.editors_title()} - OpenPost</title></svelte:head>

<PageContainer
	title={m.editors_title()}
	description={m.editors_description()}
	icon={ClapperboardIcon}
>
	{#snippet actions()}
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" href="/video-editor">
				<VideoIcon />
				{m.editors_new_video()}
			</Button>
			<Button
				disabled={!workspaceID}
				onclick={() =>
					goto(resolve(`/image-editor/new?workspace=${encodeURIComponent(workspaceID)}` as '/'))}
			>
				<PlusIcon />
				{m.editors_new_design()}
			</Button>
		</div>
	{/snippet}

	<div class="relative">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			bind:ref={catalogReturnFocus}
			bind:value={search}
			class="h-11 pl-9"
			placeholder={m.editors_search()}
			aria-label={m.editors_search()}
		/>
	</div>

	<div class="space-y-8">
		<section
			class="space-y-3"
			aria-labelledby="editor-catalog-designs-heading"
			aria-busy={catalog.loadingMoreDesigns || catalog.refreshing}
		>
			<div>
				<h2 id="editor-catalog-designs-heading" class="text-base font-semibold">
					{m.editors_image_designs()}
				</h2>
				<p class="text-sm text-muted-foreground">{m.editors_image_designs_body()}</p>
			</div>

			{#if catalog.error}
				<InlineNotice tone="error" message={catalog.error}>
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={retryCatalog}>{m.editors_retry()}</Button>
					{/snippet}
				</InlineNotice>
			{/if}

			{#if imageCatalogSurface === 'loading'}
				<PageLoading layout="gallery" items={5} label={m.editors_loading()} />
			{:else if catalog.designs.length === 0 && !catalog.error}
				<EmptyState
					icon={ImageIcon}
					title={query ? m.editors_no_match() : m.editors_empty()}
					description={query ? m.editors_no_match_body() : m.editors_image_designs_body()}
					actionLabel={query ? undefined : m.editors_create_design()}
					onAction={() =>
						goto(resolve(`/image-editor/new?workspace=${encodeURIComponent(workspaceID)}` as '/'))}
					variant="dashed"
					headingLevel={3}
				/>
			{:else if catalog.designs.length > 0}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
					{#each catalog.designs as design (design.id)}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								{#snippet child({ props })}
									<a
										{...props}
										class="group overflow-hidden rounded-xl border bg-card hover:border-foreground/25"
										href={resolve(`/image-editor/${design.id}` as '/')}
									>
										<div
											class="relative flex aspect-square items-center justify-center overflow-hidden bg-neutral-900 p-3"
										>
											{#if design.cover_preview_media_id}
												<img
													class="max-h-full max-w-full object-contain shadow-md"
													src={getAuthenticatedMediaURL(`/media/${design.cover_preview_media_id}`)}
													alt=""
												/>
											{:else}<ImageIcon class="size-8 text-neutral-500" />{/if}
											{#if design.is_favorite}
												<span class="absolute right-2 bottom-2 rounded-full bg-background/90 p-1.5">
													<HeartIcon class="size-3.5 fill-red-500 text-red-500" />
												</span>
											{/if}
										</div>
										<div class="p-3">
											<p class="truncate text-sm font-medium">{design.title}</p>
											<p class="mt-1 text-xs text-muted-foreground">
												{design.page_count === 1
													? m.editors_page_count_one({ count: design.page_count })
													: m.editors_page_count_many({ count: design.page_count })} · {formatDate(
													design.updated_at
												)}
											</p>
										</div>
									</a>
								{/snippet}
							</ContextMenu.Trigger>
							<ContextMenu.Portal>
								<ContextMenu.Content class={contextContentClass}>
									<ContextMenu.Item
										class={contextItemClass}
										disabled={!catalog.canEditDesigns}
										onclick={() => requestRenameDesign(design)}
									>
										<PencilIcon class="size-4" />
										{m.common_rename()}
									</ContextMenu.Item>
									<ContextMenu.Item
										class={contextItemClass}
										disabled={!catalog.canEditDesigns}
										onclick={() => duplicateDesign(design)}
									>
										<CopyIcon class="size-4" />
										{m.image_editor_duplicate_design()}
									</ContextMenu.Item>
									<ContextMenu.Item
										class={contextItemClass}
										disabled={!catalog.canEditDesigns}
										onclick={() => toggleFavorite(design)}
									>
										<HeartIcon class="size-4" fill={design.is_favorite ? 'currentColor' : 'none'} />
										{design.is_favorite ? m.media_unfavorite() : m.media_favorite()}
									</ContextMenu.Item>
									{#if catalog.canEditDesigns}
										<ContextMenu.Separator class="my-1 h-px bg-border" />
										<ContextMenu.Item
											class="{contextItemClass} text-destructive data-highlighted:text-destructive"
											onclick={() => requestDeleteDesign(design)}
										>
											<TrashIcon class="size-4" />
											{m.common_delete()}
										</ContextMenu.Item>
									{/if}
								</ContextMenu.Content>
							</ContextMenu.Portal>
						</ContextMenu.Root>
					{/each}
				</div>
				{#if hasMoreDesigns}
					<div class="flex justify-center">
						<Button
							variant="outline"
							disabled={catalog.loadingMoreDesigns}
							onclick={() => void loadMoreDesigns()}
						>
							{#if catalog.loadingMoreDesigns}
								<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
								{m.editors_loading_more()}
							{:else}
								{m.editors_load_more_designs()}
							{/if}
						</Button>
					</div>
				{/if}
			{/if}
		</section>

		<section
			class="space-y-3"
			aria-labelledby="editor-catalog-videos-heading"
			aria-busy={videoProjectCatalog.loading || videoProjectCatalog.refreshing}
		>
			<div>
				<h2 id="editor-catalog-videos-heading" class="text-base font-semibold">
					{m.editors_video_projects()}
				</h2>
				<p class="text-sm text-muted-foreground">{m.editors_video_projects_body()}</p>
			</div>

			{#if videoWorkspaceGate.error}
				<InlineNotice tone="error" message={videoWorkspaceGate.error} />
			{/if}

			{#if videoWorkspaceGate.state === 'initializing'}
				<PageLoading layout="gallery" items={4} label={m.editors_loading()} />
			{:else if videoWorkspaceGate.state === 'unavailable'}
				<InlineNotice>
					<div>
						<h3 class="font-medium">{m.video_editor_gate_unavailable_title()}</h3>
						<p class="mt-0.5 text-muted-foreground">{m.video_editor_gate_unavailable_body()}</p>
					</div>
				</InlineNotice>
			{:else if videoWorkspaceGate.state === 'pick'}
				<InlineNotice>
					<div>
						<h3 class="font-medium">{m.video_editor_gate_pick_title()}</h3>
						<p class="mt-0.5 text-muted-foreground">{m.video_editor_gate_pick_body()}</p>
					</div>
					{#snippet actions()}
						<Button
							variant="outline"
							size="sm"
							disabled={videoWorkspaceGate.busy}
							onclick={() => void videoWorkspaceGate.pickFolder()}
						>
							{#if videoWorkspaceGate.busy}
								<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
							{:else}
								<FolderPlusIcon class="size-4" />
							{/if}
							{m.video_editor_gate_pick_cta()}
						</Button>
					{/snippet}
				</InlineNotice>
			{:else if videoWorkspaceGate.state === 'reconnect'}
				<InlineNotice>
					<div>
						<h3 class="font-medium">{m.video_editor_gate_reconnect_title()}</h3>
						<p class="mt-0.5 text-muted-foreground">
							{m.video_editor_gate_reconnect_body({ folder: videoWorkspaceGate.workspaceName })}
						</p>
					</div>
					{#snippet actions()}
						<Button
							variant="outline"
							size="sm"
							disabled={videoWorkspaceGate.busy}
							onclick={() => void videoWorkspaceGate.reconnect()}
						>
							{#if videoWorkspaceGate.busy}
								<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
							{:else}
								<RefreshCwIcon class="size-4" />
							{/if}
							{m.video_editor_gate_reconnect_cta()}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={videoWorkspaceGate.busy}
							onclick={() => void videoWorkspaceGate.chooseDifferentFolder()}
						>
							{m.video_editor_gate_different_folder()}
						</Button>
					{/snippet}
				</InlineNotice>
			{:else}
				{#if videoProjectCatalog.error}
					<InlineNotice tone="error" message={videoProjectCatalog.error}>
						{#snippet actions()}
							<Button
								variant="outline"
								size="sm"
								onclick={() => void videoProjectCatalog.refresh()}
							>
								{m.editors_retry()}
							</Button>
						{/snippet}
					</InlineNotice>
				{/if}

				{#if videoProjectCatalog.loading}
					<PageLoading layout="gallery" items={4} label={m.editors_loading()} />
				{:else if visibleVideoProjects.length === 0 && !videoProjectCatalog.error}
					<EmptyState
						icon={VideoIcon}
						title={query ? m.editors_no_match() : m.video_editor_projects_empty()}
						description={query ? m.editors_no_match_body() : m.editors_video_projects_body()}
						actionLabel={query ? undefined : m.editors_open_video()}
						actionHref="/video-editor"
						variant="dashed"
						headingLevel={3}
					/>
				{:else if visibleVideoProjects.length > 0}
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{#each visibleVideoProjects as project (project.id)}
							<a
								class="group min-w-0 overflow-hidden rounded-xl border bg-card hover:border-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
								href={resolve(`/video-editor/${project.id}` as '/')}
							>
								<div
									class="flex aspect-video items-center justify-center overflow-hidden bg-neutral-900"
								>
									{#if videoProjectCatalog.thumbnailUrls[project.id]}
										<img
											class="size-full object-contain"
											src={videoProjectCatalog.thumbnailUrls[project.id]}
											alt={m.video_editor_project_thumbnail_alt({ name: project.name })}
											loading="lazy"
										/>
									{:else}
										<VideoIcon class="size-8 text-neutral-500" />
									{/if}
								</div>
								<div class="min-w-0 p-3">
									<p class="truncate text-sm font-medium">{project.name}</p>
									{#if project.description.trim()}
										<p class="mt-1 line-clamp-2 text-xs text-muted-foreground">
											{project.description}
										</p>
									{/if}
									<p class="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
										<span>{project.metadata.width}×{project.metadata.height}</span>
										<span>{project.metadata.fps} fps</span>
									</p>
									<p class="mt-1 text-xs text-muted-foreground">
										{m.video_editor_project_duration({
											duration: formatDuration(project.duration)
										})} · {formatDate(project.updatedAt)}
									</p>
								</div>
							</a>
						{/each}
					</div>
				{/if}
			{/if}
		</section>
	</div>
</PageContainer>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.image_editor_design_delete_title()}
	description={m.image_editor_design_delete_body()}
	onConfirm={confirmDelete}
	returnFocus={catalogReturnFocus}
/>

<RenameDialog
	bind:open={renameDialogOpen}
	title={m.editors_rename_design()}
	description={m.editors_rename_design_body()}
	label={m.editors_project_name()}
	initialValue={renameTarget?.item.title ?? ''}
	maxLength={160}
	onConfirm={renameProject}
/>

{#if toastMessage}
	<AppToast
		message={toastMessage}
		tone={toastTone}
		dismissLabel={m.common_dismiss()}
		onDismiss={() => (toastMessage = '')}
	/>
{/if}
