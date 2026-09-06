import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, themeTypography, themeV2 } from './shared.js';

// Inter Variable is bundled, so the primary face maps one-to-one including
// the brand's intermediate 510/590 weights. Berkeley Mono's role (issue IDs,
// shortcuts, technical metadata) falls to Geist Mono.
const inter = bundledThemeFont('inter');
const mono = bundledThemeFont('geist-mono');

export const linearDark = scheme(
	{
		colors: colors({
			canvas: 'oklch(0.145 0.005 260)',
			ink: 'oklch(0.99 0 0)',
			surface: 'oklch(0.18 0.005 260)',
			surfaceRaised: 'oklch(0.21 0.006 260)',
			surfaceSunken: 'oklch(0.21 0.006 260)',
			// Brand Ash (#62666d) cannot clear 4.5 on the void, so the muted
			// step moves up to Fog; Ash survives only in non-text roles.
			mutedInk: 'oklch(0.64 0.018 260)',
			border: 'oklch(0.27 0.01 260)',
			focus: 'oklch(0.86 0.02 260)',
			caret: 'oklch(0.905 0.195 115)',
			link: 'oklch(0.86 0.02 260)',
			selection: 'oklch(0.28 0.03 250)',
			selectionInk: 'oklch(0.86 0.02 260)',
			// Acid Lime, rationed to the single primary action per view.
			actionFocal: 'oklch(0.905 0.195 115)',
			actionFocalInk: 'oklch(0.145 0.005 260)',
			actionFocalHover: 'oklch(0.93 0.19 115)',
			actionFocalActive: 'oklch(0.87 0.19 115)',
			// The white sign-up pill: highest neutral contrast after lime.
			actionPrimary: 'oklch(0.93 0.005 260)',
			actionPrimaryInk: 'oklch(0.145 0.005 260)',
			actionPrimaryHover: 'oklch(0.97 0.003 260)',
			actionPrimaryActive: 'oklch(0.99 0 0)',
			actionOrdinary: 'oklch(0.22 0.008 260)',
			actionOrdinaryInk: 'oklch(0.86 0.02 260)',
			actionOrdinaryHover: 'oklch(0.27 0.01 260)',
			actionOrdinaryActive: 'oklch(0.32 0.012 260)',
			danger: 'oklch(0.65 0.19 22)',
			dangerInk: 'oklch(0.145 0.005 260)',
			// Explicit dark red-tinted washes: the default transparent mixes
			// would leave coral text unreadable on the active step.
			actionDestructive: 'oklch(0.3 0.06 22)',
			actionDestructiveInk: 'oklch(0.72 0.15 22)',
			actionDestructiveHover: 'oklch(0.27 0.06 22)',
			actionDestructiveActive: 'oklch(0.24 0.06 22)',
			// Pulse Green, darkened surface with a lightened ink.
			success: 'oklch(0.27 0.06 155)',
			successInk: 'oklch(0.78 0.14 150)',
			warning: 'oklch(0.3 0.06 85)',
			warningInk: 'oklch(0.85 0.12 85)',
			// Signal Teal carries informational roles.
			info: 'oklch(0.24 0.05 220)',
			infoInk: 'oklch(0.78 0.1 220)',
			field: 'oklch(0.2 0.008 260)',
			fieldInk: 'oklch(0.86 0.02 260)',
			fieldBorder: 'oklch(0.35 0.012 260)',
			// Ash-on-obsidian cannot clear the disabled floor, so disabled
			// text steps up toward Mist on a lifted disabled surface.
			fieldDisabled: 'oklch(0.24 0.012 260)',
			fieldDisabledInk: 'oklch(0.72 0.02 260)',
			sidebar: 'oklch(0.18 0.005 260)',
			sidebarInk: 'oklch(0.86 0.02 260)',
			sidebarActive: 'oklch(0.28 0.03 250)',
			sidebarActiveInk: 'oklch(0.99 0 0)',
			// Tag palette: lime, iris, teal, coral, lavender — lightened for
			// dark surfaces, in the brand's own tag order.
			chart1: 'oklch(0.78 0.16 115)',
			chart2: 'oklch(0.72 0.15 285)',
			chart3: 'oklch(0.74 0.13 205)',
			chart4: 'oklch(0.72 0.16 25)',
			chart5: 'oklch(0.78 0.14 70)'
		}),
		typography: themeTypography({
			display: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 500,
				size: 'clamp(2.5rem, 5vw, 4rem)',
				lineHeight: '1',
				tracking: '-0.022em'
			},
			title: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 500,
				size: '1.5rem',
				lineHeight: '1.33',
				tracking: '-0.012em'
			},
			body: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 400,
				size: '1rem',
				lineHeight: '1.5',
				tracking: '0em'
			},
			label: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 500,
				size: '0.8125rem',
				lineHeight: '1.4',
				tracking: '-0.01em'
			},
			metadata: {
				family: inter.family,
				fallbacks: inter.fallbacks,
				weight: 400,
				size: '0.75rem',
				lineHeight: '1.4',
				tracking: '0em'
			},
			code: {
				family: mono.family,
				fallbacks: mono.fallbacks,
				weight: 400,
				size: '0.8125rem',
				lineHeight: '1.5',
				tracking: '0em'
			}
		}),
		spacing: {
			density: 'compact',
			controlHeight: '2.25rem',
			compactControlHeight: '2rem',
			sectionGap: '6rem',
			componentGap: '0.5rem'
		},
		shape: {
			radius: '0.375rem',
			radiusSm: '0.25rem',
			radiusMd: '0.375rem',
			radiusLg: '0.75rem',
			radiusMedia: '0.75rem',
			radiusPill: '9999px',
			borderWidth: '1px',
			borderStyle: 'solid'
		},
		elevation: {
			card: 'none',
			popover: '0 8px 32px -8px rgb(0 0 0 / 0.7)',
			dialog: '0 4px 32px 0 rgb(8 9 10 / 0.6)',
			// The CTA's machined edge: a dark outer bite instead of a drop shadow.
			focalAction: '0 1px 2px 0 rgb(0 0 0 / 0.35)'
		},
		motion: {
			press: { duration: '80ms', distance: '0px' },
			hover: { duration: '100ms' },
			entry: { duration: '180ms', distance: '0.25rem' },
			exit: { duration: '120ms', distance: '0.125rem' },
			loading: { duration: '800ms' },
			pageTransition: { duration: '180ms', distance: '0.5rem' },
			reducedMotion: 'instant'
		},
		shell: {
			contentMaxWidth: '75rem',
			headerHeight: '3.5rem',
			canvasTreatment: 'precision'
		},
		components: {
			button: 'solid',
			link: 'subtle',
			tabs: 'segmented',
			navigation: 'quiet',
			card: 'flat',
			badge: 'tonal',
			chip: 'tonal',
			dialog: 'elevated',
			popover: 'elevated',
			editorChrome: 'precision',
			decoration: 'none'
		}
	},
	'dark'
);

export const linearTheme: ThemeManifest = themeV2(
	'linear',
	'Linear',
	'Midnight precision instrument with an acid-lime flash.',
	'heroicons-outline',
	{ dark: linearDark }
);
