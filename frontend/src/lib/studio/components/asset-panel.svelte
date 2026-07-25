<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useStudioEditor } from '../editor.svelte';
	import {
		instantiateStudioTemplate,
		listStudioMedia,
		listStudioTemplates,
		loadStudioBrandKit
	} from '../api';
	import { loadStudioBrandFonts } from '../fonts';
	import type {
		StudioBrandKit,
		StudioBrandTextStyle,
		StudioMediaItem,
		StudioTemplate
	} from '../types';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import MediaPicker from '$lib/components/media-picker.svelte';
	import TemplatePreview from './template-preview.svelte';
	import SearchIcon from 'lucide-svelte/icons/search';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';

	const editor = useStudioEditor();
	let media = $state<StudioMediaItem[]>([]);
	let templates = $state<StudioTemplate[]>([]);
	let brand = $state<StudioBrandKit | null>(null);
	let loading = $state(false);
	let error = $state('');
	let search = $state('');
	let pickerOpen = $state(false);
	let replaceMode = $state(false);
	onMount(() => {
		if (editor.workspaceID) void loadAll();
	});

	async function loadAll(): Promise<void> {
		loading = true;
		error = '';
		try {
			const [nextMedia, nextTemplates, nextBrand] = await Promise.all([
				listStudioMedia(editor.workspaceID),
				listStudioTemplates(editor.workspaceID),
				loadStudioBrandKit(editor.workspaceID)
			]);
			media = nextMedia;
			templates = nextTemplates;
			brand = nextBrand;
			await loadStudioBrandFonts(nextBrand);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.studio_load_assets_failed();
		} finally {
			loading = false;
		}
	}

	async function searchMedia(): Promise<void> {
		loading = true;
		try {
			media = await listStudioMedia(editor.workspaceID, search);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.studio_search_failed();
		} finally {
			loading = false;
		}
	}

	function addMedia(item: StudioMediaItem): void {
		const selected = editor.selectedLayers[0];
		if (replaceMode && selected?.image) {
			editor.updateLayer(selected.id, {
				name: item.original_filename || selected.name,
				image: {
					...selected.image,
					media_id: item.id,
					source_width: item.width || selected.image.source_width,
					source_height: item.height || selected.image.source_height
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

	async function useTemplate(template: StudioTemplate): Promise<void> {
		if (!editor.canEdit) return;
		loading = true;
		error = '';
		try {
			const design = await instantiateStudioTemplate(template.id, editor.workspaceID);
			await goto(resolve(`/studio/${design.id}` as '/'));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.studio_template_use_failed();
		} finally {
			loading = false;
		}
	}

	function applyBrandColor(value: string): void {
		const selected = editor.selectedLayers[0];
		if (!selected) {
			editor.mutate('Apply brand background', (document) => {
				const page = document.pages.find((item) => item.id === editor.activePageID);
				if (page) page.background_color = value;
			});
			return;
		}
		if (selected.text) {
			editor.updateLayer(selected.id, { text: { ...selected.text, color: value } });
		}
		if (selected.shape) {
			editor.updateLayer(selected.id, { shape: { ...selected.shape, fill: value } });
		}
	}

	function applyBrandTextStyle(style: StudioBrandTextStyle): void {
		let selected = editor.selectedLayers[0];
		if (!selected?.text) {
			editor.addText();
			selected = editor.selectedLayers[0];
		}
		if (!selected?.text) return;
		const font = brand?.fonts.find((item) => item.media_id === style.font_asset_id);
		editor.updateLayer(selected.id, {
			text: {
				...selected.text,
				font_family: font?.css_family || style.font_family,
				font_asset_id: style.font_asset_id,
				font_weight: style.font_weight,
				font_style: style.font_style as 'normal' | 'italic',
				font_size: style.font_size,
				color: style.color,
				line_height: style.line_height,
				letter_spacing: style.letter_spacing
			}
		});
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="grid grid-cols-3 border-b p-1">
		{#each [['media', m.studio_media()], ['templates', m.studio_templates()], ['brand', m.studio_brand()]] as [value, label] (value)}
			<button
				type="button"
				class="min-h-9 rounded-md px-2 text-xs font-medium {editor.leftPanel === value
					? 'bg-muted text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (editor.leftPanel = value as 'media' | 'templates' | 'brand')}
			>
				{label}
			</button>
		{/each}
	</div>
	{#if error}
		<div class="m-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive" role="alert">
			{error}
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-y-auto p-2">
		{#if loading}
			<div class="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
				<LoaderIcon class="mr-2 size-4 animate-spin" />
				{m.common_loading()}
			</div>
		{:else if editor.leftPanel === 'media'}
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
						placeholder={m.studio_search_media()}
					/>
				</div>
				<Button variant="outline" size="icon-sm" type="submit" aria-label={m.studio_search_media()}>
					<SearchIcon />
				</Button>
			</form>
			<Button variant="outline" size="sm" class="mb-2 w-full" onclick={() => (pickerOpen = true)}>
				<PlusIcon />
				{m.studio_upload_camera()}
			</Button>
			{#if editor.selectedLayers[0]?.image}
				<Button
					variant={replaceMode ? 'secondary' : 'ghost'}
					size="sm"
					class="mb-2 w-full"
					onclick={() => (replaceMode = !replaceMode)}
				>
					{replaceMode ? m.studio_choose_replacement() : m.studio_replace_image()}
				</Button>
			{/if}
			<div class="grid grid-cols-2 gap-2">
				{#each media as item (item.id)}
					<button
						type="button"
						class="group overflow-hidden rounded-md border bg-muted text-left"
						onclick={() => addMedia(item)}
						disabled={!editor.canEdit}
					>
						<img
							src={getAuthenticatedMediaURL(item.thumbnail_url || item.url)}
							alt={item.alt_text || item.original_filename}
							class="aspect-square w-full object-cover"
							loading="lazy"
						/>
						<span class="block truncate border-t px-1.5 py-1 text-xs">{item.original_filename}</span
						>
					</button>
				{/each}
			</div>
		{:else if editor.leftPanel === 'templates'}
			<div class="space-y-2">
				{#each templates as template (template.id)}
					<button
						type="button"
						class="w-full rounded-lg border bg-card p-2 text-left hover:bg-muted"
						onclick={() => useTemplate(template)}
						disabled={!editor.canEdit}
					>
						<div class="mb-2 aspect-[4/3] overflow-hidden rounded-md border">
							<TemplatePreview document={template.document} label={template.name} />
						</div>
						<div class="truncate text-xs font-medium">{template.name}</div>
						<div class="truncate text-xs text-muted-foreground">{template.category}</div>
					</button>
				{/each}
			</div>
		{:else if editor.leftPanel === 'brand'}
			{#if brand}
				<div class="space-y-5">
					<section>
						<h3 class="mb-2 text-xs font-semibold">{m.studio_colors()}</h3>
						<div class="grid grid-cols-2 gap-2">
							{#each brand.colors as color (color.name)}
								<button
									type="button"
									class="overflow-hidden rounded-md border text-left"
									onclick={() => applyBrandColor(color.value)}
									disabled={!editor.canEdit}
								>
									<span class="block h-10" style:background={color.value}></span>
									<span class="block truncate px-1.5 py-1 text-xs">{color.name}</span>
								</button>
							{/each}
						</div>
					</section>
					<section>
						<h3 class="mb-2 text-xs font-semibold">{m.studio_logos_marks()}</h3>
						<div class="grid grid-cols-2 gap-2">
							{#each brand.assets as asset (asset.id)}
								<button
									type="button"
									class="overflow-hidden rounded-md border bg-muted"
									onclick={() =>
										editor.addImage({ id: asset.media_id, name: asset.name || asset.role })}
									disabled={!editor.canEdit}
								>
									<img
										src={getAuthenticatedMediaURL(`/media/${asset.media_id}/thumb/md`)}
										alt={asset.name || asset.role}
										class="aspect-square w-full object-contain p-2"
									/>
								</button>
							{/each}
						</div>
					</section>
					{#if brand.text_styles.length > 0}
						<section>
							<h3 class="mb-2 text-xs font-semibold">{m.studio_text_styles()}</h3>
							<div class="space-y-2">
								{#each brand.text_styles as style (style.name)}
									<button
										type="button"
										class="w-full rounded-md border p-2 text-left hover:bg-muted"
										onclick={() => applyBrandTextStyle(style)}
										disabled={!editor.canEdit}
									>
										<span class="block truncate text-xs font-medium">{style.name}</span>
										<span class="block truncate text-xs text-muted-foreground">
											{style.font_family} · {style.font_weight} · {style.font_size}px
										</span>
									</button>
								{/each}
							</div>
						</section>
					{/if}
					{#if brand.fonts.length > 0}
						<section>
							<h3 class="mb-2 text-xs font-semibold">{m.studio_fonts()}</h3>
							<div class="space-y-1">
								{#each brand.fonts as font (font.id)}
									<div class="rounded-md border px-2 py-1.5">
										<p
											class="truncate text-sm"
											style:font-family={font.css_family || font.family}
											style:font-weight={font.weight}
											style:font-style={font.style}
										>
											{font.family}
										</p>
										<p class="text-xs text-muted-foreground">{font.weight} · {font.style}</p>
									</div>
								{/each}
							</div>
						</section>
					{/if}
					{#if brand.colors.length === 0 && brand.assets.length === 0 && brand.fonts.length === 0 && brand.text_styles.length === 0}
						<p class="text-sm text-muted-foreground">
							{m.studio_brand_empty()}
						</p>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
</div>

<MediaPicker
	bind:open={pickerOpen}
	workspaceId={editor.workspaceID}
	currentSelection={[]}
	accept={['image/*']}
	maxSelection={1}
	multiple={false}
	showCreate={false}
	title={m.studio_add_image()}
	onConfirm={async (ids) => {
		const id = ids[0];
		if (!id) return;
		const item = media.find((entry) => entry.id === id);
		if (item) addMedia(item);
		else if (replaceMode && editor.selectedLayers[0]?.image) {
			const selected = editor.selectedLayers[0];
			editor.updateLayer(selected.id, {
				image: { ...selected.image!, media_id: id }
			});
			replaceMode = false;
		} else editor.addImage({ id });
		await loadAll();
	}}
/>
