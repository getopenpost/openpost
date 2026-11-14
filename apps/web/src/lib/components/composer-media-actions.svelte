<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import GridAltEditor from './grid-alt-editor.svelte';

	interface Props {
		mediaId: string;
		altTexts: Map<string, string>;
		captioningIds: Set<string>;
		failedCaptionIds: Set<string>;
		editing: boolean;
		onRemove: () => void;
		onAltText: (mediaId: string, alt: string) => void;
		onToggleAlt: () => void;
		onRetryCaption: (mediaId: string) => void;
		onDoneAlt: () => void;
	}
	let {
		mediaId,
		altTexts,
		captioningIds,
		failedCaptionIds,
		editing,
		onRemove,
		onAltText,
		onToggleAlt,
		onRetryCaption,
		onDoneAlt
	}: Props = $props();
</script>

<div
	class="absolute top-2 right-2 z-10 flex items-center gap-1"
	data-testid="composer-media-actions"
>
	<button
		type="button"
		class={[
			'flex size-11 items-center justify-center rounded-md bg-black/75 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none md:size-7 [@media(pointer:coarse)]:size-11',
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
			<ProtectedIcon
				icon="loading"
				class="size-4 animate-spin motion-reduce:animate-none md:size-3.5"
			/>
		{:else}
			<ProtectedIcon icon="editor-text" class="size-4 md:size-3.5" />
		{/if}
	</button>
	<button
		type="button"
		class="flex size-11 items-center justify-center rounded-md bg-black/75 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none md:size-7 [@media(pointer:coarse)]:size-11"
		aria-label={m.compose_remove_media()}
		title={m.compose_remove_media()}
		onclick={(e) => {
			e.stopPropagation();
			onRemove();
		}}
	>
		<ThemeIcon role="close" class="size-4 md:size-3.5" />
	</button>
</div>
<GridAltEditor
	open={editing}
	{mediaId}
	value={altTexts.get(mediaId) ?? ''}
	captioning={captioningIds.has(mediaId)}
	captionFailed={failedCaptionIds.has(mediaId)}
	variant="inline"
	onChange={(next) => onAltText(mediaId, next)}
	onRetryCaption={() => onRetryCaption(mediaId)}
	onDone={onDoneAlt}
/>
