/**
 * Keying GPU effects.
 *
 * Ported from FreeCut (MIT) — infrastructure/gpu-effects/effects/keying.ts —
 * WGSL fragment body translated to GLSL ES 3.00 with the mechanical rules in
 * ../shader-source.ts; math verbatim. FreeCut's keyColor select is resolved
 * to the green-screen default (the numeric param model carries no strings).
 */

import type { GpuShaderDefinition } from '../types';
import { readNumber } from '../types';

export const chromaKey: GpuShaderDefinition = {
	id: 'gpu-chroma-key',
	label: 'Chroma Key',
	category: 'keying',
	entryPoint: 'chromaKeyFragment',
	fragmentSource: /* glsl */ `
uniform float uKeyR;
uniform float uKeyG;
uniform float uKeyB;
uniform float uTolerance;
uniform float uSoftness;
uniform float uSpillSuppression;

vec3 rgb2ycbcr(vec3 rgb) {
  float y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  float cb = 0.564 * (rgb.b - y);
  float cr = 0.713 * (rgb.r - y);
  return vec3(y, cb, cr);
}

vec4 chromaKeyFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec3 keyColor = vec3(uKeyR, uKeyG, uKeyB);
  vec3 colorYCbCr = rgb2ycbcr(color.rgb);
  vec3 keyYCbCr = rgb2ycbcr(keyColor);
  float cbcrDist = length(colorYCbCr.yz - keyYCbCr.yz);
  float innerTolerance = uTolerance;
  float outerTolerance = uTolerance + uSoftness;
  float alpha = smoothstep(innerTolerance, outerTolerance, cbcrDist);
  vec3 finalColor = color.rgb;
  if (uSpillSuppression > 0.0) {
    if (uKeyG > uKeyR && uKeyG > uKeyB) {
      float spillAmount = max(0.0, finalColor.g - max(finalColor.r, finalColor.b)) * uSpillSuppression;
      finalColor.g -= spillAmount;
      finalColor.r += spillAmount * 0.5;
      finalColor.b += spillAmount * 0.5;
    } else if (uKeyB > uKeyR && uKeyB > uKeyG) {
      float spillAmount = max(0.0, finalColor.b - max(finalColor.r, finalColor.g)) * uSpillSuppression;
      finalColor.b -= spillAmount;
      finalColor.r += spillAmount * 0.5;
      finalColor.g += spillAmount * 0.5;
    }
  }
  return vec4(finalColor, color.a * alpha);
}`,
	schema: [
		{
			name: 'keyColor',
			label: 'Key Color',
			type: 'select' as const,
			default: 'green',
			options: [
				{ value: 'green', label: 'Green Screen' },
				{ value: 'blue', label: 'Blue Screen' }
			]
		},
		{
			name: 'tolerance',
			label: 'Tolerance',
			default: 0.2,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'softness',
			label: 'Edge Softness',
			default: 0.1,
			min: 0,
			max: 0.5,
			step: 0.01
		},
		{
			name: 'spillSuppression',
			label: 'Spill Suppression',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p) => {
		const isBlue = (p.keyColor as string) === 'blue';
		return {
			uKeyR: isBlue ? 0 : 0,
			uKeyG: isBlue ? 0 : 1,
			uKeyB: isBlue ? 1 : 0,
			uTolerance: readNumber(p, 'tolerance', 0.2),
			uSoftness: readNumber(p, 'softness', 0.1),
			uSpillSuppression: readNumber(p, 'spillSuppression', 0.5)
		};
	}
};
