import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, themeTypography, themeV2, familyTypography } from './shared.js';

// Quizlet: cool chalk canvas, white study cards over lilac washes, one iris
// violet accent, geometric single-family type that never shouts, and one
// soft shadow token used sparingly. Primary actions are signature 200px
// pills; everything else stays square-ish and quiet.
export const quizletLight = scheme({
	colors: colors({
		canvas: 'oklch(0.97 0.008 270)',
		ink: 'oklch(0.28 0.03 275)',
		surface: 'oklch(1 0 0)',
		surfaceSunken: 'oklch(0.94 0.03 280)',
		mutedInk: 'oklch(0.48 0.05 270)',
		border: 'oklch(0.89 0.02 272)',
		focus: 'oklch(0.35 0.15 279)',
		caret: 'oklch(0.53 0.23 279)',
		link: 'oklch(0.53 0.23 279)',
		selection: 'oklch(0.94 0.03 280)',
		selectionInk: 'oklch(0.32 0.05 272)',
		actionFocal: 'oklch(0.53 0.23 279)',
		actionFocalInk: 'oklch(1 0 0)',
		actionFocalHover: 'oklch(0.47 0.23 279)',
		actionFocalActive: 'oklch(0.42 0.22 279)',
		actionPrimary: 'oklch(0.28 0.03 275)',
		actionPrimaryInk: 'oklch(1 0 0)',
		actionPrimaryHover: 'oklch(0.22 0.03 275)',
		actionPrimaryActive: 'oklch(0.16 0.02 275)',
		actionOrdinary: 'oklch(1 0 0)',
		actionOrdinaryInk: 'oklch(0.53 0.23 279)',
		actionOrdinaryBorder: 'oklch(0.53 0.23 279)',
		actionOrdinaryHover: 'oklch(0.94 0.03 280)',
		actionOrdinaryActive: 'oklch(0.92 0.04 280)',
		field: 'oklch(1 0 0)',
		fieldBorder: 'oklch(0.89 0.02 272)',
		danger: 'oklch(0.57 0.2 25)',
		dangerInk: 'oklch(0.99 0 0)',
		actionDestructiveInk: 'oklch(0.45 0.19 25)',
		success: 'oklch(0.93 0.05 155)',
		successInk: 'oklch(0.38 0.11 160)',
		warning: 'oklch(0.94 0.06 85)',
		warningInk: 'oklch(0.44 0.11 75)',
		info: 'oklch(0.93 0.04 270)',
		infoInk: 'oklch(0.42 0.12 275)',
		navigationHover: 'oklch(0.94 0.03 280)',
		navigationActive: 'oklch(0.94 0.03 280)',
		navigationActiveInk: 'oklch(0.45 0.2 279)',
		sidebar: 'oklch(1 0 0)',
		sidebarInk: 'oklch(0.28 0.03 275)',
		sidebarActive: 'oklch(0.94 0.03 280)',
		sidebarActiveInk: 'oklch(0.45 0.2 279)',
		chart1: 'oklch(0.54 0.16 279)',
		chart2: 'oklch(0.52 0.14 210)',
		chart3: 'oklch(0.52 0.13 145)',
		chart4: 'oklch(0.60 0.14 75)',
		chart5: 'oklch(0.55 0.19 25)'
	}),
	typography: themeTypography({
		...familyTypography('inter', { displayWeight: 700, titleWeight: 600 }),
		display: {
			weight: 700,
			size: '2.75rem',
			lineHeight: '1.25',
			tracking: '0em'
		},
		title: {
			weight: 600,
			size: '2rem',
			lineHeight: '1.28',
			tracking: '0em'
		},
		body: {
			weight: 400,
			size: '1rem',
			lineHeight: '1.5',
			tracking: '0em'
		},
		label: {
			weight: 600,
			size: '0.875rem',
			lineHeight: '1.43',
			tracking: '0em'
		},
		metadata: {
			weight: 400,
			size: '0.75rem',
			lineHeight: '1.5',
			tracking: '0em'
		}
	}),
	spacing: {
		density: 'compact',
		base: '0.25rem',
		controlHeight: '2.5rem',
		compactControlHeight: '2rem',
		touchTarget: '2.75rem',
		pageGutter: 'clamp(1rem, 3vw, 2rem)',
		sectionGap: '5rem',
		componentGap: '0.5rem'
	},
	shape: {
		radius: '0.5rem',
		radiusSm: '0.25rem',
		radiusMd: '0.5rem',
		radiusLg: '0.5rem',
		radiusMedia: '1.5rem',
		radiusPill: '9999px',
		borderWidth: '1px',
		borderStyle: 'solid'
	},
	elevation: {
		card: '0 4px 16px 0 rgb(40 46 62 / 0.1)',
		popover: '0 4px 16px 0 rgb(40 46 62 / 0.1)',
		dialog: '0 4px 16px 0 rgb(40 46 62 / 0.1)',
		focalAction: '0 2px 4px 0 rgb(40 46 62 / 0.1)'
	},
	motion: {
		press: { duration: '100ms', distance: '1px' },
		hover: { duration: '160ms' },
		entry: { duration: '240ms', distance: '0.5rem' }
	},
	shell: { contentMaxWidth: '75rem', canvasTreatment: 'plain' },
	components: {
		button: 'pill',
		link: 'plain',
		tabs: 'pill',
		navigation: 'quiet',
		input: 'filled',
		select: 'filled',
		card: 'outlined',
		container: 'tinted',
		table: 'plain',
		list: 'spaced',
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

export const quizletTheme: ThemeManifest = themeV2(
	'quizlet',
	'Quizlet',
	'Chalk canvas, white study cards, and one iris violet highlighter mark.',
	'heroicons-outline',
	{
		light: quizletLight
	}
);
