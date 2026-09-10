import { convert } from '@asamuzakjp/css-color';
import type { ThemeColorTokens, ThemeManifest, ThemeSchemeManifest } from '$lib/themes/contracts';

const ACCENT_COLORS = [
	'brand',
	'brandInk',
	'workspace',
	'actionLink',
	'actionLinkHover',
	'navigationActive',
	'actionFocal',
	'actionFocalInk',
	'actionFocalHover',
	'actionFocalActive',
	'caret',
	'link',
	'selection',
	'sidebarActive',
	'actionOrdinaryHover'
] as const satisfies readonly (keyof ThemeColorTokens)[];

export function themeAccentHue(scheme: ThemeSchemeManifest): number {
	const hue = convert.colorToOklch(scheme.colors.actionFocal)[2];
	return Number.isFinite(hue) ? Math.round(hue) % 360 : 0;
}

export function updateDitherAccent(theme: ThemeManifest, hue: number): ThemeManifest {
	const next = structuredClone(theme);
	for (const scheme of Object.values(next.schemes)) {
		if (!scheme || scheme.components.decoration !== 'dither') continue;
		const previousHue = convert.colorToOklch(scheme.colors.actionFocal)[2];
		for (const key of [...ACCENT_COLORS, 'focus'] as const) {
			const [lightness, chroma, currentHue, alpha] = convert.colorToOklch(scheme.colors[key]);
			// Neutral ink stays neutral. Focus keeps its separation from the accent.
			if (!Number.isFinite(chroma) || chroma < 0.025) continue;
			const nextHue = key === 'focus' ? (currentHue + hue - previousHue + 360) % 360 : hue;
			scheme.colors[key] = `oklch(${lightness} ${chroma} ${nextHue} / ${alpha})`;
		}
	}
	return next;
}
