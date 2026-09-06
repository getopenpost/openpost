import { getGpuEffect } from './registry';
import type { GpuParamValues, GpuUniformValues } from './types';

export const MAX_INLINE_COLOR_EFFECTS = 12;

const INLINE_COLOR_EFFECT_KINDS = new Map<string, number>([
	['gpu-brightness', 1],
	['gpu-contrast', 2],
	['gpu-exposure', 3],
	['gpu-hue-shift', 4],
	['gpu-invert', 5],
	['gpu-levels', 6],
	['gpu-saturation', 7],
	['gpu-temperature', 8],
	['gpu-grayscale', 9],
	['gpu-sepia', 10],
	['gpu-vibrance', 11],
	['gpu-posterize', 12],
	['gpu-threshold', 13]
]);

export interface ColorBatchEffect {
	effectId: string;
	params: GpuParamValues;
}

export type PlannedEffectPass<T extends ColorBatchEffect = ColorBatchEffect> =
	| { kind: 'color-batch'; effects: readonly T[] }
	| { kind: 'single'; effect: T };

export function planEffectPasses<T extends ColorBatchEffect>(
	effects: readonly T[],
	enableColorBatch: boolean
): PlannedEffectPass<T>[] {
	if (!enableColorBatch) return effects.map((effect) => ({ kind: 'single', effect }));

	const passes: PlannedEffectPass<T>[] = [];
	for (let index = 0; index < effects.length;) {
		const effect = effects[index]!;
		if (!INLINE_COLOR_EFFECT_KINDS.has(effect.effectId)) {
			passes.push({ kind: 'single', effect });
			index++;
			continue;
		}

		const start = index;
		while (
			index < effects.length &&
			index - start < MAX_INLINE_COLOR_EFFECTS &&
			INLINE_COLOR_EFFECT_KINDS.has(effects[index]!.effectId)
		) {
			index++;
		}
		const batch = effects.slice(start, index);
		if (batch.length > 1) passes.push({ kind: 'color-batch', effects: batch });
		else passes.push({ kind: 'single', effect: batch[0]! });
	}
	return passes;
}

export interface PackedColorBatch {
	count: number;
	kinds: Int32Array;
	values0: Float32Array;
	values1: Float32Array;
}

function uniform(values: GpuUniformValues, name: string, fallback = 0): number {
	return values[name] ?? fallback;
}

function operationValues(effectId: string, values: GpuUniformValues): readonly number[] {
	switch (effectId) {
		case 'gpu-brightness':
		case 'gpu-contrast':
		case 'gpu-saturation':
		case 'gpu-grayscale':
		case 'gpu-sepia':
		case 'gpu-vibrance':
			return [uniform(values, 'uAmount')];
		case 'gpu-exposure':
			return [
				uniform(values, 'uExposure'),
				uniform(values, 'uOffset'),
				uniform(values, 'uGamma', 1)
			];
		case 'gpu-hue-shift':
			return [
				uniform(values, 'uShift'),
				uniform(values, 'uSpan', 1),
				uniform(values, 'uFlow'),
				uniform(values, 'uTime')
			];
		case 'gpu-levels':
			return [
				uniform(values, 'uInputBlack'),
				uniform(values, 'uInputWhite', 1),
				uniform(values, 'uGamma', 1),
				uniform(values, 'uOutputBlack'),
				uniform(values, 'uOutputWhite', 1)
			];
		case 'gpu-temperature':
			return [uniform(values, 'uTemperature'), uniform(values, 'uTint')];
		case 'gpu-posterize':
			return [uniform(values, 'uLevels', 6)];
		case 'gpu-threshold':
			return [uniform(values, 'uLevel', 0.5)];
		default:
			return [];
	}
}

export function packColorBatch(
	effects: readonly ColorBatchEffect[],
	width: number,
	height: number,
	time: number
): PackedColorBatch {
	if (effects.length < 2 || effects.length > MAX_INLINE_COLOR_EFFECTS) {
		throw new Error(`Inline color batch must contain 2-${MAX_INLINE_COLOR_EFFECTS} effects.`);
	}
	const kinds = new Int32Array(MAX_INLINE_COLOR_EFFECTS);
	const values0 = new Float32Array(MAX_INLINE_COLOR_EFFECTS * 4);
	const values1 = new Float32Array(MAX_INLINE_COLOR_EFFECTS * 4);

	for (let index = 0; index < effects.length; index++) {
		const effect = effects[index]!;
		const kind = INLINE_COLOR_EFFECT_KINDS.get(effect.effectId);
		const definition = getGpuEffect(effect.effectId);
		if (kind === undefined || !definition) {
			throw new Error(`GPU effect cannot join an inline color batch: ${effect.effectId}`);
		}
		kinds[index] = kind;
		const values = operationValues(
			effect.effectId,
			definition.uniformValues(effect.params, width, height, time)
		);
		values0.set(values.slice(0, 4), index * 4);
		values1.set(values.slice(4, 8), index * 4);
	}

	return { count: effects.length, kinds, values0, values1 };
}

export const COLOR_BATCH_FRAGMENT_SOURCE = /* glsl */ `
uniform int uOpCount;
uniform int uKinds[${MAX_INLINE_COLOR_EFFECTS}];
uniform vec4 uValues0[${MAX_INLINE_COLOR_EFFECTS}];
uniform vec4 uValues1[${MAX_INLINE_COLOR_EFFECTS}];

vec4 colorBatchFragment(vec2 vUv) {
  vec4 sampled = texture(uInputTex, vUv);
  vec3 color = sampled.rgb;
  for (int index = 0; index < ${MAX_INLINE_COLOR_EFFECTS}; index++) {
    if (index >= uOpCount) break;
    int kind = uKinds[index];
    vec4 values0 = uValues0[index];
    vec4 values1 = uValues1[index];
    if (kind == 1) {
      color += vec3(values0.x);
    } else if (kind == 2) {
      color = (color - vec3(0.5)) * values0.x + vec3(0.5);
    } else if (kind == 3) {
      color = color * pow(vec3(2.0), vec3(values0.x)) + vec3(values0.y);
      color = pow(max(color, vec3(0.0)), vec3(1.0 / values0.z));
    } else if (kind == 4) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(values0.x + values0.z * values0.w + hsv.x * values0.y);
      color = hsv2rgb(hsv);
    } else if (kind == 5) {
      color = vec3(1.0) - color;
    } else if (kind == 6) {
      color = (color - vec3(values0.x)) / (values0.y - values0.x);
      color = clamp(color, vec3(0.0), vec3(1.0));
      color = pow(color, vec3(1.0 / values0.z));
      color = mix(vec3(values0.w), vec3(values1.x), color);
    } else if (kind == 7) {
      float gray = luminance601(color);
      color = mix(vec3(gray), color, vec3(values0.x));
    } else if (kind == 8) {
      color.r += values0.x * 0.1;
      color.b -= values0.x * 0.1;
      color.g -= values0.y * 0.1;
      color.r += values0.y * 0.05;
      color.b += values0.y * 0.05;
    } else if (kind == 9) {
      color = mix(color, vec3(luminance601(color)), vec3(values0.x));
    } else if (kind == 10) {
      vec3 sepia = vec3(
        dot(color, vec3(0.393, 0.769, 0.189)),
        dot(color, vec3(0.349, 0.686, 0.168)),
        dot(color, vec3(0.272, 0.534, 0.131))
      );
      color = mix(color, sepia, vec3(values0.x));
    } else if (kind == 11) {
      float maxChannel = max(max(color.r, color.g), color.b);
      float minChannel = min(min(color.r, color.g), color.b);
      float saturation = (maxChannel - minChannel) / (maxChannel + 0.001);
      float amount = values0.x * (1.0 - saturation);
      color = mix(vec3(luminance601(color)), color, vec3(1.0 + amount));
    } else if (kind == 12) {
      float levels = max(values0.x, 2.0);
      color = floor(color * levels) / (levels - 1.0);
    } else if (kind == 13) {
      color = vec3(luminance(color) > values0.x ? 1.0 : 0.0);
    }
    color = round(clamp(color, vec3(0.0), vec3(1.0)) * 255.0) / 255.0;
  }
  return vec4(color, sampled.a);
}
`;
