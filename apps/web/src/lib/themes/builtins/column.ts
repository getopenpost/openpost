import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, themeTypography, themeV2 } from './shared.js';

const inter = bundledThemeFont('inter');
const geistMono = bundledThemeFont('geist-mono');

export const columnLight = scheme({
	colors: colors({
		canvas: 'oklch(0.965 0.004 270)',
		ink: 'oklch(0.30 0.085 275)',
		surface: 'oklch(1 0 0)',
		surfaceRaised: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.94 0.006 270)',
		mutedInk: 'oklch(0.45 0.015 270)',
		border: 'oklch(0.90 0.006 270)',
		focus: 'oklch(0.30 0.085 275)',
		caret: 'oklch(0.42 0.09 175)',
		link: 'oklch(0.42 0.06 275)',
		selection: 'oklch(0.90 0.05 215)',
		selectionInk: 'oklch(0.28 0.08 275)',
		brand: 'oklch(0.65 0.17 55)',
		brandInk: 'oklch(0.12 0.01 60)',
		actionFocal: 'oklch(0.60 0.16 55)',
		actionFocalInk: 'oklch(0.12 0.01 60)',
		actionFocalHover: 'oklch(0.63 0.16 55)',
		actionFocalActive: 'oklch(0.66 0.16 55)',
		actionPrimary: 'oklch(0.30 0.085 275)',
		actionPrimaryInk: 'oklch(0.99 0 0)',
		actionPrimaryHover: 'oklch(0.25 0.08 275)',
		actionPrimaryActive: 'oklch(0.20 0.07 275)',
		actionOrdinary: 'oklch(1 0 0)',
		actionOrdinaryInk: 'oklch(0.30 0.085 275)',
		actionOrdinaryBorder: 'oklch(0.30 0.085 275)',
		actionOrdinaryHover: 'oklch(0.96 0.01 275)',
		actionOrdinaryActive: 'oklch(0.93 0.015 275)',
		danger: 'oklch(0.57 0.20 25)',
		dangerInk: 'oklch(0.99 0 0)',
		actionDestructiveInk: 'oklch(0.44 0.19 25)',
		success: 'oklch(0.87 0.07 170)',
		successInk: 'oklch(0.42 0.09 175)',
		warning: 'oklch(0.89 0.09 60)',
		warningInk: 'oklch(0.45 0.12 50)',
		info: 'oklch(0.87 0.06 215)',
		infoInk: 'oklch(0.42 0.09 230)',
		field: 'oklch(1 0 0)',
		fieldInk: 'oklch(0.30 0.085 275)',
		fieldBorder: 'oklch(0.90 0.006 270)',
		fieldHover: 'oklch(0.98 0.003 270)',
		fieldFocus: 'oklch(1 0 0)',
		sidebar: 'oklch(1 0 0)',
		sidebarInk: 'oklch(0.38 0.015 270)',
		sidebarActive: 'oklch(0.92 0.03 275)',
		sidebarActiveInk: 'oklch(0.30 0.085 275)',
		sidebarBorder: 'oklch(0.90 0.006 270)',
		chart1: 'oklch(0.52 0.13 150)',
		chart2: 'oklch(0.60 0.14 80)',
		chart3: 'oklch(0.54 0.14 320)',
		chart4: 'oklch(0.54 0.14 245)',
		chart5: 'oklch(0.55 0.19 25)'
	}),
	typography: themeTypography({
		display: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 600,
			size: '3.75rem',
			lineHeight: '1',
			tracking: '-0.01em'
		},
		title: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '1.75rem',
			lineHeight: '1.1',
			tracking: '-0.01em'
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
			size: '0.875rem',
			lineHeight: '1.5',
			tracking: '0em'
		},
		metadata: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 400,
			size: '0.75rem',
			lineHeight: '1.5',
			tracking: '0em'
		},
		code: {
			family: geistMono.family,
			fallbacks: geistMono.fallbacks,
			weight: 400,
			size: '0.75rem',
			lineHeight: '1.5',
			tracking: '0em'
		}
	}),
	spacing: {
		density: 'comfortable',
		controlHeight: '2.75rem',
		compactControlHeight: '2.25rem',
		touchTarget: '2.75rem',
		sectionGap: '4.5rem',
		componentGap: '0.5rem'
	},
	shape: {
		radius: '0.5rem',
		radiusSm: '0.375rem',
		radiusMd: '0.5rem',
		radiusLg: '0.5rem',
		radiusMedia: '0.5rem'
	},
	elevation: {
		card: '0 1px 4px 0 oklch(0.07 0.02 270 / 0.06)',
		popover: '0 12px 10px -4px oklch(0.07 0.02 270 / 0.04)',
		dialog: '0 40px 32px -8px oklch(0.07 0.02 270 / 0.04)',
		focalAction: '0 1px 3px -1px oklch(0.35 0.12 55 / 0.45)'
	},
	motion: {
		press: { duration: '100ms', easing: 'cubic-bezier(0.2, 0, 0, 1)', distance: '1px' },
		hover: { duration: '160ms', easing: 'cubic-bezier(0.2, 0, 0, 1)' },
		selection: { duration: '160ms', easing: 'cubic-bezier(0.2, 0, 0, 1)' },
		entry: {
			duration: '240ms',
			easing: 'cubic-bezier(0.2, 0, 0, 1)',
			distance: '0.5rem'
		},
		exit: { duration: '160ms', easing: 'cubic-bezier(0.4, 0, 1, 1)' },
		pageTransition: {
			duration: '240ms',
			easing: 'cubic-bezier(0.2, 0, 0, 1)',
			distance: '0.5rem'
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
		card: 'outlined',
		container: 'flat',
		table: 'ruled',
		list: 'divided',
		badge: 'tonal',
		chip: 'outlined',
		dialog: 'elevated',
		popover: 'elevated',
		toast: 'elevated',
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

export const columnTheme: ThemeManifest = themeV2(
	'column',
	'Column',
	'Deep-navy ledger on cool dawn — indigo structure, seafoam data, one orange signal.',
	'heroicons-outline',
	{
		light: columnLight
	}
);
