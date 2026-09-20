<!-- Transport: play/pause, frame stepping, in/out, timecode -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Popover from '$lib/components/ui/popover';
	import { Slider } from '$lib/components/ui/slider';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
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
	import { resolvePreviewCaptureFrame } from '$lib/video-editor/preview/capture-frame';
	import { timelinePreviewScrub } from '$lib/video-editor/preview/timeline-preview-scrub';
	import { adaptivePreviewQuality } from '$lib/video-editor/preview/adaptive-preview-quality.svelte';
	import { toast } from 'svelte-sonner';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import { formatShortcutBinding } from '$lib/video-editor/settings/keyboard-shortcuts';
	import TimelineVoiceoverControl from './timeline-voiceover-control.svelte';
	import TimelineVoiceoverMenu from './timeline-voiceover-menu.svelte';
	import { voiceoverRecorder } from '$lib/video-editor/recorder/voiceover-recorder.svelte';
	import {
		setCurrentFrame,
		setInPoint,
		setOutPoint
	} from '$lib/video-editor/timeline/actions/items';

	let {
		projectId,
		onvoiceoverinserted = () => {},
		theaterActive = false,
		ontoggletheater = () => {}
	}: {
		projectId: string;
		onvoiceoverinserted?: (itemId: string) => void;
		theaterActive?: boolean;
		ontoggletheater?: () => void;
	} = $props();

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
	let fullscreenPortalTarget = $state<HTMLElement | null>(null);
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
			const frame = resolvePreviewCaptureFrame({
				currentFrame: timelineStore.currentFrame,
				previewFrame: $timelinePreviewScrub.frame,
				isPlaying: editorSession.isPlaying
			});
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
			const preview = previewElement();
			fullscreen = document.fullscreenElement === preview;
			fullscreenPortalTarget = fullscreen ? preview : null;
		};
		document.addEventListener('fullscreenchange', syncFullscreen);
		return () => document.removeEventListener('fullscreenchange', syncFullscreen);
	});
</script>

<div
	class="flex h-12 shrink-0 flex-nowrap items-center gap-1 overflow-hidden border-t border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] px-2 py-0 text-[var(--video-editor-text)] sm:gap-1.5 sm:px-2 md:h-8 [@media(pointer:coarse)]:h-12"
	data-video-transport
	data-voiceover-active={voiceoverRecorder.sessionOpen}
>
	<div class="flex shrink-0 items-center gap-1">
		<Button
			class="hidden @min-[800px]/program:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={timelineStore.seekLocked}
			aria-label={m.video_editor_go_to_start()}
			onclick={() => setCurrentFrame(0)}
		>
			<ProtectedIcon icon="editor-skip-back" />
		</Button>
		<Button
			class="hidden @min-[800px]/program:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={timelineStore.seekLocked}
			aria-label={m.video_editor_step_back()}
			onclick={() => setCurrentFrame(timelineStore.currentFrame - 1)}
		>
			<ThemeIcon role="chevron-left" />
		</Button>
		<Button
			class="voiceover-secondary"
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
			{#if playing}<ProtectedIcon icon="pause" />{:else}<ProtectedIcon icon="play" />{/if}
		</Button>
		<Button
			class="hidden @min-[800px]/program:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={timelineStore.seekLocked}
			aria-label={m.video_editor_stop()}
			onclick={() => editorSession.stopPlayback()}
		>
			<ProtectedIcon icon="editor-stop" />
		</Button>
		<Button
			class="hidden @min-[800px]/program:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={timelineStore.seekLocked}
			aria-label={m.video_editor_step_forward()}
			onclick={() => setCurrentFrame(timelineStore.currentFrame + 1)}
		>
			<ThemeIcon role="chevron-right" />
		</Button>
		<TimelineVoiceoverControl {projectId} oninserted={onvoiceoverinserted} />

		<div class="voiceover-secondary contents">
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
								<ProtectedIcon icon="editor-volume-muted" />
							{:else if previewPlaybackSettings.volume < 0.5}
								<ProtectedIcon icon="editor-volume-low" />
							{:else}
								<ProtectedIcon icon="editor-volume-high" />
							{/if}
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content side="top" class="video-editor-theme w-56 space-y-2 p-3">
					<div class="flex items-center gap-2">
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label={previewPlaybackSettings.muted
								? m.video_editor_monitor_unmute()
								: m.video_editor_monitor_mute()}
							onclick={() => previewPlaybackSettings.toggleMute()}
						>
							{#if previewPlaybackSettings.muted}<ProtectedIcon
									icon="editor-volume-muted"
								/>{:else}<ProtectedIcon icon="editor-volume-high" />{/if}
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
				</Popover.Content>
			</Popover.Root>
		</div>
		<Button
			class="hidden @min-[800px]/program:inline-flex"
			size="icon-xs"
			variant="ghost"
			disabled={savingFrame || totalFrames === 0}
			aria-label={savingFrame ? m.video_editor_saving_frame() : m.video_editor_save_frame()}
			title={m.video_editor_save_frame()}
			onclick={() => void saveCurrentFrame()}
		>
			{#if savingFrame}<ProtectedIcon
					icon="loading"
					class="animate-spin motion-reduce:animate-none"
				/>{:else}<ThemeIcon role="camera" />{/if}
		</Button>
	</div>

	<span
		class="voiceover-secondary shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap tabular-nums sm:px-2"
		aria-label={`${timecode} / ${totalFrames}`}
	>
		{timecode}
		<span class="text-muted-foreground max-[479px]:hidden">/ {totalFrames}</span>
	</span>

	<div class="mx-auto hidden shrink-0 items-center gap-1 @min-[800px]/program:flex">
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

	<div class="voiceover-secondary ml-auto flex shrink-0 items-center gap-1">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						size="icon-xs"
						variant="ghost"
						class="@min-[800px]/program:hidden"
						aria-label={m.image_editor_more_actions()}
						title={m.image_editor_more_actions()}
					>
						<ThemeIcon role="more-horizontal" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				align="end"
				side="top"
				class="transport-overflow video-editor-theme min-w-48"
			>
				<TimelineVoiceoverMenu {projectId} />
				<DropdownMenu.Item disabled={timelineStore.seekLocked} onclick={() => setCurrentFrame(0)}>
					<ProtectedIcon icon="editor-skip-back" />{m.video_editor_go_to_start()}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					disabled={timelineStore.seekLocked}
					onclick={() => setCurrentFrame(timelineStore.currentFrame - 1)}
				>
					<ThemeIcon role="chevron-left" />{m.video_editor_step_back()}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					disabled={timelineStore.seekLocked}
					onclick={() => editorSession.stopPlayback()}
				>
					<ProtectedIcon icon="editor-stop" />{m.video_editor_stop()}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					disabled={timelineStore.seekLocked}
					onclick={() => setCurrentFrame(timelineStore.currentFrame + 1)}
				>
					<ThemeIcon role="chevron-right" />{m.video_editor_step_forward()}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => setInPoint(timelineStore.currentFrame)}>
					{m.video_editor_mark_in()}
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => setOutPoint(timelineStore.currentFrame)}>
					{m.video_editor_mark_out()}
				</DropdownMenu.Item>
				{#if timelineStore.inPoint !== null || timelineStore.outPoint !== null}
					<DropdownMenu.Item
						onclick={() => {
							setInPoint(null);
							setOutPoint(null);
						}}
					>
						{m.video_editor_clear_marks()}
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => previewPlaybackSettings.setZoom(-1)}>
					{m.video_editor_preview_zoom_fit()}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					onclick={() =>
						previewPlaybackSettings.setZoom(zoomPreview(previewPlaybackSettings.zoom, 'out'))}
				>
					<ProtectedIcon icon="editor-zoom-out" />{m.video_editor_preview_zoom_out()}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					onclick={() =>
						previewPlaybackSettings.setZoom(zoomPreview(previewPlaybackSettings.zoom, 'in'))}
				>
					<ProtectedIcon icon="editor-zoom-in" />{m.video_editor_preview_zoom_in()}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => previewPlaybackSettings.setPreviewQuality('auto')}>
					{m.video_editor_preview_quality()}: {m.video_editor_quality_auto()}
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => previewPlaybackSettings.setPreviewQuality('full')}>
					{m.video_editor_preview_quality()}: {m.video_editor_quality_full()}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					disabled={savingFrame || totalFrames === 0}
					onclick={() => void saveCurrentFrame()}
				>
					<ThemeIcon role="camera" />{m.video_editor_save_frame()}
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={ontoggletheater}>
					{#if theaterActive}<ThemeIcon role="eye-off" />{:else}<ThemeIcon role="eye" />{/if}
					{theaterActive ? m.video_editor_exit_theater_mode() : m.video_editor_enter_theater_mode()}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
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
						<ProtectedIcon icon="editor-speed" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				align="end"
				side="top"
				class="video-editor-theme min-w-44"
				portalProps={fullscreenPortalTarget ? { to: fullscreenPortalTarget } : undefined}
			>
				<DropdownMenu.Item onclick={() => previewPlaybackSettings.setPreviewQuality('auto')}>
					<span class="flex-1">{m.video_editor_quality_auto()}</span>
					{#if previewPlaybackSettings.previewQuality === 'auto' && adaptiveQualityPercent < 100}
						<span class="text-[10px] text-muted-foreground tabular-nums"
							>{adaptiveQualityPercent}%</span
						>
					{/if}
					{#if previewPlaybackSettings.previewQuality === 'auto'}<ThemeIcon role="check" />{/if}
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => previewPlaybackSettings.setPreviewQuality('full')}>
					<span class="flex-1">{m.video_editor_quality_full()}</span>
					{#if previewPlaybackSettings.previewQuality === 'full'}<ThemeIcon role="check" />{/if}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button
			class="hidden @min-[800px]/program:inline-flex"
			size="icon-xs"
			variant="ghost"
			aria-label={m.video_editor_preview_zoom_out()}
			onclick={() =>
				previewPlaybackSettings.setZoom(zoomPreview(previewPlaybackSettings.zoom, 'out'))}
		>
			<ProtectedIcon icon="editor-zoom-out" />
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
			<DropdownMenu.Content
				align="end"
				side="top"
				class="video-editor-theme min-w-28"
				portalProps={fullscreenPortalTarget ? { to: fullscreenPortalTarget } : undefined}
			>
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
			class="hidden @min-[800px]/program:inline-flex"
			size="icon-xs"
			variant="ghost"
			aria-label={m.video_editor_preview_zoom_in()}
			onclick={() =>
				previewPlaybackSettings.setZoom(zoomPreview(previewPlaybackSettings.zoom, 'in'))}
		>
			<ProtectedIcon icon="editor-zoom-in" />
		</Button>
		<Button
			size="icon-xs"
			variant="ghost"
			aria-label={fullscreen ? m.video_editor_exit_fullscreen() : m.video_editor_enter_fullscreen()}
			onclick={() => void toggleFullscreen()}
		>
			{#if fullscreen}<ProtectedIcon icon="editor-exit-fullscreen" />{:else}<ProtectedIcon
					icon="editor-fullscreen"
				/>{/if}
		</Button>
		<Button
			size="icon-xs"
			variant={theaterActive ? 'secondary' : 'ghost'}
			class="hidden @min-[800px]/program:inline-flex"
			aria-label={theaterActive
				? m.video_editor_exit_theater_mode()
				: m.video_editor_enter_theater_mode()}
			title={`${theaterActive ? m.video_editor_exit_theater_mode() : m.video_editor_enter_theater_mode()} (${formatShortcutBinding(keyboardShortcuts.bindings.TOGGLE_THEATER_MODE)})`}
			aria-pressed={theaterActive}
			data-layout-toggle="theater"
			onclick={ontoggletheater}
		>
			{#if theaterActive}<ThemeIcon role="eye-off" />{:else}<ThemeIcon role="eye" />{/if}
		</Button>
	</div>
</div>

<style>
	@container program (max-width: 799px) {
		[data-video-transport][data-voiceover-active='true'] .voiceover-secondary {
			display: none;
		}
	}

	@media (pointer: coarse) {
		:global(.transport-overflow [data-slot='dropdown-menu-item']),
		:global(.transport-overflow [data-slot='dropdown-menu-checkbox-item']),
		:global(.transport-overflow [data-slot='dropdown-menu-sub-trigger']) {
			min-height: 2.75rem;
		}
	}
</style>
