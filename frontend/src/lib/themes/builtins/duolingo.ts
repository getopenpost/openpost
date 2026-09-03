import type { ThemeManifest } from '../contracts.js';
import { bundledThemeFont } from '../bundled-fonts.js';
import { colors, scheme, theme, themeTypography } from './shared.js';

const displayFont = bundledThemeFont('manrope');
const bodyFont = bundledThemeFont('dm-sans');

// Duolingo: white storybook canvas, chunky rounded display voice in Eager
// Green, calm mid-gray body copy, Spark Blue links, sticker-thick 2px
// borders, zero shadows. Primary buttons carry real press depth through a
// hard offset focal shadow that compresses on press.
export const duolingoLight = scheme({
	colors: colors({
		canvas: 'oklch(1 0 0)',
		ink: 'oklch(0.42 0.01 250)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.97 0.012 110)',
		mutedInk: 'oklch(0.52 0.012 250)',
		border: 'oklch(0.74 0.012 250)',
		focus: 'oklch(0.50 0.13 245)',
		caret: 'oklch(0.72 0.205 133)',
		link: 'oklch(0.50 0.13 245)',
		selection: 'oklch(0.94 0.09 133)',
		selectionInk: 'oklch(0.42 0.14 133)',
		actionFocal: 'oklch(0.72 0.205 133)',
		actionFocalInk: 'oklch(0.25 0.05 275)',
		actionFocalHover: 'oklch(0.67 0.2 133)',
		actionFocalActive: 'oklch(0.63 0.195 133)',
		actionPrimary: 'oklch(0.18 0.05 280)',
		actionPrimaryInk: 'oklch(1 0 0)',
		actionPrimaryHover: 'oklch(0.24 0.055 280)',
		actionPrimaryActive: 'oklch(0.3 0.06 280)',
		actionOrdinary: 'oklch(1 0 0)',
		actionOrdinaryInk: 'oklch(0.50 0.13 245)',
		actionOrdinaryBorder: 'oklch(0.74 0.012 250)',
		actionOrdinaryHover: 'oklch(0.94 0.09 133)',
		actionOrdinaryActive: 'oklch(0.9 0.11 133)',
		danger: 'oklch(0.57 0.21 25)',
		dangerInk: 'oklch(1 0 0)',
		actionDestructiveInk: 'oklch(0.47 0.2 25)',
		success: 'oklch(0.94 0.09 133)',
		successInk: 'oklch(0.42 0.14 133)',
		warning: 'oklch(0.93 0.09 90)',
		warningInk: 'oklch(0.45 0.12 75)',
		info: 'oklch(0.92 0.06 238)',
		infoInk: 'oklch(0.5 0.14 240)',
		navigationHover: 'oklch(0.97 0.012 110)',
		navigationActive: 'oklch(0.94 0.09 133)',
		navigationActiveInk: 'oklch(0.42 0.14 133)',
		sidebar: 'oklch(1 0 0)',
		sidebarInk: 'oklch(0.42 0.01 250)',
		sidebarActive: 'oklch(0.94 0.09 133)',
		sidebarActiveInk: 'oklch(0.42 0.14 133)',
		chart1: 'oklch(0.72 0.205 133)',
		chart2: 'oklch(0.69 0.135 238)',
		chart3: 'oklch(0.88 0.15 133)',
		chart4: 'oklch(0.18 0.05 280)',
		chart5: 'oklch(0.55 0.012 250)'
	}),
	typography: themeTypography({
		display: {
			family: displayFont.family,
			fallbacks: displayFont.fallbacks,
			weight: 800,
			size: '4rem',
			lineHeight: '1.2',
			tracking: '-0.02em'
		},
		title: {
			family: displayFont.family,
			fallbacks: displayFont.fallbacks,
			weight: 700,
			size: '2rem',
			lineHeight: '1.2',
			tracking: '-0.01em'
		},
		body: {
			family: bodyFont.family,
			fallbacks: bodyFont.fallbacks,
			weight: 500,
			size: '1.0625rem',
			lineHeight: '1.35',
			tracking: '0em'
		},
		label: {
			family: bodyFont.family,
			fallbacks: bodyFont.fallbacks,
			weight: 700,
			size: '0.9375rem',
			lineHeight: '1.33',
			tracking: '0.053em'
		},
		metadata: {
			family: bodyFont.family,
			fallbacks: bodyFont.fallbacks,
			weight: 500,
			size: '0.8125rem',
			lineHeight: '1.23',
			tracking: '0em'
		}
	}),
	spacing: {
		density: 'comfortable',
		controlHeight: '2.75rem',
		compactControlHeight: '2.25rem',
		touchTarget: '3rem',
		pageGutter: 'clamp(1rem, 4vw, 2rem)',
		sectionGap: '5rem',
		componentGap: '0.75rem'
	},
	shape: {
		radius: '0.75rem',
		radiusSm: '0.75rem',
		radiusMd: '0.75rem',
		radiusLg: '0.75rem',
		radiusMedia: '1rem',
		borderWidth: '2px',
		borderStyle: 'solid'
	},
	elevation: {
		card: 'none',
		popover: 'none',
		dialog: 'none',
		focalAction: '0 4px 0 0 oklch(0.55 0.19 133)'
	},
	motion: {
		press: { duration: '100ms', easing: 'cubic-bezier(0.34, 1.3, 0.64, 1)', distance: '4px' },
		hover: { duration: '150ms', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
		entry: { duration: '300ms', easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', distance: '0.75rem' },
		exit: { duration: '150ms', easing: 'cubic-bezier(0.4, 0, 1, 1)' }
	},
	shell: { contentMaxWidth: '75rem', canvasTreatment: 'playful' },
	components: {
		button: 'solid',
		link: 'plain',
		tabs: 'pill',
		navigation: 'outlined',
		input: 'outlined',
		select: 'outlined',
		card: 'flat',
		container: 'flat',
		table: 'plain',
		list: 'spaced',
		badge: 'solid',
		chip: 'tonal',
		dialog: 'flat',
		popover: 'flat',
		toast: 'flat',
		switch: 'solid',
		checkbox: 'solid',
		radio: 'solid',
		toolbar: 'flat',
		pagination: 'pill',
		emptyState: 'illustrated',
		loadingState: 'pulse',
		editorChrome: 'neutral',
		decoration: 'playful'
	}
});

export const duolingoTheme: ThemeManifest = theme(
	'duolingo',
	'Duolingo',
	'Storybook white, sticker-thick borders, and one eager green that means go.',
	'phosphor',
	{
		light: duolingoLight
	}
);
