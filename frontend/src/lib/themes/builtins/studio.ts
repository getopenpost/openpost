import type { ThemeManifest } from '../contracts.js';
import { colors, companionScheme, scheme, theme, familyTypography } from './shared.js';

export const studioLight = scheme({
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

export const studioDark = companionScheme(
	studioLight,
	{
		canvas: 'oklch(0.15 0.02 255)',
		ink: 'oklch(0.94 0.01 250)',
		surface: 'oklch(0.19 0.025 255)',
		surfaceRaised: 'oklch(0.23 0.03 255)',
		surfaceSunken: 'oklch(0.12 0.018 255)',
		mutedInk: 'oklch(0.7 0.025 250)',
		border: 'oklch(0.29 0.035 255)',
		focus: 'oklch(0.76 0.17 290)',
		caret: 'oklch(0.72 0.16 255)',
		link: 'oklch(0.76 0.14 250)',
		selection: 'oklch(0.29 0.08 255)',
		selectionInk: 'oklch(0.95 0.01 250)',
		actionFocal: 'oklch(0.68 0.18 255)',
		actionFocalInk: 'oklch(0.11 0.02 255)',
		actionPrimary: 'oklch(0.9 0.015 250)',
		actionPrimaryInk: 'oklch(0.16 0.025 255)',
		actionOrdinary: 'oklch(0.24 0.035 255)',
		actionOrdinaryInk: 'oklch(0.93 0.01 250)',
		actionOrdinaryHover: 'oklch(0.28 0.04 255)',
		actionOrdinaryActive: 'oklch(0.32 0.045 255)',
		danger: 'oklch(0.35 0.1 25)',
		dangerInk: 'oklch(0.91 0.09 25)',
		actionDestructiveInk: 'oklch(0.82 0.13 25)',
		success: 'oklch(0.27 0.06 155)',
		successInk: 'oklch(0.79 0.12 155)',
		warning: 'oklch(0.28 0.065 85)',
		warningInk: 'oklch(0.84 0.12 85)',
		info: 'oklch(0.27 0.065 250)',
		infoInk: 'oklch(0.8 0.12 250)',
		sidebar: 'oklch(0.13 0.02 255)',
		sidebarInk: 'oklch(0.93 0.01 250)',
		sidebarActive: 'oklch(0.29 0.08 255)',
		sidebarActiveInk: 'oklch(0.95 0.01 250)',
		chart1: 'oklch(0.68 0.18 255)',
		chart2: 'oklch(0.7 0.13 205)',
		chart3: 'oklch(0.72 0.14 300)',
		chart4: 'oklch(0.78 0.13 75)',
		chart5: 'oklch(0.69 0.12 155)'
	},
	'dark'
);

export const studioTheme: ThemeManifest = theme(
	'studio',
	'Studio',
	'Cool white space and a precise cobalt control signal.',
	'heroicons-outline',
	{
		light: studioLight,
		dark: studioDark
	}
);
