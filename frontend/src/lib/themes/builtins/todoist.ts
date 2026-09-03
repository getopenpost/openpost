import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, theme } from './shared.js';
import { bundledThemeFont } from '../bundled-fonts.js';

// Graphik (display/headings) -> Inter Tight: same neo-grotesque voice with the
// tight negative tracking the display scale demands. Inter (UI/body) -> Inter.
// Caecilia (testimonial serif) has no pull-quote role in the token system, so
// the literary accent is documented, not placed.
const interTight = bundledThemeFont('inter-tight');
const inter = bundledThemeFont('inter');
const geistMono = bundledThemeFont('geist-mono');

export const todoistLight = scheme({
	colors: colors({
		canvas: 'oklch(0.995 0.002 68)',
		ink: 'oklch(0.254 0.009 75)',
		surface: 'oklch(0.995 0.002 68)',
		surfaceSunken: 'oklch(0.978 0.013 56)',
		mutedInk: 'oklch(0.533 0.006 68)',
		border: 'oklch(0.876 0.003 85)',
		focus: 'oklch(0.502 0.137 250)',
		caret: 'oklch(0.615 0.199 30)',
		link: 'oklch(0.502 0.137 250)',
		brand: 'oklch(0.565 0.194 31)',
		brandInk: 'oklch(0.995 0.002 68)',
		selection: 'oklch(0.933 0.032 258)',
		selectionInk: 'oklch(0.254 0.009 75)',
		actionFocal: 'oklch(0.565 0.194 31)',
		actionFocalInk: 'oklch(0.995 0.002 68)',
		actionFocalHover: 'oklch(0.507 0.173 31)',
		actionFocalActive: 'oklch(0.45 0.155 31)',
		actionPrimary: 'oklch(0.4 0.006 68)',
		actionPrimaryInk: 'oklch(0.995 0.002 68)',
		actionPrimaryHover: 'oklch(0.339 0.005 56)',
		actionPrimaryActive: 'oklch(0.254 0.009 75)',
		actionOrdinary: 'oklch(0.995 0.002 68)',
		actionOrdinaryInk: 'oklch(0.254 0.009 75)',
		actionOrdinaryHover: 'oklch(0.978 0.013 56)',
		actionOrdinaryActive: 'oklch(0.945 0.012 70)',
		danger: 'oklch(0.565 0.194 31)',
		dangerInk: 'oklch(0.995 0.002 68)',
		actionDestructive: 'oklch(0.94 0.04 40)',
		actionDestructiveInk: 'oklch(0.45 0.17 30)',
		actionDestructiveHover: 'oklch(0.91 0.05 40)',
		actionDestructiveActive: 'oklch(0.88 0.06 40)',
		success: 'oklch(0.962 0.031 119)',
		successInk: 'oklch(0.42 0.085 141)',
		warning: 'oklch(0.93 0.06 85)',
		warningInk: 'oklch(0.45 0.1 70)',
		info: 'oklch(0.933 0.032 258)',
		infoInk: 'oklch(0.44 0.12 252)',
		sidebar: 'oklch(0.99 0.004 72)',
		sidebarInk: 'oklch(0.254 0.009 75)',
		sidebarActive: 'oklch(0.93 0.045 40)',
		sidebarActiveInk: 'oklch(0.5 0.16 32)',
		chart1: 'oklch(0.615 0.199 30)',
		chart2: 'oklch(0.502 0.137 250)',
		chart3: 'oklch(0.489 0.085 141)',
		chart4: 'oklch(0.554 0.056 197)',
		chart5: 'oklch(0.751 0.158 75)'
	}),
	typography: {
		display: {
			family: interTight.family,
			fallbacks: interTight.fallbacks,
			weight: 700,
			size: 'clamp(2.375rem, 4vw, 3.4375rem)',
			lineHeight: '1',
			tracking: '-0.01em'
		},
		title: {
			family: interTight.family,
			fallbacks: interTight.fallbacks,
			weight: 600,
			size: 'clamp(1.75rem, 2.5vw, 2.75rem)',
			lineHeight: '1.15',
			tracking: '-0.005em'
		},
		body: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '1rem',
			lineHeight: '1.5',
			tracking: '0.01em'
		},
		label: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 600,
			size: '0.875rem',
			lineHeight: '1.4',
			tracking: '0.005em'
		},
		metadata: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '0.75rem',
			lineHeight: '1.5',
			tracking: '0.012em'
		},
		code: {
			family: geistMono.family,
			fallbacks: geistMono.fallbacks,
			weight: 400,
			size: '0.8125rem',
			lineHeight: '1.45',
			tracking: '0em'
		}
	},
	spacing: {
		density: 'comfortable',
		sectionGap: '4rem',
		componentGap: '1rem'
	},
	shape: {
		radius: '0.5rem',
		radiusSm: '0.5rem',
		radiusMd: '0.5rem',
		radiusLg: '0.5rem',
		radiusMedia: '0.9375rem',
		borderWidth: '1px',
		borderStyle: 'solid'
	},
	elevation: {
		card: '0 1px 0 0 oklch(0.25 0.01 70 / 0.05)',
		popover: '0 12px 30px -18px oklch(0.25 0.01 70 / 0.25)',
		dialog: '0 24px 56px -28px oklch(0.25 0.01 70 / 0.3)',
		focalAction: '0 12px 28px -12px oklch(0.5 0.16 32 / 0.45)'
	},
	motion: {
		press: { duration: '100ms', distance: '1px' },
		hover: { duration: '160ms' },
		entry: { duration: '240ms' },
		reducedMotion: 'instant'
	},
	shell: { contentMaxWidth: '75rem', canvasTreatment: 'paper' },
	components: {
		button: 'solid',
		link: 'plain',
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
		loadingState: 'skeleton',
		editorChrome: 'neutral',
		decoration: 'none'
	}
});

export const todoistTheme: ThemeManifest = theme(
	'todoist',
	'Todoist',
	'Sunlit paper planner with warm ink and one red pen.',
	'heroicons-outline',
	{
		light: todoistLight
	}
);
