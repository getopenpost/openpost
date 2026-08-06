<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { formatBytes } from '$lib/video/constraints';
	import { renderVideoEdit } from '$lib/video/editor';
	import { videoPreparationErrorMessage } from '$lib/video/errors';
	import { probeVideo } from '$lib/video/prepare';
	import { firstPlatformVideoCodec } from '$lib/video/support';
	import type { VideoMetadata } from '$lib/video/types';
	import VideoCropOverlay from './video-crop-overlay.svelte';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import ScissorsIcon from 'lucide-svelte/icons/scissors';

	interface Props {
		open?: boolean;
		file: File | null;
		allowedAspectRatios?: string[];
		onConfirm: (file: File) => void | Promise<void>;
		onSkip: (file: File) => void | Promise<void>;
	}

	let {
		open = $bindable(false),
		file,
		allowedAspectRatios = [],
		onConfirm,
		onSkip
	}: Props = $props();

	let sourceURL = $state('');
	let metadata = $state<VideoMetadata | null>(null);
	let loading = $state(false);
	let rendering = $state(false);
	let renderProgress = $state(0);
	let error = $state('');
	let trimStart = $state(0);
	let trimEnd = $state(0);
	let selectedAspect = $state('original');
	let crop = $state.raw<{ x: number; y: number; width: number; height: number } | null>(null);
	let cropZoom = $state(100);
	let cropSupported = $state<boolean | null>(null);
	let videoElement: HTMLVideoElement | null = null;
	let currentTime = $state(0);
	let renderController: AbortController | null = null;
	let probeSequence = 0;

	const aspectOptions = $derived.by(() => {
		const requested = allowedAspectRatios.filter(parseAspect);
		const values = requested.length > 0 ? requested : ['9:16', '1:1', '4:5', '16:9'];
		return ['original', ...new Set(values)];
	});
	const duration = $derived(metadata?.durationSeconds ?? 0);
	const hasEdit = $derived(
		Boolean(
			metadata &&
			(trimStart > 0.01 ||
				trimEnd < metadata.durationSeconds - 0.01 ||
				(crop &&
					(crop.x > 0.5 ||
						crop.y > 0.5 ||
						Math.abs(crop.width - metadata.width) > 0.5 ||
						Math.abs(crop.height - metadata.height) > 0.5)))
		)
	);

	function initializeEditor() {
		if (!file) {
			sourceURL = '';
			metadata = null;
			return undefined;
		}
		const currentFile = file;
		const url = URL.createObjectURL(currentFile);
		sourceURL = url;
		metadata = null;
		const sequence = ++probeSequence;
		loading = true;
		error = '';
		selectedAspect = 'original';
		crop = null;
		cropZoom = 100;
		cropSupported = null;
		currentTime = 0;
		void probeVideo(currentFile)
			.then(async (details) => {
				if (sequence !== probeSequence) return;
				metadata = details;
				trimStart = 0;
				trimEnd = details.durationSeconds;
				try {
					cropSupported = Boolean(await firstPlatformVideoCodec(details.width, details.height));
				} catch {
					cropSupported = false;
				}
			})
			.catch((cause) => {
				if (sequence !== probeSequence) return;
				error = videoPreparationErrorMessage(cause, m.compose_upload_failed());
			})
			.finally(() => {
				if (sequence === probeSequence) loading = false;
			});
		return () => {
			probeSequence += 1;
			URL.revokeObjectURL(url);
		};
	}

	function updateStart(value: number) {
		trimStart = clamp(value, 0, Math.max(0, trimEnd - 0.1));
		seekTo(trimStart);
	}

	function updateEnd(value: number) {
		trimEnd = clamp(value, Math.min(duration, trimStart + 0.1), duration);
		seekTo(trimEnd);
	}

	function selectAspect(aspect: string) {
		selectedAspect = aspect;
		cropZoom = 100;
		crop = metadata ? cropForAspect(metadata, aspect, 1, null) : null;
	}

	function updateCropZoom(value: number) {
		if (!metadata || selectedAspect === 'original') return;
		cropZoom = clamp(value, 25, 100);
		crop = cropForAspect(metadata, selectedAspect, cropZoom / 100, crop);
	}

	function attachVideo(node: HTMLVideoElement) {
		videoElement = node;
		return () => {
			if (videoElement === node) videoElement = null;
		};
	}

	function seekTo(time: number) {
		if (!videoElement || !Number.isFinite(time)) return;
		videoElement.currentTime = clamp(time, 0, duration);
		currentTime = videoElement.currentTime;
	}

	function trackPlayback() {
		if (!videoElement) return;
		if (videoElement.currentTime >= trimEnd) {
			videoElement.pause();
			videoElement.currentTime = trimStart;
		}
		currentTime = videoElement.currentTime;
	}

	async function applyEdit() {
		if (!file || !metadata || rendering) return;
		if (!hasEdit) {
			await finish(file);
			return;
		}
		rendering = true;
		renderProgress = 0;
		error = '';
		renderController = new AbortController();
		try {
			const edited = await renderVideoEdit(
				file,
				{
					version: 1,
					trim: { startSeconds: trimStart, endSeconds: trimEnd },
					crop
				},
				(progress) => (renderProgress = Math.max(renderProgress, progress)),
				renderController.signal
			);
			await finish(edited);
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			error = videoPreparationErrorMessage(cause, m.compose_upload_failed());
		} finally {
			rendering = false;
			renderController = null;
		}
	}

	async function skipEdit() {
		if (!file || rendering) return;
		await finish(file, true);
	}

	async function finish(output: File, skipped = false) {
		open = false;
		if (skipped) await onSkip(output);
		else await onConfirm(output);
	}

	function closeEditor() {
		if (rendering) {
			renderController?.abort();
			return;
		}
		open = false;
	}

	function stageLabel(aspect: string): string {
		return aspect === 'original' ? m.video_upload_editor_original_aspect() : aspect;
	}

	function formatSeconds(value: number): string {
		if (!Number.isFinite(value)) return '0:00';
		const total = Math.max(0, Math.round(value));
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
	}

	function cropForAspect(
		details: VideoMetadata,
		aspect: string,
		scale: number,
		previous: { x: number; y: number; width: number; height: number } | null
	): { x: number; y: number; width: number; height: number } | null {
		const target = parseAspect(aspect);
		if (!target || details.width <= 0 || details.height <= 0) return null;
		const current = details.width / details.height;
		const centerX = previous ? previous.x + previous.width / 2 : details.width / 2;
		const centerY = previous ? previous.y + previous.height / 2 : details.height / 2;
		let width: number;
		let height: number;
		if (current > target) {
			height = details.height * scale;
			width = height * target;
		} else {
			width = details.width * scale;
			height = width / target;
		}
		return {
			x: clamp(centerX - width / 2, 0, details.width - width),
			y: clamp(centerY - height / 2, 0, details.height - height),
			width,
			height
		};
	}

	function parseAspect(value: string): number | null {
		const [width, height] = value.split(':').map(Number);
		return width > 0 && height > 0 ? width / height : null;
	}

	function clamp(value: number, minimum: number, maximum: number): number {
		return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="grid max-h-dvh gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-4xl"
		showCloseButton={!rendering}
		onInteractOutside={(event) => rendering && event.preventDefault()}
		onEscapeKeydown={(event) => rendering && event.preventDefault()}
	>
		<div class="contents" {@attach initializeEditor}></div>
		<Dialog.Header class="border-b px-4 py-4 pr-14 sm:px-5">
			<Dialog.Title class="flex items-center gap-2">
				<ScissorsIcon class="size-4" />
				{m.video_upload_editor_title()}
			</Dialog.Title>
			<Dialog.Description>{m.video_upload_editor_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="grid min-h-0 overflow-y-auto lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
			<div
				class="flex min-h-64 items-center justify-center overflow-hidden bg-black p-3 sm:min-h-96"
			>
				{#if sourceURL && metadata}
					<div
						class="relative max-h-[60dvh] max-w-full overflow-hidden"
						style:aspect-ratio={`${metadata.width} / ${metadata.height}`}
						style:width={`min(100%, calc(60dvh * ${metadata.width / metadata.height}))`}
					>
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							{@attach attachVideo}
							src={sourceURL}
							class="absolute inset-0 size-full"
							controls
							playsinline
							ontimeupdate={trackPlayback}
							onloadedmetadata={() => seekTo(trimStart)}
						></video>
						{#if crop}
							<VideoCropOverlay
								sourceWidth={metadata.width}
								sourceHeight={metadata.height}
								{crop}
								label={m.video_upload_editor_crop_position()}
								onChange={(nextCrop) => (crop = nextCrop)}
							/>
						{/if}
					</div>
				{:else}
					<LoaderIcon class="size-6 animate-spin text-white" />
				{/if}
			</div>

			<div class="space-y-5 p-4 sm:p-5">
				{#if loading}
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<LoaderIcon class="size-4 animate-spin" />
						{m.video_upload_editor_loading()}
					</div>
				{:else if metadata && file}
					<div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
						<span class="rounded-full border px-2 py-1">{metadata.width}×{metadata.height}</span>
						<span class="rounded-full border px-2 py-1">{formatSeconds(duration)}</span>
						<span class="rounded-full border px-2 py-1">{formatBytes(file.size)}</span>
					</div>

					<fieldset class="space-y-3">
						<legend class="text-sm font-medium">{m.video_upload_editor_trim()}</legend>
						<div class="grid grid-cols-2 gap-3">
							<label class="space-y-1 text-xs text-muted-foreground">
								<span>{m.video_upload_editor_start()}</span>
								<Input
									type="number"
									min="0"
									max={Math.max(0, trimEnd - 0.1)}
									step="0.1"
									value={trimStart}
									oninput={(event) => updateStart(event.currentTarget.valueAsNumber)}
								/>
							</label>
							<label class="space-y-1 text-xs text-muted-foreground">
								<span>{m.video_upload_editor_end()}</span>
								<Input
									type="number"
									min={Math.min(duration, trimStart + 0.1)}
									max={duration}
									step="0.1"
									value={trimEnd}
									oninput={(event) => updateEnd(event.currentTarget.valueAsNumber)}
								/>
							</label>
						</div>
						<div class="space-y-2">
							<Slider
								min={0}
								max={duration}
								step={0.1}
								value={trimStart}
								ariaLabel={m.video_upload_editor_start()}
								onValueChange={updateStart}
							/>
							<Slider
								min={0}
								max={duration}
								step={0.1}
								value={trimEnd}
								ariaLabel={m.video_upload_editor_end()}
								onValueChange={updateEnd}
							/>
						</div>
						<p class="text-xs text-muted-foreground">
							{formatSeconds(trimStart)} – {formatSeconds(trimEnd)} ·
							{formatSeconds(currentTime)}
						</p>
					</fieldset>

					<fieldset class="space-y-2">
						<legend class="text-sm font-medium">{m.video_upload_editor_aspect()}</legend>
						<div class="flex flex-wrap gap-2">
							{#each aspectOptions as aspect (aspect)}
								<Button
									type="button"
									size="sm"
									class="min-h-12"
									variant={selectedAspect === aspect ? 'default' : 'outline'}
									aria-pressed={selectedAspect === aspect}
									disabled={aspect !== 'original' && cropSupported !== true}
									onclick={() => selectAspect(aspect)}
								>
									{stageLabel(aspect)}
								</Button>
							{/each}
						</div>
						{#if cropSupported === false}
							<p class="text-xs text-muted-foreground">
								{m.video_upload_editor_crop_unavailable()}
							</p>
						{/if}
						{#if crop}
							<label class="grid gap-2 pt-2 text-xs text-muted-foreground">
								<span class="flex items-center justify-between gap-3">
									{m.video_upload_editor_crop_zoom()}
									<span>{cropZoom}%</span>
								</span>
								<Slider
									min={25}
									max={100}
									step={1}
									value={cropZoom}
									ariaLabel={m.video_upload_editor_crop_zoom()}
									onValueChange={updateCropZoom}
								/>
							</label>
						{/if}
					</fieldset>
				{/if}

				{#if rendering}
					<div class="space-y-2" aria-live="polite">
						<div class="h-2 overflow-hidden rounded-full bg-muted">
							<div
								class="h-full rounded-full bg-primary transition-[width]"
								style:width={`${Math.round(renderProgress * 100)}%`}
							></div>
						</div>
						<p class="text-xs text-muted-foreground">
							{m.video_upload_editor_rendering({ percent: Math.round(renderProgress * 100) })}
						</p>
					</div>
				{/if}

				{#if error}
					<p class="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
						{error}
					</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer class="border-t px-4 py-3 sm:px-5">
			<Button
				type="button"
				variant="ghost"
				class="min-h-12"
				disabled={!file || rendering}
				onclick={skipEdit}
			>
				{m.video_upload_editor_use_original()}
			</Button>
			<Button type="button" variant="outline" class="min-h-12" onclick={closeEditor}>
				{rendering ? m.video_upload_cancel() : m.common_cancel()}
			</Button>
			<Button type="button" class="min-h-12" disabled={!metadata || rendering} onclick={applyEdit}>
				{#if rendering}<LoaderIcon class="size-4 animate-spin" />{/if}
				{m.video_upload_editor_apply()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
