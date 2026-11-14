<script lang="ts">
	import { getAuthenticatedMediaByID, getAuthenticatedMediaURL } from '$lib/media-url';
	import { ThemeIcon } from '$lib/themes/icons';
	import ComposerMediaActions from './composer-media-actions.svelte';

	interface Props {
		mediaId: string;
		mediaIndex: number;
		mediaCount: number;
		isFirstOfThree: boolean;
		altTexts: Map<string, string>;
		captioningIds: Set<string>;
		failedCaptionIds: Set<string>;
		editing: boolean;
		isVideoMedia: (mediaId: string) => boolean;
		onRemoveMedia: (mediaIndex: number) => void;
		onAltText: (mediaId: string, alt: string) => void;
		onToggleAlt: () => void;
		onRetryCaption: (mediaId: string) => void;
		onDoneAlt: () => void;
	}

	let {
		mediaId,
		mediaIndex,
		mediaCount,
		isFirstOfThree,
		altTexts,
		captioningIds,
		failedCaptionIds,
		editing,
		isVideoMedia,
		onRemoveMedia,
		onAltText,
		onToggleAlt,
		onRetryCaption,
		onDoneAlt
	}: Props = $props();

	const originalURL = $derived(getAuthenticatedMediaByID(mediaId));
	const thumbURL = $derived(getAuthenticatedMediaURL(`/media/${mediaId}/thumb/md`));
	const posterURL = $derived(getAuthenticatedMediaURL(`/media/${mediaId}/poster`));
	// The composer tile is large, so the 400px thumbnail tier blurs once the
	// image is stretched across the editor column. Show the authored original
	// and keep the thumbnail only as a fallback for originals that fail.
	let showingThumbnail = $state(false);
	let missing = $state(false);

	function handleImageError(): void {
		if (!showingThumbnail) {
			showingThumbnail = true;
			return;
		}
		missing = true;
	}
</script>

<div
	tabindex="-1"
	data-composer-media-id={mediaId}
	class="group/media relative overflow-hidden rounded-lg {isFirstOfThree ? 'col-span-2' : ''}"
>
	{#if missing}
		<div
			class="{mediaCount === 1
				? 'aspect-video'
				: 'aspect-square'} flex w-full items-center justify-center bg-muted"
			role="presentation"
		>
			<ThemeIcon role="image" class="size-8 text-muted-foreground/40" />
		</div>
	{:else if isVideoMedia(mediaId)}
		<video
			src={originalURL}
			poster={posterURL}
			class="{mediaCount === 1 ? 'aspect-video' : 'aspect-square'} w-full object-cover"
			controls
			muted
			playsinline
			preload="metadata"
			onerror={() => (missing = true)}
		></video>
	{:else}
		<img
			src={showingThumbnail ? thumbURL : originalURL}
			alt={altTexts.get(mediaId) || ''}
			class="{mediaCount === 1 ? 'aspect-video' : 'aspect-square'} w-full object-cover"
			onerror={handleImageError}
		/>
	{/if}
	<ComposerMediaActions
		{mediaId}
		{altTexts}
		{captioningIds}
		{failedCaptionIds}
		{editing}
		{onAltText}
		{onToggleAlt}
		{onRetryCaption}
		{onDoneAlt}
		onRemove={() => onRemoveMedia(mediaIndex)}
	/>
</div>
