import type { ThemeScheme } from '../contracts.js';
import { colors, familyTypography, scheme, theme } from './shared.js';

function ditherScheme(appearance: ThemeScheme, palette: 'orange' | 'moss') {
	const dark = appearance === 'dark';
	const hue = palette === 'orange' ? 45 : 155;
	const neutralHue = palette === 'orange' ? 50 : 95;
	const ink = dark ? 'oklch(0.96 0.008 95)' : `oklch(0.2 0.015 ${neutralHue})`;
	const canvas = dark ? `oklch(0.15 0.012 ${neutralHue})` : `oklch(0.985 0.008 ${neutralHue})`;
	const surface = dark ? `oklch(0.19 0.013 ${neutralHue})` : `oklch(0.998 0.002 ${neutralHue})`;
	const sunken = dark ? `oklch(0.12 0.012 ${neutralHue})` : `oklch(0.95 0.012 ${neutralHue})`;
	const signal =
		palette === 'orange'
			? dark
				? `oklch(0.76 0.14 ${hue})`
				: `oklch(0.4 0.13 ${hue})`
			: dark
				? `oklch(0.78 0.14 ${hue})`
				: `oklch(0.4 0.13 ${hue})`;
	const signalInk = dark ? `oklch(0.12 0.015 ${hue})` : 'oklch(0.99 0.003 95)';
	const selection = dark ? `oklch(0.28 0.045 ${hue})` : `oklch(0.92 0.035 ${hue})`;
	const border = dark ? `oklch(0.36 0.016 ${neutralHue})` : `oklch(0.78 0.018 ${neutralHue})`;
	const chartColors =
		palette === 'orange'
			? dark
				? [
						'oklch(0.74 0.16 45)',
						'oklch(0.76 0.15 155)',
						'oklch(0.75 0.16 255)',
						'oklch(0.78 0.15 305)',
						'oklch(0.8 0.15 75)'
					]
				: [
						'oklch(0.52 0.17 45)',
						'oklch(0.53 0.14 155)',
						'oklch(0.55 0.17 255)',
						'oklch(0.58 0.15 305)',
						'oklch(0.61 0.15 75)'
					]
			: dark
				? [
						'oklch(0.74 0.16 255)',
						'oklch(0.76 0.15 155)',
						'oklch(0.75 0.16 305)',
						'oklch(0.83 0.15 75)',
						'oklch(0.75 0.17 20)'
					]
				: [
						'oklch(0.52 0.17 255)',
						'oklch(0.53 0.14 155)',
						'oklch(0.55 0.17 305)',
						'oklch(0.61 0.15 75)',
						'oklch(0.55 0.18 20)'
					];

	return scheme(
		{
			colors: colors({
				canvas,
				ink,
				surface,
				surfaceSunken: sunken,
				surfaceRaised: dark ? `oklch(0.23 0.014 ${neutralHue})` : surface,
				mutedInk: dark ? `oklch(0.74 0.018 ${neutralHue})` : `oklch(0.44 0.02 ${neutralHue})`,
				border,
				focus: dark ? `oklch(0.8 0.14 ${hue})` : `oklch(0.46 0.13 ${hue})`,
				caret: signal,
				link: signal,
				selection,
				selectionInk: ink,
				actionFocal: signal,
				actionFocalInk: signalInk,
				actionFocalHover: dark ? `oklch(0.84 0.12 ${hue})` : `oklch(0.35 0.13 ${hue})`,
				actionFocalActive: dark ? `oklch(0.9 0.09 ${hue})` : `oklch(0.3 0.11 ${hue})`,
				actionPrimary: ink,
				actionPrimaryInk: canvas,
				actionPrimaryHover: dark ? 'oklch(0.9 0.008 95)' : `oklch(0.25 0.015 ${neutralHue})`,
				actionPrimaryActive: dark ? 'oklch(0.85 0.008 95)' : `oklch(0.28 0.015 ${neutralHue})`,
				actionOrdinary: surface,
				actionOrdinaryInk: ink,
				actionOrdinaryBorder: border,
				actionOrdinaryHover: selection,
				actionOrdinaryActive: sunken,
				danger: dark ? 'oklch(0.66 0.19 25)' : 'oklch(0.53 0.19 25)',
				dangerInk: dark ? 'oklch(0.12 0.01 50)' : 'oklch(0.99 0 0)',
				actionDestructiveInk: dark ? 'oklch(0.83 0.12 25)' : 'oklch(0.43 0.18 25)',
				success: dark ? 'oklch(0.27 0.06 155)' : 'oklch(0.93 0.04 155)',
				successInk: dark ? 'oklch(0.8 0.12 155)' : 'oklch(0.35 0.1 155)',
				warning: dark ? 'oklch(0.28 0.06 85)' : 'oklch(0.95 0.055 85)',
				warningInk: dark ? 'oklch(0.85 0.12 85)' : 'oklch(0.4 0.09 75)',
				info: dark ? 'oklch(0.27 0.06 255)' : 'oklch(0.93 0.04 255)',
				infoInk: dark ? 'oklch(0.82 0.12 255)' : 'oklch(0.4 0.14 255)',
				sidebar: sunken,
				sidebarInk: ink,
				sidebarActive: selection,
				sidebarActiveInk: ink,
				navigationHover: surface,
				chart1: chartColors[0],
				chart2: chartColors[1],
				chart3: chartColors[2],
				chart4: chartColors[3],
				chart5: chartColors[4]
			}),
			typography: familyTypography(palette === 'orange' ? 'geist' : 'dm-sans'),
			shape: {
				radius: '0.5rem',
				radiusSm: '0.25rem',
				radiusMd: '0.375rem',
				radiusLg: palette === 'orange' ? '0.75rem' : '1rem'
			},
			elevation: { card: 'none', focalAction: 'none' },
			motion: { press: { distance: '1px' }, reducedMotion: 'instant' },
			components: {
				button: 'dither',
				card: 'dither',
				decoration: 'dither',
				navigation: palette === 'orange' ? 'outlined' : 'tonal',
				tabs: palette === 'orange' ? 'underline' : 'segmented',
				input: 'outlined',
				select: 'outlined',
				badge: 'outlined',
				toolbar: 'outlined'
			}
		},
		appearance
	);
}

export const ditherTheme = theme(
	'dither',
	'Dither',
	'Workshop Orange controls and ordered pixel textures on paper and charcoal.',
	'lucide',
	{ light: ditherScheme('light', 'orange'), dark: ditherScheme('dark', 'orange') }
);

export const ditherMossTheme = theme(
	'dither-moss',
	'Dither Moss',
	'Green ink, warm paper, and dithered fills in both schemes.',
	'lucide',
	{ light: ditherScheme('light', 'moss'), dark: ditherScheme('dark', 'moss') }
);
