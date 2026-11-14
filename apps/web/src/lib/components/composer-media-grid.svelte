<script lang="ts">
	import type { MediaUploadResult } from '$lib/media-upload-client';
	import ComposerMediaTile from './composer-media-tile.svelte';
	import PasteUploadList from './paste-upload-list.svelte';
	import { ComposerSessionMediaQueue, type PasteMediaUploadItem } from '$lib/composer/media-queue';

	interface Props {
		mediaIds: string[];
		mediaCount: number;
		altTexts: Map<string, string>;
		captioningIds: Set<string>;
		failedCaptionIds: Set<string>;
		editingAltMediaId?: string | null;
		pendingUploads: PasteMediaUploadItem[];
		queue: ComposerSessionMediaQueue<MediaUploadResult>;
		isVideoMedia: (mediaId: string) => boolean;
		onRemoveMedia: (mediaIndex: number) => void;
		onAltText: (mediaId: string, alt: string) => void;
		onRetryCaption: (mediaId: string) => void;
	}

	let {
		mediaIds,
		mediaCount,
		altTexts,
		captioningIds,
		failedCaptionIds,
		editingAltMediaId = $bindable(null),
		pendingUploads,
		queue,
		isVideoMedia,
		onRemoveMedia,
		onAltText,
		onRetryCaption
	}: Props = $props();
</script>

{#if mediaCount > 0}
	<div class="mb-3 {mediaCount === 1 ? '' : 'grid grid-cols-2 gap-1.5'}">
		{#each mediaIds as mediaId, mi (mediaId)}
			<ComposerMediaTile
				{mediaId}
				mediaIndex={mi}
				{mediaCount}
				isFirstOfThree={mediaCount === 3 && mi === 0}
				{altTexts}
				{captioningIds}
				{failedCaptionIds}
				editing={editingAltMediaId === mediaId}
				{isVideoMedia}
				{onRemoveMedia}
				{onAltText}
				{onRetryCaption}
				onToggleAlt={() => {
					editingAltMediaId = editingAltMediaId === mediaId ? null : mediaId;
				}}
				onDoneAlt={() => (editingAltMediaId = null)}
			/>
		{/each}
		<PasteUploadList uploads={pendingUploads} {mediaCount} baseCount={mediaIds.length} {queue} />
	</div>
{/if}
