/**
 * Stylize GPU effects.
 *
 * Ported from FreeCut (MIT) - infrastructure/gpu-effects/effects/stylize.ts -
 * WGSL fragment bodies translated to GLSL ES 3.00 with the mechanical rules in
 * ../shader-source.ts; math and structure verbatim. ASCII and Paper halftone
 * live in focused modules because they have a large typed control surface and
 * an auxiliary texture. HQ pixel sort uses an exact point-scatter vertex pass.
 */

import type { GpuShaderDefinition } from '../types';
import { parseHexColor, readNumber, readString } from '../types';

export const vignette: GpuShaderDefinition = {
	id: 'gpu-vignette',
	label: 'Vignette',
	category: 'stylize',
	entryPoint: 'vignetteFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uSize;
uniform float uSoftness;
uniform float uRoundness;
vec4 vignetteFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec2 center = vUv - 0.5;
  vec2 aspect = vec2(1.0, uRoundness);
  float dist = length(center * aspect) * 2.0;
  float vig = 1.0 - smoothstep(uSize, uSize + uSoftness, dist);
  vec3 vigColor = mix(vec3(0.0), color.rgb, vec3(mix(1.0, vig, uAmount)));
  return vec4(vigColor, color.a);
}`,
	schema: [
		{
			name: 'amount',
			label: 'Amount',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'size', label: 'Size', default: 0.5, min: 0, max: 1.5, step: 0.01 },
		{
			name: 'softness',
			label: 'Softness',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'roundness',
			label: 'Roundness',
			default: 1,
			min: 0.5,
			max: 2,
			step: 0.01
		}
	],
	uniformValues: (p) => ({
		uAmount: readNumber(p, 'amount', 0.5),
		uSize: readNumber(p, 'size', 0.5),
		uSoftness: readNumber(p, 'softness', 0.5),
		uRoundness: readNumber(p, 'roundness', 1)
	})
};

export const grain: GpuShaderDefinition = {
	id: 'gpu-grain',
	label: 'Film Grain',
	category: 'stylize',
	entryPoint: 'grainFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uSize;
uniform float uSpeed;
uniform float uTime;

float grainNoise(vec2 uv, float t) {
  vec2 seed = uv + vec2(t * 0.1, t * 0.07);
  return fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 grainFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec2 grainUV = vUv * (100.0 / uSize);
  // Wrap the time seed: the sin() inside grainNoise loses precision once the
  // unbounded (time * speed) term grows large, freezing the grain over long
  // sessions. The 600s period is imperceptible but keeps the seed bounded.
  float gt = uTime * uSpeed;
  float noise = grainNoise(grainUV, gt - floor(gt / 600.0) * 600.0) * 2.0 - 1.0;
  float luma = luminance(color.rgb);
  float grainIntensity = uAmount * (1.0 - luma * 0.5);
  vec3 grainColor = color.rgb + vec3(noise * grainIntensity);
  return vec4(clamp(grainColor, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{
			name: 'amount',
			label: 'Amount',
			default: 0.1,
			min: 0,
			max: 0.5,
			step: 0.01
		},
		{ name: 'size', label: 'Size', default: 1, min: 0.5, max: 5, step: 0.1 },
		{
			name: 'speed',
			label: 'Speed',
			default: 1,
			min: 0,
			max: 5,
			step: 0.1,
			animatable: false
		}
	],
	uniformValues: (p, _w, _h, time) => ({
		uAmount: readNumber(p, 'amount', 0.1),
		uSize: readNumber(p, 'size', 1),
		uSpeed: readNumber(p, 'speed', 1),
		uTime: time
	})
};

export const sharpen: GpuShaderDefinition = {
	id: 'gpu-sharpen',
	label: 'Sharpen',
	category: 'stylize',
	entryPoint: 'sharpenFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uRadius;
uniform float uWidth;
uniform float uHeight;
vec4 sharpenFragment(vec2 vUv) {
  vec2 texelSize = vec2(1.0 / uWidth, 1.0 / uHeight);
  vec4 center = texture(uInputTex, vUv);
  vec4 blur = vec4(0.0);
  float totalWeight = 0.0;
  int samples = 3;
  float sigma = uRadius * 0.5 + 0.5;
  for (int x = -samples; x <= samples; x++) {
    for (int y = -samples; y <= samples; y++) {
      vec2 offset = vec2(float(x), float(y)) * texelSize * uRadius;
      float distSq = float(x * x + y * y);
      float weight = exp(-distSq / (2.0 * sigma * sigma));
      blur += texture(uInputTex, vUv + offset) * weight;
      totalWeight += weight;
    }
  }
  blur /= totalWeight;
  vec3 sharpened = center.rgb + (center.rgb - blur.rgb) * uAmount;
  return vec4(clamp(sharpened, vec3(0.0), vec3(1.0)), center.a);
}`,
	schema: [
		{ name: 'amount', label: 'Amount', default: 1, min: 0, max: 5, step: 0.1 },
		{
			name: 'radius',
			label: 'Radius',
			default: 1,
			min: 0.5,
			max: 5,
			step: 0.1
		}
	],
	uniformValues: (p, w, h) => ({
		uAmount: readNumber(p, 'amount', 1),
		uRadius: readNumber(p, 'radius', 1),
		uWidth: w,
		uHeight: h
	})
};

export const posterize: GpuShaderDefinition = {
	id: 'gpu-posterize',
	label: 'Posterize',
	category: 'stylize',
	entryPoint: 'posterizeFragment',
	fragmentSource: /* glsl */ `
uniform float uLevels;
vec4 posterizeFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float levels = max(uLevels, 2.0);
  vec3 posterized = floor(color.rgb * levels) / (levels - 1.0);
  return vec4(posterized, color.a);
}`,
	schema: [{ name: 'levels', label: 'Levels', default: 6, min: 2, max: 32, step: 1 }],
	uniformValues: (p) => ({ uLevels: readNumber(p, 'levels', 6) })
};

export const glow: GpuShaderDefinition = {
	id: 'gpu-glow',
	label: 'Glow',
	category: 'stylize',
	entryPoint: 'glowFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uThreshold;
uniform float uRadius;
uniform float uSoftness;
uniform float uWidth;
uniform float uHeight;
uniform float uRings;
uniform float uSamplesPerRing;
vec4 glowFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  vec2 texelSize = vec2(1.0 / uWidth, 1.0 / uHeight);
  vec3 glowVal = vec3(0.0);
  float totalWeight = 0.0;
  int rings = int(clamp(uRings, 1.0, 32.0));
  int samplesPerRing = int(clamp(uSamplesPerRing, 4.0, 64.0));
  for (int ring = 1; ring <= rings; ring++) {
    float ringRadius = float(ring) * uRadius * texelSize.x * 10.0;
    float ringWeight = gaussian(float(ring) / float(rings), uSoftness + 0.3);
    for (int i = 0; i < samplesPerRing; i++) {
      float angle = float(i) * TAU / float(samplesPerRing) + float(ring) * 0.5;
      vec2 offset = vec2(cos(angle), sin(angle)) * ringRadius;
      vec4 sampleColor = texture(uInputTex, vUv + offset);
      float sampleLuma = luminance(sampleColor.rgb);
      float brightFactor = smoothstep(uThreshold - 0.1, uThreshold + 0.1, sampleLuma);
      vec3 brightColor = sampleColor.rgb * brightFactor;
      glowVal += brightColor * ringWeight;
      totalWeight += ringWeight;
    }
  }
  float centerLuma = luminance(color.rgb);
  float centerBright = smoothstep(uThreshold - 0.1, uThreshold + 0.1, centerLuma);
  glowVal += color.rgb * centerBright * 2.0;
  totalWeight += 2.0;
  glowVal /= totalWeight;
  vec3 result = color.rgb + glowVal * uAmount * 2.0;
  return vec4(clamp(result, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{ name: 'amount', label: 'Amount', default: 1, min: 0, max: 5, step: 0.1 },
		{
			name: 'threshold',
			label: 'Threshold',
			default: 0.6,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'radius', label: 'Radius', default: 20, min: 1, max: 100, step: 1 },
		{
			name: 'softness',
			label: 'Softness',
			default: 0.5,
			min: 0.1,
			max: 1,
			step: 0.05
		},
		{
			name: 'rings',
			label: 'Rings',
			default: 4,
			min: 1,
			max: 32,
			step: 1,
			animatable: false,
			quality: true
		},
		{
			name: 'samplesPerRing',
			label: 'Samples/Ring',
			default: 16,
			min: 4,
			max: 64,
			step: 1,
			animatable: false,
			quality: true
		}
	],
	uniformValues: (p, w, h) => ({
		uAmount: readNumber(p, 'amount', 1),
		uThreshold: readNumber(p, 'threshold', 0.6),
		uRadius: readNumber(p, 'radius', 20),
		uSoftness: readNumber(p, 'softness', 0.5),
		uWidth: w,
		uHeight: h,
		uRings: readNumber(p, 'rings', 4),
		uSamplesPerRing: readNumber(p, 'samplesPerRing', 16)
	})
};

export const edgeDetect: GpuShaderDefinition = {
	id: 'gpu-edge-detect',
	label: 'Edge Detect',
	category: 'stylize',
	entryPoint: 'edgeDetectFragment',
	fragmentSource: /* glsl */ `
uniform float uStrength;
uniform float uWidth;
uniform float uHeight;
uniform float uInvertFlag;
vec4 edgeDetectFragment(vec2 vUv) {
  vec2 texelSize = vec2(1.0 / uWidth, 1.0 / uHeight);
  float tl = luminance(texture(uInputTex, vUv + vec2(-texelSize.x, -texelSize.y)).rgb);
  float t  = luminance(texture(uInputTex, vUv + vec2(0.0, -texelSize.y)).rgb);
  float tr = luminance(texture(uInputTex, vUv + vec2(texelSize.x, -texelSize.y)).rgb);
  float l  = luminance(texture(uInputTex, vUv + vec2(-texelSize.x, 0.0)).rgb);
  float r  = luminance(texture(uInputTex, vUv + vec2(texelSize.x, 0.0)).rgb);
  float bl = luminance(texture(uInputTex, vUv + vec2(-texelSize.x, texelSize.y)).rgb);
  float b  = luminance(texture(uInputTex, vUv + vec2(0.0, texelSize.y)).rgb);
  float br = luminance(texture(uInputTex, vUv + vec2(texelSize.x, texelSize.y)).rgb);
  float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
  float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
  float edge = sqrt(gx*gx + gy*gy) * uStrength;
  edge = clamp(edge, 0.0, 1.0);
  if (uInvertFlag > 0.5) { edge = 1.0 - edge; }
  return vec4(vec3(edge), 1.0);
}`,
	schema: [
		{
			name: 'strength',
			label: 'Strength',
			default: 1,
			min: 0,
			max: 5,
			step: 0.1
		},
		{
			name: 'invert',
			label: 'Invert',
			type: 'boolean' as const,
			default: false
		}
	],
	uniformValues: (p, w, h) => ({
		uStrength: readNumber(p, 'strength', 1),
		uWidth: w,
		uHeight: h,
		uInvertFlag: p.invert === true ? 1 : 0
	})
};

export const scanlines: GpuShaderDefinition = {
	id: 'gpu-scanlines',
	label: 'Scanlines',
	category: 'stylize',
	entryPoint: 'scanlinesFragment',
	fragmentSource: /* glsl */ `
uniform float uDensity;
uniform float uOpacity;
uniform float uSpeed;
uniform float uTime;
vec4 scanlinesFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float scrollOffset = uTime * uSpeed * 0.1;
  float scanline = sin((vUv.y + scrollOffset) * uDensity * 100.0) * 0.5 + 0.5;
  float darken = 1.0 - uOpacity * (1.0 - scanline);
  return vec4(color.rgb * darken, color.a);
}`,
	schema: [
		{
			name: 'density',
			label: 'Density',
			default: 5,
			min: 1,
			max: 20,
			step: 0.5
		},
		{
			name: 'opacity',
			label: 'Opacity',
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'speed',
			label: 'Scroll Speed',
			default: 0,
			min: 0,
			max: 5,
			step: 0.1,
			animatable: false
		}
	],
	uniformValues: (p, _w, _h, time) => ({
		uDensity: readNumber(p, 'density', 5),
		uOpacity: readNumber(p, 'opacity', 0.3),
		uSpeed: readNumber(p, 'speed', 0),
		uTime: time
	})
};

export const colorGlitch: GpuShaderDefinition = {
	id: 'gpu-color-glitch',
	label: 'Color Glitch',
	category: 'stylize',
	entryPoint: 'colorGlitchFragment',
	fragmentSource: /* glsl */ `
uniform float uIntensity;
uniform float uSpeed;
uniform float uTime;
vec4 colorGlitchFragment(vec2 vUv) {
  vec2 uv = vUv;
  float amt = clamp(uIntensity, 0.0, 1.0);

  // Discrete time steps give the stuttering digital-glitch cadence and keep the
  // look readable even when playback is paused (the seed stays fixed per step).
  // The seed MUST be wrapped into a small range: the shared sin() hash loses all
  // precision with large inputs, so an unbounded (time * speed) seed collapses
  // bandNoise to a constant at higher speeds / long sessions and the effect looks
  // frozen. Wrapping keeps the seed usable at any speed.
  float rawStep = floor(uTime * uSpeed * 12.0);
  float t = rawStep - floor(rawStep / 64.0) * 64.0;

  // Tear the frame into horizontal bands; each band glitches independently.
  float band = floor(uv.y * 28.0);
  float bandNoise = hash(vec2(band, t));

  // More bands corrupt as intensity rises (full frame at intensity = 1).
  float glitchOn = step(1.0 - amt, bandNoise);

  // Per-band horizontal block displacement.
  float shift = (hash(vec2(band * 1.7, t + 3.0)) - 0.5) * 0.15 * amt * glitchOn;

  // RGB channel separation — the signature colour-glitch fringing, scaled so even
  // a single still frame reads clearly.
  float split = (0.004 + 0.02 * amt) * glitchOn;
  vec2 baseUv = vec2(uv.x + shift, uv.y);
  float r = texture(uInputTex, baseUv + vec2(split, 0.0)).r;
  float g = texture(uInputTex, baseUv).g;
  float b = texture(uInputTex, baseUv - vec2(split, 0.0)).b;
  float a = texture(uInputTex, baseUv).a;
  vec3 rgb = vec3(r, g, b);

  // Hard hue corruption on the strongest bands for the "colour" in colour glitch.
  float hueHit = step(0.82, bandNoise) * glitchOn;
  vec3 hsv = rgb2hsv(rgb);
  hsv.x = fract(hsv.x + hash(vec2(band, t + 7.0)));
  rgb = mix(rgb, hsv2rgb(hsv), vec3(hueHit));

  return vec4(rgb, a);
}`,
	schema: [
		{
			name: 'intensity',
			label: 'Intensity',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'speed',
			label: 'Speed',
			default: 1,
			min: 0.1,
			max: 5,
			step: 0.1,
			animatable: false
		}
	],
	uniformValues: (p, _w, _h, time) => ({
		uIntensity: readNumber(p, 'intensity', 0.5),
		uSpeed: readNumber(p, 'speed', 1),
		uTime: time
	})
};

export const blockGlitch: GpuShaderDefinition = {
	id: 'gpu-block-glitch',
	label: 'Block Glitch',
	category: 'stylize',
	entryPoint: 'blockGlitchFragment',
	fragmentSource: /* glsl */ `
uniform float uCoverage;
uniform float uIntensity;
uniform float uBlockSize;
uniform float uSpeed;
uniform float uTime;
uniform float uWidth;
uniform float uHeight;
vec4 blockGlitchFragment(vec2 vUv) {
  vec2 uv = vUv;
  float amt = clamp(uIntensity, 0.0, 1.0);
  float cov = clamp(uCoverage, 0.0, 1.0);

  // Discrete, wrapped time step — keeps the sin() hash seed in its precise range
  // so the glitch stays alive at any speed / session length.
  float rawStep = floor(uTime * uSpeed * 8.0);
  float t = rawStep - floor(rawStep / 64.0) * 64.0;

  // Block grid in pixels.
  float cell = max(uBlockSize, 2.0);
  float cols = max(uWidth / cell, 1.0);
  float rows = max(uHeight / cell, 1.0);
  vec2 block = vec2(floor(uv.x * cols), floor(uv.y * rows));

  // Per-block, per-step decision: does this block glitch?
  float r1 = hash(vec2(block.x + block.y * 3.0, t));
  float glitchOn = step(1.0 - cov, r1);

  // Block displacement: a horizontal datamosh slab plus a smaller vertical jump.
  float dispX = (hash(vec2(block.y, t + 5.0)) - 0.5) * 0.25 * amt * glitchOn;
  float vJump = step(0.6, hash(vec2(block.x + block.y, t + 13.0)));
  float dispY = (hash(vec2(block.x, t + 9.0)) - 0.5) * 0.06 * amt * glitchOn * vJump;
  vec2 srcUv = vec2(uv.x + dispX, uv.y + dispY);

  // RGB channel split on glitched blocks.
  float split = (0.01 + 0.03 * amt) * glitchOn;
  float rr = texture(uInputTex, srcUv + vec2(split, 0.0)).r;
  float gg = texture(uInputTex, srcUv).g;
  float bb = texture(uInputTex, srcUv - vec2(split, 0.0)).b;
  float aa = texture(uInputTex, srcUv).a;
  vec3 rgb = vec3(rr, gg, bb);

  // Digital corruption on a subset of glitched blocks: channel rotate / invert /
  // posterize. Sampling already done above, so this control flow is safe.
  float corrupt = step(0.7, hash(vec2(block.x * 1.3 + block.y, t + 21.0))) * glitchOn;
  float mode = hash(vec2(block.y * 2.1 + block.x, t + 27.0));
  vec3 c = rgb;
  if (mode < 0.34) {
    c = rgb.gbr;
  } else if (mode < 0.67) {
    c = vec3(1.0) - rgb;
  } else {
    c = floor(rgb * 4.0) / 4.0;
  }

  return vec4(mix(rgb, c, vec3(corrupt)), aa);
}`,
	schema: [
		{
			name: 'coverage',
			label: 'Coverage',
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'intensity',
			label: 'Intensity',
			default: 0.6,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'blockSize',
			label: 'Block Size',
			default: 40,
			min: 8,
			max: 200,
			step: 1
		},
		{
			name: 'speed',
			label: 'Speed',
			default: 1,
			min: 0.1,
			max: 5,
			step: 0.1,
			animatable: false
		}
	],
	uniformValues: (p, w, h, time) => ({
		uCoverage: readNumber(p, 'coverage', 0.3),
		uIntensity: readNumber(p, 'intensity', 0.6),
		uBlockSize: readNumber(p, 'blockSize', 40),
		uSpeed: readNumber(p, 'speed', 1),
		uTime: time,
		uWidth: w,
		uHeight: h
	})
};

export const crt: GpuShaderDefinition = {
	id: 'gpu-crt',
	label: 'CRT',
	category: 'stylize',
	entryPoint: 'crtFragment',
	fragmentSource: /* glsl */ `
uniform float uCurvature;
uniform float uScanlines;
uniform float uVignette;
uniform float uChroma;
vec4 crtFragment(vec2 vUv) {
  // Barrel-warp the sampling coordinate around the screen centre.
  float curveAmt = clamp(uCurvature, 0.0, 1.0) * 0.35;
  vec2 cc = vUv * 2.0 - 1.0;
  float r2 = dot(cc, cc);
  vec2 warped = cc * (1.0 + r2 * curveAmt);
  vec2 cuv = warped * 0.5 + 0.5;

  // Soft black border where the warped image leaves the tube.
  float edge = 0.004 + curveAmt * 0.02;
  float mask = smoothstep(0.0, edge, cuv.x) * smoothstep(0.0, edge, 1.0 - cuv.x)
             * smoothstep(0.0, edge, cuv.y) * smoothstep(0.0, edge, 1.0 - cuv.y);

  // Chromatic aberration that grows toward the edges.
  float ca = uChroma * 0.012 * r2;
  vec2 dir = normalize(cc + vec2(0.00001, 0.00001));
  float rC = texture(uInputTex, cuv + dir * ca).r;
  float gC = texture(uInputTex, cuv).g;
  float bC = texture(uInputTex, cuv - dir * ca).b;
  float aC = texture(uInputTex, cuv).a;
  vec3 rgb = vec3(rC, gC, bC);

  // Scanlines (resolution-independent line count).
  float sl = 0.5 + 0.5 * sin(cuv.y * 320.0 * PI);
  rgb = rgb * (1.0 - clamp(uScanlines, 0.0, 1.0) * (1.0 - sl));

  // Vignette toward the corners.
  rgb = rgb * (1.0 - clamp(uVignette, 0.0, 1.0) * smoothstep(0.35, 1.5, r2));

  return vec4(rgb * mask, aC);
}`,
	schema: [
		{
			name: 'curvature',
			label: 'Curvature',
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'scanlines',
			label: 'Scanlines',
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'vignette',
			label: 'Vignette',
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'chroma',
			label: 'Chroma',
			default: 0.4,
			min: 0,
			max: 2,
			step: 0.01
		}
	],
	uniformValues: (p) => ({
		uCurvature: readNumber(p, 'curvature', 0.3),
		uScanlines: readNumber(p, 'scanlines', 0.3),
		uVignette: readNumber(p, 'vignette', 0.3),
		uChroma: readNumber(p, 'chroma', 0.4)
	})
};

const DITHER_PATTERN_MAP = new Map([
	['bayer2', 0],
	['bayer4', 1],
	['bayer8', 2],
	['halftone', 3],
	['lines', 4],
	['crosses', 5],
	['dots', 6],
	['grid', 7],
	['scales', 8]
]);

const DITHER_MODE_MAP = new Map([
	['image', 0],
	['linear', 1],
	['radial', 2]
]);
const DITHER_STYLE_MAP = new Map([
	['threshold', 0],
	['scaled', 1]
]);
const DITHER_CELL_KIND = new Map([
	['circle', 0],
	['square', 1],
	['diamond', 2]
]);
const DITHER_PALETTE_MAP = new Map([
	['bw', 0],
	['gameboy', 1],
	['cga', 2],
	['sepia', 3]
]);

export const dither: GpuShaderDefinition = {
	id: 'gpu-dither',
	label: 'Dither',
	category: 'stylize',
	entryPoint: 'ditherFragment',
	fragmentSource: /* glsl */ `
uniform float uCellSize;
uniform float uAngleDeg;
uniform float uScalePercent;
uniform float uWidth;
uniform float uHeight;
uniform float uOffsetX;
uniform float uOffsetY;
uniform float uPatternKind;
uniform float uModeKind;
uniform float uStyleKind;
uniform float uCellKind;
uniform float uPaletteKind;

float bayer2Threshold(ivec2 cell) {
  int x = cell.x % 2;
  int y = cell.y % 2;
  float raw;
  if (y == 0) {
    raw = (x == 1) ? 2.0 : 0.0;
  } else {
    raw = (x == 1) ? 1.0 : 3.0;
  }
  return (raw + 0.5) / 4.0;
}

int bayer4Index(ivec2 cell) {
  int x = cell.x % 4;
  int y = cell.y % 4;
  if (y == 0) {
    if (x == 0) { return 0; }
    if (x == 1) { return 8; }
    if (x == 2) { return 2; }
    return 10;
  }
  if (y == 1) {
    if (x == 0) { return 12; }
    if (x == 1) { return 4; }
    if (x == 2) { return 14; }
    return 6;
  }
  if (y == 2) {
    if (x == 0) { return 3; }
    if (x == 1) { return 11; }
    if (x == 2) { return 1; }
    return 9;
  }
  if (x == 0) { return 15; }
  if (x == 1) { return 7; }
  if (x == 2) { return 13; }
  return 5;
}

float bayer4Threshold(ivec2 cell) {
  return (float(bayer4Index(cell)) + 0.5) / 16.0;
}

float bayer8Threshold(ivec2 cell) {
  int base = bayer4Index(ivec2(cell.x % 4, cell.y % 4));
  int quad = ((cell.x % 8) >= 4 ? 1 : 0) + ((cell.y % 8) >= 4 ? 2 : 0);
  int offset = quad > 0 ? (quad == 2 ? 2 : (quad == 3 ? 1 : 3)) : 0;
  int raw = 4 * base + offset;
  return (float(raw) + 0.5) / 64.0;
}

float patternThreshold(int patternKind, vec2 cell, float patternCellSize) {
  if (patternKind == 0) {
    return bayer2Threshold(ivec2(cell));
  }
  if (patternKind == 1) {
    return bayer4Threshold(ivec2(cell));
  }
  if (patternKind == 2) {
    return bayer8Threshold(ivec2(cell));
  }

  float safeCellSize = max(2.0, patternCellSize);
  float nx = fract(cell.x / safeCellSize);
  float ny = fract(cell.y / safeCellSize);
  float cx = 0.5;
  float cy = 0.5;

  if (patternKind == 3 || patternKind == 6) {
    float dx = nx - cx;
    float dy = ny - cy;
    return sqrt(dx * dx + dy * dy) * 1.41421356237;
  }
  if (patternKind == 4) {
    return ny;
  }
  if (patternKind == 5) {
    float distX = abs(nx - cx);
    float distY = abs(ny - cy);
    return min(distX, distY) * 2.0;
  }
  if (patternKind == 7) {
    float distX = abs(nx - cx);
    float distY = abs(ny - cy);
    return max(distX, distY) * 2.0;
  }
  if (patternKind == 8) {
    float sx = fract(nx * 2.0);
    float sy = fract(ny * 2.0);
    float dx = sx - 0.5;
    float dy = sy - 0.5;
    return sqrt(dx * dx + dy * dy) * 1.41421356237;
  }
  return 0.5;
}

int paletteLastIndex(int paletteKind) {
  if (paletteKind == 0) { return 1; }
  return 3;
}

int paletteIndex(float value, int paletteKind) {
  if (paletteKind == 0) {
    return value <= 0.5 ? 0 : 1;
  }
  if (value <= 0.25) { return 0; }
  if (value <= 0.5) { return 1; }
  if (value <= 0.75) { return 2; }
  return 3;
}

vec3 paletteColor(int paletteKind, int colorIndex) {
  if (paletteKind == 0) {
    if (colorIndex == 0) { return vec3(0.0, 0.0, 0.0); }
    return vec3(1.0, 1.0, 1.0);
  }
  if (paletteKind == 1) {
    if (colorIndex == 0) { return vec3(0.0588, 0.2196, 0.0588); }
    if (colorIndex == 1) { return vec3(0.1882, 0.3843, 0.1882); }
    if (colorIndex == 2) { return vec3(0.5451, 0.6745, 0.0588); }
    return vec3(0.6078, 0.7373, 0.0588);
  }
  if (paletteKind == 2) {
    if (colorIndex == 0) { return vec3(0.0, 0.0, 0.0); }
    if (colorIndex == 1) { return vec3(0.3333, 1.0, 1.0); }
    if (colorIndex == 2) { return vec3(1.0, 0.3333, 1.0); }
    return vec3(1.0, 1.0, 1.0);
  }
  if (colorIndex == 0) { return vec3(0.1686, 0.1137, 0.0549); }
  if (colorIndex == 1) { return vec3(0.4196, 0.2588, 0.1490); }
  if (colorIndex == 2) { return vec3(0.7686, 0.5843, 0.4157); }
  return vec3(0.9608, 0.9020, 0.7843);
}

ivec2 clampTexelCoord(ivec2 coord, ivec2 texSize) {
  return ivec2(
    clamp(coord.x, 0, max(texSize.x - 1, 0)),
    clamp(coord.y, 0, max(texSize.y - 1, 0))
  );
}

vec4 loadInputTexel(ivec2 coord, ivec2 texSize) {
  return texelFetch(uInputTex, clampTexelCoord(coord, texSize), 0);
}

float sampleCellBrightness(vec2 cell, float cellSize, ivec2 texSizeI) {
  vec2 sampleOffsets[4] = vec2[4](
    vec2(0.25, 0.25),
    vec2(0.75, 0.25),
    vec2(0.25, 0.75),
    vec2(0.75, 0.75)
  );
  float luminanceSum = 0.0;
  float alphaSum = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 sampleCoord = ivec2((cell + sampleOffsets[i]) * cellSize);
    vec4 sampleColor = loadInputTexel(sampleCoord, texSizeI);
    luminanceSum += luminance601(sampleColor.rgb) * sampleColor.a;
    alphaSum += sampleColor.a;
  }
  if (alphaSum <= 0.0001) {
    return 0.0;
  }
  return luminanceSum / alphaSum;
}

float applyMode(float brightness, vec2 cell, vec2 gridSize, int modeKind, float angleDeg, float scalePercent, float offsetX, float offsetY) {
  float adjusted = brightness;
  float nx = cell.x / max(gridSize.x, 1.0);
  float ny = cell.y / max(gridSize.y, 1.0);
  if (modeKind == 1) {
    float angleRad = angleDeg * PI / 180.0;
    float gradient = nx * cos(angleRad) + ny * sin(angleRad);
    adjusted = clamp(adjusted * 0.7 + gradient * 0.3, 0.0, 1.0);
  } else if (modeKind == 2) {
    float ox = offsetX / 100.0;
    float oy = offsetY / 100.0;
    float dx = nx - (0.5 + ox);
    float dy = ny - (0.5 + oy);
    float dist = length(vec2(dx, dy)) * (scalePercent / 100.0) * 2.0;
    adjusted = clamp(adjusted * 0.7 + dist * 0.3, 0.0, 1.0);
  }
  return adjusted;
}

float shapeMask(int shapeKind, vec2 localUv, float sizeFactor, float cellSize) {
  vec2 centered = abs(localUv - 0.5) * 2.0;
  float radius = clamp(sizeFactor, 0.0, 1.0);
  float aa = max(1.0 / max(cellSize, 1.0), 0.003);

  if (shapeKind == 0) {
    return 1.0 - smoothstep(radius, radius + aa, length(centered));
  }
  if (shapeKind == 2) {
    return 1.0 - smoothstep(radius, radius + aa, centered.x + centered.y);
  }
  return 1.0 - smoothstep(radius, radius + aa, max(centered.x, centered.y));
}

vec4 ditherFragment(vec2 vUv) {
  vec2 texSize = vec2(uWidth, uHeight);
  ivec2 texSizeI = ivec2(max(int(uWidth), 1), max(int(uHeight), 1));
  float cellSize = max(uCellSize, 1.0);
  vec2 pixelPos = vUv * texSize;
  vec4 base = loadInputTexel(ivec2(pixelPos), texSizeI);
  if (base.a <= 0.0001) {
    return vec4(0.0);
  }

  vec2 cell = floor(pixelPos / cellSize);
  vec2 localUv = fract(pixelPos / cellSize);
  vec2 gridSize = vec2(
    max(1.0, ceil(texSize.x / cellSize)),
    max(1.0, ceil(texSize.y / cellSize))
  );

  int modeKind = int(uModeKind + 0.5);
  int styleKind = int(uStyleKind + 0.5);
  int shapeKind = int(uCellKind + 0.5);
  int paletteKind = int(uPaletteKind + 0.5);
  int patternKind = int(uPatternKind + 0.5);

  float brightness = sampleCellBrightness(cell, cellSize, texSizeI);
  brightness = applyMode(
    brightness,
    cell,
    gridSize,
    modeKind,
    uAngleDeg,
    uScalePercent,
    uOffsetX,
    uOffsetY
  );

  float quantized = brightness;
  float sizeFactor = 1.0;
  if (styleKind == 1) {
    sizeFactor = 1.0 - brightness;
  } else {
    float threshold = patternThreshold(patternKind, cell, max(2.0, floor(cellSize * 0.5)));
    quantized = clamp(brightness + (threshold - 0.5) * 0.5, 0.0, 1.0);
  }

  int colorIndex = paletteIndex(quantized, paletteKind);
  vec3 background = paletteColor(paletteKind, paletteLastIndex(paletteKind));
  vec3 foreground = paletteColor(paletteKind, colorIndex);
  float mask = shapeMask(shapeKind, localUv, sizeFactor, cellSize);
  vec3 color = mix(background, foreground, vec3(mask));

  return vec4(color, base.a);
}`,
	schema: [
		{
			name: 'pattern',
			label: 'Pattern',
			type: 'select' as const,
			default: 'bayer4',
			options: [
				{ value: 'bayer2', label: 'Bayer 2x2' },
				{ value: 'bayer4', label: 'Bayer 4x4' },
				{ value: 'bayer8', label: 'Bayer 8x8' },
				{ value: 'halftone', label: 'Halftone' },
				{ value: 'lines', label: 'Lines' },
				{ value: 'crosses', label: 'Crosses' },
				{ value: 'dots', label: 'Dots' },
				{ value: 'grid', label: 'Grid' },
				{ value: 'scales', label: 'Scales' }
			]
		},
		{
			name: 'mode',
			label: 'Mode',
			type: 'select' as const,
			default: 'image',
			options: [
				{ value: 'image', label: 'Image' },
				{ value: 'linear', label: 'Linear' },
				{ value: 'radial', label: 'Radial' }
			]
		},
		{
			name: 'style',
			label: 'Style',
			type: 'select' as const,
			default: 'threshold',
			options: [
				{ value: 'threshold', label: 'Threshold' },
				{ value: 'scaled', label: 'Scaled' }
			]
		},
		{
			name: 'shape',
			label: 'Shape',
			type: 'select' as const,
			default: 'square',
			options: [
				{ value: 'circle', label: 'Circle' },
				{ value: 'square', label: 'Square' },
				{ value: 'diamond', label: 'Diamond' }
			]
		},
		{
			name: 'palette',
			label: 'Palette',
			type: 'select' as const,
			default: 'gameboy',
			options: [
				{ value: 'bw', label: 'B&W' },
				{ value: 'gameboy', label: 'Game Boy' },
				{ value: 'cga', label: 'CGA' },
				{ value: 'sepia', label: 'Sepia' }
			]
		},
		{
			name: 'cellSize',
			label: 'Cell Size',
			default: 8,
			min: 2,
			max: 32,
			step: 1
		},
		{
			name: 'angle',
			label: 'Angle',
			default: 45,
			min: 0,
			max: 360,
			step: 1,
			visibleWhen: (params) => params.mode === 'linear'
		},
		{
			name: 'scale',
			label: 'Scale',
			default: 100,
			min: 25,
			max: 200,
			step: 1,
			visibleWhen: (params) => params.mode === 'radial'
		},
		{
			name: 'offsetX',
			label: 'Offset X',
			default: 0,
			min: -100,
			max: 100,
			step: 1,
			visibleWhen: (params) => params.mode === 'radial'
		},
		{
			name: 'offsetY',
			label: 'Offset Y',
			default: 0,
			min: -100,
			max: 100,
			step: 1,
			visibleWhen: (params) => params.mode === 'radial'
		}
	],
	uniformValues: (p, w, h) => ({
		uCellSize: readNumber(p, 'cellSize', 8),
		uAngleDeg: readNumber(p, 'angle', 45),
		uScalePercent: readNumber(p, 'scale', 100),
		uWidth: w,
		uHeight: h,
		uOffsetX: readNumber(p, 'offsetX', 0),
		uOffsetY: readNumber(p, 'offsetY', 0),
		uPatternKind: DITHER_PATTERN_MAP.get(readString(p, 'pattern', 'bayer4')) ?? 1,
		uModeKind: DITHER_MODE_MAP.get(readString(p, 'mode', 'image')) ?? 0,
		uStyleKind: DITHER_STYLE_MAP.get(readString(p, 'style', 'threshold')) ?? 0,
		uCellKind: DITHER_CELL_KIND.get(readString(p, 'shape', 'square')) ?? 1,
		uPaletteKind: DITHER_PALETTE_MAP.get(readString(p, 'palette', 'gameboy')) ?? 1
	})
};

export const threshold: GpuShaderDefinition = {
	id: 'gpu-threshold',
	label: 'Threshold',
	category: 'stylize',
	entryPoint: 'thresholdFragment',
	fragmentSource: /* glsl */ `
uniform float uLevel;
vec4 thresholdFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  float luma = luminance(color.rgb);
  float result = luma > uLevel ? 1.0 : 0.0;
  return vec4(vec3(result), color.a);
}`,
	schema: [{ name: 'level', label: 'Level', default: 0.5, min: 0, max: 1, step: 0.01 }],
	uniformValues: (p) => ({ uLevel: readNumber(p, 'level', 0.5) })
};

export const vhs: GpuShaderDefinition = {
	id: 'gpu-vhs',
	label: 'VHS',
	category: 'stylize',
	entryPoint: 'vhsFragment',
	fragmentSource: /* glsl */ `
uniform float uBleed;
uniform float uWaviness;
uniform float uNoise;
uniform float uScanline;
uniform float uTime;
uniform float uWidth;
uniform float uHeight;
vec4 vhsFragment(vec2 vUv) {
  float t = uTime;
  vec2 uv = vUv;

  // horizontal tracking wobble (sin-based, stable at any phase)
  float wave = (sin(uv.y * 120.0 + t * 5.0) + sin(uv.y * 17.0 - t * 2.3)) * 0.5;
  uv.x = uv.x + wave * uWaviness * 0.015;

  // occasional tracking-band jump. Wrap every time-derived term before it feeds
  // hash() — the sin()-based hash collapses to a constant once the unbounded
  // (time * speed) seed grows large, killing the jumps over a session / at speed.
  float bandScroll = (t * 0.7) - floor((t * 0.7) / 64.0) * 64.0;
  float jumpStep = floor(t * 3.0) - floor(floor(t * 3.0) / 64.0) * 64.0;
  float bandId = floor(uv.y * 6.0 + bandScroll);
  float bandHit = step(0.92, hash(vec2(bandId, jumpStep)));
  uv.x = uv.x + bandHit * (hash(vec2(bandId, 7.0)) - 0.5) * 0.06;

  // chroma bleed (luma/chroma drift)
  float off = uBleed * 0.012;
  float r = texture(uInputTex, vec2(uv.x + off, uv.y)).r;
  float g = texture(uInputTex, uv).g;
  float b = texture(uInputTex, vec2(uv.x - off, uv.y)).b;
  float a = texture(uInputTex, uv).a;
  vec3 rgb = vec3(r, g, b);

  // scanlines
  float sl = 0.82 + 0.18 * sin(gl_FragCoord.y * PI);
  rgb = mix(rgb, rgb * sl, vec3(clamp(uScanline, 0.0, 1.0)));

  // tape noise — wrap the (unbounded) time addends so the per-pixel seed stays
  // bounded and the noise doesn't go static after ~30min of playback.
  float tnx = (t * 120.0) - floor((t * 120.0) / 512.0) * 512.0;
  float tny = (t * 60.0) - floor((t * 60.0) / 512.0) * 512.0;
  float n = hash(uv * vec2(uWidth, uHeight) * 0.5 + vec2(tnx, tny)) - 0.5;
  rgb = rgb + n * uNoise * 0.5;

  return vec4(clamp(rgb, vec3(0.0), vec3(1.0)), a);
}`,
	schema: [
		{
			name: 'bleed',
			label: 'Chroma Bleed',
			default: 0.4,
			min: 0,
			max: 2,
			step: 0.01
		},
		{
			name: 'waviness',
			label: 'Tracking',
			default: 0.3,
			min: 0,
			max: 2,
			step: 0.01
		},
		{
			name: 'noise',
			label: 'Tape Noise',
			default: 0.25,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'scanline',
			label: 'Scanlines',
			default: 0.35,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'speed',
			label: 'Speed',
			default: 1,
			min: 0,
			max: 4,
			step: 0.1,
			animatable: false
		}
	],
	uniformValues: (p, w, h, time) => ({
		uBleed: readNumber(p, 'bleed', 0.4),
		uWaviness: readNumber(p, 'waviness', 0.3),
		uNoise: readNumber(p, 'noise', 0.25),
		uScanline: readNumber(p, 'scanline', 0.35),
		uTime: time * readNumber(p, 'speed', 1),
		uWidth: w,
		uHeight: h
	})
};

export const ink: GpuShaderDefinition = {
	id: 'gpu-ink',
	label: 'Ink',
	category: 'stylize',
	entryPoint: 'inkFragment',
	// Pen-and-ink / cross-hatch stylization. Tonal shading is drawn with layers of
	// parallel hatch lines that fade in as the source darkens, plus a Sobel contour
	// pass for outlines — the whole frame is remapped onto a two-colour ink/paper
	// palette. Single fullscreen pass; deterministic (no time term).
	fragmentSource: /* glsl */ `
uniform float uStrength;
uniform float uSpacing;
uniform float uThickness;
uniform float uEdgeStrength;
uniform float uTone;
uniform float uWidth;
uniform float uHeight;
uniform float uInkR;
uniform float uInkG;
uniform float uInkB;
uniform float uPaperR;
uniform float uPaperG;
uniform float uPaperB;

// Coverage of a single hatch-line set at \`angle\`, in screen-space pixels.
// Returns 1 on a line, fading to 0 between lines (smoothstep gives spatial AA).
float inkHatch(vec2 p, float angle, float spacing, float thickness) {
  float s = sin(angle);
  float c = cos(angle);
  float coord = p.x * c - p.y * s;
  float m = coord - floor(coord / spacing) * spacing;
  float d = min(m, spacing - m);
  return 1.0 - smoothstep(thickness * 0.5, thickness * 0.5 + 1.0, d);
}

// A hatch layer that fades in as tone drops below \`hi\` (over a soft window) so
// the four tonal bands blend smoothly instead of popping on gradients.
float inkLayer(vec2 p, float angle, float spacing, float thickness, float lum, float hi) {
  float w = 1.0 - smoothstep(hi - 0.15, hi, lum);
  return inkHatch(p, angle, spacing, thickness) * w;
}

vec4 inkFragment(vec2 vUv) {
  vec4 src = texture(uInputTex, vUv);
  vec2 texel = vec2(1.0 / uWidth, 1.0 / uHeight);

  // Sobel magnitude -> contour outlines.
  float tl = luminance(texture(uInputTex, vUv + vec2(-texel.x, -texel.y)).rgb);
  float t  = luminance(texture(uInputTex, vUv + vec2(0.0, -texel.y)).rgb);
  float tr = luminance(texture(uInputTex, vUv + vec2(texel.x, -texel.y)).rgb);
  float l  = luminance(texture(uInputTex, vUv + vec2(-texel.x, 0.0)).rgb);
  float r  = luminance(texture(uInputTex, vUv + vec2(texel.x, 0.0)).rgb);
  float bl = luminance(texture(uInputTex, vUv + vec2(-texel.x, texel.y)).rgb);
  float b  = luminance(texture(uInputTex, vUv + vec2(0.0, texel.y)).rgb);
  float br = luminance(texture(uInputTex, vUv + vec2(texel.x, texel.y)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float edge = clamp(sqrt(gx * gx + gy * gy) * uEdgeStrength, 0.0, 1.0);

  float lum = clamp(luminance(src.rgb) * uTone, 0.0, 1.0);
  vec2 p = vUv * vec2(uWidth, uHeight);
  float sp = max(uSpacing, 1.0);
  float th = uThickness;

  float hatch = 0.0;
  hatch = max(hatch, inkLayer(p, 0.7854, sp, th, lum, 0.85));   // 45°
  hatch = max(hatch, inkLayer(p, -0.7854, sp, th, lum, 0.65));  // -45°
  hatch = max(hatch, inkLayer(p, 0.0, sp, th, lum, 0.45));      // horizontal
  hatch = max(hatch, inkLayer(p, 1.5708, sp, th, lum, 0.25));   // vertical

  float inkAmt = clamp(max(hatch, edge) * uStrength, 0.0, 1.0);
  vec3 paper = vec3(uPaperR, uPaperG, uPaperB);
  vec3 inkColor = vec3(uInkR, uInkG, uInkB);
  return vec4(mix(paper, inkColor, vec3(inkAmt)), src.a);
}`,
	schema: [
		{
			name: 'strength',
			label: 'Ink Amount',
			default: 1,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'spacing',
			label: 'Line Spacing',
			default: 6,
			min: 2,
			max: 24,
			step: 0.5
		},
		{
			name: 'thickness',
			label: 'Line Width',
			default: 1.2,
			min: 0.5,
			max: 4,
			step: 0.1
		},
		{
			name: 'edgeStrength',
			label: 'Outline',
			default: 1.5,
			min: 0,
			max: 5,
			step: 0.1
		},
		{
			name: 'tone',
			label: 'Shading',
			default: 1,
			min: 0.2,
			max: 2.5,
			step: 0.05
		},
		{
			name: 'inkColor',
			label: 'Ink',
			type: 'color' as const,
			default: '#141414'
		},
		{
			name: 'paperColor',
			label: 'Paper',
			type: 'color' as const,
			default: '#f4f1e8'
		}
	],
	uniformValues: (p, w, h) => {
		const ink = parseHexColor(readString(p, 'inkColor', '#141414'), [0.08, 0.08, 0.08, 1]);
		const paper = parseHexColor(readString(p, 'paperColor', '#f4f1e8'), [0.96, 0.95, 0.91, 1]);
		return {
			uStrength: readNumber(p, 'strength', 1),
			uSpacing: readNumber(p, 'spacing', 6),
			uThickness: readNumber(p, 'thickness', 1.2),
			uEdgeStrength: readNumber(p, 'edgeStrength', 1.5),
			uTone: readNumber(p, 'tone', 1),
			uWidth: w,
			uHeight: h,
			uInkR: ink[0],
			uInkG: ink[1],
			uInkB: ink[2],
			uPaperR: paper[0],
			uPaperG: paper[1],
			uPaperB: paper[2]
		};
	}
};

export const pixelSort: GpuShaderDefinition = {
	id: 'gpu-pixel-sort',
	label: 'Pixel Sort (Streak)',
	category: 'stylize',
	entryPoint: 'pixelSortFragment',
	// Pixel sort (streak approximation). A true comparison sort needs a compute
	// shader or O(width) ping-pong passes, which this single-pass fragment pipeline
	// can't express — so each pixel inside the brightness mask instead adopts the
	// most-extreme key found by scanning up to \`length\` pixels along the sort
	// direction, stopping at the span boundary (first pixel outside the mask). This
	// bounded, mask-gated directional max/min filter yields the signature melting /
	// sorted streaks. The loop uses textureLod (not texture) because
	// data-dependent control flow forbids implicit-derivative sampling.
	fragmentSource: /* glsl */ `
uniform float uDirX;
uniform float uDirY;
uniform float uLow;
uniform float uHigh;
uniform float uLength;
uniform float uOrder;
uniform float uWidth;
uniform float uHeight;

// Statically-bounded scan cap keeps the loop compilable and its cost bounded;
// the animatable \`length\` param clamps the effective steps below this ceiling.
const int PS_MAX_STEPS = 512;

// Sort key: carry the brightest value (order>0.5) or the darkest (order<=0.5).
float psKey(float lum, float order) {
  return order > 0.5 ? lum : -lum;
}

vec4 pixelSortFragment(vec2 vUv) {
  vec4 src = texture(uInputTex, vUv);
  float lum0 = luminance(src.rgb);

  // Pixels outside the brightness band are left untouched — only masked spans
  // are sorted (the classic pixel-sort threshold behaviour).
  if (lum0 < uLow || lum0 > uHigh) {
    return src;
  }

  vec2 texel = vec2(1.0 / uWidth, 1.0 / uHeight);
  vec2 stepUv = vec2(uDirX, uDirY) * texel;
  int maxN = int(clamp(uLength, 1.0, float(PS_MAX_STEPS)));

  float bestKey = psKey(lum0, uOrder);
  vec3 bestColor = src.rgb;

  for (int i = 1; i <= PS_MAX_STEPS; i++) {
    if (i > maxN) { break; }
    vec2 uv = vUv + stepUv * float(i);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
    vec4 s = textureLod(uInputTex, uv, 0.0);
    float l = luminance(s.rgb);
    if (l < uLow || l > uHigh) { break; } // span boundary
    float k = psKey(l, uOrder);
    if (k > bestKey) {
      bestKey = k;
      bestColor = s.rgb;
    }
  }
  return vec4(bestColor, src.a);
}`,
	schema: [
		{
			name: 'direction',
			label: 'Direction',
			type: 'select',
			default: 'right',
			options: [
				{ value: 'right', label: 'Right' },
				{ value: 'left', label: 'Left' },
				{ value: 'down', label: 'Down' },
				{ value: 'up', label: 'Up' }
			]
		},
		{
			name: 'order',
			label: 'Carry',
			type: 'select',
			default: 'bright',
			options: [
				{ value: 'bright', label: 'Bright streaks' },
				{ value: 'dark', label: 'Dark streaks' }
			]
		},
		{
			name: 'low',
			label: 'Threshold Low',
			default: 0.25,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'high',
			label: 'Threshold High',
			default: 1,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'length',
			label: 'Length',
			default: 60,
			min: 2,
			max: 400,
			step: 1,
			animatable: false,
			quality: true
		}
	],
	uniformValues: (p, w, h) => {
		let dirX = 1;
		let dirY = 0;
		if (p.direction === 'left') dirX = -1;
		else if (p.direction === 'down') {
			dirX = 0;
			dirY = 1;
		} else if (p.direction === 'up') {
			dirX = 0;
			dirY = -1;
		}
		return {
			uDirX: dirX,
			uDirY: dirY,
			uLow: readNumber(p, 'low', 0.25),
			uHigh: readNumber(p, 'high', 1),
			uLength: readNumber(p, 'length', 60),
			uOrder: p.order === 'dark' ? 0 : 1,
			uWidth: w,
			uHeight: h
		};
	}
};

/**
 * Exact FreeCut pixel sort. WebGL2 point rasterization supplies the scatter
 * write that a fragment pass cannot express: one vertex handles each input
 * texel, computes its unique sorted rank, and places a one-pixel point at the
 * destination. Its span/rank math is a mechanical port of FreeCut's WGSL
 * compute shader and keeps the same O(span) work per input pixel.
 */
export const pixelSortHq: GpuShaderDefinition = {
	id: 'gpu-pixel-sort-hq',
	label: 'Pixel Sort',
	category: 'stylize',
	entryPoint: 'pixelSortHqFragment',
	fragmentSource: /* glsl */ `
uniform float uLow;
uniform float uHigh;
uniform float uVertical;
uniform float uDescending;
uniform float uWidth;
uniform float uHeight;
vec4 pixelSortHqFragment(vec2 vUv) {
  return texture(uInputTex, vUv);
}`,
	scatterEntryPoint: 'pixelSortHqScatter',
	scatterVertexSource: /* glsl */ `
uniform float uLow;
uniform float uHigh;
uniform float uVertical;
uniform float uDescending;
uniform float uWidth;
uniform float uHeight;

float pixelSortHqLuminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

bool pixelSortHqInBand(float value) {
  return value >= uLow && value <= uHigh;
}

float pixelSortHqLumAt(int index, int perpendicular, bool vertical) {
  int height = max(1, int(uHeight + 0.5));
  ivec2 coordinate = vertical
    ? ivec2(perpendicular, height - 1 - index)
    : ivec2(index, perpendicular);
  return pixelSortHqLuminance(texelFetch(uInputTex, coordinate, 0).rgb);
}

vec4 pixelSortHqScatter(int vertexId, out ivec2 destination) {
  int width = max(1, int(uWidth + 0.5));
  int height = max(1, int(uHeight + 0.5));
  int x = vertexId % width;
  int y = vertexId / width;
  int topY = height - 1 - y;
  ivec2 sourceCoordinate = ivec2(x, y);
  vec4 sourceColor = texelFetch(uInputTex, sourceCoordinate, 0);
  float sourceLum = pixelSortHqLuminance(sourceColor.rgb);

  destination = sourceCoordinate;
  if (!pixelSortHqInBand(sourceLum)) {
    return sourceColor;
  }

  bool vertical = uVertical > 0.5;
  int axisLength = vertical ? height : width;
  int perpendicular = vertical ? x : y;
  int position = vertical ? topY : x;

  int spanStart = position;
  while (spanStart > 0) {
    if (!pixelSortHqInBand(pixelSortHqLumAt(spanStart - 1, perpendicular, vertical))) break;
    spanStart--;
  }

  int spanEnd = position;
  while (spanEnd < axisLength - 1) {
    if (!pixelSortHqInBand(pixelSortHqLumAt(spanEnd + 1, perpendicular, vertical))) break;
    spanEnd++;
  }

  int rank = 0;
  for (int index = spanStart; index <= spanEnd; index++) {
    if (index == position) continue;
    float candidateLum = pixelSortHqLumAt(index, perpendicular, vertical);
    if (candidateLum < sourceLum || (candidateLum == sourceLum && index < position)) rank++;
  }

  int destinationIndex = uDescending > 0.5 ? spanEnd - rank : spanStart + rank;
  destination = vertical
    ? ivec2(perpendicular, height - 1 - destinationIndex)
    : ivec2(destinationIndex, perpendicular);
  return sourceColor;
}`,
	schema: [
		{
			name: 'orientation',
			label: 'Orientation',
			type: 'select',
			default: 'horizontal',
			options: [
				{ value: 'horizontal', label: 'Horizontal' },
				{ value: 'vertical', label: 'Vertical' }
			]
		},
		{
			name: 'order',
			label: 'Order',
			type: 'select',
			default: 'ascending',
			options: [
				{ value: 'ascending', label: 'Dark to Bright' },
				{ value: 'descending', label: 'Bright to Dark' }
			]
		},
		{
			name: 'low',
			label: 'Threshold Low',
			default: 0.25,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'high',
			label: 'Threshold High',
			default: 0.9,
			min: 0,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p, w, h) => ({
		uLow: readNumber(p, 'low', 0.25),
		uHigh: readNumber(p, 'high', 0.9),
		uVertical: p.orientation === 'vertical' ? 1 : 0,
		uDescending: p.order === 'descending' ? 1 : 0,
		uWidth: w,
		uHeight: h
	})
};
