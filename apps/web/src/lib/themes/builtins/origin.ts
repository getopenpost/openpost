import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, themeTypography, themeV2 } from './shared.js';

const playfair = bundledThemeFont('playfair-display');
const geist = bundledThemeFont('geist');
const geistMono = bundledThemeFont('geist-mono');

export const originDark = scheme(
	{
		colors: colors({
			canvas: 'oklch(0.16 0.004 250)',
			ink: 'oklch(0.96 0.003 250)',
			surface: 'oklch(0.32 0.004 250)',
			surfaceRaised: 'oklch(0.40 0.005 250)',
			surfaceSunken: 'oklch(0.135 0.003 250)',
			mutedInk: 'oklch(0.74 0.004 250)',
			border: 'oklch(0.28 0.006 250)',
			focus: 'oklch(0.92 0 0)',
			caret: 'oklch(0.96 0.003 250)',
			link: 'oklch(0.90 0.005 250)',
			selection: 'oklch(0.35 0.12 285)',
			selectionInk: 'oklch(0.96 0.003 250)',
			brand: 'oklch(0.72 0.19 285)',
			brandInk: 'oklch(0.14 0.01 250)',
			actionFocal: 'oklch(0.72 0.19 285)',
			actionFocalInk: 'oklch(0.14 0.01 250)',
			actionFocalHover: 'oklch(0.76 0.19 285)',
			actionFocalActive: 'oklch(0.80 0.18 285)',
			actionPrimary: 'oklch(0.99 0 0)',
			actionPrimaryInk: 'oklch(0.12 0.005 250)',
			actionPrimaryHover: 'oklch(0.92 0 0)',
			actionPrimaryActive: 'oklch(0.85 0.004 250)',
			actionOrdinary: 'oklch(0.24 0.006 250)',
			actionOrdinaryInk: 'oklch(0.96 0.003 250)',
			actionOrdinaryBorder: 'oklch(0.45 0.008 250)',
			actionOrdinaryHover: 'oklch(0.30 0.006 250)',
			actionOrdinaryActive: 'oklch(0.36 0.006 250)',
			danger: 'oklch(0.74 0.20 25)',
			dangerInk: 'oklch(0.12 0.005 250)',
			actionDestructiveHover: 'oklch(0.42 0.12 25)',
			actionDestructiveActive: 'oklch(0.36 0.11 25)',
			actionDestructiveInk: 'oklch(0.82 0.13 25)',
			success: 'oklch(0.30 0.06 160)',
			successInk: 'oklch(0.80 0.12 160)',
			warning: 'oklch(0.32 0.06 80)',
			warningInk: 'oklch(0.84 0.12 80)',
			info: 'oklch(0.35 0.08 260)',
			infoInk: 'oklch(0.82 0.09 260)',
			field: 'oklch(0.10 0.003 250)',
			fieldInk: 'oklch(0.96 0.003 250)',
			fieldBorder: 'oklch(0.32 0.006 250)',
			fieldHover: 'oklch(0.13 0.003 250)',
			fieldFocus: 'oklch(0.10 0.003 250)',
			sidebar: 'oklch(0.15 0.004 250)',
			sidebarInk: 'oklch(0.96 0.003 250)',
			sidebarActive: 'oklch(0.38 0.13 285)',
			sidebarActiveInk: 'oklch(0.99 0 0)',
			sidebarBorder: 'oklch(0.24 0.005 250)',
			chrome: 'oklch(0.15 0.004 250)',
			chromeInk: 'oklch(0.96 0.003 250)',
			chart1: 'oklch(0.72 0.15 285)',
			chart2: 'oklch(0.72 0.13 210)',
			chart3: 'oklch(0.72 0.15 340)',
			chart4: 'oklch(0.78 0.14 80)',
			chart5: 'oklch(0.72 0.14 150)'
		}),
		typography: themeTypography({
			display: {
				family: playfair.family,
				fallbacks: ['Source Serif 4', 'Georgia', 'serif'],
				weight: 400,
				size: 'clamp(2.375rem, 6vw, 6rem)',
				lineHeight: '1',
				tracking: '0em'
			},
			title: {
				family: geist.family,
				fallbacks: geist.fallbacks,
				weight: 400,
				size: '2.375rem',
				lineHeight: '1',
				tracking: '0em'
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
				family: geistMono.family,
				fallbacks: geistMono.fallbacks,
				weight: 500,
				size: '0.75rem',
				lineHeight: '1.6',
				tracking: '0.18em'
			},
			metadata: {
				family: geist.family,
				fallbacks: geist.fallbacks,
				weight: 400,
				size: '0.875rem',
				lineHeight: '1.5',
				tracking: '0em'
			},
			code: {
				family: geistMono.family,
				fallbacks: geistMono.fallbacks,
				weight: 400,
				size: '0.8125rem',
				lineHeight: '1.5',
				tracking: '0em'
			}
		}),
		spacing: {
			density: 'comfortable',
			controlHeight: '2.75rem',
			compactControlHeight: '2.25rem',
			touchTarget: '2.75rem',
			sectionGap: '5rem',
			componentGap: '0.75rem'
		},
		shape: {
			radius: '0.5rem',
			radiusSm: '0.5rem',
			radiusMd: '1rem',
			radiusLg: '1.875rem',
			radiusMedia: '1rem'
		},
		elevation: {
			card: 'none',
			popover: '0 18px 20px -12px rgb(0 0 0 / 0.45)',
			dialog: '0 24px 48px -16px rgb(0 0 0 / 0.55)',
			focalAction: '0 1px 2px -1px rgb(0 0 0 / 0.5)'
		},
		motion: {
			press: { duration: '200ms', easing: 'ease' },
			hover: { duration: '200ms', easing: 'ease' },
			selection: { duration: '200ms', easing: 'ease' },
			entry: {
				duration: '600ms',
				easing: 'cubic-bezier(0.455, 0.03, 0.515, 0.955)',
				distance: '0.75rem'
			},
			exit: { duration: '200ms', easing: 'ease' },
			pageTransition: {
				duration: '1200ms',
				easing: 'cubic-bezier(0.455, 0.03, 0.515, 0.955)',
				distance: '1rem'
			}
		},
		shell: { contentMaxWidth: '75rem', canvasTreatment: 'plain' },
		components: {
			button: 'solid',
			link: 'subtle',
			tabs: 'underline',
			navigation: 'quiet',
			input: 'outlined',
			select: 'outlined',
			card: 'flat',
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
			loadingState: 'pulse',
			editorChrome: 'neutral',
			decoration: 'editorial'
		}
	},
	'dark'
);

export const originTheme: ThemeManifest = themeV2(
	'origin',
	'Origin',
	'Midnight gallery of quiet wealth — whisper serif, white-on-black actions, iris tiles.',
	'lucide',
	{
		dark: originDark
	}
);
