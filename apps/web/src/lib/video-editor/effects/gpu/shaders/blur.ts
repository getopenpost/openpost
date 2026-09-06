/**
 * Blur GPU effects.
 *
 * Ported from FreeCut (MIT) — infrastructure/gpu-effects/effects/blur.ts —
 * WGSL fragment bodies translated to GLSL ES 3.00 with the mechanical rules in
 * ../shader-source.ts; math and structure verbatim.
 */

import type { GpuShaderDefinition } from '../types';
import { readNumber } from '../types';

export const gaussianBlur: GpuShaderDefinition = {
	id: 'gpu-gaussian-blur',
	label: 'Gaussian Blur',
	category: 'blur',
	entryPoint: 'gaussianBlurFragment',
	fragmentSource: /* glsl */ `
uniform float uRadius;
uniform float uWidth;
uniform float uHeight;
uniform float uSamples;
vec4 gaussianBlurFragment(vec2 vUv) {
  if (uRadius < 0.5) {
    return texture(uInputTex, vUv);
  }
  vec2 texelSize = vec2(1.0 / uWidth, 1.0 / uHeight);
  int sampleRadius = int(clamp(uSamples, 1.0, 64.0));
  vec4 color = vec4(0.0);
  float totalWeight = 0.0;
  float sigma = uRadius / 3.0;
  float twoSigmaSq = 2.0 * sigma * sigma;
  for (int x = -sampleRadius; x <= sampleRadius; x++) {
    for (int y = -sampleRadius; y <= sampleRadius; y++) {
      vec2 offset = vec2(float(x), float(y)) * texelSize * (uRadius / float(sampleRadius));
      float distSq = float(x * x + y * y);
      float weight = exp(-distSq / twoSigmaSq);
      color += texture(uInputTex, vUv + offset) * weight;
      totalWeight += weight;
    }
  }
  return color / totalWeight;
}`,
	schema: [
		{ name: 'radius', label: 'Radius', default: 10, min: 0, max: 50, step: 1 },
		{
			name: 'samples',
			label: 'Samples',
			default: 5,
			min: 1,
			max: 64,
			step: 1,
			animatable: false,
			quality: true
		}
	],
	uniformValues: (p, w, h) => ({
		uRadius: readNumber(p, 'radius', 10),
		uWidth: w,
		uHeight: h,
		uSamples: readNumber(p, 'samples', 5)
	})
};

export const boxBlur: GpuShaderDefinition = {
	id: 'gpu-box-blur',
	label: 'Box Blur',
	category: 'blur',
	entryPoint: 'boxBlurFragment',
	fragmentSource: /* glsl */ `
uniform float uRadius;
uniform float uWidth;
uniform float uHeight;
vec4 boxBlurFragment(vec2 vUv) {
  if (uRadius < 0.5) {
    return texture(uInputTex, vUv);
  }
  vec2 texelSize = vec2(1.0 / uWidth, 1.0 / uHeight);
  int samples = int(uRadius);
  vec4 color = vec4(0.0);
  float count = 0.0;
  for (int x = -samples; x <= samples; x++) {
    for (int y = -samples; y <= samples; y++) {
      vec2 offset = vec2(float(x), float(y)) * texelSize;
      color += texture(uInputTex, vUv + offset);
      count += 1.0;
    }
  }
  return color / count;
}`,
	schema: [{ name: 'radius', label: 'Radius', default: 5, min: 0, max: 20, step: 1 }],
	uniformValues: (p, w, h) => ({
		uRadius: readNumber(p, 'radius', 5),
		uWidth: w,
		uHeight: h
	})
};

export const motionBlur: GpuShaderDefinition = {
	id: 'gpu-motion-blur',
	label: 'Motion Blur',
	category: 'blur',
	entryPoint: 'motionBlurFragment',
	// Two vec4-aligned rows in FreeCut's std140 layout. The second row carries
	// the hard radius bound so corrupted/legacy project values cannot turn one
	// layer into an unbounded full-frame texture walk.
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uAngle;
uniform float uShutterAngle;
uniform float uSamples;
uniform float uMaxRadius;
vec4 motionBlurFragment(vec2 vUv) {
  float exposure = clamp(uShutterAngle / 360.0, 0.0, 1.0);
  float radius = min(max(uAmount, 0.0) * exposure, uMaxRadius);
  if (radius < 0.001 || exposure < 0.001) {
    return texture(uInputTex, vUv);
  }
  vec2 direction = vec2(cos(uAngle), sin(uAngle));
  // Quality is deliberately bounded: shutter blur is on a per-layer hot path.
  int samples = int(clamp(uSamples, 4.0, 32.0));
  vec4 color = vec4(0.0);
  float totalWeight = 0.0;
  for (int i = 0; i < samples; i++) {
    float t = (float(i) / float(samples - 1) - 0.5) * 2.0;
    vec2 offset = direction * t * radius;
    float weight = exp(-t * t * 2.0);
    color += texture(uInputTex, vUv + offset) * weight;
    totalWeight += weight;
  }
  return color / totalWeight;
}`,
	schema: [
		{ name: 'amount', label: 'Amount', default: 0.05, min: 0, max: 0.3, step: 0.005 },
		{ name: 'angle', label: 'Angle', default: 0, min: 0, max: 6.28318, step: 0.01 },
		{
			name: 'samples',
			label: 'Samples',
			default: 16,
			min: 4,
			max: 32,
			step: 1,
			animatable: false,
			quality: true
		},
		{ name: 'shutterAngle', label: 'Shutter Angle', default: 180, min: 0, max: 360, step: 1 }
	],
	uniformValues: (p) => ({
		uAmount: readNumber(p, 'amount', 0.05),
		uAngle: readNumber(p, 'angle', 0),
		// Existing effect instances have legacy params but no shutterAngle;
		// a truly empty params object is the registry's "use defaults" probe.
		uShutterAngle: Object.keys(p).length > 0 ? readNumber(p, 'shutterAngle', 360) : 180,
		uSamples: readNumber(p, 'samples', 16),
		uMaxRadius: 0.2
	})
};

export const radialBlur: GpuShaderDefinition = {
	id: 'gpu-radial-blur',
	label: 'Radial Blur',
	category: 'blur',
	entryPoint: 'radialBlurFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uCenterX;
uniform float uCenterY;
uniform float uSamples;
vec4 radialBlurFragment(vec2 vUv) {
  vec2 center = vec2(uCenterX, uCenterY);
  vec2 dir = vUv - center;
  float dist = length(dir);
  if (uAmount < 0.01) {
    return texture(uInputTex, vUv);
  }
  vec4 color = vec4(0.0);
  int samples = int(clamp(uSamples, 4.0, 256.0));
  float amount = uAmount * 0.2;
  float totalWeight = 0.0;
  for (int i = 0; i < samples; i++) {
    float t = float(i) / float(samples - 1);
    float scale = 1.0 - amount * t * dist;
    float weight = 1.0 - t * 0.5;
    vec2 samplePos = center + dir * scale;
    color += texture(uInputTex, samplePos) * weight;
    totalWeight += weight;
  }
  return color / totalWeight;
}`,
	schema: [
		{ name: 'amount', label: 'Amount', default: 0.5, min: 0, max: 2, step: 0.01 },
		{ name: 'centerX', label: 'Center X', default: 0.5, min: 0, max: 1, step: 0.01 },
		{ name: 'centerY', label: 'Center Y', default: 0.5, min: 0, max: 1, step: 0.01 },
		{
			name: 'samples',
			label: 'Samples',
			default: 32,
			min: 4,
			max: 256,
			step: 1,
			animatable: false,
			quality: true
		}
	],
	uniformValues: (p) => ({
		uAmount: readNumber(p, 'amount', 0.5),
		uCenterX: readNumber(p, 'centerX', 0.5),
		uCenterY: readNumber(p, 'centerY', 0.5),
		uSamples: readNumber(p, 'samples', 32)
	})
};

export const zoomBlur: GpuShaderDefinition = {
	id: 'gpu-zoom-blur',
	label: 'Zoom Blur',
	category: 'blur',
	entryPoint: 'zoomBlurFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uCenterX;
uniform float uCenterY;
uniform float uSamples;
vec4 zoomBlurFragment(vec2 vUv) {
  vec2 center = vec2(uCenterX, uCenterY);
  vec2 dir = vUv - center;
  vec4 color = vec4(0.0);
  int samples = int(clamp(uSamples, 4.0, 256.0));
  float amount = uAmount * 0.5;
  for (int i = 0; i < samples; i++) {
    float t = float(i) / float(samples - 1);
    float scale = 1.0 + amount * t;
    vec2 samplePos = center + dir * scale;
    color += texture(uInputTex, samplePos);
  }
  return color / float(samples);
}`,
	schema: [
		{ name: 'amount', label: 'Amount', default: 0.3, min: 0, max: 1, step: 0.01 },
		{ name: 'centerX', label: 'Center X', default: 0.5, min: 0, max: 1, step: 0.01 },
		{ name: 'centerY', label: 'Center Y', default: 0.5, min: 0, max: 1, step: 0.01 },
		{
			name: 'samples',
			label: 'Samples',
			default: 16,
			min: 4,
			max: 256,
			step: 1,
			animatable: false,
			quality: true
		}
	],
	uniformValues: (p) => ({
		uAmount: readNumber(p, 'amount', 0.3),
		uCenterX: readNumber(p, 'centerX', 0.5),
		uCenterY: readNumber(p, 'centerY', 0.5),
		uSamples: readNumber(p, 'samples', 16)
	})
};
