<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import MediaTagPicker from '$lib/components/media-tag-picker.svelte';
	import InspectorAltForm from '$lib/components/inspector-alt-form.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import type { MediaTag } from '$lib/media-tags';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import {
		formatSize,
		formatVideoDuration,
		isAudio,
		isImage,
		isVideo,
		mediaSourceLabel,
		type MediaItem
	} from '$lib/media-presentation';

	interface Props {
		media: MediaItem;
		tags: MediaTag[];
		canEdit: boolean;
		altText?: string;
		altSaving: boolean;
		formatDate: (dateStr: string) => string;
		onToggleTag: (mediaID: string, tagID: string, selected: boolean) => void;
		onCreateTag: (mediaID: string, name: string) => void;
		onSaveAlt: () => void;
		onRetryAnalysis: (media: MediaItem) => void;
	}

	let {
		media,
		tags,
		canEdit,
		altText = $bindable(''),
		altSaving,
		formatDate,
		onToggleTag,
		onCreateTag,
		onSaveAlt,
		onRetryAnalysis
	}: Props = $props();
</script>

<div class="grid items-start gap-6 py-2 md:grid-cols-[18rem_minmax(0,1fr)]">
	<figure
		class="overflow-hidden rounded-xl bg-muted/20 ring-1 ring-foreground/10 md:sticky md:top-0"
	>
		{#if isImage(media.mime_type)}
			<img
				src={getAuthenticatedMediaURL(media.thumbnail_url || media.url)}
				alt={media.alt_text || media.original_filename}
				class="aspect-[4/3] size-full object-contain"
			/>
		{:else if isVideo(media.mime_type)}
			<video
				src={getAuthenticatedMediaURL(media.url)}
				class="aspect-[4/3] size-full object-contain"
				controls
				muted
				playsinline
			></video>
		{:else if isAudio(media.mime_type)}
			<div class="flex aspect-[4/3] flex-col items-center justify-center gap-4 p-5">
				<ProtectedIcon icon="media-audio" class="size-12 text-muted-foreground" />
				<audio src={getAuthenticatedMediaURL(media.url)} class="w-full" controls></audio>
			</div>
		{/if}
		<figcaption class="border-t px-3 py-2 text-xs text-muted-foreground">
			{media.width || '—'} × {media.height || '—'} ·
			{formatSize(media.size)}
		</figcaption>
	</figure>
	<div class="min-w-0 space-y-5">
		<dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
			<div>
				<dt class="text-xs text-muted-foreground">{m.media_type()}</dt>
				<dd class="mt-0.5 break-words">{media.mime_type}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">{m.media_source()}</dt>
				<dd class="mt-0.5">{mediaSourceLabel(media.source)}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">{m.media_created()}</dt>
				<dd class="mt-0.5">{formatDate(media.created_at)}</dd>
			</div>
			{#if media.design_document_id}
				<div>
					<dt class="text-xs text-muted-foreground">{m.media_design()}</dt>
					<dd class="mt-0.5">
						<a
							href={resolve(`/image-editor/${media.design_document_id}` as '/')}
							class="font-medium text-primary hover:underline"
						>
							{m.media_open_design()}
						</a>
					</dd>
				</div>
			{/if}
			{#if media.parent_media_id}
				<div class="sm:col-span-2">
					<dt class="text-xs text-muted-foreground">{m.media_original()}</dt>
					<dd class="mt-0.5 font-mono text-xs break-all">
						{media.parent_media_id}
					</dd>
				</div>
			{/if}
			{#if isVideo(media.mime_type)}
				<div>
					<dt class="text-xs text-muted-foreground">{m.media_duration()}</dt>
					<dd class="mt-0.5">{formatVideoDuration(media.duration_ms)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">{m.media_video_format()}</dt>
					<dd class="mt-0.5">
						{[media.container_format, media.video_codec, media.audio_codec]
							.filter(Boolean)
							.join(' · ') || '—'}
					</dd>
				</div>
				{#if media.processing_status === 'failed' || media.analysis_status === 'failed'}
					<div class="sm:col-span-2">
						<InlineNotice
							tone="error"
							message={media.analysis_error || m.media_video_processing_failed()}
						>
							{#snippet actions()}
								{#if canEdit}
									<Button
										type="button"
										variant="outline"
										size="sm"
										onclick={() => onRetryAnalysis(media!)}
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
					{#each media.tags as tagID (tagID)}
						{@const tag = tags.find((item) => item.id === tagID)}
						{#if tag}
							<span class="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium"
								>#{tag.name}</span
							>
						{/if}
					{/each}
					{#if canEdit}
						<MediaTagPicker
							{tags}
							selectedIds={media.tags}
							canEdit
							onToggle={(tagID, selected) => onToggleTag(media!.id, tagID, selected)}
							onCreate={(name) => onCreateTag(media!.id, name)}
						/>
					{/if}
				</dd>
			</div>
		</dl>
		<InspectorAltForm
			bind:altText
			savedAltText={media.alt_text}
			{altSaving}
			{canEdit}
			{onSaveAlt}
		/>
	</div>
</div>
