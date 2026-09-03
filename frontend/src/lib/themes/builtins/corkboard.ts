import type { ThemeManifest } from '../contracts.js';
import { colors, scheme, theme, familyTypography } from './shared.js';

export const corkboardLight = scheme({
	colors: colors({
		canvas: 'oklch(0.91 0.055 76)',
		ink: 'oklch(0.25 0.035 105)',
		surface: 'oklch(0.975 0.025 82)',
		surfaceRaised: 'oklch(0.99 0.018 82)',
		surfaceSunken: 'oklch(0.87 0.065 70)',
		mutedInk: 'oklch(0.47 0.045 100)',
		border: 'oklch(0.76 0.065 70)',
		focus: 'oklch(0.25 0.035 105)',
		caret: 'oklch(0.48 0.12 240)',
		link: 'oklch(0.48 0.12 240)',
		selection: 'oklch(0.88 0.065 235)',
		selectionInk: 'oklch(0.25 0.07 240)',
		actionFocal: 'oklch(0.75 0.13 75)',
		actionFocalInk: 'oklch(0.18 0.03 105)',
		actionPrimary: 'oklch(0.3 0.05 105)',
		actionPrimaryInk: 'oklch(0.98 0.02 82)',
		actionPrimaryHover: 'oklch(0.24 0.04 105)',
		actionPrimaryActive: 'oklch(0.18 0.03 105)',
		actionOrdinary: 'oklch(0.93 0.04 82)',
		actionOrdinaryInk: 'oklch(0.28 0.04 105)',
		danger: 'oklch(0.54 0.18 28)',
		dangerInk: 'oklch(0.98 0.02 82)',
		actionDestructiveInk: 'oklch(0.38 0.18 28)',
		success: 'oklch(0.84 0.075 135)',
		successInk: 'oklch(0.34 0.1 135)',
		warning: 'oklch(0.87 0.1 75)',
		warningInk: 'oklch(0.38 0.11 68)',
		info: 'oklch(0.87 0.07 235)',
		infoInk: 'oklch(0.36 0.11 240)',
		sidebar: 'oklch(0.88 0.07 72)',
		sidebarInk: 'oklch(0.25 0.035 105)',
		sidebarActive: 'oklch(0.86 0.08 235)',
		sidebarActiveInk: 'oklch(0.25 0.07 240)',
		chart1: 'oklch(0.6 0.15 70)',
		chart2: 'oklch(0.48 0.12 240)',
		chart3: 'oklch(0.5 0.11 135)',
		chart4: 'oklch(0.56 0.13 28)',
		chart5: 'oklch(0.48 0.1 310)'
	}),
	typography: familyTypography('dm-sans'),
	spacing: { density: 'compact', componentGap: '0.625rem' },
	shape: {
		radius: '0.375rem',
		radiusSm: '0.25rem',
		radiusMd: '0.375rem',
		radiusLg: '0.5rem',
		radiusMedia: '0.5rem'
	},
	elevation: {
		card: '0 8px 18px -15px oklch(0.25 0.05 70 / 0.52)',
		popover: '0 14px 34px -20px oklch(0.25 0.05 70 / 0.58)'
	},
	shell: { canvasTreatment: 'tactile' },
	components: {
		button: 'precise',
		card: 'paper',
		container: 'tinted',
		input: 'underlined',
		select: 'underlined',
		toolbar: 'outlined',
		decoration: 'tactile'
	}
});

export const corkboardTheme: ThemeManifest = theme(
	'corkboard',
	'Corkboard',
	'Tactile paper surfaces, moss ink, and pinned amber actions.',
	'tabler',
	{
			light: corkboardLight
		}
);
