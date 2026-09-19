<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import MediaInspectorPreview from '$lib/components/media-inspector-preview.svelte';
	import MediaUsageList from '$lib/components/media-usage-list.svelte';
	import type { MediaTag } from '$lib/media-tags';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import {
		canDeleteMedia,
		isImage,
		isVideo,
		usageSummaryLabel,
		type MediaItem,
		type MediaUsage
	} from '$lib/media-presentation';

	interface Props {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		media: MediaItem | null;
		deletionBlocked: boolean;
		canEdit: boolean;
		editorEnabled: boolean;
		timeZone: string;
		formatDate: (dateStr: string) => string;
		tags: MediaTag[];
		usages: MediaUsage[];
		usagesLoading: boolean;
		usagesReady: boolean;
		usagesError: string;
		altText?: string;
		altSaving: boolean;
		onClose: () => void;
		onRetryAnalysis: (media: MediaItem) => void;
		onToggleTag: (mediaID: string, tagID: string, selected: boolean) => void;
		onCreateTag: (mediaID: string, name: string) => void;
		onSaveAlt: () => void;
		onEditImage: (media: MediaItem, action?: string) => void;
		onEditVideo: (media: MediaItem) => void;
		onRename: (media: MediaItem) => void;
		onDuplicate: (media: MediaItem) => void;
		onDownload: (media: MediaItem) => void;
		onDelete: (media: MediaItem) => void;
		onShowUsage: (media: MediaItem) => void;
	}

	let {
		open,
		onOpenChange,
		media,
		deletionBlocked,
		canEdit,
		editorEnabled,
		timeZone,
		formatDate,
		tags,
		usages,
		usagesLoading,
		usagesReady,
		usagesError,
		altText = $bindable(''),
		altSaving,
		onClose,
		onRetryAnalysis,
		onToggleTag,
		onCreateTag,
		onSaveAlt,
		onEditImage,
		onEditVideo,
		onRename,
		onDuplicate,
		onDownload,
		onDelete,
		onShowUsage
	}: Props = $props();
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="max-h-[min(860px,calc(100dvh-2rem))] overflow-y-auto sm:max-w-3xl sm:p-6">
		<Dialog.Header class="border-b pr-10 pb-4">
			<Dialog.Title>{media?.original_filename || m.media_details()}</Dialog.Title>
			<Dialog.Description>
				{#if media}
					{usageSummaryLabel(media.usage_count)}
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if deletionBlocked}
			<InlineNotice tone="info" message={m.media_delete_active_work_body()} />
		{/if}

		{#if media}
			<MediaInspectorPreview
				{media}
				{tags}
				{canEdit}
				bind:altText
				{altSaving}
				{formatDate}
				{onToggleTag}
				{onCreateTag}
				{onSaveAlt}
				{onRetryAnalysis}
			/>
			<div class="flex flex-wrap gap-2 border-y py-3">
				{#if isImage(media.mime_type) && canEdit && editorEnabled}
					<Button variant="outline" size="sm" onclick={() => onEditImage(media!)}>
						<ThemeIcon role="appearance" />
						{m.media_edit_image_editor()}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={() => onEditImage(media!, 'remove-background')}
					>
						<ThemeIcon role="image" />
						{m.image_editor_remove_background()}
					</Button>
				{/if}
				{#if isVideo(media.mime_type) && canEdit}
					<Button variant="outline" size="sm" onclick={() => onEditVideo(media!)}>
						<ThemeIcon role="video" />
						{m.media_edit_video_editor()}
					</Button>
				{/if}
				{#if canEdit}
					<Button variant="outline" size="sm" onclick={() => onRename(media!)}>
						<ThemeIcon role="edit" />
						{m.common_rename()}
					</Button>
					<Button variant="outline" size="sm" onclick={() => onDuplicate(media!)}>
						<ThemeIcon role="layout" />
						{m.image_editor_duplicate()}
					</Button>
				{/if}
				<Button variant="outline" size="sm" onclick={() => onDownload(media!)}>
					<ThemeIcon role="download" />
					{m.image_editor_download()}
				</Button>
				{#if canEdit}
					<Button variant="destructive" size="sm" onclick={() => onDelete(media!)}>
						<ThemeIcon role="delete" />
						{m.common_delete()}
					</Button>
				{/if}
				{#if canEdit && !canDeleteMedia(media)}
					<p class="basis-full text-xs text-muted-foreground">
						{m.media_delete_blocked()}
					</p>
				{/if}
			</div>
		{/if}

		<MediaUsageList
			{usages}
			{usagesLoading}
			{usagesReady}
			{usagesError}
			{media}
			{timeZone}
			{onShowUsage}
		/>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => onClose()}>{m.common_close()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
