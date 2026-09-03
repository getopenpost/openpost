import { resolveBuiltInTheme } from './builtins.js';
import {
	THEME_COLOR_TOKEN_KEYS,
	THEME_BORDER_STYLES,
	THEME_CANVAS_TREATMENTS,
	THEME_COMPONENT_RECIPE_KEYS,
	THEME_COMPONENT_RECIPE_OPTIONS,
	THEME_DENSITIES,
	THEME_MOTION_RECIPE_KEYS,
	THEME_PROTECTED_EDITOR_TOKEN_KEYS,
	THEME_REDUCED_MOTION_OPTIONS,
	THEME_TYPOGRAPHY_ROLE_KEYS,
	type ResolvedTheme,
	type ThemeAsset,
	type ThemeAssetSlot,
	type ThemeComponentRecipe,
	type ThemeIconPackId,
	type ThemeMotionRecipe,
	type ThemeScheme,
	type ThemeSchemeManifest,
	type ThemeTypographyRoleTokens,
	type WebResolvedTheme
} from './contracts.js';
import {
	createThemeFontPlan,
	stageThemeFontPlan,
	themeFontEnvironmentForDocument,
	type ThemeFontPlan,
	type ThemeFontStage
} from './font-stage.js';
import { PROTECTED_EDITOR_TOKENS } from './protected.js';
import { isSafeThemeSchemeManifestValues } from './validation.js';

export interface ThemeScope {
	style: {
		setProperty(name: string, value: string): void;
		removeProperty(name: string): void;
	};
	classList?: {
		toggle(name: string, force?: boolean): boolean;
		contains(name: string): boolean;
	};
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
	getAttribute(name: string): string | null;
	dispatchEvent?(event: Event): boolean;
}

export interface ThemeRuntimeLoaders {
	stageFonts(plan: ThemeFontPlan): Promise<ThemeFontStage>;
	loadAssets(assets: readonly ThemeAsset[]): Promise<void>;
	loadIconPack(pack: ThemeIconPackId): Promise<void>;
	setBrowserSurface(color: string): () => void;
}

interface PreparedTheme {
	resolved: WebResolvedTheme;
	variables: ThemeCssVariables;
	fontStage: ThemeFontStage;
}

export interface ThemeCssVariables {
	[variable: `--${string}`]: string;
}

const typographyRoleKeys = [
	'family',
	'fallbacks',
	'weight',
	'size',
	'lineHeight',
	'tracking'
] as const;
const spacingKeys = [
	'density',
	'base',
	'controlHeight',
	'compactControlHeight',
	'touchTarget',
	'pageGutter',
	'sectionGap',
	'componentGap'
] as const;
const spacingValueKeys = spacingKeys.filter((key) => key !== 'density');
const cornerKeys = [
	'radius',
	'radiusSm',
	'radiusMd',
	'radiusLg',
	'radiusMedia',
	'radiusPill',
	'borderWidth',
	'borderStyle'
] as const;
const cornerValueKeys = cornerKeys.filter((key) => key !== 'borderStyle');
const elevationKeys = ['card', 'popover', 'dialog', 'focalAction'] as const;
const motionKeys = [...THEME_MOTION_RECIPE_KEYS, 'reducedMotion'] as const;
const motionRecipeKeys = ['duration', 'easing', 'distance', 'opacity'] as const;
const motionRecipeValueKeys = ['duration', 'easing', 'distance'] as const;
const shellKeys = [
	'contentMaxWidth',
	'sidebarWidth',
	'headerHeight',
	'mobileNavigationHeight',
	'canvasTreatment'
] as const;
const shellValueKeys = shellKeys.filter((key) => key !== 'canvasTreatment');
const assetVariables = {
	'background-texture': '--theme-asset-background-texture',
	'sidebar-decoration': '--theme-asset-sidebar-decoration',
	'header-decoration': '--theme-asset-header-decoration',
	'empty-state-illustration': '--theme-asset-empty-state-illustration',
	'loading-illustration': '--theme-asset-loading-illustration'
} satisfies Record<ThemeAssetSlot, `--theme-asset-${string}`>;

const componentAttributes = {
	button: 'data-theme-button',
	link: 'data-theme-link',
	tabs: 'data-theme-tabs',
	navigation: 'data-theme-navigation',
	input: 'data-theme-input',
	select: 'data-theme-select',
	card: 'data-theme-card',
	container: 'data-theme-container',
	table: 'data-theme-table',
	list: 'data-theme-list',
	badge: 'data-theme-badge',
	chip: 'data-theme-chip',
	dialog: 'data-theme-dialog',
	popover: 'data-theme-popover',
	toast: 'data-theme-toast',
	switch: 'data-theme-switch',
	checkbox: 'data-theme-checkbox',
	radio: 'data-theme-radio',
	toolbar: 'data-theme-toolbar',
	pagination: 'data-theme-pagination',
	emptyState: 'data-theme-empty-state',
	loadingState: 'data-theme-loading-state',
	editorChrome: 'data-theme-editor-chrome',
	decoration: 'data-theme-decoration'
} satisfies Record<ThemeComponentRecipe, `data-theme-${string}`>;

const schemeManifestKeys = [
	'colors',
	'protectedEditor',
	'typography',
	'spacing',
	'shape',
	'elevation',
	'motion',
	'shell',
	'components'
] as const;

function hasKeys<Owner extends object>(
	value: Owner | null | undefined,
	keys: readonly (keyof Owner)[]
): boolean {
	if (!value) return false;
	return Object.keys(value).length === keys.length && keys.every((key) => value[key] !== undefined);
}

function isString(value: unknown): value is string {
	return value !== Object(value) && Object.prototype.toString.call(value) === '[object String]';
}

function hasStringValues<Owner extends object>(
	value: Owner | null | undefined,
	keys: readonly (keyof Owner)[]
): boolean {
	return Boolean(value && keys.every((key) => isString(value[key])));
}

function isCompleteTypographyRole(value: ThemeTypographyRoleTokens | undefined): boolean {
	return Boolean(
		hasKeys(value, typographyRoleKeys) &&
		isString(value?.family) &&
		Array.isArray(value?.fallbacks) &&
		value.fallbacks.every(isString) &&
		Number.isInteger(value.weight) &&
		value.weight >= 100 &&
		value.weight <= 900 &&
		value.weight % 100 === 0 &&
		isString(value.size) &&
		isString(value.lineHeight) &&
		isString(value.tracking)
	);
}

function isCompleteMotionRecipe(value: ThemeMotionRecipe | undefined): boolean {
	if (!value || !hasKeys(value, motionRecipeKeys)) return false;
	return (
		hasStringValues(value, motionRecipeValueKeys) &&
		Number.isFinite(value.opacity) &&
		value.opacity >= 0 &&
		value.opacity <= 1
	);
}

export function isCompleteThemeSchemeManifest(
	value: unknown,
	scheme?: ThemeScheme
): value is ThemeSchemeManifest {
	if (value !== Object(value)) return false;
	// SAFETY: only known manifest properties are read, and every nested field is checked below.
	const candidate = value as Partial<ThemeSchemeManifest>;
	const protectedEditor = candidate.protectedEditor;
	// SAFETY: the ordered guards establish the complete manifest shape before the strict value validator runs.
	return (
		hasKeys(candidate, schemeManifestKeys) &&
		hasKeys(candidate.colors, THEME_COLOR_TOKEN_KEYS) &&
		hasStringValues(candidate.colors, THEME_COLOR_TOKEN_KEYS) &&
		hasKeys(protectedEditor, THEME_PROTECTED_EDITOR_TOKEN_KEYS) &&
		hasKeys(candidate.typography, THEME_TYPOGRAPHY_ROLE_KEYS) &&
		THEME_TYPOGRAPHY_ROLE_KEYS.every((role) =>
			isCompleteTypographyRole(candidate.typography?.[role])
		) &&
		hasKeys(candidate.spacing, spacingKeys) &&
		hasStringValues(candidate.spacing, spacingValueKeys) &&
		THEME_DENSITIES.some((density) => density === candidate.spacing?.density) &&
		hasKeys(candidate.shape, cornerKeys) &&
		hasStringValues(candidate.shape, cornerValueKeys) &&
		THEME_BORDER_STYLES.some((style) => style === candidate.shape?.borderStyle) &&
		hasKeys(candidate.elevation, elevationKeys) &&
		hasStringValues(candidate.elevation, elevationKeys) &&
		hasKeys(candidate.motion, motionKeys) &&
		THEME_MOTION_RECIPE_KEYS.every((recipe) =>
			isCompleteMotionRecipe(candidate.motion?.[recipe])
		) &&
		THEME_REDUCED_MOTION_OPTIONS.some((option) => option === candidate.motion?.reducedMotion) &&
		hasKeys(candidate.shell, shellKeys) &&
		hasStringValues(candidate.shell, shellValueKeys) &&
		THEME_CANVAS_TREATMENTS.some((treatment) => treatment === candidate.shell?.canvasTreatment) &&
		hasKeys(candidate.components, THEME_COMPONENT_RECIPE_KEYS) &&
		THEME_COMPONENT_RECIPE_KEYS.every((recipe) =>
			THEME_COMPONENT_RECIPE_OPTIONS[recipe].some(
				(option) => option === candidate.components?.[recipe]
			)
		) &&
		isSafeThemeSchemeManifestValues(candidate as ThemeSchemeManifest) &&
		(!scheme ||
			THEME_PROTECTED_EDITOR_TOKEN_KEYS.every(
				(key) => protectedEditor?.[key] === PROTECTED_EDITOR_TOKENS[scheme][key]
			))
	);
}

export function isSameOriginThemeResourceUrl(
	sourceUrl: string,
	origin = 'location' in globalThis ? globalThis.location.origin : undefined
): boolean {
	if (!sourceUrl || sourceUrl.startsWith('//')) return false;
	if (sourceUrl.startsWith('/') && !sourceUrl.startsWith('/\\')) return true;
	if (!origin) return false;
	try {
		const resource = new URL(sourceUrl, origin);
		if (resource.username || resource.password || resource.hash) return false;
		if (resource.protocol === 'blob:') return resource.origin === origin;
		return (
			(resource.protocol === 'http:' || resource.protocol === 'https:') &&
			resource.origin === origin
		);
	} catch {
		return false;
	}
}

const approvedThemeAssetMimeTypes = new Set([
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/avif'
]);

export type WebThemeResourceScope =
	| { kind: 'published'; themeId: string; revision: string }
	| { kind: 'editor-preview' };

export function isOpaqueThemeResourceUrl(
	sourceUrl: string,
	resourceScope: WebThemeResourceScope,
	origin = 'location' in globalThis ? globalThis.location.origin : undefined
): boolean {
	if (!isSameOriginThemeResourceUrl(sourceUrl, origin)) return false;
	try {
		const parsed = new URL(sourceUrl, origin ?? 'https://openpost.invalid');
		if (!/^\/api\/v1\/theme-assets\/[A-Za-z0-9_-]+\/content$/.test(parsed.pathname)) {
			return false;
		}
		if (parsed.hash) return false;
		const workspaceIds = parsed.searchParams.getAll('workspace_id');
		const organizationIds = parsed.searchParams.getAll('organization_id');
		const themeIds = parsed.searchParams.getAll('theme_id');
		const revisions = parsed.searchParams.getAll('revision');
		const isOpaqueId = (value: string | undefined) =>
			Boolean(value && /^[A-Za-z0-9_-]+$/.test(value));

		if (resourceScope.kind === 'editor-preview') {
			return (
				parsed.searchParams.size === 1 &&
				organizationIds.length === 1 &&
				isOpaqueId(organizationIds[0])
			);
		}
		if (workspaceIds.length !== 1 || !isOpaqueId(workspaceIds[0])) return false;
		return (
			parsed.searchParams.size === 3 &&
			themeIds.length === 1 &&
			isOpaqueId(themeIds[0]) &&
			revisions.length === 1 &&
			/^[1-9][0-9]*$/.test(revisions[0] ?? '') &&
			themeIds[0] === resourceScope.themeId &&
			revisions[0] === resourceScope.revision
		);
	} catch {
		return false;
	}
}

function hasSafeResources(
	theme: WebResolvedTheme,
	runtimeScope: 'application' | 'preview'
): boolean {
	if (theme.webResourceScope === 'editor-preview' && runtimeScope !== 'preview') return false;
	const resourceScope: WebThemeResourceScope =
		theme.webResourceScope === 'editor-preview'
			? { kind: 'editor-preview' }
			: { kind: 'published', themeId: theme.id, revision: theme.revision };
	const assetSlots = new Set<ThemeAssetSlot>();
	return (
		theme.fonts.every(
			(font) =>
				font.format === 'woff2' &&
				Number.isInteger(font.weight) &&
				font.weight >= 100 &&
				font.weight <= 900 &&
				font.weight % 100 === 0 &&
				isOpaqueThemeResourceUrl(font.sourceUrl, resourceScope)
		) &&
		theme.assets.every((asset) => {
			if (assetSlots.has(asset.slot)) return false;
			assetSlots.add(asset.slot);
			return (
				approvedThemeAssetMimeTypes.has(asset.mimeType) &&
				isOpaqueThemeResourceUrl(asset.sourceUrl, resourceScope)
			);
		}) &&
		createThemeFontPlan(theme) !== null
	);
}

function cssUrl(url: string): string {
	return `url("${url.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}")`;
}

function assetCssVariables(assets: readonly ThemeAsset[]): ThemeCssVariables {
	const variables: ThemeCssVariables = {
		'--theme-asset-background-texture': 'none',
		'--theme-asset-sidebar-decoration': 'none',
		'--theme-asset-header-decoration': 'none',
		'--theme-asset-empty-state-illustration': 'none',
		'--theme-asset-loading-illustration': 'none'
	};
	for (const asset of assets) variables[assetVariables[asset.slot]] = cssUrl(asset.sourceUrl);
	return variables;
}

const genericFontFamilies = new Set([
	'serif',
	'sans-serif',
	'monospace',
	'cursive',
	'fantasy',
	'system-ui',
	'ui-serif',
	'ui-sans-serif',
	'ui-monospace',
	'ui-rounded',
	'math',
	'emoji',
	'fangsong',
	'-apple-system'
]);

function cssFontName(name: string): string {
	if (genericFontFamilies.has(name)) return name;
	return JSON.stringify(name);
}

function cssFontFamily(family: string, fallbacks: readonly string[]): string {
	return [family, ...fallbacks].map(cssFontName).join(', ');
}

function typographyCssVariables(
	typography: ThemeSchemeManifest['typography'],
	familyNames: ReadonlyMap<string, string>
): ThemeCssVariables {
	const family = (source: string) => familyNames.get(source) ?? source;
	const displayFamily = cssFontFamily(
		family(typography.display.family),
		typography.display.fallbacks
	);
	const titleFamily = cssFontFamily(family(typography.title.family), typography.title.fallbacks);
	const bodyFamily = cssFontFamily(family(typography.body.family), typography.body.fallbacks);
	const labelFamily = cssFontFamily(family(typography.label.family), typography.label.fallbacks);
	const metadataFamily = cssFontFamily(
		family(typography.metadata.family),
		typography.metadata.fallbacks
	);
	const codeFamily = cssFontFamily(family(typography.code.family), typography.code.fallbacks);
	const wordmarkFamily = cssFontFamily('Manrope Variable', ['Manrope', 'system-ui', 'sans-serif']);
	return {
		'--theme-type-display-family': displayFamily,
		'--theme-type-display-weight': `${typography.display.weight}`,
		'--theme-type-display-size': typography.display.size,
		'--theme-type-display-line-height': typography.display.lineHeight,
		'--theme-type-display-tracking': typography.display.tracking,
		'--theme-type-title-family': titleFamily,
		'--theme-type-title-weight': `${typography.title.weight}`,
		'--theme-type-title-size': typography.title.size,
		'--theme-type-title-line-height': typography.title.lineHeight,
		'--theme-type-title-tracking': typography.title.tracking,
		'--theme-type-body-family': bodyFamily,
		'--theme-type-body-weight': `${typography.body.weight}`,
		'--theme-type-body-size': typography.body.size,
		'--theme-type-body-line-height': typography.body.lineHeight,
		'--theme-type-body-tracking': typography.body.tracking,
		'--theme-type-label-family': labelFamily,
		'--theme-type-label-weight': `${typography.label.weight}`,
		'--theme-type-label-size': typography.label.size,
		'--theme-type-label-line-height': typography.label.lineHeight,
		'--theme-type-label-tracking': typography.label.tracking,
		'--theme-type-metadata-family': metadataFamily,
		'--theme-type-metadata-weight': `${typography.metadata.weight}`,
		'--theme-type-metadata-size': typography.metadata.size,
		'--theme-type-metadata-line-height': typography.metadata.lineHeight,
		'--theme-type-metadata-tracking': typography.metadata.tracking,
		'--theme-type-code-family': codeFamily,
		'--theme-type-code-weight': `${typography.code.weight}`,
		'--theme-type-code-size': typography.code.size,
		'--theme-type-code-line-height': typography.code.lineHeight,
		'--theme-type-code-tracking': typography.code.tracking,
		'--theme-font-sans': bodyFamily,
		'--theme-font-brand': wordmarkFamily,
		'--theme-font-display': displayFamily,
		'--theme-font-mono': codeFamily,
		'--theme-font-body-weight': `${typography.body.weight}`,
		'--theme-font-emphasis-weight': `${typography.label.weight}`,
		'--theme-font-heading-weight': `${typography.title.weight}`,
		'--theme-letter-spacing': typography.body.tracking,
		'--theme-heading-letter-spacing': typography.title.tracking
	};
}

function motionCssVariables(motion: ThemeSchemeManifest['motion']): ThemeCssVariables {
	return {
		'--theme-motion-press-duration': motion.press.duration,
		'--theme-motion-press-easing': motion.press.easing,
		'--theme-motion-press-distance': motion.press.distance,
		'--theme-motion-press-opacity': `${motion.press.opacity}`,
		'--theme-motion-hover-duration': motion.hover.duration,
		'--theme-motion-hover-easing': motion.hover.easing,
		'--theme-motion-hover-distance': motion.hover.distance,
		'--theme-motion-hover-opacity': `${motion.hover.opacity}`,
		'--theme-motion-selection-duration': motion.selection.duration,
		'--theme-motion-selection-easing': motion.selection.easing,
		'--theme-motion-selection-distance': motion.selection.distance,
		'--theme-motion-selection-opacity': `${motion.selection.opacity}`,
		'--theme-motion-entry-duration': motion.entry.duration,
		'--theme-motion-entry-easing': motion.entry.easing,
		'--theme-motion-entry-distance': motion.entry.distance,
		'--theme-motion-entry-opacity': `${motion.entry.opacity}`,
		'--theme-motion-exit-duration': motion.exit.duration,
		'--theme-motion-exit-easing': motion.exit.easing,
		'--theme-motion-exit-distance': motion.exit.distance,
		'--theme-motion-exit-opacity': `${motion.exit.opacity}`,
		'--theme-motion-loading-duration': motion.loading.duration,
		'--theme-motion-loading-easing': motion.loading.easing,
		'--theme-motion-loading-distance': motion.loading.distance,
		'--theme-motion-loading-opacity': `${motion.loading.opacity}`,
		'--theme-motion-page-transition-duration': motion.pageTransition.duration,
		'--theme-motion-page-transition-easing': motion.pageTransition.easing,
		'--theme-motion-page-transition-distance': motion.pageTransition.distance,
		'--theme-motion-page-transition-opacity': `${motion.pageTransition.opacity}`,
		'--theme-duration-fast': motion.press.duration,
		'--theme-duration-normal': motion.hover.duration,
		'--theme-duration-slow': motion.entry.duration,
		'--theme-easing': motion.hover.easing,
		'--theme-press-distance': motion.press.distance
	};
}

export function themeSchemeToCssVariables(
	theme: WebResolvedTheme,
	familyNames = createThemeFontPlan(theme)?.familyNames ?? new Map<string, string>()
): ThemeCssVariables {
	if (!isCompleteThemeSchemeManifest(theme.manifest, theme.scheme)) {
		throw new Error('Theme manifest is incomplete');
	}

	const { colors, typography, spacing, shape, elevation, motion, shell } = theme.manifest;
	return {
		'--background': colors.canvas,
		'--foreground': colors.ink,
		'--card': colors.surface,
		'--card-foreground': colors.ink,
		'--popover': colors.surfaceRaised,
		'--popover-foreground': colors.ink,
		'--primary': colors.actionFocal,
		'--primary-foreground': colors.actionFocalInk,
		'--secondary': colors.actionOrdinary,
		'--secondary-foreground': colors.actionOrdinaryInk,
		'--muted': colors.surfaceSunken,
		'--muted-foreground': colors.mutedInk,
		'--accent': colors.selection,
		'--accent-foreground': colors.selectionInk,
		'--destructive': colors.danger,
		'--destructive-foreground': colors.dangerInk,
		'--success': colors.success,
		'--success-foreground': colors.successInk,
		'--warning': colors.warning,
		'--warning-foreground': colors.warningInk,
		'--info': colors.info,
		'--info-foreground': colors.infoInk,
		'--border': colors.border,
		'--input': colors.input,
		'--ring': colors.focus,
		'--selection': colors.selection,
		'--selection-foreground': colors.selectionInk,
		'--caret': colors.caret,
		'--link': colors.link,
		'--brand': colors.brand,
		'--brand-foreground': colors.brandInk,
		'--workspace': colors.workspace,
		'--workspace-foreground': colors.workspaceInk,
		'--overlay': colors.overlay,
		'--scrim': colors.scrim,
		'--browser-surface': colors.browserSurface,
		'--browser-chrome': colors.browserChrome,
		'--action-focal': colors.actionFocal,
		'--action-focal-foreground': colors.actionFocalInk,
		'--action-focal-hover': colors.actionFocalHover,
		'--action-focal-active': colors.actionFocalActive,
		'--action-primary': colors.actionPrimary,
		'--action-primary-foreground': colors.actionPrimaryInk,
		'--action-primary-hover': colors.actionPrimaryHover,
		'--action-primary-active': colors.actionPrimaryActive,
		'--action-ordinary': colors.actionOrdinary,
		'--action-ordinary-foreground': colors.actionOrdinaryInk,
		'--action-ordinary-border': colors.actionOrdinaryBorder,
		'--action-ordinary-hover': colors.actionOrdinaryHover,
		'--action-ordinary-active': colors.actionOrdinaryActive,
		'--action-quiet': colors.actionQuiet,
		'--action-quiet-foreground': colors.actionQuietInk,
		'--action-quiet-hover': colors.actionQuietHover,
		'--action-quiet-active': colors.actionQuietActive,
		'--action-destructive': colors.actionDestructive,
		'--action-destructive-foreground': colors.actionDestructiveInk,
		'--action-destructive-hover': colors.actionDestructiveHover,
		'--action-destructive-active': colors.actionDestructiveActive,
		'--action-link': colors.actionLink,
		'--action-link-hover': colors.actionLinkHover,
		'--disabled': colors.disabled,
		'--disabled-foreground': colors.disabledInk,
		'--field': colors.field,
		'--field-foreground': colors.fieldInk,
		'--field-border': colors.fieldBorder,
		'--field-hover': colors.fieldHover,
		'--field-focus': colors.fieldFocus,
		'--field-disabled': colors.fieldDisabled,
		'--field-disabled-foreground': colors.fieldDisabledInk,
		'--card-hover': colors.cardHover,
		'--navigation-hover': colors.navigationHover,
		'--navigation-active': colors.navigationActive,
		'--navigation-active-foreground': colors.navigationActiveInk,
		'--chart-1': colors.chart1,
		'--chart-2': colors.chart2,
		'--chart-3': colors.chart3,
		'--chart-4': colors.chart4,
		'--chart-5': colors.chart5,
		'--sidebar': colors.sidebar,
		'--sidebar-foreground': colors.sidebarInk,
		'--sidebar-primary': colors.sidebarActive,
		'--sidebar-primary-foreground': colors.sidebarActiveInk,
		'--sidebar-accent': colors.selection,
		'--sidebar-accent-foreground': colors.selectionInk,
		'--sidebar-border': colors.sidebarBorder,
		'--sidebar-ring': colors.focus,
		...typographyCssVariables(typography, familyNames),
		'--theme-space': spacing.base,
		'--theme-control-height': spacing.controlHeight,
		'--theme-compact-control-height': spacing.compactControlHeight,
		'--theme-touch-target': spacing.touchTarget,
		'--theme-page-gutter': spacing.pageGutter,
		'--theme-section-gap': spacing.sectionGap,
		'--theme-component-gap': spacing.componentGap,
		'--radius': shape.radius,
		'--theme-radius-sm': shape.radiusSm,
		'--theme-radius-md': shape.radiusMd,
		'--theme-radius-lg': shape.radiusLg,
		'--theme-radius-media': shape.radiusMedia,
		'--theme-radius-pill': shape.radiusPill,
		'--theme-border-width': shape.borderWidth,
		'--theme-border-style': shape.borderStyle,
		'--theme-shadow-card': elevation.card,
		'--theme-shadow-popover': elevation.popover,
		'--theme-shadow-dialog': elevation.dialog,
		'--theme-shadow-focal-action': elevation.focalAction,
		...motionCssVariables(motion),
		'--theme-content-max-width': shell.contentMaxWidth,
		'--theme-sidebar-width': shell.sidebarWidth,
		'--theme-header-height': shell.headerHeight,
		'--theme-mobile-navigation-height': shell.mobileNavigationHeight,
		'--editor-canvas': theme.manifest.protectedEditor.editorCanvas,
		'--editor-panel': theme.manifest.protectedEditor.editorPanel,
		'--editor-control': theme.manifest.protectedEditor.editorControl,
		'--editor-control-hover': theme.manifest.protectedEditor.editorControlHover,
		'--editor-border': theme.manifest.protectedEditor.editorBorder,
		'--editor-muted': theme.manifest.protectedEditor.editorMuted,
		'--editor-text': theme.manifest.protectedEditor.editorText,
		'--editor-focus': theme.manifest.protectedEditor.editorFocus,
		'--editor-focus-border': theme.manifest.protectedEditor.editorFocusBorder,
		'--timeline-track': theme.manifest.protectedEditor.timelineTrack,
		'--timeline-clip': theme.manifest.protectedEditor.timelineClip,
		'--timeline-waveform': theme.manifest.protectedEditor.timelineWaveform,
		'--timeline-playhead': theme.manifest.protectedEditor.timelinePlayhead,
		'--timeline-selection': theme.manifest.protectedEditor.timelineSelection,
		'--canvas-pasteboard': theme.manifest.protectedEditor.canvasPasteboard,
		'--canvas-grid': theme.manifest.protectedEditor.canvasGrid,
		'--canvas-handle': theme.manifest.protectedEditor.canvasHandle,
		'--canvas-selection': theme.manifest.protectedEditor.canvasSelection,
		'--canvas-safe-area': theme.manifest.protectedEditor.canvasSafeArea,
		'--editor-protected-glyph': theme.manifest.protectedEditor.protectedGlyph,
		...assetCssVariables(theme.assets)
	};
}

type ImageConstructor = new () => HTMLImageElement;

async function loadAssetsWith(
	assets: readonly ThemeAsset[],
	ImageClass: ImageConstructor | undefined
): Promise<void> {
	if (!ImageClass) return;
	await Promise.all(
		assets.map(
			(asset) =>
				new Promise<void>((resolve, reject) => {
					const image = new ImageClass();
					image.onload = () => resolve();
					image.onerror = () => reject(new Error(`Could not load theme asset ${asset.id}`));
					image.src = asset.sourceUrl;
				})
		)
	);
}

async function defaultLoadIconPack(pack: ThemeIconPackId): Promise<void> {
	const { loadThemeIconPack } = await import('./icons/registry.js');
	await loadThemeIconPack(pack);
}

function setBrowserSurfaceIn(targetDocument: Document | undefined, color: string): () => void {
	if (!targetDocument) return () => undefined;
	let meta = targetDocument.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	const originalMeta = meta;
	const originalContent = meta?.content;
	if (!meta) {
		meta = targetDocument.createElement('meta');
		meta.name = 'theme-color';
		targetDocument.head.append(meta);
	}
	meta.content = color;
	let restored = false;
	return () => {
		if (restored || meta.content !== color) return;
		restored = true;
		if (originalMeta) {
			originalMeta.content = originalContent ?? '';
		} else {
			meta.remove();
		}
	};
}

export function createBrowserThemeRuntimeLoaders(
	targetDocument = 'document' in globalThis ? globalThis.document : undefined
): ThemeRuntimeLoaders {
	const targetWindow = targetDocument?.defaultView;
	const ImageClass: ImageConstructor | undefined =
		targetWindow?.Image ?? ('Image' in globalThis ? globalThis.Image : undefined);
	return {
		stageFonts: (plan) =>
			stageThemeFontPlan(
				plan,
				targetDocument ? themeFontEnvironmentForDocument(targetDocument) : null
			),
		loadAssets: (assets) => loadAssetsWith(assets, ImageClass),
		loadIconPack: defaultLoadIconPack,
		setBrowserSurface: (color) => setBrowserSurfaceIn(targetDocument, color)
	};
}

export const browserThemeRuntimeLoaders = createBrowserThemeRuntimeLoaders();

function fallbackTheme(
	theme: WebResolvedTheme,
	reason: 'invalid-manifest' | 'unsafe-resource' | 'resource-failed'
): ResolvedTheme {
	const fallback = resolveBuiltInTheme('workshop', theme.requestedScheme);
	return { ...fallback, source: 'fallback', fallbackReason: reason };
}

export class WebThemeRuntime {
	readonly #loaders: ThemeRuntimeLoaders;
	readonly #generations = new WeakMap<object, number>();
	readonly #managedVariables = new WeakMap<object, Set<string>>();
	readonly #originalDarkState = new WeakMap<object, boolean>();
	readonly #restoreBrowserSurface = new WeakMap<object, () => void>();
	readonly #fontStages = new WeakMap<object, ThemeFontStage>();

	constructor(loaders: ThemeRuntimeLoaders = browserThemeRuntimeLoaders) {
		this.#loaders = loaders;
	}

	async prepare(
		theme: WebResolvedTheme,
		runtimeScope: 'application' | 'preview' = 'application'
	): Promise<PreparedTheme> {
		let candidate = isCompleteThemeSchemeManifest(theme.manifest, theme.scheme)
			? hasSafeResources(theme, runtimeScope)
				? theme
				: fallbackTheme(theme, 'unsafe-resource')
			: fallbackTheme(theme, 'invalid-manifest');
		let fontStage: ThemeFontStage;
		let fontPlan = createThemeFontPlan(candidate)!;
		try {
			fontStage = await this.#stageResources(candidate, fontPlan);
		} catch {
			candidate = fallbackTheme(candidate, 'resource-failed');
			fontPlan = createThemeFontPlan(candidate)!;
			fontStage = await this.#stageResources(candidate, fontPlan).catch(() => ({
				release: () => undefined
			}));
		}
		return {
			resolved: candidate,
			variables: themeSchemeToCssVariables(candidate, fontPlan.familyNames),
			fontStage
		};
	}

	async #stageResources(theme: WebResolvedTheme, fontPlan: ThemeFontPlan): Promise<ThemeFontStage> {
		const fontStage = await this.#loaders.stageFonts(fontPlan);
		try {
			await Promise.all([
				this.#loaders.loadAssets(theme.assets),
				this.#loaders.loadIconPack(theme.iconPack)
			]);
			return fontStage;
		} catch (error) {
			fontStage.release();
			throw error;
		}
	}

	async apply(theme: WebResolvedTheme, scope: ThemeScope): Promise<boolean> {
		return this.#apply(theme, scope, 'application');
	}

	async applyScoped(theme: WebResolvedTheme, scope: ThemeScope): Promise<boolean> {
		return this.#apply(theme, scope, 'preview');
	}

	clear(scope: ThemeScope): void {
		this.#generations.set(scope, (this.#generations.get(scope) ?? 0) + 1);
		this.#fontStages.get(scope)?.release();
		this.#fontStages.delete(scope);
		this.#restoreBrowserSurface.get(scope)?.();
		this.#restoreBrowserSurface.delete(scope);
		for (const property of this.#managedVariables.get(scope) ?? [])
			scope.style.removeProperty(property);
		this.#managedVariables.delete(scope);
		const originalDarkState = this.#originalDarkState.get(scope);
		if (originalDarkState !== undefined) scope.classList?.toggle('dark', originalDarkState);
		this.#originalDarkState.delete(scope);
		for (const attribute of [
			'data-theme-id',
			'data-theme-revision',
			'data-theme-scheme',
			'data-theme-source',
			'data-theme-icon-pack',
			'data-theme-scope',
			'data-theme-fallback',
			'data-theme-density',
			'data-theme-canvas',
			'data-theme-reduced-motion',
			...Object.values(componentAttributes)
		]) {
			scope.removeAttribute(attribute);
		}
	}

	async #apply(
		theme: WebResolvedTheme,
		scope: ThemeScope,
		scopeKind: 'application' | 'preview'
	): Promise<boolean> {
		const generation = (this.#generations.get(scope) ?? 0) + 1;
		this.#generations.set(scope, generation);
		const prepared = await this.prepare(theme, scopeKind);
		if (this.#generations.get(scope) !== generation) {
			prepared.fontStage.release();
			return false;
		}

		const previousVariables = this.#managedVariables.get(scope) ?? new Set<string>();
		const nextVariables = new Set(Object.keys(prepared.variables));
		for (const property of previousVariables) {
			if (!nextVariables.has(property)) scope.style.removeProperty(property);
		}
		for (const [property, value] of Object.entries(prepared.variables)) {
			scope.style.setProperty(property, value);
		}
		this.#managedVariables.set(scope, nextVariables);
		this.#fontStages.get(scope)?.release();
		this.#fontStages.set(scope, prepared.fontStage);

		const { resolved } = prepared;
		if (!this.#originalDarkState.has(scope) && scope.classList) {
			this.#originalDarkState.set(scope, scope.classList.contains('dark'));
		}
		scope.setAttribute('data-theme-id', resolved.id);
		scope.setAttribute('data-theme-revision', resolved.revision);
		scope.setAttribute('data-theme-scheme', resolved.scheme);
		scope.setAttribute('data-theme-source', resolved.source);
		scope.setAttribute('data-theme-icon-pack', resolved.iconPack);
		scope.setAttribute('data-theme-scope', scopeKind);
		scope.setAttribute('data-theme-density', resolved.manifest.spacing.density);
		scope.setAttribute('data-theme-canvas', resolved.manifest.shell.canvasTreatment);
		for (const recipe of THEME_COMPONENT_RECIPE_KEYS) {
			scope.setAttribute(componentAttributes[recipe], resolved.manifest.components[recipe]);
		}
		scope.setAttribute('data-theme-reduced-motion', resolved.manifest.motion.reducedMotion);
		scope.classList?.toggle('dark', resolved.scheme === 'dark');
		if (resolved.fallbackReason) {
			scope.setAttribute('data-theme-fallback', resolved.fallbackReason);
		} else {
			scope.removeAttribute('data-theme-fallback');
		}

		if (scopeKind === 'application') {
			this.#restoreBrowserSurface.get(scope)?.();
			this.#restoreBrowserSurface.set(
				scope,
				this.#loaders.setBrowserSurface(resolved.manifest.colors.browserChrome)
			);
		}
		if ('CustomEvent' in globalThis) {
			scope.dispatchEvent?.(
				new globalThis.CustomEvent('openpost:themechange', {
					bubbles: true,
					detail: {
						id: resolved.id,
						iconPack: resolved.iconPack,
						scheme: resolved.scheme
					}
				})
			);
		}
		return true;
	}
}
