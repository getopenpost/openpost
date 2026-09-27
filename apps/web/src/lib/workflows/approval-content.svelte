<script lang="ts">
	import type { components } from '$lib/api/types';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import MediaPreviewImage from '$lib/components/media-preview-image.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	let { publication }: { publication: components['schemas']['PublicationResponse'] } = $props();
	type Content = {
		title?: string;
		body?: string;
		description?: string;
		url?: string;
		media?: components['schemas']['MediaSummary'][] | null;
	};
</script>

{#snippet content(value: Content)}
	<div class="space-y-2 text-sm break-words">
		{#if value.title}<p class="font-medium">{value.title}</p>{/if}
		{#if value.body}<p class="whitespace-pre-wrap">{value.body}</p>{/if}
		{#if value.description}<p class="whitespace-pre-wrap">{value.description}</p>{/if}
		{#if value.url}<p class="break-all text-muted-foreground">{value.url}</p>{/if}
		{#each value.media ?? [] as media (media.id)}
			<figure class="overflow-hidden rounded-md border">
				{#if media.mime_type.startsWith('image/')}<MediaPreviewImage
						mediaId={media.id}
						alt={media.alt_text || media.original_filename}
						class="max-h-64 w-full object-contain"
					/>
				{:else if media.mime_type.startsWith('video/')}<video
						src={getAuthenticatedMediaURL(media.url)}
						class="max-h-64 w-full"
						controls
						muted
						playsinline
					></video>
				{:else if media.mime_type.startsWith('audio/')}<audio
						src={getAuthenticatedMediaURL(media.url)}
						class="w-full"
						controls
					></audio>{/if}
				<figcaption class="p-2 text-xs text-muted-foreground">
					{media.original_filename}{#if media.alt_text}<p class="mt-1">{media.alt_text}</p>{/if}
				</figcaption>
			</figure>
		{/each}
	</div>
{/snippet}

<div class="space-y-4">
	{#if publication.renditions?.length}
		<h4 class="text-xs font-medium text-muted-foreground">
			{m.publication_destinations_heading()}
		</h4>
		{#each publication.renditions as rendition (rendition.id)}
			<article class="space-y-3 border-t pt-3">
				<h5 class="flex items-center gap-2 text-sm font-medium">
					<PlatformIcon platform={rendition.platform} class="size-4" />{getPlatformName(
						rendition.platform
					)}<span class="truncate text-xs text-muted-foreground">{rendition.target_key}</span>
				</h5>
				{#if rendition.segments?.length}
					{#each rendition.segments as segment (segment.id)}<div class="border-l-2 pl-3">
							{@render content(segment)}
						</div>{/each}
				{:else}{@render content(rendition)}{/if}
			</article>
		{/each}
	{:else if publication.segments?.length}
		{#each publication.segments as segment (segment.id)}<div class="border-l-2 pl-3">
				{@render content(segment)}
			</div>{/each}
	{:else}{@render content({
			title: publication.title,
			body: publication.source_text,
			url: publication.source_url,
			media: publication.media
		})}{/if}
</div>
