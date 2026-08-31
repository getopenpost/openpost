<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { MediaQuery } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import MediaTagFilter from '$lib/components/media-tag-filter.svelte';
	import MediaAcquisitionPanel from './media-acquisition-panel.svelte';
	import MemeGenerator from './meme-generator.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import type { MediaUploadResult } from '$lib/media-upload-client';
	import type { MediaPickerVideoSelection } from '$lib/media-picker';
	import { listImageEditorMedia } from '$lib/image-editor/api';
	import type { ImageEditorMediaItem } from '$lib/image-editor/types';
	import { listMediaTags, type MediaTag } from '$lib/media-tags';
	import { getLocaleTag } from '$lib/i18n';
	import { listMemeTemplates, memeGeneratorAPI } from '$lib/meme-generator/api';
	import type {
		MemeGeneratorAPI,
		MemeOverlaySelection,
		MemeRenderResult,
		MemeSuggestionCandidate
	} from '$lib/meme-generator/types';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import LibraryIcon from '@lucide/svelte/icons/library';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileAudioIcon from '@lucide/svelte/icons/file-audio';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import LaughIcon from '@lucide/svelte/icons/laugh';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import MoreHorizontalIcon from '@lucide/svelte/icons/ellipsis';
	import { m } from '$lib/paraglide/messages';
	import type { VideoConstraint } from '$lib/video/types';

	let {
		open = $bindable(false),
		workspaceId,
		currentSelection = [],
		currentMediaMimeTypes = {},
		accept = ['image/*', 'video/*'],
		maxSelection = 4,
		multiple = true,
		title = m.media_picker_add_media(),
		purpose = 'media_library',
		showCreate = true,
		compactNavigation = false,
		enableMeme = false,
		desktopSize = 'default',
		presentation = 'dialog',
		initialMode = 'library',
		memeInitialIdea = '',
		memeInitialCandidate,
		memeInitialPreview = '',
		initialFiles = [],
		autoConfirmUploads = false,
		videoConstraints = [],
		onConfirm,
		onInitialFilesConsumed,
		onCreate,
		onCreateVideo,
		services = {
			listMedia: listImageEditorMedia,
			listTags: listMediaTags,
			listTemplates: listMemeTemplates,
			memeAPI: memeGeneratorAPI
		}
	}: {
		open?: boolean;
		workspaceId: string;
		currentSelection?: string[];
		currentMediaMimeTypes?: Record<string, string>;
		accept?: string[];
		maxSelection?: number;
		multiple?: boolean;
		title?: string;
		purpose?: string;
		showCreate?: boolean;
		compactNavigation?: boolean;
		enableMeme?: boolean;
		desktopSize?: 'default' | 'compact';
		presentation?: 'dialog' | 'sheet';
		initialMode?: 'library' | 'upload' | 'stock' | 'meme';
		memeInitialIdea?: string;
		memeInitialCandidate?: MemeSuggestionCandidate;
		memeInitialPreview?: string;
		initialFiles?: File[];
		autoConfirmUploads?: boolean;
		videoConstraints?: VideoConstraint[];
		onConfirm: (
			mediaIDs: string[],
			media: ImageEditorMediaItem[]
		) => void | boolean | Promise<void | boolean>;
		onInitialFilesConsumed?: () => void;
		onCreate?: () => void | Promise<void>;
		onCreateVideo?: (media?: MediaPickerVideoSelection) => void | Promise<void>;
		services?: {
			listMedia: typeof listImageEditorMedia;
			listTags: typeof listMediaTags;
			listTemplates: typeof listMemeTemplates;
			memeAPI: MemeGeneratorAPI;
		};
	} = $props();

	let media = $state<ImageEditorMediaItem[]>([]);
	let selectedIDs = $state.raw<string[]>([]);
	let search = $state('');
	let loading = $state(true);
	let actionLoading = $state(false);
	let error = $state('');
	let loadedForWorkspace = $state('');
	let pickerMode = $state<'library' | 'device' | 'camera' | 'stock' | 'meme'>('library');
	let pendingInitialMeme = $state(false);
	let overlayPickerOpen = $state(false);
	let overlayPickerLoading = $state(false);
	let overlayPickerError = $state('');
	let overlayUploadOpen = $state(false);
	let overlaySearch = $state('');
	let overlayMedia = $state.raw<ImageEditorMediaItem[]>([]);
	let overlayCurrentID = $state('');
	let resolveOverlaySelection: ((selection: MemeOverlaySelection | null) => void) | undefined;
	let memeAvailability = $state<'idle' | 'checking' | 'available' | 'unavailable' | 'degraded'>(
		'idle'
	);
	let memeAvailabilityController: AbortController | undefined;
	let tags = $state<MediaTag[]>([]);
	let selectedTagIDs = $state.raw<string[]>([]);
	let showUntagged = $state(false);
	let mediaType = $state<'all' | 'image' | 'video' | 'audio'>('all');
	let sort = $state<'newest' | 'oldest' | 'name' | 'size' | 'recently_used'>('newest');
	const canUseCamera = $derived(mimeTypeAllowed('image'));
	const canUseStock = $derived(mimeTypeAllowed('image') || mimeTypeAllowed('video'));
	const canProbeMeme = $derived(enableMeme && mimeTypeAllowed('image'));
	const canUseMeme = $derived(
		canProbeMeme && (memeAvailability === 'available' || memeAvailability === 'degraded')
	);
	const desktopNavigation = new MediaQuery('min-width: 64rem');
	const useCompactNavigation = $derived(compactNavigation && !desktopNavigation.current);
	const filteredOverlayMedia = $derived.by(() => {
		const query = overlaySearch.trim().toLocaleLowerCase();
		if (!query) return overlayMedia;
		return overlayMedia.filter((item) =>
			`${item.original_filename} ${item.alt_text}`.toLocaleLowerCase().includes(query)
		);
	});
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
	const selectedVideoForEditing = $derived.by(() => {
		const selectedVideos = selectedIDs
			.map((id) => {
				const loaded = media.find((item) => item.id === id);
				if (loaded) return loaded;
				const mimeType = currentMediaMimeTypes[id] ?? '';
				if (!mimeType.startsWith('video/')) return undefined;
				return { id, mime_type: mimeType } satisfies MediaPickerVideoSelection;
			})
			.filter((item): item is MediaPickerVideoSelection =>
				Boolean(item?.mime_type.startsWith('video/'))
			);
		return selectedVideos.length === 1 ? selectedVideos[0] : undefined;
	});

	function initializePicker(): () => void {
		untrack(() => {
			selectedIDs = [...currentSelection];
			error = '';
			const requestedMode =
				initialFiles.length > 0 ? 'device' : initialMode === 'upload' ? 'device' : initialMode;
			pendingInitialMeme = requestedMode === 'meme' && !canUseMeme;
			pickerMode = pendingInitialMeme ? 'library' : requestedMode;
			if (loadedForWorkspace !== workspaceId) {
				selectedTagIDs = [];
				showUntagged = false;
				mediaType = 'all';
			}
			void Promise.all([loadMedia(), loadTags()]);
			void probeMemeAvailability();
		});
		return cancelMemeAvailabilityProbe;
	}

	function handleOpenChange(nextOpen: boolean): void {
		if (nextOpen) {
			initializePicker();
			return;
		}
		cancelMemeAvailabilityProbe();
		pendingInitialMeme = false;
		if (resolveOverlaySelection) settleOverlayPicker(null);
	}

	function selectPickerMode(nextMode: typeof pickerMode): void {
		pendingInitialMeme = false;
		pickerMode = nextMode;
		if (nextMode === 'library') void loadMedia();
	}

	async function probeMemeAvailability(): Promise<void> {
		cancelMemeAvailabilityProbe();
		if (!canProbeMeme || !workspaceId) {
			memeAvailability = 'unavailable';
			pendingInitialMeme = false;
			if (pickerMode === 'meme') pickerMode = 'library';
			return;
		}

		if (memeAvailability !== 'available' && memeAvailability !== 'degraded') {
			memeAvailability = 'checking';
		}
		const controller = new AbortController();
		memeAvailabilityController = controller;
		try {
			const result = await services.listTemplates({
				workspaceId,
				limit: 1,
				signal: controller.signal
			});
			if (controller.signal.aborted || memeAvailabilityController !== controller) return;
			memeAvailability = result.configured ? 'available' : 'unavailable';
			if (result.configured && pendingInitialMeme) pickerMode = 'meme';
			pendingInitialMeme = false;
			if (!result.configured && pickerMode === 'meme') pickerMode = 'library';
		} catch {
			if (controller.signal.aborted || memeAvailabilityController !== controller) return;
			memeAvailability = 'degraded';
			if (pendingInitialMeme) pickerMode = 'meme';
			pendingInitialMeme = false;
		} finally {
			if (memeAvailabilityController === controller) memeAvailabilityController = undefined;
		}
	}

	function cancelMemeAvailabilityProbe(): void {
		memeAvailabilityController?.abort();
		memeAvailabilityController = undefined;
	}

	async function loadTags(): Promise<void> {
		if (!workspaceId) return;
		try {
			const result = await services.listTags(workspaceId);
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
				await services.listMedia(workspaceId, search, requestedType, {
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
			const confirmed = await onConfirm(
				selectedIDs,
				selectedIDs
					.map((id) => media.find((item) => item.id === id))
					.filter((item): item is ImageEditorMediaItem => Boolean(item))
			);
			if (confirmed === false) {
				error = m.media_picker_add_failed();
				return;
			}
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
		const confirmed = await onConfirm(
			selectedIDs,
			selectedIDs
				.map((id) => media.find((item) => item.id === id))
				.filter((item): item is ImageEditorMediaItem => Boolean(item))
		);
		if (confirmed === false) {
			error = m.media_picker_add_failed();
			return;
		}
		open = false;
		return;
	}

	function memeMediaItem(result: MemeRenderResult['media']): ImageEditorMediaItem {
		return {
			id: result.id,
			workspace_id: workspaceId,
			mime_type: result.mime_type,
			size: result.size,
			original_filename: result.original_filename,
			width: 0,
			height: 0,
			alt_text: result.alt_text,
			is_favorite: false,
			created_at: new Date().toISOString(),
			url: result.url,
			thumbnail_url: result.url,
			usage_count: 0,
			can_delete: true,
			processing_status: result.processing_status,
			processing_progress: result.processing_progress,
			analysis_status: result.analysis_status,
			analysis_error: result.analysis_error,
			poster_thumbnail_url: result.poster_thumbnail_url,
			duration_ms: 0,
			frame_rate: 0,
			source: result.source,
			asset_kind: result.asset_kind,
			parent_media_id: result.parent_media_id,
			design_document_id: result.design_document_id,
			design_page_id: result.design_page_id,
			tags: []
		};
	}

	async function handleMemeAttached(result: MemeRenderResult): Promise<boolean> {
		const generated = memeMediaItem(result.media);
		if (multiple && selectedIDs.length >= maxSelection && !selectedIDs.includes(generated.id)) {
			error = m.media_picker_selection_limit({ maximum: maxSelection });
			return false;
		}
		const nextIDs = multiple
			? [...new Set([...selectedIDs, generated.id])].slice(0, maxSelection)
			: [generated.id];
		const selectedMedia = nextIDs
			.map((id) => (id === generated.id ? generated : media.find((item) => item.id === id)))
			.filter((item): item is ImageEditorMediaItem => Boolean(item));
		const confirmed = await onConfirm(nextIDs, selectedMedia);
		if (confirmed === false) return false;
		selectedIDs = nextIDs;
		open = false;
		void Promise.all([loadMedia(), loadTags()]);
		return true;
	}

	async function pickMemeOverlay(
		_index: number,
		current: MemeOverlaySelection | null
	): Promise<MemeOverlaySelection | null> {
		if (resolveOverlaySelection) settleOverlayPicker(null);
		overlayCurrentID = current?.media_id ?? '';
		overlaySearch = '';
		overlayPickerError = '';
		overlayUploadOpen = false;
		overlayPickerOpen = true;
		const selection = new Promise<MemeOverlaySelection | null>((resolveSelection) => {
			resolveOverlaySelection = resolveSelection;
		});
		void loadOverlayMedia();
		return selection;
	}

	async function loadOverlayMedia(): Promise<void> {
		overlayPickerLoading = true;
		overlayPickerError = '';
		try {
			overlayMedia = (
				await services.listMedia(workspaceId, '', 'image', {
					sort: 'recently_used'
				})
			).filter((item) => item.processing_status === 'ready' && item.analysis_status !== 'failed');
		} catch (cause) {
			overlayPickerError = cause instanceof Error ? cause.message : m.media_picker_load_failed();
		} finally {
			overlayPickerLoading = false;
		}
	}

	function showOverlayUpload(): void {
		overlayPickerError = '';
		overlayUploadOpen = true;
	}

	function showOverlayLibrary(): void {
		overlayUploadOpen = false;
		void loadOverlayMedia();
	}

	async function handleOverlayUploaded(results: MediaUploadResult[]): Promise<void> {
		const uploaded = results.at(-1);
		if (!uploaded) return;
		settleOverlaySelection({
			media_id: uploaded.id,
			preview_url: getAuthenticatedMediaURL(uploaded.url),
			name: uploaded.original_filename
		});
		void Promise.all([loadMedia(), loadTags()]);
	}

	function settleOverlayPicker(item: ImageEditorMediaItem | null): void {
		settleOverlaySelection(
			item
				? {
						media_id: item.id,
						preview_url: getAuthenticatedMediaURL(item.thumbnail_url || item.url),
						name: item.original_filename
					}
				: null
		);
	}

	function settleOverlaySelection(selection: MemeOverlaySelection | null): void {
		const resolveSelection = resolveOverlaySelection;
		resolveOverlaySelection = undefined;
		overlayUploadOpen = false;
		overlayPickerOpen = false;
		resolveSelection?.(selection);
	}

	function handleOverlayPickerOpenChange(nextOpen: boolean): void {
		if (nextOpen) {
			overlayPickerOpen = true;
			return;
		}
		settleOverlayPicker(null);
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
				resolveAppPath(
					`/image-editor/new?workspace=${encodeURIComponent(workspaceId)}&purpose=${encodeURIComponent(purpose)}`
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
			await onCreateVideo(selectedVideoForEditing);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_video_editor_failed();
		} finally {
			actionLoading = false;
		}
	}
</script>

{#snippet pickerBody()}
	<div
		class="flex shrink-0 items-center gap-1 border-b bg-muted/10 px-3 py-2 sm:px-4"
		aria-label={m.media_source()}
	>
		<div class="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist">
			<Button
				variant={pickerMode === 'library' ? 'secondary' : 'ghost'}
				size="sm"
				class="min-h-11 shrink-0 rounded-lg px-3 shadow-none sm:min-h-9"
				role="tab"
				aria-selected={pickerMode === 'library'}
				onclick={() => {
					selectPickerMode('library');
				}}
			>
				<LibraryIcon />
				{m.media_picker_library()}
			</Button>
			<Button
				variant={pickerMode === 'device' ? 'secondary' : 'ghost'}
				size="sm"
				class="min-h-11 shrink-0 rounded-lg px-3 shadow-none sm:min-h-9"
				role="tab"
				aria-selected={pickerMode === 'device'}
				disabled={actionLoading || selectedIDs.length >= maxSelection}
				onclick={() => selectPickerMode('device')}
			>
				<UploadIcon />
				{m.media_upload_device()}
			</Button>
			{#if !useCompactNavigation && canUseCamera}
				<Button
					variant={pickerMode === 'camera' ? 'secondary' : 'ghost'}
					size="sm"
					class="min-h-11 shrink-0 rounded-lg px-3 shadow-none sm:min-h-9"
					role="tab"
					aria-selected={pickerMode === 'camera'}
					disabled={actionLoading || selectedIDs.length >= maxSelection}
					onclick={() => selectPickerMode('camera')}
				>
					<CameraIcon />
					{m.media_camera()}
				</Button>
			{/if}
			{#if !useCompactNavigation && canUseStock}
				<Button
					variant={pickerMode === 'stock' ? 'secondary' : 'ghost'}
					size="sm"
					class="min-h-11 shrink-0 rounded-lg px-3 shadow-none sm:min-h-9"
					role="tab"
					aria-selected={pickerMode === 'stock'}
					disabled={actionLoading || selectedIDs.length >= maxSelection}
					onclick={() => selectPickerMode('stock')}
				>
					<ImageIcon />
					{m.stock_media()}
				</Button>
			{/if}
			{#if !useCompactNavigation && canUseMeme}
				<Button
					variant={pickerMode === 'meme' ? 'secondary' : 'ghost'}
					size="sm"
					class="min-h-11 shrink-0 rounded-lg px-3 shadow-none sm:min-h-9"
					role="tab"
					aria-selected={pickerMode === 'meme'}
					disabled={actionLoading || selectedIDs.length >= maxSelection}
					onclick={() => selectPickerMode('meme')}
				>
					<LaughIcon />
					{m.media_picker_meme()}
				</Button>
			{/if}
		</div>
		{#if !useCompactNavigation && showCreate}
			<Button
				variant="ghost"
				size="sm"
				class="min-h-11 shrink-0 rounded-lg px-3 shadow-none sm:min-h-9"
				disabled={actionLoading}
				onclick={createDesign}
			>
				<PaletteIcon />
				{m.media_picker_create()}
			</Button>
		{/if}
		{#if !useCompactNavigation && onCreateVideo}
			<Button
				variant="ghost"
				size="sm"
				class="min-h-11 shrink-0 rounded-lg px-3 shadow-none sm:min-h-9"
				disabled={actionLoading}
				onclick={createVideo}
			>
				<VideoIcon />
				{selectedVideoForEditing ? m.media_edit_video_editor() : m.media_picker_create_video()}
			</Button>
		{/if}
		{#if useCompactNavigation}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="icon"
							class="size-11 shrink-0 shadow-none sm:size-9"
							aria-label={m.sidebar_more()}
						>
							<MoreHorizontalIcon />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-56" align="end">
					{#if canUseCamera}
						<DropdownMenu.Item
							disabled={actionLoading || selectedIDs.length >= maxSelection}
							onclick={() => selectPickerMode('camera')}
						>
							<CameraIcon class="size-4" />
							{m.media_camera()}
						</DropdownMenu.Item>
					{/if}
					{#if canUseStock}
						<DropdownMenu.Item
							disabled={actionLoading || selectedIDs.length >= maxSelection}
							onclick={() => selectPickerMode('stock')}
						>
							<ImageIcon class="size-4" />
							{m.stock_media()}
						</DropdownMenu.Item>
					{/if}
					{#if canUseMeme}
						<DropdownMenu.Item
							disabled={actionLoading || selectedIDs.length >= maxSelection}
							onclick={() => selectPickerMode('meme')}
						>
							<LaughIcon class="size-4" />
							{m.media_picker_meme()}
						</DropdownMenu.Item>
					{/if}
					{#if (canUseCamera || canUseStock || canUseMeme) && (showCreate || onCreateVideo)}
						<DropdownMenu.Separator />
					{/if}
					{#if showCreate}
						<DropdownMenu.Item disabled={actionLoading} onclick={createDesign}>
							<PaletteIcon class="size-4" />
							{m.media_picker_create()}
						</DropdownMenu.Item>
					{/if}
					{#if onCreateVideo}
						<DropdownMenu.Item disabled={actionLoading} onclick={createVideo}>
							<VideoIcon class="size-4" />
							{selectedVideoForEditing
								? m.media_edit_video_editor()
								: m.media_picker_create_video()}
						</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
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
	{:else if pickerMode === 'meme'}
		<div class="meme-picker-body flex min-h-0 flex-1 overflow-hidden p-0">
			<MemeGenerator
				{workspaceId}
				api={services.memeAPI}
				language={getLocaleTag()}
				initialIdea={memeInitialIdea}
				initialCandidate={memeInitialCandidate}
				initialPreview={memeInitialPreview}
				onPickOverlay={pickMemeOverlay}
				onAttach={handleMemeAttached}
			/>
		</div>
	{:else}
		<div
			class="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-muted/5 to-transparent p-4 sm:p-5"
		>
			{#key pickerMode}
				<div transition:fade={{ duration: 150 }}>
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
				</div>
			{/key}
		</div>
	{/if}
{/snippet}

{#if presentation === 'sheet'}
	<Sheet.Root bind:open onOpenChange={handleOpenChange}>
		<Sheet.Content
			side="right"
			class="flex h-dvh w-full flex-col gap-0 p-0 {pickerMode === 'meme'
				? 'sm:max-w-[90rem]!'
				: 'sm:max-w-2xl'}"
		>
			<div class="media-picker-initializer contents" {@attach initializePicker}></div>
			<Sheet.Header class="border-b px-4 py-3 pr-14 text-left">
				<Sheet.Title>{pickerMode === 'meme' ? m.meme_generator_title() : title}</Sheet.Title>
				<Sheet.Description>
					{pickerMode === 'meme'
						? m.meme_generator_description()
						: m.media_picker_selected_count({
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
			class="top-0 left-0 flex h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl {pickerMode ===
			'meme'
				? 'meme-picker-workbench overflow-hidden sm:w-[min(96vw,90rem)] sm:max-w-[90rem]'
				: desktopSize === 'compact'
					? 'sm:h-[min(640px,calc(100dvh-2rem))] sm:max-w-3xl'
					: 'sm:h-[min(760px,calc(100dvh-2rem))] sm:max-w-5xl'}"
		>
			<div class="media-picker-initializer contents" {@attach initializePicker}></div>
			<Dialog.Header class="border-b px-4 py-3 pr-14">
				<Dialog.Title>{pickerMode === 'meme' ? m.meme_generator_title() : title}</Dialog.Title>
				<Dialog.Description>
					{pickerMode === 'meme'
						? m.meme_generator_description()
						: m.media_picker_selected_count({
								selected: selectedIDs.length,
								maximum: maxSelection
							})}
				</Dialog.Description>
			</Dialog.Header>
			{@render pickerBody()}
		</Dialog.Content>
	</Dialog.Root>
{/if}

<Dialog.Root bind:open={overlayPickerOpen} onOpenChange={handleOverlayPickerOpenChange}>
	<Dialog.Content class="flex max-h-[min(42rem,calc(100dvh-2rem))] max-w-2xl flex-col gap-0 p-0">
		<Dialog.Header class="border-b px-4 py-3 pr-14 text-left">
			<Dialog.Title>{m.meme_generator_image_slots_heading()}</Dialog.Title>
			<Dialog.Description>{m.meme_generator_choose_overlay_description()}</Dialog.Description>
		</Dialog.Header>
		<div class="min-h-0 flex-1 overflow-y-auto p-4">
			{#if !overlayUploadOpen && overlayPickerError}
				<div
					class="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
					role="alert"
				>
					{overlayPickerError}
				</div>
			{/if}
			{#if overlayUploadOpen}
				<MediaAcquisitionPanel
					mode="device"
					{workspaceId}
					accept={['image/*']}
					maxFiles={1}
					retentionClass="library"
					onUploaded={handleOverlayUploaded}
				/>
			{:else}
				<div class="relative mb-3">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						bind:value={overlaySearch}
						class="pl-9"
						placeholder={m.media_picker_search()}
						aria-label={m.media_picker_search()}
					/>
				</div>
				{#if overlayPickerLoading}
					<div class="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
						<LoaderIcon class="mr-2 size-5 animate-spin motion-reduce:animate-none" />
						{m.media_picker_loading()}
					</div>
				{:else if filteredOverlayMedia.length === 0}
					<div
						class="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed px-4 text-center"
					>
						<ImageIcon class="mb-3 size-8 text-muted-foreground" />
						<p class="font-medium">{m.media_picker_no_match()}</p>
						<p class="mt-1 text-sm text-muted-foreground">
							{m.meme_generator_overlay_empty()}
						</p>
						<Button class="mt-4" variant="outline" onclick={showOverlayUpload}>
							<UploadIcon />
							{m.media_upload_device()}
						</Button>
					</div>
				{:else}
					<div class="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
						{#each filteredOverlayMedia as item (item.id)}
							<Button
								variant="ghost"
								class="group relative aspect-square h-auto min-w-0 overflow-hidden rounded-lg border bg-muted p-0 {overlayCurrentID ===
								item.id
									? 'ring-2 ring-primary'
									: ''}"
								onclick={() => settleOverlayPicker(item)}
								aria-label={m.media_picker_select_item({ name: item.original_filename })}
							>
								<img
									src={getAuthenticatedMediaURL(item.thumbnail_url || item.url)}
									alt={item.alt_text || item.original_filename}
									class="size-full object-cover transition-transform group-hover:scale-[1.02]"
									loading="lazy"
								/>
								{#if overlayCurrentID === item.id}
									<span
										class="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground"
									>
										<CheckIcon class="size-4" />
									</span>
								{/if}
							</Button>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
		<Dialog.Footer class="flex-row justify-between border-t px-4 py-3 sm:justify-between">
			<Button
				variant="outline"
				onclick={overlayUploadOpen ? showOverlayLibrary : showOverlayUpload}
			>
				{#if overlayUploadOpen}<LibraryIcon />{:else}<UploadIcon />{/if}
				{overlayUploadOpen ? m.media_picker_library() : m.media_upload_device()}
			</Button>
			<Button variant="ghost" onclick={() => settleOverlayPicker(null)}>{m.common_cancel()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	:global([data-slot='dialog-content'].meme-picker-workbench) {
		display: grid;
		height: 100dvh;
		max-height: 100dvh;
		grid-template-rows: auto auto minmax(0, 1fr);
		overflow: hidden;
	}

	:global([data-slot='dialog-content'].meme-picker-workbench > [data-slot='dialog-close']) {
		position: absolute;
	}

	.media-picker-initializer {
		display: contents;
	}

	.meme-picker-body {
		display: flex;
		min-height: 0;
		overflow: hidden;
	}

	@media (min-width: 40rem) {
		:global(.meme-picker-workbench) {
			height: min(56.25rem, calc(100dvh - 2rem));
			max-height: min(56.25rem, calc(100dvh - 2rem));
		}
	}
</style>
