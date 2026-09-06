import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, theme, familyTypography } from './shared.js';

export const midnightDark = scheme(
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

export const midnightTheme: ThemeManifest = theme(
	'midnight',
	'Midnight',
	'A dark precision instrument with a chartreuse focal signal.',
	'phosphor',
	{
		dark: midnightDark
	}
);
