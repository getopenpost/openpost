import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, theme, themeMotion, themeTypography } from './shared.js';

const interTight = bundledThemeFont('inter-tight');
const inter = bundledThemeFont('inter');
const geistMono = bundledThemeFont('geist-mono');

// Warm paper desktop pinned to cork: a sandy desk canvas, white application
// windows with hairline borders, 4px radii, and exactly four rationed
// accents — signal blue for live states, amber for the single CTA, flame for
// tags, moss for confirmation. Flat printed paper, never floating glass.
export const posthogLight = scheme({
	colors: colors({
		canvas: 'oklch(0.84 0.05 88)',
		ink: 'oklch(0.28 0.03 110)',
		surface: 'oklch(1 0 0)',
		surfaceRaised: 'oklch(0.99 0.005 90)',
		surfaceSunken: 'oklch(0.93 0.015 95)',
		mutedInk: 'oklch(0.42 0.03 110)',
		border: 'oklch(0.78 0.03 100)',
		focus: 'oklch(0.47 0.17 255)',
		caret: 'oklch(0.47 0.17 255)',
		link: 'oklch(0.45 0.16 255)',
		selection: 'oklch(0.9 0.06 255)',
		selectionInk: 'oklch(0.28 0.03 110)',
		actionFocal: 'oklch(0.72 0.15 70)',
		actionFocalInk: 'oklch(0.28 0.03 110)',
		actionFocalHover: 'oklch(0.72 0.17 66)',
		actionFocalActive: 'oklch(0.72 0.13 74)',
		actionPrimary: 'oklch(0.28 0.03 110)',
		actionPrimaryInk: 'oklch(0.99 0.005 90)',
		actionPrimaryHover: 'oklch(0.22 0.025 110)',
		actionPrimaryActive: 'oklch(0.16 0.02 110)',
		actionOrdinary: 'oklch(0.99 0.005 90)',
		actionOrdinaryInk: 'oklch(0.4 0.11 70)',
		actionOrdinaryBorder: 'oklch(0.6 0.11 72)',
		actionOrdinaryHover: 'oklch(0.93 0.015 95)',
		actionOrdinaryActive: 'oklch(0.9 0.02 95)',
		actionQuietHover: 'oklch(0.9 0.02 95)',
		actionQuietActive: 'oklch(0.87 0.025 95)',
		disabledInk: 'oklch(0.42 0.03 110)',
		actionLink: 'oklch(0.45 0.16 255)',
		actionLinkHover: 'oklch(0.39 0.14 255)',
		danger: 'oklch(0.62 0.22 40)',
		dangerInk: 'oklch(0.15 0.02 40)',
		actionDestructive: 'oklch(0.45 0.16 35)',
		actionDestructiveInk: 'oklch(0.97 0.01 40)',
		actionDestructiveHover: 'oklch(0.42 0.16 34)',
		actionDestructiveActive: 'oklch(0.39 0.16 33)',
		success: 'oklch(0.9 0.07 145)',
		successInk: 'oklch(0.42 0.12 145)',
		warning: 'oklch(0.9 0.1 80)',
		warningInk: 'oklch(0.5 0.12 70)',
		info: 'oklch(0.9 0.06 255)',
		infoInk: 'oklch(0.48 0.16 255)',
		field: 'oklch(1 0 0)',
		fieldInk: 'oklch(0.28 0.03 110)',
		fieldBorder: 'oklch(0.78 0.03 100)',
		fieldHover: 'oklch(0.93 0.015 95)',
		fieldDisabled: 'oklch(0.9 0.02 95)',
		fieldDisabledInk: 'oklch(0.45 0.03 110)',
		cardHover: 'oklch(0.93 0.015 95)',
		navigationHover: 'oklch(0.9 0.02 95)',
		navigationActive: 'oklch(0.9 0.06 255)',
		navigationActiveInk: 'oklch(0.45 0.16 255)',
		sidebar: 'oklch(0.99 0.005 90)',
		sidebarInk: 'oklch(0.28 0.03 110)',
		sidebarActive: 'oklch(0.9 0.02 95)',
		sidebarActiveInk: 'oklch(0.45 0.16 255)',
		sidebarBorder: 'oklch(0.78 0.03 100)',
		chart1: 'oklch(0.6 0.19 255)',
		chart2: 'oklch(0.72 0.15 70)',
		chart3: 'oklch(0.62 0.22 40)',
		chart4: 'oklch(0.55 0.14 150)',
		chart5: 'oklch(0.6 0.11 72)'
	}),
	typography: themeTypography({
		display: {
			family: interTight.family,
			fallbacks: interTight.fallbacks,
			weight: 800,
			size: 'clamp(1.75rem, 3vw, 2.25rem)',
			lineHeight: '1.33',
			tracking: '-0.025em'
		},
		title: {
			family: interTight.family,
			fallbacks: interTight.fallbacks,
			weight: 700,
			size: '1.5rem',
			lineHeight: '1.33',
			tracking: '-0.025em'
		},
		body: {
			family: interTight.family,
			fallbacks: interTight.fallbacks,
			weight: 400,
			size: '0.9375rem',
			lineHeight: '1.5',
			tracking: '0em'
		},
		label: {
			family: interTight.family,
			fallbacks: interTight.fallbacks,
			weight: 500,
			size: '0.875rem',
			lineHeight: '1.43',
			tracking: '0em'
		},
		metadata: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '0.8125rem',
			lineHeight: '1.38',
			tracking: '0.01em'
		},
		code: {
			family: geistMono.family,
			fallbacks: geistMono.fallbacks,
			weight: 400,
			size: '0.875rem',
			lineHeight: '1.43',
			tracking: '0em'
		}
	}),
	spacing: {
		density: 'compact',
		base: '0.25rem',
		controlHeight: '2.25rem',
		compactControlHeight: '2rem',
		touchTarget: '2.75rem',
		pageGutter: '2rem',
		sectionGap: '3rem',
		componentGap: '0.5rem'
	},
	shape: {
		radius: '0.25rem',
		radiusSm: '0.25rem',
		radiusMd: '0.25rem',
		radiusLg: '0.375rem',
		radiusMedia: '0.375rem',
		radiusPill: '9999px',
		borderWidth: '1px',
		borderStyle: 'solid'
	},
	elevation: {
		card: 'none',
		popover: '0 12px 24px -16px oklch(0.3 0.02 90 / 0.35)',
		dialog: '0 25px 50px -12px oklch(0.2 0.015 90 / 0.35)',
		focalAction: 'none'
	},
	motion: themeMotion({
		press: { duration: '100ms', easing: 'ease', distance: '1px' },
		hover: { duration: '150ms', easing: 'ease', distance: '0px' },
		selection: { duration: '150ms', easing: 'ease', distance: '0px' },
		entry: {
			duration: '200ms',
			easing: 'ease-in-out',
			distance: '0.25rem',
			opacity: 0
		},
		pageTransition: {
			duration: '200ms',
			easing: 'ease-in-out',
			distance: '0.5rem',
			opacity: 0
		},
		reducedMotion: 'instant'
	}),
	shell: {
		contentMaxWidth: '60rem',
		sidebarWidth: '12rem',
		headerHeight: '3.5rem',
		canvasTreatment: 'tactile'
	},
	components: {
		button: 'solid',
		link: 'underlined',
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
		dialog: 'outlined',
		popover: 'outlined',
		toast: 'outlined',
		switch: 'solid',
		checkbox: 'solid',
		radio: 'solid',
		toolbar: 'flat',
		pagination: 'quiet',
		emptyState: 'plain',
		loadingState: 'skeleton',
		editorChrome: 'neutral',
		decoration: 'tactile'
	}
});

export const posthogTheme: ThemeManifest = theme(
	'posthog',
	'PostHog',
	'Warm paper desktop: sandy desk, pinned white windows, one amber CTA.',
	'tabler',
	{
		light: posthogLight
	}
);
