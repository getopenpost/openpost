import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, familyTypography, scheme, theme } from './shared.js';

const inter = bundledThemeFont('inter');
const interTight = bundledThemeFont('inter-tight');

export const appleLight = scheme({
	colors: colors({
		canvas: 'oklch(0.965 0.004 250)',
		ink: 'oklch(0.17 0.004 250)',
		surface: 'oklch(0.99 0.003 250)',
		surfaceSunken: 'oklch(0.93 0.006 250)',
		mutedInk: 'oklch(0.44 0.004 250)',
		border: 'oklch(0.85 0.008 270)',
		focus: 'oklch(0.45 0.15 250)',
		caret: 'oklch(0.52 0.15 250)',
		link: 'oklch(0.48 0.14 250)',
		selection: 'oklch(0.92 0.03 250)',
		selectionInk: 'oklch(0.20 0.01 250)',
		actionFocal: 'oklch(0.52 0.15 250)',
		actionFocalInk: 'oklch(0.97 0.006 240)',
		actionFocalHover: 'oklch(0.47 0.15 250)',
		actionFocalActive: 'oklch(0.42 0.14 250)',
		actionPrimary: 'oklch(0.20 0.005 250)',
		actionPrimaryInk: 'oklch(0.99 0 0)',
		actionPrimaryHover: 'oklch(0.15 0.005 250)',
		actionPrimaryActive: 'oklch(0.10 0 0)',
		actionOrdinary: 'oklch(0.90 0.004 250)',
		actionOrdinaryInk: 'oklch(0.20 0.005 250)',
		actionOrdinaryHover: 'oklch(0.86 0.005 250)',
		actionOrdinaryActive: 'oklch(0.82 0.006 250)',
		danger: 'oklch(0.52 0.19 25)',
		dangerInk: 'oklch(0.99 0 0)',
		actionDestructiveInk: 'oklch(0.42 0.16 25)',
		success: 'oklch(0.90 0.05 155)',
		successInk: 'oklch(0.38 0.11 155)',
		warning: 'oklch(0.93 0.07 85)',
		warningInk: 'oklch(0.42 0.11 75)',
		info: 'oklch(0.92 0.05 245)',
		infoInk: 'oklch(0.39 0.13 250)',
		navigationHover: 'oklch(0.93 0.006 250)',
		navigationActive: 'oklch(0.90 0.04 250)',
		navigationActiveInk: 'oklch(0.30 0.12 250)',
		sidebar: 'oklch(0.98 0.003 250)',
		sidebarInk: 'oklch(0.17 0.004 250)',
		sidebarActive: 'oklch(0.90 0.04 250)',
		sidebarActiveInk: 'oklch(0.30 0.12 250)',
		chart1: 'oklch(0.52 0.15 250)',
		chart2: 'oklch(0.45 0.005 250)',
		chart3: 'oklch(0.65 0.14 250)',
		chart4: 'oklch(0.60 0.004 250)',
		chart5: 'oklch(0.30 0.01 250)'
	}),
	typography: {
		...familyTypography('inter'),
		display: {
			family: interTight.family,
			fallbacks: interTight.fallbacks,
			weight: 600,
			size: 'clamp(2.5rem, 5vw, 3.5rem)',
			lineHeight: '1.07',
			tracking: '0.011em'
		},
		title: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 600,
			size: '1.75rem',
			lineHeight: '1.18',
			tracking: '0.007em'
		},
		body: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '1.0625rem',
			lineHeight: '1.47',
			tracking: '-0.016em'
		},
		label: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 600,
			size: '0.75rem',
			lineHeight: '1.33',
			tracking: '-0.022em'
		},
		metadata: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '0.75rem',
			lineHeight: '1.33',
			tracking: '-0.022em'
		}
	},
	spacing: {
		density: 'comfortable',
		controlHeight: '2.75rem',
		compactControlHeight: '2.25rem',
		touchTarget: '2.75rem',
		pageGutter: 'clamp(1rem, 4vw, 3rem)',
		sectionGap: '4rem',
		componentGap: '0.75rem'
	},
	shape: {
		radius: '0.5rem',
		radiusSm: '0.5rem',
		radiusMd: '0.5rem',
		radiusLg: '0.5rem',
		radiusMedia: '0.5rem',
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
		press: { duration: '120ms', distance: '1px' },
		hover: { duration: '160ms', distance: '0px' },
		pageTransition: {
			duration: '300ms',
			easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
			distance: '0.5rem',
			opacity: 0
		},
		reducedMotion: 'crossfade'
	},
	shell: {
		contentMaxWidth: '90rem',
		sidebarWidth: '16rem',
		headerHeight: '3rem',
		canvasTreatment: 'plain'
	},
	components: {
		button: 'pill',
		link: 'subtle',
		tabs: 'segmented',
		navigation: 'quiet',
		input: 'outlined',
		select: 'outlined',
		card: 'flat',
		container: 'flat',
		table: 'ruled',
		list: 'divided',
		badge: 'tonal',
		chip: 'tonal',
		dialog: 'flat',
		popover: 'flat',
		toast: 'flat',
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

export const appleTheme: ThemeManifest = theme(
	'apple',
	'Apple',
	'White-room restraint with a single deliberate blue action and fully rounded pills.',
	'heroicons-outline',
	{
		light: appleLight
	}
);
