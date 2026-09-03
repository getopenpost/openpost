import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, theme } from './shared.js';

export const workshopLight = scheme({
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
export const workshopDark = scheme(
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

export const workshopTheme: ThemeManifest = theme(
	'workshop',
	'Workshop',
	'Warm technical minimalism with one clear orange signal.',
	'lucide',
	{ light: workshopLight, dark: workshopDark }
);
