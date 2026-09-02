<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import { THEME_ASSET_SLOTS, type ThemeAssetSlot, type ThemeManifest } from '$lib/themes';
	import { isThemeFontInUse, themeCodePointLength } from './theme-editor-model';
	import { humanizeThemeToken } from './theme-editor-presenter';
	import type { ThemeFontUploadInput, ThemeResourceActions } from './theme-editor-types';

	const MAX_THEME_FONT_BYTES = 2 * 1024 * 1024;
	const MAX_THEME_IMAGE_BYTES = 5 * 1024 * 1024;

	interface Props {
		theme: ThemeManifest;
		busy?: boolean;
		actions?: ThemeResourceActions;
		onAdopt: (theme: ThemeManifest, message: string) => void;
		onError: (message: string) => void;
		onPendingChange: (operation: 'upload-font' | 'upload-asset' | 'remove-resource' | null) => void;
	}

	let { theme, busy = false, actions = {}, onAdopt, onError, onPendingChange }: Props = $props();

	let fontFamily = $state('');
	let fontWeight = $state(400);
	let fontStyle: ThemeFontUploadInput['style'] = $state('normal');
	let fontDisplay: ThemeFontUploadInput['display'] = $state('swap');
	let licenseAcknowledged = $state(false);
	let assetSlot: ThemeAssetSlot = $state('background-texture');
	let assetAlt = $state('');
	let deleteCandidate = $state<{ id: string; label: string } | null>(null);
	let deleteDialogOpen = $state(false);

	const fontFamilyValid = $derived(/^[a-zA-Z0-9 _.,'-]+$/.test(fontFamily.trim()));
	const fontWeightValid = $derived(
		Number.isInteger(fontWeight) && fontWeight >= 100 && fontWeight <= 900 && fontWeight % 100 === 0
	);
	const fontFaceAlreadyUploaded = $derived(
		theme.fonts.some(
			(font) =>
				font.family === fontFamily.trim() && font.weight === fontWeight && font.style === fontStyle
		)
	);
	const assetSlotInUse = $derived(theme.assets.some((asset) => asset.slot === assetSlot));
	const assetNeedsAlt = $derived(
		assetSlot === 'empty-state-illustration' || assetSlot === 'loading-illustration'
	);
	const assetAltValid = $derived(
		themeCodePointLength(assetAlt) <= 240 && (!assetNeedsAlt || Boolean(assetAlt.trim()))
	);

	async function uploadFont(file: File) {
		if (
			!actions.uploadFont ||
			busy ||
			!fontFamilyValid ||
			!fontWeightValid ||
			fontFaceAlreadyUploaded ||
			!licenseAcknowledged
		) {
			return;
		}
		if (file.size < 1 || file.size > MAX_THEME_FONT_BYTES) {
			onError(m.theme_editor_font_size_error());
			return;
		}
		onPendingChange('upload-font');
		onError('');
		try {
			const result = await actions.uploadFont(
				file,
				{
					family: fontFamily.trim(),
					weight: fontWeight,
					style: fontStyle,
					display: fontDisplay,
					licenseAcknowledged
				},
				structuredClone($state.snapshot(theme))
			);
			onAdopt(result, m.theme_editor_font_uploaded({ family: fontFamily.trim() }));
			fontFamily = '';
			licenseAcknowledged = false;
		} catch (error) {
			onError(error instanceof Error ? error.message : m.theme_editor_font_upload_failed());
		} finally {
			onPendingChange(null);
		}
	}

	async function uploadAsset(file: File) {
		if (!actions.uploadAsset || busy || assetSlotInUse || !assetAltValid) return;
		if (file.size < 1 || file.size > MAX_THEME_IMAGE_BYTES) {
			onError(m.theme_editor_image_size_error());
			return;
		}
		onPendingChange('upload-asset');
		onError('');
		try {
			const result = await actions.uploadAsset(
				file,
				{ slot: assetSlot, alt: assetAlt.trim() },
				structuredClone($state.snapshot(theme))
			);
			onAdopt(result, m.theme_editor_asset_uploaded({ asset: humanizeThemeToken(assetSlot) }));
			assetAlt = '';
		} catch (error) {
			onError(error instanceof Error ? error.message : m.theme_editor_image_upload_failed());
		} finally {
			onPendingChange(null);
		}
	}

	async function removeResource() {
		if (!actions.remove || !deleteCandidate || busy) return;
		onPendingChange('remove-resource');
		onError('');
		try {
			const result = await actions.remove(
				deleteCandidate.id,
				structuredClone($state.snapshot(theme))
			);
			onAdopt(result, m.theme_editor_resource_removed({ resource: deleteCandidate.label }));
			deleteDialogOpen = false;
			deleteCandidate = null;
		} catch (error) {
			onError(error instanceof Error ? error.message : m.theme_editor_resource_remove_failed());
		} finally {
			onPendingChange(null);
		}
	}
</script>

<div class="space-y-5">
	<div class="space-y-3 rounded-[var(--theme-radius-md,var(--radius))] border border-border p-3">
		<div class="space-y-1">
			<label class="text-xs font-medium" for="theme-font-upload"
				>{m.theme_editor_upload_font()}</label
			>
			<p class="text-xs leading-relaxed text-muted-foreground">
				{m.theme_editor_upload_font_help()}
			</p>
		</div>
		<Input
			bind:value={fontFamily}
			placeholder={m.theme_editor_font_family()}
			aria-label={m.theme_editor_font_family()}
		/>
		{#if fontFamily.trim() && !fontFamilyValid}
			<p class="text-xs text-destructive">{m.theme_editor_font_family_error()}</p>
		{/if}
		<div class="grid grid-cols-2 gap-2">
			<label class="grid gap-1.5 text-xs font-medium">
				{m.theme_editor_weight()}
				<Input type="number" min="100" max="900" step="100" bind:value={fontWeight} />
			</label>
			<label class="grid gap-1.5 text-xs font-medium">
				{m.theme_editor_style()}
				<Select.Root bind:value={fontStyle}>
					<Select.Trigger class="w-full">{fontStyle}</Select.Trigger>
					<Select.Content>
						<Select.Item value="normal">normal</Select.Item>
						<Select.Item value="italic">italic</Select.Item>
					</Select.Content>
				</Select.Root>
			</label>
		</div>
		<label class="grid gap-1.5 text-xs font-medium">
			{m.theme_editor_loading()}
			<Select.Root bind:value={fontDisplay}>
				<Select.Trigger class="w-full">{fontDisplay}</Select.Trigger>
				<Select.Content>
					<Select.Item value="swap">swap</Select.Item>
					<Select.Item value="fallback">fallback</Select.Item>
					<Select.Item value="optional">optional</Select.Item>
				</Select.Content>
			</Select.Root>
		</label>
		<Input
			id="theme-font-upload"
			type="file"
			accept=".woff2,font/woff2"
			disabled={!actions.uploadFont ||
				!fontFamilyValid ||
				!fontWeightValid ||
				fontFaceAlreadyUploaded ||
				!licenseAcknowledged ||
				busy}
			onchange={(event) => {
				const file = event.currentTarget.files?.[0];
				event.currentTarget.value = '';
				if (file) void uploadFont(file);
			}}
		/>
		{#if fontFaceAlreadyUploaded}
			<p class="text-xs text-warning">{m.theme_editor_font_already_uploaded()}</p>
		{/if}
		<div class="flex min-h-11 items-center gap-2">
			<Checkbox id="theme-font-license" bind:checked={licenseAcknowledged} />
			<label for="theme-font-license" class="text-xs leading-relaxed text-muted-foreground">
				{m.theme_editor_font_rights()}
			</label>
		</div>
	</div>

	<div class="space-y-3 rounded-[var(--theme-radius-md,var(--radius))] border border-border p-3">
		<label class="text-xs font-medium" for="theme-asset-upload"
			>{m.theme_editor_upload_image()}</label
		>
		<p class="text-xs leading-relaxed text-muted-foreground">
			{m.theme_editor_upload_image_help()}
		</p>
		<label class="grid gap-1.5 text-xs font-medium">
			{m.theme_editor_slot()}
			<Select.Root bind:value={assetSlot}>
				<Select.Trigger class="w-full">{assetSlot}</Select.Trigger>
				<Select.Content>
					{#each THEME_ASSET_SLOTS as slot (slot)}
						<Select.Item value={slot}>{humanizeThemeToken(slot)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</label>
		<Input
			bind:value={assetAlt}
			placeholder={m.theme_editor_image_alt_placeholder()}
			aria-label={m.theme_editor_image_alt_label()}
		/>
		<p class="text-right text-xs text-muted-foreground tabular-nums">
			{themeCodePointLength(assetAlt)}/240
		</p>
		<Input
			id="theme-asset-upload"
			type="file"
			accept="image/png,image/jpeg,image/webp,image/avif"
			disabled={!actions.uploadAsset || assetSlotInUse || !assetAltValid || busy}
			onchange={(event) => {
				const file = event.currentTarget.files?.[0];
				event.currentTarget.value = '';
				if (file) void uploadAsset(file);
			}}
		/>
		{#if assetNeedsAlt && !assetAlt.trim()}
			<p class="text-xs text-muted-foreground">{m.theme_editor_image_alt_required()}</p>
		{/if}
		{#if themeCodePointLength(assetAlt) > 240}
			<p class="text-xs text-destructive">{m.theme_editor_image_alt_too_long()}</p>
		{/if}
		{#if assetSlotInUse}
			<p class="text-xs text-warning">
				{m.theme_editor_slot_in_use({ slot: humanizeThemeToken(assetSlot).toLowerCase() })}
			</p>
		{/if}
	</div>

	<div class="divide-y divide-border border-y border-border">
		{#each [...theme.fonts, ...theme.assets] as resource (resource.id)}
			<div class="flex items-center justify-between gap-3 py-2.5">
				<div class="min-w-0">
					<p class="truncate text-sm font-medium">
						{'family' in resource ? resource.family : resource.alt || resource.id}
					</p>
					<p class="text-xs text-muted-foreground">
						{'format' in resource ? m.theme_editor_font() : resource.slot}
					</p>
				</div>
				<Button
					size="sm"
					intent="destructive"
					disabled={!actions.remove ||
						busy ||
						('family' in resource && isThemeFontInUse(theme, resource.id))}
					title={'family' in resource && isThemeFontInUse(theme, resource.id)
						? m.theme_editor_font_in_use()
						: undefined}
					onclick={() => {
						deleteCandidate = {
							id: resource.id,
							label: 'family' in resource ? resource.family : resource.alt || resource.id
						};
						deleteDialogOpen = true;
					}}
				>
					{m.theme_editor_remove()}
				</Button>
			</div>
		{/each}
		{#if theme.fonts.length + theme.assets.length === 0}
			<p class="py-4 text-sm text-muted-foreground">{m.theme_editor_no_resources()}</p>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={deleteDialogOpen}>
	<Dialog.Content showCloseButton={false} class="sm:max-w-md" aria-busy={busy}>
		<Dialog.Header>
			<Dialog.Title>
				{deleteCandidate
					? m.theme_editor_remove_resource_title({ resource: deleteCandidate.label })
					: m.theme_editor_remove_resource_fallback_title()}
			</Dialog.Title>
			<Dialog.Description>{m.theme_editor_remove_resource_description()}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button intent="quiet" disabled={busy} onclick={() => (deleteDialogOpen = false)}
				>{m.theme_editor_keep_resource()}</Button
			>
			<Button intent="destructive" disabled={busy} onclick={() => void removeResource()}>
				{busy ? m.theme_editor_removing() : m.theme_editor_remove_resource()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
