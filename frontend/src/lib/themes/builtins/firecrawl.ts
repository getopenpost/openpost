import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, theme, themeTypography } from './shared.js';

// Suisse (humanist grotesque) has no bundled twin; Inter Variable carries the
// same engineered grotesque voice with matching tight display tracking and a
// real 500 for calm-authority headings. Geist Mono covers every technical
// string per the brand's binary Suisse/mono split.
const inter = bundledThemeFont('inter');
const mono = bundledThemeFont('geist-mono');

export const firecrawlLight = scheme({
	colors: colors({
		canvas: 'oklch(1 0 0)',
		ink: 'oklch(0.25 0.005 90)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.975 0.003 90)',
		mutedInk: 'oklch(0.52 0.005 90)',
		border: 'oklch(0.905 0.005 250)',
		// Deep ember, not the signal orange: readable as a ring on white while
		// staying a clear distance from the focal CTA fill.
		focus: 'oklch(0.48 0.17 42)',
		caret: 'oklch(0.65 0.22 45)',
		// Body-copy links are Graphite, never the rationed orange.
		link: 'oklch(0.46 0.005 90)',
		selection: 'oklch(0.9 0.07 40)',
		selectionInk: 'oklch(0.25 0.005 90)',
		// Ember Orange, rationed to the CTA. Ink is near-black: white text on
		// the signal fill cannot clear the 4.5 floor, and the brand's own
		// component guidance ships dark text on the orange pill.
		actionFocal: 'oklch(0.65 0.22 45)',
		actionFocalInk: 'oklch(0.12 0.005 90)',
		actionFocalHover: 'oklch(0.62 0.215 44)',
		actionFocalActive: 'oklch(0.6 0.21 43)',
		actionPrimary: 'oklch(0.25 0.005 90)',
		actionPrimaryInk: 'oklch(0.99 0 0)',
		actionPrimaryHover: 'oklch(0.32 0.005 90)',
		actionPrimaryActive: 'oklch(0.18 0.005 90)',
		actionOrdinary: 'oklch(0.96 0.004 90)',
		actionOrdinaryInk: 'oklch(0.25 0.005 90)',
		actionOrdinaryHover: 'oklch(0.93 0.005 90)',
		actionOrdinaryActive: 'oklch(0.9 0.005 90)',
		// No red exists in this palette; the signal orange doubles as danger
		// with near-black ink so every danger pair clears the floor.
		danger: 'oklch(0.62 0.21 42)',
		dangerInk: 'oklch(0.12 0.005 90)',
		// Destructive washes carry visible ember tint so the resting fill stays
		// distinct from the ordinary action, with dark ink for contrast.
		actionDestructive: 'oklch(0.90 0.06 45)',
		actionDestructiveHover: 'oklch(0.86 0.08 45)',
		actionDestructiveActive: 'oklch(0.81 0.10 45)',
		actionDestructiveInk: 'oklch(0.25 0.005 90)',
		// No green either; success is a warm ember wash with ember-brown ink.
		success: 'oklch(0.9 0.07 45)',
		successInk: 'oklch(0.42 0.14 40)',
		warning: 'oklch(0.94 0.07 85)',
		warningInk: 'oklch(0.42 0.11 75)',
		// No blue by discipline; info is a monochrome wash.
		info: 'oklch(0.92 0.006 90)',
		infoInk: 'oklch(0.35 0.008 90)',
		sidebar: 'oklch(1 0 0)',
		sidebarInk: 'oklch(0.25 0.005 90)',
		sidebarActive: 'oklch(0.9 0.07 40)',
		sidebarActiveInk: 'oklch(0.25 0.005 90)',
		field: 'oklch(1 0 0)',
		fieldInk: 'oklch(0.25 0.005 90)',
		fieldBorder: 'oklch(0.905 0.005 250)',
		// Monochrome chart ramp: the orange is rationed to chart1, grays do
		// the rest, exactly as the brand's data surfaces behave.
		chart1: 'oklch(0.65 0.22 45)',
		chart2: 'oklch(0.46 0.005 90)',
		chart3: 'oklch(0.52 0.005 90)',
		chart4: 'oklch(0.64 0.005 90)',
		chart5: 'oklch(0.75 0.004 90)'
	}),
	typography: themeTypography({
		display: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '3.25rem',
			lineHeight: '1.07',
			tracking: '-0.005em'
		},
		title: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '1.5rem',
			lineHeight: '1.2',
			tracking: '0em'
		},
		body: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '0.875rem',
			lineHeight: '1.5',
			tracking: '0.01em'
		},
		label: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '0.875rem',
			lineHeight: '1.4',
			tracking: '0.01em'
		},
		metadata: {
			family: mono.family,
			fallbacks: mono.fallbacks,
			weight: 500,
			size: '0.75rem',
			lineHeight: '1.5',
			tracking: '0.02em'
		},
		code: {
			family: mono.family,
			fallbacks: mono.fallbacks,
			weight: 400,
			size: '0.8125rem',
			lineHeight: '1.57',
			tracking: '0em'
		}
	}),
	spacing: {
		density: 'comfortable',
		controlHeight: '2.5rem',
		compactControlHeight: '2rem',
		sectionGap: '6rem',
		componentGap: '0.75rem'
	},
	shape: {
		radius: '0.75rem',
		radiusSm: '0.5rem',
		radiusMd: '0.5rem',
		radiusLg: '1rem',
		radiusMedia: '0.5rem',
		radiusPill: '9999px',
		borderWidth: '1px',
		borderStyle: 'solid'
	},
	elevation: {
		card: 'none',
		popover: '0 24px 48px -20px rgb(38 38 38 / 0.12)',
		dialog: '0 40px 64px -24px rgb(38 38 38 / 0.16)',
		// The ember bloom: a warm halo ring instead of a drop shadow.
		focalAction: '0 0 0 6px rgb(255 77 0 / 0.16)'
	},
	motion: {
		press: { duration: '120ms', distance: '1px' },
		hover: { duration: '150ms' },
		entry: { duration: '280ms', distance: '0.5rem' },
		reducedMotion: 'instant'
	},
	shell: {
		contentMaxWidth: '75rem',
		headerHeight: '4rem',
		canvasTreatment: 'precision'
	},
	components: {
		button: 'pill',
		link: 'subtle',
		tabs: 'underline',
		navigation: 'quiet',
		card: 'outlined',
		badge: 'solid',
		chip: 'tonal',
		dialog: 'elevated',
		popover: 'elevated',
		decoration: 'precision'
	}
});

export const firecrawlTheme: ThemeManifest = theme(
	'firecrawl',
	'Firecrawl',
	'Warm vellum workspace with one burning orange signal.',
	'lucide',
	{ light: firecrawlLight }
);
