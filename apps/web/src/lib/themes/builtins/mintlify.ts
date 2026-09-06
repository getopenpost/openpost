import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, themeV2 } from './shared.js';

const inter = bundledThemeFont('inter');

export const mintlifyLight = scheme({
	colors: colors({
		canvas: 'oklch(1 0 0)',
		ink: 'oklch(0 0 0)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.955 0.003 250)',
		mutedInk: 'oklch(0.45 0.008 250)',
		border: 'oklch(0.955 0.003 250)',
		focus: 'oklch(0.6 0.13 168)',
		caret: 'oklch(0.45 0.11 168)',
		link: 'oklch(0.45 0.11 168)',
		selection: 'oklch(0.94 0.035 168)',
		selectionInk: 'oklch(0.38 0.1 168)',
		actionFocal: 'oklch(0.14 0.004 250)',
		actionFocalInk: 'oklch(1 0 0)',
		actionFocalHover: 'oklch(0.2 0.005 250)',
		actionFocalActive: 'oklch(0.26 0.007 250)',
		actionPrimary: 'oklch(0.14 0.004 250)',
		actionPrimaryInk: 'oklch(1 0 0)',
		actionPrimaryHover: 'oklch(0.20 0.004 250)',
		actionPrimaryActive: 'oklch(0.26 0.004 250)',
		actionOrdinary: 'oklch(1 0 0)',
		actionOrdinaryInk: 'oklch(0 0 0)',
		actionOrdinaryBorder: 'oklch(0.9 0.005 250)',
		actionQuietHover: 'oklch(0.955 0.003 250)',
		danger: 'oklch(0.55 0.21 25)',
		dangerInk: 'oklch(1 0 0)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.94 0.035 168)',
		successInk: 'oklch(0.38 0.1 168)',
		warning: 'oklch(0.93 0.07 85)',
		warningInk: 'oklch(0.43 0.11 75)',
		info: 'oklch(0.91 0.05 245)',
		infoInk: 'oklch(0.42 0.12 250)',
		sidebar: 'oklch(1 0 0)',
		sidebarInk: 'oklch(0 0 0)',
		sidebarActive: 'oklch(0.94 0.035 168)',
		sidebarActiveInk: 'oklch(0.38 0.1 168)',
		sidebarBorder: 'oklch(0.955 0.003 250)',
		chart1: 'oklch(0.52 0.13 165)',
		chart2: 'oklch(0.54 0.14 245)',
		chart3: 'oklch(0.60 0.14 80)',
		chart4: 'oklch(0.55 0.19 25)',
		chart5: 'oklch(0.54 0.14 320)'
	}),
	typography: {
		display: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 600,
			size: '3.5625rem',
			lineHeight: '1.1',
			tracking: '-0.02em'
		},
		title: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 600,
			size: '1.5rem',
			lineHeight: '1.33',
			tracking: '-0.24px'
		},
		body: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '1rem',
			lineHeight: '1.5',
			tracking: '-0.16px'
		},
		label: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '0.875rem',
			lineHeight: '1.4',
			tracking: '0em'
		},
		metadata: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '0.8125rem',
			lineHeight: '1.5',
			tracking: '0.05em'
		},
		code: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '0.875rem',
			lineHeight: '1.5',
			tracking: '0em'
		}
	},
	spacing: {
		density: 'comfortable',
		controlHeight: '2.25rem',
		compactControlHeight: '2rem',
		pageGutter: '1.5rem',
		sectionGap: '5rem',
		componentGap: '0.75rem'
	},
	shape: {
		radius: '1rem',
		radiusSm: '0.25rem',
		radiusMd: '0.5rem',
		radiusLg: '1.5rem',
		radiusMedia: '1rem'
	},
	elevation: {
		card: '0 2px 4px 0 oklch(0 0 0 / 0.05)',
		popover: '0 4px 12px 0 oklch(0 0 0 / 0.06)',
		dialog: '0 8px 24px 0 oklch(0 0 0 / 0.08)',
		focalAction: '0 2px 4px 0 oklch(0 0 0 / 0.08)'
	},
	motion: {
		press: { duration: '100ms', distance: '1px', opacity: 1 },
		hover: { duration: '160ms', distance: '0px', opacity: 1 },
		selection: { duration: '160ms', distance: '0px', opacity: 1 },
		entry: { duration: '240ms', distance: '0.75rem', opacity: 0 },
		exit: { duration: '160ms', distance: '0.25rem', opacity: 0 },
		pageTransition: { duration: '240ms', distance: '0.75rem', opacity: 0 },
		reducedMotion: 'instant'
	},
	shell: {
		contentMaxWidth: '75rem',
		sidebarWidth: '17rem',
		headerHeight: '3.75rem',
		canvasTreatment: 'garden'
	},
	components: {
		button: 'solid',
		link: 'plain',
		tabs: 'underline',
		navigation: 'tonal',
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
});

export const mintlifyTheme: ThemeManifest = themeV2(
	'mintlify',
	'Mintlify',
	'Monastic white docs with one mint spark and square geometry.',
	'lucide',
	{
		light: mintlifyLight
	}
);
