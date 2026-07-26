<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { saveStudioBrandKit } from '../api';
	import StudioColorPicker from './studio-color-picker.svelte';
	import type {
		StudioBrandAsset,
		StudioBrandColor,
		StudioBrandFont,
		StudioBrandKit,
		StudioBrandTextStyle
	} from '../types';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import UploadIcon from 'lucide-svelte/icons/upload';
	import PaletteIcon from 'lucide-svelte/icons/palette';
	import ImageIcon from 'lucide-svelte/icons/image';
	import TypeIcon from 'lucide-svelte/icons/type';
	import { m } from '$lib/paraglide/messages';

	interface EditableBackground {
		id: string;
		value: string;
	}

	let {
		kit,
		onSaved
	}: {
		kit: StudioBrandKit;
		onSaved: (kit: StudioBrandKit) => void;
	} = $props();

	let initialized = false;
	let name = $state('');
	let colors = $state.raw<StudioBrandColor[]>([]);
	let backgrounds = $state.raw<EditableBackground[]>([]);
	let textStyles = $state.raw<StudioBrandTextStyle[]>([]);
	let assets = $state.raw<StudioBrandAsset[]>([]);
	let fonts = $state.raw<StudioBrandFont[]>([]);
	let saving = $state(false);
	let uploadingAsset = $state(false);
	let uploadingFont = $state(false);
	let error = $state('');
	let success = $state('');
	let fontFamily = $state('');
	let fontWeight = $state(400);
	let fontStyle = $state<'normal' | 'italic'>('normal');
	let fontLicenseAcknowledged = $state(false);

	function initializeEditor() {
		if (initialized) return;
		initialized = true;
		name = kit.name || m.brand_default_name();
		colors = structuredClone($state.snapshot(kit.colors)).map((color) => ({
			...color,
			id: color.id || crypto.randomUUID()
		}));
		backgrounds = kit.backgrounds.map((value) => ({ id: crypto.randomUUID(), value }));
		textStyles = structuredClone($state.snapshot(kit.text_styles)).map((style) => ({
			...style,
			id: style.id || crypto.randomUUID()
		}));
		assets = structuredClone($state.snapshot(kit.assets));
		fonts = structuredClone($state.snapshot(kit.fonts));
	}

	function updateColor(index: number, field: 'name' | 'value', value: string) {
		colors = colors.map((color, itemIndex) =>
			itemIndex === index ? { ...color, [field]: value } : color
		);
	}

	function updateBackground(index: number, value: string) {
		backgrounds = backgrounds.map((background, itemIndex) =>
			itemIndex === index ? { ...background, value } : background
		);
	}

	function updateTextStyle(
		index: number,
		field: keyof StudioBrandTextStyle,
		value: string | number
	) {
		textStyles = textStyles.map((style, itemIndex) =>
			itemIndex === index ? { ...style, [field]: value } : style
		);
	}

	function addTextStyle() {
		textStyles = [
			...textStyles,
			{
				id: crypto.randomUUID(),
				name: m.brand_text_style_default({ number: textStyles.length + 1 }),
				font_family: fonts[0]?.family || 'Geist Variable',
				font_asset_id: fonts[0]?.media_id,
				font_weight: 700,
				font_style: 'normal',
				font_size: 64,
				color: colors[0]?.value || '#171717',
				line_height: 1.1,
				letter_spacing: 0
			}
		];
	}

	async function uploadBrandAsset(file: File | undefined) {
		if (!file) return;
		uploadingAsset = true;
		error = '';
		try {
			const uploaded = await uploadMediaFile({
				workspaceId: kit.workspace_id,
				file,
				source: 'upload',
				assetKind: 'brand_asset'
			});
			assets = [
				...assets,
				{
					id: crypto.randomUUID(),
					media_id: uploaded.id,
					role: assets.length === 0 ? 'primary_logo' : 'secondary_logo',
					name: file.name.replace(/\.[^.]+$/, '')
				}
			];
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.brand_asset_upload_failed();
		} finally {
			uploadingAsset = false;
		}
	}

	async function uploadBrandFont(file: File | undefined) {
		if (!file) return;
		if (!fontFamily.trim()) {
			error = m.brand_font_family_required();
			return;
		}
		if (!fontLicenseAcknowledged) {
			error = m.brand_font_license_required();
			return;
		}
		uploadingFont = true;
		error = '';
		let objectURL = '';
		try {
			objectURL = URL.createObjectURL(file);
			const previewFamily = `OpenPostFontCheck-${crypto.randomUUID()}`;
			const face = new FontFace(previewFamily, `url("${objectURL}") format("woff2")`, {
				weight: String(fontWeight),
				style: fontStyle
			});
			await face.load();
			const uploaded = await uploadMediaFile({
				workspaceId: kit.workspace_id,
				file: new File([file], file.name, { type: 'font/woff2' }),
				source: 'upload',
				assetKind: 'brand_font'
			});
			fonts = [
				...fonts,
				{
					id: crypto.randomUUID(),
					media_id: uploaded.id,
					family: fontFamily.trim(),
					weight: fontWeight,
					style: fontStyle,
					license_acknowledged: true
				}
			];
			fontFamily = '';
			fontLicenseAcknowledged = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.brand_font_upload_failed();
		} finally {
			if (objectURL) URL.revokeObjectURL(objectURL);
			uploadingFont = false;
		}
	}

	async function save() {
		saving = true;
		error = '';
		success = '';
		try {
			const saved = await saveStudioBrandKit({
				workspace_id: kit.workspace_id,
				name,
				colors,
				text_styles: textStyles,
				backgrounds: backgrounds.map((background) => background.value),
				assets,
				fonts
			});
			onSaved(saved);
			success = m.brand_saved();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.brand_save_failed();
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-10" {@attach initializeEditor}>
	<header
		class="sticky top-0 z-20 -mx-1 flex items-end gap-3 border-b bg-background/95 px-1 pb-4 backdrop-blur-sm"
	>
		<label class="min-w-0 flex-1 text-sm font-medium">
			<span class="mb-1.5 block text-muted-foreground">{m.brand_kit_name()}</span>
			<Input bind:value={name} maxlength={120} class="h-11 text-base font-semibold" />
		</label>
		<Button class="min-h-11 shrink-0" onclick={save} disabled={saving || !kit.can_edit}>
			{#if saving}<LoaderIcon class="animate-spin" />{/if}
			<span class="hidden sm:inline">{m.brand_save_kit()}</span>
			<span class="sm:hidden">{m.common_save()}</span>
		</Button>
	</header>
	{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	{#if success}<p class="text-sm text-emerald-700 dark:text-emerald-300" role="status">
			{success}
		</p>{/if}

	<div class="grid gap-10 lg:grid-cols-2 lg:gap-x-12">
		<section class="space-y-5">
			<div class="flex items-start gap-3">
				<div
					class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
				>
					<PaletteIcon class="size-5" />
				</div>
				<div>
					<h2 class="font-semibold">{m.brand_colors_backgrounds()}</h2>
					<p class="mt-1 text-sm text-muted-foreground">{m.brand_description()}</p>
				</div>
			</div>
			<div class="space-y-3">
				{#each colors as color, index (color.id)}
					<div
						class="grid grid-cols-[minmax(0,1fr)_3rem] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_3rem]"
					>
						<label class="grid gap-1 text-xs font-medium">
							<span class="sr-only">{m.brand_color_name()}</span>
							<Input
								class="min-h-11"
								value={color.name}
								placeholder={m.brand_color_name()}
								oninput={(event) => updateColor(index, 'name', event.currentTarget.value)}
							/>
						</label>
						<div class="col-start-1 sm:col-start-2 sm:row-start-1 sm:pt-1">
							<StudioColorPicker
								label={m.brand_choose_color({ name: color.name || m.studio_brand() })}
								value={color.value}
								brandColors={colors}
								onChange={(value) => updateColor(index, 'value', value)}
							/>
						</div>
						<Button
							variant="ghost"
							size="icon"
							class="col-start-2 row-start-1 size-11 sm:col-start-3"
							aria-label={m.brand_remove_color()}
							onclick={() => (colors = colors.filter((_, itemIndex) => itemIndex !== index))}
						>
							<TrashIcon />
						</Button>
					</div>
				{/each}
				<Button
					variant="outline"
					size="sm"
					class="min-h-11"
					onclick={() =>
						(colors = [
							...colors,
							{ id: crypto.randomUUID(), name: m.brand_new_color(), value: '#f97316' }
						])}
				>
					<PlusIcon />
					{m.brand_add_color()}
				</Button>
			</div>
			<div class="space-y-3 border-t pt-5">
				<div>
					<h3 class="text-sm font-medium">{m.brand_page_backgrounds()}</h3>
					<p class="mt-1 text-xs text-muted-foreground">{m.brand_backgrounds_body()}</p>
				</div>
				{#each backgrounds as background, index (background.id)}
					<div class="grid grid-cols-[minmax(0,1fr)_3rem] gap-2">
						<StudioColorPicker
							label={m.brand_choose_background()}
							value={background.value}
							brandColors={colors}
							onChange={(value) => updateBackground(index, value)}
						/>
						<Button
							variant="ghost"
							size="icon"
							class="size-11"
							aria-label={m.brand_remove_background()}
							onclick={() =>
								(backgrounds = backgrounds.filter((_, itemIndex) => itemIndex !== index))}
						>
							<TrashIcon />
						</Button>
					</div>
				{/each}
				<Button
					variant="outline"
					size="sm"
					class="min-h-11"
					onclick={() =>
						(backgrounds = [...backgrounds, { id: crypto.randomUUID(), value: '#ffffff' }])}
				>
					<PlusIcon />
					{m.brand_add_background()}
				</Button>
			</div>
		</section>

		<section class="space-y-5">
			<div class="flex items-start gap-3">
				<div
					class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
				>
					<ImageIcon class="size-5" />
				</div>
				<div>
					<h2 class="font-semibold">{m.brand_assets()}</h2>
					<p class="mt-1 text-sm text-muted-foreground">{m.brand_assets_description()}</p>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{#each assets as asset, index (asset.id)}
					<div class="min-w-0 overflow-hidden rounded-xl border">
						<div class="flex aspect-square items-center justify-center bg-muted/30 p-3">
							<img
								src={getAuthenticatedMediaURL(`/media/${asset.media_id}/thumb/md`)}
								alt={asset.name || asset.role}
								class="max-h-full max-w-full object-contain"
							/>
						</div>
						<div class="space-y-2 border-t p-2">
							<Input
								class="min-h-11"
								value={asset.name}
								placeholder={m.brand_asset_name()}
								aria-label={m.brand_asset_name()}
								oninput={(event) =>
									(assets = assets.map((item, itemIndex) =>
										itemIndex === index ? { ...item, name: event.currentTarget.value } : item
									))}
							/>
							<div class="flex gap-1">
								<select
									class="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
									value={asset.role}
									aria-label={m.brand_asset_role()}
									onchange={(event) =>
										(assets = assets.map((item, itemIndex) =>
											itemIndex === index
												? {
														...item,
														role: event.currentTarget.value as StudioBrandAsset['role']
													}
												: item
										))}
								>
									<option value="primary_logo">{m.brand_primary_logo()}</option>
									<option value="secondary_logo">{m.brand_secondary_logo()}</option>
									<option value="mark">{m.brand_mark()}</option>
									<option value="watermark">{m.brand_watermark()}</option>
								</select>
								<Button
									variant="ghost"
									size="icon"
									class="size-11"
									aria-label={m.brand_remove_asset()}
									onclick={() => (assets = assets.filter((_, itemIndex) => itemIndex !== index))}
								>
									<TrashIcon />
								</Button>
							</div>
						</div>
					</div>
				{/each}
				<label
					class="flex aspect-square min-h-32 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center text-sm font-medium hover:bg-muted/40"
				>
					{#if uploadingAsset}
						<LoaderIcon class="mb-2 animate-spin" />
					{:else}
						<UploadIcon class="mb-2" />
					{/if}
					{m.brand_upload_asset()}
					<input
						type="file"
						class="sr-only"
						accept="image/png,image/jpeg,image/webp,image/avif"
						disabled={uploadingAsset}
						onchange={(event) => uploadBrandAsset(event.currentTarget.files?.[0])}
					/>
				</label>
			</div>
		</section>
	</div>

	<section class="space-y-5 border-t pt-8">
		<div class="flex items-start gap-3">
			<div
				class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
			>
				<TypeIcon class="size-5" />
			</div>
			<div>
				<h2 class="font-semibold">{m.brand_fonts()}</h2>
				<p class="mt-1 text-sm text-muted-foreground">{m.brand_fonts_description()}</p>
			</div>
		</div>
		{#if fonts.length > 0}
			<div class="divide-y rounded-xl border">
				{#each fonts as font, index (font.id)}
					<div class="flex min-h-16 items-center justify-between gap-3 px-3 py-2">
						<div class="min-w-0">
							<p class="truncate text-base font-semibold">{font.family}</p>
							<p class="text-xs text-muted-foreground">{font.weight} · {font.style}</p>
						</div>
						<Button
							variant="ghost"
							size="icon"
							class="size-11"
							aria-label={m.brand_remove_font()}
							onclick={() => (fonts = fonts.filter((_, itemIndex) => itemIndex !== index))}
						>
							<TrashIcon />
						</Button>
					</div>
				{/each}
			</div>
		{/if}
		<details class="rounded-xl border">
			<summary class="flex min-h-12 cursor-pointer items-center gap-2 px-3 text-sm font-medium">
				<PlusIcon class="size-4" />
				{m.brand_add_font()}
			</summary>
			<div class="space-y-4 border-t p-3">
				<div class="grid gap-3 sm:grid-cols-3">
					<label class="grid gap-1.5 text-sm font-medium">
						<span>{m.brand_family_name()}</span>
						<Input class="min-h-11" bind:value={fontFamily} />
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						<span>{m.brand_font_weight()}</span>
						<select
							class="h-11 rounded-md border border-input bg-background px-2 text-sm"
							bind:value={fontWeight}
						>
							<option value={300}>300</option>
							<option value={400}>400</option>
							<option value={500}>500</option>
							<option value={600}>600</option>
							<option value={700}>700</option>
							<option value={800}>800</option>
						</select>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						<span>{m.brand_font_style()}</span>
						<select
							class="h-11 rounded-md border border-input bg-background px-2 text-sm"
							bind:value={fontStyle}
						>
							<option value="normal">{m.studio_normal()}</option>
							<option value="italic">{m.studio_italic()}</option>
						</select>
					</label>
				</div>
				<label class="flex items-start gap-2 text-sm">
					<Checkbox bind:checked={fontLicenseAcknowledged} />
					<span>{m.brand_license_ack()}</span>
				</label>
				<label
					class="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border px-3 text-sm font-medium"
				>
					{#if uploadingFont}
						<LoaderIcon class="mr-2 animate-spin" />
					{:else}
						<UploadIcon class="mr-2" />
					{/if}
					{m.brand_upload_woff2()}
					<input
						type="file"
						class="sr-only"
						accept=".woff2,font/woff2"
						disabled={uploadingFont}
						onchange={(event) => uploadBrandFont(event.currentTarget.files?.[0])}
					/>
				</label>
			</div>
		</details>
	</section>

	<section class="space-y-4 border-t pt-8">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="font-semibold">{m.studio_text_styles()}</h2>
				<p class="mt-1 text-sm text-muted-foreground">{m.brand_styles_description()}</p>
			</div>
			<Button variant="outline" size="sm" class="min-h-11" onclick={addTextStyle}
				><PlusIcon /> {m.brand_add_style()}</Button
			>
		</div>
		{#each textStyles as style, index (style.id)}
			<details class="rounded-xl border">
				<summary class="cursor-pointer px-4 py-3">
					<p class="text-xs font-medium text-muted-foreground">{style.name}</p>
					<p
						class="mt-2 line-clamp-1"
						style:font-family={style.font_family}
						style:font-weight={style.font_weight}
						style:font-size={`${Math.min(28, Math.max(18, style.font_size / 2.5))}px`}
						style:color={style.color}
					>
						{m.brand_style_preview()}
					</p>
				</summary>
				<div class="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-5">
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.brand_style_name()}</span>
						<Input
							class="min-h-11"
							value={style.name}
							oninput={(event) => updateTextStyle(index, 'name', event.currentTarget.value)}
						/>
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.studio_font_family()}</span>
						<Input
							class="min-h-11"
							value={style.font_family}
							oninput={(event) => updateTextStyle(index, 'font_family', event.currentTarget.value)}
						/>
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.brand_font_weight()}</span>
						<Input
							class="min-h-11"
							type="number"
							min="100"
							max="900"
							step="100"
							value={style.font_weight}
							oninput={(event) =>
								updateTextStyle(index, 'font_weight', event.currentTarget.valueAsNumber)}
						/>
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.brand_font_size()}</span>
						<Input
							class="min-h-11"
							type="number"
							min="6"
							max="512"
							value={style.font_size}
							oninput={(event) =>
								updateTextStyle(index, 'font_size', event.currentTarget.valueAsNumber)}
						/>
					</label>
					<label class="grid gap-1 text-xs font-medium">
						<span>{m.brand_color_value()}</span>
						<Input
							class="min-h-11"
							value={style.color}
							oninput={(event) => updateTextStyle(index, 'color', event.currentTarget.value)}
						/>
					</label>
					<Button
						variant="ghost"
						class="min-h-11 justify-start text-destructive lg:col-span-5"
						onclick={() => (textStyles = textStyles.filter((_, itemIndex) => itemIndex !== index))}
					>
						<TrashIcon />
						{m.brand_remove()}
					</Button>
				</div>
			</details>
		{/each}
	</section>
</div>
