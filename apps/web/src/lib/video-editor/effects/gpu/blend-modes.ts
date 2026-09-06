/**
 * Blend modes for layer compositing (GPU compositor).
 *
 * Ported from FreeCut (MIT) — src/types/blend-modes.ts — verbatim: 25 modes,
 * u32 indices matching the WGSL `applyBlendMode` dispatch in
 * infrastructure/gpu-shared/blend-modes.ts, and the grouped dropdown layout.
 */

export type BlendMode =
	// Normal
	| 'normal'
	| 'dissolve'
	// Darken
	| 'darken'
	| 'multiply'
	| 'color-burn'
	| 'linear-burn'
	// Lighten
	| 'lighten'
	| 'screen'
	| 'color-dodge'
	| 'linear-dodge'
	// Contrast
	| 'overlay'
	| 'soft-light'
	| 'hard-light'
	| 'vivid-light'
	| 'linear-light'
	| 'pin-light'
	| 'hard-mix'
	// Inversion
	| 'difference'
	| 'exclusion'
	| 'subtract'
	| 'divide'
	// Component (HSL)
	| 'hue'
	| 'saturation'
	| 'color'
	| 'luminosity';

/** Map blend mode string to u32 index for GPU shader. Ported verbatim. */
export const BLEND_MODE_INDEX = {
	normal: 0,
	dissolve: 1,
	darken: 2,
	multiply: 3,
	'color-burn': 4,
	'linear-burn': 5,
	lighten: 6,
	screen: 7,
	'color-dodge': 8,
	'linear-dodge': 9,
	overlay: 10,
	'soft-light': 11,
	'hard-light': 12,
	'vivid-light': 13,
	'linear-light': 14,
	'pin-light': 15,
	'hard-mix': 16,
	difference: 17,
	exclusion: 18,
	subtract: 19,
	divide: 20,
	hue: 21,
	saturation: 22,
	color: 23,
	luminosity: 24
} satisfies Record<BlendMode, number>;

/** Grouped blend modes for UI dropdown. Ported verbatim (labels are i18n keys). */
export const BLEND_MODE_GROUPS = [
	{ label: 'normal', modes: ['normal', 'dissolve'] },
	{ label: 'darken', modes: ['darken', 'multiply', 'color-burn', 'linear-burn'] },
	{ label: 'lighten', modes: ['lighten', 'screen', 'color-dodge', 'linear-dodge'] },
	{
		label: 'contrast',
		modes: [
			'overlay',
			'soft-light',
			'hard-light',
			'vivid-light',
			'linear-light',
			'pin-light',
			'hard-mix'
		]
	},
	{ label: 'inversion', modes: ['difference', 'exclusion', 'subtract', 'divide'] },
	{ label: 'component', modes: ['hue', 'saturation', 'color', 'luminosity'] }
] satisfies { label: string; modes: BlendMode[] }[];

/** Every blend mode in index order; used by tests and exhaustive UI lists. */
export const ALL_BLEND_MODES: readonly BlendMode[] = [
	'normal',
	'dissolve',
	'darken',
	'multiply',
	'color-burn',
	'linear-burn',
	'lighten',
	'screen',
	'color-dodge',
	'linear-dodge',
	'overlay',
	'soft-light',
	'hard-light',
	'vivid-light',
	'linear-light',
	'pin-light',
	'hard-mix',
	'difference',
	'exclusion',
	'subtract',
	'divide',
	'hue',
	'saturation',
	'color',
	'luminosity'
];

/** True when a clip needs the compositor for its blend mode alone. */
export function isNonNormalBlend(mode?: string): boolean {
	return mode !== undefined && mode !== 'normal';
}
