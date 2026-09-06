import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, themeV2 } from './shared.js';
import { bundledThemeFont } from '../bundled-fonts.js';

// NotionInter -> Inter (its named substitute, all four text weights present).
// Lyon Text (editorial serif accent) has no pull-quote role in the token
// system, so the literary accent is documented, not placed.
const inter = bundledThemeFont('inter');
const geistMono = bundledThemeFont('geist-mono');

export const notionLight = scheme({
	colors: colors({
		canvas: 'oklch(0.971 0.002 68)',
		ink: 'oklch(0.2 0.004 80)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.93 0.008 80)',
		mutedInk: 'oklch(0.521 0 0)',
		border: 'oklch(0.928 0.002 68)',
		focus: 'oklch(0.18 0.094 266)',
		caret: 'oklch(0.568 0.182 254)',
		link: 'oklch(0.52 0.16 254)',
		fieldDisabledInk: 'oklch(0.47 0 0)',
		disabledInk: 'oklch(0.47 0 0)',
		brand: 'oklch(0.568 0.182 254)',
		brandInk: 'oklch(1 0 0)',
		selection: 'oklch(0.958 0.02 243)',
		selectionInk: 'oklch(0.2 0.004 80)',
		actionFocal: 'oklch(0.568 0.182 254)',
		actionFocalInk: 'oklch(1 0 0)',
		actionFocalHover: 'oklch(0.521 0.164 254)',
		actionFocalActive: 'oklch(0.468 0.145 253)',
		actionPrimary: 'oklch(0.18 0 0)',
		actionPrimaryInk: 'oklch(1 0 0)',
		actionPrimaryHover: 'oklch(0.14 0 0)',
		actionPrimaryActive: 'oklch(0.1 0 0)',
		actionOrdinary: 'oklch(1 0 0)',
		actionOrdinaryInk: 'oklch(0.2 0.004 80)',
		actionOrdinaryHover: 'oklch(0.958 0.02 243)',
		actionOrdinaryActive: 'oklch(0.92 0.03 250)',
		danger: 'oklch(0.56 0.2 30)',
		dangerInk: 'oklch(1 0 0)',
		actionDestructive: 'oklch(0.93 0.04 32)',
		actionDestructiveInk: 'oklch(0.46 0.175 30)',
		actionDestructiveHover: 'oklch(0.9 0.05 32)',
		actionDestructiveActive: 'oklch(0.87 0.06 32)',
		success: 'oklch(0.92 0.05 150)',
		successInk: 'oklch(0.38 0.1 150)',
		warning: 'oklch(0.9 0.08 80)',
		warningInk: 'oklch(0.42 0.1 70)',
		info: 'oklch(0.958 0.02 243)',
		infoInk: 'oklch(0.45 0.14 254)',
		sidebar: 'oklch(0.985 0.003 80)',
		sidebarInk: 'oklch(0.2 0.004 80)',
		sidebarActive: 'oklch(0.958 0.02 243)',
		sidebarActiveInk: 'oklch(0.5 0.16 254)',
		chart1: 'oklch(0.54 0.14 245)',
		chart2: 'oklch(0.55 0.19 25)',
		chart3: 'oklch(0.60 0.14 80)',
		chart4: 'oklch(0.52 0.13 150)',
		chart5: 'oklch(0.54 0.14 320)'
	}),
	typography: {
		display: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 600,
			size: 'clamp(3rem, 7vw, 4.5rem)',
			lineHeight: '1.1',
			tracking: '-0.028em'
		},
		title: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 600,
			size: 'clamp(2rem, 3vw, 3rem)',
			lineHeight: '1.1',
			tracking: '-0.02em'
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
			lineHeight: '1.43',
			tracking: '0em'
		},
		metadata: {
			family: inter.family,
			fallbacks: inter.fallbacks,
			weight: 500,
			size: '0.75rem',
			lineHeight: '1.33',
			tracking: '0.01em'
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
		sectionGap: '5rem',
		componentGap: '0.5rem'
	},
	shape: {
		radius: '0.75rem',
		radiusSm: '0.25rem',
		radiusMd: '0.5rem',
		radiusLg: '0.75rem',
		borderWidth: '1px',
		borderStyle: 'solid'
	},
	elevation: {
		card: 'none',
		popover: '0 3px 9px 0 oklch(0.2 0 0 / 0.035)',
		dialog: '0 4px 12px 0 oklch(0.2 0 0 / 0.1)',
		focalAction: '0 4px 12px -6px oklch(0.45 0.14 254 / 0.5)'
	},
	motion: {
		press: { duration: '100ms', distance: '1px' },
		hover: { duration: '200ms', easing: 'ease' },
		entry: { duration: '200ms', easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
		reducedMotion: 'instant'
	},
	shell: { contentMaxWidth: '90rem', canvasTreatment: 'paper' },
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
		decoration: 'playful'
	}
});

export const notionTheme: ThemeManifest = themeV2(
	'notion',
	'Notion',
	'Warm paper notebook with sticky-note accent cards and one blue action.',
	'lucide',
	{
		light: notionLight
	}
);
