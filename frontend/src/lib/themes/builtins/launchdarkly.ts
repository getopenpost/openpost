import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, themeMotion, themeTypography, themeV2 } from './shared.js';

const geist = bundledThemeFont('geist');
const geistMono = bundledThemeFont('geist-mono');

// Neon control room: deep charcoal cockpit, hairline-white borders, and a
// single violet voice. Elevation is glow, never shadow; corners are
// pill-soft; type stacks as a solid block (weight 500, tight leading).
export const launchdarklyDark = scheme(
	{
		colors: colors({
			canvas: 'oklch(0.18 0.005 285)',
			ink: 'oklch(0.98 0 0)',
			surface: 'oklch(0.24 0.006 285)',
			surfaceRaised: 'oklch(0.27 0.008 285)',
			surfaceSunken: 'oklch(0.21 0.006 285)',
			mutedInk: 'oklch(0.7 0.012 285)',
			border: 'oklch(0.32 0.01 285)',
			focus: 'oklch(0.66 0.16 278)',
			caret: 'oklch(0.66 0.16 278)',
			link: 'oklch(0.66 0.16 278)',
			selection: 'oklch(0.32 0.09 275)',
			selectionInk: 'oklch(0.96 0.005 285)',
			actionFocal: 'oklch(0.52 0.21 275)',
			actionFocalInk: 'oklch(0.98 0 0)',
			actionFocalHover: 'oklch(0.52 0.23 272)',
			actionFocalActive: 'oklch(0.46 0.21 276)',
			actionPrimary: 'oklch(0.92 0.005 285)',
			actionPrimaryInk: 'oklch(0.2 0.01 285)',
			actionPrimaryHover: 'oklch(0.96 0.003 285)',
			actionPrimaryActive: 'oklch(0.83 0.01 285)',
			actionOrdinary: 'oklch(0.24 0.006 285)',
			actionOrdinaryInk: 'oklch(0.83 0.01 285)',
			actionOrdinaryBorder: 'oklch(0.42 0.012 285)',
			actionOrdinaryHover: 'oklch(0.28 0.01 285)',
			actionOrdinaryActive: 'oklch(0.32 0.015 285)',
			actionQuietHover: 'oklch(0.27 0.01 285)',
			actionQuietActive: 'oklch(0.3 0.015 285)',
			danger: 'oklch(0.62 0.18 20)',
			dangerInk: 'oklch(0.15 0.01 25)',
			actionDestructive: 'oklch(0.30 0.09 20)',
			actionDestructiveHover: 'oklch(0.26 0.085 20)',
			actionDestructiveActive: 'oklch(0.22 0.08 20)',
			actionDestructiveInk: 'oklch(0.78 0.14 20)',
			success: 'oklch(0.3 0.06 160)',
			successInk: 'oklch(0.8 0.11 160)',
			warning: 'oklch(0.32 0.07 85)',
			warningInk: 'oklch(0.83 0.12 85)',
			info: 'oklch(0.3 0.08 265)',
			infoInk: 'oklch(0.78 0.12 270)',
			field: 'oklch(0.24 0.006 285)',
			fieldInk: 'oklch(0.98 0 0)',
			fieldBorder: 'oklch(0.38 0.01 285)',
			fieldHover: 'oklch(0.26 0.008 285)',
			navigationHover: 'oklch(0.27 0.01 285)',
			navigationActive: 'oklch(0.35 0.1 275)',
			navigationActiveInk: 'oklch(0.97 0 0)',
			sidebar: 'oklch(0.22 0.006 285)',
			sidebarInk: 'oklch(0.96 0.005 285)',
			sidebarActive: 'oklch(0.35 0.1 275)',
			sidebarActiveInk: 'oklch(0.97 0 0)',
			sidebarBorder: 'oklch(0.3 0.01 285)',
			chart1: 'oklch(0.72 0.15 285)',
			chart2: 'oklch(0.72 0.13 210)',
			chart3: 'oklch(0.78 0.14 80)',
			chart4: 'oklch(0.72 0.16 25)',
			chart5: 'oklch(0.72 0.14 150)'
		}),
		typography: themeTypography({
			display: {
				family: geist.family,
				fallbacks: geist.fallbacks,
				weight: 500,
				size: 'clamp(2.5rem, 7vw, 6.25rem)',
				lineHeight: '1.02',
				tracking: '-0.02em'
			},
			title: {
				family: geist.family,
				fallbacks: geist.fallbacks,
				weight: 500,
				size: '2.25rem',
				lineHeight: '1.2',
				tracking: '-0.01em'
			},
			body: {
				family: geist.family,
				fallbacks: geist.fallbacks,
				weight: 400,
				size: '1rem',
				lineHeight: '1.5',
				tracking: '0em'
			},
			label: {
				family: geist.family,
				fallbacks: geist.fallbacks,
				weight: 500,
				size: '0.875rem',
				lineHeight: '1.4',
				tracking: '0em'
			},
			metadata: {
				family: geist.family,
				fallbacks: geist.fallbacks,
				weight: 500,
				size: '0.75rem',
				lineHeight: '1.4',
				tracking: '0.14em'
			},
			code: {
				family: geistMono.family,
				fallbacks: geistMono.fallbacks,
				weight: 400,
				size: '0.875rem',
				lineHeight: '1.55',
				tracking: '0em'
			}
		}),
		spacing: {
			density: 'comfortable',
			base: '0.5rem',
			controlHeight: '3rem',
			compactControlHeight: '2.5rem',
			touchTarget: '2.75rem',
			pageGutter: 'clamp(1rem, 4vw, 2rem)',
			sectionGap: '5rem',
			componentGap: '1rem'
		},
		shape: {
			radius: '1.875rem',
			radiusSm: '0.625rem',
			radiusMd: '1.25rem',
			radiusLg: '1.875rem',
			radiusMedia: '1rem',
			radiusPill: '9999px',
			borderWidth: '1px',
			borderStyle: 'solid'
		},
		elevation: {
			card: 'none',
			popover: '0 0 40px -4px oklch(0.5 0.2 280 / 0.35)',
			dialog: '0 8px 48px -8px oklch(0.45 0.19 280 / 0.4)',
			focalAction: '0 0 32px -2px oklch(0.55 0.2 280 / 0.5)'
		},
		motion: themeMotion({
			press: {
				duration: '120ms',
				easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
				distance: '1px'
			},
			hover: {
				duration: '180ms',
				easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
				distance: '0px'
			},
			selection: {
				duration: '180ms',
				easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
				distance: '0px'
			},
			entry: {
				duration: '280ms',
				easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
				distance: '0.5rem',
				opacity: 0
			},
			pageTransition: {
				duration: '280ms',
				easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
				distance: '0.75rem',
				opacity: 0
			},
			reducedMotion: 'instant'
		}),
		shell: {
			contentMaxWidth: '75rem',
			sidebarWidth: '16rem',
			headerHeight: '4.5rem',
			canvasTreatment: 'plain'
		},
		components: {
			button: 'solid',
			link: 'subtle',
			tabs: 'segmented',
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
		}
	},
	'dark'
);

export const launchdarklyTheme: ThemeManifest = themeV2(
	'launchdarkly',
	'LaunchDarkly',
	'Neon control room: charcoal cockpit, pill-soft panels, one violet signal.',
	'lucide',
	{
		dark: launchdarklyDark
	}
);
