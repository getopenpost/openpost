import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, familyTypography, scheme, theme } from './shared.js';

const inter = bundledThemeFont('inter');

export const ferrariDark = scheme(
	{
		colors: colors({
			canvas: 'oklch(0 0 0)',
			ink: 'oklch(1 0 0)',
			surface: 'oklch(0.135 0 0)',
			surfaceSunken: 'oklch(0 0 0)',
			mutedInk: 'oklch(0.59 0 0)',
			border: 'oklch(0.21 0 0)',
			focus: 'oklch(1 0 0)',
			caret: 'oklch(0.51 0.19 30)',
			link: 'oklch(1 0 0)',
			selection: 'oklch(0.24 0 0)',
			selectionInk: 'oklch(1 0 0)',
			actionFocal: 'oklch(0.51 0.19 30)',
			actionFocalInk: 'oklch(1 0 0)',
			actionFocalHover: 'oklch(0.45 0.17 29)',
			actionFocalActive: 'oklch(0.40 0.15 28)',
			actionPrimary: 'oklch(1 0 0)',
			actionPrimaryInk: 'oklch(0 0 0)',
			actionPrimaryHover: 'oklch(0.90 0 0)',
			actionPrimaryActive: 'oklch(0.80 0 0)',
			actionOrdinary: 'oklch(0.16 0 0)',
			actionOrdinaryInk: 'oklch(1 0 0)',
			actionOrdinaryHover: 'oklch(0.22 0 0)',
			actionOrdinaryActive: 'oklch(0.27 0 0)',
			actionQuietHover: 'oklch(0.18 0 0)',
			actionQuietActive: 'oklch(0.24 0 0)',
			danger: 'oklch(0.62 0.19 25)',
			dangerInk: 'oklch(0 0 0)',
			actionDestructive: 'oklch(0.25 0.08 25)',
			actionDestructiveInk: 'oklch(1 0 0)',
			actionDestructiveHover: 'oklch(0.32 0.10 25)',
			actionDestructiveActive: 'oklch(0.40 0.13 25)',
			success: 'oklch(0.30 0.06 155)',
			successInk: 'oklch(0.80 0.12 155)',
			warning: 'oklch(0.32 0.06 80)',
			warningInk: 'oklch(0.84 0.12 80)',
			info: 'oklch(0.30 0.05 245)',
			infoInk: 'oklch(0.78 0.11 245)',
			navigationHover: 'oklch(0.16 0 0)',
			navigationActive: 'oklch(0.22 0.05 30)',
			navigationActiveInk: 'oklch(1 0 0)',
			sidebar: 'oklch(0.10 0 0)',
			sidebarInk: 'oklch(1 0 0)',
			sidebarActive: 'oklch(0.28 0.07 30)',
			sidebarActiveInk: 'oklch(1 0 0)',
			chart1: 'oklch(0.55 0.19 30)',
			chart2: 'oklch(0.70 0 0)',
			chart3: 'oklch(0.45 0 0)',
			chart4: 'oklch(0.42 0.15 28)',
			chart5: 'oklch(0.92 0 0)'
		}),
		typography: {
			...familyTypography('inter'),
			display: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 500,
				size: '1.5rem',
				lineHeight: '1.27',
				tracking: '0.005em'
			},
			title: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 500,
				size: '1.125rem',
				lineHeight: '1.5',
				tracking: '0.02em'
			},
			body: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 400,
				size: '0.875rem',
				lineHeight: '1.78',
				tracking: '0.015em'
			},
			label: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 400,
				size: '0.75rem',
				lineHeight: '1.5',
				tracking: '0.083em'
			},
			metadata: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 400,
				size: '0.6875rem',
				lineHeight: '1.78',
				tracking: '0.091em'
			}
		},
		spacing: {
			density: 'comfortable',
			controlHeight: '2.25rem',
			compactControlHeight: '2rem',
			touchTarget: '2.75rem',
			pageGutter: 'clamp(1rem, 5vw, 4rem)',
			sectionGap: '4.5rem',
			componentGap: '0.75rem'
		},
		shape: {
			radius: '0px',
			radiusSm: '0px',
			radiusMd: '0px',
			radiusLg: '0px',
			radiusMedia: '0px',
			radiusPill: '9999px',
			borderWidth: '1px',
			borderStyle: 'solid'
		},
		elevation: {
			card: 'none',
			popover: 'none',
			dialog: 'none',
			focalAction: 'none'
		},
		motion: {
			press: { duration: '80ms', distance: '0px' },
			hover: { duration: '160ms', distance: '0px' },
			entry: {
				duration: '400ms',
				easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
				distance: '0.25rem',
				opacity: 0
			},
			pageTransition: {
				duration: '320ms',
				easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
				distance: '0.5rem',
				opacity: 0
			},
			reducedMotion: 'instant'
		},
		shell: {
			contentMaxWidth: '90rem',
			sidebarWidth: '15rem',
			headerHeight: '3.25rem',
			canvasTreatment: 'plain'
		},
		components: {
			button: 'outlined',
			link: 'plain',
			tabs: 'underline',
			navigation: 'quiet',
			input: 'underlined',
			select: 'underlined',
			card: 'flat',
			container: 'flat',
			table: 'ruled',
			list: 'divided',
			badge: 'outlined',
			chip: 'outlined',
			dialog: 'flat',
			popover: 'flat',
			toast: 'flat',
			switch: 'outlined',
			checkbox: 'outlined',
			radio: 'outlined',
			toolbar: 'flat',
			pagination: 'quiet',
			emptyState: 'plain',
			loadingState: 'pulse',
			editorChrome: 'neutral',
			decoration: 'none'
		}
	},
	'dark'
);

export const ferrariTheme: ThemeManifest = theme(
	'ferrari',
	'Ferrari',
	'Black cinematic void, sharp zero-radius geometry, and a single Rosso Corsa signal.',
	'heroicons-outline',
	{
		dark: ferrariDark
	}
);
