<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import CameraCapture from './camera-capture.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { listStudioMedia } from '$lib/studio/api';
	import type { StudioMediaItem } from '$lib/studio/types';
	import SearchIcon from 'lucide-svelte/icons/search';
	import UploadIcon from 'lucide-svelte/icons/upload';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import ImageIcon from 'lucide-svelte/icons/image';
	import PaletteIcon from 'lucide-svelte/icons/palette';
	import CheckIcon from 'lucide-svelte/icons/check';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import ArrowLeftIcon from 'lucide-svelte/icons/arrow-left';
	import { m } from '$lib/paraglide/messages';

	let {
		open = $bindable(false),
		workspaceId,
		currentSelection = [],
		accept = ['image/*', 'video/*'],
		maxSelection = 4,
		multiple = true,
		title = m.media_picker_add_media(),
		purpose = 'post_media',
		showCreate = true,
		onConfirm,
		onCreate
	}: {
		open?: boolean;
		workspaceId: string;
		currentSelection?: string[];
		accept?: string[];
		maxSelection?: number;
		multiple?: boolean;
		title?: string;
		purpose?: string;
		showCreate?: boolean;
		onConfirm: (mediaIDs: string[], media: StudioMediaItem[]) => void | Promise<void>;
		onCreate?: () => void | Promise<void>;
	} = $props();

	let mode = $state<'library' | 'camera'>('library');
	let media = $state<StudioMediaItem[]>([]);
	let selectedIDs = $state.raw<string[]>([]);
	let search = $state('');
	let loading = $state(false);
	let actionLoading = $state(false);
	let error = $state('');
	let uploadInput = $state<HTMLInputElement>();
	let loadedForWorkspace = $state('');

	function attachUploadInput(node: HTMLInputElement) {
		uploadInput = node;
		return () => {
			if (uploadInput === node) uploadInput = undefined;
		};
	}

	function initializePicker() {
		selectedIDs = [...currentSelection];
		mode = 'library';
		error = '';
		if (loadedForWorkspace !== workspaceId) void loadMedia();
	}

	async function loadMedia(): Promise<void> {
		if (!workspaceId) return;
		loading = true;
		error = '';
		try {
			media = (await listStudioMedia(workspaceId, search)).filter((item) =>
				mimeAllowed(item.mime_type)
			);
			loadedForWorkspace = workspaceId;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_load_failed();
		} finally {
			loading = false;
		}
	}

	function mimeAllowed(mime: string): boolean {
		return accept.some((accepted) =>
			accepted.endsWith('/*') ? mime.startsWith(accepted.slice(0, -1)) : mime === accepted
		);
	}

	function toggleMedia(id: string): void {
		if (selectedIDs.includes(id)) {
			selectedIDs = selectedIDs.filter((item) => item !== id);
			return;
		}
		if (!multiple) {
			selectedIDs = [id];
			return;
		}
		if (selectedIDs.length >= maxSelection) {
			error = m.media_picker_selection_limit({ maximum: maxSelection });
			return;
		}
		selectedIDs = [...selectedIDs, id];
	}

	async function confirm(): Promise<void> {
		actionLoading = true;
		error = '';
		try {
			await onConfirm(
				selectedIDs,
				selectedIDs
					.map((id) => media.find((item) => item.id === id))
					.filter((item): item is StudioMediaItem => Boolean(item))
			);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_add_failed();
		} finally {
			actionLoading = false;
		}
	}

	async function uploadFiles(files: FileList | null): Promise<void> {
		if (!files?.length) return;
		actionLoading = true;
		error = '';
		try {
			const available = Math.max(0, maxSelection - selectedIDs.length);
			const candidates = Array.from(files)
				.filter((file) => mimeAllowed(file.type))
				.slice(0, available);
			for (const file of candidates) {
				const uploaded = await uploadMediaFile({ workspaceId, file, source: 'upload' });
				selectedIDs = [...selectedIDs, uploaded.id];
			}
			await loadMedia();
			mode = 'library';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_upload_failed();
		} finally {
			actionLoading = false;
			if (uploadInput) uploadInput.value = '';
		}
	}

	async function capturePhoto(file: File): Promise<void> {
		actionLoading = true;
		error = '';
		try {
			const uploaded = await uploadMediaFile({ workspaceId, file, source: 'camera' });
			selectedIDs = multiple ? [...selectedIDs, uploaded.id].slice(0, maxSelection) : [uploaded.id];
			await loadMedia();
			mode = 'library';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_photo_failed();
		} finally {
			actionLoading = false;
		}
	}

	async function createDesign(): Promise<void> {
		actionLoading = true;
		error = '';
		try {
			if (onCreate) {
				await onCreate();
				open = false;
				return;
			}
			await goto(
				resolve(
					`/studio/new?workspace=${encodeURIComponent(workspaceId)}&purpose=${encodeURIComponent(purpose)}` as '/'
				)
			);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.media_picker_studio_failed();
		} finally {
			actionLoading = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="top-0 left-0 flex h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-[min(760px,calc(100dvh-2rem))] sm:max-w-5xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
	>
		<div class="contents" {@attach initializePicker}></div>
		<Dialog.Header class="border-b px-4 py-3 pr-14">
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				{m.media_picker_selected_count({
					selected: selectedIDs.length,
					maximum: maxSelection
				})}
			</Dialog.Description>
		</Dialog.Header>

		{#if mode === 'library'}
			<div class="grid grid-cols-3 gap-2 border-b px-4 py-3">
				<label
					class="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted"
				>
					{#if actionLoading}<LoaderIcon class="size-4 animate-spin" />{:else}<UploadIcon
							class="size-4"
						/>{/if}
					{m.media_picker_upload()}
					<input
						{@attach attachUploadInput}
						type="file"
						{multiple}
						accept={accept.join(',')}
						class="sr-only"
						disabled={actionLoading}
						onchange={(event) => uploadFiles(event.currentTarget.files)}
					/>
				</label>
				<Button
					variant="outline"
					class="min-h-11"
					disabled={actionLoading}
					onclick={() => (mode = 'camera')}
				>
					<CameraIcon />
					{m.studio_camera()}
				</Button>
				{#if showCreate}
					<Button
						variant="outline"
						class="min-h-11"
						disabled={actionLoading}
						onclick={createDesign}
					>
						<PaletteIcon />
						{m.media_picker_create()}
					</Button>
				{:else}
					<div></div>
				{/if}
			</div>

			<div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
				<form
					class="mb-3 flex gap-2"
					onsubmit={(event) => {
						event.preventDefault();
						void loadMedia();
					}}
				>
					<div class="relative flex-1">
						<SearchIcon
							class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input bind:value={search} class="pl-9" placeholder={m.media_picker_search()} />
					</div>
					<Button
						variant="outline"
						type="submit"
						size="icon"
						aria-label={m.media_picker_search_action()}
					>
						{#if loading}<LoaderIcon class="animate-spin" />{:else}<SearchIcon />{/if}
					</Button>
				</form>
				{#if loading && media.length === 0}
					<div class="flex min-h-48 items-center justify-center text-muted-foreground">
						<LoaderIcon class="mr-2 size-5 animate-spin" />
						{m.media_picker_loading()}
					</div>
				{:else if media.length === 0}
					<div
						class="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed text-center"
					>
						<ImageIcon class="mb-3 size-8 text-muted-foreground" />
						<p class="font-medium">{m.media_picker_no_match()}</p>
						<p class="mt-1 text-sm text-muted-foreground">{m.media_picker_no_match_body()}</p>
					</div>
				{:else}
					<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
						{#each media as item (item.id)}
							<button
								type="button"
								class="group relative aspect-square overflow-hidden rounded-lg border bg-muted text-left focus-visible:ring-2 focus-visible:ring-ring {selectedIDs.includes(
									item.id
								)
									? 'ring-2 ring-primary'
									: ''}"
								onclick={() => toggleMedia(item.id)}
								aria-pressed={selectedIDs.includes(item.id)}
								aria-label={m.media_picker_select_item({ name: item.original_filename })}
							>
								<img
									src={getAuthenticatedMediaURL(item.thumbnail_url || item.url)}
									alt={item.alt_text || item.original_filename}
									class="size-full object-cover transition-transform group-hover:scale-[1.02]"
									loading="lazy"
								/>
								{#if selectedIDs.includes(item.id)}
									<span
										class="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
									>
										<CheckIcon class="size-4" />
									</span>
									<span
										class="absolute right-2 bottom-2 rounded bg-background/90 px-2 py-1 text-xs font-medium"
									>
										{selectedIDs.indexOf(item.id) + 1}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="min-h-0 flex-1 overflow-y-auto p-4">
				<Button variant="ghost" class="mb-3" onclick={() => (mode = 'library')}>
					<ArrowLeftIcon />
					{m.media_picker_back_to_library()}
				</Button>
				<CameraCapture onCapture={capturePhoto} onCancel={() => (mode = 'library')} />
			</div>
		{/if}

		{#if error}
			<div
				class="mx-4 mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
				role="alert"
			>
				{error}
			</div>
		{/if}
		<Dialog.Footer class="border-t px-4 py-3">
			<Button variant="ghost" onclick={() => (open = false)}>{m.common_cancel()}</Button>
			<Button onclick={confirm} disabled={actionLoading || selectedIDs.length === 0}>
				{#if actionLoading}<LoaderIcon class="animate-spin" />{/if}
				{m.media_picker_add_media()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
