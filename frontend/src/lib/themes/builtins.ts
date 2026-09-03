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
} from './contracts.js';
import { bundledThemeFont, type BundledThemeFontId } from './bundled-fonts.js';
import { protectedEditorTokens } from './protected.js';

const geist = bundledThemeFont('geist');
const geistMono = bundledThemeFont('geist-mono');
const sourceSerif = bundledThemeFont('source-serif-4');

const workshopTypography: ThemeTypographyTokens = {
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

const standardSpacing: ThemeSpacingTokens = {
	density: 'comfortable',
	base: '0.25rem',
	controlHeight: '2.25rem',
	compactControlHeight: '2rem',
	touchTarget: '2.75rem',
	pageGutter: 'clamp(1rem, 3vw, 2rem)',
	sectionGap: '1.5rem',
	componentGap: '0.75rem'
};

const standardCorners: ThemeCornerTokens = {
	radius: '0.75rem',
	radiusSm: '0.5rem',
	radiusMd: '0.625rem',
	radiusLg: '0.75rem',
	radiusMedia: '0.875rem',
	radiusPill: '9999px',
	borderWidth: '1px',
	borderStyle: 'solid'
};

const flatElevation: ThemeElevationTokens = {
	card: 'none',
	popover: '0 12px 30px -18px oklch(0.18 0.02 55 / 0.38)',
	dialog: '0 24px 56px -28px oklch(0.18 0.02 55 / 0.48)',
	focalAction: '0 5px 14px -8px color-mix(in oklch, var(--action-focal) 72%, black)'
};

const standardMotion: ThemeMotionTokens = {
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

const standardShell: ThemeShellTokens = {
	contentMaxWidth: '72rem',
	sidebarWidth: '16rem',
	headerHeight: '3.5rem',
	mobileNavigationHeight: '4.5rem',
	canvasTreatment: 'plain'
};

const standardComponents: ThemeComponentRecipes = {
	button: 'solid',
	link: 'underlined',
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

type ColorSeed = Pick<
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

function colors(seed: ColorSeed): ThemeColorTokens {
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

type TypographyOverrides = {
	[Role in ThemeTypographyRole]?: Partial<ThemeTypographyRoleTokens>;
};

type MotionOverrides = {
	[Recipe in ThemeMotionRecipeName]?: Partial<ThemeMotionRecipe>;
} & {
	reducedMotion?: ThemeMotionTokens['reducedMotion'];
};

function roleTokens(
	base: ThemeTypographyRoleTokens,
	override?: Partial<ThemeTypographyRoleTokens>
): ThemeTypographyRoleTokens {
	return { ...base, ...override };
}

function themeTypography(overrides: TypographyOverrides = {}): ThemeTypographyTokens {
	return {
		display: roleTokens(workshopTypography.display, overrides.display),
		title: roleTokens(workshopTypography.title, overrides.title),
		body: roleTokens(workshopTypography.body, overrides.body),
		label: roleTokens(workshopTypography.label, overrides.label),
		metadata: roleTokens(workshopTypography.metadata, overrides.metadata),
		code: roleTokens(workshopTypography.code, overrides.code)
	};
}

interface FamilyTypographyOptions {
	displayWeight?: number;
	titleWeight?: number;
	titleTracking?: string;
}

function familyTypography(
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

function motionRecipe(
	base: ThemeMotionRecipe,
	override?: Partial<ThemeMotionRecipe>
): ThemeMotionRecipe {
	return { ...base, ...override };
}

function themeMotion(overrides: MotionOverrides = {}): ThemeMotionTokens {
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

interface SchemeOptions {
	colors: ThemeColorTokens;
	typography?: TypographyOverrides;
	spacing?: Partial<ThemeSpacingTokens>;
	shape?: Partial<ThemeCornerTokens>;
	elevation?: Partial<ThemeElevationTokens>;
	motion?: MotionOverrides;
	shell?: Partial<ThemeShellTokens>;
	components?: Partial<ThemeComponentRecipes>;
}

function scheme(
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

function theme(
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

const workshopLight = scheme({
	colors: colors({
		canvas: 'oklch(0.985 0.002 80)',
		ink: 'oklch(0.2 0.01 50)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.95 0.003 80)',
		mutedInk: 'oklch(0.52 0.015 55)',
		border: 'oklch(0.9 0.005 80)',
		focus: 'oklch(0.2 0.01 50)',
		caret: 'oklch(0.55 0.155 45)',
		link: 'oklch(0.55 0.155 45)',
		selection: 'oklch(0.93 0.04 45)',
		selectionInk: 'oklch(0.22 0.015 50)',
		actionFocal: 'oklch(0.55 0.155 45)',
		actionFocalInk: 'oklch(0.985 0.002 80)',
		actionPrimary: 'oklch(0.24 0.012 50)',
		actionPrimaryInk: 'oklch(0.985 0.002 80)',
		actionPrimaryHover: 'oklch(0.19 0.012 50)',
		actionPrimaryActive: 'oklch(0.14 0.01 50)',
		actionOrdinary: 'oklch(0.96 0.005 85)',
		actionOrdinaryInk: 'oklch(0.25 0.01 50)',
		danger: 'oklch(0.57 0.22 25)',
		dangerInk: 'oklch(0.985 0 0)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.92 0.035 155)',
		successInk: 'oklch(0.39 0.12 160)',
		warning: 'oklch(0.94 0.055 80)',
		warningInk: 'oklch(0.42 0.105 70)',
		info: 'oklch(0.93 0.035 245)',
		infoInk: 'oklch(0.4 0.12 245)',
		sidebar: 'oklch(0.98 0.003 85)',
		sidebarInk: 'oklch(0.2 0.01 50)',
		sidebarActive: 'oklch(0.93 0.04 45)',
		sidebarActiveInk: 'oklch(0.25 0.06 45)',
		chart1: 'oklch(0.57 0.17 45)',
		chart2: 'oklch(0.54 0.12 165)',
		chart3: 'oklch(0.54 0.12 245)',
		chart4: 'oklch(0.63 0.13 80)',
		chart5: 'oklch(0.52 0.13 320)'
	})
});

const workshopDark = scheme(
	{
		colors: colors({
			canvas: 'oklch(0.145 0.008 55)',
			ink: 'oklch(0.92 0.005 85)',
			surface: 'oklch(0.2 0.01 50)',
			surfaceRaised: 'oklch(0.22 0.012 50)',
			surfaceSunken: 'oklch(0.18 0.01 55)',
			mutedInk: 'oklch(0.67 0.015 55)',
			border: 'oklch(0.27 0.015 55)',
			focus: 'oklch(0.92 0.005 85)',
			caret: 'oklch(0.66 0.14 45)',
			link: 'oklch(0.66 0.14 45)',
			selection: 'oklch(0.32 0.065 45)',
			selectionInk: 'oklch(0.94 0.015 75)',
			actionFocal: 'oklch(0.66 0.14 45)',
			actionFocalInk: 'oklch(0.12 0.01 50)',
			actionPrimary: 'oklch(0.9 0.006 85)',
			actionPrimaryInk: 'oklch(0.16 0.01 50)',
			actionPrimaryHover: 'oklch(0.94 0.005 85)',
			actionPrimaryActive: 'oklch(0.98 0.003 85)',
			actionOrdinary: 'oklch(0.25 0.015 60)',
			actionOrdinaryInk: 'oklch(0.9 0.005 85)',
			actionOrdinaryHover: 'oklch(0.2 0.012 60)',
			actionOrdinaryActive: 'oklch(0.15 0.009 60)',
			danger: 'oklch(0.66 0.19 25)',
			dangerInk: 'oklch(0.12 0.01 50)',
			actionDestructiveInk: 'oklch(0.87 0.14 25)',
			success: 'oklch(0.28 0.05 155)',
			successInk: 'oklch(0.78 0.12 155)',
			warning: 'oklch(0.29 0.06 80)',
			warningInk: 'oklch(0.82 0.12 80)',
			info: 'oklch(0.27 0.05 245)',
			infoInk: 'oklch(0.76 0.11 245)',
			sidebar: 'oklch(0.19 0.01 50)',
			sidebarInk: 'oklch(0.92 0.005 85)',
			sidebarActive: 'oklch(0.32 0.065 45)',
			sidebarActiveInk: 'oklch(0.94 0.015 75)',
			chart1: 'oklch(0.67 0.16 45)',
			chart2: 'oklch(0.69 0.12 165)',
			chart3: 'oklch(0.68 0.12 245)',
			chart4: 'oklch(0.72 0.13 80)',
			chart5: 'oklch(0.66 0.13 320)'
		})
	},
	'dark'
);

const studioLight = scheme({
	colors: colors({
		canvas: 'oklch(0.99 0.004 250)',
		ink: 'oklch(0.18 0.015 255)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.96 0.008 250)',
		mutedInk: 'oklch(0.5 0.025 255)',
		border: 'oklch(0.9 0.012 250)',
		focus: 'oklch(0.18 0.015 255)',
		caret: 'oklch(0.52 0.2 255)',
		link: 'oklch(0.52 0.2 255)',
		selection: 'oklch(0.91 0.055 250)',
		selectionInk: 'oklch(0.23 0.08 255)',
		actionFocal: 'oklch(0.52 0.2 255)',
		actionFocalInk: 'oklch(0.99 0.004 250)',
		actionPrimary: 'oklch(0.2 0.02 255)',
		actionPrimaryInk: 'oklch(0.99 0 0)',
		actionPrimaryHover: 'oklch(0.15 0.018 255)',
		actionPrimaryActive: 'oklch(0.1 0.012 255)',
		actionOrdinary: 'oklch(0.96 0.014 250)',
		actionOrdinaryInk: 'oklch(0.23 0.03 255)',
		danger: 'oklch(0.56 0.22 25)',
		dangerInk: 'oklch(0.99 0 0)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.93 0.04 155)',
		successInk: 'oklch(0.38 0.13 155)',
		warning: 'oklch(0.95 0.055 85)',
		warningInk: 'oklch(0.43 0.1 75)',
		info: 'oklch(0.92 0.05 250)',
		infoInk: 'oklch(0.42 0.16 255)',
		sidebar: 'oklch(0.975 0.009 250)',
		sidebarInk: 'oklch(0.2 0.02 255)',
		sidebarActive: 'oklch(0.91 0.055 250)',
		sidebarActiveInk: 'oklch(0.3 0.13 255)',
		chart1: 'oklch(0.56 0.2 255)',
		chart2: 'oklch(0.58 0.15 205)',
		chart3: 'oklch(0.62 0.16 300)',
		chart4: 'oklch(0.67 0.15 75)',
		chart5: 'oklch(0.55 0.13 155)'
	}),
	typography: familyTypography('geist'),
	shape: { radius: '0.875rem', radiusMd: '0.75rem', radiusLg: '0.875rem' },
	components: { button: 'solid', card: 'flat', navigation: 'quiet' }
});

const notebookLight = scheme({
	colors: colors({
		canvas: 'oklch(0.975 0.018 82)',
		ink: 'oklch(0.24 0.025 65)',
		surface: 'oklch(0.995 0.012 82)',
		surfaceSunken: 'oklch(0.94 0.028 82)',
		mutedInk: 'oklch(0.5 0.04 70)',
		border: 'oklch(0.86 0.035 82)',
		focus: 'oklch(0.24 0.025 65)',
		caret: 'oklch(0.49 0.11 240)',
		link: 'oklch(0.49 0.11 240)',
		selection: 'oklch(0.9 0.045 235)',
		selectionInk: 'oklch(0.26 0.06 240)',
		actionFocal: 'oklch(0.75 0.13 75)',
		actionFocalInk: 'oklch(0.18 0.025 65)',
		actionPrimary: 'oklch(0.28 0.035 65)',
		actionPrimaryInk: 'oklch(0.99 0.01 82)',
		actionPrimaryHover: 'oklch(0.22 0.03 65)',
		actionPrimaryActive: 'oklch(0.16 0.02 65)',
		actionOrdinary: 'oklch(0.93 0.035 82)',
		actionOrdinaryInk: 'oklch(0.28 0.035 65)',
		danger: 'oklch(0.55 0.18 30)',
		dangerInk: 'oklch(0.99 0.01 82)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.9 0.05 145)',
		successInk: 'oklch(0.38 0.1 145)',
		warning: 'oklch(0.91 0.075 75)',
		warningInk: 'oklch(0.4 0.11 68)',
		info: 'oklch(0.91 0.045 235)',
		infoInk: 'oklch(0.38 0.11 240)',
		sidebar: 'oklch(0.955 0.025 82)',
		sidebarInk: 'oklch(0.24 0.025 65)',
		sidebarActive: 'oklch(0.9 0.045 235)',
		sidebarActiveInk: 'oklch(0.26 0.06 240)',
		chart1: 'oklch(0.58 0.15 70)',
		chart2: 'oklch(0.6 0.13 25)',
		chart3: 'oklch(0.57 0.11 235)',
		chart4: 'oklch(0.62 0.13 155)',
		chart5: 'oklch(0.55 0.11 315)'
	}),
	typography: {
		display: {
			family: sourceSerif.family,
			fallbacks: sourceSerif.fallbacks,
			weight: 600,
			tracking: '-0.018em'
		},
		title: {
			family: sourceSerif.family,
			fallbacks: sourceSerif.fallbacks,
			weight: 600,
			tracking: '-0.018em'
		}
	},
	spacing: { density: 'spacious', sectionGap: '1.75rem' },
	shape: { radius: '0.5rem', radiusMd: '0.5rem', radiusLg: '0.625rem' },
	shell: { canvasTreatment: 'paper' },
	components: {
		card: 'paper',
		container: 'tinted',
		input: 'underlined',
		select: 'underlined',
		decoration: 'editorial'
	}
});

const playroomLight = scheme({
	colors: colors({
		canvas: 'oklch(0.985 0.01 95)',
		ink: 'oklch(0.22 0.035 265)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.95 0.03 95)',
		mutedInk: 'oklch(0.48 0.045 265)',
		border: 'oklch(0.3 0.035 265)',
		focus: 'oklch(0.22 0.035 265)',
		caret: 'oklch(0.56 0.19 145)',
		selection: 'oklch(0.91 0.065 145)',
		selectionInk: 'oklch(0.26 0.09 145)',
		link: 'oklch(0.5 0.19 255)',
		actionFocal: 'oklch(0.59 0.19 145)',
		actionFocalInk: 'oklch(0.16 0.05 145)',
		actionFocalHover: 'oklch(0.66 0.18 145)',
		actionFocalActive: 'oklch(0.73 0.16 145)',
		actionPrimary: 'oklch(0.24 0.04 265)',
		actionPrimaryInk: 'oklch(0.99 0 0)',
		actionPrimaryHover: 'oklch(0.18 0.035 265)',
		actionPrimaryActive: 'oklch(0.12 0.025 265)',
		actionOrdinary: 'oklch(0.94 0.045 95)',
		actionOrdinaryInk: 'oklch(0.24 0.04 265)',
		danger: 'oklch(0.58 0.22 25)',
		dangerInk: 'oklch(0.99 0 0)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.9 0.07 145)',
		successInk: 'oklch(0.34 0.13 145)',
		warning: 'oklch(0.92 0.1 85)',
		warningInk: 'oklch(0.4 0.13 75)',
		info: 'oklch(0.91 0.07 250)',
		infoInk: 'oklch(0.38 0.16 255)',
		sidebar: 'oklch(0.97 0.025 95)',
		sidebarInk: 'oklch(0.22 0.035 265)',
		sidebarActive: 'oklch(0.89 0.08 145)',
		sidebarActiveInk: 'oklch(0.25 0.1 145)',
		chart1: 'oklch(0.59 0.19 145)',
		chart2: 'oklch(0.55 0.2 255)',
		chart3: 'oklch(0.69 0.18 80)',
		chart4: 'oklch(0.62 0.18 25)',
		chart5: 'oklch(0.58 0.16 320)'
	}),
	typography: familyTypography('dm-sans', {
		displayWeight: 700,
		titleWeight: 700
	}),
	spacing: {
		density: 'spacious',
		controlHeight: '2.5rem',
		componentGap: '0.875rem'
	},
	shape: {
		radius: '1rem',
		radiusSm: '0.75rem',
		radiusMd: '0.875rem',
		radiusLg: '1rem',
		radiusMedia: '1.25rem',
		borderWidth: '2px'
	},
	shell: { canvasTreatment: 'playful' },
	components: {
		button: 'tonal',
		card: 'outlined',
		navigation: 'tonal',
		tabs: 'pill',
		badge: 'solid',
		chip: 'solid',
		emptyState: 'illustrated',
		decoration: 'playful'
	}
});

const cloudGardenLight = scheme({
	colors: colors({
		canvas: 'oklch(0.985 0.018 155)',
		ink: 'oklch(0.2 0.03 160)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.95 0.035 155)',
		mutedInk: 'oklch(0.48 0.04 160)',
		border: 'oklch(0.88 0.03 155)',
		focus: 'oklch(0.2 0.03 160)',
		caret: 'oklch(0.48 0.14 155)',
		link: 'oklch(0.48 0.14 155)',
		selection: 'oklch(0.9 0.06 155)',
		selectionInk: 'oklch(0.25 0.08 155)',
		actionFocal: 'oklch(0.24 0.045 160)',
		actionFocalInk: 'oklch(0.98 0.015 155)',
		actionFocalHover: 'oklch(0.19 0.04 160)',
		actionFocalActive: 'oklch(0.14 0.025 160)',
		actionPrimary: 'oklch(0.32 0.08 155)',
		actionPrimaryInk: 'oklch(0.98 0.015 155)',
		actionPrimaryHover: 'oklch(0.25 0.065 155)',
		actionPrimaryActive: 'oklch(0.18 0.045 155)',
		actionOrdinary: 'oklch(0.94 0.04 155)',
		actionOrdinaryInk: 'oklch(0.24 0.045 160)',
		danger: 'oklch(0.56 0.2 25)',
		dangerInk: 'oklch(0.99 0 0)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.9 0.07 155)',
		successInk: 'oklch(0.34 0.12 155)',
		warning: 'oklch(0.94 0.07 85)',
		warningInk: 'oklch(0.42 0.11 75)',
		info: 'oklch(0.92 0.045 225)',
		infoInk: 'oklch(0.4 0.11 225)',
		sidebar: 'oklch(0.965 0.028 155)',
		sidebarInk: 'oklch(0.2 0.03 160)',
		sidebarActive: 'oklch(0.9 0.06 155)',
		sidebarActiveInk: 'oklch(0.25 0.08 155)',
		chart1: 'oklch(0.48 0.14 155)',
		chart2: 'oklch(0.54 0.13 190)',
		chart3: 'oklch(0.57 0.12 225)',
		chart4: 'oklch(0.66 0.12 100)',
		chart5: 'oklch(0.52 0.12 315)'
	}),
	typography: familyTypography('manrope'),
	shape: { radius: '0.875rem', radiusMd: '0.75rem', radiusLg: '0.875rem' },
	elevation: {
		card: '0 12px 28px -24px oklch(0.28 0.08 155 / 0.42)',
		popover: '0 18px 42px -24px oklch(0.28 0.08 155 / 0.46)'
	},
	shell: { canvasTreatment: 'garden' },
	components: {
		card: 'lifted',
		container: 'tinted',
		navigation: 'tonal',
		popover: 'elevated',
		emptyState: 'illustrated',
		decoration: 'botanical'
	}
});

const studyHallLight = scheme({
	colors: colors({
		canvas: 'oklch(0.975 0.012 265)',
		ink: 'oklch(0.22 0.025 275)',
		surface: 'oklch(0.995 0.004 265)',
		surfaceSunken: 'oklch(0.94 0.025 270)',
		mutedInk: 'oklch(0.49 0.035 275)',
		border: 'oklch(0.87 0.025 270)',
		focus: 'oklch(0.22 0.025 275)',
		caret: 'oklch(0.5 0.16 285)',
		link: 'oklch(0.5 0.16 285)',
		selection: 'oklch(0.91 0.055 285)',
		selectionInk: 'oklch(0.28 0.09 285)',
		actionFocal: 'oklch(0.5 0.16 285)',
		actionFocalInk: 'oklch(0.99 0 0)',
		actionPrimary: 'oklch(0.25 0.04 275)',
		actionPrimaryInk: 'oklch(0.99 0 0)',
		actionPrimaryHover: 'oklch(0.19 0.035 275)',
		actionPrimaryActive: 'oklch(0.13 0.025 275)',
		actionOrdinary: 'oklch(0.94 0.035 270)',
		actionOrdinaryInk: 'oklch(0.25 0.04 275)',
		danger: 'oklch(0.57 0.2 25)',
		dangerInk: 'oklch(0.99 0 0)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.91 0.055 155)',
		successInk: 'oklch(0.37 0.11 155)',
		warning: 'oklch(0.94 0.07 85)',
		warningInk: 'oklch(0.42 0.11 75)',
		info: 'oklch(0.92 0.055 245)',
		infoInk: 'oklch(0.39 0.13 250)',
		sidebar: 'oklch(0.96 0.02 270)',
		sidebarInk: 'oklch(0.22 0.025 275)',
		sidebarActive: 'oklch(0.91 0.055 285)',
		sidebarActiveInk: 'oklch(0.28 0.09 285)',
		chart1: 'oklch(0.5 0.16 285)',
		chart2: 'oklch(0.55 0.13 225)',
		chart3: 'oklch(0.6 0.13 155)',
		chart4: 'oklch(0.69 0.13 80)',
		chart5: 'oklch(0.59 0.14 335)'
	}),
	typography: familyTypography('inter'),
	spacing: { density: 'compact', componentGap: '0.625rem' },
	shape: {
		radius: '0.625rem',
		radiusSm: '0.375rem',
		radiusMd: '0.5rem',
		radiusLg: '0.625rem'
	},
	shell: { canvasTreatment: 'study' },
	components: {
		button: 'outlined',
		card: 'flat',
		navigation: 'outlined',
		tabs: 'segmented',
		table: 'striped',
		pagination: 'outlined',
		decoration: 'study'
	}
});

const corkboardLight = scheme({
	colors: colors({
		canvas: 'oklch(0.91 0.055 76)',
		ink: 'oklch(0.25 0.035 105)',
		surface: 'oklch(0.975 0.025 82)',
		surfaceRaised: 'oklch(0.99 0.018 82)',
		surfaceSunken: 'oklch(0.87 0.065 70)',
		mutedInk: 'oklch(0.47 0.045 100)',
		border: 'oklch(0.76 0.065 70)',
		focus: 'oklch(0.25 0.035 105)',
		caret: 'oklch(0.48 0.12 240)',
		link: 'oklch(0.48 0.12 240)',
		selection: 'oklch(0.88 0.065 235)',
		selectionInk: 'oklch(0.25 0.07 240)',
		actionFocal: 'oklch(0.75 0.13 75)',
		actionFocalInk: 'oklch(0.18 0.03 105)',
		actionPrimary: 'oklch(0.3 0.05 105)',
		actionPrimaryInk: 'oklch(0.98 0.02 82)',
		actionPrimaryHover: 'oklch(0.24 0.04 105)',
		actionPrimaryActive: 'oklch(0.18 0.03 105)',
		actionOrdinary: 'oklch(0.93 0.04 82)',
		actionOrdinaryInk: 'oklch(0.28 0.04 105)',
		danger: 'oklch(0.54 0.18 28)',
		dangerInk: 'oklch(0.98 0.02 82)',
		actionDestructiveInk: 'oklch(0.38 0.18 28)',
		success: 'oklch(0.84 0.075 135)',
		successInk: 'oklch(0.34 0.1 135)',
		warning: 'oklch(0.87 0.1 75)',
		warningInk: 'oklch(0.38 0.11 68)',
		info: 'oklch(0.87 0.07 235)',
		infoInk: 'oklch(0.36 0.11 240)',
		sidebar: 'oklch(0.88 0.07 72)',
		sidebarInk: 'oklch(0.25 0.035 105)',
		sidebarActive: 'oklch(0.86 0.08 235)',
		sidebarActiveInk: 'oklch(0.25 0.07 240)',
		chart1: 'oklch(0.6 0.15 70)',
		chart2: 'oklch(0.48 0.12 240)',
		chart3: 'oklch(0.5 0.11 135)',
		chart4: 'oklch(0.56 0.13 28)',
		chart5: 'oklch(0.48 0.1 310)'
	}),
	typography: familyTypography('dm-sans'),
	spacing: { density: 'compact', componentGap: '0.625rem' },
	shape: {
		radius: '0.375rem',
		radiusSm: '0.25rem',
		radiusMd: '0.375rem',
		radiusLg: '0.5rem',
		radiusMedia: '0.5rem'
	},
	elevation: {
		card: '0 8px 18px -15px oklch(0.25 0.05 70 / 0.52)',
		popover: '0 14px 34px -20px oklch(0.25 0.05 70 / 0.58)'
	},
	shell: { canvasTreatment: 'tactile' },
	components: {
		button: 'precise',
		card: 'paper',
		container: 'tinted',
		input: 'underlined',
		select: 'underlined',
		toolbar: 'outlined',
		decoration: 'tactile'
	}
});

const midnightDark = scheme(
	{
		colors: colors({
			canvas: 'oklch(0.105 0.008 265)',
			ink: 'oklch(0.91 0.01 110)',
			surface: 'oklch(0.145 0.012 265)',
			surfaceRaised: 'oklch(0.17 0.014 265)',
			surfaceSunken: 'oklch(0.125 0.01 265)',
			mutedInk: 'oklch(0.64 0.02 265)',
			border: 'oklch(0.25 0.018 265)',
			focus: 'oklch(0.91 0.01 110)',
			caret: 'oklch(0.82 0.2 125)',
			selection: 'oklch(0.3 0.09 125)',
			selectionInk: 'oklch(0.9 0.09 125)',
			link: 'oklch(0.78 0.14 210)',
			actionFocal: 'oklch(0.82 0.2 125)',
			actionFocalInk: 'oklch(0.12 0.03 125)',
			actionPrimary: 'oklch(0.88 0.015 110)',
			actionPrimaryInk: 'oklch(0.12 0.01 265)',
			actionPrimaryHover: 'oklch(0.93 0.012 110)',
			actionPrimaryActive: 'oklch(0.98 0.008 110)',
			actionOrdinary: 'oklch(0.2 0.018 265)',
			actionOrdinaryInk: 'oklch(0.88 0.01 110)',
			actionOrdinaryHover: 'oklch(0.15 0.014 265)',
			actionOrdinaryActive: 'oklch(0.1 0.009 265)',
			danger: 'oklch(0.68 0.2 25)',
			dangerInk: 'oklch(0.12 0.01 265)',
			actionDestructiveInk: 'oklch(0.87 0.14 25)',
			success: 'oklch(0.26 0.07 145)',
			successInk: 'oklch(0.8 0.14 145)',
			warning: 'oklch(0.28 0.075 80)',
			warningInk: 'oklch(0.84 0.13 80)',
			info: 'oklch(0.25 0.06 220)',
			infoInk: 'oklch(0.78 0.13 220)',
			sidebar: 'oklch(0.125 0.01 265)',
			sidebarInk: 'oklch(0.91 0.01 110)',
			sidebarActive: 'oklch(0.3 0.09 125)',
			sidebarActiveInk: 'oklch(0.9 0.09 125)',
			chart1: 'oklch(0.82 0.2 125)',
			chart2: 'oklch(0.74 0.14 210)',
			chart3: 'oklch(0.73 0.14 300)',
			chart4: 'oklch(0.76 0.15 70)',
			chart5: 'oklch(0.7 0.16 25)'
		}),
		typography: familyTypography('inter-tight', {
			displayWeight: 500,
			titleWeight: 500,
			titleTracking: '-0.02em'
		}),
		spacing: { density: 'compact', componentGap: '0.625rem' },
		shape: {
			radius: '0.5rem',
			radiusSm: '0.25rem',
			radiusMd: '0.375rem',
			radiusLg: '0.5rem'
		},
		elevation: {
			card: 'none',
			popover: '0 14px 36px -22px oklch(0 0 0 / 0.75)',
			dialog: '0 24px 60px -28px oklch(0 0 0 / 0.86)',
			focalAction: '0 5px 16px -9px oklch(0.82 0.2 125 / 0.62)'
		},
		motion: {
			press: { duration: '80ms' },
			hover: { duration: '130ms' },
			selection: { duration: '130ms' },
			entry: { duration: '200ms' },
			exit: { duration: '130ms' },
			pageTransition: { duration: '200ms' }
		},
		shell: { canvasTreatment: 'precision' },
		components: {
			button: 'precise',
			card: 'outlined',
			navigation: 'quiet',
			tabs: 'underline',
			toolbar: 'outlined',
			pagination: 'outlined',
			editorChrome: 'precision',
			decoration: 'precision'
		}
	},
	'dark'
);

export const WORKSHOP_FALLBACK_THEME = theme(
	'workshop',
	'Workshop',
	'Warm technical minimalism with one clear orange signal.',
	'lucide',
	{ light: workshopLight, dark: workshopDark }
);

export const BUILT_IN_THEMES: readonly ThemeManifest[] = [
	WORKSHOP_FALLBACK_THEME,
	theme(
		'studio',
		'Studio',
		'Cool white space and a precise cobalt control signal.',
		'heroicons-outline',
		{
			light: studioLight
		}
	),
	theme(
		'notebook',
		'Notebook',
		'Warm paper, editorial headings, and quiet blue selection.',
		'tabler',
		{
			light: notebookLight
		}
	),
	theme(
		'playroom',
		'Playroom',
		'Rounded classroom forms with energetic green actions.',
		'phosphor',
		{
			light: playroomLight
		}
	),
	theme(
		'cloud-garden',
		'Cloud Garden',
		'White and mint layers with restrained botanical depth.',
		'heroicons-solid',
		{ light: cloudGardenLight }
	),
	theme(
		'study-hall',
		'Study Hall',
		'Cool structured surfaces with indigo study signals.',
		'lucide',
		{
			light: studyHallLight
		}
	),
	theme(
		'corkboard',
		'Corkboard',
		'Tactile paper surfaces, moss ink, and pinned amber actions.',
		'tabler',
		{
			light: corkboardLight
		}
	),
	theme(
		'midnight',
		'Midnight',
		'A dark precision instrument with a chartreuse focal signal.',
		'phosphor',
		{
			dark: midnightDark
		}
	)
];

const builtInThemesById = new Map(BUILT_IN_THEMES.map((item) => [item.id, item]));

function cloneScheme(value: ThemeSchemeManifest): ThemeSchemeManifest {
	return structuredClone(value);
}

export function getBuiltInTheme(id: ThemeFamilyId): ThemeManifest {
	const value = builtInThemesById.get(id);
	if (!value) throw new Error(`Unknown built-in theme: ${id}`);
	return value;
}

// Static client mirror of the server built-in resolution rule (unsupported
// scheme falls back as a whole to Workshop, never a hybrid). Used for
// offline-capable preview and unavailable-theme placeholders; authoritative
// resolution always goes through the server resolver.
export function resolveBuiltInTheme(
	id: ThemeFamilyId | string,
	requestedScheme: ThemeScheme
): ResolvedTheme {
	const requested = builtInThemesById.get(id);
	const selected = requested?.schemes[requestedScheme];

	if (requested && selected) {
		return {
			id: requested.id,
			revision: requested.revision,
			name: requested.name,
			iconPack: requested.iconPack,
			source: 'builtin',
			requestedScheme,
			scheme: requestedScheme,
			manifest: cloneScheme(selected),
			fonts: [],
			assets: structuredClone(requested.assets)
		};
	}

	return {
		id: WORKSHOP_FALLBACK_THEME.id,
		revision: WORKSHOP_FALLBACK_THEME.revision,
		name: WORKSHOP_FALLBACK_THEME.name,
		iconPack: WORKSHOP_FALLBACK_THEME.iconPack,
		source: 'fallback',
		requestedScheme,
		scheme: requestedScheme,
		manifest: cloneScheme(WORKSHOP_FALLBACK_THEME.schemes[requestedScheme]!),
		fonts: [],
		assets: [],
		fallbackReason: requested ? 'unsupported-scheme' : 'missing-theme'
	};
}
