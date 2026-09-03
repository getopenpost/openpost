import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, theme, familyTypography } from './shared.js';

export const cloudGardenLight = scheme({
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

export const cloudGardenTheme: ThemeManifest = theme(
	'cloud-garden',
	'Cloud Garden',
	'White and mint layers with restrained botanical depth.',
	'heroicons-solid',
	{ light: cloudGardenLight }
);
