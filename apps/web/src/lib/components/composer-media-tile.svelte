<script lang="ts">
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import GridAltEditor from './grid-alt-editor.svelte';

	interface Props {
		mediaId: string;
		mediaIndex: number;
		mediaCount: number;
		isFirstOfThree: boolean;
		altTexts: Map<string, string>;
		captioningIds: Set<string>;
		editing: boolean;
		isVideoMedia: (mediaId: string) => boolean;
		onRemoveMedia: (mediaIndex: number) => void;
		onAltText: (mediaId: string, alt: string) => void;
		onToggleAlt: () => void;
		onDoneAlt: () => void;
	}

	let {
		mediaId,
		mediaIndex,
		mediaCount,
		isFirstOfThree,
		altTexts,
		captioningIds,
		editing,
		isVideoMedia,
		onRemoveMedia,
		onAltText,
		onToggleAlt,
		onDoneAlt
	}: Props = $props();
</script>

<div
	tabindex="-1"
	data-composer-media-id={mediaId}
	class="group/media relative overflow-hidden rounded-lg {isFirstOfThree ? 'col-span-2' : ''}"
>
	{#if isVideoMedia(mediaId)}
		<video
			src={getAuthenticatedMediaByID(mediaId)}
			class="{mediaCount === 1 ? 'aspect-video' : 'aspect-square'} w-full object-cover"
			controls
			muted
			playsinline
		></video>
	{:else}
		<img
			src={getAuthenticatedMediaByID(mediaId)}
			alt={altTexts.get(mediaId) || ''}
			class="{mediaCount === 1 ? 'aspect-video' : 'aspect-square'} w-full object-cover"
		/>
	{/if}
	<div
		class="absolute top-2 right-2 flex items-center gap-1 opacity-100 md:opacity-0 md:transition-opacity md:group-focus-within/media:opacity-100 md:group-hover/media:opacity-100"
		data-testid="composer-media-actions"
	>
		<button
			type="button"
			class={[
				'flex size-11 items-center justify-center rounded-md bg-black/75 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/90 md:size-7',
				altTexts.get(mediaId) ? 'ring-2 ring-primary/80 ring-offset-1 ring-offset-transparent' : ''
			]}
			aria-label={captioningIds.has(mediaId)
				? m.compose_alt_text_generating()
				: altTexts.get(mediaId)
					? m.media_alt_text()
					: m.media_add_alt_text()}
			title={captioningIds.has(mediaId)
				? m.compose_alt_text_generating()
				: altTexts.get(mediaId)
					? m.media_alt_text()
					: m.media_add_alt_text()}
			onclick={(e) => {
				e.stopPropagation();
				onToggleAlt();
			}}
		>
			{#if captioningIds.has(mediaId)}
				<ProtectedIcon icon="loading" class="size-4 animate-spin md:size-3.5" />
			{:else}
				<ProtectedIcon icon="editor-text" class="size-4 md:size-3.5" />
			{/if}
		</button>
		<button
			type="button"
			class="flex size-11 items-center justify-center rounded-md bg-black/75 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-red-600 md:size-7"
			aria-label={m.compose_remove_media()}
			title={m.compose_remove_media()}
			onclick={(e) => {
				e.stopPropagation();
				onRemoveMedia(mediaIndex);
			}}
		>
			<ThemeIcon role="close" class="size-4 md:size-3.5" />
		</button>
	</div>
	<GridAltEditor
		open={editing}
		{mediaId}
		{altTexts}
		{captioningIds}
		{onAltText}
		onDone={onDoneAlt}
	/>
</div>
