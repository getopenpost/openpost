import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import {
	colors,
	familyTypography,
	scheme,
	themeMotion,
	themeTypography,
	themeV2
} from './shared.js';

const geistMono = bundledThemeFont('geist-mono');

// Geist Sans and Geist Mono are bundled directly. Headlines whisper at
// weight 450 with architectural tracking; mono owns every label stamp.
const geist = familyTypography('geist', {
	displayWeight: 500,
	titleWeight: 500
});

export const vercelLight = scheme({
	colors: colors({
		canvas: 'oklch(0.985 0 90)',
		ink: 'oklch(0.205 0 90)',
		surface: 'oklch(1 0 0)',
		surfaceRaised: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.952 0 90)',
		mutedInk: 'oklch(0.42 0 90)',
		border: 'oklch(0.94 0 90)',
		focus: 'oklch(0 0 0)',
		caret: 'oklch(0.205 0 90)',
		link: 'oklch(0.205 0 90)',
		selection: 'oklch(0.94 0 90)',
		selectionInk: 'oklch(0.205 0 90)',
		brand: 'oklch(0.205 0 90)',
		brandInk: 'oklch(1 0 0)',
		actionFocal: 'oklch(0.205 0 90)',
		actionFocalInk: 'oklch(1 0 0)',
		actionFocalHover: 'oklch(0.321 0 90)',
		actionFocalActive: 'oklch(0.159 0 90)',
		actionPrimary: 'oklch(1 0 0)',
		actionPrimaryInk: 'oklch(0.205 0 90)',
		actionPrimaryHover: 'oklch(0.961 0 90)',
		actionPrimaryActive: 'oklch(0.931 0 90)',
		actionOrdinary: 'oklch(1 0 0)',
		actionOrdinaryInk: 'oklch(0.42 0 90)',
		actionOrdinaryHover: 'oklch(0.961 0 90)',
		actionOrdinaryActive: 'oklch(0.931 0 90)',
		field: 'oklch(1 0 0)',
		danger: 'oklch(0.90 0.06 17)',
		dangerInk: 'oklch(0.501 0.178 29)',
		actionDestructive: 'oklch(0.92 0.05 20)',
		actionDestructiveHover: 'oklch(0.87 0.07 20)',
		actionDestructiveActive: 'oklch(0.81 0.09 20)',
		actionDestructiveInk: 'oklch(0.42 0.18 29)',
		success: 'oklch(0.88 0.07 154)',
		successInk: 'oklch(0.415 0.101 147)',
		warning: 'oklch(0.90 0.08 80)',
		warningInk: 'oklch(0.46 0.11 73)',
		info: 'oklch(0.88 0.06 262)',
		infoInk: 'oklch(0.485 0.183 261)',
		navigationHover: 'oklch(0.961 0 90)',
		navigationActive: 'oklch(0.94 0 90)',
		navigationActiveInk: 'oklch(0.205 0 90)',
		sidebar: 'oklch(0.985 0 90)',
		sidebarInk: 'oklch(0.205 0 90)',
		sidebarActive: 'oklch(0.94 0 90)',
		sidebarActiveInk: 'oklch(0.205 0 90)',
		chart1: 'oklch(0.54 0.14 245)',
		chart2: 'oklch(0.55 0.19 25)',
		chart3: 'oklch(0.60 0.14 80)',
		chart4: 'oklch(0.52 0.13 150)',
		chart5: 'oklch(0.54 0.14 320)'
	}),
	typography: themeTypography({
		...geist,
		display: {
			...geist.display,
			size: '4rem',
			lineHeight: '1',
			tracking: '-0.04em'
		},
		title: {
			...geist.title,
			size: '1.875rem',
			lineHeight: '1.1',
			tracking: '-0.04em'
		},
		body: { ...geist.body, size: '1rem', lineHeight: '1.5', tracking: '0em' },
		label: {
			...geist.label,
			weight: 400,
			size: '0.875rem',
			lineHeight: '1.43',
			tracking: '0em'
		},
		metadata: {
			family: geistMono.family,
			fallbacks: geistMono.fallbacks,
			weight: 400,
			size: '0.6875rem',
			lineHeight: '1.5',
			tracking: '0.071em'
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
		density: 'compact',
		base: '0.25rem',
		controlHeight: '2.25rem',
		compactControlHeight: '2rem',
		pageGutter: 'clamp(1.5rem, 4vw, 3rem)',
		sectionGap: '6rem',
		componentGap: '0.75rem'
	},
	shape: {
		radius: '0.375rem',
		radiusSm: '0.125rem',
		radiusMd: '0.375rem',
		radiusLg: '0.375rem',
		radiusMedia: '0.375rem',
		radiusPill: '9999px',
		borderWidth: '1px',
		borderStyle: 'solid'
	},
	elevation: {
		card: 'none',
		popover: '0 0 0 1px rgb(0 0 0 / 0.08)',
		dialog: '0 0 0 1px rgb(0 0 0 / 0.08)',
		focalAction: '0 0 0 1px rgb(0 0 0 / 0.08)'
	},
	motion: themeMotion({
		press: { duration: '80ms', distance: '0px' },
		hover: { duration: '120ms' },
		selection: { duration: '120ms' },
		entry: { duration: '200ms', distance: '0.25rem' },
		exit: { duration: '120ms', distance: '0.125rem' },
		loading: { duration: '900ms' },
		pageTransition: { duration: '200ms', distance: '0.25rem' },
		reducedMotion: 'instant'
	}),
	shell: {
		contentMaxWidth: '80rem',
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
		list: 'plain',
		badge: 'tonal',
		chip: 'tonal',
		dialog: 'outlined',
		popover: 'outlined',
		toast: 'outlined',
		switch: 'solid',
		checkbox: 'solid',
		radio: 'solid',
		toolbar: 'outlined',
		pagination: 'quiet',
		emptyState: 'plain',
		loadingState: 'spinner',
		editorChrome: 'precision',
		decoration: 'none'
	}
});

export const vercelTheme: ThemeManifest = themeV2(
	'vercel',
	'Vercel',
	'Typeset terminal on white paper: monochrome, hairline rings, tight type.',
	'lucide',
	{
		light: vercelLight
	}
);
