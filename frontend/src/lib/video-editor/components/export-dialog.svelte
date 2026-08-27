<!-- Export controls for container, quality, range, subtitles, progress, and cancel. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { canEncodeVideo, type VideoCodec } from 'mediabunny';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import AppSelect from '$lib/components/app-select.svelte';
	import type { Project } from '$lib/video-editor/project/types';
	import {
		defaultVideoCodec,
		supportedExportVideoCodecs,
		type RenderExportOptions,
		type RenderExportProgress,
		type RenderExportResult
	} from '$lib/video-editor/media/render-export';
	import { renderAudioExport, renderVideoExport, renderImageSequenceExport } from '$lib/video-editor/media/render-execution';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import {
		assessExportPreflight,
		summarizePreflightSeverity,
		type ExportPreflightCheck
	} from '$lib/video-editor/media/export-preflight';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import CheckCircleIcon from '@lucide/svelte/icons/circle-check';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import XCircleIcon from '@lucide/svelte/icons/circle-x';
	import {
		buildRenderQueueJob,
		buildSegmentRenderQueueJobs,
		rangesFromFixedDuration,
		rangesFromMarkers,
		type RenderQueueRange
	} from '../export/render-queue-job';
	import { renderQueueStore } from '../export/render-queue-store';
	import RenderQueuePanel from './render-queue-panel.svelte';
	import { captureSnapshot } from '../timeline/commands/snapshot.svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ListPlusIcon from '@lucide/svelte/icons/list-plus';
	import RenderProgress from './render-progress.svelte';
	import { sanitizeSequenceBaseName, getDirectoryPickerAvailable, canEncodeWebP } from '$lib/video-editor/media/image-sequence-export';

	let {
		project,
		disabled,
		ondone,
		onerror,
		probeCodec = canEncodeVideo,
		renderVideo = renderVideoExport,
		renderAudio = renderAudioExport,
		renderSequence = renderImageSequenceExport
	}: {
		project: Project | null;
		disabled?: boolean;
		ondone: (result: RenderExportResult) => void;
		onerror: (error: Error) => void;
		probeCodec?: typeof canEncodeVideo;
		renderVideo?: typeof renderVideoExport;
		renderAudio?: typeof renderAudioExport;
		renderSequence?: typeof renderImageSequenceExport;
	} = $props();

	let open = $state(false);
	let rendering = $state(false);
	let format = $state<NonNullable<RenderExportOptions['format']> | 'mp3' | 'aac' | 'wav' | 'png-sequence' | 'jpeg-sequence' | 'webp-sequence'>('webm');
	let quality = $state<NonNullable<RenderExportOptions['quality']>>('standard');
	let codec = $state<VideoCodec>('vp9');
	let codecSupport = $state<Partial<Record<VideoCodec, boolean>>>({});
	let resolution = $state('source');
	let useRange = $state(false);
	let subtitleMode = $state<NonNullable<RenderExportOptions['subtitleMode']>>('burn');
	let sequenceDestination = $state<'directory' | 'zip'>(getDirectoryPickerAvailable() ? 'directory' : 'zip');
	let progress = $state<RenderExportProgress | null>(null);
	let startedAt = $state<number | undefined>();
	let controller: AbortController | null = null;
	let codecProbeVersion = 0;
	let destroyed = false;
	const isAudioFormat = $derived(format === 'mp3' || format === 'aac' || format === 'wav');
	const isSequenceFormat = $derived(format === 'png-sequence' || format === 'jpeg-sequence' || format === 'webp-sequence');
	let webpSupported = $state<boolean | undefined>(undefined);
	const videoFormat = $derived(!isAudioFormat && !isSequenceFormat ? (format as NonNullable<RenderExportOptions['format']>) : null);
	const codecs = $derived(videoFormat ? supportedExportVideoCodecs(videoFormat) : []);
	const formatOptions = $derived([
		{ value: 'mp4', label: 'MP4' },
		{ value: 'mov', label: 'MOV' },
		{ value: 'webm', label: 'WebM' },
		{ value: 'mkv', label: 'MKV' },
		{ value: 'png-sequence', label: m.video_editor_export_format_png_sequence() },
		{ value: 'jpeg-sequence', label: m.video_editor_export_format_jpeg_sequence() },
		{ value: 'webp-sequence', label: m.video_editor_export_format_webp_sequence() },
		{ value: 'mp3', label: `${m.video_editor_export_audio_only()}: MP3` },
		{ value: 'aac', label: `${m.video_editor_export_audio_only()}: AAC` },
		{ value: 'wav', label: `${m.video_editor_export_audio_only()}: WAV` }
	]);
	const qualityOptions = $derived([
		{ value: 'draft', label: m.video_editor_export_quality_draft() },
		{ value: 'standard', label: m.video_editor_export_quality_standard() },
		{ value: 'high', label: m.video_editor_export_quality_high() }
	]);
	$effect(() => {
		void format;
		if (format === 'webp-sequence' && webpSupported === undefined) {
			void canEncodeWebP().then((supported) => {
				if (!destroyed) webpSupported = supported;
			});
		}
	});
	const resolutionOptions = $derived([
		{ value: 'source', label: `${project?.metadata.width} × ${project?.metadata.height}` },
		{ value: '1920x1080', label: '1920 × 1080' },
		{ value: '1280x720', label: '1280 × 720' },
		{ value: '854x480', label: '854 × 480' }
	]);
	const subtitleOptions = $derived([
		{ value: 'none', label: m.video_editor_export_subtitles_none() },
		{ value: 'burn', label: m.video_editor_export_subtitles_burn() },
		{ value: 'sidecar', label: m.video_editor_export_subtitles_sidecar() },
		{ value: 'embedded', label: m.video_editor_export_subtitles_embedded() }
	]);
	const sequenceDestinationOptions = $derived([
		{ value: 'directory', label: m.video_editor_export_sequence_destination_directory() },
		{ value: 'zip', label: m.video_editor_export_sequence_destination_zip() }
	]);
	function jpegQualityFor(quality: string): number {
		switch (quality) {
			case 'draft': return 0.7;
			case 'high': return 0.98;
			default: return 0.92;
		}
	}
	const outputDimensions = $derived.by(() => {
		if (!project) return { width: 1920, height: 1080 };
		const [width, height] =
			resolution === 'source'
				? [project.metadata.width, project.metadata.height]
				: resolution.split('x').map(Number);
		return { width: width ?? project.metadata.width, height: height ?? project.metadata.height };
	});
	const selectedRange = $derived(
		useRange && timelineStore.inPoint !== null && timelineStore.outPoint !== null
			? { startFrame: timelineStore.inPoint, endFrame: timelineStore.outPoint }
			: undefined
	);
	const mediaStatuses = $derived.by(() =>
		Object.fromEntries(mediaPool.order.map((id) => [id, mediaPool.entry(id)?.status]))
	);
	const preflight = $derived.by(() =>
		assessExportPreflight({
			settings: {
				format: format as 'webm' | 'mp4' | 'mov' | 'mkv' | 'mp3' | 'aac' | 'wav' | 'png-sequence' | 'jpeg-sequence' | 'webp-sequence',
				codec: videoFormat ? codec : undefined,
				quality,
				width: outputDimensions.width,
				height: outputDimensions.height,
				subtitleMode,
				range: selectedRange,
				jpegQuality:
					isSequenceFormat && (format === 'jpeg-sequence' || format === 'webp-sequence')
						? jpegQualityFor(quality)
						: undefined
			},
			fps: timelineStore.fps,
			projectWidth: project?.metadata.width,
			projectHeight: project?.metadata.height,
			items: timelineStore.items,
			tracks: timelineStore.tracks,
			transitions: transitionsStore.list,
			codecSupported: videoFormat ? codecSupport[codec] : true,
			webpSupported,
			mediaStatuses,
			media: mediaPool.mediaList,
			workerAvailable: typeof Worker !== 'undefined'
		})
	);
	const canOpenQueueMenu = $derived(
		!preflight.pending &&
			(preflight.canExport ||
				preflight.checks
					.filter((check) => check.severity === 'error')
					.every((check) => check.id === 'output-too-large'))
	);
	const visiblePreflightChecks = $derived(
		preflight.checks.filter((check) => check.severity !== 'ok').slice(0, 4)
	);
	const sequenceFilePattern = $derived.by(() => {
		if (!project) return '';
		const base = sanitizeSequenceBaseName(project.name);
		const total = Math.max(1, preflight.range.frameCount);
		const ext = format === 'png-sequence' ? 'png' : format === 'webp-sequence' ? 'webp' : 'jpg';
		return `${base}_${'0'.repeat(Math.max(5, String(total).length) - 1)}1.${ext}`;
	});

	$effect(() => {
		const selectedFormat = videoFormat;
		const selectedResolution = resolution;
		if (!selectedFormat || !project) return;
		const probeVersion = ++codecProbeVersion;
		codecSupport = {};
		const [width, height] =
			selectedResolution === 'source'
				? [project.metadata.width, project.metadata.height]
				: selectedResolution.split('x').map(Number);
		const availableCodecs = supportedExportVideoCodecs(selectedFormat);
		if (!availableCodecs.includes(codec)) codec = defaultVideoCodec(selectedFormat);
		const requestFormat = selectedFormat;
		void Promise.all(
			availableCodecs.map(
				async (candidate) => [candidate, await probeCodec(candidate, { width, height })] as const
			)
		).then((results) => {
			if (destroyed || probeVersion !== codecProbeVersion || videoFormat !== requestFormat) return;
			codecSupport = Object.fromEntries(results);
			if (codecSupport[codec] === false) {
				const fallback = results.find(([, supported]) => supported)?.[0];
				if (fallback) codec = fallback;
			}
		});
	});

	function formatBytes(bytes: number): string {
		if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
		return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	}

	function preflightMessage(check: ExportPreflightCheck): string {
		switch (check.id) {
			case 'empty-range':
				return m.video_editor_preflight_empty_range();
			case 'no-renderable-content':
				return m.video_editor_preflight_no_content();
			case 'no-audible-content':
				return m.video_editor_preflight_no_audio();
			case 'missing-media':
				return m.video_editor_preflight_missing_media({ count: check.count ?? 0 });
			case 'video-codec-checking':
				return m.video_editor_preflight_codec_checking();
			case 'video-codec-unavailable':
				return m.video_editor_preflight_codec_unavailable({ codec: codec.toUpperCase() });
			case 'image-encode-checking':
				return m.video_editor_preflight_image_encode_checking();
			case 'image-encode-unavailable':
				return m.video_editor_preflight_image_encode_unavailable();
			case 'subtitle-burn-fallback':
				return m.video_editor_preflight_subtitle_fallback({ format: format.toUpperCase() });
			case 'smart-copy':
				return m.video_editor_preflight_smart_copy();
			case 'long-render':
				return m.video_editor_preflight_long_render({ minutes: check.minutes ?? 0 });
			case 'output-too-large':
				return m.video_editor_preflight_too_large({
					size: formatBytes(check.sizeBytes ?? 0)
				});
			default:
				return '';
		}
	}

	function setFormat(value: string): void {
		switch (value) {
			case 'mp4':
			case 'mov':
			case 'webm':
			case 'mkv':
			case 'png-sequence':
			case 'jpeg-sequence':
			case 'webp-sequence':
			case 'mp3':
			case 'aac':
			case 'wav':
				format = value as typeof format;
		}
	}

	function setQuality(value: string): void {
		if (value === 'draft' || value === 'standard' || value === 'high') quality = value;
	}

	function setSubtitleMode(value: string): void {
		if (value === 'none' || value === 'burn' || value === 'sidecar' || value === 'embedded') {
			subtitleMode = value;
		}
	}

	function setCodec(value: string): void {
		const next = codecs.find((candidate) => candidate === value);
		if (next) codec = next;
	}

	function queueSettings() {
		return {
			format,
			codec: videoFormat ? codec : undefined,
			quality,
			width: outputDimensions.width,
			height: outputDimensions.height,
			subtitleMode,
			jpegQuality:
				isSequenceFormat && (format === 'jpeg-sequence' || format === 'webp-sequence')
					? jpegQualityFor(quality)
					: undefined
		};
	}

	function enqueueCurrent(): void {
		if (!project || !preflight.canExport) return;
		const snapshot = captureSnapshot();
		renderQueueStore.enqueue([
			buildRenderQueueJob({
				project,
				settings: queueSettings(),
				preflight,
				tracks: snapshot.tracks,
				items: snapshot.items,
				transitions: snapshot.transitions,
				compositions: snapshot.sequenceRegistry.compositions,
				masterVolumeDb: snapshot.masterVolumeDb,
				masterMuted: snapshot.masterMuted
			})
		]);
		open = false;
	}

	function enqueueSegments(
		ranges: readonly RenderQueueRange[],
		snapshot: ReturnType<typeof captureSnapshot>
	): void {
		if (!project || ranges.length === 0) return;
		const settings = queueSettings();
		const segmentPreflights = ranges.map((range) =>
			assessExportPreflight({
				settings: { ...settings, range },
				fps: timelineStore.fps,
				projectWidth: project?.metadata.width,
				projectHeight: project?.metadata.height,
				items: snapshot.items,
				tracks: snapshot.tracks,
				transitions: snapshot.transitions,
				codecSupported: videoFormat ? codecSupport[codec] : true,
				webpSupported,
				mediaStatuses,
				media: mediaPool.mediaList,
				workerAvailable: typeof Worker !== 'undefined'
			})
		);
		const blocked = segmentPreflights.find((result) => !result.canExport);
		if (blocked) {
			const check = blocked.checks.find((candidate) => candidate.severity === 'error');
			onerror(
				new Error((check && preflightMessage(check)) || m.video_editor_queue_segment_blocked())
			);
			return;
		}
		renderQueueStore.enqueue(
			buildSegmentRenderQueueJobs({
				project,
				settings,
				preflight: segmentPreflights[0]!,
				tracks: snapshot.tracks,
				items: snapshot.items,
				transitions: snapshot.transitions,
				compositions: snapshot.sequenceRegistry.compositions,
				masterVolumeDb: snapshot.masterVolumeDb,
				masterMuted: snapshot.masterMuted,
				ranges,
				name: (index) => `${project.name} - ${m.video_editor_queue_part({ number: index + 1 })}`
			})
		);
		open = false;
	}

	function enqueueMarkerSegments(): void {
		const snapshot = captureSnapshot();
		const ranges = rangesFromMarkers(
			snapshot.markers,
			preflight.range.startFrame,
			preflight.range.endFrame
		);
		if (ranges.length <= 1) {
			onerror(new Error(m.video_editor_queue_no_markers()));
			return;
		}
		enqueueSegments(ranges, snapshot);
	}

	function enqueueFixedSegments(seconds: number): void {
		const snapshot = captureSnapshot();
		enqueueSegments(
			rangesFromFixedDuration(
				preflight.range.startFrame,
				preflight.range.endFrame,
				Math.max(1, Math.round(seconds * timelineStore.fps))
			),
			snapshot
		);
	}

	async function start(): Promise<void> {
		if (!project || rendering || !preflight.canExport) return;
		rendering = true;
		const totalFrames = Math.max(0, preflight.range.endFrame - preflight.range.startFrame);
		progress = { phase: 'preparing', framesDone: 0, totalFrames, progress: 0 };
		startedAt = Date.now();
		const abortController = new AbortController();
		controller = abortController;
		const { width, height } = outputDimensions;
		try {
			const snapshot = captureSnapshot();
			const renderProject: Project = {
				...project,
				metadata: { ...project.metadata, fps: snapshot.fps },
				timeline: {
					...project.timeline,
					tracks: snapshot.tracks,
					items: snapshot.items,
					transitions: snapshot.transitions,
					markers: snapshot.markers,
					inPoint: snapshot.inPoint ?? undefined,
					outPoint: snapshot.outPoint ?? undefined,
					currentFrame: snapshot.currentFrame,
					scrollPosition: snapshot.scrollPosition,
					compositions: snapshot.sequenceRegistry.compositions,
					masterVolumeDb: snapshot.masterVolumeDb,
					masterMuted: snapshot.masterMuted
				}
			};
			const range = {
				startFrame: preflight.range.startFrame,
				endFrame: preflight.range.endFrame
			};
			if (isSequenceFormat) {
				const seqFormat = format === 'png-sequence' ? 'png' : format === 'webp-sequence' ? 'webp' : 'jpeg';
				let destination: 'zip' | FileSystemDirectoryHandle | undefined;
				if (sequenceDestination === 'directory') {
					if (getDirectoryPickerAvailable()) {
						try {
							const handle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
							destination = handle;
						} catch (error) {
							if (error instanceof DOMException && error.name === 'AbortError') {
								rendering = false;
								progress = null;
								startedAt = undefined;
								controller = null;
								return;
							}
							destination = 'zip';
						}
					} else {
						destination = 'zip';
					}
				} else {
					destination = 'zip';
				}
				const { result } = await renderSequence(
					{
						project: renderProject,
						options: { format: seqFormat, width, height, range, jpegQuality: jpegQualityFor(quality) },
						destination,
						signal: abortController.signal,
						onProgress: (value) => (progress = value)
					}
				);
				let relPath = '';
				let blob: Blob | undefined;
				let fileName = '';
				if (result.kind === 'workspace-directory') {
					relPath = result.relPath;
					fileName = result.directoryName;
					blob = new Blob([], { type: 'application/octet-stream' });
				} else if (result.kind === 'zip') {
					relPath = result.relPath;
					fileName = result.fileName;
					blob = result.blob;
				} else {
					relPath = `directory:${result.directoryName}`;
					fileName = result.directoryName;
					blob = new Blob([], { type: 'application/octet-stream' });
				}
				ondone({ relPath, blob: blob!, fileName } as RenderExportResult);
				open = false;
				return;
			}
			const result =
				isAudioFormat
					? await renderAudio(renderProject, {
							format: format as 'mp3' | 'aac' | 'wav',
							range,
							signal: abortController.signal,
							onProgress: (value) => (progress = value)
						})
					: await renderVideo(renderProject, {
							format: format as 'webm' | 'mp4' | 'mov' | 'mkv',
							codec,
							quality,
							width,
							height,
							subtitleMode,
							range,
							signal: abortController.signal,
							onProgress: (value) => (progress = value)
						});
			ondone(result);
			open = false;
		} catch (cause) {
			if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
				onerror(cause instanceof Error ? cause : new Error(String(cause)));
			}
		} finally {
			rendering = false;
			progress = null;
			startedAt = undefined;
			controller = null;
		}
	}

	function cancelOrClose(): void {
		if (!rendering) {
			open = false;
			return;
		}
		controller?.abort();
	}

	onDestroy(() => {
		destroyed = true;
		codecProbeVersion += 1;
		controller?.abort();
	});
</script>

<Button size="sm" variant="secondary" class="w-full" {disabled} onclick={() => (open = true)}>
	{m.video_editor_export_render()}
</Button>
{#if project}
	<RenderQueuePanel projectId={project.id} />
{/if}

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme !block max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] overflow-y-auto rounded-xl border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-4 text-[var(--video-editor-text)] shadow-2xl sm:max-w-md"
		overlayProps={{ class: 'bg-black/70' }}
		showCloseButton={!rendering}
		onInteractOutside={(event) => {
			if (rendering) event.preventDefault();
		}}
		onEscapeKeydown={(event) => {
			if (rendering) event.preventDefault();
		}}
	>
		<Dialog.Title id="export-title" class="text-base font-semibold"
			>{m.video_editor_export_title()}</Dialog.Title
		>
		<div class="mt-4 grid grid-cols-2 gap-3">
			<label class="text-xs text-[oklch(0.7_0.01_55)]">
				{m.video_editor_export_format()}<AppSelect
					class="mt-1 h-9 w-full text-sm"
					value={format}
					options={formatOptions}
					disabled={rendering}
					onValueChange={setFormat}
				/>
			</label>
			{#if videoFormat}
				<label class="text-xs text-[oklch(0.7_0.01_55)]"
					>{m.video_editor_export_codec()}<AppSelect
						class="mt-1 h-9 w-full text-sm"
						value={codec}
						disabled={rendering}
						options={codecs.map((candidate) => ({
							value: candidate,
							label: `${candidate.toUpperCase()}${codecSupport[candidate] === false ? ` ${m.video_editor_export_codec_unavailable()}` : ''}`,
							disabled: codecSupport[candidate] === false
						}))}
						onValueChange={setCodec}
					/>
				</label>
			{/if}
			<label class="text-xs text-[oklch(0.7_0.01_55)]">
				{#if isSequenceFormat && (format === 'jpeg-sequence' || format === 'webp-sequence')}
					{m.video_editor_export_jpeg_quality()}
				{:else}
					{m.video_editor_export_quality()}
				{/if}
				<AppSelect
					class="mt-1 h-9 w-full text-sm"
					value={quality}
					options={qualityOptions}
					disabled={rendering}
					onValueChange={setQuality}
				/>
			</label>
			<label class="text-xs text-[oklch(0.7_0.01_55)]">
				{m.video_editor_export_resolution()}<AppSelect
					class="mt-1 h-9 w-full text-sm"
					bind:value={resolution}
					options={resolutionOptions}
					disabled={rendering}
				/>
			</label>
			{#if !isSequenceFormat}
				<label class="text-xs text-[oklch(0.7_0.01_55)]">
					{m.video_editor_export_subtitles()}<AppSelect
						class="mt-1 h-9 w-full text-sm"
						value={subtitleMode}
						options={subtitleOptions}
						disabled={rendering}
						onValueChange={setSubtitleMode}
					/>
				</label>
			{/if}
			{#if isSequenceFormat}
				<label class="text-xs text-[oklch(0.7_0.01_55)]">
					{m.video_editor_export_sequence_destination()}<AppSelect
						class="mt-1 h-9 w-full text-sm"
						value={sequenceDestination}
						options={sequenceDestinationOptions}
						disabled={rendering}
						onValueChange={(v) => { if (v === 'directory' || v === 'zip') sequenceDestination = v; }}
					/>
				</label>
			{/if}
		</div>
		{#if isSequenceFormat}
			<p class="mt-2 text-[11px] text-[var(--video-editor-muted)]" aria-live="polite">
				{m.video_editor_export_sequence_alpha_hint()}
			</p>
			<p class="mt-1 text-[11px] text-[var(--video-editor-muted)]">
				{m.video_editor_export_sequence_file_pattern({ pattern: sequenceFilePattern })}
			</p>
			{#if sequenceDestination === 'directory' && !getDirectoryPickerAvailable()}
				<p class="mt-1 text-[11px] text-amber-200">{m.video_editor_export_sequence_directory_unavailable()}</p>
			{/if}
			{#if sequenceDestination === 'zip'}
				<p class="mt-1 text-[11px] text-[var(--video-editor-muted)]">{m.video_editor_export_sequence_zip_hint()}</p>
			{:else}
				<p class="mt-1 text-[11px] text-[var(--video-editor-muted)]">{m.video_editor_export_sequence_directory_hint()}</p>
			{/if}
		{/if}
		<label class="mt-3 flex min-h-11 items-center gap-2 text-sm">
			<Checkbox
				bind:checked={useRange}
				disabled={rendering || timelineStore.inPoint === null || timelineStore.outPoint === null}
			/>{m.video_editor_export_range()}
		</label>
		<div
			class="mt-3 rounded-lg border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] p-3"
			aria-live="polite"
		>
			<div class="flex items-start gap-2">
				{#if preflight.pending}
					<LoaderIcon
						class="mt-0.5 size-4 shrink-0 animate-spin text-[var(--video-editor-muted)] motion-reduce:animate-none"
						aria-hidden="true"
					/>
				{:else if summarizePreflightSeverity(preflight.checks) === 'error'}
					<XCircleIcon class="mt-0.5 size-4 shrink-0 text-red-300" aria-hidden="true" />
				{:else if summarizePreflightSeverity(preflight.checks) === 'warning'}
					<AlertTriangleIcon class="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
				{:else}
					<CheckCircleIcon class="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
				{/if}
				<div class="min-w-0 flex-1">
					<p class="text-xs font-medium">
						{preflight.pending
							? m.video_editor_preflight_checking()
							: preflight.canExport
								? m.video_editor_preflight_ready()
								: m.video_editor_preflight_blocked()}
					</p>
					<p class="mt-0.5 text-[11px] text-[var(--video-editor-muted)] tabular-nums">
						{m.video_editor_preflight_estimate({
							duration: preflight.estimatedDurationSeconds.toFixed(1),
							size: formatBytes(preflight.estimatedFileSizeBytes),
							path:
								preflight.predictedRenderPath === 'smart-copy'
									? m.video_editor_preflight_path_smart_copy()
									: preflight.predictedRenderPath === 'worker'
										? m.video_editor_preflight_path_worker()
										: m.video_editor_preflight_path_main_thread()
						})}
					</p>
				</div>
			</div>
			{#if visiblePreflightChecks.length > 0}
				<ul class="mt-2 space-y-1 border-t border-[var(--video-editor-border)] pt-2">
					{#each visiblePreflightChecks as check (check.id)}
						<li
							class={[
								'text-[11px]',
								check.severity === 'error'
									? 'text-red-200'
									: check.severity === 'warning'
										? 'text-amber-200'
										: 'text-[var(--video-editor-muted)]'
							]}
						>
							{preflightMessage(check)}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		{#if progress}
			<RenderProgress {progress} {startedAt} class="mt-3" />
		{/if}
		<div class="mt-4 flex justify-end gap-2">
			{#if rendering}
				<Button variant="outline" class="w-full sm:w-auto" onclick={cancelOrClose}
					>{m.video_editor_export_cancel()}</Button
				>
			{:else}
				<Button variant="ghost" onclick={cancelOrClose}>{m.video_editor_export_cancel()}</Button>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" disabled={!canOpenQueueMenu}>
								<ListPlusIcon aria-hidden="true" />
								{m.video_editor_queue_add()}
								<ChevronDownIcon aria-hidden="true" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="video-editor-theme min-w-52">
						<DropdownMenu.Item disabled={!preflight.canExport} onclick={enqueueCurrent}>
							{m.video_editor_queue_add_current()}
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Label>{m.video_editor_queue_segments()}</DropdownMenu.Label>
						<DropdownMenu.Item onclick={enqueueMarkerSegments}>
							{m.video_editor_queue_per_marker()}
						</DropdownMenu.Item>
						{#each [10, 30, 60] as seconds (seconds)}
							<DropdownMenu.Item onclick={() => enqueueFixedSegments(seconds)}>
								{m.video_editor_queue_fixed_seconds({ seconds })}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<Button disabled={!preflight.canExport} onclick={start}
					>{m.video_editor_export_start_now()}</Button
				>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
