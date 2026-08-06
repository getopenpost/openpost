<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import CameraCapture from '$lib/components/camera-capture.svelte';
	import StockMediaBrowser from '$lib/components/stock-media-browser.svelte';
	import VideoEditorDialog from '$lib/components/video-editor-dialog.svelte';
	import { uploadMediaFile, type MediaUploadResult } from '$lib/media-upload-client';
	import { formatBytes } from '$lib/video/constraints';
	import { videoPreparationErrorMessage } from '$lib/video/errors';
	import type {
		VideoConstraint,
		VideoPreparationProgress,
		VideoPreparationStage
	} from '$lib/video/types';
	import type { StockAsset } from '$lib/video-editor/api';
	import type { StockMediaProvenance } from '@openpost/video-project';
	import CheckIcon from 'lucide-svelte/icons/check';
	import FileAudioIcon from 'lucide-svelte/icons/file-audio';
	import FileIcon from 'lucide-svelte/icons/file';
	import ImageIcon from 'lucide-svelte/icons/image';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import RefreshCwIcon from 'lucide-svelte/icons/refresh-cw';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import UploadIcon from 'lucide-svelte/icons/upload';
	import VideoIcon from 'lucide-svelte/icons/video';
	import XIcon from 'lucide-svelte/icons/x';
	import { m } from '$lib/paraglide/messages';

	type AcquisitionMode = 'device' | 'camera' | 'stock';
	type QueueStatus = 'ready' | 'uploading' | 'success' | 'error';

	interface QueueItem {
		id: string;
		file: File;
		preparedFile?: File;
		previewURL: string;
		status: QueueStatus;
		progress: number;
		stage: VideoPreparationStage | 'ready';
		error: string;
		source: 'upload' | 'camera' | 'stock_import';
		provenance?: StockMediaProvenance;
		result?: MediaUploadResult;
	}

	let {
		mode,
		workspaceId,
		accept = ['image/*', 'video/*', 'audio/*'],
		maxFiles = 10,
		retentionClass = 'library',
		tagId,
		videoConstraints = [],
		initialFiles = [],
		onInitialFilesConsumed,
		onUploaded
	}: {
		mode: AcquisitionMode;
		workspaceId: string;
		accept?: string[];
		maxFiles?: number;
		retentionClass?: 'library' | 'temporary';
		tagId?: string;
		videoConstraints?: VideoConstraint[];
		initialFiles?: File[];
		onInitialFilesConsumed?: () => void;
		onUploaded: (
			results: MediaUploadResult[],
			outcome: { allSucceeded: boolean }
		) => void | Promise<void>;
	} = $props();

	let queue = $state.raw<QueueItem[]>([]);
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragging = $state(false);
	let busy = $state(false);
	let error = $state('');
	let currentController: AbortController | null = null;
	let videoEditorOpen = $state(false);
	let videoEditorFile = $state.raw<File | null>(null);
	let resolveVideoEdit: ((file: File | null) => void) | null = null;

	const readyCount = $derived(queue.filter((item) => item.status === 'ready').length);
	const successfulCount = $derived(queue.filter((item) => item.status === 'success').length);
	const allowedVideoAspectRatios = $derived(
		videoConstraints.flatMap((constraint) => constraint.aspect_ratios ?? [])
	);
	const stockAccept = $derived(
		acceptsKind('image') && acceptsKind('video') ? 'both' : acceptsKind('video') ? 'video' : 'photo'
	);

	function initialize(): () => void {
		untrack(() => {
			if (initialFiles.length > 0) {
				addFiles(initialFiles, 'upload');
				onInitialFilesConsumed?.();
			}
		});
		return () => {
			currentController?.abort();
			for (const item of queue) revokePreview(item.previewURL);
		};
	}

	function acceptsKind(kind: 'image' | 'video' | 'audio'): boolean {
		return accept.some(
			(candidate) => candidate === `${kind}/*` || candidate.startsWith(`${kind}/`)
		);
	}

	function handlePaste(event: ClipboardEvent): void {
		if (mode !== 'device' || busy) return;
		const files = Array.from(event.clipboardData?.files ?? []);
		if (files.length === 0) return;
		event.preventDefault();
		addFiles(files, 'upload');
	}

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		dragging = false;
		if (busy) return;
		addFiles(Array.from(event.dataTransfer?.files ?? []), 'upload');
	}

	function handleFileInput(): void {
		const files = Array.from(fileInput?.files ?? []);
		if (files.length > 0) addFiles(files, 'upload');
		if (fileInput) fileInput.value = '';
	}

	function addFiles(
		files: File[],
		source: QueueItem['source'],
		provenance?: StockMediaProvenance
	): QueueItem[] {
		error = '';
		const remaining = Math.max(0, maxFiles - queue.length);
		const accepted = files.slice(0, remaining);
		const signatures = queue.map(
			(item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`
		);
		const additions = accepted.flatMap((file) => {
			const signature = `${file.name}:${file.size}:${file.lastModified}`;
			if (signatures.includes(signature)) return [];
			signatures.push(signature);
			const validationError = validateFile(file);
			return [
				{
					id: crypto.randomUUID(),
					file,
					previewURL:
						file.type.startsWith('image/') || isVideoFile(file) ? URL.createObjectURL(file) : '',
					status: validationError ? ('error' as const) : ('ready' as const),
					progress: 0,
					stage: 'ready' as const,
					error: validationError,
					source,
					provenance
				}
			];
		});
		queue = [...queue, ...additions];
		if (files.length > remaining) {
			error = m.media_upload_too_many({ maximum: maxFiles });
		} else if (files.length > 0 && additions.length === 0) {
			error = m.media_upload_duplicates();
		}
		return additions;
	}

	function validateFile(file: File): string {
		if (file.size <= 0) return m.media_upload_empty_file({ name: file.name });
		if (!mimeAllowed(file)) return m.media_upload_unsupported({ name: file.name });
		const video = isVideoFile(file);
		const limit = video ? 16 * 1024 * 1024 * 1024 : 50 * 1024 * 1024;
		if (file.size > limit) {
			return video
				? m.media_upload_video_too_large({ name: file.name })
				: m.media_upload_file_too_large({ name: file.name });
		}
		return '';
	}

	function mimeAllowed(file: File): boolean {
		const inferred = inferredMIME(file.name);
		return accept.some((accepted) => {
			if (accepted === '*/*') return true;
			if (accepted.endsWith('/*')) {
				const prefix = accepted.slice(0, -1);
				return file.type.startsWith(prefix) || inferred.startsWith(prefix);
			}
			return file.type === accepted || inferred === accepted;
		});
	}

	function inferredMIME(name: string): string {
		if (/\.(png|jpe?g|gif|webp|avif|svg|heic|heif)$/i.test(name)) return 'image/unknown';
		if (/\.(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg)$/i.test(name)) return 'video/unknown';
		if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return 'audio/unknown';
		return '';
	}

	function isVideoFile(file: File): boolean {
		return file.type.startsWith('video/') || inferredMIME(file.name).startsWith('video/');
	}

	async function uploadReady(): Promise<void> {
		if (busy || !workspaceId) return;
		busy = true;
		error = '';
		const completed: MediaUploadResult[] = [];
		try {
			for (const item of queue) {
				if (item.status !== 'ready') continue;
				const result = await uploadOne(item);
				if (result) completed.push(result);
			}
			if (completed.length > 0) {
				await onUploaded(completed, {
					allSucceeded: queue.length > 0 && queue.every((item) => item.status === 'success')
				});
			}
		} finally {
			busy = false;
			currentController = null;
		}
	}

	async function uploadOne(item: QueueItem): Promise<MediaUploadResult | null> {
		updateItem(item.id, { status: 'uploading', progress: 0, stage: 'uploading', error: '' });
		currentController = new AbortController();
		try {
			let uploadFile = item.preparedFile ?? item.file;
			if (!item.preparedFile && isVideoFile(item.file)) {
				const edited = await requestVideoEdit(item.file);
				if (!edited) {
					updateItem(item.id, { status: 'ready', progress: 0, stage: 'ready' });
					return null;
				}
				uploadFile = edited;
				updateItem(item.id, { preparedFile: edited });
			}
			const result = await uploadMediaFile({
				workspaceId,
				file: uploadFile,
				source: item.source,
				retentionClass,
				tagId,
				stockProvenance: item.provenance,
				videoConstraints,
				signal: currentController.signal,
				onProgress: (progress) => updateProgress(item.id, progress)
			});
			updateItem(item.id, {
				status: 'success',
				progress: 1,
				stage: 'finalizing',
				result
			});
			return result;
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') {
				updateItem(item.id, { status: 'ready', progress: 0, stage: 'ready' });
				return null;
			}
			updateItem(item.id, {
				status: 'error',
				error: videoPreparationErrorMessage(cause, m.media_picker_upload_failed())
			});
			return null;
		}
	}

	async function capturePhoto(file: File): Promise<void> {
		const [item] = addFiles([file], 'camera');
		if (!item || item.status === 'error') {
			error = item?.error || m.media_picker_upload_failed();
			return;
		}
		busy = true;
		try {
			const result = await uploadOne(item);
			if (result) await onUploaded([result], { allSucceeded: true });
			else error = queue.find((candidate) => candidate.id === item.id)?.error || '';
		} finally {
			busy = false;
			currentController = null;
		}
	}

	async function addStockMedia(file: File, asset: StockAsset): Promise<void> {
		const [item] = addFiles([file], 'stock_import', stockProvenance(asset));
		if (!item || item.status === 'error') {
			error = item?.error || m.media_picker_upload_failed();
			return;
		}
		busy = true;
		try {
			const result = await uploadOne(item);
			if (result) await onUploaded([result], { allSucceeded: true });
			else error = queue.find((candidate) => candidate.id === item.id)?.error || '';
		} finally {
			busy = false;
			currentController = null;
		}
	}

	function stockProvenance(asset: StockAsset): StockMediaProvenance {
		return {
			provider: asset.provider,
			external_id: asset.external_id,
			source_url: asset.source_url,
			creator_name: asset.creator_name,
			creator_url: asset.creator_url,
			license_name: asset.license_name,
			license_url: asset.license_url,
			attribution_text: asset.attribution_text
		};
	}

	function updateProgress(id: string, progress: VideoPreparationProgress): void {
		updateItem(id, {
			progress: Math.max(0, Math.min(1, progress.fraction)),
			stage: progress.stage
		});
	}

	function updateItem(id: string, patch: Partial<QueueItem>): void {
		queue = queue.map((item) => (item.id === id ? { ...item, ...patch } : item));
	}

	function removeItem(id: string): void {
		const item = queue.find((candidate) => candidate.id === id);
		if (item) revokePreview(item.previewURL);
		queue = queue.filter((candidate) => candidate.id !== id);
	}

	function retryItem(id: string): void {
		updateItem(id, { status: 'ready', progress: 0, stage: 'ready', error: '' });
		void uploadReady();
	}

	function clearFinished(): void {
		for (const item of queue) {
			if (item.status === 'success') revokePreview(item.previewURL);
		}
		queue = queue.filter((item) => item.status !== 'success');
	}

	function cancelCurrent(): void {
		currentController?.abort();
	}

	function requestVideoEdit(file: File): Promise<File | null> {
		videoEditorFile = file;
		videoEditorOpen = true;
		return new Promise((resolve) => {
			resolveVideoEdit = resolve;
		});
	}

	function completeVideoEdit(file: File | null): void {
		videoEditorOpen = false;
		videoEditorFile = null;
		const resolve = resolveVideoEdit;
		resolveVideoEdit = null;
		resolve?.(file);
	}

	function uploadStage(stage: QueueItem['stage']): string {
		switch (stage) {
			case 'ready':
				return m.media_upload_ready();
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

	function revokePreview(url: string): void {
		if (url) URL.revokeObjectURL(url);
	}
</script>

<svelte:window onpaste={handlePaste} />

<div class="contents" {@attach initialize}></div>

{#if mode === 'device'}
	<div class="space-y-4">
		<button
			type="button"
			class={[
				'group flex min-h-44 w-full flex-col items-center justify-center rounded-xl border border-dashed px-5 text-center transition-colors focus-visible:ring-2 focus-visible:ring-ring',
				dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/15 hover:bg-muted/30'
			]}
			disabled={busy || queue.length >= maxFiles}
			onclick={() => fileInput?.click()}
			ondragenter={(event) => {
				event.preventDefault();
				dragging = true;
			}}
			ondragover={(event) => event.preventDefault()}
			ondragleave={() => (dragging = false)}
			ondrop={handleDrop}
		>
			<span
				class="mb-3 flex size-11 items-center justify-center rounded-lg bg-background ring-1 ring-border"
			>
				<UploadIcon class="size-5 text-primary" />
			</span>
			<span class="font-medium">{m.media_upload_drop_title()}</span>
			<span class="mt-1 max-w-md text-sm text-muted-foreground">
				{m.media_upload_drop_body()}
			</span>
			<span class="mt-3 text-xs text-muted-foreground">{m.media_upload_limits_accurate()}</span>
		</button>
		<Input
			bind:ref={fileInput}
			type="file"
			multiple={maxFiles > 1}
			accept={accept.join(',')}
			class="sr-only"
			onchange={handleFileInput}
		/>

		{#if error}
			<InlineNotice
				tone="error"
				message={error}
				dismissLabel={m.common_dismiss()}
				onDismiss={() => (error = '')}
			/>
		{/if}

		{#if queue.length > 0}
			<div class="overflow-hidden rounded-xl border">
				<div class="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2.5">
					<div>
						<p class="text-sm font-medium">{m.media_upload_queue()}</p>
						<p class="text-xs text-muted-foreground">
							{m.media_upload_queue_summary({ count: queue.length, maximum: maxFiles })}
						</p>
					</div>
					{#if successfulCount > 0}
						<Button variant="ghost" size="sm" onclick={clearFinished} disabled={busy}>
							{m.media_upload_clear_finished()}
						</Button>
					{/if}
				</div>
				<ul class="divide-y">
					{#each queue as item (item.id)}
						<li class="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
							<div
								class="flex size-12 items-center justify-center overflow-hidden rounded-lg bg-muted"
							>
								{#if item.previewURL && isVideoFile(item.file)}
									<video
										src={item.previewURL}
										class="size-full object-cover"
										muted
										playsinline
										preload="metadata"
										aria-label={item.file.name}
									></video>
								{:else if item.previewURL}
									<img src={item.previewURL} alt="" class="size-full object-cover" />
								{:else if item.file.type.startsWith('video/')}
									<VideoIcon class="size-5 text-muted-foreground" />
								{:else if item.file.type.startsWith('audio/')}
									<FileAudioIcon class="size-5 text-muted-foreground" />
								{:else if item.file.type.startsWith('image/')}
									<ImageIcon class="size-5 text-muted-foreground" />
								{:else}
									<FileIcon class="size-5 text-muted-foreground" />
								{/if}
							</div>
							<div class="min-w-0">
								<div class="flex min-w-0 items-center gap-2">
									<p class="truncate text-sm font-medium" title={item.file.name}>
										{item.file.name}
									</p>
									<span class="shrink-0 font-mono text-xs text-muted-foreground">
										{formatBytes(item.file.size)}
									</span>
								</div>
								{#if item.error}
									<p class="mt-1 text-xs text-destructive" role="alert">{item.error}</p>
								{:else}
									<p class="mt-1 text-xs text-muted-foreground">
										{item.status === 'success'
											? m.media_upload_complete()
											: uploadStage(item.stage)}
										{#if item.status === 'uploading'}
											· {Math.round(item.progress * 100)}%{/if}
									</p>
								{/if}
								{#if item.status === 'uploading'}
									<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
										<div
											class="h-full rounded-full bg-primary transition-[width]"
											style:width={`${Math.round(item.progress * 100)}%`}
										></div>
									</div>
								{/if}
							</div>
							<div class="flex items-center">
								{#if item.status === 'uploading'}
									<Button
										variant="ghost"
										size="icon-sm"
										onclick={cancelCurrent}
										aria-label={m.video_upload_cancel()}
									>
										<XIcon />
									</Button>
								{:else if item.status === 'success'}
									<span
										class="flex size-8 items-center justify-center text-emerald-600 dark:text-emerald-400"
										aria-label={m.media_upload_complete()}
									>
										<CheckIcon class="size-4" />
									</span>
								{:else if item.status === 'error' && !validateFile(item.file)}
									<Button
										variant="ghost"
										size="icon-sm"
										onclick={() => retryItem(item.id)}
										aria-label={m.common_retry()}
									>
										<RefreshCwIcon />
									</Button>
								{/if}
								{#if item.status !== 'uploading'}
									<Button
										variant="ghost"
										size="icon-sm"
										onclick={() => removeItem(item.id)}
										aria-label={m.media_upload_remove({ name: item.file.name })}
									>
										<TrashIcon />
									</Button>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-xs text-muted-foreground">{m.media_upload_paste_hint()}</p>
			<Button onclick={uploadReady} disabled={busy || readyCount === 0 || !workspaceId}>
				{#if busy}<LoaderIcon class="animate-spin" />{:else}<UploadIcon />{/if}
				{readyCount === 1
					? m.media_upload_one_file_action()
					: m.media_upload_files_action({ count: readyCount })}
			</Button>
		</div>
	</div>
{:else if mode === 'camera'}
	<div class="mx-auto w-full max-w-2xl">
		<CameraCapture onCapture={capturePhoto} />
		{#if busy}
			<p class="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
				<LoaderIcon class="size-4 animate-spin" />
				{m.media_uploading()}
			</p>
		{/if}
		{#if error}<InlineNotice tone="error" message={error} />{/if}
	</div>
{:else}
	<div class="space-y-3">
		<StockMediaBrowser accept={stockAccept} onSelect={addStockMedia} />
		{#if error}
			<InlineNotice
				tone="error"
				message={error}
				dismissLabel={m.common_dismiss()}
				onDismiss={() => (error = '')}
			/>
		{/if}
	</div>
{/if}

<VideoEditorDialog
	bind:open={videoEditorOpen}
	file={videoEditorFile}
	allowedAspectRatios={allowedVideoAspectRatios}
	onConfirm={(file) => completeVideoEdit(file)}
	onSkip={(file) => completeVideoEdit(file)}
	onCancel={() => completeVideoEdit(null)}
/>
