<!-- Media pool list: imported sources with probe status; click adds to timeline -->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
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
		deleteSequence,
		duplicateSequence,
		sequenceDeletionImpact,
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
	import LayersIcon from '@lucide/svelte/icons/layers-3';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import MoreIcon from '@lucide/svelte/icons/ellipsis';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import CaptionsIcon from '@lucide/svelte/icons/captions';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import ScanLineIcon from '@lucide/svelte/icons/scan-line';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Select from '$lib/components/ui/select';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import EmbeddedSubtitlePicker from './embedded-subtitle-picker.svelte';
	import {
		canExtractEmbeddedSubtitles,
		type EmbeddedSubtitleInsertResult
	} from '$lib/video-editor/media/embedded-subtitle-service';
	import type { MediaMetadata } from '$lib/video-editor/media/types';
	import { readBlob } from '$lib/video-editor/workspace-fs/fs-primitives';
	import { requireWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
	import { mediaThumbnailPath } from '$lib/video-editor/workspace-fs/paths';
	import {
		filterAndSortMedia,
		formatMediaListSummary,
		groupMediaByKind,
		type MediaLibraryFilter,
		type MediaLibraryKind,
		type MediaLibrarySort
	} from '$lib/video-editor/media/library-view';
	import { importMediaFromUrl } from '$lib/video-editor/media/import-url';
	import MediaInfoPopover from './media-info-popover.svelte';
	import MediaUrlImportDialog from './media-url-import-dialog.svelte';
	import { mediaRecovery } from '$lib/video-editor/media/media-recovery.svelte';
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
		MediaImportCancelledError,
		type UnsupportedAudioImportRequest
	} from '$lib/video-editor/media/import.svelte';

	let {
		projectId,
		onsequenceopen = () => undefined,
		onsourceopen = () => undefined,
		onUnsupportedAudio
	}: {
		projectId: string;
		onsequenceopen?: () => void;
		onsourceopen?: (mediaId: string) => void;
		onUnsupportedAudio?: (request: UnsupportedAudioImportRequest) => Promise<'import' | 'cancel'>;
	} = $props();

	let objectUrls = $state<Record<string, string>>({});
	let subtitlePickerOpen = $state(false);
	let subtitleMedia = $state<MediaMetadata | null>(null);
	let urlImportOpen = $state(false);
	let query = $state('');
	let filter = $state<MediaLibraryFilter>('all');
	let sort = $state<MediaLibrarySort>('added');
	let sequenceThumbnailUrls = $state<Record<string, string>>({});
	let sequenceThumbnailGeneration = 0;
	let deleteTarget = $state<SubComposition | null>(null);
	let deleteReferenceCount = $state(0);
	let deleteDialogOpen = $state(false);
	const ownedThumbnailUrls = new Map<string, string>();
	let loadedThumbnailRevision = -1;
	const visibleMedia = $derived(filterAndSortMedia(mediaPool.mediaList, query, filter, sort));
	const mediaGroups = $derived(groupMediaByKind(visibleMedia));
	const canvasWidth = $derived(
		sequenceStore.activeSequence?.width ?? editorSession.project?.metadata.width ?? 1920
	);
	const canvasHeight = $derived(
		sequenceStore.activeSequence?.height ?? editorSession.project?.metadata.height ?? 1080
	);

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
			mediaTasks.get(mediaTaskId('upscale', mediaId)) ||
			mediaTasks.get(mediaTaskId('frame-interpolation', mediaId))
		);
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

	function confirmSequenceDelete(sequence: SubComposition): void {
		deleteTarget = sequence;
		deleteReferenceCount = sequenceDeletionImpact(sequence.id).totalReferenceCount;
		deleteDialogOpen = true;
	}

	function openSubtitlePicker(media: MediaMetadata): void {
		subtitleMedia = media;
		subtitlePickerOpen = true;
	}

	function handleSubtitleInsert(result: EmbeddedSubtitleInsertResult): void {
		if (result.itemIds.length === 0) {
			showToast(m.video_editor_subtitle_outside_clips(), 'error');
			return;
		}
		editorSession.scheduleAutosave();
		showToast(m.video_editor_subtitle_inserted({ count: result.cueCount }), 'success');
	}
</script>

<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
	<div
		class="sticky top-0 z-10 -mx-2 space-y-1.5 border-b border-[oklch(0.25_0.012_55)] bg-[oklch(0.135_0.008_50)] px-2 pb-2"
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
			<ul class="flex flex-col gap-1">
				{#each sequenceStore.compositions as sequence (sequence.id)}
					<li
						draggable="true"
						ondragstart={(event) => startCompositionDrag(event, sequence)}
						ondragend={clearActiveMediaDrag}
						title={m.video_editor_media_drag_hint()}
						class="group flex cursor-grab items-center gap-2 rounded-md bg-[oklch(0.19_0.01_50)] p-1.5 hover:bg-[oklch(0.22_0.01_50)] active:cursor-grabbing"
					>
						<span
							class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-[oklch(0.26_0.025_250)]"
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
						<button
							type="button"
							class="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
							title={m.video_editor_sequence_open()}
							onclick={() => openSequence(sequence.id)}
						>
							<span class="block truncate text-xs font-medium">{sequence.name}</span>
							<span class="block text-[10px] text-[oklch(0.62_0.015_55)]">
								{sequence.durationInFrames}f · {sequence.width}×{sequence.height}
							</span>
						</button>
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
								<DropdownMenu.Item onclick={() => duplicateComposition(sequence)}>
									<CopyIcon class="size-4" aria-hidden="true" />
									{m.video_editor_sequence_duplicate()}
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									class="text-red-300 focus:text-red-200"
									onclick={() => confirmSequenceDelete(sequence)}
								>
									<TrashIcon class="size-4" aria-hidden="true" />
									{m.common_delete()}
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</li>
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
			<ul class="flex flex-col gap-1" role="list">
				{#each group.media as media (media.id)}
					{@const id = media.id}
					{@const entry = mediaPool.entry(id)}
					<li
						draggable={entry?.status === 'ready'}
						ondragstart={(event) => entry?.status === 'ready' && startMediaDrag(event, entry.media)}
						ondragend={clearActiveMediaDrag}
						title={entry?.status === 'ready' ? m.video_editor_media_drag_hint() : undefined}
						class="group flex items-center gap-1 rounded-md p-1 hover:bg-[oklch(0.22_0.01_50)] {entry?.status ===
						'ready'
							? 'cursor-grab active:cursor-grabbing'
							: ''}"
					>
						<button
							type="button"
							class="flex min-w-0 flex-1 items-center gap-2 rounded p-0.5 text-left focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-60"
							disabled={entry?.status !== 'ready'}
							onclick={() => entry && onsourceopen(id)}
							title={m.video_editor_source_monitor()}
						>
							<span
								class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-[oklch(0.22_0.01_50)]"
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
								<span class="block truncate text-xs font-medium">{entry?.media.fileName}</span>
								{#if entry?.status === 'ready'}
									<span class="block text-[11px] text-[oklch(0.65_0.015_55)]">
										{formatMediaListSummary(entry.media)}
									</span>
								{/if}
							</span>
						</button>
						{#if entry}
							<MediaInfoPopover media={entry.media} />
						{/if}
						{#if entry?.status === 'ready'}
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-xs"
											class="size-11! text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100 sm:size-7!"
											aria-label={m.video_editor_media_more_actions({ name: entry.media.fileName })}
										>
											<MoreIcon class="size-3.5" aria-hidden="true" />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content class="video-editor-theme w-52" align="end">
									{#if canExtractEmbeddedSubtitles(entry.media)}
										<DropdownMenu.Item onclick={() => openSubtitlePicker(entry.media)}>
											<CaptionsIcon class="size-4" aria-hidden="true" />
											{m.video_editor_extract_embedded_subtitles()}
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
									{/if}
									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger
											disabled={!upscaleService.canUpscaleMedia(entry.media) || mediaProcessing(id)}
											aria-label={upscaleActionLabel(entry.media)}
											title={upscaleActionLabel(entry.media)}
										>
											<ScanLineIcon class="size-4" aria-hidden="true" />
											{m.video_editor_media_upscale()}
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="video-editor-theme w-44">
											<DropdownMenu.Item onclick={() => upscaleMedia(entry.media, 'liveAction')}>
												{m.video_editor_media_upscale_live_action()}
											</DropdownMenu.Item>
											<DropdownMenu.Item onclick={() => upscaleMedia(entry.media, 'animation')}>
												{m.video_editor_media_upscale_animation()}
											</DropdownMenu.Item>
											<DropdownMenu.Item onclick={() => upscaleMedia(entry.media, 'threeD')}>
												{m.video_editor_media_upscale_3d()}
											</DropdownMenu.Item>
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>
									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger
											disabled={!frameInterpolationService.canInterpolateMedia(entry.media) ||
												mediaProcessing(id)}
											aria-label={interpolationActionLabel(entry.media)}
											title={interpolationActionLabel(entry.media)}
										>
											<GaugeIcon class="size-4" aria-hidden="true" />
											{m.video_editor_media_interpolate()}
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="video-editor-theme w-32">
											{#each SUPPORTED_INTERPOLATION_FACTORS as factor}
												<DropdownMenu.Item onclick={() => interpolateMedia(entry.media, factor)}>
													{factor}x
												</DropdownMenu.Item>
											{/each}
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						{/if}
						<button
							type="button"
							class="flex size-11 shrink-0 items-center justify-center rounded text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-30 sm:size-7"
							disabled={entry?.status !== 'ready'}
							aria-label={`${m.video_editor_media_place()}: ${entry?.media.fileName ?? ''}`}
							title={m.video_editor_media_place()}
							onclick={() => entry && placeMedia(entry.media)}
						>
							<PlusIcon class="size-3.5" aria-hidden="true" />
						</button>
					</li>
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

<EmbeddedSubtitlePicker
	media={subtitleMedia}
	bind:open={subtitlePickerOpen}
	{canvasWidth}
	{canvasHeight}
	oninsert={handleSubtitleInsert}
/>

<MediaUrlImportDialog bind:open={urlImportOpen} onimport={importUrl} />

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.video_editor_sequence_delete_title({ name: deleteTarget?.name ?? '' })}
	description={deleteTarget
		? deleteReferenceCount > 0
			? deleteReferenceCount === 1
				? m.video_editor_sequence_delete_reference()
				: m.video_editor_sequence_delete_references({ count: deleteReferenceCount })
			: m.video_editor_sequence_delete_unused()
		: ''}
	confirmLabel={m.common_delete()}
	onConfirm={() => {
		if (!deleteTarget) return { ok: false, message: m.video_editor_sequence_delete_failed() };
		const target = deleteTarget;
		editorSession.pausePlayback();
		if (!deleteSequence(target.id)) {
			return { ok: false, message: m.video_editor_sequence_delete_failed() };
		}
		compoundThumbnailService.clear(target.id);
		editorSession.syncTimelineClock();
		editorSession.scheduleAutosave();
		showToast(m.video_editor_sequence_deleted({ name: target.name }), 'success');
		deleteTarget = null;
		deleteReferenceCount = 0;
		return { ok: true };
	}}
/>
