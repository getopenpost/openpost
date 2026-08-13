<script lang="ts">
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import MediaAcquisitionPanel from '$lib/components/media-acquisition-panel.svelte';
	import type { MediaUploadResult } from '$lib/media-upload-client';
	import type { VideoConstraint } from '$lib/video/types';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import ImageIcon from '@lucide/svelte/icons/image';
	import LibraryIcon from '@lucide/svelte/icons/library';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { m } from '$lib/paraglide/messages';

	type SourceMode = 'device' | 'camera' | 'stock';

	let {
		open = $bindable(false),
		workspaceId,
		accept = ['image/*', 'video/*', 'audio/*'],
		maxFiles = 10,
		retentionClass = 'library',
		tagId,
		videoConstraints = [],
		initialSource = 'upload',
		initialFiles = [],
		showLibrary = false,
		onOpenLibrary,
		onInitialFilesConsumed,
		onUploaded
	}: {
		open?: boolean;
		workspaceId: string;
		accept?: string[];
		maxFiles?: number;
		retentionClass?: 'library' | 'temporary';
		tagId?: string;
		videoConstraints?: VideoConstraint[];
		initialSource?: 'upload' | 'camera' | 'stock';
		initialFiles?: File[];
		showLibrary?: boolean;
		onOpenLibrary?: () => void;
		onInitialFilesConsumed?: () => void;
		onUploaded: (results: MediaUploadResult[]) => void | Promise<void>;
	} = $props();

	let source = $state<SourceMode>('device');
	const canUseStock = $derived(
		accept.some(
			(item) =>
				item === 'image/*' ||
				item.startsWith('image/') ||
				item === 'video/*' ||
				item.startsWith('video/')
		)
	);

	function initialize(): void {
		untrack(() => {
			source =
				initialFiles.length > 0 ? 'device' : initialSource === 'upload' ? 'device' : initialSource;
		});
	}

	function handleOpenChange(nextOpen: boolean): void {
		if (nextOpen) initialize();
	}

	async function completeUpload(
		results: MediaUploadResult[],
		outcome: { allSucceeded: boolean }
	): Promise<void> {
		await onUploaded(results);
		if (outcome.allSucceeded) open = false;
	}

	function openLibrary(): void {
		open = false;
		onOpenLibrary?.();
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="top-0 left-0 flex h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(760px,calc(100dvh-2rem))] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
	>
		<div class="contents" {@attach initialize}></div>
		<Dialog.Header class="shrink-0 border-b px-5 py-4 pr-14">
			<Dialog.Title>{m.media_upload_title()}</Dialog.Title>
			<Dialog.Description>{m.media_upload_description_custom()}</Dialog.Description>
		</Dialog.Header>

		<div
			class="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2"
			aria-label={m.media_source()}
		>
			<Button
				variant={source === 'device' ? 'secondary' : 'ghost'}
				size="sm"
				class="min-h-11 shrink-0 sm:min-h-9"
				onclick={() => (source = 'device')}
			>
				<UploadIcon />
				{m.media_upload_device()}
			</Button>
			{#if accept.some((item) => item === 'image/*' || item.startsWith('image/'))}
				<Button
					variant={source === 'camera' ? 'secondary' : 'ghost'}
					size="sm"
					class="min-h-11 shrink-0 sm:min-h-9"
					onclick={() => (source = 'camera')}
				>
					<CameraIcon />
					{m.media_camera()}
				</Button>
			{/if}
			{#if canUseStock}
				<Button
					variant={source === 'stock' ? 'secondary' : 'ghost'}
					size="sm"
					class="min-h-11 shrink-0 sm:min-h-9"
					onclick={() => (source = 'stock')}
				>
					<ImageIcon />
					{m.video_editor_stock()}
				</Button>
			{/if}
			{#if showLibrary}
				<Button
					variant="ghost"
					size="sm"
					class="min-h-11 shrink-0 sm:min-h-9"
					onclick={openLibrary}
				>
					<LibraryIcon />
					{m.media_picker_library()}
				</Button>
			{/if}
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
			{#key source}
				<MediaAcquisitionPanel
					mode={source}
					{workspaceId}
					{accept}
					{maxFiles}
					{retentionClass}
					{tagId}
					{videoConstraints}
					{initialFiles}
					{onInitialFilesConsumed}
					onUploaded={completeUpload}
				/>
			{/key}
		</div>
	</Dialog.Content>
</Dialog.Root>
