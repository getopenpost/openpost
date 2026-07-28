<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import CameraCapture from './camera-capture.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { listStudioMedia } from '$lib/studio/api';
	import type { StudioMediaItem } from '$lib/studio/types';
	import SearchIcon from 'lucide-svelte/icons/search';
	import UploadIcon from 'lucide-svelte/icons/upload';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import ImageIcon from 'lucide-svelte/icons/image';
	import VideoIcon from 'lucide-svelte/icons/video';
	import PaletteIcon from 'lucide-svelte/icons/palette';
	import CheckIcon from 'lucide-svelte/icons/check';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import ArrowLeftIcon from 'lucide-svelte/icons/arrow-left';
	import { m } from '$lib/paraglide/messages';
	import { effectiveVideoConstraints } from '$lib/video/constraints';
	import { videoPreparationErrorMessage } from '$lib/video/errors';
	import type {
		VideoConstraint,
		VideoPreparationProgress,
		VideoPreparationStage
	} from '$lib/video/types';

	let {
		open = $bindable(false),
		workspaceId,
		currentSelection = [],
		accept = ['image/*', 'video/*'],
		maxSelection = 4,
		multiple = true,
		title = m.media_picker_add_media(),
		purpose = 'post_media',
		showCreate = true,
		desktopSize = 'default',
		presentation = 'dialog',
		videoConstraints = [],
		onConfirm,
		onCreate
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
		videoConstraints?: VideoConstraint[];
		onConfirm: (mediaIDs: string[], media: StudioMediaItem[]) => void | Promise<void>;
		onCreate?: () => void | Promise<void>;
	} = $props();

	let mode = $state<'library' | 'camera'>('library');
	let media = $state<StudioMediaItem[]>([]);
	let selectedIDs = $state.raw<string[]>([]);
	let search = $state('');
	let loading = $state(false);
	let actionLoading = $state(false);
	let error = $state('');
	let uploadInput = $state<HTMLInputElement>();
	let loadedForWorkspace = $state('');
	let uploadProgress = $state<VideoPreparationProgress | null>(null);
	let uploadController: AbortController | null = null;
	let editorOpen = $state(false);
	let editorFile = $state<File | null>(null);
	let videoEditorModule = $state.raw<Promise<typeof import('./video-editor-dialog.svelte')> | null>(
		null
	);
	const editorAspectRatios = $derived(effectiveVideoConstraints(videoConstraints).aspectRatios);

	function attachUploadInput(node: HTMLInputElement) {
		uploadInput = node;
		return () => {
			if (uploadInput === node) uploadInput = undefined;
		};
	}

	function initializePicker() {
		selectedIDs = [...currentSelection];
		mode = 'library';
		error = '';
		if (loadedForWorkspace !== workspaceId) void loadMedia();
	}

	async function loadMedia(): Promise<void> {
		if (!workspaceId) return;
		loading = true;
		error = '';
		try {
			const allowsImages = accept.some((mime) => mime === 'image/*' || mime.startsWith('image/'));
			const allowsVideos = accept.some((mime) => mime === 'video/*' || mime.startsWith('video/'));
			const requestedType = allowsImages && allowsVideos ? 'all' : allowsVideos ? 'video' : 'image';
			media = (await listStudioMedia(workspaceId, search, requestedType)).filter((item) =>
				mimeAllowed(item.mime_type)
			);
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
					.filter((item): item is StudioMediaItem => Boolean(item))
			);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_add_failed();
		} finally {
			actionLoading = false;
		}
	}

	async function uploadFiles(files: FileList | null): Promise<void> {
		if (!files?.length) return;
		const available = Math.max(0, maxSelection - selectedIDs.length);
		const candidates = Array.from(files)
			.filter((file) => mimeAllowed(file.type))
			.slice(0, available);
		if (candidates.length === 1 && candidates[0].type.startsWith('video/')) {
			await openVideoEditor(candidates[0]);
			if (uploadInput) uploadInput.value = '';
			return;
		}
		await performUploads(candidates);
	}

	async function openVideoEditor(file: File): Promise<void> {
		actionLoading = true;
		error = '';
		editorFile = file;
		try {
			videoEditorModule ??= import('./video-editor-dialog.svelte');
			await videoEditorModule;
			editorOpen = true;
		} catch (cause) {
			videoEditorModule = null;
			editorFile = null;
			error = videoPreparationErrorMessage(cause, m.media_picker_upload_failed());
		} finally {
			actionLoading = false;
		}
	}

	async function performUploads(files: File[]): Promise<void> {
		if (files.length === 0) return;
		actionLoading = true;
		error = '';
		uploadController = new AbortController();
		try {
			for (const file of files) {
				uploadProgress = {
					stage: file.type.startsWith('video/') ? 'inspecting' : 'uploading',
					fraction: 0,
					message: ''
				};
				const uploaded = await uploadMediaFile({
					workspaceId,
					file,
					source: 'upload',
					videoConstraints,
					onProgress: (progress) => (uploadProgress = progress),
					signal: uploadController.signal
				});
				selectedIDs = [...selectedIDs, uploaded.id];
			}
			await loadMedia();
			mode = 'library';
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') {
				error = '';
				return;
			}
			error = videoPreparationErrorMessage(cause, m.media_picker_upload_failed());
		} finally {
			actionLoading = false;
			uploadProgress = null;
			uploadController = null;
			if (uploadInput) uploadInput.value = '';
		}
	}

	async function useEditorFile(file: File): Promise<void> {
		editorFile = null;
		await performUploads([file]);
	}

	function cancelUpload() {
		uploadController?.abort();
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

	async function capturePhoto(file: File): Promise<void> {
		actionLoading = true;
		error = '';
		try {
			const uploaded = await uploadMediaFile({ workspaceId, file, source: 'camera' });
			selectedIDs = multiple ? [...selectedIDs, uploaded.id].slice(0, maxSelection) : [uploaded.id];
			await loadMedia();
			mode = 'library';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_photo_failed();
		} finally {
			actionLoading = false;
		}
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
					`/studio/new?workspace=${encodeURIComponent(workspaceId)}&purpose=${encodeURIComponent(purpose)}` as '/'
				)
			);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_studio_failed();
		} finally {
			actionLoading = false;
		}
	}
</script>

{#snippet pickerBody()}
	{#if mode === 'library'}
		<div class="grid grid-cols-2 gap-2 border-b px-4 py-3 {showCreate ? 'sm:grid-cols-3' : ''}">
			<label
				class="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium focus-within:ring-2 focus-within:ring-ring hover:bg-muted"
			>
				{#if actionLoading}<LoaderIcon class="size-4 animate-spin" />{:else}<UploadIcon
						class="size-4"
					/>{/if}
				{m.media_picker_upload()}
				<Input
					{@attach attachUploadInput}
					type="file"
					{multiple}
					accept={accept.join(',')}
					class="sr-only"
					disabled={actionLoading}
					onchange={(event) => uploadFiles(event.currentTarget.files)}
				/>
			</label>
			<Button
				variant="outline"
				class="min-h-11"
				disabled={actionLoading}
				onclick={() => (mode = 'camera')}
			>
				<CameraIcon />
				{m.studio_camera()}
			</Button>
			{#if showCreate}
				<Button
					variant="outline"
					class="min-h-11 max-sm:col-span-2"
					disabled={actionLoading}
					onclick={createDesign}
				>
					<PaletteIcon />
					{m.media_picker_create()}
				</Button>
			{/if}
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
			<form
				class="mb-3 flex gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					void loadMedia();
				}}
			>
				<div class="relative flex-1">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input bind:value={search} class="pl-9" placeholder={m.media_picker_search()} />
				</div>
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
					<p class="font-medium">{m.media_picker_no_match()}</p>
					<p class="mt-1 text-sm text-muted-foreground">{m.media_picker_no_match_body()}</p>
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
							{:else}
								<img
									src={getAuthenticatedMediaURL(item.thumbnail_url || item.url)}
									alt={item.alt_text || item.original_filename}
									class="size-full object-cover transition-transform group-hover:scale-[1.02]"
									loading="lazy"
								/>
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
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto p-4">
			<Button variant="ghost" class="mb-3" onclick={() => (mode = 'library')}>
				<ArrowLeftIcon />
				{m.media_picker_back_to_library()}
			</Button>
			<CameraCapture onCapture={capturePhoto} />
		</div>
	{/if}

	{#if error}
		<div
			class="mx-4 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
			role="alert"
		>
			{error}
		</div>
	{/if}
	{#if uploadProgress}
		<div class="mx-4 mb-3 space-y-2 rounded-lg border bg-muted/20 px-3 py-3" aria-live="polite">
			<div class="flex items-center justify-between gap-3">
				<p class="text-sm font-medium">
					{m.video_upload_progress({
						stage: uploadStage(uploadProgress.stage),
						percent: Math.round(uploadProgress.fraction * 100)
					})}
				</p>
				<Button type="button" variant="ghost" size="sm" onclick={cancelUpload}>
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
	{#if mode === 'library'}
		<div class="flex flex-col-reverse gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end">
			<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
			<Button onclick={confirm} disabled={actionLoading || selectedIDs.length === 0}>
				{#if actionLoading}<LoaderIcon class="animate-spin" />{/if}
				{m.media_picker_add_media()}
			</Button>
		</div>
	{/if}
{/snippet}

{#if presentation === 'sheet'}
	<Sheet.Root bind:open>
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
	<Dialog.Root bind:open>
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

{#if videoEditorModule}
	{#await videoEditorModule then { default: VideoEditorDialog }}
		<VideoEditorDialog
			bind:open={editorOpen}
			file={editorFile}
			allowedAspectRatios={editorAspectRatios}
			onConfirm={useEditorFile}
			onSkip={useEditorFile}
		/>
	{/await}
{/if}
