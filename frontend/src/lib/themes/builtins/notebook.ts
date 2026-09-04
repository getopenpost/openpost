import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, theme } from './shared.js';
import { bundledThemeFont } from '../bundled-fonts.js';

const sourceSerif = bundledThemeFont('source-serif-4');

export const notebookLight = scheme({
	colors: colors({
		canvas: 'oklch(0.975 0.018 82)',
		ink: 'oklch(0.24 0.025 65)',
		surface: 'oklch(0.995 0.012 82)',
		surfaceSunken: 'oklch(0.94 0.028 82)',
		mutedInk: 'oklch(0.5 0.04 70)',
		border: 'oklch(0.86 0.035 82)',
		focus: 'oklch(0.24 0.025 65)',
		caret: 'oklch(0.49 0.11 240)',
		link: 'oklch(0.49 0.11 240)',
		selection: 'oklch(0.9 0.045 235)',
		selectionInk: 'oklch(0.26 0.06 240)',
		actionFocal: 'oklch(0.75 0.13 75)',
		actionFocalInk: 'oklch(0.18 0.025 65)',
		actionPrimary: 'oklch(0.28 0.035 65)',
		actionPrimaryInk: 'oklch(0.99 0.01 82)',
		actionPrimaryHover: 'oklch(0.22 0.03 65)',
		actionPrimaryActive: 'oklch(0.16 0.02 65)',
		actionOrdinary: 'oklch(0.93 0.035 82)',
		actionOrdinaryInk: 'oklch(0.28 0.035 65)',
		danger: 'oklch(0.55 0.18 30)',
		dangerInk: 'oklch(0.99 0.01 82)',
		actionDestructiveInk: 'oklch(0.43 0.2 25)',
		success: 'oklch(0.9 0.05 145)',
		successInk: 'oklch(0.38 0.1 145)',
		warning: 'oklch(0.91 0.075 75)',
		warningInk: 'oklch(0.4 0.11 68)',
		info: 'oklch(0.91 0.045 235)',
		infoInk: 'oklch(0.38 0.11 240)',
		sidebar: 'oklch(0.955 0.025 82)',
		sidebarInk: 'oklch(0.24 0.025 65)',
		sidebarActive: 'oklch(0.9 0.045 235)',
		sidebarActiveInk: 'oklch(0.26 0.06 240)',
		chart1: 'oklch(0.58 0.15 70)',
		chart2: 'oklch(0.6 0.13 25)',
		chart3: 'oklch(0.57 0.11 235)',
		chart4: 'oklch(0.62 0.13 155)',
		chart5: 'oklch(0.55 0.11 315)'
	}),
	typography: {
		display: {
			family: sourceSerif.family,
			fallbacks: sourceSerif.fallbacks,
			weight: 600,
			tracking: '-0.018em'
		},
		title: {
			family: sourceSerif.family,
			fallbacks: sourceSerif.fallbacks,
			weight: 600,
			tracking: '-0.018em'
		}
	},
	spacing: { density: 'spacious', sectionGap: '1.75rem' },
	shape: { radius: '0.5rem', radiusMd: '0.5rem', radiusLg: '0.625rem' },
	shell: { canvasTreatment: 'paper' },
	components: {
		card: 'paper',
		container: 'tinted',
		input: 'underlined',
		select: 'underlined',
		decoration: 'editorial'
	}
});

export const notebookTheme: ThemeManifest = theme(
	'notebook',
	'Notebook',
	'Warm paper, editorial headings, and quiet blue selection.',
	'tabler',
	{
		light: notebookLight
	}
);
