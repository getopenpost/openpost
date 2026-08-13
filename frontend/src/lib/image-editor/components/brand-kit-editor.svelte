<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { saveImageEditorBrandKit } from '../api';
	import { loadImageEditorBrandFontsWithReport } from '../fonts';
	import ImageEditorColorPicker from './image-editor-color-picker.svelte';
	import ImageEditorFontPicker from './image-editor-font-picker.svelte';
	import type {
		ImageEditorBrandColor,
		ImageEditorBrandFont,
		ImageEditorBrandKit,
		ImageEditorBrandTextStyle
	} from '../types';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import TypeIcon from '@lucide/svelte/icons/type';
	import { m } from '$lib/paraglide/messages';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';

	interface EditableBackground {
		id: string;
		value: string;
	}

	let {
		kit,
		onSaved
	}: {
		kit: ImageEditorBrandKit;
		onSaved: (kit: ImageEditorBrandKit) => void;
	} = $props();

	let initialized = false;
	let name = $state('');
	let colors = $state.raw<ImageEditorBrandColor[]>([]);
	let backgrounds = $state.raw<EditableBackground[]>([]);
	let textStyles = $state.raw<ImageEditorBrandTextStyle[]>([]);
	let fonts = $state.raw<ImageEditorBrandFont[]>([]);
	let saving = $state(false);
	let uploadingFont = $state(false);
	let error = $state('');
	let success = $state('');
	let fontFamily = $state('');
	let fontWeight = $state(400);
	let fontStyle = $state<'normal' | 'italic'>('normal');
	let fontLicenseAcknowledged = $state(false);
	let savedSnapshot = $state('');
	const failedFontIDs = new SvelteSet<string>();
	const unsavedChanges = getOptionalUnsavedChanges();
	const editorSnapshot = $derived(JSON.stringify({ name, colors, backgrounds, textStyles, fonts }));
	const dirty = $derived(Boolean(savedSnapshot) && editorSnapshot !== savedSnapshot);

	function initializeEditor() {
		if (initialized) return;
		initialized = true;
		name = kit.name || m.brand_default_name();
		colors = structuredClone($state.snapshot(kit.colors)).map((color) => ({
			...color,
			id: color.id || crypto.randomUUID()
		}));
		backgrounds = kit.backgrounds.map((value) => ({ id: crypto.randomUUID(), value }));
		fonts = structuredClone($state.snapshot(kit.fonts));
		textStyles = structuredClone($state.snapshot(kit.text_styles)).map((style) => ({
			...style,
			id: style.id || crypto.randomUUID(),
			font_family:
				fonts.find((font) => font.media_id === style.font_asset_id)?.css_family || style.font_family
		}));
		savedSnapshot = JSON.stringify({ name, colors, backgrounds, textStyles, fonts });
		void refreshFontAvailability();
	}

	async function refreshFontAvailability(): Promise<void> {
		const report = await loadImageEditorBrandFontsWithReport({ ...kit, fonts });
		failedFontIDs.clear();
		for (const failure of report.failed) failedFontIDs.add(failure.mediaID);
	}

	$effect(() => {
		unsavedChanges?.set('brand-kit', dirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('brand-kit');
	});

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
		field: keyof ImageEditorBrandTextStyle,
		value: string | number | undefined
	) {
		textStyles = textStyles.map((style, itemIndex) =>
			itemIndex === index ? { ...style, [field]: value } : style
		);
	}

	function updateTextStyleFont(
		index: number,
		font: {
			family: string;
			assetID?: string;
			weight?: number;
			style?: 'normal' | 'italic';
		}
	) {
		textStyles = textStyles.map((textStyle, itemIndex) =>
			itemIndex === index
				? {
						...textStyle,
						font_family: font.family,
						font_asset_id: font.assetID,
						font_weight: font.weight ?? textStyle.font_weight,
						font_style: font.style ?? textStyle.font_style
					}
				: textStyle
		);
	}

	function addTextStyle() {
		textStyles = [
			...textStyles,
			{
				id: crypto.randomUUID(),
				name: m.brand_text_style_default({ number: textStyles.length + 1 }),
				font_family: fonts[0]?.css_family || fonts[0]?.family || 'Geist Variable',
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

	function brandFontFileMetadata(filename: string): { mimeType: string; format: string } {
		switch (filename.toLowerCase().split('.').pop()) {
			case 'ttf':
				return { mimeType: 'font/ttf', format: 'truetype' };
			case 'otf':
				return { mimeType: 'font/otf', format: 'opentype' };
			default:
				return { mimeType: 'font/woff2', format: 'woff2' };
		}
	}

	function brandFontCSSFamily(mediaID: string): string {
		return `OpenPostBrand_${mediaID.replaceAll('-', '')}`;
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
			const fileMetadata = brandFontFileMetadata(file.name);
			objectURL = URL.createObjectURL(file);
			const previewFamily = `OpenPostFontCheck-${crypto.randomUUID()}`;
			const face = new FontFace(
				previewFamily,
				`url("${objectURL}") format("${fileMetadata.format}")`,
				{
					weight: String(fontWeight),
					style: fontStyle
				}
			);
			await face.load();
			const uploaded = await uploadMediaFile({
				workspaceId: kit.workspace_id,
				file: new File([file], file.name, {
					type: fileMetadata.mimeType,
					lastModified: file.lastModified
				}),
				source: 'upload',
				assetKind: 'brand_font'
			});
			const cssFamily = brandFontCSSFamily(uploaded.id);
			const uploadedFace = new FontFace(
				cssFamily,
				`url("${objectURL}") format("${fileMetadata.format}")`,
				{
					weight: String(fontWeight),
					style: fontStyle
				}
			);
			await uploadedFace.load();
			document.fonts.add(uploadedFace);
			fonts = [
				...fonts,
				{
					id: crypto.randomUUID(),
					media_id: uploaded.id,
					family: fontFamily.trim(),
					css_family: cssFamily,
					weight: fontWeight,
					style: fontStyle,
					license_acknowledged: true
				}
			];
			failedFontIDs.delete(uploaded.id);
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
			const saved = await saveImageEditorBrandKit({
				workspace_id: kit.workspace_id,
				name,
				colors,
				text_styles: textStyles,
				backgrounds: backgrounds.map((background) => background.value),
				fonts
			});
			onSaved(saved);
			savedSnapshot = editorSnapshot;
			success = m.brand_saved();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.brand_save_failed();
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-10" {@attach initializeEditor}>
	{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
	{#if success}<p class="text-sm text-emerald-700 dark:text-emerald-300" role="status">
			{success}
		</p>{/if}

	<div class="grid gap-10">
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
							<ImageEditorColorPicker
								label={m.brand_choose_color({ name: color.name || m.image_editor_brand() })}
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
						<ImageEditorColorPicker
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
							{#if failedFontIDs.has(font.media_id)}
								<p class="mt-1 text-xs text-amber-700 dark:text-amber-300" role="alert">
									{m.brand_font_missing_recovery()}
								</p>
								<Button variant="outline" size="xs" class="mt-2" onclick={refreshFontAvailability}>
									{m.common_retry()}
								</Button>
							{/if}
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
						<AppSelect
							value={String(fontWeight)}
							onValueChange={(value) => (fontWeight = Number(value))}
							options={[300, 400, 500, 600, 700, 800].map((weight) => ({
								value: String(weight),
								label: String(weight)
							}))}
							class="h-11 w-full"
						/>
					</label>
					<label class="grid gap-1.5 text-sm font-medium">
						<span>{m.brand_font_style()}</span>
						<AppSelect
							value={fontStyle}
							onValueChange={(value) => (fontStyle = value as 'normal' | 'italic')}
							options={[
								{ value: 'normal', label: m.image_editor_normal() },
								{ value: 'italic', label: m.image_editor_italic() }
							]}
							class="h-11 w-full"
						/>
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
					{m.brand_upload_font()}
					<Input
						type="file"
						class="sr-only !size-px !p-0"
						accept=".woff2,.ttf,.otf,font/woff2,font/ttf,font/otf"
						disabled={uploadingFont}
						onchange={(event) => uploadBrandFont(event.currentTarget.files?.[0])}
					/>
				</label>
			</div>
		</details>
	</section>

	<section class="space-y-4 border-t pt-8">
		<div class="flex flex-col items-start justify-between gap-3 sm:flex-row">
			<div>
				<h2 class="font-semibold">{m.image_editor_text_styles()}</h2>
				<p class="mt-1 text-sm text-muted-foreground">{m.brand_styles_description()}</p>
			</div>
			<Button variant="outline" size="sm" class="min-h-11 w-full sm:w-auto" onclick={addTextStyle}
				><PlusIcon /> {m.brand_add_style()}</Button
			>
		</div>
		{#each textStyles as style, index (style.id)}
			<details class="rounded-xl border">
				<summary class="cursor-pointer px-4 py-3">
					<p class="text-xs font-medium text-muted-foreground">{style.name}</p>
					<p
						class="mt-2 line-clamp-1"
						style:font-family={fonts.find((font) => font.media_id === style.font_asset_id)
							?.css_family || style.font_family}
						style:font-weight={style.font_weight}
						style:font-style={style.font_style}
						style:font-size={`${Math.min(28, Math.max(18, style.font_size / 2.5))}px`}
						style:color={style.color}
					>
						{m.brand_style_preview()}
					</p>
				</summary>
				<div class="space-y-4 border-t p-4">
					{#if style.font_asset_id && !fonts.some((font) => font.media_id === style.font_asset_id)}
						<div
							class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
							role="alert"
						>
							<p>{m.brand_style_font_missing()}</p>
							<Button
								variant="outline"
								size="xs"
								class="mt-2"
								onclick={() => {
									updateTextStyle(index, 'font_asset_id', undefined);
									updateTextStyle(index, 'font_family', 'Geist Variable');
								}}
							>
								{m.brand_repair_with_fallback()}
							</Button>
						</div>
					{/if}
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<label class="grid gap-1 text-xs font-medium">
							<span>{m.brand_style_name()}</span>
							<Input
								class="min-h-11"
								value={style.name}
								oninput={(event) => updateTextStyle(index, 'name', event.currentTarget.value)}
							/>
						</label>
						<label class="grid gap-1 text-xs font-medium lg:col-span-2">
							<span>{m.image_editor_font_family()}</span>
							<div class="[&>button]:min-h-11">
								<ImageEditorFontPicker
									value={style.font_family}
									brandFonts={fonts}
									onChange={(font) => updateTextStyleFont(index, font)}
								/>
							</div>
						</label>
						<label class="grid gap-1 text-xs font-medium">
							<span>{m.brand_font_weight()}</span>
							<AppSelect
								value={String(style.font_weight)}
								onValueChange={(value) => updateTextStyle(index, 'font_weight', Number(value))}
								options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => ({
									value: String(weight),
									label: String(weight)
								}))}
								class="h-11 w-full"
							/>
						</label>
						<label class="grid gap-1 text-xs font-medium">
							<span>{m.brand_font_style()}</span>
							<AppSelect
								value={style.font_style}
								onValueChange={(value) => updateTextStyle(index, 'font_style', value)}
								options={[
									{ value: 'normal', label: m.image_editor_normal() },
									{ value: 'italic', label: m.image_editor_italic() }
								]}
								class="h-11 w-full"
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
						<label class="grid gap-1 text-xs font-medium sm:col-span-2">
							<span>{m.brand_color_value()}</span>
							<div class="[&>button]:min-h-11">
								<ImageEditorColorPicker
									label={m.brand_choose_color({ name: style.name || m.image_editor_text_styles() })}
									value={style.color}
									brandColors={colors}
									onChange={(value) => updateTextStyle(index, 'color', value)}
								/>
							</div>
						</label>
					</div>
					<Button
						variant="ghost"
						class="min-h-11 justify-start text-destructive"
						onclick={() => (textStyles = textStyles.filter((_, itemIndex) => itemIndex !== index))}
					>
						<TrashIcon />
						{m.brand_remove()}
					</Button>
				</div>
			</details>
		{/each}
	</section>

	<SettingsFormFooter
		label={m.brand_save_kit()}
		savingLabel={m.brand_save_kit()}
		{saving}
		disabled={!kit.can_edit}
		onSave={save}
	/>
</div>
