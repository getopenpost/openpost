<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { m } from '$lib/paraglide/messages';
	import {
		formatMediaBitrate,
		formatMediaBytes,
		formatMediaDuration
	} from '$lib/video-editor/media/library-view';
	import type { MediaMetadata } from '$lib/video-editor/media/types';
	import InfoIcon from '@lucide/svelte/icons/info';

	let { media }: { media: MediaMetadata } = $props();

	const rows = $derived([
		{ label: m.video_editor_media_info_type(), value: media.mimeType || m.common_none() },
		{
			label: m.video_editor_media_info_duration(),
			value: media.duration > 0 ? formatMediaDuration(media.duration) : m.common_none()
		},
		{
			label: m.video_editor_media_info_dimensions(),
			value:
				media.width > 0 && media.height > 0 ? `${media.width} × ${media.height}` : m.common_none()
		},
		{
			label: m.video_editor_media_info_frame_rate(),
			value: media.fps > 0 ? `${Math.round(media.fps * 1000) / 1000} fps` : m.common_none()
		},
		{
			label: m.video_editor_media_info_video_codec(),
			value: media.codec || m.common_none()
		},
		{
			label: m.video_editor_media_info_audio_codec(),
			value:
				media.audioCodecSupported === false && media.audioCodec
					? `${media.audioCodec} · ${m.video_editor_unsupported_audio_title()}`
					: media.audioCodec || m.common_none()
		},
		{
			label: m.video_editor_media_info_bitrate(),
			value: media.bitrate > 0 ? formatMediaBitrate(media.bitrate) : m.common_none()
		},
		{ label: m.video_editor_media_info_size(), value: formatMediaBytes(media.fileSize) },
		{
			label: m.video_editor_media_info_storage(),
			value:
				media.storageType === 'handle'
					? m.video_editor_media_info_linked()
					: m.video_editor_media_info_copied()
		}
	]);
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="ghost"
				size="icon-xs"
				class="text-[oklch(0.68_0.015_55)] opacity-70 hover:bg-white/10 hover:text-white hover:opacity-100 focus:opacity-100"
				aria-label={`${m.video_editor_media_info()}: ${media.fileName}`}
				title={m.video_editor_media_info()}
			>
				<InfoIcon class="size-3.5" aria-hidden="true" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="end"
		side="bottom"
		class="video-editor-theme max-h-[min(80vh,32rem)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto border-[oklch(0.31_0.018_55)] bg-[oklch(0.16_0.012_50)] p-3 text-[var(--video-editor-text)]"
	>
		<div class="border-b border-[oklch(0.28_0.014_55)] pb-2">
			<p class="text-sm font-medium break-words">{media.fileName}</p>
			<p class="mt-0.5 text-[10px] text-[var(--video-editor-muted)]">{media.id}</p>
		</div>
		<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
			{#each rows as row (row.label)}
				<dt class="text-[var(--video-editor-muted)]">{row.label}</dt>
				<dd class="min-w-0 text-right font-medium break-words">{row.value}</dd>
			{/each}
			{#if media.tags.length > 0}
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_media_info_tags()}</dt>
				<dd class="min-w-0 text-right font-medium break-words">{media.tags.join(', ')}</dd>
			{/if}
			{#if media.attribution}
				<dt class="text-[var(--video-editor-muted)]">
					{m.video_editor_media_info_attribution()}
				</dt>
				<dd class="min-w-0 text-right font-medium break-words">
					{[media.attribution.author, media.attribution.provider, media.attribution.license]
						.filter(Boolean)
						.join(' · ')}
				</dd>
			{/if}
		</dl>
	</Popover.Content>
</Popover.Root>
