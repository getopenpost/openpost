export const THEME_SCHEMES = ['light', 'dark'] as const;
export type ThemeScheme = (typeof THEME_SCHEMES)[number];
export type ThemeSchemePreference = ThemeScheme | 'system';

export const THEME_FAMILY_IDS = [
	'workshop',
	'studio',
	'notebook',
	'playroom',
	'cloud-garden',
	'study-hall',
	'corkboard',
	'midnight'
] as const;
export type ThemeFamilyId = (typeof THEME_FAMILY_IDS)[number];

export const THEME_ICON_PACK_IDS = [
	'lucide',
	'heroicons-outline',
	'heroicons-solid',
	'phosphor',
	'tabler'
] as const;
export type ThemeIconPackId = (typeof THEME_ICON_PACK_IDS)[number];

export const THEME_ICON_ROLES = [
	'add',
	'analytics',
	'appearance',
	'archive',
	'arrow-down',
	'arrow-left',
	'arrow-right',
	'arrow-up',
	'at',
	'audio',
	'billing',
	'calendar',
	'camera',
	'camera-switch',
	'check',
	'chevron-down',
	'chevron-left',
	'chevron-right',
	'chevron-up',
	'close',
	'compose',
	'communications',
	'controls',
	'copy',
	'code',
	'delete',
	'download',
	'drag',
	'edit',
	'editors',
	'external-link',
	'eye',
	'eye-off',
	'filter',
	'feedback',
	'favorite',
	'file',
	'growth',
	'help',
	'history',
	'home',
	'image',
	'image-add',
	'idea',
	'language',
	'media',
	'link',
	'lock',
	'logout',
	'mail',
	'menu',
	'more-horizontal',
	'more-vertical',
	'notification',
	'organization',
	'publications',
	'redo',
	'refresh',
	'remove',
	'save',
	'search',
	'security',
	'send',
	'settings',
	'share',
	'sparkles',
	'sort',
	'tag',
	'time',
	'unlink',
	'upload',
	'user',
	'users',
	'video',
	'workspace',
	'undo'
] as const;
export type ThemeIconRole = (typeof THEME_ICON_ROLES)[number];

export const THEME_ACTION_INTENTS = [
	'focal',
	'primary',
	'ordinary',
	'quiet',
	'destructive',
	'link'
] as const;
export type ThemeActionIntent = (typeof THEME_ACTION_INTENTS)[number];

export const THEME_COLOR_TOKEN_KEYS = [
	'canvas',
	'ink',
	'surface',
	'surfaceRaised',
	'surfaceSunken',
	'mutedInk',
	'border',
	'input',
	'focus',
	'selection',
	'selectionInk',
	'caret',
	'link',
	'brand',
	'brandInk',
	'workspace',
	'workspaceInk',
	'overlay',
	'scrim',
	'danger',
	'dangerInk',
	'success',
	'successInk',
	'warning',
	'warningInk',
	'info',
	'infoInk',
	'actionFocal',
	'actionFocalInk',
	'actionFocalHover',
	'actionFocalActive',
	'actionPrimary',
	'actionPrimaryInk',
	'actionPrimaryHover',
	'actionPrimaryActive',
	'actionOrdinary',
	'actionOrdinaryInk',
	'actionOrdinaryBorder',
	'actionOrdinaryHover',
	'actionOrdinaryActive',
	'actionQuiet',
	'actionQuietInk',
	'actionQuietHover',
	'actionQuietActive',
	'actionDestructive',
	'actionDestructiveInk',
	'actionDestructiveHover',
	'actionDestructiveActive',
	'actionLink',
	'actionLinkHover',
	'disabled',
	'disabledInk',
	'field',
	'fieldInk',
	'fieldBorder',
	'fieldHover',
	'fieldFocus',
	'fieldDisabled',
	'fieldDisabledInk',
	'cardHover',
	'navigationHover',
	'navigationActive',
	'navigationActiveInk',
	'sidebar',
	'sidebarInk',
	'sidebarActive',
	'sidebarActiveInk',
	'sidebarBorder',
	'chrome',
	'chromeInk',
	'browserSurface',
	'browserChrome',
	'chart1',
	'chart2',
	'chart3',
	'chart4',
	'chart5'
] as const;
export type ThemeColorToken = (typeof THEME_COLOR_TOKEN_KEYS)[number];
export type ThemeColorTokens = Record<ThemeColorToken, string>;

export const THEME_PROTECTED_EDITOR_TOKEN_KEYS = [
	'editorCanvas',
	'editorPanel',
	'editorControl',
	'editorControlHover',
	'editorBorder',
	'editorMuted',
	'editorText',
	'editorFocus',
	'editorFocusBorder',
	'timelineTrack',
	'timelineClip',
	'timelineWaveform',
	'timelinePlayhead',
	'timelineSelection',
	'canvasPasteboard',
	'canvasGrid',
	'canvasHandle',
	'canvasSelection',
	'canvasSafeArea',
	'protectedGlyph'
] as const;
export type ThemeProtectedEditorToken = (typeof THEME_PROTECTED_EDITOR_TOKEN_KEYS)[number];
export type ThemeProtectedEditorTokens = Record<ThemeProtectedEditorToken, string>;

export const THEME_TYPOGRAPHY_ROLE_KEYS = [
	'display',
	'title',
	'body',
	'label',
	'metadata',
	'code'
] as const;
export type ThemeTypographyRole = (typeof THEME_TYPOGRAPHY_ROLE_KEYS)[number];

export interface ThemeTypographyRoleTokens {
	family: string;
	fallbacks: string[];
	weight: number;
	size: string;
	lineHeight: string;
	tracking: string;
}

export interface ThemeTypographyTokens {
	display: ThemeTypographyRoleTokens;
	title: ThemeTypographyRoleTokens;
	body: ThemeTypographyRoleTokens;
	label: ThemeTypographyRoleTokens;
	metadata: ThemeTypographyRoleTokens;
	code: ThemeTypographyRoleTokens;
}

export interface ThemeSpacingTokens {
	density: ThemeDensity;
	base: string;
	controlHeight: string;
	compactControlHeight: string;
	touchTarget: string;
	pageGutter: string;
	sectionGap: string;
	componentGap: string;
}

export const THEME_DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
export type ThemeDensity = (typeof THEME_DENSITIES)[number];

export const THEME_BORDER_STYLES = ['solid', 'dashed'] as const;
export type ThemeBorderStyle = (typeof THEME_BORDER_STYLES)[number];

export interface ThemeCornerTokens {
	radius: string;
	radiusSm: string;
	radiusMd: string;
	radiusLg: string;
	radiusMedia: string;
	radiusPill: string;
	borderWidth: string;
	borderStyle: ThemeBorderStyle;
}

export interface ThemeElevationTokens {
	card: string;
	popover: string;
	dialog: string;
	focalAction: string;
}

export const THEME_MOTION_RECIPE_KEYS = [
	'press',
	'hover',
	'selection',
	'entry',
	'exit',
	'loading',
	'pageTransition'
] as const;
export type ThemeMotionRecipeName = (typeof THEME_MOTION_RECIPE_KEYS)[number];

export interface ThemeMotionTokens {
	press: ThemeMotionRecipe;
	hover: ThemeMotionRecipe;
	selection: ThemeMotionRecipe;
	entry: ThemeMotionRecipe;
	exit: ThemeMotionRecipe;
	loading: ThemeMotionRecipe;
	pageTransition: ThemeMotionRecipe;
	reducedMotion: ThemeReducedMotion;
}

export const THEME_REDUCED_MOTION_OPTIONS = ['instant', 'crossfade'] as const;
export type ThemeReducedMotion = (typeof THEME_REDUCED_MOTION_OPTIONS)[number];

export interface ThemeMotionRecipe {
	duration: string;
	easing: string;
	distance: string;
	opacity: number;
}

export interface ThemeShellTokens {
	contentMaxWidth: string;
	sidebarWidth: string;
	headerHeight: string;
	mobileNavigationHeight: string;
	canvasTreatment: ThemeCanvasTreatment;
}

export const THEME_CANVAS_TREATMENTS = [
	'plain',
	'paper',
	'playful',
	'garden',
	'study',
	'tactile',
	'precision'
] as const;
export type ThemeCanvasTreatment = (typeof THEME_CANVAS_TREATMENTS)[number];

export const THEME_COMPONENT_RECIPE_KEYS = [
	'button',
	'link',
	'tabs',
	'navigation',
	'input',
	'select',
	'card',
	'container',
	'table',
	'list',
	'badge',
	'chip',
	'dialog',
	'popover',
	'toast',
	'switch',
	'checkbox',
	'radio',
	'toolbar',
	'pagination',
	'emptyState',
	'loadingState',
	'editorChrome',
	'decoration'
] as const;
export type ThemeComponentRecipe = (typeof THEME_COMPONENT_RECIPE_KEYS)[number];

export const THEME_COMPONENT_RECIPE_OPTIONS = {
	button: ['solid', 'tonal', 'outlined', 'precise'],
	link: ['underlined', 'subtle', 'plain'],
	tabs: ['underline', 'pill', 'segmented'],
	navigation: ['quiet', 'tonal', 'outlined'],
	input: ['filled', 'outlined', 'underlined'],
	select: ['filled', 'outlined', 'underlined'],
	card: ['flat', 'outlined', 'paper', 'lifted'],
	container: ['flat', 'outlined', 'tinted'],
	table: ['ruled', 'striped', 'plain'],
	list: ['divided', 'spaced', 'plain'],
	badge: ['solid', 'tonal', 'outlined'],
	chip: ['solid', 'tonal', 'outlined'],
	dialog: ['flat', 'outlined', 'elevated'],
	popover: ['flat', 'outlined', 'elevated'],
	toast: ['flat', 'outlined', 'elevated'],
	switch: ['solid', 'tonal', 'outlined'],
	checkbox: ['solid', 'tonal', 'outlined'],
	radio: ['solid', 'tonal', 'outlined'],
	toolbar: ['flat', 'outlined', 'floating'],
	pagination: ['quiet', 'outlined', 'pill'],
	emptyState: ['plain', 'illustrated', 'framed'],
	loadingState: ['spinner', 'pulse', 'skeleton'],
	editorChrome: ['neutral', 'compact', 'precision'],
	decoration: ['none', 'editorial', 'playful', 'botanical', 'study', 'tactile', 'precision']
} as const;

export type ThemeComponentRecipes = {
	[Recipe in ThemeComponentRecipe]: (typeof THEME_COMPONENT_RECIPE_OPTIONS)[Recipe][number];
};

export interface ThemeSchemeManifest {
	colors: ThemeColorTokens;
	protectedEditor: ThemeProtectedEditorTokens;
	typography: ThemeTypographyTokens;
	spacing: ThemeSpacingTokens;
	shape: ThemeCornerTokens;
	elevation: ThemeElevationTokens;
	motion: ThemeMotionTokens;
	shell: ThemeShellTokens;
	components: ThemeComponentRecipes;
}

export interface ThemeFontFace {
	id: string;
	family: string;
	sourceUrl: string;
	format: 'woff2';
	weight: number;
	style: 'normal' | 'italic';
	display: 'swap' | 'fallback' | 'optional';
}

export interface ThemeNativeFontDerivative {
	sourceUrl: string;
	format: 'ttf' | 'otf';
	identity: string;
}

export interface ThemeRuntimeFontFace extends ThemeFontFace {
	nativeDerivative: ThemeNativeFontDerivative;
}

export const THEME_ASSET_SLOTS = [
	'background-texture',
	'sidebar-decoration',
	'header-decoration',
	'empty-state-illustration',
	'loading-illustration'
] as const;
export type ThemeAssetSlot = (typeof THEME_ASSET_SLOTS)[number];

export interface ThemeAsset {
	id: string;
	slot: ThemeAssetSlot;
	sourceUrl: string;
	mimeType: string;
	alt?: string;
}

export interface ThemeManifest {
	schemaVersion: 1;
	id: string;
	revision: string;
	name: string;
	description: string;
	iconPack: ThemeIconPackId;
	supportedSchemes: ThemeScheme[];
	schemes: Partial<Record<ThemeScheme, ThemeSchemeManifest>>;
	fonts: ThemeFontFace[];
	assets: ThemeAsset[];
}

export type ThemeResolutionSource = 'builtin' | 'organization' | 'fallback';
export type ThemeFallbackReason =
	| 'missing-theme'
	| 'unsupported-scheme'
	| 'invalid-manifest'
	| 'unsafe-resource'
	| 'resource-failed';

export interface ResolvedTheme {
	id: string;
	revision: string;
	name: string;
	iconPack: ThemeIconPackId;
	source: ThemeResolutionSource;
	requestedScheme: ThemeScheme;
	scheme: ThemeScheme;
	manifest: ThemeSchemeManifest;
	fonts: ThemeRuntimeFontFace[];
	assets: ThemeAsset[];
	fallbackReason?: ThemeFallbackReason;
}

// Draft previews use the stored WOFF2 face contract. A resolved API theme is
// assignable to this web-only view, while native-only derivatives remain a
// required part of the canonical ResolvedTheme contract for mobile.
export type WebResolvedTheme = Omit<ResolvedTheme, 'fonts'> & {
	fonts: ThemeFontFace[];
	webResourceScope?: 'published' | 'editor-preview';
};
