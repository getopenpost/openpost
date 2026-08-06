<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { ContextMenu } from 'bits-ui';
	import { page } from '$app/stores';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { client, type Workspace } from '$lib/api/client';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { isSupportedMediaFile, uploadMediaFile } from '$lib/media-upload-client';
	import type { VideoPreparationProgress, VideoPreparationStage } from '$lib/video/types';
	import { videoPreparationErrorMessage } from '$lib/video/errors';
	import { loadImageEditorConfig } from '$lib/image-editor/api';
	import { loadVideoEditorConfig } from '$lib/video-editor/api';
	import { clampMediaPage } from '$lib/media-pagination';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import PageContainer from '$lib/components/page-container.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import AppToast from '$lib/components/app-toast.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import CameraCapture from '$lib/components/camera-capture.svelte';
	import AppSelect from '$lib/components/app-select.svelte';
	import MediaOrganizationDialog from '$lib/components/media-organization-dialog.svelte';
	import MediaTagFilter from '$lib/components/media-tag-filter.svelte';
	import MediaTagPicker from '$lib/components/media-tag-picker.svelte';
	import VideoEditorDialog from '$lib/components/video-editor-dialog.svelte';
	import {
		createMediaTag,
		listMediaTags,
		updateMediaTagItems,
		type MediaTag
	} from '$lib/media-tags';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import ImageIcon from 'lucide-svelte/icons/image';
	import VideoIcon from 'lucide-svelte/icons/video';
	import HeartIcon from 'lucide-svelte/icons/heart';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import UploadIcon from 'lucide-svelte/icons/upload';
	import DownloadIcon from 'lucide-svelte/icons/download';
	import ExternalLinkIcon from 'lucide-svelte/icons/external-link';
	import CheckIcon from 'lucide-svelte/icons/check';
	import ChevronLeftIcon from 'lucide-svelte/icons/chevron-left';
	import ChevronRightIcon from 'lucide-svelte/icons/chevron-right';
	import Grid2X2Icon from 'lucide-svelte/icons/grid-2x2';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import PaletteIcon from 'lucide-svelte/icons/palette';
	import SearchIcon from 'lucide-svelte/icons/search';
	import TagIcon from 'lucide-svelte/icons/tag';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import ListIcon from 'lucide-svelte/icons/list';
	import SlidersHorizontalIcon from 'lucide-svelte/icons/sliders-horizontal';
	import FileAudioIcon from 'lucide-svelte/icons/file-audio';
	import XIcon from 'lucide-svelte/icons/x';
	import RotateCcwIcon from 'lucide-svelte/icons/rotate-ccw';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';

	interface MediaItem {
		id: string;
		workspace_id: string;
		mime_type: string;
		size: number;
		original_filename: string;
		width: number;
		height: number;
		alt_text: string;
		is_favorite: boolean;
		created_at: string;
		url: string;
		thumbnail_url: string;
		usage_count: number;
		can_delete: boolean;
		processing_status: string;
		processing_progress: number;
		analysis_status: string;
		analysis_error?: string;
		poster_thumbnail_url?: string;
		duration_ms: number;
		frame_rate: number;
		container_format?: string;
		video_codec?: string;
		video_profile?: string;
		audio_codec?: string;
		source: string;
		asset_kind: string;
		parent_media_id?: string;
		design_document_id?: string;
		design_page_id?: string;
		tags: string[];
		retention_class: 'library' | 'temporary';
		last_used_at?: string;
		trashed_at?: string;
		purge_after?: string;
		trash_reason?: 'manual' | 'published' | 'expired';
	}

	interface MediaUsage {
		kind: string;
		id: string;
		label: string;
		post_id: string;
		content: string;
		status: string;
		scheduled_at: string;
	}

	interface BatchDeleteResult {
		deleted: number;
		failed_ids: string[];
	}

	type LibraryDeletionRequest =
		{ kind: 'single'; media: MediaItem } | { kind: 'batch'; ids: string[] };

	let workspaces = $derived<Workspace[]>(workspaceCtx.workspaces);
	let selectedWorkspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let loading = $state(true);
	let error = $state('');
	let toastMessage = $state('');
	let toastTone = $state<'neutral' | 'success' | 'error'>('neutral');

	let mediaItems = $state<MediaItem[]>([]);
	let mediaLoading = $state(false);
	let mediaRequestSequence = 0;
	let totalCount = $state(0);
	let currentPage = $state(0);
	const pageSize = 40;

	let filter = $state<string>('all');
	let lifecycleView = $state<'library' | 'temporary' | 'trash'>('library');
	let sort = $state<string>('newest');
	let search = $state('');
	let mediaType = $state('all');
	let source = $state('all');
	let selectedTagIDs = $state.raw<string[]>([]);
	let showUntagged = $state(false);
	let aspect = $state('all');
	let minWidth = $state(0);
	let minHeight = $state(0);
	let maxWidth = $state(0);
	let maxHeight = $state(0);
	let dateFrom = $state('');
	let dateTo = $state('');
	let layoutMode = $state<'grid' | 'list'>('grid');
	let videoEditorEnabled = $state(false);
	let tags = $state<MediaTag[]>([]);
	let hubLoading = $state(false);
	let cameraDialogOpen = $state(false);
	let cameraUploading = $state(false);
	let organizationDialogOpen = $state(false);
	let filterDialogOpen = $state(false);
	let selectionOrganizationDialogOpen = $state(false);
	let batchTagID = $state('');
	let organizationSaving = $state(false);
	let storageUsage = $state({ used_bytes: 0, asset_count: 0, internal_bytes: 0, limit_bytes: 0 });
	let imageEditorEnabled = $state(true);
	let mediaCanEdit = $state(false);

	let uploadDialogOpen = $state(false);
	let uploadLoading = $state(false);
	let uploadDragging = $state(false);
	let uploadError = $state('');
	let uploadFiles = $state.raw<File[]>([]);
	let uploadProgress = $state.raw<VideoPreparationProgress | null>(null);
	let uploadController: AbortController | null = null;
	let uploadInput: HTMLInputElement | null = null;
	let uploadVideoEditorOpen = $state(false);
	let uploadVideoEditorFile = $state<File | null>(null);

	let usageDialogOpen = $state(false);
	let selectedMedia = $state<MediaItem | null>(null);
	let mediaUsage = $state<MediaUsage[]>([]);
	let usageLoading = $state(false);
	let usageError = $state('');
	let usageRequestSequence = 0;
	let detailAltText = $state('');
	let detailSaving = $state(false);

	let deleteDialogOpen = $state(false);
	let deletionRequest = $state.raw<LibraryDeletionRequest | null>(null);

	const selectedMediaIds = new SvelteSet<string>();
	let isSelectionMode = $state(false);
	const libraryContextContentClass =
		'z-50 min-w-52 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none';
	const libraryContextItemClass =
		'flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45';

	function notify(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral') {
		toastMessage = message;
		toastTone = tone;
	}

	function selectedCountLabel(count: number) {
		return count === 1 ? m.media_selected_one() : m.media_selected_many({ count });
	}

	function deletedCountLabel(count: number) {
		return count === 1 ? m.media_deleted_one() : m.media_deleted_many({ count });
	}

	function uploadedCountLabel(count: number) {
		return count === 1 ? m.media_uploaded_one() : m.media_uploaded_many({ count });
	}

	function deletionTitle(request: LibraryDeletionRequest | null) {
		if (request?.kind === 'batch') return m.media_delete_batch_title();
		return m.media_delete_title();
	}

	function deletionDescription(request: LibraryDeletionRequest | null) {
		if (request?.kind === 'batch') {
			return request.ids.length === 1
				? m.media_delete_batch_body_one()
				: m.media_delete_batch_body_many({ count: request.ids.length });
		}
		return m.media_delete_body();
	}

	function usageSummaryLabel(count: number) {
		return count === 1 ? m.media_usage_summary_one() : m.media_usage_summary_many({ count });
	}

	function mediaUsageStatusLabel(status: string) {
		switch (status.toLowerCase()) {
			case 'published':
			case 'success':
				return m.activity_status_published();
			case 'failed':
				return m.activity_status_failed();
			case 'scheduled':
				return m.activity_status_scheduled();
			case 'publishing':
				return m.activity_status_publishing();
			case 'completed':
				return m.activity_status_completed();
			case 'processing':
				return m.activity_status_processing();
			case 'pending':
				return m.activity_status_pending();
			case 'draft':
				return m.activity_status_draft();
			default:
				return status;
		}
	}

	function mediaViewKey() {
		return `${selectedWorkspaceId}:${lifecycleView}:${filter}:${sort}:${search}:${mediaType}:${source}:${selectedTagIDs.join(',')}:${showUntagged}:${aspect}:${minWidth}:${minHeight}:${maxWidth}:${maxHeight}:${dateFrom}:${dateTo}:${currentPage}`;
	}

	async function loadWorkspaces() {
		try {
			if (workspaceCtx.workspaces.length === 0 || !workspaceCtx.currentWorkspace) {
				await workspaceCtx.initialize();
			}
		} catch (e) {
			console.error('Failed to load workspaces:', e);
			error = m.media_load_failed();
		} finally {
			loading = false;
		}
	}

	async function loadMedia(workspaceID = selectedWorkspaceId) {
		if (!workspaceID) {
			mediaRequestSequence++;
			mediaLoading = false;
			mediaItems = [];
			totalCount = 0;
			return;
		}
		const requestSequence = ++mediaRequestSequence;
		const isCurrentRequest = () =>
			requestSequence === mediaRequestSequence && selectedWorkspaceId === workspaceID;
		mediaLoading = true;
		error = '';
		selectedMediaIds.clear();
		isSelectionMode = false;
		try {
			const { data, error: err } = await client.GET('/media', {
				params: {
					query: {
						workspace_id: workspaceID,
						lifecycle: lifecycleView,
						filter: filter,
						sort: sort,
						search,
						type: mediaType,
						source,
						tag_ids: selectedTagIDs.join(','),
						untagged: showUntagged,
						aspect,
						min_width: minWidth,
						min_height: minHeight,
						max_width: maxWidth,
						max_height: maxHeight,
						date_from: dateFrom,
						date_to: dateTo,
						limit: pageSize,
						offset: currentPage * pageSize
					}
				}
			});
			if (err) throw new Error(err.detail || m.media_load_failed());
			if (!isCurrentRequest()) return;
			const nextTotalCount = data?.total ?? 0;
			const clampedPage = clampMediaPage(currentPage, nextTotalCount, pageSize);
			if (clampedPage !== currentPage) {
				currentPage = clampedPage;
				await loadMedia(workspaceID);
				return;
			}
			mediaItems = (data?.media ?? []) as unknown as MediaItem[];
			totalCount = nextTotalCount;
		} catch (e) {
			if (!isCurrentRequest()) return;
			error = (e as Error).message;
			mediaItems = [];
		} finally {
			if (isCurrentRequest()) mediaLoading = false;
		}
	}

	async function loadImageEditorHub(workspaceID = selectedWorkspaceId) {
		if (!workspaceID) return;
		hubLoading = true;
		try {
			const config = await loadImageEditorConfig();
			imageEditorEnabled = config.enabled;
			const [tagResult, storageResult] = await Promise.all([
				listMediaTags(workspaceID),
				client.GET('/media/storage', { params: { query: { workspace_id: workspaceID } } })
			]);
			tags = tagResult.tags;
			mediaCanEdit = tagResult.canEdit;
			const validTagIDs = new Set(tagResult.tags.map((tag) => tag.id));
			const nextSelected = selectedTagIDs.filter((id) => validTagIDs.has(id));
			if (nextSelected.length !== selectedTagIDs.length) {
				selectedTagIDs = nextSelected;
				currentPage = 0;
				void loadMedia(workspaceID);
			}
			if (storageResult.data) storageUsage = storageResult.data;
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : m.media_hub_load_failed(), 'error');
		} finally {
			hubLoading = false;
		}
	}

	async function loadVideoEditorState(): Promise<void> {
		try {
			videoEditorEnabled = (await loadVideoEditorConfig()).enabled;
		} catch {
			videoEditorEnabled = false;
		}
	}

	function resetAssetFilters() {
		filter = 'all';
		mediaType = 'all';
		source = 'all';
		selectedTagIDs = [];
		showUntagged = false;
		aspect = 'all';
		minWidth = 0;
		minHeight = 0;
		maxWidth = 0;
		maxHeight = 0;
		dateFrom = '';
		dateTo = '';
		applyAssetFilters();
	}

	function showAllAssets() {
		search = '';
		resetAssetFilters();
	}

	function changeTagFilters(tagIDs: string[], untagged: boolean) {
		selectedTagIDs = tagIDs;
		showUntagged = untagged;
		currentPage = 0;
		void loadMedia();
	}

	async function toggleMediaTag(mediaID: string, tagID: string, selected: boolean): Promise<void> {
		await updateMediaTagItems(tagID, [mediaID], selected ? 'add' : 'remove');
		const item = mediaItems.find((media) => media.id === mediaID);
		if (item) {
			item.tags = selected
				? [...new Set([...item.tags, tagID])]
				: item.tags.filter((id) => id !== tagID);
		}
		if (selectedMedia?.id === mediaID) {
			selectedMedia.tags = selected
				? [...new Set([...selectedMedia.tags, tagID])]
				: selectedMedia.tags.filter((id) => id !== tagID);
		}
		await loadImageEditorHub();
	}

	async function createAndAssignTag(mediaID: string, name: string): Promise<void> {
		const tag = await createMediaTag(selectedWorkspaceId, name);
		await updateMediaTagItems(tag.id, [mediaID], 'add');
		await loadImageEditorHub();
		const item = mediaItems.find((media) => media.id === mediaID);
		if (item) item.tags = [...new Set([...item.tags, tag.id])];
		if (selectedMedia?.id === mediaID) {
			selectedMedia.tags = [...new Set([...selectedMedia.tags, tag.id])];
		}
	}

	function uploadTagID(): string | undefined {
		if (!showUntagged && selectedTagIDs.length === 1) return selectedTagIDs[0];
		return undefined;
	}

	function applyAssetFilters() {
		currentPage = 0;
		filterDialogOpen = false;
		void loadMedia();
	}

	async function saveCameraPhoto(file: File) {
		cameraUploading = true;
		try {
			await uploadMediaFile({
				workspaceId: selectedWorkspaceId,
				file,
				source: 'camera',
				tagId: uploadTagID()
			});
			cameraDialogOpen = false;
			await loadMedia();
			notify(m.media_photo_saved(), 'success');
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : m.media_photo_save_failed(), 'error');
		} finally {
			cameraUploading = false;
		}
	}

	async function toggleFavorite(mediaId: string) {
		try {
			const { data, error: err } = await client.PATCH('/media/{id}/favorite', {
				params: { path: { id: mediaId } }
			});
			if (err) throw new Error(err.detail || m.media_favorite_failed());
			const item = mediaItems.find((m) => m.id === mediaId);
			if (item) {
				item.is_favorite = data?.is_favorite ?? !item.is_favorite;
			}
		} catch (e) {
			notify((e as Error).message, 'error');
		}
	}

	async function toggleFavoriteBatch() {
		const ids = Array.from(selectedMediaIds);
		for (const id of ids) {
			await toggleFavorite(id);
		}
		selectedMediaIds.clear();
		isSelectionMode = false;
	}

	async function assignSelectedOrganization(mode: 'add' | 'remove' = 'add') {
		const id = batchTagID;
		const mediaIDs = Array.from(selectedMediaIds);
		if (!id || mediaIDs.length === 0) return;
		organizationSaving = true;
		try {
			const result = await client.PUT('/media/tags/{id}/items', {
				params: { path: { id } },
				body: { media_ids: mediaIDs, mode } as never
			});
			if (result.error) throw new Error(result.error.detail);
			await Promise.all([loadMedia(), loadImageEditorHub()]);
			notify(
				mode === 'remove'
					? m.media_organization_removed({
							count: mediaIDs.length,
							kind: m.media_organization_tag()
						})
					: m.media_organization_tagged({ count: mediaIDs.length }),
				'success'
			);
			selectedMediaIds.clear();
			isSelectionMode = false;
			selectionOrganizationDialogOpen = false;
			batchTagID = '';
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : m.media_assets_organize_failed(), 'error');
		} finally {
			organizationSaving = false;
		}
	}

	function requestDeleteMedia(media: MediaItem) {
		deletionRequest = { kind: 'single', media };
		deleteDialogOpen = true;
	}

	function requestDeleteSelectedBatch() {
		const ids = [...selectedDeletableIds];
		if (ids.length === 0) return;
		deletionRequest = { kind: 'batch', ids };
		deleteDialogOpen = true;
	}

	async function deleteMedia(mediaId: string) {
		const requestViewKey = mediaViewKey();
		try {
			const { error: err } = await client.DELETE('/media/{id}', {
				params: { path: { id: mediaId } }
			});
			if (err) throw new Error(err.detail || m.media_delete_failed());
			if (requestViewKey === mediaViewKey()) {
				const nextTotalCount = Math.max(0, totalCount - 1);
				const clampedPage = clampMediaPage(currentPage, nextTotalCount, pageSize);
				totalCount = nextTotalCount;
				if (clampedPage !== currentPage) {
					currentPage = clampedPage;
					await loadMedia();
				} else {
					mediaItems = mediaItems.filter((m) => m.id !== mediaId);
				}
			} else {
				await loadMedia();
			}
			notify(deletedCountLabel(1), 'success');
		} catch (e) {
			notify((e as Error).message, 'error');
		}
	}

	async function restoreMedia(mediaId: string) {
		try {
			const { error: err } = await client.POST('/media/{id}/restore', {
				params: { path: { id: mediaId } }
			});
			if (err) throw new Error(err.detail || m.media_trash_restore_failed());
			await loadMedia();
			notify(m.media_trash_restored(), 'success');
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : m.media_trash_restore_failed(), 'error');
		}
	}

	async function deleteSelectedBatch(ids: string[]) {
		if (ids.length === 0) return;
		try {
			const { data, error: err } = await client.POST('/media/batch-delete', {
				body: { media_ids: ids }
			});
			if (err) throw new Error(err.detail || m.media_delete_failed());

			const result = (data ?? { deleted: 0, failed_ids: ids }) as BatchDeleteResult;
			await loadMedia();

			const failedCount = Math.max(result.failed_ids?.length ?? 0, ids.length - result.deleted);
			if (result.deleted === 0) {
				notify(m.media_deleted_none(), 'error');
			} else if (failedCount > 0) {
				notify(
					m.media_deleted_partial({ deleted: result.deleted, failed: failedCount }),
					'neutral'
				);
			} else {
				notify(deletedCountLabel(result.deleted), 'success');
			}
		} catch (e) {
			notify((e as Error).message, 'error');
		}
	}

	async function confirmLibraryDeletion() {
		const request = deletionRequest;
		if (!request) return;
		if (request.kind === 'single') {
			await deleteMedia(request.media.id);
			return;
		}
		await deleteSelectedBatch(request.ids);
	}

	async function downloadMedia(media: MediaItem) {
		try {
			const response = await fetch(getAuthenticatedMediaURL(media.url), { credentials: 'include' });
			if (!response.ok) throw new Error(m.media_download_failed());

			const blob = await response.blob();
			const objectURL = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = objectURL;
			link.download = media.original_filename || `${media.id}.${extensionForMime(media.mime_type)}`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(objectURL);
		} catch (e) {
			notify((e as Error).message, 'error');
		}
	}

	function openMediaInImageEditor(media: MediaItem, action = '') {
		const query = new URLSearchParams({
			workspace: selectedWorkspaceId,
			source_media: media.id,
			source_name: media.original_filename,
			width: String(media.width || 1080),
			height: String(media.height || 1080)
		});
		if (action) query.set('action', action);
		void goto(resolve(`/image-editor/new?${query.toString()}` as '/'));
	}

	function openMediaInVideoEditor(media: MediaItem) {
		const query = new URLSearchParams({
			mode: 'media',
			source_media: media.id,
			source_name: media.original_filename
		});
		void goto(resolve(`/video-editor/new?${query.toString()}` as '/'));
	}

	async function duplicateMedia(media: MediaItem) {
		try {
			const response = await fetch(getAuthenticatedMediaURL(media.url), { credentials: 'include' });
			if (!response.ok) throw new Error(m.media_read_failed());
			const blob = await response.blob();
			const duplicated = new File(
				[blob],
				`copy-${media.original_filename || `${media.id}.${extensionForMime(media.mime_type)}`}`,
				{ type: media.mime_type }
			);
			await uploadMediaFile({
				workspaceId: selectedWorkspaceId,
				file: duplicated,
				source: 'image_editor_edit',
				parentMediaId: media.id,
				tagId: uploadTagID()
			});
			await loadMedia();
			notify(m.media_duplicated(), 'success');
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : m.media_duplicate_failed(), 'error');
		}
	}

	async function showUsage(media: MediaItem) {
		const mediaID = media.id;
		const requestSequence = ++usageRequestSequence;
		const isCurrentRequest = () =>
			requestSequence === usageRequestSequence && usageDialogOpen && selectedMedia?.id === mediaID;
		selectedMedia = media;
		detailAltText = media.alt_text;
		usageDialogOpen = true;
		usageLoading = true;
		usageError = '';
		mediaUsage = [];
		try {
			const { data, error: err } = await client.GET('/media/{id}/usage', {
				params: { path: { id: media.id } }
			});
			if (err) throw new Error(err.detail || m.media_usage_load_failed());
			if (!isCurrentRequest()) return;
			mediaUsage = (data?.usage ?? []) as unknown as MediaUsage[];
		} catch (e) {
			if (!isCurrentRequest()) return;
			usageError = (e as Error).message;
		} finally {
			if (isCurrentRequest()) usageLoading = false;
		}
	}

	async function saveDetailAltText(): Promise<void> {
		if (!selectedMedia || detailSaving) return;
		detailSaving = true;
		try {
			const { error: updateError } = await client.PATCH('/media/{id}', {
				params: { path: { id: selectedMedia.id } },
				body: { alt_text: detailAltText.trim() }
			});
			if (updateError) throw new Error(updateError.detail || m.media_alt_update_failed());
			selectedMedia.alt_text = detailAltText.trim();
			const item = mediaItems.find((media) => media.id === selectedMedia?.id);
			if (item) item.alt_text = detailAltText.trim();
			notify(m.media_alt_saved(), 'success');
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : m.media_alt_update_failed(), 'error');
		} finally {
			detailSaving = false;
		}
	}

	async function retryVideoAnalysis(media: MediaItem): Promise<void> {
		try {
			const { error: retryError } = await client.POST('/media/{id}/analysis/retry', {
				params: { path: { id: media.id } }
			});
			if (retryError) throw new Error(retryError.detail || m.media_video_retry_failed());
			media.processing_status = 'processing';
			media.processing_progress = 0;
			media.analysis_status = 'pending';
			media.analysis_error = '';
			notify(m.media_video_retry_started(), 'neutral');
		} catch (cause) {
			notify(cause instanceof Error ? cause.message : m.media_video_retry_failed(), 'error');
		}
	}

	function handleUsageDialogOpenChange(nextOpen: boolean) {
		usageDialogOpen = nextOpen;
		if (nextOpen) return;
		usageRequestSequence++;
		usageLoading = false;
		usageError = '';
		mediaUsage = [];
		selectedMedia = null;
	}

	function selectUploadFiles(selectedFiles: File[]): void {
		const supportedFiles = selectedFiles.filter(isSupportedMediaFile);
		uploadError = '';
		if (supportedFiles.length !== selectedFiles.length) {
			uploadError = m.media_select_file_error();
		}
		if (supportedFiles.length > 10) {
			uploadFiles = [];
			uploadError = m.media_max_files_error();
			return;
		}
		uploadFiles = supportedFiles;
		if (supportedFiles.length === 1 && isVideo(supportedFiles[0].type)) {
			uploadVideoEditorFile = supportedFiles[0];
			uploadVideoEditorOpen = true;
		}
	}

	function handleUploadSelection(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		selectUploadFiles(Array.from(input.files ?? []));
	}

	function handleUploadDrop(event: DragEvent): void {
		event.preventDefault();
		uploadDragging = false;
		if (uploadLoading) return;
		selectUploadFiles(Array.from(event.dataTransfer?.files ?? []));
	}

	function handleUploadDragLeave(event: DragEvent): void {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && event.currentTarget instanceof Node) {
			if (event.currentTarget.contains(nextTarget)) return;
		}
		uploadDragging = false;
	}

	function attachUploadInput(input: HTMLInputElement) {
		uploadInput = input;
		return () => {
			if (uploadInput === input) uploadInput = null;
		};
	}

	function useEditedLibraryVideo(file: File) {
		uploadFiles = [file];
		uploadVideoEditorFile = null;
	}

	function uploadStage(stage: VideoPreparationStage): string {
		switch (stage) {
			case 'inspecting':
				return m.video_upload_inspecting();
			case 'remuxing':
				return m.video_upload_remuxing();
			case 'compressing':
				return m.video_upload_compressing();
			case 'uploading':
				return m.video_upload_uploading();
			case 'finalizing':
				return m.video_upload_finalizing();
			case 'processing':
				return m.video_upload_processing();
		}
	}

	function cancelLibraryUpload() {
		uploadController?.abort();
		if (!uploadLoading) {
			uploadDialogOpen = false;
			uploadFiles = [];
			if (uploadInput) uploadInput.value = '';
		}
	}

	async function handleUpload() {
		if (!selectedWorkspaceId) return;
		uploadLoading = true;
		uploadError = '';

		const files = uploadFiles.filter(isSupportedMediaFile);
		if (files.length === 0) {
			uploadError = m.media_select_file_error();
			uploadLoading = false;
			return;
		}
		if (files.length > 10) {
			uploadError = m.media_max_files_error();
			uploadLoading = false;
			return;
		}

		try {
			uploadController = new AbortController();
			const uploaded = [];
			for (const [index, file] of files.entries()) {
				uploaded.push(
					await uploadMediaFile({
						workspaceId: selectedWorkspaceId,
						file,
						tagId: uploadTagID(),
						signal: uploadController.signal,
						onProgress: (progress) => {
							uploadProgress = {
								...progress,
								fraction: Math.min(1, (index + progress.fraction) / files.length)
							};
						}
					})
				);
			}

			uploadDialogOpen = false;
			uploadFiles = [];
			if (uploadInput) uploadInput.value = '';
			notify(uploadedCountLabel(uploaded.length), 'success');
			soundPreferences.play('success');
			await loadMedia();
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') {
				uploadError = '';
				return;
			}
			uploadError = videoPreparationErrorMessage(cause, m.media_select_file_error());
			soundPreferences.play('error');
		} finally {
			uploadLoading = false;
			uploadProgress = null;
			uploadController = null;
		}
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	function formatVideoDuration(milliseconds: number): string {
		if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '—';
		const totalSeconds = Math.round(milliseconds / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		return hours > 0
			? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
			: `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			timeZone: workspaceCtx.settings.timezone || 'UTC'
		});
	}

	function isImage(mimeType: string): boolean {
		return mimeType.startsWith('image/');
	}

	function isVideo(mimeType: string): boolean {
		return mimeType.startsWith('video/');
	}

	function isAudio(mimeType: string): boolean {
		return mimeType.startsWith('audio/');
	}

	function mediaSourceLabel(value: string): string {
		switch (value) {
			case 'camera':
				return m.media_camera();
			case 'image_editor_export':
				return m.media_image_editor_exports();
			case 'image_editor_edit':
				return m.media_image_editor_edits();
			case 'background_removal':
				return m.media_background_removal();
			default:
				return m.media_uploads();
		}
	}

	function mediaUsageKindLabel(value: string): string {
		switch (value) {
			case 'post':
				return m.media_usage_post();
			case 'design':
				return m.media_usage_design();
			case 'design_preview':
				return m.media_usage_design_preview();
			case 'design_page_export':
				return m.media_usage_design_page_export();
			case 'template':
				return m.media_usage_template();
			case 'template_preview':
				return m.media_usage_template_preview();
			case 'brand_asset':
				return m.media_usage_brand_asset();
			case 'brand_font':
				return m.media_usage_brand_font();
			default:
				return value.replaceAll('_', ' ');
		}
	}

	function canDeleteMedia(media: MediaItem): boolean {
		return media.can_delete ?? media.usage_count === 0;
	}

	function extensionForMime(mimeType: string): string {
		if (mimeType === 'image/jpeg') return 'jpg';
		if (mimeType === 'image/png') return 'png';
		if (mimeType === 'image/webp') return 'webp';
		if (mimeType === 'image/gif') return 'gif';
		if (mimeType === 'video/mp4') return 'mp4';
		if (mimeType === 'video/webm') return 'webm';
		if (mimeType === 'audio/mpeg') return 'mp3';
		if (mimeType === 'audio/wav') return 'wav';
		if (mimeType === 'audio/ogg') return 'ogg';
		return 'bin';
	}

	function toggleSelection(mediaId: string) {
		if (selectedMediaIds.has(mediaId)) {
			selectedMediaIds.delete(mediaId);
		} else {
			selectedMediaIds.add(mediaId);
		}
		isSelectionMode = selectedMediaIds.size > 0;
	}

	function selectAll() {
		if (mediaItems.every((media) => selectedMediaIds.has(media.id))) {
			mediaItems.forEach((media) => selectedMediaIds.delete(media.id));
		} else {
			mediaItems.forEach((media) => selectedMediaIds.add(media.id));
		}
		isSelectionMode = selectedMediaIds.size > 0;
	}

	function cancelSelection() {
		selectedMediaIds.clear();
		isSelectionMode = false;
	}

	async function changeWorkspace(value: string) {
		if (!value || value === selectedWorkspaceId) return;
		const workspace = workspaces.find((candidate) => candidate.id === value);
		if (!workspace) return;
		currentPage = 0;
		selectedTagIDs = [];
		showUntagged = false;
		await workspaceCtx.setWorkspace(workspace);
	}

	function changeFilter(value: string) {
		if (!value || value === filter) return;
		filter = value;
		currentPage = 0;
		void loadMedia();
	}

	function changeSort(value: string) {
		if (!value || value === sort) return;
		sort = value;
		currentPage = 0;
		void loadMedia();
	}

	function nextPage() {
		if ((currentPage + 1) * pageSize < totalCount) {
			currentPage++;
			loadMedia();
		}
	}

	function prevPage() {
		if (currentPage > 0) {
			currentPage--;
			loadMedia();
		}
	}

	onMount(() => {
		const requestedView = $page.url.searchParams.get('view');
		if (requestedView === 'brand') {
			void goto(resolve('/settings?tab=brand' as '/'), { replaceState: true });
			return;
		}
		if (requestedView) {
			const next = new URL($page.url);
			next.searchParams.delete('view');
			replaceState(resolve(`${next.pathname}${next.search}` as '/'), {});
		}
		void loadWorkspaces();
		void loadVideoEditorState();
	});

	onMount(() => {
		const timer = window.setInterval(() => {
			if (
				!mediaLoading &&
				!isSelectionMode &&
				mediaItems.some(
					(item) =>
						isVideo(item.mime_type) &&
						(item.processing_status === 'processing' || item.analysis_status === 'pending')
				)
			) {
				void loadMedia();
			}
		}, 2500);
		return () => window.clearInterval(timer);
	});

	$effect(() => {
		const workspaceID = selectedWorkspaceId;
		untrack(() => {
			void loadMedia(workspaceID);
			void loadImageEditorHub(workspaceID);
		});
	});

	const quickFilters = $derived([
		{ value: 'all', label: m.media_filter_all() },
		{ value: 'favorites', label: m.media_filter_favorites() },
		{ value: 'unused', label: m.media_filter_unused() }
	]);

	const activeFilterCount = $derived(
		[
			filter !== 'all',
			mediaType !== 'all',
			source !== 'all',
			selectedTagIDs.length > 0,
			showUntagged,
			aspect !== 'all',
			minWidth > 0,
			minHeight > 0,
			maxWidth > 0,
			maxHeight > 0,
			Boolean(dateFrom),
			Boolean(dateTo)
		].filter(Boolean).length
	);
	const activeDetailFilterCount = $derived(
		[
			mediaType !== 'all',
			source !== 'all',
			selectedTagIDs.length > 0,
			showUntagged,
			aspect !== 'all',
			minWidth > 0,
			minHeight > 0,
			maxWidth > 0,
			maxHeight > 0,
			Boolean(dateFrom),
			Boolean(dateTo)
		].filter(Boolean).length
	);
	const totalPages = $derived(Math.ceil(totalCount / pageSize));
	const allMediaSelected = $derived(
		mediaItems.length > 0 && mediaItems.every((media) => selectedMediaIds.has(media.id))
	);
	const selectedDeletableIds = $derived(
		mediaItems
			.filter((media) => selectedMediaIds.has(media.id) && canDeleteMedia(media))
			.map((media) => media.id)
	);

	const descriptionText = $derived.by(() => {
		if (totalCount > 0) {
			let text: string = m.media_storage_summary({
				count: totalCount,
				size: formatSize(storageUsage.used_bytes)
			});
			if (filter === 'unused') {
				text += ` (${m.media_unused_suffix({ count: totalCount })})`;
			}
			return text;
		}
		if (lifecycleView === 'temporary') return m.media_lifecycle_temporary_body();
		if (lifecycleView === 'trash') return m.media_lifecycle_trash_body();
		return m.media_lifecycle_library_body();
	});
</script>

<svelte:head>
	<title>{m.media_library_title()} - {m.common_openpost()}</title>
</svelte:head>

{#if toastMessage}
	<AppToast
		message={toastMessage}
		tone={toastTone}
		dismissLabel={m.common_close()}
		onDismiss={() => (toastMessage = '')}
	/>
{/if}

<PageContainer
	title={m.media_hub_title()}
	description={descriptionText}
	icon={ImageIcon}
	{loading}
	loadingMessage={m.common_loading()}
	loadingLayout="gallery"
>
	{#snippet actions()}
		{#if workspaces && workspaces.length > 1}
			<Select.Root type="single" value={selectedWorkspaceId} onValueChange={changeWorkspace}>
				<Select.Trigger class="w-[160px]">
					{workspaces.find((w) => w.id === selectedWorkspaceId)?.name || m.sidebar_workspace()}
				</Select.Trigger>
				<Select.Content>
					{#each workspaces as workspace (workspace.id)}
						<Select.Item value={workspace.id}>{workspace.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		{#if mediaCanEdit && lifecycleView !== 'trash'}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} class="gap-2">
							<PlusIcon class="size-4" />
							{m.media_create()}
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-48">
					<DropdownMenu.Item onclick={() => (uploadDialogOpen = true)}>
						<UploadIcon />
						{m.media_upload_title()}
					</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => (cameraDialogOpen = true)}>
						<CameraIcon />
						{m.media_take_photo()}
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	{/snippet}

	{#if mediaLoading && mediaItems.length > 0}
		<span class="sr-only" role="status">{m.common_loading()}</span>
	{/if}
	{#if error && mediaItems.length > 0}
		<InlineNotice
			tone="error"
			message={error}
			dismissLabel={m.common_close()}
			onDismiss={() => (error = '')}
		/>
	{/if}

	<nav class="flex gap-1 overflow-x-auto border-b pb-3" aria-label="Media lifecycle">
		{#each [{ value: 'library' as const, label: m.media_lifecycle_library() }, { value: 'temporary' as const, label: m.media_lifecycle_temporary() }, { value: 'trash' as const, label: m.media_lifecycle_trash() }] as view (view.value)}
			<Button
				variant={lifecycleView === view.value ? 'secondary' : 'ghost'}
				size="sm"
				class="shrink-0 rounded-full"
				onclick={() => {
					lifecycleView = view.value;
					currentPage = 0;
					void loadMedia();
				}}
			>
				{view.label}
			</Button>
		{/each}
	</nav>

	{#if lifecycleView !== 'trash'}
		<MediaTagFilter
			{tags}
			selectedIds={selectedTagIDs}
			untagged={showUntagged}
			canEdit={mediaCanEdit}
			onChange={changeTagFilters}
			onManage={() => (organizationDialogOpen = true)}
		/>
	{/if}

	<form
		class="flex gap-2"
		onsubmit={(event) => {
			event.preventDefault();
			applyAssetFilters();
		}}
	>
		<div class="relative min-w-0 flex-1">
			<SearchIcon
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				class="h-11 pr-3 pl-9"
				bind:value={search}
				placeholder={m.media_search_filename_alt()}
			/>
		</div>
		<Button
			type="button"
			variant={activeDetailFilterCount > 0 ? 'secondary' : 'outline'}
			class="h-11 min-w-11 shrink-0 sm:w-auto"
			aria-label={m.media_filters()}
			onclick={() => (filterDialogOpen = true)}
		>
			<SlidersHorizontalIcon />
			<span class="hidden sm:inline">{m.media_filters()}</span>
			{#if activeDetailFilterCount > 0}
				<span
					class="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
				>
					{activeDetailFilterCount}
				</span>
			{/if}
		</Button>
	</form>

	<div class="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center">
		<div class="flex min-w-0 gap-1 overflow-x-auto" aria-label={m.media_type()}>
			{#each [{ value: 'all', label: m.media_all_types() }, { value: 'image', label: m.media_images() }, { value: 'video', label: m.media_videos() }, { value: 'audio', label: m.media_audio() }] as typeFilter (typeFilter.value)}
				<Button
					variant={mediaType === typeFilter.value ? 'secondary' : 'ghost'}
					size="sm"
					class="min-w-11 shrink-0 rounded-full"
					onclick={() => {
						mediaType = typeFilter.value;
						currentPage = 0;
						void loadMedia();
					}}
				>
					{typeFilter.label}
				</Button>
			{/each}
		</div>
		<div class="flex min-w-0 gap-1 overflow-x-auto sm:border-l sm:pl-2">
			{#each quickFilters as quickFilter (quickFilter.value)}
				<Button
					variant={filter === quickFilter.value ? 'secondary' : 'ghost'}
					size="sm"
					class="min-w-11 shrink-0"
					onclick={() => changeFilter(quickFilter.value)}
				>
					{quickFilter.label}
				</Button>
			{/each}
		</div>
		<div class="flex shrink-0 items-center justify-between gap-1.5 sm:ml-auto sm:justify-start">
			<Select.Root type="single" value={sort} onValueChange={changeSort}>
				<Select.Trigger class="h-10 w-[7.75rem] text-sm">
					{sort === 'newest'
						? m.media_sort_newest()
						: sort === 'oldest'
							? m.media_sort_oldest()
							: sort === 'name'
								? m.media_sort_name()
								: sort === 'recently_used'
									? m.media_recently_used()
									: m.media_sort_size()}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="newest">{m.media_sort_newest()}</Select.Item>
					<Select.Item value="oldest">{m.media_sort_oldest()}</Select.Item>
					<Select.Item value="name">{m.media_sort_name()}</Select.Item>
					<Select.Item value="size">{m.media_sort_size()}</Select.Item>
					<Select.Item value="recently_used">{m.media_recently_used()}</Select.Item>
				</Select.Content>
			</Select.Root>
			<Button
				variant="ghost"
				size="icon-sm"
				class="hidden sm:inline-flex"
				onclick={() => (layoutMode = layoutMode === 'grid' ? 'list' : 'grid')}
				aria-label={layoutMode === 'grid' ? m.media_compact_view() : m.media_grid_view()}
			>
				{#if layoutMode === 'grid'}<ListIcon />{:else}<Grid2X2Icon />{/if}
			</Button>
			{#if mediaCanEdit && mediaItems.length > 0 && !isSelectionMode}
				<Button variant="outline" size="sm" class="h-11" onclick={() => (isSelectionMode = true)}>
					{m.media_select()}
				</Button>
			{/if}
		</div>
	</div>

	{#if isSelectionMode}
		<div
			class="fixed right-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-3 z-40 rounded-2xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-border md:sticky md:right-auto md:bottom-4 md:left-auto"
			role="toolbar"
			aria-label={m.media_selection_actions()}
		>
			<div class="flex items-center gap-1">
				<span class="min-w-0 flex-1 truncate px-2 text-sm font-semibold">
					{selectedCountLabel(selectedMediaIds.size)}
				</span>
				<Button variant="ghost" size="sm" onclick={selectAll}>
					{allMediaSelected ? m.media_deselect_all() : m.media_select_all()}
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={cancelSelection}
					aria-label={m.common_cancel()}
				>
					<XIcon />
				</Button>
			</div>
			<div class="flex gap-1 overflow-x-auto">
				<Button
					variant="ghost"
					size="sm"
					class="shrink-0"
					disabled={selectedMediaIds.size === 0}
					onclick={() => (selectionOrganizationDialogOpen = true)}
				>
					<TagIcon />
					{m.media_manage_tags()}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="shrink-0"
					disabled={selectedMediaIds.size === 0}
					onclick={toggleFavoriteBatch}
				>
					<HeartIcon />
					{m.media_favorite()}
				</Button>
				{#if selectedDeletableIds.length > 0}
					<Button
						variant="ghost"
						size="sm"
						class="shrink-0 text-destructive hover:text-destructive"
						onclick={requestDeleteSelectedBatch}
					>
						<TrashIcon />
						{m.common_delete()}
					</Button>
				{/if}
			</div>
		</div>
	{/if}

	{#if (mediaLoading || hubLoading) && mediaItems.length === 0}
		<PageLoading layout="gallery" label={m.common_loading()} items={10} />
	{:else if error && mediaItems.length === 0}
		<InlineNotice tone="error" message={error} class="my-2">
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => loadMedia()}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else if mediaItems.length === 0}
		{#if activeFilterCount > 0 || search.trim()}
			<EmptyState
				icon={ImageIcon}
				title={m.media_empty_title()}
				description={m.media_empty_filtered_body()}
				actionLabel={m.media_show_all()}
				onAction={showAllAssets}
				variant="dashed"
				size="lg"
			/>
		{:else}
			<EmptyState
				icon={ImageIcon}
				title={m.media_empty_title()}
				description={m.media_empty_library_body()}
				actionLabel={mediaCanEdit ? m.media_upload_action() : undefined}
				onAction={() => (uploadDialogOpen = true)}
				variant="dashed"
				size="lg"
			/>
		{/if}
	{:else}
		<div
			data-testid="media-library-grid"
			class={layoutMode === 'grid'
				? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
				: 'grid grid-cols-1 gap-2'}
		>
			{#each mediaItems as media (media.id)}
				<ContextMenu.Root>
					<ContextMenu.Trigger disabled={isSelectionMode}>
						{#snippet child({ props })}
							<div
								{...props}
								data-library-kind="asset"
								class="group relative overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {layoutMode ===
								'list'
									? 'grid grid-cols-[6rem_minmax(0,1fr)]'
									: ''} {selectedMediaIds.has(media.id) ? 'ring-2 ring-primary' : ''}"
							>
								<div
									class="relative overflow-hidden bg-muted/30 {layoutMode === 'grid'
										? 'aspect-square'
										: 'aspect-square h-24'}"
								>
									{#if lifecycleView === 'trash'}
										<div
											class="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"
										>
											<TrashIcon class="size-8" />
											<span class="px-3 text-center text-xs">{m.media_trash_preview_removed()}</span
											>
										</div>
									{:else if isVideo(media.mime_type)}
										{#if media.thumbnail_url || media.poster_thumbnail_url}
											<img
												src={getAuthenticatedMediaURL(
													media.thumbnail_url || media.poster_thumbnail_url || ''
												)}
												alt=""
												loading="lazy"
												class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
											/>
										{:else if media.processing_status === 'ready'}
											<video
												src={getAuthenticatedMediaURL(media.url)}
												class="size-full object-cover"
												muted
												playsinline
												preload="metadata"
											></video>
										{/if}
										<div
											class="pointer-events-none absolute inset-0 flex items-center justify-center"
										>
											<div
												class="flex size-10 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm"
											>
												<VideoIcon class="size-5 text-foreground" />
											</div>
										</div>
										{#if media.processing_status === 'processing' || media.analysis_status === 'pending'}
											<div
												class="absolute inset-x-2 bottom-2 z-[2] space-y-1 rounded-lg bg-background/90 px-2 py-2 shadow-sm backdrop-blur"
												aria-live="polite"
											>
												<div class="flex items-center gap-2 text-xs font-medium">
													<LoaderIcon class="size-3.5 animate-spin" />
													{m.media_video_processing({
														percent: Math.max(0, media.processing_progress ?? 0)
													})}
												</div>
												<div class="h-1.5 overflow-hidden rounded-full bg-muted">
													<div
														class="h-full rounded-full bg-primary transition-[width]"
														style:width={`${Math.min(
															100,
															Math.max(4, media.processing_progress ?? 0)
														)}%`}
													></div>
												</div>
											</div>
										{:else if media.processing_status === 'failed' || media.analysis_status === 'failed'}
											<div
												class="absolute inset-x-2 bottom-2 z-[2] rounded-lg bg-destructive/90 px-2 py-2 text-xs text-destructive-foreground shadow-sm"
											>
												<p class="line-clamp-2">
													{media.analysis_error || m.media_video_processing_failed()}
												</p>
												{#if mediaCanEdit}
													<Button
														type="button"
														variant="secondary"
														size="sm"
														class="relative z-10 mt-2 h-8"
														onclick={(event) => {
															event.stopPropagation();
															void retryVideoAnalysis(media);
														}}
													>
														{m.common_retry()}
													</Button>
												{/if}
											</div>
										{/if}
									{:else if isImage(media.mime_type)}
										<img
											src={getAuthenticatedMediaURL(media.thumbnail_url || media.url)}
											alt={media.alt_text || media.original_filename || m.media_library_title()}
											loading="lazy"
											class="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
										/>
									{:else if isAudio(media.mime_type)}
										<div class="flex size-full items-center justify-center">
											<FileAudioIcon class="size-10 text-muted-foreground/50" />
										</div>
									{:else}
										<div class="flex size-full items-center justify-center">
											<ImageIcon class="size-10 text-muted-foreground/40" />
										</div>
									{/if}

									<button
										type="button"
										class="absolute inset-0 z-[1]"
										onclick={() => (isSelectionMode ? toggleSelection(media.id) : showUsage(media))}
										aria-label={isSelectionMode
											? selectedMediaIds.has(media.id)
												? m.media_deselect_item({ name: media.original_filename || media.id })
												: m.media_select_item({ name: media.original_filename || media.id })
											: m.media_open_details({ name: media.original_filename || media.id })}
										aria-pressed={isSelectionMode ? selectedMediaIds.has(media.id) : undefined}
									></button>

									{#if isSelectionMode}
										<span
											class="media-card-control absolute top-2 left-2 z-10 flex items-center justify-center rounded-lg bg-background/95 shadow-sm"
										>
											{#if selectedMediaIds.has(media.id)}
												<CheckIcon class="size-4 text-primary" />
											{:else}
												<div class="size-4 rounded-sm border-2 border-muted-foreground"></div>
											{/if}
										</span>
									{/if}

									{#if media.is_favorite}
										<div
											class="absolute bottom-2 left-2 rounded-full bg-background/90 p-1.5 shadow-sm"
										>
											<HeartIcon class="size-3.5 fill-red-500 text-red-500" />
										</div>
									{/if}
								</div>

								<div class="p-2.5">
									{#if media.original_filename}
										<p class="truncate text-sm font-medium" title={media.original_filename}>
											{media.original_filename}
										</p>
									{/if}
									<p class="mt-0.5 truncate text-xs text-muted-foreground">
										{#if lifecycleView === 'trash'}
											{m.media_trash_purge_date({
												date: formatDate(media.purge_after || media.trashed_at || media.created_at)
											})}
										{:else}
											{formatSize(media.size)} · {formatDate(media.created_at)}
										{/if}
									</p>
									{#if lifecycleView === 'trash' && mediaCanEdit}
										<Button
											class="mt-2 w-full"
											variant="outline"
											size="sm"
											onclick={() => restoreMedia(media.id)}
										>
											<RotateCcwIcon />
											{m.media_trash_restore()}
										</Button>
									{:else}
										<div class="mt-2 flex min-w-0 flex-wrap items-center gap-1">
											{#each media.tags.slice(0, 2) as tagID (tagID)}
												{@const tag = tags.find((item) => item.id === tagID)}
												{#if tag}
													<Button
														variant="secondary"
														size="xs"
														class="h-7 max-w-32 rounded-full px-2"
														onclick={() => changeTagFilters([tag.id], false)}
													>
														<span class="truncate">#{tag.name}</span>
													</Button>
												{/if}
											{/each}
											{#if media.tags.length > 2}
												<span class="px-1 text-xs text-muted-foreground"
													>+{media.tags.length - 2}</span
												>
											{/if}
											{#if mediaCanEdit}
												<MediaTagPicker
													{tags}
													selectedIds={media.tags}
													canEdit={mediaCanEdit}
													onToggle={(tagID, selected) => toggleMediaTag(media.id, tagID, selected)}
													onCreate={(name) => createAndAssignTag(media.id, name)}
												/>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						{/snippet}
					</ContextMenu.Trigger>
					<ContextMenu.Portal>
						<ContextMenu.Content class={libraryContextContentClass}>
							{#if lifecycleView === 'trash' && mediaCanEdit}
								<ContextMenu.Item
									class={libraryContextItemClass}
									onclick={() => restoreMedia(media.id)}
								>
									<RotateCcwIcon class="size-4" />
									{m.media_trash_restore()}
								</ContextMenu.Item>
							{/if}
							{#if lifecycleView !== 'trash'}
								<ContextMenu.Item class={libraryContextItemClass} onclick={() => showUsage(media)}>
									<ExternalLinkIcon class="size-4" />
									{m.media_details()}
								</ContextMenu.Item>
								{#if isImage(media.mime_type) && mediaCanEdit && imageEditorEnabled}
									<ContextMenu.Item
										class={libraryContextItemClass}
										onclick={() => openMediaInImageEditor(media)}
									>
										<PaletteIcon class="size-4" />
										{m.media_edit_image_editor()}
									</ContextMenu.Item>
									<ContextMenu.Item
										class={libraryContextItemClass}
										onclick={() => openMediaInImageEditor(media, 'remove-background')}
									>
										<ImageIcon class="size-4" />
										{m.image_editor_remove_background()}
									</ContextMenu.Item>
								{/if}
								{#if isVideo(media.mime_type) && mediaCanEdit && videoEditorEnabled}
									<ContextMenu.Item
										class={libraryContextItemClass}
										onclick={() => openMediaInVideoEditor(media)}
									>
										<VideoIcon class="size-4" />
										{m.media_edit_video_editor()}
									</ContextMenu.Item>
								{/if}
								{#if mediaCanEdit}
									<ContextMenu.Item
										class={libraryContextItemClass}
										onclick={() => duplicateMedia(media)}
									>
										<Grid2X2Icon class="size-4" />
										{m.image_editor_duplicate()}
									</ContextMenu.Item>
								{/if}
								<ContextMenu.Item
									class={libraryContextItemClass}
									onclick={() => downloadMedia(media)}
								>
									<DownloadIcon class="size-4" />
									{m.media_download()}
								</ContextMenu.Item>
								{#if mediaCanEdit}
									<ContextMenu.Item
										class={libraryContextItemClass}
										onclick={() => toggleFavorite(media.id)}
									>
										<HeartIcon class="size-4" fill={media.is_favorite ? 'currentColor' : 'none'} />
										{media.is_favorite ? m.media_unfavorite() : m.media_favorite()}
									</ContextMenu.Item>
								{/if}
								{#if mediaCanEdit && canDeleteMedia(media)}
									<ContextMenu.Separator class="my-1 h-px bg-border" />
									<ContextMenu.Item
										class="{libraryContextItemClass} text-destructive data-highlighted:text-destructive"
										onclick={() => requestDeleteMedia(media)}
									>
										<TrashIcon class="size-4" />
										{m.common_delete()}
									</ContextMenu.Item>
								{/if}
							{/if}
						</ContextMenu.Content>
					</ContextMenu.Portal>
				</ContextMenu.Root>
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="mt-6 flex flex-wrap items-center justify-center gap-2 sm:gap-4">
				<Button variant="outline" size="sm" onclick={prevPage} disabled={currentPage === 0}>
					<ChevronLeftIcon class="mr-1 h-4 w-4" />
					{m.media_previous_page()}
				</Button>
				<span
					class="order-first w-full text-center text-sm text-muted-foreground sm:order-none sm:w-auto"
				>
					{m.media_page_count({ current: currentPage + 1, total: totalPages })}
				</span>
				<Button
					variant="outline"
					size="sm"
					onclick={nextPage}
					disabled={currentPage >= totalPages - 1}
				>
					{m.media_next_page()}
					<ChevronRightIcon class="ml-1 h-4 w-4" />
				</Button>
			</div>
		{/if}
		{#if isSelectionMode}<div class="h-24 md:hidden"></div>{/if}
	{/if}
</PageContainer>

<Dialog.Root bind:open={filterDialogOpen}>
	<Dialog.Content class="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{m.media_filters()}</Dialog.Title>
			<Dialog.Description>{m.media_filters_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-2 sm:grid-cols-2">
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{m.media_type()}</span>
				<AppSelect
					bind:value={mediaType}
					options={[
						{ value: 'all', label: m.media_all_types() },
						{ value: 'image', label: m.media_images() },
						{ value: 'video', label: m.media_videos() },
						{ value: 'audio', label: m.media_audio() }
					]}
					class="h-11 w-full"
				/>
			</label>
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{m.media_source()}</span>
				<AppSelect
					bind:value={source}
					options={[
						{ value: 'all', label: m.media_all_sources() },
						{ value: 'upload', label: m.media_uploads() },
						{ value: 'camera', label: m.media_camera() },
						{ value: 'image_editor_export', label: m.media_image_editor_exports() },
						{ value: 'image_editor_edit', label: m.media_image_editor_edits() },
						{ value: 'background_removal', label: m.media_background_removal() }
					]}
					class="h-11 w-full"
				/>
			</label>
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{m.media_aspect_ratio()}</span>
				<AppSelect
					bind:value={aspect}
					options={[
						{ value: 'all', label: m.media_any_aspect() },
						{ value: 'square', label: m.media_square() },
						{ value: 'portrait', label: m.media_portrait() },
						{ value: 'landscape', label: m.media_landscape() }
					]}
					class="h-11 w-full"
				/>
			</label>
		</div>
		<details class="border-y py-1">
			<summary class="flex min-h-11 cursor-pointer items-center text-sm font-medium">
				{m.media_dimensions_date()}
			</summary>
			<div class="grid gap-3 pb-3 sm:grid-cols-2">
				<div class="grid grid-cols-2 gap-2">
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_min_width()}</span>
						<Input class="h-11 min-w-0 px-2" type="number" min="0" bind:value={minWidth} />
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_min_height()}</span>
						<Input class="h-11 min-w-0 px-2" type="number" min="0" bind:value={minHeight} />
					</label>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_max_width()}</span>
						<Input class="h-11 min-w-0 px-2" type="number" min="0" bind:value={maxWidth} />
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_max_height()}</span>
						<Input class="h-11 min-w-0 px-2" type="number" min="0" bind:value={maxHeight} />
					</label>
				</div>
				<div class="grid grid-cols-2 gap-2 sm:col-span-2">
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_from()}</span>
						<Input class="h-11 min-w-0 px-2" type="date" bind:value={dateFrom} />
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.media_to()}</span>
						<Input class="h-11 min-w-0 px-2" type="date" bind:value={dateTo} />
					</label>
				</div>
			</div>
		</details>
		{#if mediaCanEdit}
			<Button
				variant="ghost"
				class="justify-start"
				onclick={() => {
					filterDialogOpen = false;
					organizationDialogOpen = true;
				}}
			>
				<TagIcon />
				{m.media_manage_organization()}
			</Button>
		{/if}
		<Dialog.Footer>
			<Button variant="ghost" onclick={resetAssetFilters}>{m.media_clear()}</Button>
			<Button onclick={applyAssetFilters}>{m.media_apply_filters()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={selectionOrganizationDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.media_organize_selected()}</Dialog.Title>
			<Dialog.Description>{selectedCountLabel(selectedMediaIds.size)}</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-5 py-2">
			<div class="space-y-2">
				<label for="batch-tag" class="text-sm font-medium">{m.media_tag()}</label>
				<div class="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
					<AppSelect
						id="batch-tag"
						bind:value={batchTagID}
						placeholder={m.media_choose_tag()}
						options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
						class="h-11 min-w-0"
					/>
					<Button
						variant="outline"
						disabled={!batchTagID || organizationSaving}
						onclick={() => assignSelectedOrganization()}
					>
						{m.media_add()}
					</Button>
					<Button
						variant="ghost"
						disabled={!batchTagID || organizationSaving}
						onclick={() => assignSelectedOrganization('remove')}
					>
						{m.media_remove()}
					</Button>
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={deletionTitle(deletionRequest)}
	description={deletionDescription(deletionRequest)}
	onConfirm={confirmLibraryDeletion}
/>

<MediaOrganizationDialog
	bind:open={organizationDialogOpen}
	workspaceId={selectedWorkspaceId}
	{tags}
	onChanged={() => loadImageEditorHub()}
	onNotify={notify}
/>

<!-- Upload Dialog -->
<Dialog.Root bind:open={uploadDialogOpen}>
	<Dialog.Content
		class="sm:max-w-md"
		showCloseButton={!uploadLoading}
		onInteractOutside={(event) => uploadLoading && event.preventDefault()}
		onEscapeKeydown={(event) => uploadLoading && event.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>{m.media_upload_title()}</Dialog.Title>
			<Dialog.Description>{m.media_upload_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			<Input
				id="file-upload"
				type="file"
				accept="image/*,video/*,audio/*"
				multiple
				class="peer sr-only !size-px !p-0"
				onchange={handleUploadSelection}
				{@attach attachUploadInput}
			/>
			<label
				class="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:outline-none hover:bg-muted/40 {uploadDragging
					? 'border-primary bg-primary/5'
					: ''}"
				for="file-upload"
				ondragenter={(event) => {
					event.preventDefault();
					if (!uploadLoading) uploadDragging = true;
				}}
				ondragover={(event) => event.preventDefault()}
				ondragleave={handleUploadDragLeave}
				ondrop={handleUploadDrop}
			>
				<UploadIcon class="mb-3 size-8 text-muted-foreground" />
				<p class="text-sm font-medium">{m.media_drop_prompt()}</p>
				<p class="mt-1 text-sm text-muted-foreground">{m.media_upload_batch_hint()}</p>
			</label>

			{#if uploadFiles.length > 0}
				<div class="rounded-lg border bg-muted/20 px-3 py-2">
					<p class="text-sm font-medium">
						{uploadFiles.length === 1
							? uploadFiles[0].name
							: m.media_selected_files({ count: uploadFiles.length })}
					</p>
					{#if uploadFiles.length === 1}
						<p class="mt-0.5 text-xs text-muted-foreground">
							{formatSize(uploadFiles[0].size)}
						</p>
					{/if}
				</div>
			{/if}

			{#if uploadError}
				<InlineNotice
					tone="error"
					message={uploadError}
					dismissLabel={m.common_dismiss()}
					onDismiss={() => (uploadError = '')}
				/>
			{/if}

			{#if uploadProgress}
				<div class="space-y-2" aria-live="polite">
					<div class="flex items-center justify-between gap-3">
						<p class="text-sm font-medium">
							{m.video_upload_progress({
								stage: uploadStage(uploadProgress.stage),
								percent: Math.round(uploadProgress.fraction * 100)
							})}
						</p>
						<Button type="button" variant="ghost" size="sm" onclick={cancelLibraryUpload}>
							{m.video_upload_cancel()}
						</Button>
					</div>
					<div class="h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary transition-[width]"
							style:width={`${Math.round(uploadProgress.fraction * 100)}%`}
						></div>
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={cancelLibraryUpload}>{m.common_cancel()}</Button>
			<Button onclick={handleUpload} disabled={uploadLoading || uploadFiles.length === 0}>
				{#if uploadLoading}
					<LoaderIcon class="mr-2 size-4 animate-spin" />
				{/if}
				{m.media_upload_action()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<VideoEditorDialog
	bind:open={uploadVideoEditorOpen}
	file={uploadVideoEditorFile}
	onConfirm={useEditedLibraryVideo}
	onSkip={useEditedLibraryVideo}
/>

<Dialog.Root bind:open={cameraDialogOpen}>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{m.media_take_photo()}</Dialog.Title>
			<Dialog.Description>{m.media_camera_body()}</Dialog.Description>
		</Dialog.Header>
		<CameraCapture onCapture={saveCameraPhoto} onCancel={() => (cameraDialogOpen = false)} />
		{#if cameraUploading}
			<p class="text-sm text-muted-foreground" aria-live="polite">{m.media_saving_photo()}</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Usage Dialog -->
<Dialog.Root open={usageDialogOpen} onOpenChange={handleUsageDialogOpenChange}>
	<Dialog.Content class="max-h-[min(860px,calc(100dvh-2rem))] overflow-y-auto sm:max-w-3xl sm:p-6">
		<Dialog.Header class="border-b pr-10 pb-4">
			<Dialog.Title>{selectedMedia?.original_filename || m.media_details()}</Dialog.Title>
			<Dialog.Description>
				{#if selectedMedia}
					{usageSummaryLabel(selectedMedia.usage_count)}
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if selectedMedia}
			<div class="grid items-start gap-6 py-2 md:grid-cols-[18rem_minmax(0,1fr)]">
				<figure
					class="overflow-hidden rounded-xl bg-muted/20 ring-1 ring-foreground/10 md:sticky md:top-0"
				>
					{#if isImage(selectedMedia.mime_type)}
						<img
							src={getAuthenticatedMediaURL(selectedMedia.thumbnail_url || selectedMedia.url)}
							alt={selectedMedia.alt_text || selectedMedia.original_filename}
							class="aspect-[4/3] size-full object-contain"
						/>
					{:else if isVideo(selectedMedia.mime_type)}
						<video
							src={getAuthenticatedMediaURL(selectedMedia.url)}
							class="aspect-[4/3] size-full object-contain"
							controls
							muted
							playsinline
						></video>
					{:else if isAudio(selectedMedia.mime_type)}
						<div class="flex aspect-[4/3] flex-col items-center justify-center gap-4 p-5">
							<FileAudioIcon class="size-12 text-muted-foreground" />
							<audio src={getAuthenticatedMediaURL(selectedMedia.url)} class="w-full" controls
							></audio>
						</div>
					{/if}
					<figcaption class="border-t px-3 py-2 text-xs text-muted-foreground">
						{selectedMedia.width || '—'} × {selectedMedia.height || '—'} ·
						{formatSize(selectedMedia.size)}
					</figcaption>
				</figure>
				<div class="min-w-0 space-y-5">
					<dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
						<div>
							<dt class="text-xs text-muted-foreground">{m.media_type()}</dt>
							<dd class="mt-0.5 break-words">{selectedMedia.mime_type}</dd>
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">{m.media_source()}</dt>
							<dd class="mt-0.5">{mediaSourceLabel(selectedMedia.source)}</dd>
						</div>
						<div>
							<dt class="text-xs text-muted-foreground">{m.media_created()}</dt>
							<dd class="mt-0.5">{formatDate(selectedMedia.created_at)}</dd>
						</div>
						{#if selectedMedia.design_document_id}
							<div>
								<dt class="text-xs text-muted-foreground">{m.media_design()}</dt>
								<dd class="mt-0.5">
									<a
										href={resolve(`/image-editor/${selectedMedia.design_document_id}` as '/')}
										class="font-medium text-primary hover:underline"
									>
										{m.media_open_design()}
									</a>
								</dd>
							</div>
						{/if}
						{#if selectedMedia.parent_media_id}
							<div class="sm:col-span-2">
								<dt class="text-xs text-muted-foreground">{m.media_original()}</dt>
								<dd class="mt-0.5 font-mono text-xs break-all">
									{selectedMedia.parent_media_id}
								</dd>
							</div>
						{/if}
						{#if isVideo(selectedMedia.mime_type)}
							<div>
								<dt class="text-xs text-muted-foreground">{m.media_duration()}</dt>
								<dd class="mt-0.5">{formatVideoDuration(selectedMedia.duration_ms)}</dd>
							</div>
							<div>
								<dt class="text-xs text-muted-foreground">{m.media_video_format()}</dt>
								<dd class="mt-0.5">
									{[
										selectedMedia.container_format,
										selectedMedia.video_codec,
										selectedMedia.audio_codec
									]
										.filter(Boolean)
										.join(' · ') || '—'}
								</dd>
							</div>
							{#if selectedMedia.processing_status === 'failed' || selectedMedia.analysis_status === 'failed'}
								<div class="sm:col-span-2">
									<InlineNotice
										tone="error"
										message={selectedMedia.analysis_error || m.media_video_processing_failed()}
									>
										{#snippet actions()}
											{#if mediaCanEdit}
												<Button
													type="button"
													variant="outline"
													size="sm"
													onclick={() => retryVideoAnalysis(selectedMedia!)}
												>
													{m.common_retry()}
												</Button>
											{/if}
										{/snippet}
									</InlineNotice>
								</div>
							{/if}
						{/if}
						<div class="sm:col-span-2">
							<dt class="text-xs text-muted-foreground">{m.media_tags()}</dt>
							<dd class="mt-1.5 flex flex-wrap items-center gap-1.5">
								{#each selectedMedia.tags as tagID (tagID)}
									{@const tag = tags.find((item) => item.id === tagID)}
									{#if tag}
										<span class="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium"
											>#{tag.name}</span
										>
									{/if}
								{/each}
								{#if mediaCanEdit}
									<MediaTagPicker
										{tags}
										selectedIds={selectedMedia.tags}
										canEdit
										onToggle={(tagID, selected) =>
											toggleMediaTag(selectedMedia!.id, tagID, selected)}
										onCreate={(name) => createAndAssignTag(selectedMedia!.id, name)}
									/>
								{/if}
							</dd>
						</div>
					</dl>
					<div class="space-y-2">
						<label for="media-detail-alt-text" class="block text-sm font-medium">
							{m.media_alt_text()}
						</label>
						<Textarea
							id="media-detail-alt-text"
							class="min-h-24 p-3 font-normal"
							bind:value={detailAltText}
							placeholder={m.media_alt_placeholder()}
							disabled={!mediaCanEdit || detailSaving}
						/>
						{#if mediaCanEdit && detailAltText.trim() !== selectedMedia.alt_text}
							<Button
								size="sm"
								variant="outline"
								onclick={saveDetailAltText}
								disabled={detailSaving}
							>
								{#if detailSaving}<LoaderIcon class="animate-spin" />{/if}
								{m.media_save_alt()}
							</Button>
						{/if}
					</div>
				</div>
			</div>
			<div class="flex flex-wrap gap-2 border-y py-3">
				{#if isImage(selectedMedia.mime_type) && mediaCanEdit && imageEditorEnabled}
					<Button
						variant="outline"
						size="sm"
						onclick={() => openMediaInImageEditor(selectedMedia!)}
					>
						<PaletteIcon />
						{m.media_edit_image_editor()}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={() => openMediaInImageEditor(selectedMedia!, 'remove-background')}
					>
						<ImageIcon />
						{m.image_editor_remove_background()}
					</Button>
				{/if}
				{#if isVideo(selectedMedia.mime_type) && mediaCanEdit && videoEditorEnabled}
					<Button
						variant="outline"
						size="sm"
						onclick={() => openMediaInVideoEditor(selectedMedia!)}
					>
						<VideoIcon />
						{m.media_edit_video_editor()}
					</Button>
				{/if}
				{#if mediaCanEdit}
					<Button variant="outline" size="sm" onclick={() => duplicateMedia(selectedMedia!)}>
						<Grid2X2Icon />
						{m.image_editor_duplicate()}
					</Button>
				{/if}
				<Button variant="outline" size="sm" onclick={() => downloadMedia(selectedMedia!)}>
					<DownloadIcon />
					{m.image_editor_download()}
				</Button>
				{#if mediaCanEdit}
					<Button
						variant="destructive"
						size="sm"
						disabled={!canDeleteMedia(selectedMedia)}
						title={!canDeleteMedia(selectedMedia) ? m.media_delete_blocked() : undefined}
						onclick={() => requestDeleteMedia(selectedMedia!)}
					>
						<TrashIcon />
						{m.common_delete()}
					</Button>
				{/if}
				{#if mediaCanEdit && !canDeleteMedia(selectedMedia)}
					<p class="basis-full text-xs text-muted-foreground">
						{m.media_delete_blocked()}
					</p>
				{/if}
			</div>
		{/if}

		<div class="space-y-2 py-4">
			<h3 class="text-sm font-semibold">{m.media_used_by()}</h3>
			{#if usageLoading}
				<div class="py-4">
					<PageLoading layout="list" label={m.common_loading()} items={3} />
				</div>
			{:else if usageError}
				<InlineNotice tone="error" message={usageError}>
					{#snippet actions()}
						<Button
							variant="outline"
							size="sm"
							onclick={() => selectedMedia && showUsage(selectedMedia)}
						>
							{m.common_retry()}
						</Button>
					{/snippet}
				</InlineNotice>
			{:else if mediaUsage.length === 0}
				<p class="py-8 text-center text-sm text-muted-foreground">
					{m.media_usage_empty()}
				</p>
			{:else}
				{#each mediaUsage as usage (`${usage.kind}-${usage.id}`)}
					<div class="rounded-lg border p-3">
						<p class="line-clamp-2 text-sm font-medium">{usage.label || usage.content}</p>
						<p class="mt-1 text-xs text-muted-foreground">{mediaUsageKindLabel(usage.kind)}</p>
						<div class="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
							{#if usage.status}
								<span class="rounded-full bg-muted px-2 py-0.5 text-xs">
									{mediaUsageStatusLabel(usage.status)}
								</span>
							{/if}
							{#if usage.scheduled_at}
								<span
									>{new Date(usage.scheduled_at).toLocaleString(getLocaleTag(), {
										timeZone: workspaceCtx.settings.timezone || 'UTC'
									})}</span
								>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => handleUsageDialogOpenChange(false)}
				>{m.common_close()}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.media-card-control {
		width: 2rem;
		height: 2rem;
	}

	@media (pointer: coarse) {
		.media-card-control {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
</style>
