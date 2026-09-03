import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, familyTypography, scheme, theme, themeMotion, themeTypography } from './shared.js';

const geistMono = bundledThemeFont('geist-mono');

// Circular (geometric humanist sans, anti-bold: headlines at 400, emphasis at
// 500) maps to Manrope; Source Code Pro maps to Geist Mono.
const circular = familyTypography('manrope', { displayWeight: 400, titleWeight: 500 });

export const supabaseDark = scheme(
	{
		colors: colors({
			canvas: 'oklch(0.182 0 90)',
			ink: 'oklch(0.985 0 90)',
			surface: 'oklch(0.182 0 90)',
			surfaceRaised: 'oklch(0.26 0 90)',
			surfaceSunken: 'oklch(0.159 0 90)',
			mutedInk: 'oklch(0.77 0 90)',
			border: 'oklch(0.301 0 90)',
			focus: 'oklch(0.724 0.178 155)',
			caret: 'oklch(0.762 0.154 159)',
			link: 'oklch(0.724 0.178 155)',
			selection: 'oklch(0.273 0.024 164)',
			selectionInk: 'oklch(0.985 0 90)',
			brand: 'oklch(0.762 0.154 159)',
			brandInk: 'oklch(0.182 0 90)',
			actionFocal: 'oklch(0.762 0.154 159)',
			actionFocalInk: 'oklch(0.182 0 90)',
			actionFocalHover: 'oklch(0.668 0.139 159)',
			actionFocalActive: 'oklch(0.606 0.122 161)',
			actionPrimary: 'oklch(0.26 0 90)',
			actionPrimaryInk: 'oklch(0.985 0 90)',
			actionPrimaryHover: 'oklch(0.301 0 90)',
			actionPrimaryActive: 'oklch(0.2 0 90)',
			actionOrdinary: 'oklch(0.2 0 90)',
			actionOrdinaryInk: 'oklch(0.985 0 90)',
			actionOrdinaryBorder: 'oklch(0.345 0 90)',
			actionOrdinaryHover: 'oklch(0.252 0 90)',
			actionOrdinaryActive: 'oklch(0.285 0 90)',
			field: 'oklch(0.182 0 90)',
			fieldBorder: 'oklch(0.345 0 90)',
			danger: 'oklch(0.251 0.061 22)',
			dangerInk: 'oklch(0.985 0 90)',
			actionDestructive: 'oklch(0.40 0.09 22)',
			actionDestructiveHover: 'oklch(0.33 0.085 22)',
			actionDestructiveActive: 'oklch(0.26 0.07 22)',
			actionDestructiveInk: 'oklch(0.80 0.11 20)',
			success: 'oklch(0.293 0.043 166)',
			successInk: 'oklch(0.832 0.139 158)',
			warning: 'oklch(0.271 0.04 71)',
			warningInk: 'oklch(0.807 0.126 74)',
			info: 'oklch(0.266 0.044 250)',
			infoInk: 'oklch(0.765 0.1 249)',
			navigationHover: 'oklch(0.222 0 90)',
			navigationActive: 'oklch(0.298 0.048 164)',
			navigationActiveInk: 'oklch(0.985 0 90)',
			sidebar: 'oklch(0.173 0 90)',
			sidebarInk: 'oklch(0.985 0 90)',
			sidebarActive: 'oklch(0.298 0.048 164)',
			sidebarActiveInk: 'oklch(0.985 0 90)',
			chart1: 'oklch(0.762 0.154 159)',
			chart2: 'oklch(0.724 0.178 155)',
			chart3: 'oklch(0.77 0 90)',
			chart4: 'oklch(0.63 0 90)',
			chart5: 'oklch(0.375 0.06 162)'
		}),
		typography: themeTypography({
			...circular,
			display: { ...circular.display, size: '4.5rem', lineHeight: '1', tracking: '-0.007em' },
			title: { ...circular.title, size: '2.25rem', lineHeight: '1.2', tracking: '-0.007em' },
			body: { ...circular.body, size: '1rem', lineHeight: '1.5', tracking: '-0.007em' },
			label: {
				...circular.label,
				weight: 500,
				size: '0.875rem',
				lineHeight: '1.43',
				tracking: '-0.007em'
			},
			metadata: {
				...circular.metadata,
				weight: 400,
				size: '0.75rem',
				lineHeight: '1.5',
				tracking: '-0.007em'
			},
			code: {
				family: geistMono.family,
				fallbacks: geistMono.fallbacks,
				weight: 400,
				size: '0.75rem',
				lineHeight: '1.33',
				tracking: '0.1em'
			}
		}),
		spacing: {
			density: 'comfortable',
			base: '0.5rem',
			controlHeight: '2.25rem',
			compactControlHeight: '2rem',
			pageGutter: 'clamp(1rem, 3vw, 2rem)',
			sectionGap: '5rem',
			componentGap: '1rem'
		},
		shape: {
			radius: '1rem',
			radiusSm: '0.5rem',
			radiusMd: '0.75rem',
			radiusLg: '1rem',
			radiusMedia: '1rem',
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
		motion: themeMotion({
			press: { duration: '80ms', distance: '0px' },
			hover: { duration: '120ms' },
			selection: { duration: '120ms' },
			entry: { duration: '200ms', distance: '0.5rem' },
			exit: { duration: '120ms', distance: '0.25rem' },
			loading: { duration: '900ms' },
			pageTransition: { duration: '200ms', distance: '0.5rem' },
			reducedMotion: 'instant'
		}),
		shell: {
			contentMaxWidth: '75rem',
			headerHeight: '4rem',
			canvasTreatment: 'precision'
		},
		components: {
			button: 'solid',
			link: 'plain',
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
			dialog: 'flat',
			popover: 'flat',
			toast: 'outlined',
			switch: 'solid',
			checkbox: 'solid',
			radio: 'solid',
			toolbar: 'flat',
			pagination: 'quiet',
			emptyState: 'plain',
			loadingState: 'spinner',
			editorChrome: 'neutral',
			decoration: 'none'
		}
	},
	'dark'
);

export const supabaseTheme: ThemeManifest = theme(
	'supabase',
	'Supabase',
	'Midnight code editor with a single phosphor green pulse on charcoal.',
	'heroicons-outline',
	{
		dark: supabaseDark
	}
);
