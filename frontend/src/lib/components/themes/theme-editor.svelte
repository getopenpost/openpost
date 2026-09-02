<script lang="ts">
	import { untrack } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { ImageEditorHistory } from '$lib/image-editor/history';
	import { m } from '$lib/paraglide/messages';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import {
		BUNDLED_THEME_FONTS,
		BUNDLED_THEME_FONT_IDS,
		THEME_BORDER_STYLES,
		THEME_CANVAS_TREATMENTS,
		THEME_ICON_PACK_IDS,
		THEME_ASSET_SLOTS,
		THEME_COMPONENT_RECIPE_OPTIONS,
		THEME_DENSITIES,
		THEME_MOTION_RECIPE_KEYS,
		THEME_TYPOGRAPHY_ROLE_KEYS,
		resolveBuiltInTheme,
		type ThemeAssetSlot,
		type ThemeIconPackId,
		type ThemeManifest,
		type ThemeMotionRecipeName,
		type ThemeScheme,
		type ThemeSchemeManifest,
		type ThemeShellTokens,
		type ThemeSpacingTokens,
		type ThemeTypographyRole,
		type WebResolvedTheme
	} from '$lib/themes';
	import ThemePreview, {
		THEME_PREVIEW_SCENES,
		type ThemePreviewScene,
		type ThemePreviewViewport
	} from './theme-preview.svelte';
	import {
		THEME_EDITOR_SECTIONS,
		isThemeFontInUse,
		parseThemeManifest,
		randomizeThemeManifest,
		resetThemeSection,
		serializeThemeManifest,
		takeThemeCodePoints,
		themeCodePointLength,
		themeEditorFingerprint,
		updateThemeSectionValue,
		type ThemeEditorSection
	} from './theme-editor-model';
	import { THEME_COLOR_GROUPS, THEME_COMPONENT_GROUPS } from './theme-editor-fields';

	type ThemeEditorPanel = ThemeEditorSection | 'icons' | 'assets' | 'revisions';
	const MAX_THEME_FONT_BYTES = 2 * 1024 * 1024;
	const MAX_THEME_IMAGE_BYTES = 5 * 1024 * 1024;

	export interface ThemeRevisionItem {
		revision: number;
		label: string;
		publishedAt: string;
		publishedBy?: string;
		current?: boolean;
	}

	export interface ThemeValidationIssue {
		path: string;
		message: string;
	}

	export interface ThemeFontUploadInput {
		family: string;
		weight: number;
		style: 'normal' | 'italic';
		display: 'swap' | 'fallback' | 'optional';
		licenseAcknowledged: boolean;
	}

	export interface ThemeAssetUploadInput {
		slot: ThemeAssetSlot;
		alt: string;
	}

	interface Props {
		initialTheme: ThemeManifest;
		baselineTheme?: ThemeManifest;
		revisions?: ThemeRevisionItem[];
		validationIssues?: ThemeValidationIssue[];
		canPublish?: boolean;
		busy?: boolean;
		previewResourceURL?: (resourceID: string, draft: ThemeManifest) => string;
		onSave?: (theme: ThemeManifest) => ThemeManifest | void | Promise<ThemeManifest | void>;
		onPublish?: (theme: ThemeManifest) => ThemeManifest | void | Promise<ThemeManifest | void>;
		onRollback?: (revision: number) => ThemeManifest | Promise<ThemeManifest>;
		onReload?: () => ThemeManifest | Promise<ThemeManifest>;
		onUploadFont?: (
			file: File,
			input: ThemeFontUploadInput,
			currentDraft: ThemeManifest
		) => ThemeManifest | Promise<ThemeManifest>;
		onUploadAsset?: (
			file: File,
			input: ThemeAssetUploadInput,
			currentDraft: ThemeManifest
		) => ThemeManifest | Promise<ThemeManifest>;
		onRemoveResource?: (
			resourceID: string,
			currentDraft: ThemeManifest
		) => ThemeManifest | Promise<ThemeManifest>;
	}

	let {
		initialTheme,
		baselineTheme,
		revisions = [],
		validationIssues = [],
		canPublish = false,
		busy = false,
		previewResourceURL,
		onSave,
		onPublish,
		onRollback,
		onReload,
		onUploadFont,
		onUploadAsset,
		onRemoveResource
	}: Props = $props();

	let draft = $state(untrack(() => cloneTheme(initialTheme)));
	let savedFingerprint = $state(untrack(() => themeEditorFingerprint(initialTheme)));
	let loadedIdentity = $state('');
	let editorMode: 'guided' | 'manifest' = $state('guided');
	let panel: ThemeEditorPanel = $state('colors');
	let scheme: ThemeScheme = $state(untrack(() => initialTheme.supportedSchemes[0] ?? 'light'));
	let previewScheme: ThemeScheme | 'editing' | 'system' | 'fallback' = $state('editing');
	let systemScheme: ThemeScheme = $state('light');
	let scene: ThemePreviewScene = $state('dashboard');
	let viewport: ThemePreviewViewport = $state('desktop');
	let manifestSource = $state(untrack(() => serializeThemeManifest(initialTheme)));
	let manifestError = $state('');
	let statusMessage = $state('');
	let operationError = $state('');
	let pendingOperation:
		| 'save'
		| 'publish'
		| 'rollback'
		| 'reload'
		| 'upload-font'
		| 'upload-asset'
		| 'remove-resource'
		| null = $state(null);
	let randomSeed = $state(42017);
	let licenseAcknowledged = $state(false);
	let fontFamily = $state('');
	let fontWeight = $state(400);
	let fontStyle: ThemeFontUploadInput['style'] = $state('normal');
	let fontDisplay: ThemeFontUploadInput['display'] = $state('swap');
	let assetSlot: ThemeAssetSlot = $state('background-texture');
	let assetAlt = $state('');
	let historyVersion = $state(0);
	let rollbackCandidate = $state<ThemeRevisionItem | null>(null);
	let rollbackDialogOpen = $state(false);
	let reloadDialogOpen = $state(false);
	let removeSchemeDialogOpen = $state(false);
	let resourceDeleteCandidate = $state<{ id: string; label: string } | null>(null);
	let resourceDeleteDialogOpen = $state(false);
	let history = new ImageEditorHistory<ThemeManifest>(cloneTheme, 100);
	const unsavedChanges = getOptionalUnsavedChanges();

	const baseline = $derived(baselineTheme ?? initialTheme);
	const dirty = $derived(themeEditorFingerprint(draft) !== savedFingerprint);
	const manifestSourceDirty = $derived(
		editorMode === 'manifest' && manifestSource !== serializeThemeManifest(draft)
	);
	const hasUnsavedWork = $derived(dirty || manifestSourceDirty);
	const canUndo = $derived.by(() => {
		void historyVersion;
		return history.canUndo;
	});
	const canRedo = $derived.by(() => {
		void historyVersion;
		return history.canRedo;
	});
	const schemeManifest = $derived(draft.schemes[scheme]);
	const effectivePreviewScheme = $derived(
		previewScheme === 'editing'
			? scheme
			: previewScheme === 'light' || previewScheme === 'dark'
				? previewScheme
				: systemScheme
	);
	const previewTheme = $derived(
		resolvePreview(draft, effectivePreviewScheme, previewScheme === 'fallback')
	);
	const previewFallbackMessage = $derived(
		previewTheme.fallbackReason === 'unsupported-scheme'
			? `${draft.name} does not support ${effectivePreviewScheme}. The preview uses Workshop ${effectivePreviewScheme}.`
			: previewTheme.fallbackReason === 'unsafe-resource' ||
				  previewTheme.fallbackReason === 'resource-failed'
				? 'A linked font or illustration has no safe preview URL. The preview uses Workshop.'
				: 'Fallback preview is on. OpenPost is showing the complete Workshop theme.'
	);
	const localValidationError = $derived.by(() => {
		try {
			parseThemeManifest(serializeThemeManifest(draft));
			return '';
		} catch (error) {
			return error instanceof Error ? error.message : 'The draft manifest is invalid';
		}
	});
	const issueCount = $derived(
		validationIssues.length + (manifestError ? 1 : 0) + (localValidationError ? 1 : 0)
	);
	const editorBusy = $derived(busy || pendingOperation !== null);
	const randomSeedValid = $derived(Number.isSafeInteger(randomSeed));
	const assetSlotInUse = $derived(draft.assets.some((asset) => asset.slot === assetSlot));
	const assetNeedsAlt = $derived(
		assetSlot === 'empty-state-illustration' || assetSlot === 'loading-illustration'
	);
	const assetAltValid = $derived(
		themeCodePointLength(assetAlt) <= 240 && (!assetNeedsAlt || Boolean(assetAlt.trim()))
	);
	const fontFamilyValid = $derived(/^[a-zA-Z0-9 _.,'-]+$/.test(fontFamily.trim()));
	const fontWeightValid = $derived(
		Number.isInteger(fontWeight) && fontWeight >= 100 && fontWeight <= 900 && fontWeight % 100 === 0
	);
	const fontFaceAlreadyUploaded = $derived(
		draft.fonts.some(
			(font) =>
				font.family === fontFamily.trim() && font.weight === fontWeight && font.style === fontStyle
		)
	);

	const panelLabels: Record<ThemeEditorPanel, string> = {
		colors: 'Color',
		typography: 'Type',
		spacing: 'Spacing',
		shape: 'Shape',
		elevation: 'Depth',
		motion: 'Motion',
		shell: 'Shell',
		components: 'Components',
		icons: 'Icons',
		assets: 'Fonts & assets',
		revisions: 'Revisions'
	};
	const guidedPanels: ThemeEditorPanel[] = [
		...THEME_EDITOR_SECTIONS,
		'icons',
		'assets',
		'revisions'
	];
	$effect(() => {
		const identity = `${initialTheme.id}:${initialTheme.revision}`;
		if (identity === loadedIdentity) return;
		loadedIdentity = identity;
		draft = cloneTheme(initialTheme);
		savedFingerprint = themeEditorFingerprint(initialTheme);
		scheme = initialTheme.supportedSchemes[0] ?? 'light';
		manifestSource = serializeThemeManifest(initialTheme);
		manifestError = '';
		statusMessage = '';
		operationError = '';
		pendingOperation = null;
		history = new ImageEditorHistory<ThemeManifest>(cloneTheme, 100);
		historyVersion += 1;
	});

	$effect(() => {
		if (editorMode === 'guided') manifestSource = serializeThemeManifest(draft);
	});

	$effect(() => {
		unsavedChanges?.set('theme-editor', hasUnsavedWork, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('theme-editor');
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const update = () => (systemScheme = media.matches ? 'dark' : 'light');
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	function resolvePreview(
		theme: ThemeManifest,
		requestedScheme: ThemeScheme,
		forceFallback = false
	): WebResolvedTheme {
		if (forceFallback) {
			return {
				...resolveBuiltInTheme('workshop', requestedScheme),
				source: 'fallback',
				fallbackReason: 'invalid-manifest'
			};
		}
		const selected = theme.schemes[requestedScheme];
		if (!selected) {
			return {
				...resolveBuiltInTheme('workshop', requestedScheme),
				source: 'fallback',
				fallbackReason: 'unsupported-scheme'
			};
		}
		if (
			!previewResourceURL &&
			[...theme.fonts, ...theme.assets].some((resource) => resource.sourceUrl.startsWith('asset:'))
		) {
			return {
				...resolveBuiltInTheme('workshop', requestedScheme),
				source: 'fallback',
				fallbackReason: 'unsafe-resource'
			};
		}
		return {
			id: theme.id,
			revision: theme.revision,
			name: theme.name,
			iconPack: theme.iconPack,
			source: 'organization',
			requestedScheme,
			scheme: requestedScheme,
			manifest: selected,
			fonts: theme.fonts.map((font) => ({
				...font,
				sourceUrl: previewResourceURL?.(font.id, theme) ?? font.sourceUrl
			})),
			assets: theme.assets.map((asset) => ({
				...asset,
				sourceUrl: previewResourceURL?.(asset.id, theme) ?? asset.sourceUrl
			})),
			...(previewResourceURL ? { webResourceScope: 'editor-preview' as const } : {})
		};
	}

	function cloneTheme(theme: ThemeManifest): ThemeManifest {
		return structuredClone($state.snapshot(theme));
	}

	function applyDraft(label: string, next: ThemeManifest, coalesceKey?: string) {
		const before = cloneTheme(draft);
		draft = history.execute(before, {
			label,
			coalesceKey,
			apply: () => cloneTheme(next),
			revert: () => cloneTheme(before)
		});
		historyVersion += 1;
		manifestError = '';
		statusMessage = label;
	}

	function updateMetadata(key: 'name' | 'description', value: string) {
		const maximum = key === 'name' ? 80 : 240;
		applyDraft(
			key === 'name' ? 'Rename theme' : 'Update description',
			{ ...cloneTheme(draft), [key]: takeThemeCodePoints(value, maximum) },
			`theme-${key}`
		);
	}

	function updateValue(section: ThemeEditorSection, key: string, value: string | number) {
		const next = updateThemeSectionValue(
			cloneTheme(draft),
			scheme,
			section,
			key as never,
			value as never
		);
		applyDraft(`Update ${panelLabels[section].toLowerCase()}`, next, `${scheme}-${section}-${key}`);
	}

	function updateTypographyRole(
		role: ThemeTypographyRole,
		key: keyof ThemeSchemeManifest['typography'][ThemeTypographyRole],
		value: string | string[] | number
	) {
		const next = cloneTheme(draft);
		const manifest = next.schemes[scheme];
		if (!manifest) return;
		(manifest.typography[role][key] as typeof value) = value;
		applyDraft('Update type', next, `${scheme}-typography-${role}-${key}`);
	}

	function updateFontFamily(role: ThemeTypographyRole, family: string) {
		const bundledFont = BUNDLED_THEME_FONT_IDS.map((id) => BUNDLED_THEME_FONTS[id]).find(
			(font) => font.family === family
		);
		const next = cloneTheme(draft);
		const manifest = next.schemes[scheme];
		if (!manifest) return;
		manifest.typography[role].family = family;
		manifest.typography[role].fallbacks = bundledFont?.fallbacks ?? [
			'system-ui',
			'-apple-system',
			'sans-serif'
		];
		if (!bundledFont) {
			const uploadedWeights = draft.fonts
				.filter((font) => font.family === family && font.style === 'normal')
				.map((font) => font.weight)
				.sort((left, right) => left - right);
			if (!uploadedWeights.includes(manifest.typography[role].weight) && uploadedWeights[0]) {
				manifest.typography[role].weight = uploadedWeights[0];
			}
		}
		applyDraft('Change typeface', next, `${scheme}-typography-${role}-family`);
	}

	function updateMotionRecipe(
		recipe: ThemeMotionRecipeName,
		key: keyof ThemeSchemeManifest['motion'][ThemeMotionRecipeName],
		value: string | number
	) {
		const next = cloneTheme(draft);
		const manifest = next.schemes[scheme];
		if (!manifest) return;
		(manifest.motion[recipe][key] as typeof value) = value;
		applyDraft('Update motion', next, `${scheme}-motion-${recipe}-${key}`);
	}

	function humanizeToken(value: string): string {
		return value
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.replaceAll('-', ' ')
			.replace(/^./, (letter) => letter.toUpperCase());
	}

	function updateIconPack(value: string) {
		if (!THEME_ICON_PACK_IDS.includes(value as ThemeIconPackId)) return;
		applyDraft('Change icon pack', {
			...cloneTheme(draft),
			iconPack: value as ThemeIconPackId
		});
	}

	function undo() {
		draft = history.undo(cloneTheme(draft));
		historyVersion += 1;
		statusMessage = history.redoLabel ? `Undid ${history.redoLabel}` : 'Undid change';
	}

	function redo() {
		draft = history.redo(cloneTheme(draft));
		historyVersion += 1;
		statusMessage = history.undoLabel ? `Redid ${history.undoLabel}` : 'Redid change';
	}

	function resetSection() {
		if (!THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection)) return;
		const sectionBaseline = cloneTheme(baseline);
		sectionBaseline.schemes[scheme] ??= cloneTheme(
			resolveBuiltInTheme('workshop', scheme).manifest
		);
		applyDraft(
			`Reset ${panelLabels[panel].toLowerCase()}`,
			resetThemeSection(cloneTheme(draft), sectionBaseline, scheme, panel as ThemeEditorSection)
		);
	}

	function resetTheme() {
		applyDraft('Reset theme', cloneTheme(baseline));
	}

	function randomize() {
		const section = THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection)
			? (panel as ThemeEditorSection)
			: undefined;
		applyDraft(
			section ? `Randomize ${panelLabels[section].toLowerCase()}` : 'Randomize theme',
			randomizeThemeManifest(cloneTheme(draft), scheme, randomSeed, section)
		);
		randomSeed += 1;
	}

	function randomizeAll() {
		applyDraft('Randomize theme', randomizeThemeManifest(cloneTheme(draft), scheme, randomSeed));
		randomSeed += 1;
	}

	function addScheme() {
		if (draft.schemes[scheme]) return;
		const workshop = resolveBuiltInTheme('workshop', scheme).manifest;
		const next = cloneTheme(draft);
		next.schemes[scheme] = structuredClone(workshop);
		next.supportedSchemes = (['light', 'dark'] as const).filter(
			(candidate) => candidate === scheme || next.supportedSchemes.includes(candidate)
		);
		applyDraft(`Add ${scheme} scheme`, next);
	}

	function removeScheme() {
		if (draft.supportedSchemes.length <= 1 || !draft.schemes[scheme]) return;
		const next = cloneTheme(draft);
		delete next.schemes[scheme];
		next.supportedSchemes = next.supportedSchemes.filter((candidate) => candidate !== scheme);
		applyDraft(`Remove ${scheme} scheme`, next);
		removeSchemeDialogOpen = false;
	}

	function applyManifestSource(): boolean {
		try {
			const parsed = parseThemeManifest(manifestSource);
			if (parsed.id !== draft.id) throw new Error('Theme ID is managed by OpenPost');
			if (parsed.revision !== draft.revision) {
				throw new Error('Theme revision is managed by OpenPost');
			}
			applyDraft('Apply manifest', parsed);
			manifestSource = serializeThemeManifest(parsed);
			manifestError = '';
			return true;
		} catch (error) {
			manifestError = error instanceof Error ? error.message : 'Manifest is invalid';
			return false;
		}
	}

	function selectEditorMode(nextMode: 'guided' | 'manifest') {
		if (nextMode === editorMode) return;
		if (nextMode === 'guided' && manifestSourceDirty && !applyManifestSource()) return;
		editorMode = nextMode;
		if (nextMode === 'manifest') manifestSource = serializeThemeManifest(draft);
	}

	async function copyManifest() {
		if (typeof navigator === 'undefined' || !navigator.clipboard) {
			operationError = 'Clipboard access is unavailable in this browser';
			return;
		}
		try {
			await navigator.clipboard.writeText(
				editorMode === 'manifest' ? manifestSource : serializeThemeManifest(draft)
			);
			operationError = '';
			statusMessage = 'Manifest copied';
		} catch {
			operationError = 'OpenPost could not copy the manifest to the clipboard';
		}
	}

	function adoptServerTheme(theme: ThemeManifest, message: string) {
		draft = structuredClone(theme);
		savedFingerprint = themeEditorFingerprint(theme);
		manifestSource = serializeThemeManifest(theme);
		history = new ImageEditorHistory<ThemeManifest>(structuredClone, 100);
		historyVersion += 1;
		manifestError = '';
		operationError = '';
		statusMessage = message;
	}

	async function uploadFont(file: File) {
		if (
			!onUploadFont ||
			pendingOperation ||
			!fontFamilyValid ||
			!fontWeightValid ||
			fontFaceAlreadyUploaded ||
			!licenseAcknowledged
		)
			return;
		if (file.size < 1 || file.size > MAX_THEME_FONT_BYTES) {
			operationError = 'Choose a WOFF2 font that is 2 MB or smaller';
			return;
		}
		pendingOperation = 'upload-font';
		operationError = '';
		try {
			const result = await onUploadFont(
				file,
				{
					family: fontFamily.trim(),
					weight: fontWeight,
					style: fontStyle,
					display: fontDisplay,
					licenseAcknowledged
				},
				cloneTheme(draft)
			);
			adoptServerTheme(result, `${fontFamily.trim()} uploaded`);
			fontFamily = '';
			licenseAcknowledged = false;
		} catch (error) {
			operationError = error instanceof Error ? error.message : 'Could not upload the font';
		} finally {
			pendingOperation = null;
		}
	}

	async function uploadAsset(file: File) {
		if (!onUploadAsset || pendingOperation || assetSlotInUse || !assetAltValid) return;
		if (file.size < 1 || file.size > MAX_THEME_IMAGE_BYTES) {
			operationError = 'Choose an image that is 5 MB or smaller';
			return;
		}
		pendingOperation = 'upload-asset';
		operationError = '';
		try {
			const result = await onUploadAsset(
				file,
				{ slot: assetSlot, alt: assetAlt.trim() },
				cloneTheme(draft)
			);
			adoptServerTheme(result, `${humanizeToken(assetSlot)} uploaded`);
			assetAlt = '';
		} catch (error) {
			operationError = error instanceof Error ? error.message : 'Could not upload the image';
		} finally {
			pendingOperation = null;
		}
	}

	async function removeResource() {
		if (!onRemoveResource || !resourceDeleteCandidate || pendingOperation) return;
		pendingOperation = 'remove-resource';
		operationError = '';
		try {
			const result = await onRemoveResource(resourceDeleteCandidate.id, cloneTheme(draft));
			adoptServerTheme(result, `${resourceDeleteCandidate.label} removed`);
			resourceDeleteDialogOpen = false;
			resourceDeleteCandidate = null;
		} catch (error) {
			operationError = error instanceof Error ? error.message : 'Could not remove the resource';
		} finally {
			pendingOperation = null;
		}
	}

	async function save() {
		if (!onSave || pendingOperation) return;
		pendingOperation = 'save';
		operationError = '';
		try {
			const result = await onSave(cloneTheme(draft));
			if (result) draft = cloneTheme(result);
			savedFingerprint = themeEditorFingerprint(draft);
			manifestSource = serializeThemeManifest(draft);
			statusMessage = 'Draft saved';
		} catch (error) {
			operationError = error instanceof Error ? error.message : 'Could not save the draft';
		} finally {
			pendingOperation = null;
		}
	}

	async function publish() {
		if (!onPublish || pendingOperation) return;
		pendingOperation = 'publish';
		operationError = '';
		try {
			const result = await onPublish(cloneTheme(draft));
			if (result) draft = cloneTheme(result);
			savedFingerprint = themeEditorFingerprint(draft);
			manifestSource = serializeThemeManifest(draft);
			statusMessage = 'Theme published';
		} catch (error) {
			operationError = error instanceof Error ? error.message : 'Could not publish the theme';
		} finally {
			pendingOperation = null;
		}
	}

	async function rollback(revision: number): Promise<boolean> {
		if (!onRollback || pendingOperation) return false;
		pendingOperation = 'rollback';
		operationError = '';
		try {
			const result = await onRollback(revision);
			adoptServerTheme(result, `Restored revision ${revision}`);
			return true;
		} catch (error) {
			operationError = error instanceof Error ? error.message : 'Could not restore the revision';
			return false;
		} finally {
			pendingOperation = null;
		}
	}

	async function confirmRollback() {
		if (!rollbackCandidate) return;
		if (await rollback(rollbackCandidate.revision)) {
			rollbackDialogOpen = false;
			rollbackCandidate = null;
		}
	}

	async function reload(): Promise<boolean> {
		if (!onReload || pendingOperation) return false;
		pendingOperation = 'reload';
		try {
			const result = await onReload();
			adoptServerTheme(result, 'Theme reloaded');
			return true;
		} catch (error) {
			operationError = error instanceof Error ? error.message : 'Could not reload the theme';
			return false;
		} finally {
			pendingOperation = null;
		}
	}

	async function confirmReload() {
		if (await reload()) reloadDialogOpen = false;
	}
</script>

<div
	class="theme-editor min-w-0 space-y-4"
	data-testid="theme-editor"
	aria-busy={editorBusy}
	inert={pendingOperation ? true : undefined}
>
	<header
		class="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-3 border-b border-border bg-background/96 px-1 pb-3 backdrop-blur-sm"
	>
		<div class="min-w-[12rem] flex-1">
			<Input
				value={draft.name}
				oninput={(event) => updateMetadata('name', event.currentTarget.value)}
				aria-label="Theme name"
				class="border-transparent bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:px-2"
			/>
			<p class="mt-0.5 text-xs text-muted-foreground">
				{hasUnsavedWork ? 'Unsaved changes' : `Revision ${draft.revision}`}
				{#if issueCount > 0}
					· {issueCount} issues{/if}
			</p>
		</div>

		<div
			class="flex min-h-11 items-center rounded-[var(--theme-radius-md,var(--radius))] bg-muted p-1"
			aria-label="Editor mode"
		>
			<button
				type="button"
				class="min-h-11 rounded-[var(--theme-radius-sm,var(--radius))] px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-background aria-pressed:shadow-sm"
				aria-pressed={editorMode === 'guided'}
				onclick={() => selectEditorMode('guided')}>Guided</button
			>
			<button
				type="button"
				class="min-h-11 rounded-[var(--theme-radius-sm,var(--radius))] px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-background aria-pressed:shadow-sm"
				aria-pressed={editorMode === 'manifest'}
				onclick={() => selectEditorMode('manifest')}>Manifest</button
			>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<Button size="sm" intent="quiet" onclick={undo} disabled={!canUndo || editorBusy}>Undo</Button
			>
			<Button size="sm" intent="quiet" onclick={redo} disabled={!canRedo || editorBusy}>Redo</Button
			>
			<Button
				size="sm"
				intent="ordinary"
				onclick={() => void save()}
				disabled={!onSave || !dirty || manifestSourceDirty || editorBusy}>Save draft</Button
			>
			<Button
				size="sm"
				intent="focal"
				onclick={() => void publish()}
				disabled={!onPublish || !canPublish || editorBusy || manifestSourceDirty || issueCount > 0}
				>{pendingOperation === 'publish' ? 'Publishing…' : 'Publish'}</Button
			>
		</div>
	</header>

	{#if operationError}
		<div
			class="flex flex-wrap items-center justify-between gap-3 rounded-[var(--theme-radius-md,var(--radius))] border border-destructive/35 bg-destructive/8 px-3 py-2"
			role="alert"
		>
			<p class="text-sm text-destructive">{operationError}</p>
			{#if onReload}
				<div class="flex flex-wrap gap-2">
					<Button size="sm" intent="quiet" onclick={() => void copyManifest()} disabled={editorBusy}
						>Copy manifest</Button
					>
					<Button
						size="sm"
						intent="ordinary"
						onclick={() => (reloadDialogOpen = true)}
						disabled={editorBusy}>Reload latest</Button
					>
				</div>
			{/if}
		</div>
	{/if}

	<section
		class="grid gap-2 rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
		aria-labelledby="theme-description-label"
	>
		<div class="flex items-center justify-between gap-3">
			<label id="theme-description-label" for="theme-description" class="text-xs font-medium"
				>Theme description</label
			>
			<span class="text-xs text-muted-foreground tabular-nums"
				>{themeCodePointLength(draft.description)}/240</span
			>
		</div>
		<Textarea
			id="theme-description"
			value={draft.description}
			rows={2}
			oninput={(event) => updateMetadata('description', event.currentTarget.value)}
			placeholder="What should this theme feel like?"
			class="min-h-16 resize-y"
		/>
	</section>

	<div class="grid min-w-0 gap-4 xl:grid-cols-[10.5rem_minmax(17rem,21rem)_minmax(24rem,1fr)]">
		{#if editorMode === 'guided'}
			<nav
				class="flex gap-1 overflow-x-auto border-b border-border pb-2 xl:block xl:space-y-1 xl:overflow-visible xl:border-r xl:border-b-0 xl:pr-3 xl:pb-0"
				aria-label="Theme sections"
			>
				{#each guidedPanels as candidate (candidate)}
					<button
						type="button"
						class="min-h-11 shrink-0 rounded-[var(--theme-radius-sm,var(--radius))] px-3 text-left text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-accent aria-pressed:text-accent-foreground xl:w-full"
						aria-pressed={panel === candidate}
						onclick={() => (panel = candidate)}
					>
						{panelLabels[candidate]}
					</button>
				{/each}
			</nav>

			<section class="min-w-0 space-y-5" aria-labelledby="theme-panel-heading">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 id="theme-panel-heading" class="font-semibold">{panelLabels[panel]}</h2>
						<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
							Changes update the real product preview.
						</p>
					</div>
					{#if THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection) && schemeManifest}
						<Button size="sm" intent="quiet" onclick={resetSection} disabled={editorBusy}
							>Reset section</Button
						>
					{/if}
				</div>

				<div class="grid grid-cols-2 gap-2" aria-label="Scheme to edit">
					{#each ['light', 'dark'] as candidate (candidate)}
						<button
							type="button"
							class="min-h-11 rounded-[var(--theme-radius-md,var(--radius))] border border-border px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
							aria-pressed={scheme === candidate}
							onclick={() => (scheme = candidate as ThemeScheme)}
						>
							{candidate === 'light' ? 'Light' : 'Dark'}
							{#if !draft.schemes[candidate as ThemeScheme]}<span
									class="ml-1 text-xs font-normal opacity-65">fallback</span
								>{/if}
						</button>
					{/each}
				</div>
				{#if schemeManifest && draft.supportedSchemes.length > 1}
					<div class="flex justify-end">
						<Button size="sm" intent="destructive" onclick={() => (removeSchemeDialogOpen = true)}>
							Remove {scheme} scheme
						</Button>
					</div>
				{/if}

				{#if !schemeManifest}
					<div
						class="rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-muted/55 p-4"
					>
						<p class="text-sm font-medium">This theme does not support {scheme}.</p>
						<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
							OpenPost uses the complete Workshop {scheme} theme instead. Add a scheme only if you plan
							to design every role.
						</p>
						<Button class="mt-3" size="sm" intent="primary" onclick={addScheme}>Add {scheme}</Button
						>
					</div>
				{:else if panel === 'colors'}
					<div class="space-y-3">
						{#each THEME_COLOR_GROUPS as group (group.id)}
							<details
								class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
								open={group.id === 'foundation'}
							>
								<summary class="cursor-pointer text-sm font-semibold">{group.label}</summary>
								<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
									{group.description}
								</p>
								<div class="mt-3 grid gap-3">
									{#each group.fields as field (field)}
										<label class="grid gap-1.5 text-xs font-medium" for={`theme-color-${field}`}>
											<span>{humanizeToken(field)}</span>
											<span class="flex items-center gap-2">
												<span
													class="size-8 shrink-0 rounded-[var(--theme-radius-sm,var(--radius))] border border-border"
													style:background={schemeManifest.colors[field]}
												></span>
												<Input
													id={`theme-color-${field}`}
													value={schemeManifest.colors[field]}
													oninput={(event) =>
														updateValue('colors', field, event.currentTarget.value)}
													class="font-mono"
												/>
											</span>
										</label>
									{/each}
								</div>
							</details>
						{/each}
					</div>
				{:else if panel === 'typography'}
					<div class="space-y-3">
						{#each THEME_TYPOGRAPHY_ROLE_KEYS as role (role)}
							{@const uploadedWeights = draft.fonts
								.filter(
									(font) =>
										font.family === schemeManifest.typography[role].family &&
										font.style === 'normal'
								)
								.map((font) => font.weight)
								.sort((left, right) => left - right)}
							<details
								class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
								open={role === 'body'}
							>
								<summary class="cursor-pointer text-sm font-semibold">{humanizeToken(role)}</summary
								>
								<div class="mt-3 grid gap-3">
									<label class="grid gap-1.5 text-xs font-medium"
										>Family
										<Select.Root
											value={schemeManifest.typography[role].family}
											onValueChange={(value) => value && updateFontFamily(role, value)}
										>
											<Select.Trigger class="w-full"
												>{schemeManifest.typography[role].family}</Select.Trigger
											>
											<Select.Content>
												{#each BUNDLED_THEME_FONT_IDS as fontID (fontID)}
													{@const bundledFont = BUNDLED_THEME_FONTS[fontID]}
													<Select.Item value={bundledFont.family}>{bundledFont.label}</Select.Item>
												{/each}
												{#each [...new Set(draft.fonts
															.filter((font) => font.style === 'normal')
															.map((font) => font.family))] as family (family)}
													<Select.Item value={family}>{family} · uploaded</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
										<span class="font-normal text-muted-foreground"
											>{schemeManifest.typography[role].fallbacks.join(', ')}</span
										>
									</label>
									<div class="grid grid-cols-2 gap-3">
										<label class="grid gap-1.5 text-xs font-medium"
											>Weight
											{#if uploadedWeights.length > 0}
												<Select.Root
													value={String(schemeManifest.typography[role].weight)}
													onValueChange={(value) =>
														value && updateTypographyRole(role, 'weight', Number(value))}
												>
													<Select.Trigger class="w-full"
														>{schemeManifest.typography[role].weight}</Select.Trigger
													>
													<Select.Content>
														{#each uploadedWeights as weight (weight)}
															<Select.Item value={String(weight)}>{weight}</Select.Item>
														{/each}
													</Select.Content>
												</Select.Root>
											{:else}
												<Input
													type="number"
													min="100"
													max="900"
													step="100"
													value={schemeManifest.typography[role].weight}
													oninput={(event) =>
														updateTypographyRole(role, 'weight', Number(event.currentTarget.value))}
												/>
											{/if}
										</label>
										{#each [['size', 'Size'], ['lineHeight', 'Line height'], ['tracking', 'Tracking']] as field (field[0])}
											<label class="grid gap-1.5 text-xs font-medium"
												>{field[1]}<Input
													value={String(
														schemeManifest.typography[role][
															field[0] as 'size' | 'lineHeight' | 'tracking'
														]
													)}
													oninput={(event) =>
														updateTypographyRole(
															role,
															field[0] as 'size' | 'lineHeight' | 'tracking',
															event.currentTarget.value
														)}
												/></label
											>
										{/each}
									</div>
								</div>
							</details>
						{/each}
					</div>
				{:else if panel === 'spacing'}
					<div class="space-y-4">
						<label class="grid gap-1.5 text-xs font-medium"
							>Density
							<Select.Root
								value={schemeManifest.spacing.density}
								onValueChange={(value) => value && updateValue('spacing', 'density', value)}
							>
								<Select.Trigger class="w-full">{schemeManifest.spacing.density}</Select.Trigger>
								<Select.Content
									>{#each THEME_DENSITIES as value (value)}<Select.Item {value}>{value}</Select.Item
										>{/each}</Select.Content
								>
							</Select.Root>
						</label>
						{#each [['base', 'Base unit'], ['controlHeight', 'Control height'], ['compactControlHeight', 'Compact control height'], ['touchTarget', 'Touch target'], ['pageGutter', 'Page gutter'], ['sectionGap', 'Section gap'], ['componentGap', 'Component gap']] as field (field[0])}
							<label class="grid gap-1.5 text-xs font-medium"
								>{field[1]}<Input
									value={String(schemeManifest.spacing[field[0] as keyof ThemeSpacingTokens])}
									oninput={(event) => updateValue('spacing', field[0], event.currentTarget.value)}
								/></label
							>
						{/each}
					</div>
				{:else if panel === 'shape'}
					<div class="space-y-4">
						{#each [['radius', 'Base radius'], ['radiusSm', 'Small controls'], ['radiusMd', 'Controls'], ['radiusLg', 'Containers'], ['radiusMedia', 'Media'], ['radiusPill', 'Pills'], ['borderWidth', 'Border width']] as field (field[0])}
							<label class="grid gap-1.5 text-xs font-medium"
								>{field[1]}<Input
									value={String(
										schemeManifest.shape[field[0] as keyof typeof schemeManifest.shape]
									)}
									oninput={(event) => updateValue('shape', field[0], event.currentTarget.value)}
								/></label
							>
						{/each}
						<label class="grid gap-1.5 text-xs font-medium"
							>Border style
							<Select.Root
								value={schemeManifest.shape.borderStyle}
								onValueChange={(value) => value && updateValue('shape', 'borderStyle', value)}
							>
								<Select.Trigger class="w-full">{schemeManifest.shape.borderStyle}</Select.Trigger>
								<Select.Content
									>{#each THEME_BORDER_STYLES as value (value)}<Select.Item {value}
											>{value}</Select.Item
										>{/each}</Select.Content
								>
							</Select.Root>
						</label>
					</div>
				{:else if panel === 'elevation'}
					<div class="space-y-4">
						{#each [['card', 'Resting card'], ['popover', 'Popover'], ['dialog', 'Dialog'], ['focalAction', 'Focal action']] as field (field[0])}
							<label class="grid gap-1.5 text-xs font-medium"
								>{field[1]}<Input
									value={String(
										schemeManifest.elevation[field[0] as keyof typeof schemeManifest.elevation]
									)}
									oninput={(event) => updateValue('elevation', field[0], event.currentTarget.value)}
								/></label
							>
						{/each}
					</div>
				{:else if panel === 'motion'}
					<div class="space-y-3">
						{#each THEME_MOTION_RECIPE_KEYS as recipe (recipe)}
							<details
								class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
								open={recipe === 'press'}
							>
								<summary class="cursor-pointer text-sm font-semibold"
									>{humanizeToken(recipe)}</summary
								>
								<div class="mt-3 grid grid-cols-2 gap-3">
									{#each [['duration', 'Duration'], ['easing', 'Easing'], ['distance', 'Distance']] as field (field[0])}
										<label class="grid gap-1.5 text-xs font-medium"
											>{field[1]}<Input
												value={String(
													schemeManifest.motion[recipe][
														field[0] as 'duration' | 'easing' | 'distance'
													]
												)}
												oninput={(event) =>
													updateMotionRecipe(
														recipe,
														field[0] as 'duration' | 'easing' | 'distance',
														event.currentTarget.value
													)}
											/></label
										>
									{/each}
									<label class="grid gap-1.5 text-xs font-medium"
										>Opacity<Input
											type="number"
											min="0"
											max="1"
											step="0.05"
											value={schemeManifest.motion[recipe].opacity}
											oninput={(event) =>
												updateMotionRecipe(recipe, 'opacity', Number(event.currentTarget.value))}
										/></label
									>
								</div>
							</details>
						{/each}
						<p class="text-xs leading-relaxed text-muted-foreground">
							Reduced motion uses {schemeManifest.motion.reducedMotion}. Preview it with your
							operating system preference.
						</p>
					</div>
				{:else if panel === 'shell'}
					<div class="space-y-4">
						{#each [['contentMaxWidth', 'Content width'], ['sidebarWidth', 'Sidebar width'], ['headerHeight', 'Header height'], ['mobileNavigationHeight', 'Mobile navigation']] as field (field[0])}
							<label class="grid gap-1.5 text-xs font-medium"
								>{field[1]}<Input
									value={String(schemeManifest.shell[field[0] as keyof ThemeShellTokens])}
									oninput={(event) => updateValue('shell', field[0], event.currentTarget.value)}
								/></label
							>
						{/each}
						<label class="grid gap-1.5 text-xs font-medium"
							>Canvas treatment
							<Select.Root
								value={schemeManifest.shell.canvasTreatment}
								onValueChange={(value) => value && updateValue('shell', 'canvasTreatment', value)}
							>
								<Select.Trigger class="w-full"
									>{schemeManifest.shell.canvasTreatment}</Select.Trigger
								>
								<Select.Content
									>{#each THEME_CANVAS_TREATMENTS as value (value)}<Select.Item {value}
											>{value}</Select.Item
										>{/each}</Select.Content
								>
							</Select.Root>
						</label>
					</div>
				{:else if panel === 'components'}
					<div class="space-y-3">
						{#each THEME_COMPONENT_GROUPS as group (group.id)}
							<details
								class="rounded-[var(--theme-radius-md,var(--radius))] border border-border bg-card p-3"
								open={group.id === 'actions-navigation'}
							>
								<summary class="cursor-pointer text-sm font-semibold">{group.label}</summary>
								<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
									{group.description}
								</p>
								<div class="mt-3 grid gap-3">
									{#each group.fields as field (field)}
										<label class="grid gap-1.5 text-xs font-medium"
											>{humanizeToken(field)}
											<Select.Root
												value={String(schemeManifest.components[field])}
												onValueChange={(value) => value && updateValue('components', field, value)}
											>
												<Select.Trigger class="w-full"
													>{schemeManifest.components[field]}</Select.Trigger
												>
												<Select.Content>
													{#each THEME_COMPONENT_RECIPE_OPTIONS[field] as value (value)}
														<Select.Item {value}>{value}</Select.Item>
													{/each}
												</Select.Content>
											</Select.Root>
										</label>
									{/each}
								</div>
							</details>
						{/each}
					</div>
				{:else if panel === 'icons'}
					<div class="space-y-4">
						<p class="text-sm leading-relaxed text-muted-foreground">
							Every semantic role switches together. Provider marks and specialized editor glyphs
							stay protected.
						</p>
						<div class="space-y-2" role="radiogroup" aria-label="Icon pack">
							{#each THEME_ICON_PACK_IDS as pack (pack)}
								<button
									type="button"
									role="radio"
									aria-checked={draft.iconPack === pack}
									class="flex min-h-11 w-full items-center justify-between rounded-[var(--theme-radius-md,var(--radius))] border border-border px-3 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-checked:border-ring aria-checked:bg-accent"
									onclick={() => updateIconPack(pack)}
								>
									<span>{pack.replaceAll('-', ' ')}</span><span
										class="text-xs text-muted-foreground">Complete pack</span
									>
								</button>
							{/each}
						</div>
					</div>
				{:else if panel === 'assets'}
					<div class="space-y-5">
						<div
							class="space-y-3 rounded-[var(--theme-radius-md,var(--radius))] border border-border p-3"
						>
							<div class="space-y-1">
								<label class="text-xs font-medium" for="theme-font-upload"
									>Upload a static WOFF2 font</label
								>
								<p class="text-xs leading-relaxed text-muted-foreground">
									Maximum 2 MB. Variable fonts are not supported because OpenPost also prepares a
									native-safe copy for mobile.
								</p>
							</div>
							<Input bind:value={fontFamily} placeholder="Font family" aria-label="Font family" />
							{#if fontFamily.trim() && !fontFamilyValid}<p class="text-xs text-destructive">
									Use letters, numbers, spaces, commas, periods, apostrophes, or hyphens.
								</p>{/if}
							<div class="grid grid-cols-2 gap-2">
								<label class="grid gap-1.5 text-xs font-medium"
									>Weight<Input
										type="number"
										min="100"
										max="900"
										step="100"
										bind:value={fontWeight}
									/></label
								>
								<label class="grid gap-1.5 text-xs font-medium"
									>Style<Select.Root bind:value={fontStyle}
										><Select.Trigger class="w-full">{fontStyle}</Select.Trigger><Select.Content
											><Select.Item value="normal">normal</Select.Item><Select.Item value="italic"
												>italic</Select.Item
											></Select.Content
										></Select.Root
									></label
								>
							</div>
							<label class="grid gap-1.5 text-xs font-medium"
								>Loading<Select.Root bind:value={fontDisplay}
									><Select.Trigger class="w-full">{fontDisplay}</Select.Trigger><Select.Content
										><Select.Item value="swap">swap</Select.Item><Select.Item value="fallback"
											>fallback</Select.Item
										><Select.Item value="optional">optional</Select.Item></Select.Content
									></Select.Root
								></label
							>
							<Input
								id="theme-font-upload"
								type="file"
								accept=".woff2,font/woff2"
								disabled={!onUploadFont ||
									!fontFamilyValid ||
									!fontWeightValid ||
									fontFaceAlreadyUploaded ||
									!licenseAcknowledged ||
									editorBusy}
								onchange={(event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = '';
									if (file) void uploadFont(file);
								}}
							/>
							{#if fontFaceAlreadyUploaded}<p class="text-xs text-warning">
									That family, weight, and style is already uploaded.
								</p>{/if}
							<div class="flex min-h-11 items-center gap-2">
								<Checkbox id="theme-font-license" bind:checked={licenseAcknowledged} />
								<label
									for="theme-font-license"
									class="text-xs leading-relaxed text-muted-foreground"
								>
									I have the right to use this font.
								</label>
							</div>
						</div>
						<div
							class="space-y-3 rounded-[var(--theme-radius-md,var(--radius))] border border-border p-3"
						>
							<label class="text-xs font-medium" for="theme-asset-upload"
								>Upload decorative image</label
							>
							<p class="text-xs leading-relaxed text-muted-foreground">
								PNG, JPEG, WebP, or AVIF. Maximum 5 MB, 32 megapixels, and 8192px per side.
							</p>
							<label class="grid gap-1.5 text-xs font-medium"
								>Slot<Select.Root bind:value={assetSlot}
									><Select.Trigger class="w-full">{assetSlot}</Select.Trigger><Select.Content
										>{#each THEME_ASSET_SLOTS as slot (slot)}<Select.Item value={slot}
												>{humanizeToken(slot)}</Select.Item
											>{/each}</Select.Content
									></Select.Root
								></label
							>
							<Input
								bind:value={assetAlt}
								placeholder="Alt text when the image conveys meaning"
								aria-label="Decorative image alt text"
							/>
							<p class="text-right text-xs text-muted-foreground tabular-nums">
								{themeCodePointLength(assetAlt)}/240
							</p>
							<Input
								id="theme-asset-upload"
								type="file"
								accept="image/png,image/jpeg,image/webp,image/avif"
								disabled={!onUploadAsset || assetSlotInUse || !assetAltValid || editorBusy}
								onchange={(event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = '';
									if (file) void uploadAsset(file);
								}}
							/>
							{#if assetNeedsAlt && !assetAlt.trim()}<p class="text-xs text-muted-foreground">
									Add alt text for this in-product illustration.
								</p>{/if}
							{#if themeCodePointLength(assetAlt) > 240}<p class="text-xs text-destructive">
									Alt text must contain at most 240 characters.
								</p>{/if}
							{#if assetSlotInUse}<p class="text-xs text-warning">
									Remove the current {humanizeToken(assetSlot).toLowerCase()} before uploading another.
								</p>{/if}
						</div>
						<div class="divide-y divide-border border-y border-border">
							{#each [...draft.fonts, ...draft.assets] as resource (resource.id)}
								<div class="flex items-center justify-between gap-3 py-2.5">
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">
											{'family' in resource ? resource.family : resource.alt || resource.id}
										</p>
										<p class="text-xs text-muted-foreground">
											{'format' in resource ? 'Font' : resource.slot}
										</p>
									</div>
									<Button
										size="sm"
										intent="destructive"
										disabled={!onRemoveResource ||
											editorBusy ||
											('family' in resource && isThemeFontInUse(draft, resource.id))}
										title={'family' in resource && isThemeFontInUse(draft, resource.id)
											? 'Choose another font for every type role before removing this face'
											: undefined}
										onclick={() => {
											resourceDeleteCandidate = {
												id: resource.id,
												label: 'family' in resource ? resource.family : resource.alt || resource.id
											};
											resourceDeleteDialogOpen = true;
										}}>Remove</Button
									>
								</div>
							{/each}
							{#if draft.fonts.length + draft.assets.length === 0}<p
									class="py-4 text-sm text-muted-foreground"
								>
									No uploaded resources.
								</p>{/if}
						</div>
					</div>
				{:else if panel === 'revisions'}
					<div class="divide-y divide-border border-y border-border">
						{#each revisions as revision (revision.revision)}
							<div class="flex items-center justify-between gap-3 py-3">
								<div>
									<p class="text-sm font-medium">
										{revision.label}{#if revision.current}
											· Current{/if}
									</p>
									<p class="mt-0.5 text-xs text-muted-foreground">
										{revision.publishedAt}{#if revision.publishedBy}
											· {revision.publishedBy}{/if}
									</p>
								</div>
								{#if !revision.current}<Button
										size="sm"
										intent="ordinary"
										onclick={() => {
											rollbackCandidate = revision;
											rollbackDialogOpen = true;
										}}>Restore</Button
									>{/if}
							</div>
						{/each}
						{#if revisions.length === 0}<p class="py-4 text-sm text-muted-foreground">
								Publish the first revision to start history.
							</p>{/if}
					</div>
				{/if}

				<div class="space-y-3 border-t border-border pt-4">
					{#if THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection)}
						<label class="grid gap-1.5 text-xs font-medium"
							>Random seed<Input type="number" bind:value={randomSeed} /></label
						>
						{#if !randomSeedValid}<p class="text-xs text-destructive">
								Use a whole number for deterministic randomization.
							</p>{/if}
					{/if}
					<div class="flex flex-wrap gap-2">
						{#if THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection)}
							<Button
								size="sm"
								intent="ordinary"
								onclick={randomize}
								disabled={!schemeManifest || !randomSeedValid || editorBusy}
								>Randomize {panelLabels[panel].toLowerCase()}</Button
							>
							<Button
								size="sm"
								intent="quiet"
								onclick={randomizeAll}
								disabled={!schemeManifest || !randomSeedValid || editorBusy}>Randomize theme</Button
							>
							<Button size="sm" intent="quiet" onclick={resetTheme} disabled={editorBusy}
								>Reset theme</Button
							>
						{/if}
						<Button size="sm" intent="quiet" onclick={() => void copyManifest()}
							>Copy manifest</Button
						>
					</div>
				</div>
			</section>
		{:else}
			<section class="min-w-0 space-y-3 xl:col-span-2" aria-labelledby="manifest-heading">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 id="manifest-heading" class="font-semibold">Full manifest</h2>
						<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
							Edit the complete visual document. OpenPost keeps the theme ID and revision; unknown
							or missing roles cannot be published.
						</p>
					</div>
					<div class="flex gap-2">
						<Button size="sm" intent="quiet" onclick={() => void copyManifest()}>Copy</Button
						><Button size="sm" intent="primary" onclick={applyManifestSource}>Apply manifest</Button
						>
					</div>
				</div>
				<Textarea
					bind:value={manifestSource}
					class="min-h-[42rem] resize-y font-mono text-xs"
					aria-label="Theme manifest JSON"
					aria-invalid={Boolean(manifestError)}
				/>
				{#if manifestSourceDirty && !manifestError}
					<p class="text-xs text-muted-foreground" role="status">
						Apply the manifest before saving or publishing.
					</p>
				{/if}
				{#if manifestError}<p class="text-sm text-destructive" role="alert">{manifestError}</p>{/if}
			</section>
		{/if}

		<section
			class="min-w-0 space-y-3 xl:sticky xl:top-20 xl:self-start"
			aria-labelledby="preview-heading"
		>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id="preview-heading" class="font-semibold">Product preview</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						{previewTheme.fallbackReason
							? `Workshop ${effectivePreviewScheme} fallback`
							: `${draft.name} · ${effectivePreviewScheme}`}
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<Select.Root
						value={previewScheme}
						onValueChange={(value) =>
							value && (previewScheme = value as ThemeScheme | 'editing' | 'system' | 'fallback')}
					>
						<Select.Trigger size="sm">{previewScheme}</Select.Trigger>
						<Select.Content>
							<Select.Item value="editing">Editing scheme</Select.Item>
							<Select.Item value="system">System</Select.Item>
							<Select.Item value="light">Light</Select.Item>
							<Select.Item value="dark">Dark</Select.Item>
							<Select.Item value="fallback">Fallback</Select.Item>
						</Select.Content>
					</Select.Root>
					<Select.Root
						value={scene}
						onValueChange={(value) => value && (scene = value as ThemePreviewScene)}
						><Select.Trigger size="sm">{scene}</Select.Trigger><Select.Content
							>{#each THEME_PREVIEW_SCENES as value (value)}<Select.Item {value}
									>{value}</Select.Item
								>{/each}</Select.Content
						></Select.Root
					>
					<Select.Root
						value={viewport}
						onValueChange={(value) => value && (viewport = value as ThemePreviewViewport)}
						><Select.Trigger size="sm">{viewport}</Select.Trigger><Select.Content
							><Select.Item value="desktop">Desktop</Select.Item><Select.Item value="phone"
								>390px</Select.Item
							><Select.Item value="phone-small">320px</Select.Item></Select.Content
						></Select.Root
					>
				</div>
			</div>
			<ThemePreview
				theme={previewTheme}
				{scene}
				{viewport}
				label={`${draft.name} ${effectivePreviewScheme} ${scene} preview`}
				interactive
			/>
			{#if previewTheme.fallbackReason}<p
					class="rounded-[var(--theme-radius-md,var(--radius))] border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-foreground"
					role="status"
				>
					{previewFallbackMessage}
				</p>{/if}
			{#if validationIssues.length > 0}<div
					class="space-y-2 rounded-[var(--theme-radius-lg,var(--radius))] border border-destructive/35 bg-destructive/8 p-3"
					aria-label="Validation issues"
				>
					{#each validationIssues as issue (`${issue.path}:${issue.message}`)}<p class="text-xs">
							<span class="font-mono font-semibold">{issue.path}</span>
							{issue.message}
						</p>{/each}
				</div>{/if}
			{#if localValidationError}<div
					class="rounded-[var(--theme-radius-lg,var(--radius))] border border-destructive/35 bg-destructive/8 p-3 text-xs"
					role="alert"
				>
					The current draft is incomplete: {localValidationError}
				</div>{/if}
		</section>
	</div>

	<div class="sr-only" aria-live="polite">{statusMessage}</div>
</div>

<Dialog.Root bind:open={rollbackDialogOpen}>
	<Dialog.Content
		showCloseButton={false}
		class="sm:max-w-md"
		aria-busy={pendingOperation === 'rollback'}
	>
		<Dialog.Header>
			<Dialog.Title>Restore {rollbackCandidate?.label ?? 'this revision'}?</Dialog.Title>
			<Dialog.Description>
				OpenPost will publish its complete manifest as a new revision and make it the active draft.
				Existing history stays available.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				intent="quiet"
				disabled={pendingOperation === 'rollback'}
				onclick={() => (rollbackDialogOpen = false)}>Cancel</Button
			>
			<Button
				intent="primary"
				disabled={pendingOperation === 'rollback'}
				onclick={() => void confirmRollback()}
			>
				{pendingOperation === 'rollback' ? 'Restoring…' : 'Restore revision'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={resourceDeleteDialogOpen}>
	<Dialog.Content
		showCloseButton={false}
		class="sm:max-w-md"
		aria-busy={pendingOperation === 'remove-resource'}
	>
		<Dialog.Header>
			<Dialog.Title>Remove {resourceDeleteCandidate?.label ?? 'this resource'}?</Dialog.Title>
			<Dialog.Description>
				The draft will stop using this upload. OpenPost will reject the change if a typography or
				asset role still depends on it.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				intent="quiet"
				disabled={pendingOperation === 'remove-resource'}
				onclick={() => (resourceDeleteDialogOpen = false)}>Keep resource</Button
			>
			<Button
				intent="destructive"
				disabled={pendingOperation === 'remove-resource'}
				onclick={() => void removeResource()}
			>
				{pendingOperation === 'remove-resource' ? 'Removing…' : 'Remove resource'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={removeSchemeDialogOpen}>
	<Dialog.Content showCloseButton={false} class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Remove the {scheme} scheme?</Dialog.Title>
			<Dialog.Description>
				All {scheme} values in this draft will be removed. People using {scheme} appearance will see the
				complete Workshop {scheme} theme instead.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button intent="quiet" onclick={() => (removeSchemeDialogOpen = false)}>Keep scheme</Button>
			<Button intent="destructive" onclick={removeScheme}>Remove scheme</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={reloadDialogOpen}>
	<Dialog.Content
		showCloseButton={false}
		class="sm:max-w-md"
		aria-busy={pendingOperation === 'reload'}
	>
		<Dialog.Header>
			<Dialog.Title>Discard local changes?</Dialog.Title>
			<Dialog.Description>
				Reloading replaces this editor with the latest server draft. Copy the manifest first if you
				want to keep these changes.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				intent="quiet"
				disabled={pendingOperation === 'reload'}
				onclick={() => (reloadDialogOpen = false)}>Keep editing</Button
			>
			<Button
				intent="destructive"
				disabled={pendingOperation === 'reload'}
				onclick={() => void confirmReload()}
			>
				{pendingOperation === 'reload' ? 'Reloading…' : 'Discard and reload'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
