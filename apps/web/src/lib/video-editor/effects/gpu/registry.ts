/**
 * GPU effect registry.
 *
 * Ported from FreeCut (MIT) - infrastructure/gpu-effects/registry.ts -
 * adapted to a plain array-backed catalog (tree-shakeable, no namespace
 * import magic). Shader sources live in shaders/*; see shader-source.ts for
 * the WGSL -> GLSL ES 3.00 translation rules.
 *
 * Catalog status vs FreeCut's 54-effect catalog:
 * - All 54 effects run in the WebGL2 pipeline, including the generated ASCII
 *   atlas, Paper halftone, CPU-baked curves, imported .cube LUTs, and exact
 *   point-scatter HQ pixel sorting.
 */

import type { GpuEffectCategory, GpuParamValues, GpuShaderDefinition } from './types';
import { defaultGpuParams } from './types';
import * as colorEffects from './shaders/color';
import * as blurEffects from './shaders/blur';
import * as keyingEffects from './shaders/keying';
import * as stylizeEffects from './shaders/stylize';
import { ascii } from './shaders/ascii';
import { halftone } from './shaders/halftone';
import * as distortEffects from './shaders/distort';
import { curves } from './curves';
import { lut } from './lut';

/** Every definition, in stable category order (color, blur, keying, stylize, distort). */
export const GPU_EFFECT_CATALOG: readonly GpuShaderDefinition[] = [
	colorEffects.brightness,
	colorEffects.contrast,
	colorEffects.exposure,
	colorEffects.hueShift,
	colorEffects.invert,
	colorEffects.levels,
	colorEffects.saturation,
	colorEffects.temperature,
	colorEffects.grayscale,
	colorEffects.sepia,
	colorEffects.vibrance,
	colorEffects.colorWheels,
	colorEffects.secondaryQualifier,
	colorEffects.powerWindow,
	colorEffects.gradientMap,
	curves,
	lut,
	blurEffects.gaussianBlur,
	blurEffects.boxBlur,
	blurEffects.motionBlur,
	blurEffects.radialBlur,
	blurEffects.zoomBlur,
	keyingEffects.chromaKey,
	stylizeEffects.vignette,
	stylizeEffects.grain,
	stylizeEffects.sharpen,
	stylizeEffects.posterize,
	stylizeEffects.glow,
	stylizeEffects.edgeDetect,
	stylizeEffects.scanlines,
	stylizeEffects.colorGlitch,
	stylizeEffects.blockGlitch,
	stylizeEffects.crt,
	stylizeEffects.dither,
	stylizeEffects.threshold,
	stylizeEffects.vhs,
	stylizeEffects.ink,
	halftone,
	ascii,
	stylizeEffects.pixelSort,
	stylizeEffects.pixelSortHq,
	distortEffects.pixelate,
	distortEffects.rgbSplit,
	distortEffects.twirl,
	distortEffects.wave,
	distortEffects.triggerWave,
	distortEffects.bulge,
	distortEffects.kaleidoscope,
	distortEffects.mirror,
	distortEffects.flutedGlass,
	distortEffects.rippleGlass,
	distortEffects.glassMosaic,
	distortEffects.blocks,
	distortEffects.droste
];

const GPU_EFFECT_REGISTRY = new Map<string, GpuShaderDefinition>(
	GPU_EFFECT_CATALOG.map((definition) => [definition.id, definition])
);

const GPU_EFFECTS_BY_CATEGORY = new Map<GpuEffectCategory, GpuShaderDefinition[]>();
for (const definition of GPU_EFFECT_CATALOG) {
	const list = GPU_EFFECTS_BY_CATEGORY.get(definition.category) ?? [];
	list.push(definition);
	GPU_EFFECTS_BY_CATEGORY.set(definition.category, list);
}

export function getGpuEffect(id: string): GpuShaderDefinition | undefined {
	return GPU_EFFECT_REGISTRY.get(id);
}

export function getGpuEffectDefaultParams(id: string): GpuParamValues {
	const definition = GPU_EFFECT_REGISTRY.get(id);
	if (!definition) return {};
	return defaultGpuParams(definition.schema);
}

export function getGpuEffectsByCategory(category: GpuEffectCategory): GpuShaderDefinition[] {
	return GPU_EFFECTS_BY_CATEGORY.get(category) ?? [];
}

export function getGpuCategoriesWithEffects(): {
	category: GpuEffectCategory;
	effects: GpuShaderDefinition[];
}[] {
	return [...GPU_EFFECTS_BY_CATEGORY.entries()]
		.filter(([, effects]) => effects.length > 0)
		.map(([category, effects]) => ({ category, effects }));
}
