import type {
	ResolvedTheme,
	ThemeColorTokens,
	ThemeComponentRecipes,
	ThemeCornerTokens,
	ThemeElevationTokens,
	ThemeFamilyId,
	ThemeIconPackId,
	ThemeManifest,
	ThemeMotionTokens,
	ThemeMotionRecipe,
	ThemeMotionRecipeName,
	ThemeScheme,
	ThemeSchemeManifest,
	ThemeShellTokens,
	ThemeSpacingTokens,
	ThemeTypographyRole,
	ThemeTypographyRoleTokens,
	ThemeTypographyTokens
} from '../contracts.js';
import { bundledThemeFont, type BundledThemeFontId } from '../bundled-fonts.js';
import { protectedEditorTokens } from '../protected.js';

const geist = bundledThemeFont('geist');
const geistMono = bundledThemeFont('geist-mono');
const sourceSerif = bundledThemeFont('source-serif-4');

export const workshopTypography: ThemeTypographyTokens = {
	display: {
		family: geist.family,
		fallbacks: geist.fallbacks,
		weight: 600,
		size: 'clamp(2rem, 4vw, 3.5rem)',
		lineHeight: '1.05',
		tracking: '-0.035em'
	},
	title: {
		family: geist.family,
		fallbacks: geist.fallbacks,
		weight: 600,
		size: 'clamp(1.5rem, 2.5vw, 2rem)',
		lineHeight: '1.15',
		tracking: '-0.025em'
	},
	body: {
		family: geist.family,
		fallbacks: geist.fallbacks,
		weight: 400,
		size: '0.875rem',
		lineHeight: '1.5',
		tracking: '0em'
	},
	label: {
		family: geist.family,
		fallbacks: geist.fallbacks,
		weight: 600,
		size: '0.8125rem',
		lineHeight: '1.25',
		tracking: '0em'
	},
	metadata: {
		family: geist.family,
		fallbacks: geist.fallbacks,
		weight: 500,
		size: '0.75rem',
		lineHeight: '1.35',
		tracking: '0.015em'
	},
	code: {
		family: geistMono.family,
		fallbacks: geistMono.fallbacks,
		weight: 400,
		size: '0.8125rem',
		lineHeight: '1.45',
		tracking: '0em'
	}
};

export const standardSpacing: ThemeSpacingTokens = {
	density: 'comfortable',
	base: '0.25rem',
	controlHeight: '2.25rem',
	compactControlHeight: '2rem',
	touchTarget: '2.75rem',
	pageGutter: 'clamp(1rem, 3vw, 2rem)',
	sectionGap: '1.5rem',
	componentGap: '0.75rem'
};

export const standardCorners: ThemeCornerTokens = {
	radius: '0.75rem',
	radiusSm: '0.5rem',
	radiusMd: '0.625rem',
	radiusLg: '0.75rem',
	radiusMedia: '0.875rem',
	radiusPill: '9999px',
	borderWidth: '1px',
	borderStyle: 'solid'
};

export const flatElevation: ThemeElevationTokens = {
	card: 'none',
	popover: '0 12px 30px -18px oklch(0.18 0.02 55 / 0.38)',
	dialog: '0 24px 56px -28px oklch(0.18 0.02 55 / 0.48)',
	focalAction: '0 5px 14px -8px color-mix(in oklch, var(--action-focal) 72%, black)'
};

export const standardMotion: ThemeMotionTokens = {
	press: {
		duration: '100ms',
		easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
		distance: '1px',
		opacity: 1
	},
	hover: {
		duration: '160ms',
		easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
		distance: '0px',
		opacity: 1
	},
	selection: {
		duration: '160ms',
		easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
		distance: '0px',
		opacity: 1
	},
	entry: {
		duration: '240ms',
		easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
		distance: '0.5rem',
		opacity: 0
	},
	exit: {
		duration: '160ms',
		easing: 'cubic-bezier(0.4, 0, 1, 1)',
		distance: '0.25rem',
		opacity: 0
	},
	loading: {
		duration: '900ms',
		easing: 'linear',
		distance: '0px',
		opacity: 0.45
	},
	pageTransition: {
		duration: '240ms',
		easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
		distance: '0.75rem',
		opacity: 0
	},
	reducedMotion: 'instant'
};

export const standardShell: ThemeShellTokens = {
	contentMaxWidth: '72rem',
	sidebarWidth: '16rem',
	headerHeight: '3.5rem',
	mobileNavigationHeight: '4.5rem',
	canvasTreatment: 'plain'
};

export const standardComponents: ThemeComponentRecipes = {
	button: 'solid',
	link: 'plain',
	tabs: 'underline',
	navigation: 'quiet',
	input: 'outlined',
	select: 'outlined',
	card: 'outlined',
	container: 'flat',
	table: 'ruled',
	list: 'divided',
	badge: 'tonal',
	chip: 'tonal',
	dialog: 'elevated',
	popover: 'elevated',
	toast: 'outlined',
	switch: 'solid',
	checkbox: 'solid',
	radio: 'solid',
	toolbar: 'flat',
	pagination: 'quiet',
	emptyState: 'plain',
	loadingState: 'skeleton',
	editorChrome: 'neutral',
	decoration: 'none'
};

export type ColorSeed = Pick<
	ThemeColorTokens,
	| 'canvas'
	| 'ink'
	| 'surface'
	| 'surfaceSunken'
	| 'mutedInk'
	| 'border'
	| 'focus'
	| 'selection'
	| 'selectionInk'
	| 'actionFocal'
	| 'actionFocalInk'
	| 'actionPrimary'
	| 'actionPrimaryInk'
	| 'actionOrdinary'
	| 'actionOrdinaryInk'
	| 'danger'
	| 'dangerInk'
	| 'success'
	| 'successInk'
	| 'warning'
	| 'warningInk'
	| 'info'
	| 'infoInk'
	| 'sidebar'
	| 'sidebarInk'
	| 'sidebarActive'
	| 'sidebarActiveInk'
	| 'chart1'
	| 'chart2'
	| 'chart3'
	| 'chart4'
	| 'chart5'
> &
	Partial<ThemeColorTokens>;

export function colors(seed: ColorSeed): ThemeColorTokens {
	return {
		canvas: seed.canvas,
		ink: seed.ink,
		surface: seed.surface,
		surfaceRaised: seed.surfaceRaised ?? seed.surface,
		surfaceSunken: seed.surfaceSunken,
		mutedInk: seed.mutedInk,
		border: seed.border,
		input: seed.input ?? seed.border,
		focus: seed.focus,
		selection: seed.selection,
		selectionInk: seed.selectionInk,
		caret: seed.caret ?? seed.focus,
		link: seed.link ?? seed.focus,
		brand: seed.brand ?? seed.actionFocal,
		brandInk: seed.brandInk ?? seed.actionFocalInk,
		workspace: seed.workspace ?? seed.selection,
		workspaceInk: seed.workspaceInk ?? seed.selectionInk,
		overlay: seed.overlay ?? `color-mix(in oklch, ${seed.ink} 12%, transparent)`,
		scrim: seed.scrim ?? `color-mix(in oklch, ${seed.ink} 52%, transparent)`,
		danger: seed.danger,
		dangerInk: seed.dangerInk,
		success: seed.success,
		successInk: seed.successInk,
		warning: seed.warning,
		warningInk: seed.warningInk,
		info: seed.info,
		infoInk: seed.infoInk,
		actionFocal: seed.actionFocal,
		actionFocalInk: seed.actionFocalInk,
		actionFocalHover:
			seed.actionFocalHover ?? `color-mix(in oklch, ${seed.actionFocal} 90%, ${seed.ink})`,
		actionFocalActive:
			seed.actionFocalActive ?? `color-mix(in oklch, ${seed.actionFocal} 82%, ${seed.ink})`,
		actionPrimary: seed.actionPrimary,
		actionPrimaryInk: seed.actionPrimaryInk,
		actionPrimaryHover:
			seed.actionPrimaryHover ?? `color-mix(in oklch, ${seed.actionPrimary} 88%, ${seed.canvas})`,
		actionPrimaryActive:
			seed.actionPrimaryActive ?? `color-mix(in oklch, ${seed.actionPrimary} 80%, ${seed.canvas})`,
		actionOrdinary: seed.actionOrdinary,
		actionOrdinaryInk: seed.actionOrdinaryInk,
		actionOrdinaryBorder: seed.actionOrdinaryBorder ?? seed.border,
		actionOrdinaryHover:
			seed.actionOrdinaryHover ?? `color-mix(in oklch, ${seed.actionOrdinary} 90%, ${seed.ink})`,
		actionOrdinaryActive:
			seed.actionOrdinaryActive ?? `color-mix(in oklch, ${seed.actionOrdinary} 82%, ${seed.ink})`,
		actionQuiet: seed.actionQuiet ?? 'transparent',
		actionQuietInk: seed.actionQuietInk ?? seed.ink,
		actionQuietHover: seed.actionQuietHover ?? seed.surfaceSunken,
		actionQuietActive:
			seed.actionQuietActive ?? `color-mix(in oklch, ${seed.surfaceSunken} 86%, ${seed.ink})`,
		actionDestructive:
			seed.actionDestructive ?? `color-mix(in oklch, ${seed.danger} 12%, transparent)`,
		actionDestructiveInk: seed.actionDestructiveInk ?? seed.danger,
		actionDestructiveHover:
			seed.actionDestructiveHover ?? `color-mix(in oklch, ${seed.danger} 20%, transparent)`,
		actionDestructiveActive:
			seed.actionDestructiveActive ?? `color-mix(in oklch, ${seed.danger} 28%, transparent)`,
		actionLink: seed.actionLink ?? seed.link ?? seed.focus,
		actionLinkHover:
			seed.actionLinkHover ?? `color-mix(in oklch, ${seed.link ?? seed.focus} 82%, ${seed.ink})`,
		disabled: seed.disabled ?? seed.surfaceSunken,
		disabledInk: seed.disabledInk ?? seed.mutedInk,
		field: seed.field ?? seed.surface,
		fieldInk: seed.fieldInk ?? seed.ink,
		fieldBorder: seed.fieldBorder ?? seed.border,
		fieldHover: seed.fieldHover ?? seed.surfaceSunken,
		fieldFocus: seed.fieldFocus ?? seed.surface,
		fieldDisabled: seed.fieldDisabled ?? seed.surfaceSunken,
		fieldDisabledInk: seed.fieldDisabledInk ?? seed.mutedInk,
		cardHover: seed.cardHover ?? `color-mix(in oklch, ${seed.surface} 94%, ${seed.surfaceSunken})`,
		navigationHover: seed.navigationHover ?? seed.surfaceSunken,
		navigationActive: seed.navigationActive ?? seed.selection,
		navigationActiveInk: seed.navigationActiveInk ?? seed.selectionInk,
		sidebar: seed.sidebar,
		sidebarInk: seed.sidebarInk,
		sidebarActive: seed.sidebarActive,
		sidebarActiveInk: seed.sidebarActiveInk,
		sidebarBorder: seed.sidebarBorder ?? seed.border,
		chrome: seed.chrome ?? seed.surface,
		chromeInk: seed.chromeInk ?? seed.ink,
		browserSurface: seed.browserSurface ?? seed.canvas,
		browserChrome: seed.browserChrome ?? seed.surface,
		chart1: seed.chart1,
		chart2: seed.chart2,
		chart3: seed.chart3,
		chart4: seed.chart4,
		chart5: seed.chart5
	};
}

export type TypographyOverrides = {
	[Role in ThemeTypographyRole]?: Partial<ThemeTypographyRoleTokens>;
};

export type MotionOverrides = {
	[Recipe in ThemeMotionRecipeName]?: Partial<ThemeMotionRecipe>;
} & {
	reducedMotion?: ThemeMotionTokens['reducedMotion'];
};

export function roleTokens(
	base: ThemeTypographyRoleTokens,
	override?: Partial<ThemeTypographyRoleTokens>
): ThemeTypographyRoleTokens {
	return { ...base, ...override };
}

export function themeTypography(overrides: TypographyOverrides = {}): ThemeTypographyTokens {
	return {
		display: roleTokens(workshopTypography.display, overrides.display),
		title: roleTokens(workshopTypography.title, overrides.title),
		body: roleTokens(workshopTypography.body, overrides.body),
		label: roleTokens(workshopTypography.label, overrides.label),
		metadata: roleTokens(workshopTypography.metadata, overrides.metadata),
		code: roleTokens(workshopTypography.code, overrides.code)
	};
}

export interface FamilyTypographyOptions {
	displayWeight?: number;
	titleWeight?: number;
	titleTracking?: string;
}

export function familyTypography(
	fontId: BundledThemeFontId,
	options: FamilyTypographyOptions = {}
): TypographyOverrides {
	const { family, fallbacks } = bundledThemeFont(fontId);
	return {
		display: { family, fallbacks, weight: options.displayWeight ?? 600 },
		title: {
			family,
			fallbacks,
			weight: options.titleWeight ?? 600,
			tracking: options.titleTracking ?? workshopTypography.title.tracking
		},
		body: { family, fallbacks },
		label: { family, fallbacks },
		metadata: { family, fallbacks }
	};
}

export function motionRecipe(
	base: ThemeMotionRecipe,
	override?: Partial<ThemeMotionRecipe>
): ThemeMotionRecipe {
	return { ...base, ...override };
}

export function themeMotion(overrides: MotionOverrides = {}): ThemeMotionTokens {
	return {
		press: motionRecipe(standardMotion.press, overrides.press),
		hover: motionRecipe(standardMotion.hover, overrides.hover),
		selection: motionRecipe(standardMotion.selection, overrides.selection),
		entry: motionRecipe(standardMotion.entry, overrides.entry),
		exit: motionRecipe(standardMotion.exit, overrides.exit),
		loading: motionRecipe(standardMotion.loading, overrides.loading),
		pageTransition: motionRecipe(standardMotion.pageTransition, overrides.pageTransition),
		reducedMotion: overrides.reducedMotion ?? standardMotion.reducedMotion
	};
}

export interface SchemeOptions {
	colors: ThemeColorTokens;
	typography?: TypographyOverrides;
	spacing?: Partial<ThemeSpacingTokens>;
	shape?: Partial<ThemeCornerTokens>;
	elevation?: Partial<ThemeElevationTokens>;
	motion?: MotionOverrides;
	shell?: Partial<ThemeShellTokens>;
	components?: Partial<ThemeComponentRecipes>;
}

export function scheme(
	options: SchemeOptions,
	protectedScheme: ThemeScheme = 'light'
): ThemeSchemeManifest {
	return {
		colors: options.colors,
		protectedEditor: protectedEditorTokens(protectedScheme),
		typography: themeTypography(options.typography),
		spacing: { ...standardSpacing, ...options.spacing },
		shape: { ...standardCorners, ...options.shape },
		elevation: { ...flatElevation, ...options.elevation },
		motion: themeMotion(options.motion),
		shell: { ...standardShell, ...options.shell },
		components: { ...standardComponents, ...options.components }
	};
}

export function theme(
	id: ThemeFamilyId,
	name: string,
	description: string,
	iconPack: ThemeIconPackId,
	schemes: Partial<Record<ThemeScheme, ThemeSchemeManifest>>
): ThemeManifest {
	return {
		schemaVersion: 1,
		id,
		revision: 'builtin-v1',
		name,
		description,
		iconPack,
		supportedSchemes: (['light', 'dark'] as const).filter((candidate) => schemes[candidate]),
		schemes,
		fonts: [],
		assets: []
	};
}
