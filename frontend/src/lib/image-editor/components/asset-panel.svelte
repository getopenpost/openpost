<script lang="ts">
	import { onMount } from 'svelte';
	import { ContextMenu } from 'bits-ui';
	import { useImageEditor } from '../editor.svelte';
	import { listImageEditorMedia, loadImageEditorBrandKit } from '../api';
	import { loadImageEditorBrandFonts } from '../fonts';
	import { listGuestImageEditorMedia, storeGuestImageEditorMedia } from '../local-persistence';
	import type { ImageEditorBrandKit, ImageEditorMediaItem } from '../types';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import MediaTagFilter from '$lib/components/media-tag-filter.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import MediaPicker from '$lib/components/media-picker.svelte';
	import MediaPreviewImage from '$lib/components/media-preview-image.svelte';
	import StockMediaBrowser from '$lib/components/stock-media-browser.svelte';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { listMediaTags, type MediaTag } from '$lib/media-tags';
	import type { StockAsset } from '$lib/video-editor/api';
	import type { StockMediaProvenance } from '@openpost/video-project';
	import SearchIcon from 'lucide-svelte/icons/search';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import ImagePlusIcon from 'lucide-svelte/icons/image-plus';
	import ReplaceIcon from 'lucide-svelte/icons/replace';
	import SquareIcon from 'lucide-svelte/icons/square';
	import CircleIcon from 'lucide-svelte/icons/circle';
	import MinusIcon from 'lucide-svelte/icons/minus';
	import TypeIcon from 'lucide-svelte/icons/type';
	import WallpaperIcon from 'lucide-svelte/icons/wallpaper';
	import { m } from '$lib/paraglide/messages';
	import { writeImageEditorMediaDrag, type ImageEditorMediaDragPayload } from '../media-drag';

	let { guestMode = false }: { guestMode?: boolean } = $props();
	const editor = useImageEditor();
	let media = $state<ImageEditorMediaItem[]>([]);
	let brand = $state<ImageEditorBrandKit | null>(null);
	let loading = $state(false);
	let error = $state('');
	let search = $state('');
	let pickerOpen = $state(false);
	let stockOpen = $state(false);
	let replaceMode = $state(false);
	let loadedWorkspaceID = '';
	let dragPreview: HTMLElement | null = null;
	let guestFileInput = $state<HTMLInputElement | null>(null);
	let tags = $state<MediaTag[]>([]);
	let selectedTagIDs = $state.raw<string[]>([]);
	let showUntagged = $state(false);
	let sort = $state<'newest' | 'oldest' | 'name' | 'size' | 'recently_used'>('newest');

	onMount(() => {
		const scopeID = guestMode ? editor.id : editor.workspaceID;
		if (!scopeID || scopeID === loadedWorkspaceID) return;
		loadedWorkspaceID = scopeID;
		void loadAll();
	});

	async function loadAll(): Promise<void> {
		loading = true;
		error = '';
		try {
			if (guestMode) {
				media = await listGuestImageEditorMedia(editor.id);
				brand = null;
				editor.setBrandKit(null);
				return;
			}
			const [nextMedia, nextBrand, tagState] = await Promise.all([
				listImageEditorMedia(editor.workspaceID, search, 'image', mediaListOptions()),
				loadImageEditorBrandKit(editor.workspaceID),
				listMediaTags(editor.workspaceID)
			]);
			media = nextMedia;
			brand = nextBrand;
			tags = tagState.tags;
			editor.setBrandKit(nextBrand);
			await loadImageEditorBrandFonts(nextBrand);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_load_assets_failed();
		} finally {
			loading = false;
		}
	}

	async function searchMedia(): Promise<void> {
		loading = true;
		error = '';
		try {
			media = guestMode
				? await listGuestImageEditorMedia(editor.id, search)
				: await listImageEditorMedia(editor.workspaceID, search, 'image', mediaListOptions());
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_search_failed();
		} finally {
			loading = false;
		}
	}

	function mediaListOptions() {
		return {
			tagIds: selectedTagIDs,
			untagged: showUntagged,
			sort
		};
	}

	function changeTagFilters(tagIDs: string[], untagged: boolean): void {
		selectedTagIDs = tagIDs;
		showUntagged = untagged;
		void searchMedia();
	}

	function uploadTagID(): string | undefined {
		if (!showUntagged && selectedTagIDs.length === 1) return selectedTagIDs[0];
		return undefined;
	}

	function addMedia(item: ImageEditorMediaItem, replace = replaceMode): void {
		if (editor.backgroundImagePickerActive) {
			editor.setPageBackgroundImage(item.id);
			return;
		}
		const selected = editor.selectedLayers[0];
		if (replace && selected?.image) {
			editor.updateLayer(selected.id, {
				name: item.original_filename || selected.name,
				image: {
					...selected.image,
					media_id: item.id,
					source_width: item.width || selected.image.source_width,
					source_height: item.height || selected.image.source_height,
					crop: { x: 0, y: 0, width: 1, height: 1 }
				}
			});
			replaceMode = false;
			return;
		}
		editor.addImage({
			id: item.id,
			width: item.width,
			height: item.height,
			name: item.original_filename
		});
	}

	function addBrandAsset(asset: NonNullable<ImageEditorBrandKit>['assets'][number]): void {
		if (editor.backgroundImagePickerActive) {
			editor.setPageBackgroundImage(asset.media_id);
			return;
		}
		editor.addImage({ id: asset.media_id, name: asset.name || asset.role });
	}

	function startMediaDrag(
		event: DragEvent,
		payload: ImageEditorMediaDragPayload,
		previewURL: string
	): void {
		if (!event.dataTransfer || !editor.canEdit) return;
		writeImageEditorMediaDrag(event.dataTransfer, payload);
		const preview = document.createElement('div');
		preview.style.cssText =
			'position:fixed;left:-9999px;top:-9999px;display:grid;width:176px;overflow:hidden;border:1px solid rgb(255 255 255 / .22);border-radius:14px;background:#171717;color:white;box-shadow:0 18px 50px rgb(0 0 0 / .4);transform:rotate(2deg);font:600 12px system-ui;';
		const image = document.createElement('img');
		image.src = previewURL;
		image.alt = '';
		image.style.cssText = 'display:block;width:176px;height:112px;object-fit:cover;';
		const label = document.createElement('span');
		label.textContent = m.image_editor_drag_to_place();
		label.style.cssText = 'padding:9px 11px;border-top:1px solid rgb(255 255 255 / .12);';
		preview.append(image, label);
		document.body.append(preview);
		dragPreview = preview;
		event.dataTransfer.setDragImage(preview, 88, 72);
	}

	function finishMediaDrag(): void {
		dragPreview?.remove();
		dragPreview = null;
	}

	async function uploadGuestMedia(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		if (files.length === 0) return;
		loading = true;
		error = '';
		try {
			for (const file of files) {
				const item = await storeGuestImageEditorMedia(editor.id, file);
				media = [item, ...media];
			}
			if (files.length === 1) addMedia(media[0]);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_search_failed();
		} finally {
			loading = false;
			input.value = '';
		}
	}

	function stockProvenance(asset: StockAsset): StockMediaProvenance {
		return {
			provider: asset.provider,
			external_id: asset.external_id,
			source_url: asset.source_url,
			creator_name: asset.creator_name,
			creator_url: asset.creator_url,
			license_name: asset.license_name,
			license_url: asset.license_url,
			attribution_text: asset.attribution_text
		};
	}

	async function addStockMedia(file: File, asset: StockAsset): Promise<void> {
		loading = true;
		error = '';
		try {
			const provenance = stockProvenance(asset);
			if (guestMode) {
				const item = await storeGuestImageEditorMedia(editor.id, file, { provenance });
				media = [item, ...media];
				addMedia(item);
			} else {
				const uploaded = await uploadMediaFile({
					workspaceId: editor.workspaceID,
					file,
					source: 'stock_import',
					stockProvenance: provenance,
					tagId: uploadTagID(),
					prepareVideo: false
				});
				await loadAll();
				const item = media.find((entry) => entry.id === uploaded.id);
				if (item) addMedia(item);
				else editor.addImage({ id: uploaded.id, name: uploaded.original_filename });
			}
			stockOpen = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.video_editor_stock_download_failed();
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
	<div class="flex min-h-10 items-center border-b px-3">
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{m.image_editor_media()}
		</h2>
	</div>
	{#if error}
		<div class="m-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive" role="alert">
			{error}
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		<section class="mb-4">
			<h3 class="mb-2 text-xs font-semibold">{m.image_editor_add()}</h3>
			<div class="grid grid-cols-2 gap-1.5">
				<Button
					variant="outline"
					size="sm"
					class="min-h-11 justify-start"
					onclick={() => editor.addText()}
				>
					<TypeIcon />
					{m.image_editor_text()}
				</Button>
				<Button
					variant="outline"
					size="sm"
					class="min-h-11 justify-start"
					onclick={() => editor.addShape('rectangle')}
				>
					<SquareIcon />
					{m.image_editor_rectangle()}
				</Button>
				<Button
					variant="outline"
					size="sm"
					class="min-h-11 justify-start"
					onclick={() => editor.addShape('rounded_rectangle')}
				>
					<SquareIcon class="rounded-sm" />
					{m.image_editor_rounded_rectangle()}
				</Button>
				<Button
					variant="outline"
					size="sm"
					class="min-h-11 justify-start"
					onclick={() => editor.addShape('ellipse')}
				>
					<CircleIcon />
					{m.image_editor_ellipse()}
				</Button>
				<Button
					variant="outline"
					size="sm"
					class="col-span-2 min-h-11 justify-start"
					onclick={() => editor.addShape('line')}
				>
					<MinusIcon />
					{m.image_editor_line()}
				</Button>
			</div>
		</section>
		{#if !guestMode}
			<div class="mb-2 space-y-2">
				<div class="overflow-x-auto pb-1">
					<MediaTagFilter
						{tags}
						selectedIds={selectedTagIDs}
						untagged={showUntagged}
						onChange={changeTagFilters}
					/>
				</div>
				<AppSelect
					value={sort}
					onValueChange={(value) => {
						sort = value as typeof sort;
						void searchMedia();
					}}
					options={[
						{ value: 'newest', label: m.media_sort_newest() },
						{ value: 'oldest', label: m.media_sort_oldest() },
						{ value: 'name', label: m.media_sort_name() },
						{ value: 'size', label: m.media_sort_size() },
						{ value: 'recently_used', label: m.media_recently_used() }
					]}
					class="h-8 w-full min-w-0 text-xs"
				/>
			</div>
		{/if}
		<form
			class="mb-2 flex gap-1"
			onsubmit={(event) => {
				event.preventDefault();
				void searchMedia();
			}}
		>
			<div class="relative min-w-0 flex-1">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={search}
					class="h-8 pl-7 text-xs"
					placeholder={m.image_editor_search_media()}
				/>
			</div>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="icon-sm"
							type="submit"
							aria-label={m.image_editor_search_media()}
						>
							<SearchIcon />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>{m.image_editor_search_media()}</Tooltip.Content>
			</Tooltip.Root>
		</form>
		<Input
			bind:ref={guestFileInput}
			type="file"
			accept="image/png,image/jpeg,image/webp"
			multiple
			class="sr-only !size-px !p-0"
			onchange={uploadGuestMedia}
		/>
		<Button
			variant="outline"
			size="sm"
			class="mb-2 w-full"
			onclick={() => (guestMode ? guestFileInput?.click() : (pickerOpen = true))}
		>
			<PlusIcon />
			{m.image_editor_upload_camera()}
		</Button>
		<Button
			variant={stockOpen ? 'secondary' : 'outline'}
			size="sm"
			class="mb-3 w-full"
			onclick={() => (stockOpen = !stockOpen)}
		>
			<ImagePlusIcon />
			{stockOpen ? m.common_close() : m.video_editor_stock()}
		</Button>
		{#if stockOpen}
			<div class="mb-4 rounded-lg border bg-card p-2">
				<StockMediaBrowser accept="photo" compact onSelect={addStockMedia} />
			</div>
		{/if}
		{#if editor.backgroundImagePickerActive}
			<div
				class="mb-3 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/8 p-2 text-xs"
			>
				<WallpaperIcon class="size-4 shrink-0 text-primary" />
				<span class="min-w-0 flex-1">{m.image_editor_choose_background_image()}</span>
				<Button
					variant="ghost"
					size="xs"
					onclick={() => (editor.backgroundImagePickerActive = false)}
				>
					{m.common_cancel()}
				</Button>
			</div>
		{/if}
		{#if editor.selectedLayers[0]?.image}
			<Button
				variant={replaceMode ? 'secondary' : 'ghost'}
				size="sm"
				class="mb-3 w-full"
				onclick={() => (replaceMode = !replaceMode)}
			>
				{replaceMode ? m.image_editor_choose_replacement() : m.image_editor_replace_image()}
			</Button>
		{/if}

		{#if loading}
			<div class="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
				<LoaderIcon class="mr-2 size-4 animate-spin" />
				{m.common_loading()}
			</div>
		{:else}
			{#if brand?.assets.length}
				<section class="mb-4">
					<h3 class="mb-2 text-xs font-semibold">{m.image_editor_brand_assets()}</h3>
					<div class="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
						{#each brand.assets as asset (asset.id)}
							<button
								type="button"
								class="group overflow-hidden rounded-md border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								onclick={() => addBrandAsset(asset)}
								draggable={editor.canEdit}
								ondragstart={(event) =>
									startMediaDrag(
										event,
										{ id: asset.media_id, name: asset.name || asset.role },
										getAuthenticatedMediaURL(`/media/${asset.media_id}/thumb/md`)
									)}
								ondragend={finishMediaDrag}
								disabled={!editor.canEdit}
								title={asset.name || asset.role}
							>
								<MediaPreviewImage
									mediaId={asset.media_id}
									alt={asset.name || asset.role}
									class="aspect-square w-full object-contain p-1.5 transition-transform group-hover:scale-[1.03]"
								/>
							</button>
						{/each}
					</div>
				</section>
			{/if}

			<section>
				<h3 class="mb-2 text-xs font-semibold">{m.image_editor_all_media()}</h3>
				{#if media.length > 0}
					<div class="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
						{#each media as item (item.id)}
							<ContextMenu.Root>
								<ContextMenu.Trigger disabled={!editor.canEdit}>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											class="group overflow-hidden rounded-md border bg-muted text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
											onclick={() => addMedia(item)}
											draggable={editor.canEdit}
											ondragstart={(event) =>
												startMediaDrag(
													event,
													{
														id: item.id,
														name: item.original_filename,
														width: item.width,
														height: item.height
													},
													getAuthenticatedMediaURL(item.thumbnail_url || item.url)
												)}
											ondragend={finishMediaDrag}
											disabled={!editor.canEdit}
										>
											<img
												src={getAuthenticatedMediaURL(item.thumbnail_url || item.url)}
												alt={item.alt_text || item.original_filename}
												class="aspect-square w-full object-cover transition-transform group-hover:scale-[1.02]"
												loading="lazy"
											/>
											<span class="block truncate border-t px-1.5 py-1 text-xs"
												>{item.original_filename}</span
											>
										</button>
									{/snippet}
								</ContextMenu.Trigger>
								<ContextMenu.Portal>
									<ContextMenu.Content
										class="z-50 min-w-44 rounded-lg bg-popover/95 p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur outline-none"
									>
										<ContextMenu.Item
											class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
											onclick={() => addMedia(item, false)}
										>
											<ImagePlusIcon class="size-4" />
											{m.image_editor_add_to_canvas()}
										</ContextMenu.Item>
										<ContextMenu.Item
											class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted data-disabled:opacity-50"
											disabled={!editor.selectedLayers[0]?.image}
											onclick={() => addMedia(item, true)}
										>
											<ReplaceIcon class="size-4" />
											{m.image_editor_replace_selected()}
										</ContextMenu.Item>
										<ContextMenu.Item
											class="flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-muted"
											onclick={() => editor.setPageBackgroundImage(item.id)}
										>
											<WallpaperIcon class="size-4" />
											{m.image_editor_set_page_background()}
										</ContextMenu.Item>
									</ContextMenu.Content>
								</ContextMenu.Portal>
							</ContextMenu.Root>
						{/each}
					</div>
				{:else}
					<p class="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
						{m.image_editor_no_media_found()}
					</p>
				{/if}
			</section>
		{/if}
	</div>
</div>

{#if !guestMode}
	<MediaPicker
		bind:open={pickerOpen}
		workspaceId={editor.workspaceID}
		currentSelection={[]}
		accept={['image/*']}
		maxSelection={1}
		multiple={false}
		showCreate={false}
		presentation="sheet"
		desktopSize="compact"
		title={m.image_editor_add_image()}
		onConfirm={async (ids) => {
			const id = ids[0];
			if (!id) return;
			const item = media.find((entry) => entry.id === id);
			if (item) addMedia(item);
			else if (replaceMode && editor.selectedLayers[0]?.image) {
				const selected = editor.selectedLayers[0];
				editor.updateLayer(selected.id, {
					image: {
						...selected.image!,
						media_id: id,
						crop: { x: 0, y: 0, width: 1, height: 1 }
					}
				});
				replaceMode = false;
			} else editor.addImage({ id });
			await loadAll();
		}}
	/>
{/if}
