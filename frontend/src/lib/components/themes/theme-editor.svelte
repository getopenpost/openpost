<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { ImageEditorHistory } from '$lib/image-editor/history';
	import { getCurrentLocale, onLocaleChange } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import {
		BUNDLED_THEME_FONTS,
		BUNDLED_THEME_FONT_IDS,
		THEME_ICON_PACK_IDS,
		resolveBuiltInTheme,
		type ThemeIconPackId,
		type ThemeManifest,
		type ThemeMotionRecipeName,
		type ThemeScheme,
		type ThemeSchemeManifest,
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
	import ThemeEditorResourcesPanel from './theme-editor-resources-panel.svelte';
	import ThemeEditorRevisionsPanel from './theme-editor-revisions-panel.svelte';
	import ThemeEditorTokenPanel from './theme-editor-token-panel.svelte';
	import {
		parseThemeEditorValidationMessage,
		parseThemeExternalErrorMessage,
		themeSchemeLabel,
		themeValidationIssueMessage
	} from './theme-editor-presenter';
	import type {
		ThemeAssetUploadInput,
		ThemeEditorPanel,
		ThemeFontUploadInput,
		ThemeRevisionItem,
		ThemeValidationIssue
	} from './theme-editor-types';

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
	let historyVersion = $state(0);
	let rollbackCandidate = $state<ThemeRevisionItem | null>(null);
	let rollbackDialogOpen = $state(false);
	let reloadDialogOpen = $state(false);
	let removeSchemeDialogOpen = $state(false);
	let activeLocale = $state(untrack(getCurrentLocale));
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
	const schemeLabel = $derived(themeSchemeLabel(scheme, activeLocale));
	const effectivePreviewSchemeLabel = $derived(
		themeSchemeLabel(effectivePreviewScheme, activeLocale)
	);
	const previewTheme = $derived(
		resolvePreview(draft, effectivePreviewScheme, previewScheme === 'fallback')
	);
	const previewFallbackMessage = $derived.by(() => {
		const options = { locale: activeLocale } as const;
		return previewTheme.fallbackReason === 'unsupported-scheme'
			? m.theme_editor_preview_unsupported(
					{
						name: draft.name,
						scheme: effectivePreviewSchemeLabel
					},
					options
				)
			: previewTheme.fallbackReason === 'unsafe-resource' ||
				  previewTheme.fallbackReason === 'resource-failed'
				? m.theme_editor_preview_unsafe_resource({}, options)
				: m.theme_editor_preview_fallback({}, options);
	});
	const localValidationError = $derived.by(() => {
		try {
			parseThemeManifest(serializeThemeManifest(draft));
			return '';
		} catch (error) {
			return parseThemeEditorValidationMessage(error, activeLocale);
		}
	});
	const issueCount = $derived(
		validationIssues.length + (manifestError ? 1 : 0) + (localValidationError ? 1 : 0)
	);
	const editorBusy = $derived(busy || pendingOperation !== null);
	const randomSeedValid = $derived(Number.isSafeInteger(randomSeed));

	const panelLabels: Record<ThemeEditorPanel, string> = $derived.by(() => {
		const options = { locale: activeLocale } as const;
		return {
			colors: m.theme_editor_panel_color({}, options),
			typography: m.theme_editor_panel_type({}, options),
			spacing: m.theme_editor_panel_spacing({}, options),
			shape: m.theme_editor_panel_geometry({}, options),
			elevation: m.theme_editor_panel_depth({}, options),
			motion: m.theme_editor_panel_motion({}, options),
			shell: m.theme_editor_panel_shell({}, options),
			components: m.theme_editor_panel_components({}, options),
			icons: m.theme_editor_panel_icons({}, options),
			assets: m.theme_editor_panel_assets({}, options),
			revisions: m.theme_editor_panel_revisions({}, options)
		};
	});
	const guidedPanels: ThemeEditorPanel[] = [
		...THEME_EDITOR_SECTIONS,
		'icons',
		'assets',
		'revisions'
	];
	onMount(() => onLocaleChange((locale) => (activeLocale = locale)));
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
			key === 'name' ? m.theme_editor_renamed() : m.theme_editor_description_updated(),
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
		applyDraft(
			m.theme_editor_section_updated({ section: panelLabels[section].toLowerCase() }),
			next,
			`${scheme}-${section}-${key}`
		);
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
		applyDraft(m.theme_editor_type_updated(), next, `${scheme}-typography-${role}-${key}`);
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
		applyDraft(m.theme_editor_typeface_changed(), next, `${scheme}-typography-${role}-family`);
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
		applyDraft(m.theme_editor_motion_updated(), next, `${scheme}-motion-${recipe}-${key}`);
	}

	function updateIconPack(value: string) {
		if (!THEME_ICON_PACK_IDS.includes(value as ThemeIconPackId)) return;
		applyDraft(m.theme_editor_icon_pack_changed(), {
			...cloneTheme(draft),
			iconPack: value as ThemeIconPackId
		});
	}

	function undo() {
		draft = history.undo(cloneTheme(draft));
		historyVersion += 1;
		statusMessage = history.redoLabel
			? m.theme_editor_undid({ change: history.redoLabel })
			: m.theme_editor_undo_done();
	}

	function redo() {
		draft = history.redo(cloneTheme(draft));
		historyVersion += 1;
		statusMessage = history.undoLabel
			? m.theme_editor_redid({ change: history.undoLabel })
			: m.theme_editor_redo_done();
	}

	function resetSection() {
		if (!THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection)) return;
		const sectionBaseline = cloneTheme(baseline);
		sectionBaseline.schemes[scheme] ??= cloneTheme(
			resolveBuiltInTheme('workshop', scheme).manifest
		);
		applyDraft(
			m.theme_editor_section_reset({ section: panelLabels[panel].toLowerCase() }),
			resetThemeSection(cloneTheme(draft), sectionBaseline, scheme, panel as ThemeEditorSection)
		);
	}

	function resetTheme() {
		applyDraft(m.theme_editor_theme_reset(), cloneTheme(baseline));
	}

	function randomize() {
		const section = THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection)
			? (panel as ThemeEditorSection)
			: undefined;
		applyDraft(
			section
				? m.theme_editor_section_randomized({ section: panelLabels[section].toLowerCase() })
				: m.theme_editor_theme_randomized(),
			randomizeThemeManifest(cloneTheme(draft), scheme, randomSeed, section)
		);
		randomSeed += 1;
	}

	function randomizeAll() {
		applyDraft(
			m.theme_editor_theme_randomized(),
			randomizeThemeManifest(cloneTheme(draft), scheme, randomSeed)
		);
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
		applyDraft(m.theme_editor_scheme_added({ scheme: schemeLabel }), next);
	}

	function removeScheme() {
		if (draft.supportedSchemes.length <= 1 || !draft.schemes[scheme]) return;
		const next = cloneTheme(draft);
		delete next.schemes[scheme];
		next.supportedSchemes = next.supportedSchemes.filter((candidate) => candidate !== scheme);
		applyDraft(m.theme_editor_scheme_removed({ scheme: schemeLabel }), next);
		removeSchemeDialogOpen = false;
	}

	function applyManifestSource(): boolean {
		try {
			const parsed = parseThemeManifest(manifestSource);
			if (parsed.id !== draft.id) {
				throw new Error(m.theme_editor_id_managed({}, { locale: activeLocale }));
			}
			if (parsed.revision !== draft.revision) {
				throw new Error(m.theme_editor_revision_managed({}, { locale: activeLocale }));
			}
			applyDraft(m.theme_editor_manifest_applied(), parsed);
			manifestSource = serializeThemeManifest(parsed);
			manifestError = '';
			return true;
		} catch (error) {
			manifestError = parseThemeEditorValidationMessage(error, activeLocale);
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
			operationError = m.theme_editor_clipboard_unavailable();
			return;
		}
		try {
			await navigator.clipboard.writeText(
				editorMode === 'manifest' ? manifestSource : serializeThemeManifest(draft)
			);
			operationError = '';
			statusMessage = m.theme_editor_manifest_copied();
		} catch {
			operationError = m.theme_editor_manifest_copy_failed();
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

	async function save() {
		if (!onSave || pendingOperation) return;
		pendingOperation = 'save';
		operationError = '';
		try {
			const result = await onSave(cloneTheme(draft));
			if (result) draft = cloneTheme(result);
			savedFingerprint = themeEditorFingerprint(draft);
			manifestSource = serializeThemeManifest(draft);
			statusMessage = m.theme_editor_draft_saved();
		} catch (error) {
			operationError = parseThemeExternalErrorMessage(
				error,
				m.theme_editor_draft_save_failed({}, { locale: activeLocale }),
				activeLocale
			);
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
			statusMessage = m.theme_editor_theme_published();
		} catch (error) {
			operationError = parseThemeExternalErrorMessage(
				error,
				m.theme_editor_publish_failed({}, { locale: activeLocale }),
				activeLocale
			);
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
			adoptServerTheme(result, m.theme_editor_revision_restored({ revision }));
			return true;
		} catch (error) {
			operationError = parseThemeExternalErrorMessage(
				error,
				m.theme_editor_restore_failed({}, { locale: activeLocale }),
				activeLocale
			);
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
			adoptServerTheme(result, m.theme_editor_theme_reloaded());
			return true;
		} catch (error) {
			operationError = parseThemeExternalErrorMessage(
				error,
				m.theme_editor_reload_failed({}, { locale: activeLocale }),
				activeLocale
			);
			return false;
		} finally {
			pendingOperation = null;
		}
	}

	async function confirmReload() {
		if (await reload()) reloadDialogOpen = false;
	}

	function previewSchemeLabel(value: typeof previewScheme): string {
		switch (value) {
			case 'editing':
				return m.theme_editor_editing_scheme();
			case 'system':
				return m.sidebar_appearance_system();
			case 'light':
				return m.sidebar_appearance_light();
			case 'dark':
				return m.sidebar_appearance_dark();
			case 'fallback':
				return m.theme_editor_fallback();
		}
	}

	function previewSceneLabel(value: ThemePreviewScene): string {
		return {
			shell: m.theme_preview_scene_shell(),
			dashboard: m.theme_preview_scene_dashboard(),
			cards: m.theme_preview_scene_cards(),
			composer: m.theme_preview_scene_composer(),
			calendar: m.theme_preview_scene_calendar(),
			settings: m.theme_preview_scene_settings(),
			forms: m.theme_preview_scene_forms(),
			tables: m.theme_preview_scene_tables(),
			dialog: m.theme_preview_scene_dialog(),
			notices: m.theme_preview_scene_notices(),
			empty: m.theme_preview_scene_empty(),
			loading: m.theme_preview_scene_loading(),
			'image-editor': m.theme_preview_scene_image_editor(),
			'video-editor': m.theme_preview_scene_video_editor()
		}[value];
	}

	function previewViewportLabel(value: ThemePreviewViewport): string {
		return value === 'desktop'
			? m.theme_editor_desktop()
			: value === 'phone'
				? m.theme_editor_phone_width()
				: m.theme_editor_small_phone_width();
	}
</script>

{#key activeLocale}
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
					aria-label={m.theme_library_theme_name()}
					class="border-transparent bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:px-2"
				/>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{hasUnsavedWork
						? m.theme_editor_unsaved_changes()
						: m.theme_editor_revision({ revision: draft.revision })}
					{#if issueCount > 0}
						· {m.theme_editor_issue_count({ count: issueCount })}{/if}
				</p>
			</div>

			<div
				class="flex min-h-11 items-center rounded-[var(--theme-radius-md,var(--radius))] bg-muted p-1"
				role="group"
				aria-label={m.theme_editor_mode()}
			>
				<button
					type="button"
					class="min-h-11 rounded-[var(--theme-radius-sm,var(--radius))] px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-background aria-pressed:shadow-sm"
					aria-pressed={editorMode === 'guided'}
					onclick={() => selectEditorMode('guided')}>{m.theme_editor_guided()}</button
				>
				<button
					type="button"
					class="min-h-11 rounded-[var(--theme-radius-sm,var(--radius))] px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-background aria-pressed:shadow-sm"
					aria-pressed={editorMode === 'manifest'}
					onclick={() => selectEditorMode('manifest')}>{m.theme_editor_manifest()}</button
				>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				<Button size="sm" intent="quiet" onclick={undo} disabled={!canUndo || editorBusy}
					>{m.theme_editor_undo()}</Button
				>
				<Button size="sm" intent="quiet" onclick={redo} disabled={!canRedo || editorBusy}
					>{m.theme_editor_redo()}</Button
				>
				<Button
					size="sm"
					intent="ordinary"
					onclick={() => void save()}
					disabled={!onSave || !dirty || manifestSourceDirty || editorBusy}
					>{m.theme_editor_save_draft()}</Button
				>
				<Button
					size="sm"
					intent="focal"
					onclick={() => void publish()}
					disabled={!onPublish ||
						!canPublish ||
						editorBusy ||
						manifestSourceDirty ||
						issueCount > 0}
					>{pendingOperation === 'publish'
						? m.theme_editor_publishing()
						: m.theme_editor_publish()}</Button
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
						<Button
							size="sm"
							intent="quiet"
							onclick={() => void copyManifest()}
							disabled={editorBusy}>{m.theme_editor_copy_manifest()}</Button
						>
						<Button
							size="sm"
							intent="ordinary"
							onclick={() => (reloadDialogOpen = true)}
							disabled={editorBusy}>{m.theme_editor_reload_latest()}</Button
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
					>{m.theme_editor_description()}</label
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
				placeholder={m.theme_editor_description_placeholder()}
				class="min-h-16 resize-y"
			/>
		</section>

		<div class="grid min-w-0 gap-4 xl:grid-cols-[10.5rem_minmax(17rem,21rem)_minmax(24rem,1fr)]">
			{#if editorMode === 'guided'}
				<nav
					class="flex gap-1 overflow-x-auto border-b border-border pb-2 xl:block xl:space-y-1 xl:overflow-visible xl:border-r xl:border-b-0 xl:pr-3 xl:pb-0"
					aria-label={m.theme_editor_sections()}
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
								{m.theme_editor_changes_preview()}
							</p>
						</div>
						{#if THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection) && schemeManifest}
							<Button size="sm" intent="quiet" onclick={resetSection} disabled={editorBusy}
								>{m.theme_editor_reset_section()}</Button
							>
						{/if}
					</div>

					<div
						class="grid grid-cols-2 gap-2"
						role="group"
						aria-label={m.theme_editor_scheme_to_edit()}
					>
						{#each ['light', 'dark'] as candidate (candidate)}
							<button
								type="button"
								class="min-h-11 rounded-[var(--theme-radius-md,var(--radius))] border border-border px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
								aria-pressed={scheme === candidate}
								onclick={() => (scheme = candidate as ThemeScheme)}
							>
								{candidate === 'light' ? m.sidebar_appearance_light() : m.sidebar_appearance_dark()}
								{#if !draft.schemes[candidate as ThemeScheme]}<span
										class="ml-1 text-xs font-normal opacity-65">{m.theme_editor_fallback()}</span
									>{/if}
							</button>
						{/each}
					</div>
					{#if schemeManifest && draft.supportedSchemes.length > 1}
						<div class="flex justify-end">
							<Button
								size="sm"
								intent="destructive"
								onclick={() => (removeSchemeDialogOpen = true)}
							>
								{m.theme_editor_remove_scheme({ scheme: schemeLabel })}
							</Button>
						</div>
					{/if}

					{#if !schemeManifest}
						<div
							class="rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-muted/55 p-4"
						>
							<p class="text-sm font-medium">
								{m.theme_editor_scheme_unsupported({ scheme: schemeLabel })}
							</p>
							<p class="mt-1 text-sm leading-relaxed text-muted-foreground">
								{m.theme_editor_scheme_unsupported_description({ scheme: schemeLabel })}
							</p>
							<Button class="mt-3" size="sm" intent="primary" onclick={addScheme}
								>{m.theme_editor_add_scheme({ scheme: schemeLabel })}</Button
							>
						</div>
					{:else if panel === 'assets'}
						<ThemeEditorResourcesPanel
							theme={draft}
							busy={editorBusy}
							actions={{
								uploadFont: onUploadFont,
								uploadAsset: onUploadAsset,
								remove: onRemoveResource
							}}
							onAdopt={adoptServerTheme}
							onError={(message) => (operationError = message)}
							onPendingChange={(operation) => (pendingOperation = operation)}
							locale={activeLocale}
						/>
					{:else if panel === 'revisions'}
						<ThemeEditorRevisionsPanel
							{revisions}
							onRestore={(revision) => {
								rollbackCandidate = revision;
								rollbackDialogOpen = true;
							}}
						/>
					{:else}
						<ThemeEditorTokenPanel
							panel={panel as ThemeEditorSection | 'icons'}
							theme={draft}
							manifest={schemeManifest}
							onUpdateValue={updateValue}
							onUpdateTypography={updateTypographyRole}
							onUpdateFontFamily={updateFontFamily}
							onUpdateMotion={updateMotionRecipe}
							onUpdateIconPack={updateIconPack}
							locale={activeLocale}
						/>
					{/if}

					<div class="space-y-3 border-t border-border pt-4">
						{#if THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection)}
							<label class="grid gap-1.5 text-xs font-medium"
								>{m.theme_editor_random_seed()}<Input
									type="number"
									bind:value={randomSeed}
								/></label
							>
							{#if !randomSeedValid}<p class="text-xs text-destructive">
									{m.theme_editor_random_seed_error()}
								</p>{/if}
						{/if}
						<div class="flex flex-wrap gap-2">
							{#if THEME_EDITOR_SECTIONS.includes(panel as ThemeEditorSection)}
								<Button
									size="sm"
									intent="ordinary"
									onclick={randomize}
									disabled={!schemeManifest || !randomSeedValid || editorBusy}
									>{m.theme_editor_randomize_section({
										section: panelLabels[panel].toLowerCase()
									})}</Button
								>
								<Button
									size="sm"
									intent="quiet"
									onclick={randomizeAll}
									disabled={!schemeManifest || !randomSeedValid || editorBusy}
									>{m.theme_editor_randomize_theme()}</Button
								>
								<Button size="sm" intent="quiet" onclick={resetTheme} disabled={editorBusy}
									>{m.theme_editor_reset_theme()}</Button
								>
							{/if}
							<Button size="sm" intent="quiet" onclick={() => void copyManifest()}
								>{m.theme_editor_copy_manifest()}</Button
							>
						</div>
					</div>
				</section>
			{:else}
				<section class="min-w-0 space-y-3 xl:col-span-2" aria-labelledby="manifest-heading">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 id="manifest-heading" class="font-semibold">{m.theme_editor_full_manifest()}</h2>
							<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
								{m.theme_editor_full_manifest_description()}
							</p>
						</div>
						<div class="flex gap-2">
							<Button size="sm" intent="quiet" onclick={() => void copyManifest()}
								>{m.common_copy()}</Button
							><Button size="sm" intent="primary" onclick={applyManifestSource}
								>{m.theme_editor_apply_manifest()}</Button
							>
						</div>
					</div>
					<Textarea
						bind:value={manifestSource}
						class="min-h-[42rem] resize-y font-mono text-xs"
						aria-label={m.theme_editor_manifest_json()}
						aria-invalid={Boolean(manifestError)}
					/>
					{#if manifestSourceDirty && !manifestError}
						<p class="text-xs text-muted-foreground" role="status">
							{m.theme_editor_apply_before_save()}
						</p>
					{/if}
					{#if manifestError}<p class="text-sm text-destructive" role="alert">
							{manifestError}
						</p>{/if}
				</section>
			{/if}

			<section
				class="min-w-0 space-y-3 xl:sticky xl:top-20 xl:self-start"
				aria-labelledby="preview-heading"
			>
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 id="preview-heading" class="font-semibold">{m.theme_editor_product_preview()}</h2>
						<p class="mt-1 text-xs text-muted-foreground">
							{previewTheme.fallbackReason
								? m.theme_editor_workshop_fallback({ scheme: effectivePreviewSchemeLabel })
								: m.theme_editor_preview_name({
										name: draft.name,
										scheme: effectivePreviewSchemeLabel
									})}
						</p>
					</div>
					<div class="flex flex-wrap gap-2">
						<Select.Root
							value={previewScheme}
							onValueChange={(value) =>
								value && (previewScheme = value as ThemeScheme | 'editing' | 'system' | 'fallback')}
						>
							<Select.Trigger size="sm" aria-label={m.theme_editor_preview_scheme()}
								>{previewSchemeLabel(previewScheme)}</Select.Trigger
							>
							<Select.Content>
								<Select.Item value="editing">{m.theme_editor_editing_scheme()}</Select.Item>
								<Select.Item value="system">{m.sidebar_appearance_system()}</Select.Item>
								<Select.Item value="light">{m.sidebar_appearance_light()}</Select.Item>
								<Select.Item value="dark">{m.sidebar_appearance_dark()}</Select.Item>
								<Select.Item value="fallback">{m.theme_editor_fallback()}</Select.Item>
							</Select.Content>
						</Select.Root>
						<Select.Root
							value={scene}
							onValueChange={(value) => value && (scene = value as ThemePreviewScene)}
							><Select.Trigger size="sm" aria-label={m.theme_editor_preview_scene()}
								>{previewSceneLabel(scene)}</Select.Trigger
							><Select.Content
								>{#each THEME_PREVIEW_SCENES as value (value)}<Select.Item {value}
										>{previewSceneLabel(value)}</Select.Item
									>{/each}</Select.Content
							></Select.Root
						>
						<Select.Root
							value={viewport}
							onValueChange={(value) => value && (viewport = value as ThemePreviewViewport)}
							><Select.Trigger size="sm" aria-label={m.theme_editor_preview_viewport()}
								>{previewViewportLabel(viewport)}</Select.Trigger
							><Select.Content
								><Select.Item value="desktop">{m.theme_editor_desktop()}</Select.Item><Select.Item
									value="phone">390px</Select.Item
								><Select.Item value="phone-small">320px</Select.Item></Select.Content
							></Select.Root
						>
					</div>
				</div>
				<ThemePreview
					theme={previewTheme}
					{scene}
					{viewport}
					label={m.theme_editor_preview_label({
						name: draft.name,
						scheme: effectivePreviewSchemeLabel,
						scene: previewSceneLabel(scene)
					})}
					locale={activeLocale}
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
						aria-label={m.theme_editor_validation_issues()}
					>
						{#each validationIssues as issue (`${issue.path}:${issue.message}`)}<p class="text-xs">
								<span class="font-mono font-semibold">{issue.path}</span>
								{themeValidationIssueMessage(activeLocale)}
							</p>{/each}
					</div>{/if}
				{#if localValidationError}<div
						class="rounded-[var(--theme-radius-lg,var(--radius))] border border-destructive/35 bg-destructive/8 p-3 text-xs"
						role="alert"
					>
						{m.theme_editor_draft_incomplete({ error: localValidationError })}
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
				<Dialog.Title>
					{m.theme_editor_restore_title({
						revision: rollbackCandidate?.label ?? m.theme_editor_this_revision()
					})}
				</Dialog.Title>
				<Dialog.Description>{m.theme_editor_restore_description()}</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button
					intent="quiet"
					disabled={pendingOperation === 'rollback'}
					onclick={() => (rollbackDialogOpen = false)}>{m.common_cancel()}</Button
				>
				<Button
					intent="primary"
					disabled={pendingOperation === 'rollback'}
					onclick={() => void confirmRollback()}
				>
					{pendingOperation === 'rollback'
						? m.theme_editor_restoring()
						: m.theme_editor_restore_revision()}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={removeSchemeDialogOpen}>
		<Dialog.Content showCloseButton={false} class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>{m.theme_editor_remove_scheme_title({ scheme: schemeLabel })}</Dialog.Title>
				<Dialog.Description
					>{m.theme_editor_remove_scheme_description({ scheme: schemeLabel })}</Dialog.Description
				>
			</Dialog.Header>
			<Dialog.Footer>
				<Button intent="quiet" onclick={() => (removeSchemeDialogOpen = false)}
					>{m.theme_editor_keep_scheme()}</Button
				>
				<Button intent="destructive" onclick={removeScheme}
					>{m.theme_editor_remove_scheme_action()}</Button
				>
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
				<Dialog.Title>{m.theme_editor_discard_title()}</Dialog.Title>
				<Dialog.Description>{m.theme_editor_discard_description()}</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button
					intent="quiet"
					disabled={pendingOperation === 'reload'}
					onclick={() => (reloadDialogOpen = false)}>{m.theme_editor_keep_editing()}</Button
				>
				<Button
					intent="destructive"
					disabled={pendingOperation === 'reload'}
					onclick={() => void confirmReload()}
				>
					{pendingOperation === 'reload'
						? m.theme_editor_reloading()
						: m.theme_editor_discard_reload()}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/key}
