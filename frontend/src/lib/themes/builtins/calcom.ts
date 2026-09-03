import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, theme } from './shared.js';

const dmSans = bundledThemeFont('dm-sans');
const inter = bundledThemeFont('inter');

export const calcomLight = scheme({
	colors: colors({
		canvas: 'oklch(0.96 0.003 250)',
		ink: 'oklch(0.26 0.007 250)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.94 0.005 250)',
		mutedInk: 'oklch(0.51 0.032 264)',
		border: 'oklch(0.92 0.009 255)',
		focus: 'oklch(0.26 0.007 250)',
		caret: 'oklch(0.65 0.17 250)',
		link: 'oklch(0.52 0.13 250)',
		selection: 'oklch(0.955 0.014 250)',
		selectionInk: 'oklch(0.26 0.007 250)',
		actionFocal: 'oklch(0.17 0.004 250)',
		actionFocalInk: 'oklch(1 0 0)',
		actionFocalHover: 'oklch(0.23 0.006 250)',
		actionFocalActive: 'oklch(0.29 0.007 250)',
		actionPrimary: 'oklch(0.17 0.004 250)',
		actionPrimaryInk: 'oklch(1 0 0)',
		actionPrimaryHover: 'oklch(0.23 0.004 250)',
		actionPrimaryActive: 'oklch(0.29 0.004 250)',
		actionOrdinary: 'oklch(0.96 0.003 250)',
		actionOrdinaryInk: 'oklch(0.26 0.007 250)',
		actionOrdinaryBorder: 'oklch(0.92 0.009 255)',
		danger: 'oklch(0.55 0.21 25)',
		dangerInk: 'oklch(1 0 0)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.9 0.06 155)',
		successInk: 'oklch(0.38 0.11 158)',
		warning: 'oklch(0.93 0.07 85)',
		warningInk: 'oklch(0.43 0.11 75)',
		info: 'oklch(0.955 0.014 250)',
		infoInk: 'oklch(0.5 0.12 250)',
		sidebar: 'oklch(1 0 0)',
		sidebarInk: 'oklch(0.26 0.007 250)',
		sidebarActive: 'oklch(0.92 0.009 255)',
		sidebarActiveInk: 'oklch(0.26 0.007 250)',
		sidebarBorder: 'oklch(0.92 0.009 255)',
		chart1: 'oklch(0.55 0.13 250)',
		chart2: 'oklch(0.26 0.007 250)',
		chart3: 'oklch(0.54 0.032 264)',
		chart4: 'oklch(0.63 0.004 250)',
		chart5: 'oklch(0.75 0.006 252)'
	}),
	typography: {
		display: {
			family: dmSans.family,
			fallbacks: dmSans.fallbacks,
			weight: 600,
			size: '4rem',
			lineHeight: '1.1',
			tracking: '0.01em'
		},
		title: {
			family: dmSans.family,
			fallbacks: dmSans.fallbacks,
			weight: 600,
			size: '1.5rem',
			lineHeight: '1.3',
			tracking: '0.01em'
		},
		body: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 300,
			size: '1rem',
			lineHeight: '1.5',
			tracking: '-0.19px'
		},
		label: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '0.875rem',
			lineHeight: '1.43',
			tracking: '-0.01em'
		},
		metadata: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '0.75rem',
			lineHeight: '1.4',
			tracking: '-0.24px'
		},
		code: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '0.8125rem',
			lineHeight: '1.45',
			tracking: '0em'
		}
	},
	spacing: {
		density: 'compact',
		controlHeight: '2.5rem',
		compactControlHeight: '2rem',
		pageGutter: '1.5rem',
		sectionGap: '6rem',
		componentGap: '0.75rem'
	},
	shape: {
		radius: '0.75rem',
		radiusSm: '0.5rem',
		radiusMd: '0.5rem',
		radiusLg: '0.75rem',
		radiusMedia: '1rem'
	},
	elevation: {
		card: '0 4px 8px 0 oklch(0.26 0.007 250 / 0.06)',
		popover: '0 8px 24px 0 oklch(0.26 0.007 250 / 0.1)',
		dialog: '0 16px 40px 0 oklch(0.26 0.007 250 / 0.12)',
		focalAction: '0 2px 6px 0 oklch(0.17 0.004 250 / 0.25)'
	},
	motion: {
		press: { duration: '80ms', distance: '1px', opacity: 1 },
		hover: { duration: '120ms', distance: '0px', opacity: 1 },
		selection: { duration: '120ms', distance: '0px', opacity: 1 },
		entry: { duration: '200ms', distance: '0.5rem', opacity: 0 },
		exit: { duration: '120ms', distance: '0.25rem', opacity: 0 },
		pageTransition: { duration: '200ms', distance: '0.5rem', opacity: 0 },
		reducedMotion: 'instant'
	},
	shell: {
		contentMaxWidth: '75rem',
		sidebarWidth: '16rem',
		headerHeight: '4rem',
		canvasTreatment: 'plain'
	},
	components: {
		button: 'solid',
		link: 'plain',
		tabs: 'segmented',
		navigation: 'tonal',
		input: 'outlined',
		select: 'outlined',
		card: 'flat',
		container: 'flat',
		table: 'plain',
		list: 'plain',
		badge: 'tonal',
		chip: 'tonal',
		dialog: 'elevated',
		popover: 'elevated',
		toast: 'outlined',
		switch: 'solid',
		checkbox: 'solid',
		radio: 'solid',
		toolbar: 'flat',
		pagination: 'pill',
		emptyState: 'plain',
		loadingState: 'skeleton',
		editorChrome: 'neutral',
		decoration: 'none'
	}
});

export const calcomTheme: ThemeManifest = theme(
	'calcom',
	'Cal.com',
	'Strict monochrome utility with pill actions and one functional blue.',
	'heroicons-outline',
	{
		light: calcomLight
	}
);
