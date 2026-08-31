/**
 * Distort GPU effects.
 *
 * Ported from FreeCut (MIT) — infrastructure/gpu-effects/effects/distort.ts —
 * WGSL fragment bodies translated to GLSL ES 3.00 with the mechanical rules in
 * ../shader-source.ts; math and structure verbatim. FreeCut's vec4 settings
 * blocks and select/color params are flattened to individual float uniforms
 * resolved in `uniformValues` (selects resolve to their defaults).
 */

import type { GpuShaderDefinition } from '../types';
import { parseHexColor, readNumber, readString } from '../types';

export const pixelate: GpuShaderDefinition = {
	id: 'gpu-pixelate',
	label: 'Pixelate',
	category: 'distort',
	entryPoint: 'pixelateFragment',
	fragmentSource: /* glsl */ `
uniform float uPixelSize;
uniform float uWidth;
uniform float uHeight;
vec4 pixelateFragment(vec2 vUv) {
  float pixelX = uPixelSize / uWidth;
  float pixelY = uPixelSize / uHeight;
  vec2 uv = vec2(
    floor(vUv.x / pixelX) * pixelX + pixelX * 0.5,
    floor(vUv.y / pixelY) * pixelY + pixelY * 0.5
  );
  return texture(uInputTex, uv);
}`,
	schema: [{ name: 'size', label: 'Pixel Size', default: 8, min: 1, max: 64, step: 1 }],
	uniformValues: (p, w, h) => ({
		uPixelSize: readNumber(p, 'size', 8),
		uWidth: w,
		uHeight: h
	})
};

export const rgbSplit: GpuShaderDefinition = {
	id: 'gpu-rgb-split',
	label: 'RGB Split',
	category: 'distort',
	entryPoint: 'rgbSplitFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uAngle;
vec4 rgbSplitFragment(vec2 vUv) {
  vec2 offset = vec2(cos(uAngle), sin(uAngle)) * uAmount;
  float r = texture(uInputTex, vUv + offset).r;
  float g = texture(uInputTex, vUv).g;
  float b = texture(uInputTex, vUv - offset).b;
  float a = texture(uInputTex, vUv).a;
  return vec4(r, g, b, a);
}`,
	schema: [
		{
			name: 'amount',
			label: 'Amount',
			default: 0.01,
			min: 0,
			max: 0.1,
			step: 0.001
		},
		{
			name: 'angle',
			label: 'Angle',
			default: 0,
			min: 0,
			max: 6.28318,
			step: 0.01
		}
	],
	uniformValues: (p) => ({
		uAmount: readNumber(p, 'amount', 0.01),
		uAngle: readNumber(p, 'angle', 0)
	})
};

export const twirl: GpuShaderDefinition = {
	id: 'gpu-twirl',
	label: 'Twirl',
	category: 'distort',
	entryPoint: 'twirlFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uRadius;
uniform float uCenterX;
uniform float uCenterY;
vec4 twirlFragment(vec2 vUv) {
  vec2 center = vec2(uCenterX, uCenterY);
  vec2 delta = vUv - center;
  float dist = length(delta);
  float safeRadius = max(uRadius, 0.0001);
  float factor = 1.0 - min(dist / safeRadius, 1.0);
  float angle = uAmount * factor * factor;
  float s = sin(angle);
  float c = cos(angle);
  vec2 rotated = vec2(delta.x * c - delta.y * s, delta.x * s + delta.y * c);
  vec2 twirledUV = center + rotated;
  bool inRadius = dist < uRadius;
  vec2 finalUV = inRadius ? twirledUV : vUv;
  return texture(uInputTex, finalUV);
}`,
	schema: [
		{
			name: 'amount',
			label: 'Amount',
			default: 1,
			min: -10,
			max: 10,
			step: 0.1
		},
		{
			name: 'radius',
			label: 'Radius',
			default: 0.5,
			min: 0.1,
			max: 1,
			step: 0.01
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
		}
	],
	uniformValues: (p) => ({
		uAmount: readNumber(p, 'amount', 1),
		uRadius: readNumber(p, 'radius', 0.5),
		uCenterX: readNumber(p, 'centerX', 0.5),
		uCenterY: readNumber(p, 'centerY', 0.5)
	})
};

export const wave: GpuShaderDefinition = {
	id: 'gpu-wave',
	label: 'Wave',
	category: 'distort',
	entryPoint: 'waveFragment',
	fragmentSource: /* glsl */ `
uniform float uAmplitudeX;
uniform float uAmplitudeY;
uniform float uFrequencyX;
uniform float uFrequencyY;
vec4 waveFragment(vec2 vUv) {
  vec2 uv = vUv;
  uv.y += sin(uv.x * uFrequencyX * TAU) * uAmplitudeX;
  uv.x += sin(uv.y * uFrequencyY * TAU) * uAmplitudeY;
  return texture(uInputTex, uv);
}`,
	schema: [
		{
			name: 'amplitudeX',
			label: 'Horizontal Amp',
			default: 0.02,
			min: 0,
			max: 0.1,
			step: 0.001
		},
		{
			name: 'amplitudeY',
			label: 'Vertical Amp',
			default: 0.02,
			min: 0,
			max: 0.1,
			step: 0.001
		},
		{
			name: 'frequencyX',
			label: 'Horizontal Freq',
			default: 5,
			min: 1,
			max: 20,
			step: 0.5
		},
		{
			name: 'frequencyY',
			label: 'Vertical Freq',
			default: 5,
			min: 1,
			max: 20,
			step: 0.5
		}
	],
	uniformValues: (p) => ({
		uAmplitudeX: readNumber(p, 'amplitudeX', 0.02),
		uAmplitudeY: readNumber(p, 'amplitudeY', 0.02),
		uFrequencyX: readNumber(p, 'frequencyX', 5),
		uFrequencyY: readNumber(p, 'frequencyY', 5)
	})
};

export const triggerWave: GpuShaderDefinition = {
	id: 'gpu-trigger-wave',
	label: 'Trigger Wave',
	category: 'distort',
	entryPoint: 'triggerWaveFragment',
	fragmentSource: /* glsl */ `
uniform float uStrength;
uniform float uRadius;
uniform float uFrequency;
uniform float uDecay;
uniform float uCenterX;
uniform float uCenterY;
uniform float uPhase;
uniform float uSpeed;
uniform float uChroma;
uniform float uScanlineMix;
uniform float uTime;
uniform float uAspect;
uniform float uGlowR;
uniform float uGlowG;
uniform float uGlowB;

vec4 triggerWaveFragment(vec2 vUv) {
  float strength = uStrength;
  float radius = max(uRadius, 0.001);
  float frequency = max(uFrequency, 0.001);
  float decay = max(uDecay, 0.001);

  vec2 center = vec2(uCenterX, uCenterY);
  float phase = fract(uPhase + uSpeed * uTime);
  float chroma = uChroma;
  float scanlineMix = clamp(uScanlineMix, 0.0, 1.0);
  float aspect = max(uAspect, 0.001);
  vec3 glowColor = vec3(uGlowR, uGlowG, uGlowB);

  vec2 aspectDelta = vec2((vUv.x - center.x) * aspect, vUv.y - center.y);
  float dist = length(aspectDelta);
  float safeDist = max(dist, 0.0001);
  vec2 direction = vec2(aspectDelta.x / aspect, aspectDelta.y) / safeDist;

  float ringRadius = phase * radius;
  float band = exp(-abs(dist - ringRadius) / decay);
  float tail = 1.0 - smoothstep(0.2, 1.0, phase);
  float carrier = sin((dist - ringRadius) * frequency * TAU);
  float force = carrier * band * tail * strength;
  vec2 warpedUv = vUv + direction * force;

  vec4 color = texture(uInputTex, warpedUv);
  if (chroma > 0.0) {
    vec2 chromaOffset = direction * chroma * band * (0.25 + abs(strength) * 20.0);
    float red = texture(uInputTex, warpedUv + chromaOffset).r;
    float blue = texture(uInputTex, warpedUv - chromaOffset).b;
    color = vec4(red, color.g, blue, color.a);
  }

  if (scanlineMix > 0.0) {
    float line = 0.78 + 0.22 * sin(gl_FragCoord.y * 2.4 + phase * TAU * 8.0);
    color = vec4(mix(color.rgb, color.rgb * line, vec3(scanlineMix)), color.a);
  }

  float glow = band * tail * clamp(abs(strength) * 12.0, 0.0, 1.0);
  color = vec4(color.rgb + glowColor * glow, color.a);
  return vec4(clamp(color.rgb, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{
			name: 'strength',
			label: 'Strength',
			default: 0.035,
			min: -0.15,
			max: 0.15,
			step: 0.001
		},
		{
			name: 'radius',
			label: 'Radius',
			default: 0.85,
			min: 0.1,
			max: 1.5,
			step: 0.01
		},
		{
			name: 'frequency',
			label: 'Frequency',
			default: 18,
			min: 2,
			max: 64,
			step: 1
		},
		{
			name: 'decay',
			label: 'Decay',
			default: 0.08,
			min: 0.01,
			max: 0.3,
			step: 0.01
		},
		{ name: 'phase', label: 'Phase', default: 0, min: 0, max: 1, step: 0.01 },
		{
			name: 'speed',
			label: 'Speed',
			default: 1,
			min: 0,
			max: 4,
			step: 0.1,
			animatable: false
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
			name: 'chroma',
			label: 'Chroma',
			default: 0.006,
			min: 0,
			max: 0.05,
			step: 0.001
		},
		{
			name: 'scanlineMix',
			label: 'Scanlines',
			default: 0.18,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'glowColor',
			label: 'Glow Color',
			type: 'color' as const,
			default: '#2e6b8c'
		}
	],
	uniformValues: (p, w, h, time) => {
		const glow = parseHexColor(readString(p, 'glowColor', '#2e6b8c'), [0.18, 0.42, 0.55, 1]);
		return {
			uStrength: readNumber(p, 'strength', 0.035),
			uRadius: readNumber(p, 'radius', 0.85),
			uFrequency: readNumber(p, 'frequency', 18),
			uDecay: readNumber(p, 'decay', 0.08),
			uCenterX: readNumber(p, 'centerX', 0.5),
			uCenterY: readNumber(p, 'centerY', 0.5),
			uPhase: readNumber(p, 'phase', 0),
			uSpeed: readNumber(p, 'speed', 1),
			uChroma: readNumber(p, 'chroma', 0.006),
			uScanlineMix: readNumber(p, 'scanlineMix', 0.18),
			uTime: time,
			uAspect: w / Math.max(h, 1),
			uGlowR: glow[0] * glow[3],
			uGlowG: glow[1] * glow[3],
			uGlowB: glow[2] * glow[3]
		};
	}
};

export const bulge: GpuShaderDefinition = {
	id: 'gpu-bulge',
	label: 'Bulge/Pinch',
	category: 'distort',
	entryPoint: 'bulgeFragment',
	fragmentSource: /* glsl */ `
uniform float uAmount;
uniform float uRadius;
uniform float uCenterX;
uniform float uCenterY;
vec4 bulgeFragment(vec2 vUv) {
  vec2 center = vec2(uCenterX, uCenterY);
  vec2 delta = vUv - center;
  float dist = length(delta);
  float safeDist = max(dist, 0.0001);
  float normalizedDist = safeDist / uRadius;
  float factor = pow(normalizedDist, uAmount);
  float newDist = factor * uRadius;
  vec2 direction = delta / safeDist;
  vec2 bulgedUV = center + direction * newDist;
  bool inRadius = dist < uRadius && dist > 0.0;
  vec2 finalUV = inRadius ? bulgedUV : vUv;
  return texture(uInputTex, finalUV);
}`,
	schema: [
		{
			name: 'amount',
			label: 'Amount',
			default: 0.5,
			min: 0.1,
			max: 3,
			step: 0.1
		},
		{
			name: 'radius',
			label: 'Radius',
			default: 0.5,
			min: 0.1,
			max: 1,
			step: 0.01
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
		}
	],
	uniformValues: (p) => ({
		uAmount: readNumber(p, 'amount', 0.5),
		uRadius: readNumber(p, 'radius', 0.5),
		uCenterX: readNumber(p, 'centerX', 0.5),
		uCenterY: readNumber(p, 'centerY', 0.5)
	})
};

export const kaleidoscope: GpuShaderDefinition = {
	id: 'gpu-kaleidoscope',
	label: 'Kaleidoscope',
	category: 'distort',
	entryPoint: 'kaleidoscopeFragment',
	fragmentSource: /* glsl */ `
uniform float uSegments;
uniform float uRotation;
vec4 kaleidoscopeFragment(vec2 vUv) {
  vec2 uv = vUv - 0.5;
  float angle = atan(uv.y, uv.x) + uRotation;
  float radius = length(uv);
  float segmentAngle = TAU / uSegments;
  float a = fract(angle / segmentAngle) * segmentAngle;
  if (a > segmentAngle * 0.5) { a = segmentAngle - a; }
  uv = vec2(cos(a), sin(a)) * radius + 0.5;
  return texture(uInputTex, uv);
}`,
	schema: [
		{
			name: 'segments',
			label: 'Segments',
			default: 6,
			min: 2,
			max: 16,
			step: 1
		},
		{
			name: 'rotation',
			label: 'Rotation',
			default: 0,
			min: 0,
			max: 6.28318,
			step: 0.01
		}
	],
	uniformValues: (p) => ({
		uSegments: readNumber(p, 'segments', 6),
		uRotation: readNumber(p, 'rotation', 0)
	})
};

export const mirror: GpuShaderDefinition = {
	id: 'gpu-mirror',
	label: 'Mirror',
	category: 'distort',
	entryPoint: 'mirrorFragment',
	fragmentSource: /* glsl */ `
uniform float uHorizontal;
uniform float uVertical;
vec4 mirrorFragment(vec2 vUv) {
  vec2 uv = vUv;
  if (uHorizontal > 0.5 && uv.x > 0.5) { uv.x = 1.0 - uv.x; }
  if (uVertical > 0.5 && uv.y > 0.5) { uv.y = 1.0 - uv.y; }
  return texture(uInputTex, uv);
}`,
	schema: [
		{
			name: 'horizontal',
			label: 'Horizontal',
			type: 'boolean' as const,
			default: true
		},
		{
			name: 'vertical',
			label: 'Vertical',
			type: 'boolean' as const,
			default: false
		}
	],
	uniformValues: (p) => ({
		uHorizontal: p.horizontal !== false ? 1 : 0,
		uVertical: p.vertical === true ? 1 : 0
	})
};

const FLUTED_GRID_SHAPE_KIND = new Map([
	['lines', 1],
	['linesIrregular', 2],
	['wave', 3],
	['zigzag', 4],
	['pattern', 5]
]);
const FLUTED_DISTORTION_SHAPE_KIND = new Map([
	['prism', 1],
	['lens', 2],
	['contour', 3],
	['cascade', 4],
	['flat', 5]
]);

// Adapted from Paper Design's fluted-glass shader (published package source).
export const flutedGlass: GpuShaderDefinition = {
	id: 'gpu-fluted-glass',
	label: 'Fluted Glass',
	category: 'distort',
	entryPoint: 'flutedGlassFragment',
	fragmentSource: /* glsl */ `
uniform float uBackR;
uniform float uBackG;
uniform float uBackB;
uniform float uBackA;
uniform float uShadowR;
uniform float uShadowG;
uniform float uShadowB;
uniform float uShadowA;
uniform float uHighlightR;
uniform float uHighlightG;
uniform float uHighlightB;
uniform float uHighlightA;
uniform float uSize;
uniform float uShadowsAmount;
uniform float uAngleDeg;
uniform float uStretch;
uniform float uPatternKind;
uniform float uDistortion;
uniform float uHighlights;
uniform float uBendKind;
uniform float uShift;
uniform float uBlur;
uniform float uEdges;
uniform float uGrainMixer;
uniform float uGrainOverlay;
uniform float uWidth;
uniform float uHeight;
uniform float uAspect;
uniform float uMarginLeft;
uniform float uMarginTop;
uniform float uMarginRight;
uniform float uMarginBottom;

vec2 rotate2d(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

vec2 rotateAspect(vec2 p, float angle, float aspect) {
  vec2 q = p;
  q.x *= aspect;
  q = rotate2d(q, angle);
  q.x /= aspect;
  return q;
}

float smoothFract(float x) {
  float f = fract(x);
  float w = fwidth(x);
  float edge = abs(f - 0.5) - 0.5;
  float band = smoothstep(-w, w, edge);
  return mix(f, 1.0 - f, band);
}

float getUvFrame(vec2 uv, float softness) {
  float aax = 2.0 * fwidth(uv.x);
  float aay = 2.0 * fwidth(uv.y);
  float left = smoothstep(0.0, aax + softness, uv.x);
  float right = 1.0 - smoothstep(1.0 - softness - aax, 1.0, uv.x);
  float bottom = smoothstep(0.0, aay + softness, uv.y);
  float top = 1.0 - smoothstep(1.0 - softness - aay, 1.0, uv.y);
  return left * right * bottom * top;
}

vec4 samplePremultiplied(vec2 uv) {
  vec4 c = textureLod(uInputTex, uv, 0.0);
  return vec4(c.rgb * c.a, c.a);
}

vec4 getBlur(vec2 uv, vec2 texelSize, vec2 dir, float sigma) {
  if (sigma <= 0.5) {
    return textureLod(uInputTex, uv, 0.0);
  }

  const int maxRadius = 50;
  int radius = int(min(50.0, ceil(3.0 * sigma)));
  float twoSigma2 = 2.0 * sigma * sigma;
  float gaussianNorm = 1.0 / sqrt(TAU * sigma * sigma);

  vec4 sum = samplePremultiplied(uv) * gaussianNorm;
  float weightSum = gaussianNorm;

  for (int i = 1; i <= maxRadius; i++) {
    if (i > radius) {
      break;
    }

    float x = float(i);
    float w = exp(-(x * x) / twoSigma2) * gaussianNorm;
    vec2 offset = dir * texelSize * x;
    vec4 s1 = samplePremultiplied(uv + offset);
    vec4 s2 = samplePremultiplied(uv - offset);
    sum += (s1 + s2) * w;
    weightSum += 2.0 * w;
  }

  vec4 result = sum / weightSum;
  if (result.a > 0.0) {
    return vec4(result.rgb / result.a, result.a);
  }
  return result;
}

float flutedOverlayNoise(vec2 p) {
  float coarse = noise2d(p * 0.83 + vec2(4.1, -7.3));
  float medium = noise2d(vec2(
    p.x * 1.27 - p.y * 0.58,
    p.x * 0.71 + p.y * 1.19
  ) + vec2(-10.2, 5.4));
  float fine = noise2d(vec2(
    p.x * -0.92 + p.y * 1.11,
    p.x * -1.06 - p.y * 0.82
  ) + vec2(7.8, 9.6));
  return coarse * 0.45 + medium * 0.35 + fine * 0.2;
}

vec4 flutedGlassFragment(vec2 vUv) {
  float width = max(uWidth, 1.0);
  float height = max(uHeight, 1.0);
  float aspect = max(uAspect, 0.0001);

  float size = clamp(uSize, 0.0, 1.0);
  float shadowsAmount = clamp(uShadowsAmount, 0.0, 1.0);
  float angle = uAngleDeg * PI / 180.0;
  float stretchAmount = clamp(uStretch, 0.0, 1.0);

  int shape = int(uPatternKind);
  float distortionAmount = clamp(uDistortion, 0.0, 1.0);
  float highlightsAmount = clamp(uHighlights, 0.0, 1.0);
  int distortionShape = int(uBendKind);

  float shiftAmount = uShift;
  float blurAmount = clamp(uBlur, 0.0, 1.0);
  float edgesAmount = clamp(uEdges, 0.0, 1.0);
  float grainMixer = clamp(uGrainMixer, 0.0, 1.0);
  float grainOverlay = clamp(uGrainOverlay, 0.0, 1.0);

  float marginLeft = uMarginLeft;
  float marginTop = uMarginTop;
  float marginRight = uMarginRight;
  float marginBottom = uMarginBottom;

  float patternRotation = -angle;
  float patternSize = mix(200.0, 5.0, size);

  vec2 uv = vUv;
  vec2 uvMask = gl_FragCoord.xy / vec2(width, height);
  vec2 sw = vec2(0.005);
  float mask =
    smoothstep(marginLeft, marginLeft + sw.x, uvMask.x + sw.x) *
    smoothstep(marginRight, marginRight + sw.x, 1.0 - uvMask.x + sw.x) *
    smoothstep(marginTop, marginTop + sw.y, uvMask.y + sw.y) *
    smoothstep(marginBottom, marginBottom + sw.y, 1.0 - uvMask.y + sw.y);
  float maskOuter =
    smoothstep(marginLeft - sw.x, marginLeft, uvMask.x + sw.x) *
    smoothstep(marginRight - sw.x, marginRight, 1.0 - uvMask.x + sw.x) *
    smoothstep(marginTop - sw.y, marginTop, uvMask.y + sw.y) *
    smoothstep(marginBottom - sw.y, marginBottom, 1.0 - uvMask.y + sw.y);
  float maskStroke = maskOuter - mask;
  float maskInner =
    smoothstep(marginLeft - 2.0 * sw.x, marginLeft, uvMask.x) *
    smoothstep(marginRight - 2.0 * sw.x, marginRight, 1.0 - uvMask.x) *
    smoothstep(marginTop - 2.0 * sw.y, marginTop, uvMask.y) *
    smoothstep(marginBottom - 2.0 * sw.y, marginBottom, 1.0 - uvMask.y);
  float maskStrokeInner = maskInner - mask;

  uv -= 0.5;
  uv *= patternSize;
  uv = rotateAspect(uv, patternRotation, aspect);

  float curve = 0.0;
  float patternY = uv.y / aspect;
  if (shape == 5) {
    curve = 0.5 + 0.5 * sin(0.5 * PI * uv.x) * cos(0.5 * PI * patternY);
  } else if (shape == 4) {
    curve = 10.0 * abs(fract(0.1 * patternY) - 0.5);
  } else if (shape == 3) {
    curve = 4.0 * sin(0.23 * patternY);
  } else if (shape == 2) {
    curve = 0.5 + 0.5 * sin(0.5 * uv.x) * sin(1.7 * uv.x);
  }

  vec2 uvToFract = uv + curve;
  vec2 fractOrigUV = fract(uv);
  vec2 floorOrigUV = floor(uv);
  float x = smoothFract(uvToFract.x);
  float xNonSmooth = fract(uvToFract.x) + 0.0001;

  float highlightsWidth = 2.0 * max(0.001, fwidth(uvToFract.x));
  highlightsWidth += 2.0 * maskStrokeInner;
  float highlights = smoothstep(0.0, highlightsWidth, xNonSmooth);
  highlights *= smoothstep(1.0, 1.0 - highlightsWidth, xNonSmooth);
  highlights = 1.0 - highlights;
  highlights *= highlightsAmount;
  highlights = clamp(highlights, 0.0, 1.0);
  highlights *= mask;

  float shadows = pow(x, 1.3);
  float distortion = 0.0;
  float fadeX = 1.0;
  float frameFade = 0.0;

  float aa = fwidth(xNonSmooth);
  aa = max(aa, fwidth(uv.x));
  aa = max(aa, fwidth(uvToFract.x));
  aa = max(aa, 0.0001);

  if (distortionShape == 1) {
    distortion = -pow(1.5 * x, 3.0);
    distortion += 0.5 - shiftAmount;
    frameFade = pow(1.5 * x, 3.0);
    aa = max(0.2, aa);
    aa += mix(0.2, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion = mix(0.5, distortion, fadeX);
  } else if (distortionShape == 2) {
    distortion = 2.0 * pow(x, 2.0);
    distortion -= 0.5 + shiftAmount;
    frameFade = pow(abs(x - 0.5), 4.0);
    aa = max(0.2, aa);
    aa += mix(0.2, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion = mix(0.5, distortion, fadeX);
    frameFade = mix(1.0, frameFade, 0.5 * fadeX);
  } else if (distortionShape == 3) {
    distortion = pow(2.0 * (xNonSmooth - 0.5), 6.0);
    distortion -= 0.25;
    distortion -= shiftAmount;
    frameFade = 1.0 - 2.0 * pow(abs(x - 0.4), 2.0);
    aa = 0.15;
    aa += mix(0.1, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    frameFade = mix(1.0, frameFade, fadeX);
  } else if (distortionShape == 4) {
    x = xNonSmooth;
    distortion = sin((x + 0.25) * TAU);
    shadows = 0.5 + 0.5 * asin(distortion) / (0.5 * PI);
    distortion *= 0.5;
    distortion -= shiftAmount;
    frameFade = 0.5 + 0.5 * sin(x * TAU);
  } else if (distortionShape == 5) {
    distortion -= pow(abs(x), 0.2) * x;
    distortion += 0.33;
    distortion -= 3.0 * shiftAmount;
    distortion *= 0.33;
    frameFade = 0.3 * smoothstep(0.0, 1.0, x);
    shadows = pow(x, 2.5);
    aa = max(0.1, aa);
    aa += mix(0.1, 0.0, size);
    fadeX = smoothstep(0.0, aa, xNonSmooth) * smoothstep(1.0, 1.0 - aa, xNonSmooth);
    distortion *= fadeX;
  }

  // Grain UV (and its derivatives) are only needed when grain or grain overlay
  // are active. grainMixer/grainOverlay are uniform, so these branches are
  // coherent across the draw — no divergence — and the dFdx/dFdy derivatives
  // stay in uniform control flow. Skips ~36 sin-based hash() calls per pixel
  // when grain is off (the common case), which dominates this shader's ALU.
  bool grainActive = grainMixer > 0.0 || grainOverlay > 0.0;
  vec2 grainUV = vUv;
  if (grainActive) {
    vec2 dudx = dFdx(vUv);
    vec2 dudy = dFdy(vUv);
    vec2 gUV = vUv - 0.5;
    vec2 derivativeScale = 0.8 / max(vec2(length(dudx), length(dudy)), vec2(0.0001));
    gUV *= derivativeScale;
    gUV += 0.5;
    grainUV = gUV;
  }
  if (grainMixer > 0.0) {
    float grain = flutedOverlayNoise(grainUV);
    grain = smoothstep(0.4, 0.7, grain);
    grain *= grainMixer;
    distortion = mix(distortion, 0.0, grain);
  }

  shadows = min(shadows, 1.0);
  shadows += maskStrokeInner;
  shadows *= mask;
  shadows = min(shadows, 1.0);
  shadows *= pow(shadowsAmount, 2.0);
  shadows = clamp(shadows, 0.0, 1.0);

  distortion *= 3.0 * distortionAmount;
  frameFade *= distortionAmount;

  fractOrigUV = vec2(fractOrigUV.x + distortion, fractOrigUV.y);
  floorOrigUV = rotateAspect(floorOrigUV, -patternRotation, aspect);
  fractOrigUV = rotateAspect(fractOrigUV, -patternRotation, aspect);

  uv = (floorOrigUV + fractOrigUV) / patternSize;
  uv += vec2(pow(maskStroke, 4.0));
  uv += 0.5;

  uv = mix(vUv, uv, smoothstep(0.0, 0.7, mask));
  float blur = mix(0.0, 50.0, blurAmount);
  blur = mix(0.0, blur, smoothstep(0.5, 1.0, mask));

  float edgeDistortion = mix(0.0, 0.04, edgesAmount);
  edgeDistortion += 0.06 * frameFade * edgesAmount;
  edgeDistortion *= mask;
  float frame = getUvFrame(uv, edgeDistortion);

  // stretchAmount is uniform — skip the stretch warp (and its getUvFrame /
  // fwidth work) entirely when stretch is off.
  if (stretchAmount > 0.0) {
    float stretch = 1.0 - smoothstep(0.0, 0.5, xNonSmooth) * smoothstep(1.0, 0.5, xNonSmooth);
    stretch = pow(stretch, 2.0);
    stretch *= mask;
    stretch *= getUvFrame(uv, 0.1 + 0.05 * mask * frameFade);
    uv = vec2(uv.x, mix(uv.y, 0.5, stretchAmount * stretch));
  }

  vec4 imageSample = getBlur(uv, 1.0 / vec2(width, height), vec2(0.0, 1.0), blur);
  vec4 image = vec4(imageSample.rgb * imageSample.a, imageSample.a);
  vec4 backColor = vec4(vec3(uBackR, uBackG, uBackB) * uBackA, uBackA);
  vec4 highlightColor = vec4(vec3(uHighlightR, uHighlightG, uHighlightB) * uHighlightA, uHighlightA);
  vec4 shadowColor = vec4(uShadowR, uShadowG, uShadowB, uShadowA);

  vec3 color = highlightColor.rgb * highlights;
  float opacity = highlightColor.a * highlights;

  shadows = mix(shadows * shadowColor.a, 0.0, highlights);
  color = mix(color, shadowColor.rgb * shadowColor.a, vec3(0.5 * shadows));
  color += 0.5 * pow(shadows, 0.5) * shadowColor.rgb;
  opacity += shadows;
  color = clamp(color, vec3(0.0), vec3(1.0));
  opacity = clamp(opacity, 0.0, 1.0);

  color += image.rgb * (1.0 - opacity) * frame;
  opacity += image.a * (1.0 - opacity) * frame;
  color += backColor.rgb * (1.0 - opacity);
  opacity += backColor.a * (1.0 - opacity);

  // grainOverlay is uniform — the two-octave overlay noise (24 sin-based
  // hash() calls) only runs when the overlay is actually dialed in.
  if (grainOverlay > 0.0) {
    float grainOverlayNoise = flutedOverlayNoise(rotate2d(grainUV, 1.0) + vec2(3.0));
    grainOverlayNoise = mix(grainOverlayNoise, flutedOverlayNoise(rotate2d(grainUV, 2.0) + vec2(-1.0)), 0.5);
    grainOverlayNoise = pow(grainOverlayNoise, 1.3);

    float grainOverlayV = grainOverlayNoise * 2.0 - 1.0;
    vec3 grainOverlayColor = vec3(grainOverlayV >= 0.0 ? 1.0 : 0.0);
    float grainOverlayStrength = grainOverlay * abs(grainOverlayV);
    grainOverlayStrength = pow(grainOverlayStrength, 0.8);
    grainOverlayStrength *= mask;
    color = mix(color, grainOverlayColor, vec3(0.35 * grainOverlayStrength));
    opacity += 0.5 * grainOverlayStrength;
  }
  opacity = clamp(opacity, 0.0, 1.0);

  return vec4(color, opacity);
}`,
	schema: [
		{
			name: 'colorBack',
			label: 'Back Color',
			type: 'color' as const,
			default: '#00000000'
		},
		{
			name: 'colorShadow',
			label: 'Shadow Color',
			type: 'color' as const,
			default: '#000000'
		},
		{
			name: 'colorHighlight',
			label: 'Highlight Color',
			type: 'color' as const,
			default: '#ffffff'
		},
		{
			name: 'shadows',
			label: 'Shadows',
			default: 0.25,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'highlights',
			label: 'Highlights',
			default: 0.1,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'size', label: 'Size', default: 0.5, min: 0, max: 1, step: 0.01 },
		{
			name: 'shape',
			label: 'Shape',
			type: 'select' as const,
			default: 'lines',
			options: [
				{ value: 'lines', label: 'Lines' },
				{ value: 'linesIrregular', label: 'Irregular Lines' },
				{ value: 'wave', label: 'Wave' },
				{ value: 'zigzag', label: 'Zigzag' },
				{ value: 'pattern', label: 'Pattern' }
			]
		},
		{ name: 'angle', label: 'Angle', default: 0, min: 0, max: 180, step: 1 },
		{
			name: 'distortionShape',
			label: 'Distortion Shape',
			type: 'select' as const,
			default: 'prism',
			options: [
				{ value: 'prism', label: 'Prism' },
				{ value: 'lens', label: 'Lens' },
				{ value: 'contour', label: 'Contour' },
				{ value: 'cascade', label: 'Cascade' },
				{ value: 'flat', label: 'Flat' }
			]
		},
		{
			name: 'distortion',
			label: 'Distortion',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'shift', label: 'Shift', default: 0, min: -1, max: 1, step: 0.01 },
		{
			name: 'stretch',
			label: 'Stretch',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'blur', label: 'Blur', default: 0, min: 0, max: 1, step: 0.01 },
		{
			name: 'edges',
			label: 'Edges',
			default: 0.25,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'margin', label: 'Margin', default: 0, min: 0, max: 1, step: 0.01 },
		{
			name: 'marginLeft',
			label: 'Left Margin',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'marginRight',
			label: 'Right Margin',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'marginTop',
			label: 'Top Margin',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'marginBottom',
			label: 'Bottom Margin',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'grainMixer',
			label: 'Grain Mixer',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'grainOverlay',
			label: 'Grain Overlay',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p, w, h) => {
		const margin = readNumber(p, 'margin', 0);
		const colorBack = parseHexColor(readString(p, 'colorBack', '#00000000'), [0, 0, 0, 0]);
		const colorShadow = parseHexColor(readString(p, 'colorShadow', '#000000'), [0, 0, 0, 1]);
		const colorHighlight = parseHexColor(readString(p, 'colorHighlight', '#ffffff'), [1, 1, 1, 1]);
		return {
			uBackR: colorBack[0],
			uBackG: colorBack[1],
			uBackB: colorBack[2],
			uBackA: colorBack[3],
			uShadowR: colorShadow[0],
			uShadowG: colorShadow[1],
			uShadowB: colorShadow[2],
			uShadowA: colorShadow[3],
			uHighlightR: colorHighlight[0],
			uHighlightG: colorHighlight[1],
			uHighlightB: colorHighlight[2],
			uHighlightA: colorHighlight[3],
			uSize: readNumber(p, 'size', 0.5),
			uShadowsAmount: readNumber(p, 'shadows', 0.25),
			uAngleDeg: readNumber(p, 'angle', 0),
			uStretch: readNumber(p, 'stretch', 0),
			uPatternKind: FLUTED_GRID_SHAPE_KIND.get(readString(p, 'shape', 'lines')) ?? 1,
			uDistortion: readNumber(p, 'distortion', 0.5),
			uHighlights: readNumber(p, 'highlights', 0.1),
			uBendKind: FLUTED_DISTORTION_SHAPE_KIND.get(readString(p, 'distortionShape', 'prism')) ?? 1,
			uShift: readNumber(p, 'shift', 0),
			uBlur: readNumber(p, 'blur', 0),
			uEdges: readNumber(p, 'edges', 0.25),
			uGrainMixer: readNumber(p, 'grainMixer', 0),
			uGrainOverlay: readNumber(p, 'grainOverlay', 0),
			uWidth: w,
			uHeight: h,
			uAspect: w / Math.max(h, 1),
			uMarginLeft: readNumber(p, 'marginLeft', margin),
			uMarginTop: readNumber(p, 'marginTop', margin),
			uMarginRight: readNumber(p, 'marginRight', margin),
			uMarginBottom: readNumber(p, 'marginBottom', margin)
		};
	}
};

// Radial sibling of Fluted Glass: concentric-ring lens refraction from an
// origin (bullseye / rippled-pond glass). Shares the shadow/highlight lighting
// model with the fluted shader.
export const rippleGlass: GpuShaderDefinition = {
	id: 'gpu-ripple-glass',
	label: 'Ripple Glass',
	category: 'distort',
	entryPoint: 'rippleGlassFragment',
	fragmentSource: /* glsl */ `
uniform float uShadowR;
uniform float uShadowG;
uniform float uShadowB;
uniform float uShadowA;
uniform float uHighlightR;
uniform float uHighlightG;
uniform float uHighlightB;
uniform float uHighlightA;
uniform float uAmount;
uniform float uRings;
uniform float uShadows;
uniform float uHighlights;
uniform float uOriginX;
uniform float uOriginY;
uniform float uPhase;
uniform float uFalloff;
uniform float uAberration;
uniform float uAspect;

vec4 rippleGlassFragment(vec2 vUv) {
  float amount = uAmount;
  float rings = max(uRings, 1.0);
  float shadowsAmount = clamp(uShadows, 0.0, 1.0);
  float highlightsAmount = clamp(uHighlights, 0.0, 1.0);

  vec2 origin = vec2(uOriginX, uOriginY);
  float phase = uPhase;
  float falloff = max(uFalloff, 0.001);

  float aberration = uAberration;
  float aspect = max(uAspect, 0.0001);

  // Aspect-corrected radial vector from the ripple origin.
  vec2 p = vUv - origin;
  p.x *= aspect;
  float dist = length(p);
  vec2 dir = p / max(dist, 1e-4);
  // Radial offset expressed back in uv space (undo the aspect scaling on x).
  vec2 radialUv = vec2(dir.x / aspect, dir.y);

  float ringWidth = 1.0 / rings;
  float ringCoord = dist / ringWidth - phase;   // integer part = ring index
  float x = fract(ringCoord);                     // 0..1 within the ring
  float centered = x - 0.5;

  // Cylindrical lens bend: soft at the ring centre, steep toward the seams,
  // pulling samples back toward each ring centre (magnifying the band).
  float bend = -sign(centered) * pow(abs(centered) * 2.0, 1.5);

  // Reach envelope — fades the ripple away from the origin.
  float envelope = exp(-dist / falloff);

  float push = bend * amount * ringWidth * 1.5 * envelope;
  vec2 offsetUv = radialUv * push;

  vec4 color;
  if (aberration > 0.0) {
    vec2 ca = radialUv * aberration * ringWidth * envelope;
    float r = texture(uInputTex, vUv + offsetUv + ca).r;
    float g = texture(uInputTex, vUv + offsetUv).g;
    float b = texture(uInputTex, vUv + offsetUv - ca).b;
    float a = texture(uInputTex, vUv + offsetUv).a;
    color = vec4(r, g, b, a);
  } else {
    color = texture(uInputTex, vUv + offsetUv);
  }

  // Thin bright seam between rings + groove shadow that deepens toward it.
  float aa = 2.0 * max(0.001, fwidth(ringCoord));
  float highlights = 1.0 - (smoothstep(0.0, aa, x) * smoothstep(1.0, 1.0 - aa, x));
  highlights = clamp(highlights * highlightsAmount * envelope, 0.0, 1.0);

  float shadows = pow(abs(centered) * 2.0, 1.3);
  shadows = clamp(shadows * shadowsAmount * envelope, 0.0, 1.0);

  vec3 shadowColor = vec3(uShadowR, uShadowG, uShadowB);
  float shadowAlpha = uShadowA;
  vec3 highlightColor = vec3(uHighlightR, uHighlightG, uHighlightB);
  float highlightAlpha = uHighlightA;

  vec3 rgb = color.rgb;
  rgb = mix(rgb, shadowColor, vec3(0.5 * shadows * shadowAlpha));
  rgb += highlightColor * highlights * highlightAlpha;
  rgb = clamp(rgb, vec3(0.0), vec3(1.0));

  return vec4(rgb, color.a);
}`,
	schema: [
		{
			name: 'colorShadow',
			label: 'Shadow Color',
			type: 'color' as const,
			default: '#000000'
		},
		{
			name: 'colorHighlight',
			label: 'Highlight Color',
			type: 'color' as const,
			default: '#ffffff'
		},
		{
			name: 'amount',
			label: 'Amount',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'rings', label: 'Rings', default: 14, min: 1, max: 64, step: 1 },
		{
			name: 'shadows',
			label: 'Shadows',
			default: 0.25,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'highlights',
			label: 'Highlights',
			default: 0.1,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'originX',
			label: 'Origin X',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'originY',
			label: 'Origin Y',
			default: 0.5,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'phase', label: 'Phase', default: 0, min: -1, max: 1, step: 0.01 },
		{
			name: 'falloff',
			label: 'Falloff',
			default: 0.35,
			min: 0.05,
			max: 2,
			step: 0.01
		},
		{
			name: 'aberration',
			label: 'Aberration',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p, w, h) => {
		const shadow = parseHexColor(readString(p, 'colorShadow', '#000000'), [0, 0, 0, 1]);
		const highlight = parseHexColor(readString(p, 'colorHighlight', '#ffffff'), [1, 1, 1, 1]);
		return {
			uShadowR: shadow[0],
			uShadowG: shadow[1],
			uShadowB: shadow[2],
			uShadowA: shadow[3],
			uHighlightR: highlight[0],
			uHighlightG: highlight[1],
			uHighlightB: highlight[2],
			uHighlightA: highlight[3],
			uAmount: readNumber(p, 'amount', 0.5),
			uRings: readNumber(p, 'rings', 14),
			uShadows: readNumber(p, 'shadows', 0.25),
			uHighlights: readNumber(p, 'highlights', 0.1),
			uOriginX: readNumber(p, 'originX', 0.5),
			uOriginY: readNumber(p, 'originY', 0.5),
			uPhase: readNumber(p, 'phase', 0),
			uFalloff: readNumber(p, 'falloff', 0.35),
			uAberration: readNumber(p, 'aberration', 0),
			uAspect: w / Math.max(h, 1)
		};
	}
};

// 2D sibling of Fluted Glass: a grid of rounded lens cells, each magnifying
// its own patch (privacy-glass block wall). Reuses the shadow/highlight model.
export const glassMosaic: GpuShaderDefinition = {
	id: 'gpu-glass-mosaic',
	label: 'Glass Mosaic',
	category: 'distort',
	entryPoint: 'glassMosaicFragment',
	fragmentSource: /* glsl */ `
uniform float uShadowR;
uniform float uShadowG;
uniform float uShadowB;
uniform float uShadowA;
uniform float uHighlightR;
uniform float uHighlightG;
uniform float uHighlightB;
uniform float uHighlightA;
uniform float uAmount;
uniform float uCells;
uniform float uShadows;
uniform float uHighlights;
uniform float uAberration;
uniform float uAspect;

vec4 glassMosaicFragment(vec2 vUv) {
  float amount = uAmount;
  float cells = max(uCells, 1.0);
  float shadowsAmount = clamp(uShadows, 0.0, 1.0);
  float highlightsAmount = clamp(uHighlights, 0.0, 1.0);
  float aberration = uAberration;
  float aspect = max(uAspect, 0.0001);

  // Square-ish cells: cellsX counts columns across the width; rows scale by
  // aspect so each tile stays roughly square regardless of frame proportions.
  vec2 cellUvSize = vec2(1.0 / cells, aspect / cells);
  vec2 grid = vUv / cellUvSize;
  vec2 local = fract(grid) - 0.5;                 // -0.5..0.5 within the cell
  vec2 localUv = local * cellUvSize;              // same offset, in uv space

  // Spherical lens: magnify toward each cell centre, fading out near the rim.
  float dd = dot(local * 2.0, local * 2.0);        // 0 centre .. up to 2 at corners
  float lens = amount * pow(clamp(1.0 - dd, 0.0, 1.0), 0.5);
  vec2 sampleUv = vUv - localUv * lens;

  vec4 color;
  if (aberration > 0.0) {
    vec2 ca = localUv * aberration;
    float r = texture(uInputTex, sampleUv - ca).r;
    float g = texture(uInputTex, sampleUv).g;
    float b = texture(uInputTex, sampleUv + ca).b;
    float a = texture(uInputTex, sampleUv).a;
    color = vec4(r, g, b, a);
  } else {
    color = texture(uInputTex, sampleUv);
  }

  // Rounded-square edge factor: 0 at the cell centre, 1 at the rim.
  float edge = max(abs(local.x), abs(local.y)) * 2.0;
  float fw = fwidth(edge) + 0.001;

  // Bright bevel just inside each cell border.
  float highlights = smoothstep(1.0 - 6.0 * fw, 1.0 - 2.0 * fw, edge);
  highlights *= highlightsAmount;

  // Darker mortar at the seams + a gentle vignette toward the rim.
  float gap = smoothstep(1.0 - 2.0 * fw, 1.0, edge);
  float shadows = pow(edge, 3.0) * 0.5 + gap;
  shadows = clamp(shadows * shadowsAmount, 0.0, 1.0);

  // Diagonal bevel (light from top-left) gives each tile a glassy roundness.
  float bevel = (-local.x - local.y) * amount * 0.5;

  vec3 shadowColor = vec3(uShadowR, uShadowG, uShadowB);
  float shadowAlpha = uShadowA;
  vec3 highlightColor = vec3(uHighlightR, uHighlightG, uHighlightB);
  float highlightAlpha = uHighlightA;

  vec3 rgb = color.rgb * (1.0 + bevel);
  rgb = mix(rgb, shadowColor, vec3(0.5 * shadows * shadowAlpha));
  rgb += highlightColor * highlights * highlightAlpha;
  rgb = clamp(rgb, vec3(0.0), vec3(1.0));

  return vec4(rgb, color.a);
}`,
	schema: [
		{
			name: 'colorShadow',
			label: 'Shadow Color',
			type: 'color' as const,
			default: '#000000'
		},
		{
			name: 'colorHighlight',
			label: 'Highlight Color',
			type: 'color' as const,
			default: '#ffffff'
		},
		{
			name: 'amount',
			label: 'Amount',
			default: 0.55,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'cells', label: 'Cells', default: 18, min: 2, max: 80, step: 1 },
		{
			name: 'shadows',
			label: 'Shadows',
			default: 0.3,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'highlights',
			label: 'Highlights',
			default: 0.12,
			min: 0,
			max: 1,
			step: 0.01
		},
		{
			name: 'aberration',
			label: 'Aberration',
			default: 0,
			min: 0,
			max: 1,
			step: 0.01
		}
	],
	uniformValues: (p, w, h) => {
		const shadow = parseHexColor(readString(p, 'colorShadow', '#000000'), [0, 0, 0, 1]);
		const highlight = parseHexColor(readString(p, 'colorHighlight', '#ffffff'), [1, 1, 1, 1]);
		return {
			uShadowR: shadow[0],
			uShadowG: shadow[1],
			uShadowB: shadow[2],
			uShadowA: shadow[3],
			uHighlightR: highlight[0],
			uHighlightG: highlight[1],
			uHighlightB: highlight[2],
			uHighlightA: highlight[3],
			uAmount: readNumber(p, 'amount', 0.55),
			uCells: readNumber(p, 'cells', 18),
			uShadows: readNumber(p, 'shadows', 0.3),
			uHighlights: readNumber(p, 'highlights', 0.12),
			uAberration: readNumber(p, 'aberration', 0),
			uAspect: w / Math.max(h, 1)
		};
	}
};

export const blocks: GpuShaderDefinition = {
	id: 'gpu-blocks',
	label: 'Blocks',
	category: 'distort',
	entryPoint: 'blocksFragment',
	fragmentSource: /* glsl */ `
uniform float uSize;
uniform float uDepth;
uniform float uStudSize;
uniform float uGap;
uniform float uWidth;
uniform float uHeight;
vec4 blocksFragment(vec2 vUv) {
  float cellX = max(uSize, 1.0) / uWidth;
  float cellY = max(uSize, 1.0) / uHeight;
  vec2 cellIndex = vec2(floor(vUv.x / cellX), floor(vUv.y / cellY));
  vec2 cellCenter = vec2((cellIndex.x + 0.5) * cellX, (cellIndex.y + 0.5) * cellY);
  vec4 color = texture(uInputTex, cellCenter);

  // local position within the cell, centered at 0 (range -0.5..0.5)
  vec2 local = vec2(fract(vUv.x / cellX), fract(vUv.y / cellY)) - vec2(0.5);
  float edge = max(abs(local.x), abs(local.y));

  // bevel: light from top-left, shadow toward bottom-right
  float shade = (-local.x - local.y) * uDepth;

  // raised stud at the cell center with its own bevel
  float studR = clamp(uStudSize, 0.0, 1.0) * 0.4;
  float stud = smoothstep(studR, studR - 0.03, length(local));
  float studShade = stud * ((-local.x - local.y) * uDepth * 2.0 + uDepth * 0.18);

  vec3 rgb = color.rgb * (1.0 + shade) + color.rgb * studShade;

  // darken the mortar gap between blocks
  float gapMask = step(edge, 0.5 - clamp(uGap, 0.0, 0.4));
  rgb = rgb * mix(0.55, 1.0, gapMask);

  return vec4(clamp(rgb, vec3(0.0), vec3(1.0)), color.a);
}`,
	schema: [
		{
			name: 'size',
			label: 'Block Size',
			default: 24,
			min: 4,
			max: 120,
			step: 1
		},
		{
			name: 'depth',
			label: 'Depth',
			default: 0.5,
			min: 0,
			max: 1.5,
			step: 0.01
		},
		{
			name: 'studSize',
			label: 'Stud Size',
			default: 0.55,
			min: 0,
			max: 1,
			step: 0.01
		},
		{ name: 'gap', label: 'Gap', default: 0.06, min: 0, max: 0.4, step: 0.01 }
	],
	uniformValues: (p, w, h) => ({
		uSize: readNumber(p, 'size', 24),
		uDepth: readNumber(p, 'depth', 0.5),
		uStudSize: readNumber(p, 'studSize', 0.55),
		uGap: readNumber(p, 'gap', 0.06),
		uWidth: w,
		uHeight: h
	})
};

export const droste: GpuShaderDefinition = {
	id: 'gpu-droste',
	label: 'Droste',
	category: 'distort',
	entryPoint: 'drosteFragment',
	fragmentSource: /* glsl */ `
uniform float uStrength;
uniform float uScale;
uniform float uCenterX;
uniform float uCenterY;
uniform float uSpin;
uniform float uWidth;
uniform float uHeight;
vec4 drosteFragment(vec2 vUv) {
  float aspect = uWidth / max(uHeight, 1.0);
  vec2 center = vec2(uCenterX, uCenterY);
  vec2 p = (vUv - center) * vec2(aspect, 1.0);

  float r = max(length(p), 1e-4);
  float a = atan(p.y, p.x);
  vec2 z = vec2(log(r), a);

  float period = log(max(uScale, 1.0001));
  // Escher twist; strength dials from plain recursive zoom (0) to full spiral
  float alpha = atan(period, TAU) * clamp(uStrength, 0.0, 2.0);
  float co = max(cos(alpha), 1e-3);
  float si = sin(alpha);
  z = vec2(z.x * co - z.y * si, z.x * si + z.y * co) / co;

  // tile the log-radius into a single repeating band
  z.x = z.x - period * floor(z.x / period);

  float er = exp(z.x);
  float na = z.y + uSpin;
  vec2 uv = center + vec2(cos(na), sin(na)) * er / vec2(aspect, 1.0);
  return texture(uInputTex, fract(uv));
}`,
	schema: [
		{
			name: 'strength',
			label: 'Spiral',
			default: 1,
			min: 0,
			max: 2,
			step: 0.01
		},
		{ name: 'scale', label: 'Scale', default: 2, min: 1.1, max: 6, step: 0.05 },
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
			name: 'spin',
			label: 'Spin',
			default: 0,
			min: -6.28318,
			max: 6.28318,
			step: 0.01
		}
	],
	uniformValues: (p, w, h) => ({
		uStrength: readNumber(p, 'strength', 1),
		uScale: readNumber(p, 'scale', 2),
		uCenterX: readNumber(p, 'centerX', 0.5),
		uCenterY: readNumber(p, 'centerY', 0.5),
		uSpin: readNumber(p, 'spin', 0),
		uWidth: w,
		uHeight: h
	})
};
