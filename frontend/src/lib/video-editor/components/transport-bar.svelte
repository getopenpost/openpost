<!-- Transport: play/pause, frame stepping, in/out, timecode -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Popover from '$lib/components/ui/popover';
	import { Slider } from '$lib/components/ui/slider';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { outputDurationFrames } from '$lib/video-editor/media/render-plan';
	import { renderTimelineFrame } from '$lib/video-editor/media/render-export';
	import { importGeneratedImage } from '$lib/video-editor/media/import.svelte';
	import {
		buildFrameFileName,
		PREVIEW_ZOOM_PRESETS,
		zoomPreview
	} from '$lib/video-editor/preview/playback-settings';
	import { previewPlaybackSettings } from '$lib/video-editor/preview/playback-settings.svelte';
	import { adaptivePreviewQuality } from '$lib/video-editor/preview/adaptive-preview-quality.svelte';
	import { toast } from 'svelte-sonner';
	import TimelineVoiceoverControl from './timeline-voiceover-control.svelte';
	import {
		setCurrentFrame,
		setInPoint,
		setOutPoint
	} from '$lib/video-editor/timeline/actions/items';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import CheckIcon from '@lucide/svelte/icons/check';
	import GaugeIcon from '@lucide/svelte/icons/gauge';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import MaximizeIcon from '@lucide/svelte/icons/maximize';
	import MinimizeIcon from '@lucide/svelte/icons/minimize';
	import SkipBackIcon from '@lucide/svelte/icons/skip-back';
	import SquareIcon from '@lucide/svelte/icons/square';
	import Volume1Icon from '@lucide/svelte/icons/volume-1';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';
	import ZoomInIcon from '@lucide/svelte/icons/zoom-in';
	import ZoomOutIcon from '@lucide/svelte/icons/zoom-out';

	let {
		projectId,
		onvoiceoverinserted = () => {}
	}: { projectId: string; onvoiceoverinserted?: (itemId: string) => void } = $props();

	const playing = $derived(editorSession.isPlaying);
	const fps = $derived(editorSession.fps);
	const totalFrames = $derived(outputDurationFrames(timelineStore.items));
	const monitorPercent = $derived(Math.round(previewPlaybackSettings.volume * 100));
	const zoomLabel = $derived(
		previewPlaybackSettings.zoom === -1
			? m.video_editor_preview_zoom_fit()
			: `${Math.round(previewPlaybackSettings.zoom * 100)}%`
	);
	const adaptiveQualityPercent = $derived(Math.round(adaptivePreviewQuality.scale * 100));
	const qualityLabel = $derived(
		previewPlaybackSettings.previewQuality === 'auto'
			? `${m.video_editor_quality_auto()}${adaptiveQualityPercent < 100 ? ` ${adaptiveQualityPercent}%` : ''}`
			: m.video_editor_quality_full()
	);
	let fullscreen = $state(false);
	let savingFrame = $state(false);

	const timecode = $derived.by(() => {
		const total = timelineStore.currentFrame / fps;
		const minutes = Math.floor(total / 60);
		const seconds = Math.floor(total % 60);
		const frames = Math.round((total % 1) * fps);
		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
	});

	function previewElement(): HTMLElement | null {
		return document.querySelector<HTMLElement>('[data-video-preview]');
	}

	async function toggleFullscreen(): Promise<void> {
		const preview = previewElement();
		if (!preview) return;
		try {
			if (document.fullscreenElement === preview) await document.exitFullscreen();
			else await preview.requestFullscreen();
		} catch {
			toast.error(m.video_editor_fullscreen_failed());
		}
	}

	function downloadBlob(blob: Blob, fileName: string): void {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	async function saveCurrentFrame(): Promise<void> {
		if (savingFrame || !editorSession.project) return;
		savingFrame = true;
		try {
			const project = editorSession.project;
			const frame = timelineStore.currentFrame;
			const fileName = buildFrameFileName(frame, fps, totalFrames);
			const blob = await renderTimelineFrame(
				{
					...project,
					timeline: {
						...project.timeline,
						items: $state.snapshot(timelineStore.items),
						tracks: timelineStore.tracks,
						transitions: [...transitionsStore.list]
					}
				},
				frame
			);
			downloadBlob(blob, fileName);
			try {
				await importGeneratedImage(new File([blob], fileName, { type: 'image/png' }), {
					projectId: project.id,
					width: project.metadata.width,
					height: project.metadata.height,
					tags: ['frame-capture']
				});
			} catch (error) {
				toast.error(
					m.video_editor_frame_downloaded_not_saved({
						message: error instanceof Error ? error.message : String(error)
					})
				);
				return;
			}
			toast.success(m.video_editor_frame_saved({ name: fileName }));
		} catch (error) {
			toast.error(
				m.video_editor_frame_save_failed({
					message: error instanceof Error ? error.message : String(error)
				})
			);
		} finally {
			savingFrame = false;
		}
	}

	onMount(() => {
		const syncFullscreen = () => {
			fullscreen = document.fullscreenElement === previewElement();
		};
		document.addEventListener('fullscreenchange', syncFullscreen);
		return () => document.removeEventListener('fullscreenchange', syncFullscreen);
	});
</script>

<div
	class="flex min-h-10 items-center gap-1 border-t border-[oklch(0.25_0.015_55)] px-2 py-1.5 sm:gap-2 sm:px-3"
>
	<div class="flex shrink-0 items-center gap-1">
		<Button
			class="hidden sm:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={timelineStore.seekLocked}
			aria-label={m.video_editor_go_to_start()}
			onclick={() => setCurrentFrame(0)}
		>
			<SkipBackIcon />
		</Button>
		<Button
			class="hidden sm:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={timelineStore.seekLocked}
			aria-label={m.video_editor_step_back()}
			onclick={() => setCurrentFrame(timelineStore.currentFrame - 1)}
		>
			<ChevronLeftIcon />
		</Button>
		<Button
			size="icon-xs"
			aria-label={playing ? m.video_editor_pause() : m.video_editor_play()}
			onclick={() =>
				playing
					? editorSession.pausePlayback()
					: editorSession.startPlayback({
							start: timelineStore.inPoint ?? 0,
							end: timelineStore.outPoint ?? Math.max(timelineStore.maxItemEndFrame, 1),
							loop: true
						})}
		>
			{#if playing}<PauseIcon />{:else}<PlayIcon />{/if}
		</Button>
		<Button
			class="hidden sm:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={timelineStore.seekLocked}
			aria-label={m.video_editor_stop()}
			onclick={() => editorSession.stopPlayback()}
		>
			<SquareIcon />
		</Button>
		<Button
			class="hidden sm:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={timelineStore.seekLocked}
			aria-label={m.video_editor_step_forward()}
			onclick={() => setCurrentFrame(timelineStore.currentFrame + 1)}
		>
			<ChevronRightIcon />
		</Button>
		<TimelineVoiceoverControl {projectId} oninserted={onvoiceoverinserted} />

		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						size="icon-xs"
						variant="ghost"
						aria-label={m.video_editor_monitor_volume()}
						title={previewPlaybackSettings.muted
							? m.video_editor_monitor_muted()
							: m.video_editor_monitor_percent({ percent: monitorPercent })}
					>
						{#if previewPlaybackSettings.muted || previewPlaybackSettings.volume === 0}
							<VolumeXIcon />
						{:else if previewPlaybackSettings.volume < 0.5}
							<Volume1Icon />
						{:else}
							<Volume2Icon />
						{/if}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content side="top" class="video-editor-theme w-56 space-y-3 p-3">
				<div class="flex items-center justify-between gap-3">
					<span class="text-xs font-medium">{m.video_editor_monitor_title()}</span>
					<span class="text-[10px] tracking-wide text-muted-foreground uppercase">
						{m.video_editor_monitor_device_only()}
					</span>
				</div>
				<div class="flex items-center gap-2">
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={previewPlaybackSettings.muted
							? m.video_editor_monitor_unmute()
							: m.video_editor_monitor_mute()}
						onclick={() => previewPlaybackSettings.toggleMute()}
					>
						{#if previewPlaybackSettings.muted}<VolumeXIcon />{:else}<Volume2Icon />{/if}
					</Button>
					<Slider
						value={previewPlaybackSettings.muted ? 0 : previewPlaybackSettings.volume}
						min={0}
						max={1}
						step={0.01}
						ariaLabel={m.video_editor_monitor_volume()}
						onValueChange={(value) => previewPlaybackSettings.setVolume(value)}
					/>
					<span class="w-9 text-right text-xs text-muted-foreground tabular-nums">
						{previewPlaybackSettings.muted
							? m.video_editor_monitor_mute_short()
							: `${monitorPercent}%`}
					</span>
				</div>
				<p class="text-[10px] leading-snug text-muted-foreground">
					{m.video_editor_monitor_preview_only_note()}
				</p>
			</Popover.Content>
		</Popover.Root>
		<Button
			class="hidden sm:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={savingFrame || totalFrames === 0}
			aria-label={savingFrame ? m.video_editor_saving_frame() : m.video_editor_save_frame()}
			title={m.video_editor_save_frame()}
			onclick={() => void saveCurrentFrame()}
		>
			{#if savingFrame}<LoaderIcon
					class="animate-spin motion-reduce:animate-none"
				/>{:else}<CameraIcon />{/if}
		</Button>
	</div>

	<span class="rounded bg-[oklch(0.18_0.008_55)] px-2 py-0.5 font-mono text-xs tabular-nums">
		{timecode} <span class="text-muted-foreground max-[359px]:hidden">/ {totalFrames}</span>
	</span>

	<div class="mx-auto hidden items-center gap-1 @min-[620px]:flex">
		<Button size="xs" variant="outline" onclick={() => setInPoint(timelineStore.currentFrame)}>
			{m.video_editor_mark_in()}
		</Button>
		<Button size="xs" variant="outline" onclick={() => setOutPoint(timelineStore.currentFrame)}>
			{m.video_editor_mark_out()}
		</Button>
		{#if timelineStore.inPoint !== null || timelineStore.outPoint !== null}
			<Button
				size="xs"
				variant="ghost"
				onclick={() => {
					setInPoint(null);
					setOutPoint(null);
				}}
			>
				{m.video_editor_clear_marks()}
			</Button>
		{/if}
	</div>

	<div class="ml-auto flex shrink-0 items-center gap-1">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						size="icon-xs"
						variant="ghost"
						class="max-[359px]:hidden"
						aria-label={m.video_editor_preview_quality()}
						title={`${m.video_editor_preview_quality()}: ${qualityLabel}`}
						data-preview-quality-scale={previewPlaybackSettings.previewQuality === 'auto'
							? adaptivePreviewQuality.scale
							: 1}
					>
						<GaugeIcon />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" side="top" class="video-editor-theme min-w-44">
				<DropdownMenu.Label>{m.video_editor_preview_quality()}</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => previewPlaybackSettings.setPreviewQuality('auto')}>
					<span class="flex-1">{m.video_editor_quality_auto()}</span>
					{#if previewPlaybackSettings.previewQuality === 'auto' && adaptiveQualityPercent < 100}
						<span class="text-[10px] text-muted-foreground tabular-nums"
							>{adaptiveQualityPercent}%</span
						>
					{/if}
					{#if previewPlaybackSettings.previewQuality === 'auto'}<CheckIcon />{/if}
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => previewPlaybackSettings.setPreviewQuality('full')}>
					<span class="flex-1">{m.video_editor_quality_full()}</span>
					{#if previewPlaybackSettings.previewQuality === 'full'}<CheckIcon />{/if}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button
			class="hidden sm:inline-flex"
			size="icon-xs"
			variant="ghost"
			aria-label={m.video_editor_preview_zoom_out()}
			onclick={() =>
				previewPlaybackSettings.setZoom(zoomPreview(previewPlaybackSettings.zoom, 'out'))}
		>
			<ZoomOutIcon />
		</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						size="xs"
						variant="ghost"
						class="min-w-12 px-1.5 tabular-nums max-[479px]:hidden"
						aria-label={m.video_editor_preview_zoom({ zoom: zoomLabel })}
					>
						{zoomLabel}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" side="top" class="video-editor-theme min-w-28">
				{#each PREVIEW_ZOOM_PRESETS as preset (preset)}
					<DropdownMenu.Item onclick={() => previewPlaybackSettings.setZoom(preset)}>
						<span class:font-semibold={previewPlaybackSettings.zoom === preset}>
							{preset === -1 ? m.video_editor_preview_zoom_fit() : `${preset * 100}%`}
						</span>
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button
			class="hidden sm:inline-flex"
			size="icon-xs"
			variant="ghost"
			aria-label={m.video_editor_preview_zoom_in()}
			onclick={() =>
				previewPlaybackSettings.setZoom(zoomPreview(previewPlaybackSettings.zoom, 'in'))}
		>
			<ZoomInIcon />
		</Button>
		<Button
			size="icon-xs"
			variant="ghost"
			aria-label={fullscreen ? m.video_editor_exit_fullscreen() : m.video_editor_enter_fullscreen()}
			onclick={() => void toggleFullscreen()}
		>
			{#if fullscreen}<MinimizeIcon />{:else}<MaximizeIcon />{/if}
		</Button>
	</div>
</div>
