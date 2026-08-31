<!-- Media pool list: imported sources with probe status; click adds to timeline -->
<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import {
		clearActiveMediaDrag,
		mediaDragData,
		writeMediaDragData
	} from '$lib/video-editor/media/media-drag';
	import { mediaPlacement } from '$lib/video-editor/media/media-placement.svelte';
	import { getMediaObjectUrl } from '$lib/video-editor/media/media-source';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import {
		deleteSequences,
		duplicateSequence,
		renameSequence,
		sequenceDeletionImpact,
		sequenceDeletionImpactFor,
		switchSequence
	} from '$lib/video-editor/sequences/sequence-actions';
	import {
		compoundThumbnailService,
		compoundThumbnailSignature
	} from '$lib/video-editor/sequences/compound-thumbnail';
	import { showToast } from '$lib/toast';
	import FilmIcon from '@lucide/svelte/icons/film';
	import ImageIcon from '@lucide/svelte/icons/image-plus';
	import LinkIcon from '@lucide/svelte/icons/link';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import Music2Icon from '@lucide/svelte/icons/music-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import XIcon from '@lucide/svelte/icons/x';
	import LayersIcon from '@lucide/svelte/icons/layers-3';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import MoreIcon from '@lucide/svelte/icons/ellipsis';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import ScanLineIcon from '@lucide/svelte/icons/scan-line';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import GridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import { Button } from '$lib/components/ui/button';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { Input } from '$lib/components/ui/input';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Select from '$lib/components/ui/select';
	import { Slider } from '$lib/components/ui/slider';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { canExtractEmbeddedSubtitles } from '$lib/video-editor/media/embedded-subtitle-service';
	import type { MediaMetadata } from '$lib/video-editor/media/types';
	import { readBlob } from '$lib/video-editor/workspace-fs/fs-primitives';
	import { requireWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
	import { mediaThumbnailPath } from '$lib/video-editor/workspace-fs/paths';
	import {
		filterAndSortMedia,
		formatMediaBytes,
		formatMediaListSummary,
		groupMediaByKind,
		mediaLibraryGridTemplate,
		type MediaLibraryFilter,
		type MediaLibraryKind,
		type MediaLibrarySort
	} from '$lib/video-editor/media/library-view';
	import { importMediaFromUrl } from '$lib/video-editor/media/import-url';
	import MediaInfoPopover from './media-info-popover.svelte';
	import MediaUrlImportDialog from './media-url-import-dialog.svelte';
	import { mediaRecovery } from '$lib/video-editor/media/media-recovery.svelte';
	import type { MediaSourceIssue } from '$lib/video-editor/media/media-recovery';
	import {
		relinkMediaSource,
		requestMediaSourceAccess
	} from '$lib/video-editor/media/media-source-recovery';
	import type { SubComposition } from '$lib/video-editor/project/types';
	import { upscaleService } from '$lib/video-editor/media/processing/upscale/upscale-service.svelte';
	import type { UpscaleVariant } from '$lib/video-editor/media/processing/upscale/upscale-variant';
	import { frameInterpolationService } from '$lib/video-editor/media/processing/interpolation/frame-interpolation-service.svelte';
	import {
		SUPPORTED_INTERPOLATION_FACTORS,
		type InterpolationFactor
	} from '$lib/video-editor/media/processing/interpolation/interpolation-factor';
	import { mediaTaskId, mediaTasks } from '$lib/video-editor/media/media-tasks.svelte';
	import {
		cachedProxy,
		clearProxyCache,
		getAutomaticProxy
	} from '$lib/video-editor/media/proxy-client';
	import {
		MediaImportCancelledError,
		type UnsupportedAudioImportRequest
	} from '$lib/video-editor/media/import.svelte';
	import { sceneBrowser } from '$lib/video-editor/media/scene-search/scene-browser.svelte';
	import { isSceneAnalyzableMedia } from '$lib/video-editor/media/scene-search/scene-analysis-client';
	import {
		planMediaDeletion,
		type MediaDeletionPlan
	} from '$lib/video-editor/media/media-deletion';
	import { removePlannedMediaReferences } from '$lib/video-editor/media/media-deletion-action';
	import { deleteMediaFromProject } from '$lib/video-editor/media/project-media-delete';
	import {
		captureSnapshot,
		restoreSnapshot
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
	import {
		sourceTranscriptionTaskId,
		transcriptionService
	} from '$lib/video-editor/transcript/transcription-service.svelte';
	import { editorSettings } from '$lib/video-editor/settings/editor-settings.svelte';
	import {
		createAssetLibrarySelectionController,
		type AssetLibrarySelection
	} from '$lib/video-editor/media/asset-library-selection';

	let {
		projectId,
		onsequenceopen = () => undefined,
		onsourceopen = () => undefined,
		onextractsubtitles = () => undefined,
		onimport,
		onUnsupportedAudio,
		deleteProjectMedia = deleteMediaFromProject,
		generateMediaProxy = getAutomaticProxy,
		requestSourceAccess = requestMediaSourceAccess,
		pickSourceHandle = async () => (await window.showOpenFilePicker?.({ multiple: false }))?.[0],
		relinkSourceMedia = relinkMediaSource
	}: {
		projectId: string;
		onsequenceopen?: () => void;
		onsourceopen?: (mediaId: string) => void;
		onextractsubtitles?: (media: MediaMetadata) => void;
		onimport?: () => void;
		onUnsupportedAudio?: (request: UnsupportedAudioImportRequest) => Promise<'import' | 'cancel'>;
		deleteProjectMedia?: typeof deleteMediaFromProject;
		generateMediaProxy?: typeof getAutomaticProxy;
		requestSourceAccess?: typeof requestMediaSourceAccess;
		pickSourceHandle?: () => Promise<FileSystemFileHandle | undefined>;
		relinkSourceMedia?: typeof relinkMediaSource;
	} = $props();
	let recoveryBusyIds = $state<Set<string>>(new Set());
	const sourceIssuesByMediaId = $derived(
		new Map(mediaRecovery.sourceIssues.map((issue) => [issue.mediaId, issue]))
	);

	let objectUrls = $state<Record<string, string>>({});
	let urlImportOpen = $state(false);
	let query = $state('');
	let filter = $state<MediaLibraryFilter>('all');
	let sort = $state<MediaLibrarySort>('added');
	let selectedMediaIds = $state<Set<string>>(new Set());
	let selectionAnchorId = $state<string | null>(null);
	let selectedSequenceIds = $state<Set<string>>(new Set());
	let sequenceSelectionAnchorId = $state<string | null>(null);
	let sequenceThumbnailUrls = $state<Record<string, string>>({});
	let sequenceThumbnailGeneration = 0;
	let deleteTargets = $state<SubComposition[]>([]);
	let editingSequenceId = $state<string | null>(null);
	let sequenceNameDraft = $state('');
	let sequenceRenameInput = $state<HTMLInputElement | null>(null);
	let sequenceRenameCancelled = false;
	let deleteReferenceCount = $state(0);
	let deleteDialogOpen = $state(false);
	let mediaDeleteTargets = $state<MediaMetadata[]>([]);
	let mediaDeletePlan = $state<MediaDeletionPlan | null>(null);
	let mediaDeleteDialogOpen = $state(false);
	let assetMarqueeSelection = $state<AssetLibrarySelection | null>(null);
	const assetViewMode = $derived(editorSettings.mediaLibraryViewMode);
	const assetGridSize = $derived(editorSettings.mediaLibraryItemSize);
	const assetGridTemplate = $derived(mediaLibraryGridTemplate(assetGridSize));
	const ownedThumbnailUrls = new Map<string, string>();
	let loadedThumbnailRevision = -1;
	const visibleMedia = $derived(filterAndSortMedia(mediaPool.mediaList, query, filter, sort));
	const mediaGroups = $derived(groupMediaByKind(visibleMedia));
	const selectedMedia = $derived(
		mediaPool.mediaList.filter((media) => selectedMediaIds.has(media.id))
	);
	const selectedProxyMedia = $derived(
		selectedMedia.filter(
			(media) =>
				canGenerateProxy(media) &&
				!sourceIssue(media.id) &&
				!mediaProxy(media.id) &&
				!proxyTask(media.id) &&
				!otherMediaProcessing(media.id)
		)
	);
	const selectedSequences = $derived(
		sequenceStore.compositions.filter((sequence) => selectedSequenceIds.has(sequence.id))
	);
	const selectedAssetCount = $derived(selectedMedia.length + selectedSequences.length);

	$effect(() => {
		const availableIds = new Set(visibleMedia.map((media) => media.id));
		if ([...selectedMediaIds].every((id) => availableIds.has(id))) return;
		selectedMediaIds = new Set([...selectedMediaIds].filter((id) => availableIds.has(id)));
		if (selectionAnchorId && !availableIds.has(selectionAnchorId)) selectionAnchorId = null;
	});

	$effect(() => {
		const availableIds = new Set(sequenceStore.compositions.map((sequence) => sequence.id));
		if ([...selectedSequenceIds].every((id) => availableIds.has(id))) return;
		selectedSequenceIds = new Set([...selectedSequenceIds].filter((id) => availableIds.has(id)));
		if (sequenceSelectionAnchorId && !availableIds.has(sequenceSelectionAnchorId)) {
			sequenceSelectionAnchorId = null;
		}
	});

	function clearMediaSelection(): void {
		selectedMediaIds = new Set();
		selectionAnchorId = null;
	}

	function clearSequenceSelection(): void {
		selectedSequenceIds = new Set();
		sequenceSelectionAnchorId = null;
	}

	function clearAssetSelection(): void {
		clearMediaSelection();
		clearSequenceSelection();
	}

	function assetMarqueePreviewSelected(kind: 'media' | 'sequence', id: string): boolean {
		return Boolean(
			kind === 'media'
				? assetMarqueeSelection?.mediaIds.has(id)
				: assetMarqueeSelection?.sequenceIds.has(id)
		);
	}

	const assetSelectionController = createAssetLibrarySelectionController({
		getSelection: () => ({
			mediaIds: new Set(selectedMediaIds),
			sequenceIds: new Set(selectedSequenceIds)
		}),
		getVisibleSelection: () => ({
			mediaIds: new Set(visibleMedia.map((media) => media.id)),
			sequenceIds: new Set(sequenceStore.compositions.map((sequence) => sequence.id))
		}),
		setSelection: (selection) => {
			selectedMediaIds = selection.mediaIds;
			selectedSequenceIds = selection.sequenceIds;
			selectionAnchorId = null;
			sequenceSelectionAnchorId = null;
		},
		clearSelection: clearAssetSelection,
		requestDelete: confirmSelectedAssetDelete,
		interactionBlocked: () =>
			Boolean(urlImportOpen || mediaDeleteDialogOpen || deleteDialogOpen || editingSequenceId),
		onMarqueeSelectionChange: (selection) => {
			assetMarqueeSelection = selection;
		}
	});

	function assetSelectionSurfaceAction(node: HTMLElement): { destroy(): void } {
		return assetSelectionController.connect(node);
	}

	function selectMedia(event: MouseEvent, media: MediaMetadata): void {
		const next = new Set(selectedMediaIds);
		if (event.shiftKey && selectionAnchorId) {
			const from = visibleMedia.findIndex((candidate) => candidate.id === selectionAnchorId);
			const to = visibleMedia.findIndex((candidate) => candidate.id === media.id);
			if (from >= 0 && to >= 0) {
				const start = Math.min(from, to);
				const end = Math.max(from, to);
				if (!event.metaKey && !event.ctrlKey) next.clear();
				for (const candidate of visibleMedia.slice(start, end + 1)) next.add(candidate.id);
			}
			if (!event.metaKey && !event.ctrlKey) clearSequenceSelection();
		} else if (event.metaKey || event.ctrlKey) {
			if (next.has(media.id)) next.delete(media.id);
			else next.add(media.id);
		} else {
			next.clear();
			next.add(media.id);
			clearSequenceSelection();
			onsourceopen(media.id);
		}
		selectedMediaIds = next;
		selectionAnchorId = media.id;
		assetSelectionController.focus();
	}

	function prepareMediaContextSelection(mediaId: string): void {
		if (selectedMediaIds.has(mediaId)) return;
		selectedMediaIds = new Set([mediaId]);
		selectionAnchorId = mediaId;
		clearSequenceSelection();
	}

	function selectSequence(event: MouseEvent, sequence: SubComposition): void {
		const next = new Set(selectedSequenceIds);
		if (event.shiftKey && sequenceSelectionAnchorId) {
			const from = sequenceStore.compositions.findIndex(
				(candidate) => candidate.id === sequenceSelectionAnchorId
			);
			const to = sequenceStore.compositions.findIndex((candidate) => candidate.id === sequence.id);
			if (from >= 0 && to >= 0) {
				const start = Math.min(from, to);
				const end = Math.max(from, to);
				if (!event.metaKey && !event.ctrlKey) next.clear();
				for (const candidate of sequenceStore.compositions.slice(start, end + 1)) {
					next.add(candidate.id);
				}
			}
			if (!event.metaKey && !event.ctrlKey) clearMediaSelection();
		} else if (event.metaKey || event.ctrlKey) {
			if (next.has(sequence.id)) next.delete(sequence.id);
			else next.add(sequence.id);
		} else {
			next.clear();
			next.add(sequence.id);
			clearMediaSelection();
			openSequence(sequence.id);
		}
		selectedSequenceIds = next;
		sequenceSelectionAnchorId = sequence.id;
		assetSelectionController.focus();
	}

	function prepareSequenceContextSelection(sequenceId: string): void {
		if (selectedSequenceIds.has(sequenceId)) return;
		selectedSequenceIds = new Set([sequenceId]);
		sequenceSelectionAnchorId = sequenceId;
		clearMediaSelection();
	}
	async function previewUrl(id: string): Promise<void> {
		const media = mediaPool.get(id);
		if (!media || objectUrls[id]) return;
		try {
			const thumbnail = await readBlob(requireWorkspaceRoot(), mediaThumbnailPath(id));
			if (thumbnail) {
				const thumbnailUrl = URL.createObjectURL(thumbnail);
				const previous = ownedThumbnailUrls.get(id);
				if (previous) URL.revokeObjectURL(previous);
				ownedThumbnailUrls.set(id, thumbnailUrl);
				objectUrls[id] = thumbnailUrl;
			} else if (media.tags.includes('image')) {
				objectUrls[id] = await getMediaObjectUrl(media);
			}
		} catch {
			// Preview unavailable; tile stays generic.
		}
	}

	function syncThumbnails(revision: number, ids: readonly string[]): void {
		if (revision !== loadedThumbnailRevision) {
			loadedThumbnailRevision = revision;
			for (const url of ownedThumbnailUrls.values()) URL.revokeObjectURL(url);
			ownedThumbnailUrls.clear();
			objectUrls = {};
		}
		const activeIds = new Set(ids);
		for (const [id, url] of ownedThumbnailUrls) {
			if (activeIds.has(id)) continue;
			URL.revokeObjectURL(url);
			ownedThumbnailUrls.delete(id);
			delete objectUrls[id];
		}
		for (const id of ids) void previewUrl(id);
	}

	$effect(() => {
		syncThumbnails(mediaPool.thumbnailRevision, mediaPool.order);
	});

	$effect(() => {
		const mediaIds = [...mediaPool.order];
		untrack(() => {
			for (const mediaId of mediaIds) {
				void transcriptionService.hydrateSourceTranscript(mediaId).catch(() => undefined);
			}
		});
	});

	interface SequenceThumbnailRequest {
		id: string;
		signature: string;
	}

	async function syncSequenceThumbnails(
		requests: readonly SequenceThumbnailRequest[]
	): Promise<void> {
		const generation = ++sequenceThumbnailGeneration;
		const entries = await Promise.all(
			requests.map(
				async ({ id, signature }) =>
					[id, await compoundThumbnailService.getThumbnailUrl(id, signature)] as const
			)
		);
		if (generation !== sequenceThumbnailGeneration) return;
		sequenceThumbnailUrls = Object.fromEntries(
			entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
		);
	}

	$effect(() => {
		const compositions = sequenceStore.compositions;
		const compositionsById = new Map(
			compositions.map((composition) => [composition.id, composition])
		);
		const requests = compositions.map((composition) => ({
			id: composition.id,
			signature: compoundThumbnailSignature(composition.id, compositionsById)
		}));
		untrack(() => void syncSequenceThumbnails(requests));
	});

	onDestroy(() => {
		sequenceThumbnailGeneration += 1;
		compoundThumbnailService.clearAll();
		for (const url of ownedThumbnailUrls.values()) URL.revokeObjectURL(url);
		ownedThumbnailUrls.clear();
		clearActiveMediaDrag();
	});

	function startMediaDrag(event: DragEvent, media: MediaMetadata): void {
		if (!event.dataTransfer) return;
		writeMediaDragData(event.dataTransfer, mediaDragData('media', media.id, media.fileName));
	}

	function startCompositionDrag(event: DragEvent, composition: SubComposition): void {
		if (!event.dataTransfer) return;
		writeMediaDragData(
			event.dataTransfer,
			mediaDragData('composition', composition.id, composition.name)
		);
	}

	function placeMedia(media: MediaMetadata): void {
		mediaPlacement.begin(mediaDragData('media', media.id, media.fileName));
	}

	function groupLabel(kind: MediaLibraryKind): string {
		switch (kind) {
			case 'video':
				return m.video_editor_media_filter_video();
			case 'audio':
				return m.video_editor_media_filter_audio();
			case 'image':
				return m.video_editor_media_filter_image();
			case 'lottie':
				return m.video_editor_media_filter_lottie();
			default:
				return m.video_editor_media_filter_other();
		}
	}

	function changeFilter(value: string | undefined): void {
		if (
			value === 'all' ||
			value === 'video' ||
			value === 'audio' ||
			value === 'image' ||
			value === 'lottie'
		) {
			filter = value;
		}
	}

	function changeSort(value: string | undefined): void {
		if (value === 'added' || value === 'name' || value === 'duration' || value === 'size') {
			sort = value;
		}
	}

	async function importUrl(url: string): Promise<void> {
		let id: string;
		try {
			id = await importMediaFromUrl(url, {
				projectId,
				storageMode: 'copy',
				onUnsupportedAudio
			});
		} catch (error) {
			if (error instanceof MediaImportCancelledError) return;
			throw error;
		}
		const imported = mediaPool.get(id);
		showToast(m.video_editor_media_import_url_done({ name: imported?.fileName ?? id }), 'success');
	}

	function mediaProcessing(mediaId: string): boolean {
		return Boolean(
			recoveryBusyIds.has(mediaId) ||
			mediaTasks.get(mediaTaskId('upscale', mediaId)) ||
			mediaTasks.get(mediaTaskId('frame-interpolation', mediaId)) ||
			mediaTasks.get(mediaTaskId('scene-analysis', mediaId)) ||
			mediaTasks.get(mediaTaskId('proxy', mediaId)) ||
			sourceTranscriptTask(mediaId)
		);
	}

	function sourceIssue(mediaId: string): MediaSourceIssue | undefined {
		return sourceIssuesByMediaId.get(mediaId);
	}

	function sourceIssueLabel(issue: MediaSourceIssue): string {
		switch (issue.kind) {
			case 'permission':
				return m.video_editor_media_recovery_permission();
			case 'changed':
				return m.video_editor_media_recovery_changed();
			default:
				return m.video_editor_media_recovery_missing();
		}
	}

	function setRecoveryBusy(mediaId: string, busy: boolean): void {
		const next = new Set(recoveryBusyIds);
		if (busy) next.add(mediaId);
		else next.delete(mediaId);
		recoveryBusyIds = next;
	}

	async function grantSourceAccess(media: MediaMetadata): Promise<void> {
		if (recoveryBusyIds.has(media.id)) return;
		setRecoveryBusy(media.id, true);
		try {
			if (!(await requestSourceAccess(media))) {
				showToast(m.video_editor_media_recovery_access_denied(), 'error');
				return;
			}
			await mediaRecovery.refresh();
			showToast(m.video_editor_media_recovery_restored({ name: media.fileName }), 'success');
		} catch (error) {
			processFailure(media, error instanceof Error ? error : new Error(String(error)));
		} finally {
			setRecoveryBusy(media.id, false);
		}
	}

	async function locateSourceFile(media: MediaMetadata): Promise<void> {
		if (recoveryBusyIds.has(media.id)) return;
		setRecoveryBusy(media.id, true);
		try {
			const handle = await pickSourceHandle();
			if (!handle) return;
			const restored = await relinkSourceMedia(media, handle);
			await mediaRecovery.refresh();
			showToast(m.video_editor_media_recovery_restored({ name: restored.fileName }), 'success');
		} catch (error) {
			processFailure(media, error instanceof Error ? error : new Error(String(error)));
		} finally {
			setRecoveryBusy(media.id, false);
		}
	}

	function sourceTranscriptTask(mediaId: string) {
		return mediaTasks.get(sourceTranscriptionTaskId(mediaId));
	}

	function canTranscribeSource(media: MediaMetadata): boolean {
		return (
			(media.mimeType.startsWith('audio/') || media.mimeType.startsWith('video/')) &&
			media.audioCodecSupported !== false
		);
	}

	function otherMediaProcessingForTranscript(mediaId: string): boolean {
		return Boolean(
			recoveryBusyIds.has(mediaId) ||
			mediaTasks.get(mediaTaskId('upscale', mediaId)) ||
			mediaTasks.get(mediaTaskId('frame-interpolation', mediaId)) ||
			mediaTasks.get(mediaTaskId('scene-analysis', mediaId)) ||
			mediaTasks.get(mediaTaskId('proxy', mediaId))
		);
	}

	function sourceTranscriptActionLabel(mediaId: string): string {
		const task = sourceTranscriptTask(mediaId);
		if (task?.status === 'cancelling') return m.video_editor_task_cancelling();
		if (task) return m.video_editor_transcribe_cancel();
		const status = transcriptionService.sourceTranscriptStatus(mediaId);
		if (status === 'loading') return m.video_editor_source_transcript_loading();
		return status === 'ready'
			? m.video_editor_source_transcript_refresh()
			: m.video_editor_source_transcript_generate();
	}

	async function runSourceTranscriptAction(media: MediaMetadata): Promise<void> {
		const task = sourceTranscriptTask(media.id);
		if (task) {
			transcriptionService.cancelForMedia(media.id);
			return;
		}
		try {
			await transcriptionService.enqueueMedia(media.id, {
				model: editorSettings.defaultTranscriptionModel,
				language: editorSettings.defaultTranscriptionLanguage || undefined,
				quantization: editorSettings.defaultTranscriptionQuantization
			});
			showToast(m.video_editor_source_transcript_ready({ name: media.fileName }), 'success');
		} catch (error) {
			processFailure(media, error instanceof Error ? error : new Error(String(error)));
		}
	}

	async function removeSourceTranscript(media: MediaMetadata): Promise<void> {
		try {
			await transcriptionService.deleteMediaTranscript(media.id);
			showToast(m.video_editor_source_transcript_deleted({ name: media.fileName }), 'success');
		} catch (error) {
			processFailure(media, error instanceof Error ? error : new Error(String(error)));
		}
	}

	function canGenerateProxy(media: MediaMetadata): boolean {
		return media.mimeType.startsWith('video/') || media.tags.includes('video');
	}

	function mediaProxy(mediaId: string): Blob | null {
		return cachedProxy(mediaId);
	}

	function proxyTask(mediaId: string) {
		return mediaTasks.get(mediaTaskId('proxy', mediaId));
	}

	function otherMediaProcessing(mediaId: string): boolean {
		return Boolean(
			recoveryBusyIds.has(mediaId) ||
			mediaTasks.get(mediaTaskId('upscale', mediaId)) ||
			mediaTasks.get(mediaTaskId('frame-interpolation', mediaId)) ||
			mediaTasks.get(mediaTaskId('scene-analysis', mediaId)) ||
			sourceTranscriptTask(mediaId)
		);
	}

	async function generateProxy(media: MediaMetadata): Promise<void> {
		try {
			await generateMediaProxy(media);
			showToast(m.video_editor_proxy_done(), 'success');
		} catch (error) {
			processFailure(media, error instanceof Error ? error : new Error(String(error)));
		}
	}

	function removeProxy(media: MediaMetadata): void {
		const proxy = mediaProxy(media.id);
		if (!proxy || !clearProxyCache(media.id)) return;
		showToast(m.video_editor_proxy_removed({ size: formatMediaBytes(proxy.size) }), 'success');
	}

	function runProxyAction(media: MediaMetadata): void {
		const task = proxyTask(media.id);
		if (task) {
			mediaTasks.cancel(task.id);
			return;
		}
		if (mediaProxy(media.id)) {
			removeProxy(media);
			return;
		}
		void generateProxy(media);
	}

	function proxyActionLabel(media: MediaMetadata): string {
		const task = proxyTask(media.id);
		if (task?.status === 'cancelling') return m.video_editor_task_cancelling();
		if (task) return m.video_editor_proxy_cancel();
		return mediaProxy(media.id) ? m.video_editor_proxy_remove() : m.video_editor_proxy_generate();
	}

	function upscaleActionLabel(media: MediaMetadata): string {
		if (mediaProcessing(media.id)) {
			return m.video_editor_media_tool_busy({ tool: m.video_editor_media_upscale() });
		}
		if (!upscaleService.canUpscaleMedia(media)) {
			return m.video_editor_media_upscale_too_large();
		}
		return m.video_editor_media_upscale();
	}

	function interpolationActionLabel(media: MediaMetadata): string {
		if (mediaProcessing(media.id)) {
			return m.video_editor_media_tool_busy({ tool: m.video_editor_media_interpolate() });
		}
		if (!frameInterpolationService.canInterpolateMedia(media)) {
			return m.video_editor_media_interpolate_unknown_fps();
		}
		return m.video_editor_media_interpolate();
	}

	function processFailure(media: MediaMetadata, error: Error): void {
		if (error instanceof DOMException && error.name === 'AbortError') return;
		showToast(
			m.video_editor_media_process_failed({
				name: media.fileName,
				reason: error.message
			}),
			'error'
		);
	}

	async function upscaleMedia(media: MediaMetadata, variant: UpscaleVariant): Promise<void> {
		try {
			const generated = await upscaleService.generate(media, projectId, variant);
			showToast(m.video_editor_media_upscale_done({ name: generated.fileName }), 'success');
		} catch (error) {
			processFailure(media, error instanceof Error ? error : new Error(String(error)));
		}
	}

	async function interpolateMedia(
		media: MediaMetadata,
		factor: InterpolationFactor
	): Promise<void> {
		try {
			const generated = await frameInterpolationService.generate(media, projectId, factor);
			showToast(m.video_editor_media_interpolate_done({ name: generated.fileName }), 'success');
		} catch (error) {
			processFailure(media, error instanceof Error ? error : new Error(String(error)));
		}
	}

	function sceneAnalysisLabel(media: MediaMetadata): string {
		if (sceneBrowser.progress(media.id)) return m.video_editor_media_cancel_ai_analysis();
		return sceneBrowser.analysis(media.id)
			? m.video_editor_media_reanalyze_ai()
			: m.video_editor_media_analyze_ai();
	}

	async function analyzeMedia(media: MediaMetadata): Promise<void> {
		if (sceneBrowser.progress(media.id)) {
			sceneBrowser.cancel(media.id);
			return;
		}
		try {
			const analysis = await sceneBrowser.analyze(media, Boolean(sceneBrowser.analysis(media.id)));
			showToast(
				m.video_editor_media_analysis_done({
					name: media.fileName,
					count: analysis.scenes.length
				}),
				'success'
			);
		} catch (error) {
			processFailure(media, error instanceof Error ? error : new Error(String(error)));
		}
	}

	function confirmMediaDelete(media: MediaMetadata): void {
		deleteTargets = [];
		mediaDeleteTargets = [media];
		mediaDeletePlan = planMediaDeletion(sequenceStore.projectTimeline(), [media.id]);
		mediaDeleteDialogOpen = true;
	}

	function confirmSelectedMediaDelete(): void {
		if (selectedMedia.length === 0) return;
		deleteTargets = [];
		mediaDeleteTargets = [...selectedMedia];
		mediaDeletePlan = planMediaDeletion(
			sequenceStore.projectTimeline(),
			mediaDeleteTargets.map((media) => media.id)
		);
		mediaDeleteDialogOpen = true;
	}

	async function generateSelectedProxies(): Promise<void> {
		await Promise.all(selectedProxyMedia.map((media) => generateProxy(media)));
	}

	async function deleteConfirmedMedia(): Promise<{ ok: boolean; message?: string }> {
		const targets = [...mediaDeleteTargets];
		const sequenceTargets = [...deleteTargets];
		if (targets.length === 0) return { ok: false, message: m.video_editor_media_delete_failed() };
		const originalSequenceId = sequenceStore.activeSequenceId;
		const beforeProject = sequenceStore.projectTimeline();
		const beforeResolution = sequenceStore.rootResolution;
		const plan = planMediaDeletion(
			beforeProject,
			targets.map((media) => media.id)
		);
		const before = captureSnapshot();
		mediaDeletePlan = plan;
		let projectSaved = false;
		let sequencesDeleted = false;
		try {
			editorSession.pausePlayback();
			removePlannedMediaReferences(plan);
			if (sequenceTargets.length > 0) {
				const removedSequences = deleteSequences(sequenceTargets.map((sequence) => sequence.id));
				if (removedSequences.length !== sequenceTargets.length) {
					throw new Error(m.video_editor_sequence_delete_failed());
				}
				sequencesDeleted = true;
			}
			editorSession.syncTimelineClock();
			await editorSession.saveNow();
			projectSaved = true;
			const failed: MediaMetadata[] = [];
			for (const target of targets) {
				try {
					await deleteProjectMedia(projectId, target.id);
					clearProxyCache(target.id);
					sceneBrowser.forget(target.id);
					mediaPool.remove(target.id);
				} catch {
					failed.push(target);
				}
			}
			commandHistory.clearHistory();
			for (const sequence of sequenceTargets) compoundThumbnailService.clear(sequence.id);
			selectedSequenceIds = new Set(
				[...selectedSequenceIds].filter(
					(id) => !sequenceTargets.some((sequence) => sequence.id === id)
				)
			);
			deleteTargets = [];
			deleteReferenceCount = 0;
			if (failed.length > 0) {
				selectedMediaIds = new Set(failed.map((media) => media.id));
				selectionAnchorId = failed[0]?.id ?? null;
				mediaDeleteTargets = failed;
				mediaDeletePlan = planMediaDeletion(
					sequenceStore.projectTimeline(),
					failed.map((media) => media.id)
				);
				return {
					ok: false,
					message: (sequenceTargets.length > 0
						? m.video_editor_assets_delete_batch_partial
						: m.video_editor_media_delete_batch_partial)({
						deleted: targets.length - failed.length + sequenceTargets.length,
						failed: failed.length
					})
				};
			}
			showToast(
				sequenceTargets.length > 0
					? m.video_editor_assets_deleted_batch({
							count: targets.length + sequenceTargets.length
						})
					: targets.length === 1
						? m.video_editor_media_deleted({ name: targets[0]!.fileName })
						: m.video_editor_media_deleted_batch({ count: targets.length }),
				'success'
			);
			clearAssetSelection();
			mediaDeleteTargets = [];
			mediaDeletePlan = null;
			return { ok: true };
		} catch (error) {
			if (!projectSaved) {
				if (sequencesDeleted && commandHistory.getLastCommandType() === 'DELETE_SEQUENCES') {
					commandHistory.undo();
				}
				restoreSnapshot(before);
				if (sequencesDeleted) {
					sequenceStore.load(beforeProject, beforeResolution);
					if (originalSequenceId) sequenceStore.switchTo(originalSequenceId);
					commandHistory.setActiveContext(originalSequenceId);
				}
				editorSession.syncTimelineClock();
			}
			return {
				ok: false,
				message:
					error instanceof Error && error.message
						? error.message
						: m.video_editor_media_delete_failed()
			};
		}
	}

	function openSequence(id: string): void {
		sequenceStore.promoteToTab(id);
		editorSession.pausePlayback();
		if (!switchSequence(id)) return;
		editorSession.syncTimelineClock();
		onsequenceopen();
		editorSession.scheduleAutosave();
	}

	function placeSequence(sequence: SubComposition): void {
		mediaPlacement.begin(mediaDragData('composition', sequence.id, sequence.name));
	}

	function duplicateComposition(sequence: SubComposition): void {
		const duplicateId = duplicateSequence(
			sequence.id,
			m.video_editor_sequence_copy_name({ name: sequence.name })
		);
		if (!duplicateId) {
			showToast(m.video_editor_sequence_duplicate_failed(), 'error');
			return;
		}
		editorSession.scheduleAutosave();
		const duplicate = sequenceStore.compositionById.get(duplicateId);
		showToast(
			m.video_editor_sequence_duplicated({ name: duplicate?.name ?? sequence.name }),
			'success'
		);
	}

	async function beginSequenceRename(sequence: SubComposition): Promise<void> {
		editingSequenceId = sequence.id;
		sequenceNameDraft = sequence.name;
		sequenceRenameCancelled = false;
		await tick();
		sequenceRenameInput?.focus();
		sequenceRenameInput?.select();
	}

	function cancelSequenceRename(): void {
		sequenceRenameCancelled = true;
		editingSequenceId = null;
	}

	function commitSequenceRename(sequence: SubComposition): void {
		if (sequenceRenameCancelled) {
			sequenceRenameCancelled = false;
			return;
		}
		if (
			sequenceNameDraft.trim() !== sequence.name &&
			renameSequence(sequence.id, sequenceNameDraft)
		) {
			editorSession.scheduleAutosave();
		}
		editingSequenceId = null;
	}

	function confirmSequenceDelete(sequence: SubComposition): void {
		mediaDeleteTargets = [];
		mediaDeletePlan = null;
		deleteTargets = [sequence];
		deleteReferenceCount = sequenceDeletionImpact(sequence.id).totalReferenceCount;
		deleteDialogOpen = true;
	}

	function confirmSelectedSequenceDelete(): void {
		if (selectedSequences.length === 0) return;
		mediaDeleteTargets = [];
		mediaDeletePlan = null;
		deleteTargets = [...selectedSequences];
		deleteReferenceCount = sequenceDeletionImpactFor(
			deleteTargets.map((sequence) => sequence.id)
		).totalReferenceCount;
		deleteDialogOpen = true;
	}

	function confirmSelectedAssetDelete(): void {
		if (selectedMedia.length > 0 && selectedSequences.length > 0) {
			mediaDeleteTargets = [...selectedMedia];
			mediaDeletePlan = planMediaDeletion(
				sequenceStore.projectTimeline(),
				mediaDeleteTargets.map((media) => media.id)
			);
			deleteTargets = [...selectedSequences];
			deleteReferenceCount = sequenceDeletionImpactFor(
				deleteTargets.map((sequence) => sequence.id)
			).totalReferenceCount;
			mediaDeleteDialogOpen = true;
			return;
		}
		if (selectedMedia.length > 0) {
			confirmSelectedMediaDelete();
			return;
		}
		confirmSelectedSequenceDelete();
	}

	async function deleteConfirmedSequences(): Promise<{ ok: boolean; message?: string }> {
		const targets = [...deleteTargets];
		if (targets.length === 0) {
			return { ok: false, message: m.video_editor_sequence_delete_failed() };
		}
		editorSession.pausePlayback();
		const removed = deleteSequences(targets.map((target) => target.id));
		if (removed.length !== targets.length) {
			return { ok: false, message: m.video_editor_sequence_delete_failed() };
		}
		editorSession.syncTimelineClock();
		try {
			await editorSession.saveNow();
		} catch (error) {
			commandHistory.undo();
			editorSession.syncTimelineClock();
			return {
				ok: false,
				message:
					error instanceof Error && error.message
						? error.message
						: m.video_editor_sequence_delete_failed()
			};
		}
		for (const target of targets) compoundThumbnailService.clear(target.id);
		selectedSequenceIds = new Set([...selectedSequenceIds].filter((id) => !removed.includes(id)));
		if (sequenceSelectionAnchorId && removed.includes(sequenceSelectionAnchorId)) {
			sequenceSelectionAnchorId = null;
		}
		showToast(
			targets.length === 1
				? m.video_editor_sequence_deleted({ name: targets[0]!.name })
				: m.video_editor_sequence_deleted_batch({ count: targets.length }),
			'success'
		);
		deleteTargets = [];
		deleteReferenceCount = 0;
		return { ok: true };
	}

	function mediaDeleteDialogTitle(): string {
		if (deleteTargets.length > 0) {
			return m.video_editor_assets_delete_batch_title({
				count: mediaDeleteTargets.length + deleteTargets.length
			});
		}
		if (mediaDeleteTargets.length === 1) {
			return m.video_editor_media_delete_title({
				name: mediaDeleteTargets[0]?.fileName ?? ''
			});
		}
		return m.video_editor_media_delete_batch_title({ count: mediaDeleteTargets.length });
	}

	function mediaDeleteDialogDescription(): string {
		const mediaReferences = mediaDeletePlan?.totalReferenceCount ?? 0;
		if (deleteTargets.length > 0) {
			const referenceCount = mediaReferences + deleteReferenceCount;
			if (referenceCount === 0) return m.video_editor_assets_delete_unused();
			if (referenceCount === 1) return m.video_editor_assets_delete_reference();
			return m.video_editor_assets_delete_references({ count: referenceCount });
		}
		if (mediaReferences === 0) return m.video_editor_media_delete_unused();
		if (mediaReferences === 1) return m.video_editor_media_delete_reference();
		return m.video_editor_media_delete_references({ count: mediaReferences });
	}

	function openSubtitlePicker(media: MediaMetadata): void {
		onextractsubtitles(media);
	}
</script>

<div
	class="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--video-editor-focus)]"
	role="region"
	aria-label={m.video_editor_assets()}
	tabindex="-1"
	data-testid="asset-selection-surface"
	use:assetSelectionSurfaceAction
>
	<div
		class="pointer-events-none absolute z-20 rounded-sm border border-[var(--video-editor-focus)] bg-[var(--video-editor-focus)]/12 shadow-[0_0_0_1px_oklch(0.12_0.01_50_/_0.5)]"
		data-asset-marquee
		aria-hidden="true"
		hidden
	></div>
	<div
		class="sticky top-0 z-10 -mx-2 space-y-1.5 border-b border-[oklch(0.25_0.012_55)] bg-[oklch(0.135_0.008_50)] px-2 pb-2"
		data-marquee-ignore
	>
		<div class="flex items-center gap-1.5">
			<label class="relative min-w-0 flex-1">
				<span class="sr-only">{m.video_editor_media_search()}</span>
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[oklch(0.58_0.015_55)]"
					aria-hidden="true"
				/>
				<Input
					type="search"
					bind:value={query}
					placeholder={m.video_editor_media_search()}
					class="h-8 w-full rounded-md border border-[oklch(0.28_0.014_55)] bg-[oklch(0.18_0.008_50)] pr-2 pl-7 text-xs placeholder:text-[oklch(0.54_0.012_55)] focus-visible:border-[var(--video-editor-focus)] focus-visible:ring-2 focus-visible:ring-[var(--video-editor-focus)]/25"
				/>
			</label>
			<Button
				type="button"
				variant="outline"
				size="icon-xs"
				aria-label={m.video_editor_media_import_url()}
				title={m.video_editor_media_import_url()}
				onclick={() => (urlImportOpen = true)}
			>
				<LinkIcon class="size-3.5" aria-hidden="true" />
			</Button>
			{#if onimport}
				<Button
					type="button"
					variant="outline"
					size="icon-xs"
					aria-label={m.video_editor_import_media()}
					title={m.video_editor_import_media()}
					onclick={onimport}
				>
					<FolderOpenIcon class="size-3.5" aria-hidden="true" />
				</Button>
			{/if}
		</div>
		<div class="grid grid-cols-2 gap-1.5">
			<div class="min-w-0">
				<Select.Root type="single" value={filter} onValueChange={changeFilter}>
					<Select.Trigger
						aria-label={m.video_editor_media_filter()}
						class="h-7! w-full! rounded-md! border-[oklch(0.28_0.014_55)]! bg-[oklch(0.18_0.008_50)]! px-1.5! py-0! text-[10px]! text-[var(--video-editor-text)]! shadow-none! hover:translate-y-0! hover:bg-[oklch(0.21_0.01_50)]! aria-expanded:translate-y-0!"
					>
						{filter === 'all'
							? m.video_editor_media_filter_all()
							: filter === 'video'
								? m.video_editor_media_filter_video()
								: filter === 'audio'
									? m.video_editor_media_filter_audio()
									: filter === 'image'
										? m.video_editor_media_filter_image()
										: m.video_editor_media_filter_lottie()}
					</Select.Trigger>
					<Select.Content
						class="video-editor-theme rounded-md! border-[oklch(0.31_0.018_55)]! bg-[oklch(0.16_0.012_50)]! text-[var(--video-editor-text)]! shadow-lg!"
					>
						<Select.Item value="all">{m.video_editor_media_filter_all()}</Select.Item>
						<Select.Item value="video">{m.video_editor_media_filter_video()}</Select.Item>
						<Select.Item value="audio">{m.video_editor_media_filter_audio()}</Select.Item>
						<Select.Item value="image">{m.video_editor_media_filter_image()}</Select.Item>
						<Select.Item value="lottie">{m.video_editor_media_filter_lottie()}</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
			<div class="min-w-0">
				<Select.Root type="single" value={sort} onValueChange={changeSort}>
					<Select.Trigger
						aria-label={m.video_editor_media_sort()}
						class="h-7! w-full! rounded-md! border-[oklch(0.28_0.014_55)]! bg-[oklch(0.18_0.008_50)]! px-1.5! py-0! text-[10px]! text-[var(--video-editor-text)]! shadow-none! hover:translate-y-0! hover:bg-[oklch(0.21_0.01_50)]! aria-expanded:translate-y-0!"
					>
						{sort === 'added'
							? m.video_editor_media_sort_added()
							: sort === 'name'
								? m.video_editor_media_sort_name()
								: sort === 'duration'
									? m.video_editor_media_sort_duration()
									: m.video_editor_media_sort_size()}
					</Select.Trigger>
					<Select.Content
						class="video-editor-theme rounded-md! border-[oklch(0.31_0.018_55)]! bg-[oklch(0.16_0.012_50)]! text-[var(--video-editor-text)]! shadow-lg!"
					>
						<Select.Item value="added">{m.video_editor_media_sort_added()}</Select.Item>
						<Select.Item value="name">{m.video_editor_media_sort_name()}</Select.Item>
						<Select.Item value="duration">{m.video_editor_media_sort_duration()}</Select.Item>
						<Select.Item value="size">{m.video_editor_media_sort_size()}</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>
		<div class="flex min-w-0 items-center justify-end gap-2" data-editor-shortcuts-disabled>
			{#if assetViewMode === 'grid'}
				<Slider
					class="min-w-12 flex-1"
					min={1}
					max={5}
					step={1}
					value={assetGridSize}
					ariaLabel={m.video_editor_media_card_size()}
					onValueChange={(value) => editorSettings.set('mediaLibraryItemSize', value)}
				/>
			{/if}
			<div
				class="flex shrink-0 overflow-hidden rounded-md border border-[oklch(0.28_0.014_55)] bg-[oklch(0.18_0.008_50)]"
				role="group"
				aria-label={m.video_editor_media_view()}
			>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					class="size-7! rounded-none! {assetViewMode === 'grid'
						? 'bg-[oklch(0.66_0.14_45_/_0.18)] text-[oklch(0.86_0.08_65)]'
						: ''}"
					aria-label={m.media_grid_view()}
					title={m.media_grid_view()}
					aria-pressed={assetViewMode === 'grid'}
					onclick={() => editorSettings.set('mediaLibraryViewMode', 'grid')}
				>
					<GridIcon class="size-3.5" aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					class="size-7! rounded-none! {assetViewMode === 'list'
						? 'bg-[oklch(0.66_0.14_45_/_0.18)] text-[oklch(0.86_0.08_65)]'
						: ''}"
					aria-label={m.media_compact_view()}
					title={m.media_compact_view()}
					aria-pressed={assetViewMode === 'list'}
					onclick={() => editorSettings.set('mediaLibraryViewMode', 'list')}
				>
					<ListIcon class="size-3.5" aria-hidden="true" />
				</Button>
			</div>
		</div>
		{#if selectedAssetCount > 0}
			<div
				class="flex min-w-0 items-center gap-1.5 rounded-md border border-[oklch(0.34_0.025_50)] bg-[oklch(0.2_0.012_50)] px-1.5 py-1"
				role="status"
				aria-label={m.video_editor_media_selected_count({ count: selectedAssetCount })}
			>
				<span class="min-w-0 flex-1 truncate text-[10px] font-medium tabular-nums">
					{m.video_editor_media_selected_count({ count: selectedAssetCount })}
				</span>
				{#if selectedProxyMedia.length > 0}
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						class="size-7! shrink-0"
						aria-label={m.video_editor_media_generate_selected_proxies({
							count: selectedProxyMedia.length
						})}
						title={m.video_editor_media_generate_selected_proxies({
							count: selectedProxyMedia.length
						})}
						onclick={() => void generateSelectedProxies()}
					>
						<GaugeIcon class="size-3.5" aria-hidden="true" />
					</Button>
				{/if}
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					class="size-7! shrink-0 text-red-300 hover:text-red-200"
					aria-label={m.video_editor_assets_delete_selected({ count: selectedAssetCount })}
					title={m.video_editor_assets_delete_selected({ count: selectedAssetCount })}
					onclick={confirmSelectedAssetDelete}
				>
					<TrashIcon class="size-3.5" aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					class="size-7! shrink-0"
					aria-label={m.video_editor_media_clear_selection()}
					title={m.video_editor_media_clear_selection()}
					onclick={clearAssetSelection}
				>
					<XIcon class="size-3.5" aria-hidden="true" />
				</Button>
			</div>
		{/if}
	</div>
	{#if mediaRecovery.issueCount > 0}
		<div
			class="my-2 flex items-center gap-2 rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-amber-100"
			role="status"
		>
			<AlertTriangleIcon class="size-3.5 shrink-0 text-amber-300" aria-hidden="true" />
			<p class="min-w-0 flex-1 text-[10px]">
				{m.video_editor_media_recovery_warning({ count: mediaRecovery.issueCount })}
			</p>
			<Button
				size="sm"
				variant="ghost"
				class="h-7! shrink-0 px-2! text-[10px]!"
				onclick={() => mediaRecovery.show()}
			>
				{m.video_editor_media_recovery_review()}
			</Button>
		</div>
	{/if}

	{#if sequenceStore.compositions.length > 0}
		<section class="mb-2" aria-labelledby="video-editor-sequences-heading">
			<h3
				id="video-editor-sequences-heading"
				class="px-1 py-1.5 text-[10px] font-medium tracking-wider text-[oklch(0.62_0.015_55)] uppercase"
			>
				{m.video_editor_sequences()}
			</h3>
			<ul
				class={assetViewMode === 'grid' ? 'grid gap-1.5' : 'flex flex-col gap-1'}
				style:grid-template-columns={assetViewMode === 'grid' ? assetGridTemplate : undefined}
				data-asset-group="sequences"
				data-view={assetViewMode}
			>
				{#each sequenceStore.compositions as sequence (sequence.id)}
					<ContextMenu.Root>
						<ContextMenu.Trigger>
							{#snippet child({ props })}
								<li
									{...props}
									data-asset-row
									data-asset-sequence-id={sequence.id}
									data-view={assetViewMode}
									data-marquee-selected={assetMarqueePreviewSelected('sequence', sequence.id)}
									oncontextmenu={(event) => {
										prepareSequenceContextSelection(sequence.id);
										props.oncontextmenu?.(event);
									}}
									draggable={editingSequenceId !== sequence.id}
									ondragstart={(event) => startCompositionDrag(event, sequence)}
									ondragend={clearActiveMediaDrag}
									title={m.video_editor_media_drag_hint()}
									class="group cursor-grab gap-2 rounded-md bg-[oklch(0.19_0.01_50)] p-1.5 hover:bg-[oklch(0.22_0.01_50)] active:cursor-grabbing {assetViewMode ===
									'grid'
										? 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] content-start'
										: 'flex items-center'} {selectedSequenceIds.has(sequence.id) ||
									assetMarqueePreviewSelected('sequence', sequence.id)
										? 'bg-[oklch(0.25_0.025_50)] ring-1 ring-[oklch(0.66_0.14_45_/_0.7)]'
										: ''}"
								>
									<span
										class="flex shrink-0 items-center justify-center overflow-hidden rounded bg-[oklch(0.26_0.025_250)] {assetViewMode ===
										'grid'
											? 'col-span-2 aspect-video w-full'
											: 'size-10'}"
									>
										{#if sequenceThumbnailUrls[sequence.id]}
											<img
												src={sequenceThumbnailUrls[sequence.id]}
												alt=""
												class="size-full object-cover"
											/>
										{:else}
											<LayersIcon class="size-4" aria-hidden="true" />
										{/if}
									</span>
									{#if editingSequenceId === sequence.id}
										<Input
											bind:ref={sequenceRenameInput}
											class="h-9 min-w-0 flex-1 bg-[oklch(0.16_0.01_50)] px-2 text-xs"
											aria-label={m.common_rename()}
											bind:value={sequenceNameDraft}
											onblur={() => commitSequenceRename(sequence)}
											onkeydown={(event) => {
												if (event.key === 'Enter') {
													event.preventDefault();
													commitSequenceRename(sequence);
												}
												if (event.key === 'Escape') {
													event.preventDefault();
													cancelSequenceRename();
												}
											}}
										/>
									{:else}
										<button
											type="button"
											class="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
											title={m.video_editor_sequence_open()}
											aria-label={`${m.video_editor_sequence_open()}: ${sequence.name}`}
											aria-pressed={selectedSequenceIds.has(sequence.id)}
											onclick={(event) => selectSequence(event, sequence)}
										>
											<span class="block truncate text-xs font-medium">{sequence.name}</span>
											<span class="block text-[10px] text-[oklch(0.62_0.015_55)]">
												{sequence.durationInFrames}f · {sequence.width}×{sequence.height}
											</span>
										</button>
									{/if}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<Button
													{...props}
													variant="ghost"
													size="icon-xs"
													class="size-11! text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100 sm:size-7!"
													aria-label={`${m.video_editor_sequence_options()}: ${sequence.name}`}
												>
													<MoreIcon class="size-3.5" aria-hidden="true" />
												</Button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content class="video-editor-theme" align="end">
											<DropdownMenu.Item onclick={() => placeSequence(sequence)}>
												<PlusIcon class="size-4" aria-hidden="true" />
												{m.video_editor_media_place()}
											</DropdownMenu.Item>
											<DropdownMenu.Separator />
											<DropdownMenu.Item onclick={() => void beginSequenceRename(sequence)}>
												<PencilIcon class="size-4" aria-hidden="true" />
												{m.common_rename()}
											</DropdownMenu.Item>
											<DropdownMenu.Item onclick={() => duplicateComposition(sequence)}>
												<CopyIcon class="size-4" aria-hidden="true" />
												{m.video_editor_sequence_duplicate()}
											</DropdownMenu.Item>
											<DropdownMenu.Separator />
											<DropdownMenu.Item
												class="text-red-300 focus:text-red-200"
												onclick={() =>
													selectedSequenceIds.has(sequence.id) && selectedAssetCount > 1
														? confirmSelectedAssetDelete()
														: confirmSequenceDelete(sequence)}
											>
												<TrashIcon class="size-4" aria-hidden="true" />
												{m.common_delete()}
											</DropdownMenu.Item>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								</li>
							{/snippet}
						</ContextMenu.Trigger>
						<ContextMenu.Content class="video-editor-theme w-48">
							<ContextMenu.Item onclick={() => openSequence(sequence.id)}>
								<LayersIcon class="size-4" aria-hidden="true" />
								{m.video_editor_sequence_open()}
							</ContextMenu.Item>
							<ContextMenu.Item onclick={() => placeSequence(sequence)}>
								<PlusIcon class="size-4" aria-hidden="true" />
								{m.video_editor_media_place()}
							</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item onclick={() => void beginSequenceRename(sequence)}>
								<PencilIcon class="size-4" aria-hidden="true" />
								{m.common_rename()}
							</ContextMenu.Item>
							<ContextMenu.Item onclick={() => duplicateComposition(sequence)}>
								<CopyIcon class="size-4" aria-hidden="true" />
								{m.video_editor_sequence_duplicate()}
							</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item
								variant="destructive"
								onclick={() =>
									selectedSequenceIds.has(sequence.id) && selectedAssetCount > 1
										? confirmSelectedAssetDelete()
										: confirmSequenceDelete(sequence)}
							>
								<TrashIcon class="size-4" aria-hidden="true" />
								{m.common_delete()}
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Root>
				{/each}
			</ul>
		</section>
	{/if}
	{#each mediaGroups as group (group.kind)}
		<section aria-labelledby={`video-editor-media-${group.kind}`}>
			<h3
				id={`video-editor-media-${group.kind}`}
				class="flex items-center justify-between px-1 py-1.5 text-[10px] font-medium tracking-wider text-[oklch(0.62_0.015_55)] uppercase"
			>
				<span>{groupLabel(group.kind)}</span>
				<span class="tabular-nums">{group.media.length}</span>
			</h3>
			<ul
				class={assetViewMode === 'grid' ? 'grid gap-1.5' : 'flex flex-col gap-1'}
				style:grid-template-columns={assetViewMode === 'grid' ? assetGridTemplate : undefined}
				role="list"
				data-asset-group="media"
				data-view={assetViewMode}
			>
				{#each group.media as media (media.id)}
					{@const id = media.id}
					{@const entry = mediaPool.entry(id)}
					{@const issue = sourceIssue(id)}
					<ContextMenu.Root>
						<ContextMenu.Trigger disabled={entry?.status !== 'ready'}>
							{#snippet child({ props })}
								<li
									{...props}
									data-asset-row
									data-asset-media-id={id}
									data-view={assetViewMode}
									data-marquee-selected={assetMarqueePreviewSelected('media', id)}
									oncontextmenu={(event) => {
										prepareMediaContextSelection(id);
										props.oncontextmenu?.(event);
									}}
									draggable={entry?.status === 'ready' && !issue}
									ondragstart={(event) =>
										entry?.status === 'ready' && !issue && startMediaDrag(event, entry.media)}
									ondragend={clearActiveMediaDrag}
									title={issue
										? sourceIssueLabel(issue)
										: entry?.status === 'ready'
											? m.video_editor_media_drag_hint()
											: undefined}
									class="group gap-1 rounded-md p-1 hover:bg-[oklch(0.22_0.01_50)] {assetViewMode ===
									'grid'
										? 'grid min-w-0 grid-cols-3 content-start'
										: 'flex items-center'} {selectedMediaIds.has(id) ||
									assetMarqueePreviewSelected('media', id)
										? 'bg-[oklch(0.25_0.025_50)] ring-1 ring-[oklch(0.66_0.14_45_/_0.7)]'
										: ''} {entry?.status === 'ready' && !issue
										? 'cursor-grab active:cursor-grabbing'
										: ''} {issue ? 'bg-amber-400/8 ring-1 ring-amber-400/25' : ''}"
								>
									<button
										type="button"
										class="min-w-0 rounded p-0.5 text-left focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-60 {assetViewMode ===
										'grid'
											? 'col-span-3 grid w-full grid-cols-1 gap-1'
											: 'flex flex-1 items-center gap-2'}"
										disabled={entry?.status !== 'ready' || Boolean(issue)}
										aria-label={`${m.video_editor_source_monitor()}: ${entry?.media.fileName ?? ''}`}
										aria-pressed={selectedMediaIds.has(id)}
										onclick={(event) => entry && selectMedia(event, entry.media)}
										title={issue ? sourceIssueLabel(issue) : m.video_editor_source_monitor()}
									>
										<span
											class="flex shrink-0 items-center justify-center overflow-hidden rounded bg-[oklch(0.22_0.01_50)] {assetViewMode ===
											'grid'
												? 'aspect-video w-full'
												: 'size-10'}"
										>
											{#if entry?.status === 'importing'}
												<LoaderIcon
													class="size-4 animate-spin motion-reduce:animate-none"
													aria-hidden="true"
												/>
											{:else if objectUrls[id] && !entry?.media.tags.includes('audio')}
												<img src={objectUrls[id]} alt="" class="size-full object-cover" />
											{:else if entry?.media.tags.includes('lottie')}
												<SparklesIcon class="size-4" aria-hidden="true" />
											{:else if entry?.media.tags.includes('audio')}
												<Music2Icon class="size-4" aria-hidden="true" />
											{:else if entry?.status === 'failed'}
												<span class="text-xs text-red-400">!</span>
											{:else}
												<FilmIcon class="size-4" aria-hidden="true" />
											{/if}
										</span>
										<span class="min-w-0 flex-1">
											<span class="block truncate text-xs font-medium">{entry?.media.fileName}</span
											>
											{#if issue}
												<span class="flex items-center gap-1 text-[11px] text-amber-300">
													{#if recoveryBusyIds.has(id)}
														<LoaderIcon
															class="size-3 animate-spin motion-reduce:animate-none"
															aria-hidden="true"
														/>
													{:else}
														<AlertTriangleIcon class="size-3" aria-hidden="true" />
													{/if}
													<span class="truncate">{sourceIssueLabel(issue)}</span>
												</span>
											{:else if entry?.status === 'ready'}
												<span class="block text-[11px] text-[oklch(0.65_0.015_55)]">
													{formatMediaListSummary(entry.media)}
												</span>
											{/if}
										</span>
									</button>
									{#if entry}
										{#if assetViewMode === 'grid'}
											<div class="justify-self-center">
												<MediaInfoPopover media={entry.media} />
											</div>
										{:else}
											<MediaInfoPopover media={entry.media} />
										{/if}
									{/if}
									{#if entry?.status === 'ready'}
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												{#snippet child({ props })}
													<Button
														{...props}
														variant="ghost"
														size="icon-xs"
														class="size-11! text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100 sm:size-7! {assetViewMode ===
														'grid'
															? 'justify-self-center'
															: ''}"
														aria-label={m.video_editor_media_more_actions({
															name: entry.media.fileName
														})}
													>
														<MoreIcon class="size-3.5" aria-hidden="true" />
													</Button>
												{/snippet}
											</DropdownMenu.Trigger>
											<DropdownMenu.Content class="video-editor-theme w-52" align="end">
												{#if issue}
													{#if issue.kind === 'permission'}
														<DropdownMenu.Item
															disabled={recoveryBusyIds.has(id)}
															onclick={() => void grantSourceAccess(entry.media)}
														>
															<LinkIcon class="size-4" aria-hidden="true" />
															{m.video_editor_media_recovery_grant()}
														</DropdownMenu.Item>
													{/if}
													<DropdownMenu.Item
														disabled={recoveryBusyIds.has(id)}
														onclick={() => void locateSourceFile(entry.media)}
													>
														<FolderOpenIcon class="size-4" aria-hidden="true" />
														{m.video_editor_media_recovery_locate()}
													</DropdownMenu.Item>
													<DropdownMenu.Separator />
												{/if}
												{#if canTranscribeSource(entry.media)}
													<DropdownMenu.Item
														disabled={Boolean(issue) ||
															sourceTranscriptTask(id)?.status === 'cancelling' ||
															transcriptionService.sourceTranscriptStatus(id) === 'loading' ||
															(!sourceTranscriptTask(id) && otherMediaProcessingForTranscript(id))}
														onclick={() => void runSourceTranscriptAction(entry.media)}
													>
														{#if sourceTranscriptTask(id)?.status === 'cancelling'}
															<LoaderIcon
																class="size-4 animate-spin motion-reduce:animate-none"
																aria-hidden="true"
															/>
														{:else if sourceTranscriptTask(id)}
															<XIcon class="size-4" aria-hidden="true" />
														{:else}
															<CaptionsIcon class="size-4" aria-hidden="true" />
														{/if}
														{sourceTranscriptActionLabel(id)}
													</DropdownMenu.Item>
													{#if transcriptionService.sourceTranscriptStatus(id) === 'ready' && !sourceTranscriptTask(id)}
														<DropdownMenu.Item
															class="text-red-300 focus:text-red-200"
															onclick={() => void removeSourceTranscript(entry.media)}
														>
															<TrashIcon class="size-4" aria-hidden="true" />
															{m.video_editor_source_transcript_delete()}
														</DropdownMenu.Item>
													{/if}
												{/if}
												{#if canExtractEmbeddedSubtitles(entry.media)}
													<DropdownMenu.Item
														disabled={Boolean(issue)}
														onclick={() => openSubtitlePicker(entry.media)}
													>
														<CaptionsIcon class="size-4" aria-hidden="true" />
														{m.video_editor_extract_embedded_subtitles()}
													</DropdownMenu.Item>
												{/if}
												{#if isSceneAnalyzableMedia(entry.media)}
													<DropdownMenu.Item
														disabled={Boolean(issue) ||
															(mediaProcessing(id) && !sceneBrowser.progress(id))}
														onclick={() => void analyzeMedia(entry.media)}
													>
														{#if sceneBrowser.progress(id)}
															<XIcon class="size-4" aria-hidden="true" />
														{:else}
															<SparklesIcon class="size-4" aria-hidden="true" />
														{/if}
														{sceneAnalysisLabel(entry.media)}
													</DropdownMenu.Item>
												{/if}
												{#if canGenerateProxy(entry.media)}
													<DropdownMenu.Item
														disabled={Boolean(issue) ||
															proxyTask(id)?.status === 'cancelling' ||
															(!proxyTask(id) && otherMediaProcessing(id))}
														onclick={() => runProxyAction(entry.media)}
													>
														{#if proxyTask(id)?.status === 'cancelling'}
															<LoaderIcon
																class="size-4 animate-spin motion-reduce:animate-none"
																aria-hidden="true"
															/>
														{:else if proxyTask(id)}
															<XIcon class="size-4" aria-hidden="true" />
														{:else if mediaProxy(id)}
															<TrashIcon class="size-4" aria-hidden="true" />
														{:else}
															<FilmIcon class="size-4" aria-hidden="true" />
														{/if}
														{proxyActionLabel(entry.media)}
													</DropdownMenu.Item>
												{/if}
												{#if canTranscribeSource(entry.media) || canExtractEmbeddedSubtitles(entry.media) || isSceneAnalyzableMedia(entry.media) || canGenerateProxy(entry.media)}
													<DropdownMenu.Separator />
												{/if}
												<DropdownMenu.Sub>
													<DropdownMenu.SubTrigger
														disabled={Boolean(issue) ||
															!upscaleService.canUpscaleMedia(entry.media) ||
															mediaProcessing(id)}
														aria-label={upscaleActionLabel(entry.media)}
														title={upscaleActionLabel(entry.media)}
													>
														<ScanLineIcon class="size-4" aria-hidden="true" />
														{m.video_editor_media_upscale()}
													</DropdownMenu.SubTrigger>
													<DropdownMenu.SubContent class="video-editor-theme w-44">
														<DropdownMenu.Item
															onclick={() => upscaleMedia(entry.media, 'liveAction')}
														>
															{m.video_editor_media_upscale_live_action()}
														</DropdownMenu.Item>
														<DropdownMenu.Item
															onclick={() => upscaleMedia(entry.media, 'animation')}
														>
															{m.video_editor_media_upscale_animation()}
														</DropdownMenu.Item>
														<DropdownMenu.Item onclick={() => upscaleMedia(entry.media, 'threeD')}>
															{m.video_editor_media_upscale_3d()}
														</DropdownMenu.Item>
													</DropdownMenu.SubContent>
												</DropdownMenu.Sub>
												<DropdownMenu.Sub>
													<DropdownMenu.SubTrigger
														disabled={Boolean(issue) ||
															!frameInterpolationService.canInterpolateMedia(entry.media) ||
															mediaProcessing(id)}
														aria-label={interpolationActionLabel(entry.media)}
														title={interpolationActionLabel(entry.media)}
													>
														<GaugeIcon class="size-4" aria-hidden="true" />
														{m.video_editor_media_interpolate()}
													</DropdownMenu.SubTrigger>
													<DropdownMenu.SubContent class="video-editor-theme w-32">
														{#each SUPPORTED_INTERPOLATION_FACTORS as factor}
															<DropdownMenu.Item
																onclick={() => interpolateMedia(entry.media, factor)}
															>
																{factor}x
															</DropdownMenu.Item>
														{/each}
													</DropdownMenu.SubContent>
												</DropdownMenu.Sub>
												<DropdownMenu.Separator />
												<DropdownMenu.Item
													variant="destructive"
													disabled={mediaProcessing(id)}
													onclick={() =>
														selectedMediaIds.has(id) && selectedAssetCount > 1
															? confirmSelectedAssetDelete()
															: confirmMediaDelete(entry.media)}
												>
													<TrashIcon class="size-4" aria-hidden="true" />
													{m.common_delete()}
												</DropdownMenu.Item>
											</DropdownMenu.Content>
										</DropdownMenu.Root>
									{/if}
									<button
										type="button"
										class="flex size-11 shrink-0 items-center justify-center rounded text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-30 sm:size-7 {assetViewMode ===
										'grid'
											? 'justify-self-center'
											: ''}"
										disabled={entry?.status !== 'ready' || Boolean(issue)}
										aria-label={`${m.video_editor_media_place()}: ${entry?.media.fileName ?? ''}`}
										title={m.video_editor_media_place()}
										onclick={() => entry && placeMedia(entry.media)}
									>
										<PlusIcon class="size-3.5" aria-hidden="true" />
									</button>
								</li>
							{/snippet}
						</ContextMenu.Trigger>
						{#if entry?.status === 'ready'}
							<ContextMenu.Content class="video-editor-theme w-56">
								{#if issue}
									{#if issue.kind === 'permission'}
										<ContextMenu.Item
											disabled={recoveryBusyIds.has(id)}
											onclick={() => void grantSourceAccess(entry.media)}
										>
											<LinkIcon class="size-4" aria-hidden="true" />
											{m.video_editor_media_recovery_grant()}
										</ContextMenu.Item>
									{/if}
									<ContextMenu.Item
										disabled={recoveryBusyIds.has(id)}
										onclick={() => void locateSourceFile(entry.media)}
									>
										<FolderOpenIcon class="size-4" aria-hidden="true" />
										{m.video_editor_media_recovery_locate()}
									</ContextMenu.Item>
									<ContextMenu.Separator />
								{/if}
								<ContextMenu.Item disabled={Boolean(issue)} onclick={() => onsourceopen(id)}>
									<FilmIcon class="size-4" aria-hidden="true" />
									{m.video_editor_source_monitor()}
								</ContextMenu.Item>
								<ContextMenu.Item disabled={Boolean(issue)} onclick={() => placeMedia(entry.media)}>
									<PlusIcon class="size-4" aria-hidden="true" />
									{m.video_editor_media_place()}
								</ContextMenu.Item>
								{#if canTranscribeSource(entry.media)}
									<ContextMenu.Separator />
									<ContextMenu.Item
										disabled={Boolean(issue) ||
											sourceTranscriptTask(id)?.status === 'cancelling' ||
											transcriptionService.sourceTranscriptStatus(id) === 'loading' ||
											(!sourceTranscriptTask(id) && otherMediaProcessingForTranscript(id))}
										onclick={() => void runSourceTranscriptAction(entry.media)}
									>
										{#if sourceTranscriptTask(id)?.status === 'cancelling'}
											<LoaderIcon
												class="size-4 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										{:else if sourceTranscriptTask(id)}
											<XIcon class="size-4" aria-hidden="true" />
										{:else}
											<CaptionsIcon class="size-4" aria-hidden="true" />
										{/if}
										{sourceTranscriptActionLabel(id)}
									</ContextMenu.Item>
									{#if transcriptionService.sourceTranscriptStatus(id) === 'ready' && !sourceTranscriptTask(id)}
										<ContextMenu.Item
											variant="destructive"
											onclick={() => void removeSourceTranscript(entry.media)}
										>
											<TrashIcon class="size-4" aria-hidden="true" />
											{m.video_editor_source_transcript_delete()}
										</ContextMenu.Item>
									{/if}
								{/if}
								{#if canExtractEmbeddedSubtitles(entry.media)}
									{#if !canTranscribeSource(entry.media)}
										<ContextMenu.Separator />
									{/if}
									<ContextMenu.Item
										disabled={Boolean(issue)}
										onclick={() => openSubtitlePicker(entry.media)}
									>
										<CaptionsIcon class="size-4" aria-hidden="true" />
										{m.video_editor_extract_embedded_subtitles()}
									</ContextMenu.Item>
								{/if}
								{#if isSceneAnalyzableMedia(entry.media)}
									<ContextMenu.Item
										disabled={Boolean(issue) || (mediaProcessing(id) && !sceneBrowser.progress(id))}
										onclick={() => void analyzeMedia(entry.media)}
									>
										{#if sceneBrowser.progress(id)}
											<XIcon class="size-4" aria-hidden="true" />
										{:else}
											<SparklesIcon class="size-4" aria-hidden="true" />
										{/if}
										{sceneAnalysisLabel(entry.media)}
									</ContextMenu.Item>
								{/if}
								{#if canGenerateProxy(entry.media)}
									<ContextMenu.Item
										disabled={Boolean(issue) ||
											proxyTask(id)?.status === 'cancelling' ||
											(!proxyTask(id) && otherMediaProcessing(id))}
										onclick={() => runProxyAction(entry.media)}
									>
										{#if proxyTask(id)?.status === 'cancelling'}
											<LoaderIcon
												class="size-4 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										{:else if proxyTask(id)}
											<XIcon class="size-4" aria-hidden="true" />
										{:else if mediaProxy(id)}
											<TrashIcon class="size-4" aria-hidden="true" />
										{:else}
											<FilmIcon class="size-4" aria-hidden="true" />
										{/if}
										{proxyActionLabel(entry.media)}
									</ContextMenu.Item>
								{/if}
								<ContextMenu.Separator />
								<ContextMenu.Sub>
									<ContextMenu.SubTrigger
										disabled={Boolean(issue) ||
											!upscaleService.canUpscaleMedia(entry.media) ||
											mediaProcessing(id)}
										aria-label={upscaleActionLabel(entry.media)}
										title={upscaleActionLabel(entry.media)}
									>
										<ScanLineIcon class="size-4" aria-hidden="true" />
										{m.video_editor_media_upscale()}
									</ContextMenu.SubTrigger>
									<ContextMenu.SubContent class="video-editor-theme w-44">
										<ContextMenu.Item onclick={() => upscaleMedia(entry.media, 'liveAction')}>
											{m.video_editor_media_upscale_live_action()}
										</ContextMenu.Item>
										<ContextMenu.Item onclick={() => upscaleMedia(entry.media, 'animation')}>
											{m.video_editor_media_upscale_animation()}
										</ContextMenu.Item>
										<ContextMenu.Item onclick={() => upscaleMedia(entry.media, 'threeD')}>
											{m.video_editor_media_upscale_3d()}
										</ContextMenu.Item>
									</ContextMenu.SubContent>
								</ContextMenu.Sub>
								<ContextMenu.Sub>
									<ContextMenu.SubTrigger
										disabled={Boolean(issue) ||
											!frameInterpolationService.canInterpolateMedia(entry.media) ||
											mediaProcessing(id)}
										aria-label={interpolationActionLabel(entry.media)}
										title={interpolationActionLabel(entry.media)}
									>
										<GaugeIcon class="size-4" aria-hidden="true" />
										{m.video_editor_media_interpolate()}
									</ContextMenu.SubTrigger>
									<ContextMenu.SubContent class="video-editor-theme w-32">
										{#each SUPPORTED_INTERPOLATION_FACTORS as factor}
											<ContextMenu.Item onclick={() => interpolateMedia(entry.media, factor)}>
												{factor}x
											</ContextMenu.Item>
										{/each}
									</ContextMenu.SubContent>
								</ContextMenu.Sub>
								<ContextMenu.Separator />
								<ContextMenu.Item
									variant="destructive"
									disabled={mediaProcessing(id)}
									onclick={() =>
										selectedMediaIds.has(id) && selectedAssetCount > 1
											? confirmSelectedAssetDelete()
											: confirmMediaDelete(entry.media)}
								>
									<TrashIcon class="size-4" aria-hidden="true" />
									{m.common_delete()}
								</ContextMenu.Item>
							</ContextMenu.Content>
						{/if}
					</ContextMenu.Root>
				{/each}
			</ul>
		</section>
	{/each}
	{#if mediaPool.order.length === 0}
		<div class="px-2 py-6 text-center text-xs text-[oklch(0.65_0.015_55)]">
			<ImageIcon class="mx-auto mb-2 size-5" aria-hidden="true" />
			{m.video_editor_media_empty()}
		</div>
	{:else if visibleMedia.length === 0}
		<p class="px-2 py-6 text-center text-xs text-[oklch(0.65_0.015_55)]">
			{m.video_editor_media_no_results()}
		</p>
	{/if}
</div>

<MediaUrlImportDialog bind:open={urlImportOpen} onimport={importUrl} />

<DestructiveConfirmDialog
	bind:open={mediaDeleteDialogOpen}
	title={mediaDeleteDialogTitle()}
	description={mediaDeleteTargets.length > 0 ? mediaDeleteDialogDescription() : ''}
	confirmLabel={m.common_delete()}
	onConfirm={deleteConfirmedMedia}
/>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={deleteTargets.length === 1
		? m.video_editor_sequence_delete_title({ name: deleteTargets[0]?.name ?? '' })
		: m.video_editor_sequence_delete_batch_title({ count: deleteTargets.length })}
	description={deleteTargets.length > 0
		? deleteReferenceCount > 0
			? deleteReferenceCount === 1
				? m.video_editor_sequence_delete_reference()
				: m.video_editor_sequence_delete_references({ count: deleteReferenceCount })
			: m.video_editor_sequence_delete_unused()
		: ''}
	confirmLabel={m.common_delete()}
	onConfirm={deleteConfirmedSequences}
/>
