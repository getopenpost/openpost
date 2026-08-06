<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import MediaTagFilter from '$lib/components/media-tag-filter.svelte';
	import MediaAcquisitionPanel from './media-acquisition-panel.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import type { MediaUploadResult } from '$lib/media-upload-client';
	import { listImageEditorMedia } from '$lib/image-editor/api';
	import type { ImageEditorMediaItem } from '$lib/image-editor/types';
	import { listMediaTags, type MediaTag } from '$lib/media-tags';
	import SearchIcon from 'lucide-svelte/icons/search';
	import UploadIcon from 'lucide-svelte/icons/upload';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import LibraryIcon from 'lucide-svelte/icons/library';
	import ImageIcon from 'lucide-svelte/icons/image';
	import VideoIcon from 'lucide-svelte/icons/video';
	import FileAudioIcon from 'lucide-svelte/icons/file-audio';
	import PaletteIcon from 'lucide-svelte/icons/palette';
	import CheckIcon from 'lucide-svelte/icons/check';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';
	import type { VideoConstraint } from '$lib/video/types';

	let {
		open = $bindable(false),
		workspaceId,
		currentSelection = [],
		accept = ['image/*', 'video/*'],
		maxSelection = 4,
		multiple = true,
		title = m.media_picker_add_media(),
		purpose = 'media_library',
		showCreate = true,
		desktopSize = 'default',
		presentation = 'dialog',
		initialMode = 'library',
		initialFiles = [],
		autoConfirmUploads = false,
		videoConstraints = [],
		onConfirm,
		onInitialFilesConsumed,
		onCreate,
		onCreateVideo
	}: {
		open?: boolean;
		workspaceId: string;
		currentSelection?: string[];
		accept?: string[];
		maxSelection?: number;
		multiple?: boolean;
		title?: string;
		purpose?: string;
		showCreate?: boolean;
		desktopSize?: 'default' | 'compact';
		presentation?: 'dialog' | 'sheet';
		initialMode?: 'library' | 'upload' | 'stock';
		initialFiles?: File[];
		autoConfirmUploads?: boolean;
		videoConstraints?: VideoConstraint[];
		onConfirm: (mediaIDs: string[], media: ImageEditorMediaItem[]) => void | Promise<void>;
		onInitialFilesConsumed?: () => void;
		onCreate?: () => void | Promise<void>;
		onCreateVideo?: () => void | Promise<void>;
	} = $props();

	let media = $state<ImageEditorMediaItem[]>([]);
	let selectedIDs = $state.raw<string[]>([]);
	let search = $state('');
	let loading = $state(true);
	let actionLoading = $state(false);
	let error = $state('');
	let loadedForWorkspace = $state('');
	let pickerMode = $state<'library' | 'device' | 'camera' | 'stock'>('library');
	let tags = $state<MediaTag[]>([]);
	let selectedTagIDs = $state.raw<string[]>([]);
	let showUntagged = $state(false);
	let mediaType = $state<'all' | 'image' | 'video' | 'audio'>('all');
	let sort = $state<'newest' | 'oldest' | 'name' | 'size' | 'recently_used'>('newest');
	const canUseCamera = $derived(mimeTypeAllowed('image'));
	const canUseStock = $derived(mimeTypeAllowed('image') || mimeTypeAllowed('video'));
	const typeFilters = $derived(
		[
			{ value: 'image' as const, label: m.media_images(), allowed: mimeTypeAllowed('image') },
			{ value: 'video' as const, label: m.media_videos(), allowed: mimeTypeAllowed('video') },
			{ value: 'audio' as const, label: m.media_audio(), allowed: mimeTypeAllowed('audio') }
		].filter((item) => item.allowed)
	);
	const emptyTitle = $derived(search.trim() ? m.media_picker_no_match() : m.media_empty_title());
	const emptyBody = $derived(
		search.trim()
			? m.media_picker_no_match_body()
			: selectedTagIDs.length > 0 || showUntagged || mediaType !== 'all'
				? m.media_empty_filtered_body()
				: m.media_empty_library_body()
	);

	function initializePicker() {
		untrack(() => {
			selectedIDs = [...currentSelection];
			error = '';
			pickerMode =
				initialFiles.length > 0 ? 'device' : initialMode === 'upload' ? 'device' : initialMode;
			if (loadedForWorkspace !== workspaceId) {
				selectedTagIDs = [];
				showUntagged = false;
				mediaType = 'all';
			}
			void Promise.all([loadMedia(), loadTags()]);
		});
	}

	function handleOpenChange(nextOpen: boolean): void {
		if (nextOpen) initializePicker();
	}

	async function loadTags(): Promise<void> {
		if (!workspaceId) return;
		try {
			const result = await listMediaTags(workspaceId);
			tags = result.tags;
			const validIDs = new Set(result.tags.map((tag) => tag.id));
			const nextSelected = selectedTagIDs.filter((id) => validIDs.has(id));
			if (nextSelected.length !== selectedTagIDs.length) {
				selectedTagIDs = nextSelected;
				void loadMedia();
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_load_failed();
		}
	}

	function changeTagFilters(tagIDs: string[], untagged: boolean): void {
		selectedTagIDs = tagIDs;
		showUntagged = untagged;
		void loadMedia();
	}

	function uploadTagID(): string | undefined {
		if (!showUntagged && selectedTagIDs.length === 1) return selectedTagIDs[0];
		return undefined;
	}

	async function loadMedia(): Promise<void> {
		if (!workspaceId) return;
		loading = true;
		error = '';
		try {
			const allowsImages = accept.some((mime) => mime === 'image/*' || mime.startsWith('image/'));
			const allowsVideos = accept.some((mime) => mime === 'video/*' || mime.startsWith('video/'));
			const allowsAudio = accept.some((mime) => mime === 'audio/*' || mime.startsWith('audio/'));
			const allowedTypeCount = [allowsImages, allowsVideos, allowsAudio].filter(Boolean).length;
			const requestedType =
				mediaType !== 'all'
					? mediaType
					: allowedTypeCount !== 1
						? 'all'
						: allowsVideos
							? 'video'
							: allowsAudio
								? 'audio'
								: 'image';
			media = (
				await listImageEditorMedia(workspaceId, search, requestedType, {
					tagIds: selectedTagIDs,
					untagged: showUntagged,
					sort
				})
			).filter((item) => mimeAllowed(item.mime_type));
			loadedForWorkspace = workspaceId;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_load_failed();
		} finally {
			loading = false;
		}
	}

	function mimeAllowed(mime: string): boolean {
		return accept.some((accepted) =>
			accepted.endsWith('/*') ? mime.startsWith(accepted.slice(0, -1)) : mime === accepted
		);
	}

	function mimeTypeAllowed(type: 'image' | 'video' | 'audio'): boolean {
		return accept.some((accepted) => accepted === `${type}/*` || accepted.startsWith(`${type}/`));
	}

	function toggleMedia(id: string): void {
		const candidate = media.find((item) => item.id === id);
		if (
			candidate?.mime_type.startsWith('video/') &&
			(candidate.processing_status !== 'ready' || candidate.analysis_status !== 'ready')
		) {
			error =
				candidate.analysis_error ||
				(candidate.analysis_status === 'failed'
					? m.media_video_processing_failed()
					: m.video_upload_processing());
			return;
		}
		if (selectedIDs.includes(id)) {
			selectedIDs = selectedIDs.filter((item) => item !== id);
			return;
		}
		if (!multiple) {
			selectedIDs = [id];
			return;
		}
		if (selectedIDs.length >= maxSelection) {
			error = m.media_picker_selection_limit({ maximum: maxSelection });
			return;
		}
		selectedIDs = [...selectedIDs, id];
	}

	async function confirm(): Promise<void> {
		actionLoading = true;
		error = '';
		try {
			await onConfirm(
				selectedIDs,
				selectedIDs
					.map((id) => media.find((item) => item.id === id))
					.filter((item): item is ImageEditorMediaItem => Boolean(item))
			);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_add_failed();
		} finally {
			actionLoading = false;
		}
	}

	async function handleUploaded(results: MediaUploadResult[]): Promise<void> {
		await Promise.all([loadMedia(), loadTags()]);
		const uploadedIDs = results.map((item) => item.id).filter(Boolean);
		selectedIDs = multiple
			? [...new Set([...selectedIDs, ...uploadedIDs])].slice(0, maxSelection)
			: uploadedIDs.slice(0, 1);
		if (!autoConfirmUploads) {
			return;
		}
		await onConfirm(
			selectedIDs,
			selectedIDs
				.map((id) => media.find((item) => item.id === id))
				.filter((item): item is ImageEditorMediaItem => Boolean(item))
		);
		open = false;
		return;
	}

	async function createDesign(): Promise<void> {
		actionLoading = true;
		error = '';
		try {
			if (onCreate) {
				await onCreate();
				open = false;
				return;
			}
			await goto(
				resolve(
					`/image-editor/new?workspace=${encodeURIComponent(workspaceId)}&purpose=${encodeURIComponent(purpose)}` as '/'
				)
			);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_image_editor_failed();
		} finally {
			actionLoading = false;
		}
	}

	async function createVideo(): Promise<void> {
		if (!onCreateVideo || actionLoading) return;
		actionLoading = true;
		error = '';
		try {
			await onCreateVideo();
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_video_editor_failed();
		} finally {
			actionLoading = false;
		}
	}
</script>

{#snippet pickerBody()}
	<div class="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2" aria-label={m.media_source()}>
		<Button
			variant={pickerMode === 'library' ? 'secondary' : 'ghost'}
			size="sm"
			class="min-h-11 shrink-0 sm:min-h-9"
			onclick={() => {
				pickerMode = 'library';
				void loadMedia();
			}}
		>
			<LibraryIcon />
			{m.media_picker_library()}
		</Button>
		<Button
			variant={pickerMode === 'device' ? 'secondary' : 'ghost'}
			size="sm"
			class="min-h-11 shrink-0 sm:min-h-9"
			disabled={actionLoading || selectedIDs.length >= maxSelection}
			onclick={() => (pickerMode = 'device')}
		>
			<UploadIcon />
			{m.media_upload_device()}
		</Button>
		{#if canUseCamera}
			<Button
				variant={pickerMode === 'camera' ? 'secondary' : 'ghost'}
				size="sm"
				class="min-h-11 shrink-0 sm:min-h-9"
				disabled={actionLoading || selectedIDs.length >= maxSelection}
				onclick={() => (pickerMode = 'camera')}
			>
				<CameraIcon />
				{m.media_camera()}
			</Button>
		{/if}
		{#if canUseStock}
			<Button
				variant={pickerMode === 'stock' ? 'secondary' : 'ghost'}
				size="sm"
				class="min-h-11 shrink-0 sm:min-h-9"
				disabled={actionLoading || selectedIDs.length >= maxSelection}
				onclick={() => (pickerMode = 'stock')}
			>
				<ImageIcon />
				{m.video_editor_stock()}
			</Button>
		{/if}
		{#if showCreate}
			<Button
				variant="ghost"
				size="sm"
				class="min-h-11 shrink-0 sm:min-h-9"
				disabled={actionLoading}
				onclick={createDesign}
			>
				<PaletteIcon />
				{m.media_picker_create()}
			</Button>
		{/if}
		{#if onCreateVideo}
			<Button
				variant="ghost"
				size="sm"
				class="min-h-11 shrink-0 sm:min-h-9"
				disabled={actionLoading}
				onclick={createVideo}
			>
				<VideoIcon />
				{m.media_picker_create_video()}
			</Button>
		{/if}
	</div>

	{#if pickerMode === 'library'}
		<div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
			{#if typeFilters.length > 1}
				<div class="mb-2 flex min-w-0 gap-1 overflow-x-auto" aria-label={m.media_type()}>
					{#each [{ value: 'all' as const, label: m.media_all_types() }, ...typeFilters] as typeFilter (typeFilter.value)}
						<Button
							variant={mediaType === typeFilter.value ? 'secondary' : 'ghost'}
							size="sm"
							class="min-w-11 shrink-0 rounded-full"
							onclick={() => {
								mediaType = typeFilter.value;
								void loadMedia();
							}}
						>
							{typeFilter.label}
						</Button>
					{/each}
				</div>
			{/if}
			<div class="mb-3 overflow-x-auto pb-1">
				<MediaTagFilter
					{tags}
					selectedIds={selectedTagIDs}
					untagged={showUntagged}
					onChange={changeTagFilters}
				/>
			</div>
			<form
				class="mb-3 flex flex-wrap gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void loadMedia();
				}}
			>
				<div class="relative min-w-48 flex-1">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input bind:value={search} class="pl-9" placeholder={m.media_picker_search()} />
				</div>
				<AppSelect
					value={sort}
					onValueChange={(value) => {
						sort = value as typeof sort;
						void loadMedia();
					}}
					options={[
						{ value: 'newest', label: m.media_sort_newest() },
						{ value: 'oldest', label: m.media_sort_oldest() },
						{ value: 'name', label: m.media_sort_name() },
						{ value: 'size', label: m.media_sort_size() },
						{ value: 'recently_used', label: m.media_recently_used() }
					]}
					class="h-10 w-36"
				/>
				<Button
					variant="outline"
					type="submit"
					size="icon"
					aria-label={m.media_picker_search_action()}
				>
					{#if loading}<LoaderIcon class="animate-spin" />{:else}<SearchIcon />{/if}
				</Button>
			</form>
			{#if loading && media.length === 0}
				<div class="flex min-h-48 items-center justify-center text-muted-foreground">
					<LoaderIcon class="mr-2 size-5 animate-spin" />
					{m.media_picker_loading()}
				</div>
			{:else if media.length === 0}
				<div
					class="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed px-4 text-center"
				>
					<ImageIcon class="mb-3 size-8 text-muted-foreground" />
					<p class="font-medium">{emptyTitle}</p>
					<p class="mt-1 text-sm text-muted-foreground">{emptyBody}</p>
				</div>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
					{#each media as item (item.id)}
						<button
							type="button"
							class="group relative aspect-square overflow-hidden rounded-lg border bg-muted text-left focus-visible:ring-2 focus-visible:ring-ring {selectedIDs.includes(
								item.id
							)
								? 'ring-2 ring-primary'
								: ''}"
							onclick={() => toggleMedia(item.id)}
							aria-pressed={selectedIDs.includes(item.id)}
							aria-label={m.media_picker_select_item({ name: item.original_filename })}
						>
							{#if item.mime_type.startsWith('video/')}
								{#if item.thumbnail_url || item.poster_thumbnail_url}
									<img
										src={getAuthenticatedMediaURL(
											item.thumbnail_url || item.poster_thumbnail_url || ''
										)}
										alt={item.alt_text || item.original_filename}
										class="size-full object-cover transition-transform group-hover:scale-[1.02]"
										loading="lazy"
									/>
								{:else}
									<div class="flex size-full items-center justify-center">
										{#if item.processing_status === 'processing'}
											<LoaderIcon class="size-6 animate-spin text-muted-foreground" />
										{:else}
											<VideoIcon class="size-7 text-muted-foreground" />
										{/if}
									</div>
								{/if}
								<span
									class="absolute bottom-2 left-2 flex size-7 items-center justify-center rounded-full bg-background/90 shadow-sm"
								>
									<VideoIcon class="size-3.5" />
								</span>
							{:else if item.mime_type.startsWith('image/')}
								<img
									src={getAuthenticatedMediaURL(item.thumbnail_url || item.url)}
									alt={item.alt_text || item.original_filename}
									class="size-full object-cover transition-transform group-hover:scale-[1.02]"
									loading="lazy"
								/>
							{:else}
								<div class="flex size-full flex-col items-center justify-center gap-2 p-2">
									<FileAudioIcon class="size-7 text-muted-foreground" />
									<span class="line-clamp-2 text-center text-xs text-muted-foreground">
										{item.original_filename}
									</span>
								</div>
							{/if}
							{#if selectedIDs.includes(item.id)}
								<span
									class="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
								>
									<CheckIcon class="size-4" />
								</span>
								<span
									class="absolute right-2 bottom-2 rounded bg-background/90 px-2 py-1 text-xs font-medium"
								>
									{selectedIDs.indexOf(item.id) + 1}
								</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		{#if error}
			<div
				class="mx-4 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				{error}
			</div>
		{/if}
		<div class="flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end">
			<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
			<Button onclick={confirm} disabled={actionLoading || selectedIDs.length === 0}>
				{#if actionLoading}<LoaderIcon class="animate-spin" />{/if}
				{m.media_picker_add_media()}
			</Button>
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
			{#key pickerMode}
				<MediaAcquisitionPanel
					mode={pickerMode}
					{workspaceId}
					{accept}
					maxFiles={Math.max(1, maxSelection - selectedIDs.length)}
					retentionClass={purpose === 'media_library' ? 'library' : 'temporary'}
					tagId={uploadTagID()}
					{videoConstraints}
					{initialFiles}
					{onInitialFilesConsumed}
					onUploaded={handleUploaded}
				/>
			{/key}
		</div>
	{/if}
{/snippet}

{#if presentation === 'sheet'}
	<Sheet.Root bind:open onOpenChange={handleOpenChange}>
		<Sheet.Content side="right" class="flex h-dvh w-full flex-col gap-0 p-0 sm:max-w-2xl">
			<div class="contents" {@attach initializePicker}></div>
			<Sheet.Header class="border-b px-4 py-3 pr-14 text-left">
				<Sheet.Title>{title}</Sheet.Title>
				<Sheet.Description>
					{m.media_picker_selected_count({
						selected: selectedIDs.length,
						maximum: maxSelection
					})}
				</Sheet.Description>
			</Sheet.Header>
			{@render pickerBody()}
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<Dialog.Root bind:open onOpenChange={handleOpenChange}>
		<Dialog.Content
			class="top-0 left-0 flex h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl {desktopSize ===
			'compact'
				? 'sm:h-[min(640px,calc(100dvh-2rem))] sm:max-w-3xl'
				: 'sm:h-[min(760px,calc(100dvh-2rem))] sm:max-w-5xl'}"
		>
			<div class="contents" {@attach initializePicker}></div>
			<Dialog.Header class="border-b px-4 py-3 pr-14">
				<Dialog.Title>{title}</Dialog.Title>
				<Dialog.Description>
					{m.media_picker_selected_count({
						selected: selectedIDs.length,
						maximum: maxSelection
					})}
				</Dialog.Description>
			</Dialog.Header>
			{@render pickerBody()}
		</Dialog.Content>
	</Dialog.Root>
{/if}
