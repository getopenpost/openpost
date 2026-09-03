import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, theme, familyTypography } from './shared.js';

export const studyHallLight = scheme({
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

export const studyHallTheme: ThemeManifest = theme(
	'study-hall',
	'Study Hall',
	'Cool structured surfaces with indigo study signals.',
	'lucide',
	{
			light: studyHallLight
		}
);
