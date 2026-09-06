/**
 * Clip effect model for the OpenPost Video Editor.
 *
 * Ported from FreeCut (MIT) — types/effects.ts — trimmed to color/blur
 * effects with params that match CSS filter semantics, so the same
 * spec renders through `style: filter` and canvas `ctx.filter`.
 *
 * Like FreeCut's `ItemEffect`, each instance carries a stable id (so undo
 * and the panel can address one effect) and an enabled flag.
 */

interface ItemEffectBase {
	id: string;
	enabled: boolean;
}

export interface BrightnessEffect extends ItemEffectBase {
	type: 'brightness';
	/** 0 = black, 1 = unchanged, >1 brighter. */
	amount: number;
}

export interface ContrastEffect extends ItemEffectBase {
	type: 'contrast';
	/** 0 = gray, 1 = unchanged, >1 more contrast. */
	amount: number;
}

export interface SaturationEffect extends ItemEffectBase {
	type: 'saturation';
	/** 0 = grayscale, 1 = unchanged, >1 more saturated. */
	amount: number;
}

export interface HueRotateEffect extends ItemEffectBase {
	type: 'hue-rotate';
	/** Rotation in degrees; 0 = unchanged. */
	amount: number;
}

export interface SepiaEffect extends ItemEffectBase {
	type: 'sepia';
	/** 0 = unchanged, 1 = fully sepia. */
	amount: number;
}

export interface GrayscaleEffect extends ItemEffectBase {
	type: 'grayscale';
	/** 0 = unchanged, 1 = fully gray. */
	amount: number;
}

export interface InvertEffect extends ItemEffectBase {
	type: 'invert';
	/** 0 = unchanged, 1 = fully inverted. */
	amount: number;
}

export interface BlurEffect extends ItemEffectBase {
	type: 'blur';
	/** Blur radius in pixels; 0 = sharp. */
	amount: number;
}

/**
 * One GPU-pipeline effect instance, addressed by registry id with typed
 * params (see effects/gpu/registry.ts). Rendered through the WebGL2
 * compositor; ignored by the CSS-filter fallback path.
 */
export interface GpuEffect extends ItemEffectBase {
	type: 'gpu';
	effectId: string;
	params: Record<string, number | string | boolean>;
}

export type ItemEffect =
	| BrightnessEffect
	| ContrastEffect
	| SaturationEffect
	| HueRotateEffect
	| SepiaEffect
	| GrayscaleEffect
	| InvertEffect
	| BlurEffect
	| GpuEffect;

export type ItemType = ItemEffect['type'];

/** CSS-filter-renderable subset (everything except the GPU-pipeline variant). */
export type CssFilterType = Exclude<ItemType, 'gpu'>;

/** Unit appended to the param when serializing to a CSS filter function. */
const UNIT_BY_TYPE = {
	brightness: '',
	contrast: '',
	saturation: '',
	'hue-rotate': 'deg',
	sepia: '',
	grayscale: '',
	invert: '',
	blur: 'px'
} satisfies Record<CssFilterType, string>;

/** Slider range and neutral default per effect type. */
export interface EffectDefinition {
	type: CssFilterType;
	min: number;
	max: number;
	step: number;
	defaultAmount: number;
}

export const EFFECT_DEFINITIONS: readonly EffectDefinition[] = [
	{ type: 'brightness', min: 0, max: 2, step: 0.01, defaultAmount: 1.2 },
	{ type: 'contrast', min: 0, max: 2, step: 0.01, defaultAmount: 1.2 },
	{ type: 'saturation', min: 0, max: 3, step: 0.01, defaultAmount: 1.4 },
	{ type: 'hue-rotate', min: 0, max: 360, step: 1, defaultAmount: 45 },
	{ type: 'sepia', min: 0, max: 1, step: 0.01, defaultAmount: 0.5 },
	{ type: 'grayscale', min: 0, max: 1, step: 0.01, defaultAmount: 1 },
	{ type: 'invert', min: 0, max: 1, step: 0.01, defaultAmount: 1 },
	{ type: 'blur', min: 0, max: 20, step: 0.5, defaultAmount: 4 }
];

export function effectUnit(type: CssFilterType): string {
	return UNIT_BY_TYPE[type];
}
