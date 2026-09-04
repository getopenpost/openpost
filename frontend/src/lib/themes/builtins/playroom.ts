import type { ThemeManifest } from '../contracts.js';
import { colors, companionScheme, familyTypography, scheme, themeV2 } from './shared.js';

export const playroomLight = scheme({
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
		chart3: 'oklch(0.60 0.18 80)',
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

export const playroomDark = companionScheme(
	playroomLight,
	{
		canvas: 'oklch(0.16 0.035 265)',
		ink: 'oklch(0.96 0.015 95)',
		surface: 'oklch(0.21 0.04 265)',
		surfaceRaised: 'oklch(0.26 0.045 265)',
		surfaceSunken: 'oklch(0.12 0.028 265)',
		mutedInk: 'oklch(0.74 0.035 95)',
		border: 'oklch(0.48 0.055 265)',
		focus: 'oklch(0.78 0.15 220)',
		caret: 'oklch(0.74 0.18 145)',
		link: 'oklch(0.78 0.14 255)',
		selection: 'oklch(0.31 0.1 145)',
		selectionInk: 'oklch(0.95 0.025 145)',
		actionFocal: 'oklch(0.73 0.18 145)',
		actionFocalInk: 'oklch(0.14 0.045 145)',
		actionPrimary: 'oklch(0.89 0.075 95)',
		actionPrimaryInk: 'oklch(0.18 0.04 265)',
		actionOrdinary: 'oklch(0.27 0.05 265)',
		actionOrdinaryInk: 'oklch(0.96 0.015 95)',
		actionOrdinaryHover: 'oklch(0.31 0.055 265)',
		actionOrdinaryActive: 'oklch(0.35 0.06 265)',
		danger: 'oklch(0.36 0.11 25)',
		dangerInk: 'oklch(0.91 0.1 25)',
		actionDestructiveInk: 'oklch(0.83 0.14 25)',
		success: 'oklch(0.29 0.07 145)',
		successInk: 'oklch(0.82 0.14 145)',
		warning: 'oklch(0.31 0.09 85)',
		warningInk: 'oklch(0.86 0.14 85)',
		info: 'oklch(0.29 0.075 250)',
		infoInk: 'oklch(0.82 0.13 250)',
		sidebar: 'oklch(0.13 0.03 265)',
		sidebarInk: 'oklch(0.96 0.015 95)',
		sidebarActive: 'oklch(0.31 0.1 145)',
		sidebarActiveInk: 'oklch(0.95 0.025 145)',
		chart1: 'oklch(0.73 0.18 145)',
		chart2: 'oklch(0.72 0.17 255)',
		chart3: 'oklch(0.8 0.15 80)',
		chart4: 'oklch(0.73 0.16 25)',
		chart5: 'oklch(0.72 0.14 320)'
	},
	'dark'
);

export const playroomTheme: ThemeManifest = themeV2(
	'playroom',
	'Playroom',
	'Rounded classroom forms with energetic green actions.',
	'phosphor',
	{
		light: playroomLight,
		dark: playroomDark
	}
);
