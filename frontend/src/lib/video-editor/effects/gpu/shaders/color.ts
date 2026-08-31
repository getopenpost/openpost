/**
 * Color GPU effects.
 *
 * Ported from FreeCut (MIT) — infrastructure/gpu-effects/effects/color.ts —
 * WGSL fragment bodies translated to GLSL ES 3.00 with the mechanical rules in
 * ../shader-source.ts; math and structure verbatim. Skipped from the catalog:
 * gpu-curves (CPU-baked LUT + point-editor JSON params) — see registry.ts.
 */

import type { GpuParamValues, GpuShaderDefinition } from '../types';
import { parseHexColor, readNumber, readString } from '../types';

export const brightness: GpuShaderDefinition = {
	id: 'gpu-brightness',
	label: 'Brightness',
	category: 'color',
	entryPoint: 'brightnessFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
vec4 brightnessFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 adjusted = color.rgb + uAmount;
  return vec4(clamp(adjusted, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{
			name: 'amount',
			label: 'Amount',
			default: 0,
			min: -1,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p) => ({ uAmount: readNumber(p, 'amount', 0) })
};

export const contrast: GpuShaderDefinition = {
	id: 'gpu-contrast',
	label: 'Contrast',
	category: 'color',
	entryPoint: 'contrastFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
vec4 contrastFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 adjusted = (color.rgb - 0.5) * uAmount + 0.5;
  return vec4(clamp(adjusted, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [{ name: 'amount', label: 'Amount', default: 1, min: 0, max: 3, step: 0.01 }],
	uniformValues: (p) => ({ uAmount: readNumber(p, 'amount', 1) })
};

export const exposure: GpuShaderDefinition = {
	id: 'gpu-exposure',
	label: 'Exposure',
	category: 'color',
	entryPoint: 'exposureFragment',
	fragmentSource: /* glsl */ `
uniform float uExposure;
uniform float uOffset;
uniform float uGamma;
vec4 exposureFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 adjusted = color.rgb * pow(vec3(2.0), vec3(uExposure));
  adjusted += uOffset;
  adjusted = pow(max(adjusted, vec3(0.0)), vec3(1.0 / uGamma));
  return vec4(clamp(adjusted, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{
			name: 'exposure',
			label: 'Exposure (EV)',
			default: 0,
			min: -3,
			max: 3,
			step: 0.1
		},
		{
			name: 'offset',
			label: 'Offset',
			default: 0,
			min: -0.5,
			max: 0.5,
			step: 0.01
		},
		{ name: 'gamma', label: 'Gamma', default: 1, min: 0.2, max: 3, step: 0.01 }
	],
	uniformValues: (p) => ({
		uExposure: readNumber(p, 'exposure', 0),
		uOffset: readNumber(p, 'offset', 0),
		uGamma: readNumber(p, 'gamma', 1)
	})
};

export const hueShift: GpuShaderDefinition = {
	id: 'gpu-hue-shift',
	label: 'Hue Shift',
	category: 'color',
	entryPoint: 'hueShiftFragment',
	fragmentSource: /* glsl */ `
uniform float uShift;
uniform float uSpan;
uniform float uFlow;
uniform float uTime;
vec4 hueShiftFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 hsv = rgb2hsv(color.rgb);
  // span compresses (<1) or expands (>1) the hue range around the shift offset;
  // span = 1 is a plain hue rotation (backward compatible), span = 0 maps every
  // pixel to a single hue (monochrome tint). flow cycles the offset over time.
  hsv.x = fract(uShift + uFlow * uTime + hsv.x * uSpan);
  return vec4(hsv2rgb(hsv), color.a);
}`,
	schema: [
		{ name: 'shift', label: 'Shift', default: 0, min: 0, max: 1, step: 0.01 },
		{ name: 'span', label: 'Span', default: 1, min: 0, max: 2, step: 0.01 },
		{
			name: 'flow',
			label: 'Flow',
			default: 0,
			min: 0,
			max: 2,
			step: 0.05,
			animatable: false
		}
	],
	uniformValues: (p, _w, _h, time) => ({
		uShift: readNumber(p, 'shift', 0),
		uSpan: readNumber(p, 'span', 1),
		uFlow: readNumber(p, 'flow', 0),
		uTime: time
	})
};

export const invert: GpuShaderDefinition = {
	id: 'gpu-invert',
	label: 'Invert',
	category: 'color',
	entryPoint: 'invertFragment',
	fragmentSource: /* glsl */ `
vec4 invertFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  return vec4(1.0 - color.rgb, color.a);
}`,
	schema: [],
	uniformValues: () => ({})
};

export const levels: GpuShaderDefinition = {
	id: 'gpu-levels',
	label: 'Levels',
	category: 'color',
	entryPoint: 'levelsFragment',
	fragmentSource: /* glsl */ `
uniform float uInputBlack;
uniform float uInputWhite;
uniform float uGamma;
uniform float uOutputBlack;
uniform float uOutputWhite;
vec4 levelsFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 adjusted = (color.rgb - vec3(uInputBlack)) /
                  (uInputWhite - uInputBlack);
  adjusted = clamp(adjusted, vec3(0.0), vec3(1.0));
  adjusted = pow(adjusted, vec3(1.0 / uGamma));
  adjusted = mix(vec3(uOutputBlack), vec3(uOutputWhite), adjusted);
  return vec4(adjusted, color.a);
}`,
	schema: [
		{
			name: 'inputBlack',
			label: 'Input Black',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'inputWhite',
			label: 'Input White',
			default: 1,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'gamma', label: 'Gamma', default: 1, min: 0.1, max: 3, step: 0.01 },
		{
			name: 'outputBlack',
			label: 'Output Black',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'outputWhite',
			label: 'Output White',
			default: 1,
			min: 0,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p) => ({
		uInputBlack: readNumber(p, 'inputBlack', 0),
		uInputWhite: readNumber(p, 'inputWhite', 1),
		uGamma: readNumber(p, 'gamma', 1),
		uOutputBlack: readNumber(p, 'outputBlack', 0),
		uOutputWhite: readNumber(p, 'outputWhite', 1)
	})
};

export const saturation: GpuShaderDefinition = {
	id: 'gpu-saturation',
	label: 'Saturation',
	category: 'color',
	entryPoint: 'saturationFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
vec4 saturationFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float gray = luminance601(color.rgb);
  vec3 adjusted = mix(vec3(gray), color.rgb, vec3(uAmount));
  return vec4(clamp(adjusted, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [{ name: 'amount', label: 'Amount', default: 1, min: 0, max: 3, step: 0.01 }],
	uniformValues: (p) => ({ uAmount: readNumber(p, 'amount', 1) })
};

export const temperature: GpuShaderDefinition = {
	id: 'gpu-temperature',
	label: 'Temperature',
	category: 'color',
	entryPoint: 'temperatureFragment',
	fragmentSource: /* glsl */ `
uniform float uTemperature;
uniform float uTint;
vec4 temperatureFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 adjusted = color.rgb;
  adjusted.r += uTemperature * 0.1;
  adjusted.b -= uTemperature * 0.1;
  adjusted.g -= uTint * 0.1;
  adjusted.r += uTint * 0.05;
  adjusted.b += uTint * 0.05;
  return vec4(clamp(adjusted, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{
			name: 'temperature',
			label: 'Temperature',
			default: 0,
			min: -1,
			max: 1,
			step: 0.01
		},
		{ name: 'tint', label: 'Tint', default: 0, min: -1, max: 1, step: 0.01 }
	],
	uniformValues: (p) => ({
		uTemperature: readNumber(p, 'temperature', 0),
		uTint: readNumber(p, 'tint', 0)
	})
};

export const grayscale: GpuShaderDefinition = {
	id: 'gpu-grayscale',
	label: 'Grayscale',
	category: 'color',
	entryPoint: 'grayscaleFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
vec4 grayscaleFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float gray = luminance601(color.rgb);
  vec3 adjusted = mix(color.rgb, vec3(gray), vec3(uAmount));
  return vec4(adjusted, color.a);
}`,
	schema: [{ name: 'amount', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01 }],
	uniformValues: (p) => ({ uAmount: readNumber(p, 'amount', 1) })
};

export const sepia: GpuShaderDefinition = {
	id: 'gpu-sepia',
	label: 'Sepia',
	category: 'color',
	entryPoint: 'sepiaFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
vec4 sepiaFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float sepiaR = dot(color.rgb, vec3(0.393, 0.769, 0.189));
  float sepiaG = dot(color.rgb, vec3(0.349, 0.686, 0.168));
  float sepiaB = dot(color.rgb, vec3(0.272, 0.534, 0.131));
  vec3 sepiaColor = vec3(sepiaR, sepiaG, sepiaB);
  vec3 adjusted = mix(color.rgb, sepiaColor, vec3(uAmount));
  return vec4(clamp(adjusted, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [{ name: 'amount', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01 }],
	uniformValues: (p) => ({ uAmount: readNumber(p, 'amount', 1) })
};

export const vibrance: GpuShaderDefinition = {
	id: 'gpu-vibrance',
	label: 'Vibrance',
	category: 'color',
	entryPoint: 'vibranceFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
vec4 vibranceFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float maxC = max(max(color.r, color.g), color.b);
  float minC = min(min(color.r, color.g), color.b);
  float sat = (maxC - minC) / (maxC + 0.001);
  float vibrance = uAmount * (1.0 - sat);
  float gray = luminance601(color.rgb);
  vec3 adjusted = mix(vec3(gray), color.rgb, vec3(1.0 + vibrance));
  return vec4(clamp(adjusted, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{
			name: 'amount',
			label: 'Amount',
			default: 0,
			min: -1,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p) => ({ uAmount: readNumber(p, 'amount', 0) })
};

const COLOR_WHEELS_UNIFORM_PARAMS = [
	{
		key: 'shadowsHue',
		uniform: 'uShHue',
		label: 'Lift Hue',
		min: 0,
		max: 360,
		step: 1,
		fallback: 0
	},
	{
		key: 'shadowsAmount',
		uniform: 'uShAmount',
		label: 'Lift Amount',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0
	},
	{
		key: 'midtonesHue',
		uniform: 'uMidHue',
		label: 'Gamma Hue',
		min: 0,
		max: 360,
		step: 1,
		fallback: 0
	},
	{
		key: 'midtonesAmount',
		uniform: 'uMidAmount',
		label: 'Gamma Amount',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0
	},
	{
		key: 'highlightsHue',
		uniform: 'uHlHue',
		label: 'Gain Hue',
		min: 0,
		max: 360,
		step: 1,
		fallback: 0
	},
	{
		key: 'highlightsAmount',
		uniform: 'uHlAmount',
		label: 'Gain Amount',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0
	},
	{
		key: 'offsetHue',
		uniform: 'uOffHue',
		label: 'Offset Hue',
		min: 0,
		max: 360,
		step: 1,
		fallback: 0
	},
	{
		key: 'offsetAmount',
		uniform: 'uOffAmount',
		label: 'Offset Amount',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0
	},
	{
		key: 'temperature',
		uniform: 'uTemperature',
		label: 'Temperature',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'tint',
		uniform: 'uTint',
		label: 'Tint',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'saturation',
		uniform: 'uSaturation',
		label: 'Saturation',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'exposure',
		uniform: 'uExposure',
		label: 'Exposure',
		min: -3,
		max: 3,
		step: 0.05,
		fallback: 0
	},
	{
		key: 'contrast',
		uniform: 'uContrast',
		label: 'Contrast',
		min: 0,
		max: 2,
		step: 0.01,
		fallback: 1
	},
	{
		key: 'pivot',
		uniform: 'uPivot',
		label: 'Pivot',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0.5
	},
	// Lift/gamma/gain/offset ranges mirror Resolve's primaries reach: lift
	// and offset span ±2.0 in normalized signal (Resolve shows offset as
	// 25 + 100x, i.e. -175..225), gamma is 0-centered in Resolve's display
	// (param = display + 1), gain is a plain multiplier up to 16 (+4 stops).
	{
		key: 'lift',
		uniform: 'uLift',
		label: 'Lift',
		min: -2,
		max: 2,
		step: 0.01,
		fallback: 0
	},
	{
		key: 'gamma',
		uniform: 'uGamma',
		label: 'Gamma',
		min: 0,
		max: 4,
		step: 0.01,
		fallback: 1
	},
	{
		key: 'gain',
		uniform: 'uGain',
		label: 'Gain',
		min: 0,
		max: 16,
		step: 0.01,
		fallback: 1
	},
	{
		key: 'offset',
		uniform: 'uOffset',
		label: 'Offset',
		min: -2,
		max: 2,
		step: 0.0025,
		fallback: 0
	},
	{
		key: 'blackPoint',
		uniform: 'uBlackPoint',
		label: 'Black Point',
		min: 0,
		max: 0.5,
		step: 0.005,
		fallback: 0
	},
	{
		key: 'whitePoint',
		uniform: 'uWhitePoint',
		label: 'White Point',
		min: 0.5,
		max: 1.5,
		step: 0.005,
		fallback: 1
	},
	{
		key: 'midDetail',
		uniform: 'uMidDetail',
		label: 'Mid/Detail',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'colorBoost',
		uniform: 'uColorBoost',
		label: 'Color Boost',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'shadows',
		uniform: 'uShadows',
		label: 'Shadows',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'highlights',
		uniform: 'uHighlights',
		label: 'Highlights',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'hue',
		uniform: 'uHue',
		label: 'Hue',
		min: 0,
		max: 100,
		step: 1,
		fallback: 50
	},
	{
		key: 'lumMix',
		uniform: 'uLumMix',
		label: 'Lum Mix',
		min: 0,
		max: 100,
		step: 1,
		fallback: 100
	}
] as const;

export const colorWheels: GpuShaderDefinition = {
	id: 'gpu-color-wheels',
	label: 'Color Wheels',
	category: 'color',
	entryPoint: 'colorWheelsFragment',
	fragmentSource: /* glsl */ `
uniform float uShHue;
uniform float uShAmount;
uniform float uMidHue;
uniform float uMidAmount;
uniform float uHlHue;
uniform float uHlAmount;
uniform float uTemperature;
uniform float uTint;
uniform float uSaturation;
uniform float uExposure;
uniform float uContrast;
uniform float uPivot;
uniform float uLift;
uniform float uGamma;
uniform float uGain;
uniform float uOffset;
uniform float uBlackPoint;
uniform float uWhitePoint;
uniform float uOffHue;
uniform float uOffAmount;
uniform float uMidDetail;
uniform float uColorBoost;
uniform float uShadows;
uniform float uHighlights;
uniform float uHue;
uniform float uLumMix;

vec3 wheelTint(vec3 color, float hue, float amount, float mask) {
  if (amount < 0.001) { return color; }
  float rad = hue * TAU / 360.0;
  vec3 tintColor = hsv2rgb(vec3(hue / 360.0, 1.0, 1.0));
  return mix(color, color * mix(vec3(1.0), tintColor, vec3(amount)), vec3(mask));
}

vec4 colorWheelsFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 c = color.rgb;
  float luma = luminance601(c);
  float shadowMask = 1.0 - smoothstep(0.0, 0.5, luma);
  float highlightMask = smoothstep(0.5, 1.0, luma);
  float midtoneMask = 1.0 - shadowMask - highlightMask;
  c = wheelTint(c, uShHue, uShAmount, shadowMask);
  c = wheelTint(c, uMidHue, uMidAmount, midtoneMask);
  c = wheelTint(c, uHlHue, uHlAmount, highlightMask);
  c = wheelTint(c, uOffHue, uOffAmount, 1.0);
  float temp = uTemperature / 100.0;
  c.r += temp * 0.1;
  c.b -= temp * 0.1;
  float ti = uTint / 100.0;
  c.g -= ti * 0.1;
  c.r += ti * 0.05;
  c.b += ti * 0.05;

  c *= pow(vec3(2.0), vec3(uExposure));
  c = (c - vec3(uPivot)) * uContrast + vec3(uPivot);
  if (abs(uMidDetail) > 0.001) {
    float detailLuma = luminance601(c);
    vec3 detailAdjusted = vec3(detailLuma) +
      (c - vec3(detailLuma)) * (1.0 + uMidDetail / 100.0);
    c = mix(c, detailAdjusted, vec3(midtoneMask));
  }
  c = (c + vec3(uLift) + vec3(uOffset)) * uGain;
  c = pow(max(c, vec3(0.0)), vec3(1.0 / max(uGamma, 0.05)));
  c = (c - vec3(uBlackPoint)) /
      vec3(max(uWhitePoint - uBlackPoint, 0.001));
  c += vec3(uShadows / 100.0) * shadowMask;
  c += vec3(uHighlights / 100.0) * highlightMask;

  float sat = 1.0 + uSaturation / 100.0;
  float gray = luminance601(c);
  c = mix(vec3(gray), c, vec3(sat));
  float colorBoost = uColorBoost / 100.0;
  if (abs(colorBoost) > 0.001) {
    float boostedGray = luminance601(c);
    vec3 chroma = c - vec3(boostedGray);
    c = vec3(boostedGray) + chroma * (1.0 + colorBoost * (1.0 - clamp(length(chroma), 0.0, 1.0)));
  }
  if (abs(uHue - 50.0) > 0.001) {
    vec3 hsv = rgb2hsv(c);
    hsv.x = fract(hsv.x + ((uHue - 50.0) / 100.0));
    c = hsv2rgb(hsv);
  }
  float postLuma = luminance601(c);
  c = mix(vec3(postLuma), c, vec3(clamp(uLumMix / 100.0, 0.0, 1.0)));
  return vec4(clamp(c, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: COLOR_WHEELS_UNIFORM_PARAMS.map(({ key, label, min, max, step, fallback }) => ({
		name: key,
		label,
		min,
		max,
		step,
		default: fallback
	})),
	uniformValues: (p) =>
		Object.fromEntries(
			COLOR_WHEELS_UNIFORM_PARAMS.map(({ key, uniform, fallback }) => [
				uniform,
				readNumber(p, key, fallback)
			])
		)
};

const SECONDARY_QUALIFIER_UNIFORM_PARAMS = [
	{
		key: 'hueCenter',
		uniform: 'uHueCenter',
		label: 'Hue Center',
		min: 0,
		max: 360,
		step: 1,
		fallback: 0
	},
	{
		key: 'hueWidth',
		uniform: 'uHueWidth',
		label: 'Hue Width',
		min: 0,
		max: 180,
		step: 1,
		fallback: 35
	},
	{
		key: 'hueSoftness',
		uniform: 'uHueSoftness',
		label: 'Hue Softness',
		min: 0,
		max: 120,
		step: 1,
		fallback: 20
	},
	{
		key: 'satLow',
		uniform: 'uSatLow',
		label: 'Sat Low',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0
	},
	{
		key: 'satHigh',
		uniform: 'uSatHigh',
		label: 'Sat High',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 1
	},
	{
		key: 'satSoftness',
		uniform: 'uSatSoftness',
		label: 'Sat Softness',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0.1
	},
	{
		key: 'lumaLow',
		uniform: 'uLumaLow',
		label: 'Luma Low',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0
	},
	{
		key: 'lumaHigh',
		uniform: 'uLumaHigh',
		label: 'Luma High',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 1
	},
	{
		key: 'lumaSoftness',
		uniform: 'uLumaSoftness',
		label: 'Luma Softness',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 0.1
	},
	{
		key: 'exposure',
		uniform: 'uExposure',
		label: 'Exposure',
		min: -3,
		max: 3,
		step: 0.05,
		fallback: 0
	},
	{
		key: 'saturation',
		uniform: 'uSaturation',
		label: 'Saturation',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'temperature',
		uniform: 'uTemperature',
		label: 'Temperature',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'tint',
		uniform: 'uTint',
		label: 'Tint',
		min: -100,
		max: 100,
		step: 1,
		fallback: 0
	},
	{
		key: 'strength',
		uniform: 'uStrength',
		label: 'Strength',
		min: 0,
		max: 1,
		step: 0.01,
		fallback: 1
	}
] as const;

export const secondaryQualifier: GpuShaderDefinition = {
	id: 'gpu-secondary-qualifier',
	label: 'Secondary Qualifier',
	category: 'color',
	entryPoint: 'secondaryQualifierFragment',
	fragmentSource: /* glsl */ `
uniform float uHueCenter;
uniform float uHueWidth;
uniform float uHueSoftness;
uniform float uSatLow;
uniform float uSatHigh;
uniform float uSatSoftness;
uniform float uLumaLow;
uniform float uLumaHigh;
uniform float uLumaSoftness;
uniform float uInvertMask;
uniform float uShowMask;
uniform float uExposure;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uStrength;

float circularHueDistance(float hue, float center) {
  float diff = abs(hue - center);
  return min(diff, 1.0 - diff);
}

float centeredRangeMask(float value, float lowValue, float highValue, float softness) {
  float low = min(lowValue, highValue);
  float high = max(lowValue, highValue);
  float soft = max(softness, 0.0001);
  float lowMask = smoothstep(low - soft, low, value);
  float highMask = 1.0 - smoothstep(high, high + soft, value);
  return clamp(lowMask * highMask, 0.0, 1.0);
}

vec4 secondaryQualifierFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 hsv = rgb2hsv(color.rgb);
  float luma = luminance601(color.rgb);
  float hueDistance = circularHueDistance(hsv.x, fract(uHueCenter / 360.0));
  float hueWidth = clamp(uHueWidth / 360.0, 0.0, 0.5);
  float hueSoftness = max(uHueSoftness / 360.0, 0.0001);
  float mask = 1.0 - smoothstep(hueWidth, hueWidth + hueSoftness, hueDistance);
  mask *= centeredRangeMask(hsv.y, uSatLow, uSatHigh, uSatSoftness);
  mask *= centeredRangeMask(luma, uLumaLow, uLumaHigh, uLumaSoftness);
  if (uInvertMask > 0.5) {
    mask = 1.0 - mask;
  }
  mask = clamp(mask * uStrength, 0.0, 1.0);

  if (uShowMask > 0.5) {
    return vec4(vec3(mask), color.a);
  }

  vec3 corrected = color.rgb;
  corrected *= pow(vec3(2.0), vec3(uExposure));
  float temp = uTemperature / 100.0;
  corrected.r += temp * 0.1;
  corrected.b -= temp * 0.1;
  float ti = uTint / 100.0;
  corrected.g -= ti * 0.1;
  corrected.r += ti * 0.05;
  corrected.b += ti * 0.05;
  float sat = 1.0 + uSaturation / 100.0;
  float gray = luminance601(corrected);
  corrected = mix(vec3(gray), corrected, vec3(sat));

  return vec4(clamp(mix(color.rgb, corrected, vec3(mask)), vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		...SECONDARY_QUALIFIER_UNIFORM_PARAMS.map(({ key, label, min, max, step, fallback }) => ({
			name: key,
			label,
			min,
			max,
			step,
			default: fallback
		})),
		{
			name: 'invertMask',
			label: 'Invert Mask',
			type: 'boolean' as const,
			default: false
		},
		{
			name: 'showMask',
			label: 'Show Mask',
			type: 'boolean' as const,
			default: false
		}
	],
	uniformValues: (p) => ({
		...Object.fromEntries(
			SECONDARY_QUALIFIER_UNIFORM_PARAMS.map(({ key, uniform, fallback }) => [
				uniform,
				readNumber(p, key, fallback)
			])
		),
		uInvertMask: p.invertMask === true ? 1 : 0,
		uShowMask: p.showMask === true ? 1 : 0
	})
};

export const powerWindow: GpuShaderDefinition = {
	id: 'gpu-power-window',
	label: 'Power Window',
	category: 'color',
	entryPoint: 'powerWindowFragment',
	fragmentSource: /* glsl */ `
uniform float uWindowKind;
uniform float uCenterX;
uniform float uCenterY;
uniform float uSizeX;
uniform float uSizeY;
uniform float uRotation;
uniform float uFeather;
uniform float uInvertMask;
uniform float uShowMask;
uniform float uExposure;
uniform float uSaturation;
uniform float uTemperature;
uniform float uTint;
uniform float uStrength;
uniform float uWidth;
uniform float uHeight;

vec2 rotateWindowPoint(vec2 point, float angleDeg) {
  float angle = -angleDeg * PI / 180.0;
  float c = cos(angle);
  float s = sin(angle);
  return vec2(point.x * c - point.y * s, point.x * s + point.y * c);
}

float powerWindowMask(vec2 uv) {
  float aspect = max(uWidth / max(uHeight, 1.0), 0.0001);
  vec2 local = uv - vec2(uCenterX, uCenterY);
  local.x *= aspect;
  local = rotateWindowPoint(local, uRotation);

  vec2 size = max(vec2(uSizeX * aspect, uSizeY) * 0.5, vec2(0.0001));
  vec2 normalized = local / size;
  int windowKind = int(uWindowKind + 0.5);
  float dist = length(normalized);
  if (windowKind == 1) {
    dist = max(abs(normalized.x), abs(normalized.y));
  }
  float feather = clamp(uFeather, 0.001, 1.0);
  return clamp(1.0 - smoothstep(1.0 - feather, 1.0, dist), 0.0, 1.0);
}

vec4 powerWindowFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float mask = powerWindowMask(vUv);
  if (uInvertMask > 0.5) {
    mask = 1.0 - mask;
  }
  mask = clamp(mask * uStrength, 0.0, 1.0);

  if (uShowMask > 0.5) {
    return vec4(vec3(mask), color.a);
  }

  vec3 corrected = color.rgb;
  corrected *= pow(vec3(2.0), vec3(uExposure));
  float temp = uTemperature / 100.0;
  corrected.r += temp * 0.1;
  corrected.b -= temp * 0.1;
  float ti = uTint / 100.0;
  corrected.g -= ti * 0.1;
  corrected.r += ti * 0.05;
  corrected.b += ti * 0.05;
  float sat = 1.0 + uSaturation / 100.0;
  float gray = luminance601(corrected);
  corrected = mix(vec3(gray), corrected, vec3(sat));

  return vec4(clamp(mix(color.rgb, corrected, vec3(mask)), vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{
			name: 'shape',
			label: 'Shape',
			type: 'select' as const,
			default: 'ellipse',
			options: [
				{ value: 'ellipse', label: 'Ellipse' },
				{ value: 'rectangle', label: 'Rectangle' }
			]
		},
		{
			name: 'centerX',
			label: 'Center X',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'centerY',
			label: 'Center Y',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'sizeX',
			label: 'Width',
			default: 0.5,
			min: 0.02,
			max: 1.5,
			step: 0.01
		},
		{
			name: 'sizeY',
			label: 'Height',
			default: 0.5,
			min: 0.02,
			max: 1.5,
			step: 0.01
		},
		{
			name: 'rotation',
			label: 'Rotation',
			default: 0,
			min: -180,
			max: 180,
			step: 1
		},
		{
			name: 'feather',
			label: 'Feather',
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'invertMask',
			label: 'Invert Mask',
			type: 'boolean' as const,
			default: false
		},
		{
			name: 'showMask',
			label: 'Show Mask',
			type: 'boolean' as const,
			default: false
		},
		{
			name: 'exposure',
			label: 'Exposure',
			default: 0.3,
			min: -3,
			max: 3,
			step: 0.05
		},
		{
			name: 'saturation',
			label: 'Saturation',
			default: 0,
			min: -100,
			max: 100,
			step: 1
		},
		{
			name: 'temperature',
			label: 'Temperature',
			default: 0,
			min: -100,
			max: 100,
			step: 1
		},
		{ name: 'tint', label: 'Tint', default: 0, min: -100, max: 100, step: 1 },
		{
			name: 'strength',
			label: 'Strength',
			default: 1,
			min: 0,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p, w, h) => ({
		uWindowKind: p.shape === 'rectangle' ? 1 : 0,
		uCenterX: readNumber(p, 'centerX', 0.5),
		uCenterY: readNumber(p, 'centerY', 0.5),
		uSizeX: readNumber(p, 'sizeX', 0.5),
		uSizeY: readNumber(p, 'sizeY', 0.5),
		uRotation: readNumber(p, 'rotation', 0),
		uFeather: readNumber(p, 'feather', 0.3),
		uInvertMask: p.invertMask === true ? 1 : 0,
		uShowMask: p.showMask === true ? 1 : 0,
		uExposure: readNumber(p, 'exposure', 0.3),
		uSaturation: readNumber(p, 'saturation', 0),
		uTemperature: readNumber(p, 'temperature', 0),
		uTint: readNumber(p, 'tint', 0),
		uStrength: readNumber(p, 'strength', 1),
		uWidth: w,
		uHeight: h
	})
};

// Built-in N-stop colormaps (hex stops, ordered dark -> light).
// Port of GRADIENT_MAP_PRESETS verbatim.
/** Named owner contract for the open colormap registry (string keys). */
export interface GradientPresetRegistry {
	[preset: string]: readonly string[];
}
export const GRADIENT_MAP_PRESETS: GradientPresetRegistry = {
	inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#f0f921'],
	magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
	plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
	viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
	turbo: ['#30123b', '#4675ed', '#1bcfd4', '#a4fc3b', '#fe9b2d', '#cb2a04', '#7a0403'],
	fire: ['#000000', '#7a0000', '#ff4800', '#ffd000', '#ffffff'],
	ice: ['#000010', '#003b6f', '#1b78c2', '#7ec8ff', '#ffffff'],
	sunset: ['#241634', '#c2456b', '#ffd9a0'],
	grayscale: ['#000000', '#ffffff']
};

/** Resolve a preset/custom selection to an ordered list of normalized RGB stops. */
function gradientMapStops(preset: string, customStops: string): [number, number, number][] {
	const hexes =
		preset === 'custom'
			? customStops
					.split(',')
					.map((s) => s.trim())
					.filter((s) => s.length > 0)
			: (GRADIENT_MAP_PRESETS[preset] ?? GRADIENT_MAP_PRESETS.inferno);
	if (!hexes)
		return [
			[0, 0, 0],
			[1, 1, 1]
		];
	const stops = hexes.map((h): [number, number, number] => {
		const rgb = parseHexColor(h, [0, 0, 0, 1]);
		return [rgb[0], rgb[1], rgb[2]];
	});
	if (stops.length === 0)
		return [
			[0, 0, 0],
			[1, 1, 1]
		];
	if (stops.length === 1) return [stops[0], stops[0]];
	return stops;
}

/** Build a 256x1 RGBA8 LUT by linearly interpolating the stops across luminance. */
function buildGradientMapLut(stops: [number, number, number][]): Uint8Array {
	const width = 256;
	const data = new Uint8Array(width * 4);
	const segments = stops.length - 1;
	for (let i = 0; i < width; i++) {
		const t = i / (width - 1);
		const scaled = t * segments;
		const idx = Math.min(Math.floor(scaled), segments - 1);
		const f = scaled - idx;
		const a = stops[idx];
		const b = stops[idx + 1];
		if (!a || !b) continue;
		data[i * 4] = Math.round((a[0] + (b[0] - a[0]) * f) * 255);
		data[i * 4 + 1] = Math.round((a[1] + (b[1] - a[1]) * f) * 255);
		data[i * 4 + 2] = Math.round((a[2] + (b[2] - a[2]) * f) * 255);
		data[i * 4 + 3] = 255;
	}
	return data;
}

const GRADIENT_MAP_DEFAULT_CUSTOM = GRADIENT_MAP_PRESETS.inferno!.join(', ');

/** Palette index → preset name for legacy numeric palette values. */
const GRADIENT_MAP_PALETTE_ORDER = [
	'inferno',
	'magma',
	'plasma',
	'viridis',
	'turbo',
	'fire',
	'ice',
	'sunset',
	'grayscale'
] as const;

function resolveGradientPreset(params: GpuParamValues): string {
	const preset = readString(params, 'preset', '');
	if (preset.length > 0) return preset;
	const legacyPalette = params.palette;
	if (typeof legacyPalette === 'number') {
		const idx = Math.round(legacyPalette);
		if (idx >= 0 && idx < GRADIENT_MAP_PALETTE_ORDER.length)
			return GRADIENT_MAP_PALETTE_ORDER[idx]!;
	}
	return 'inferno';
}

export const gradientMap: GpuShaderDefinition = {
	id: 'gpu-gradient-map',
	label: 'Gradient Map',
	category: 'color',
	entryPoint: 'gradientMapFragment',
	fragmentSource: /* glsl */ `
uniform sampler2D uGradientLut;
uniform float uMix;
vec4 gradientMapFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float lum = clamp(luminance601(color.rgb), 0.0, 1.0);
  vec3 mapped = textureLod(uGradientLut, vec2(lum, 0.5), 0.0).rgb;
  vec3 outRgb = mix(color.rgb, mapped, vec3(clamp(uMix, 0.0, 1.0)));
  return vec4(outRgb, color.a);
}`,
	schema: [
		{
			name: 'preset',
			label: 'Palette',
			type: 'select' as const,
			default: 'inferno',
			options: [
				{ value: 'inferno', label: 'Inferno' },
				{ value: 'magma', label: 'Magma' },
				{ value: 'plasma', label: 'Plasma' },
				{ value: 'viridis', label: 'Viridis' },
				{ value: 'turbo', label: 'Turbo' },
				{ value: 'fire', label: 'Fire' },
				{ value: 'ice', label: 'Ice' },
				{ value: 'sunset', label: 'Sunset' },
				{ value: 'grayscale', label: 'Grayscale' },
				{ value: 'custom', label: 'Custom' }
			]
		},
		{
			name: 'customStops',
			label: 'Custom Stops',
			type: 'text' as const,
			default: GRADIENT_MAP_DEFAULT_CUSTOM,
			visibleWhen: (params) => params.preset === 'custom'
		},
		{ name: 'mix', label: 'Mix', default: 1, min: 0, max: 1, step: 0.01 }
	],
	uniformValues: (p) => ({ uMix: readNumber(p, 'mix', 1) }),
	dataTexture: {
		key: (p) => {
			const preset = resolveGradientPreset(p);
			return preset === 'custom'
				? `custom:${readString(p, 'customStops', '')}`
				: `preset:${preset}`;
		},
		build: (p) => ({
			width: 256,
			height: 1,
			data: buildGradientMapLut(
				gradientMapStops(resolveGradientPreset(p), readString(p, 'customStops', ''))
			)
		})
	}
};
