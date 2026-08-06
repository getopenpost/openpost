<script lang="ts">
	import { onMount } from 'svelte';
	import { ContextMenu } from 'bits-ui';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		deleteImageEditorDesign,
		duplicateImageEditorDesign,
		listImageEditorDesigns,
		toggleImageEditorDesignFavorite
	} from '$lib/image-editor/api';
	import type { ImageEditorDesignSummary } from '$lib/image-editor/types';
	import { listCloudVideoProjects, type CloudVideoProjectSummary } from '$lib/video-editor/api';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import PageContainer from '$lib/components/page-container.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ClapperboardIcon from 'lucide-svelte/icons/clapperboard';
	import ImageIcon from 'lucide-svelte/icons/image';
	import VideoIcon from 'lucide-svelte/icons/video';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import SearchIcon from 'lucide-svelte/icons/search';
	import CopyIcon from 'lucide-svelte/icons/copy';
	import HeartIcon from 'lucide-svelte/icons/heart';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import { m } from '$lib/paraglide/messages';

	let loading = $state(true);
	let error = $state('');
	let search = $state('');
	let canEdit = $state(false);
	let toastMessage = $state('');
	let toastTone = $state<'neutral' | 'success' | 'error'>('neutral');
	let deleteDialogOpen = $state(false);
	let designToDelete = $state.raw<ImageEditorDesignSummary | null>(null);
	let designs = $state.raw<ImageEditorDesignSummary[]>([]);
	let videoProjects = $state.raw<CloudVideoProjectSummary[]>([]);
	let workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let query = $derived(search.trim().toLowerCase());
	let filteredDesigns = $derived(
		designs.filter((design) => design.title.toLowerCase().includes(query))
	);
	let filteredVideos = $derived(
		videoProjects.filter((project) => project.title.toLowerCase().includes(query))
	);

	onMount(() => {
		void initialize();
	});

	async function initialize(): Promise<void> {
		loading = true;
		error = '';
		try {
			if (!workspaceCtx.currentWorkspace) await workspaceCtx.initialize();
			const currentWorkspaceID = workspaceCtx.currentWorkspace?.id;
			if (!currentWorkspaceID) return;
			const [imageResult, videoResult] = await Promise.all([
				listImageEditorDesigns(currentWorkspaceID),
				listCloudVideoProjects(currentWorkspaceID)
			]);
			designs = imageResult.designs;
			canEdit = imageResult.can_edit;
			videoProjects = videoResult.projects;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.editors_load_failed();
		} finally {
			loading = false;
		}
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
	}

	function notify(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void {
		toastMessage = message;
		toastTone = tone;
	}

	async function duplicateDesign(design: ImageEditorDesignSummary): Promise<void> {
		try {
			await duplicateImageEditorDesign(design.id);
			await initialize();
			notify(m.image_editor_design_duplicated(), 'success');
		} catch (cause) {
			notify(
				cause instanceof Error ? cause.message : m.image_editor_design_duplicate_failed(),
				'error'
			);
		}
	}

	async function toggleFavorite(design: ImageEditorDesignSummary): Promise<void> {
		try {
			design.is_favorite = await toggleImageEditorDesignFavorite(design.id);
		} catch (cause) {
			notify(
				cause instanceof Error ? cause.message : m.image_editor_design_favorite_failed(),
				'error'
			);
		}
	}

	function requestDelete(design: ImageEditorDesignSummary): void {
		designToDelete = design;
		deleteDialogOpen = true;
	}

	async function confirmDelete(): Promise<void> {
		if (!designToDelete) return;
		try {
			await deleteImageEditorDesign(designToDelete.id);
			designs = designs.filter((design) => design.id !== designToDelete?.id);
			notify(m.image_editor_design_deleted(), 'success');
		} catch (cause) {
			notify(
				cause instanceof Error ? cause.message : m.image_editor_design_delete_failed(),
				'error'
			);
		} finally {
			designToDelete = null;
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
	{loading}
	loadingMessage={m.editors_loading()}
>
	{#snippet actions()}
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" onclick={() => goto(resolve('/video-editor'))}>
				<VideoIcon />
				{m.editors_new_video()}
			</Button>
			<Button
				onclick={() =>
					goto(resolve(`/image-editor/new?workspace=${encodeURIComponent(workspaceID)}` as '/'))}
			>
				<PlusIcon />
				{m.editors_new_design()}
			</Button>
		</div>
	{/snippet}

	{#if error}
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={initialize}>{m.editors_retry()}</Button>
			{/snippet}
		</InlineNotice>
	{/if}

	<div class="relative">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			bind:value={search}
			class="h-11 pl-9"
			placeholder={m.editors_search()}
			aria-label={m.editors_search()}
		/>
	</div>

	{#if loading}
		<PageLoading layout="gallery" label={m.editors_loading()} items={8} />
	{:else if filteredDesigns.length === 0 && filteredVideos.length === 0}
		<EmptyState
			icon={ClapperboardIcon}
			title={query ? m.editors_no_match() : m.editors_empty()}
			description={query ? m.editors_no_match_body() : m.editors_empty_body()}
			actionLabel={query ? undefined : m.editors_create_design()}
			onAction={() =>
				goto(resolve(`/image-editor/new?workspace=${encodeURIComponent(workspaceID)}` as '/'))}
			variant="dashed"
		/>
	{:else}
		<section class="space-y-3">
			<div>
				<h2 class="text-base font-semibold">{m.editors_image_designs()}</h2>
				<p class="text-sm text-muted-foreground">{m.editors_image_designs_body()}</p>
			</div>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				{#each filteredDesigns as design (design.id)}
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
									disabled={!canEdit}
									onclick={() => duplicateDesign(design)}
								>
									<CopyIcon class="size-4" />
									{m.image_editor_duplicate_design()}
								</ContextMenu.Item>
								<ContextMenu.Item
									class={contextItemClass}
									disabled={!canEdit}
									onclick={() => toggleFavorite(design)}
								>
									<HeartIcon class="size-4" fill={design.is_favorite ? 'currentColor' : 'none'} />
									{design.is_favorite ? m.media_unfavorite() : m.media_favorite()}
								</ContextMenu.Item>
								{#if canEdit}
									<ContextMenu.Separator class="my-1 h-px bg-border" />
									<ContextMenu.Item
										class="{contextItemClass} text-destructive data-highlighted:text-destructive"
										onclick={() => requestDelete(design)}
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
		</section>

		<section class="space-y-3 border-t pt-5">
			<div class="flex items-end justify-between gap-3">
				<div>
					<h2 class="text-base font-semibold">{m.editors_video_projects()}</h2>
					<p class="text-sm text-muted-foreground">{m.editors_video_projects_body()}</p>
				</div>
				<Button variant="ghost" size="sm" onclick={() => goto(resolve('/video-editor'))}
					>{m.editors_open_video()}</Button
				>
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{#each filteredVideos as project (project.id)}
					<a
						class="grid grid-cols-[5rem_minmax(0,1fr)] overflow-hidden rounded-xl border bg-card hover:border-foreground/25"
						href={resolve(`/video-editor?cloud=${encodeURIComponent(project.id)}` as '/')}
					>
						<div
							class="flex aspect-square items-center justify-center overflow-hidden bg-neutral-900"
						>
							{#if project.cover_preview_media_id}
								<img
									class="size-full object-cover"
									src={getAuthenticatedMediaURL(`/media/${project.cover_preview_media_id}`)}
									alt=""
								/>
							{:else}<VideoIcon class="size-7 text-neutral-500" />{/if}
						</div>
						<div class="min-w-0 p-3">
							<p class="truncate text-sm font-medium">{project.title}</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{Math.round(project.duration_ms / 1000)}s · {project.source_count === 1
									? m.editors_source_count_one({ count: project.source_count })
									: m.editors_source_count_many({ count: project.source_count })}
							</p>
							<p class="mt-2 text-xs text-muted-foreground">{formatDate(project.updated_at)}</p>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</PageContainer>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.image_editor_design_delete_title()}
	description={m.image_editor_design_delete_body()}
	onConfirm={confirmDelete}
/>

{#if toastMessage}
	<AppToast
		message={toastMessage}
		tone={toastTone}
		dismissLabel={m.common_dismiss()}
		onDismiss={() => (toastMessage = '')}
	/>
{/if}
