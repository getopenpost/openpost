/**
 * Paper halftone effect.
 *
 * Adapted from FreeCut (MIT) and Paper Shaders' Halftone Dots shader
 * (Apache-2.0, Lost Coast Labs, Inc.): https://github.com/paper-design/shaders
 */

import type { GpuParamValues, GpuShaderDefinition } from '../types';
import { parseHexColor, readNumber } from '../types';

function flag(params: GpuParamValues, name: string, fallback: boolean): number {
	return (params[name] ?? fallback) === true ? 1 : 0;
}

export const halftone: GpuShaderDefinition = {
	id: 'gpu-halftone',
	label: 'Halftone',
	category: 'stylize',
	entryPoint: 'halftoneFragment',
	fragmentSource: /* glsl */ `
uniform float uFrontR;
uniform float uFrontG;
uniform float uFrontB;
uniform float uFrontA;
uniform float uBackR;
uniform float uBackG;
uniform float uBackB;
uniform float uBackA;
uniform float uSize;
uniform float uRadius;
uniform float uContrast;
uniform float uOriginalColors;
uniform float uInverted;
uniform float uGrainMixer;
uniform float uGrainOverlay;
uniform float uGrainSize;
uniform float uGridType;
uniform float uStyleType;
uniform float uWidth;
uniform float uHeight;

float halftoneLinearStep(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

float halftoneSmoothStep(float edge0, float edge1, float x) {
  return smoothstep(edge0, edge1, x);
}

float halftoneSigmoid(float x, float k) {
  return 1.0 / (1.0 + exp(-k * (x - 0.5)));
}

float getCircle(vec2 uv, float r, float baseR) {
  float rr = mix(0.25 * baseR, 0.0, r);
  float d = length(uv - 0.5);
  float aa = 0.02;
  return 1.0 - smoothstep(rr - aa, rr + aa, d);
}

float getCell(vec2 uv) {
  float insideX = step(0.0, uv.x) * (1.0 - step(1.0, uv.x));
  float insideY = step(0.0, uv.y) * (1.0 - step(1.0, uv.y));
  return insideX * insideY;
}

float getCircleWithHole(vec2 uv, float r, float baseR) {
  float cell = getCell(uv);
  float rr = mix(0.75 * baseR, 0.0, r);
  float rMod = rr - floor(rr / 0.5) * 0.5;
  float d = length(uv - 0.5);
  float aa = 0.02;
  float circle = 1.0 - smoothstep(rMod - aa, rMod + aa, d);
  if (rr < 0.5) {
    return circle;
  }
  return cell - circle;
}

float getGooeyBall(vec2 uv, float r, float baseR, int gridType) {
  float d = length(uv - 0.5);
  float sizeRadius = 0.3;
  if (gridType == 1) {
    sizeRadius = 0.42;
  }
  sizeRadius = mix(sizeRadius * baseR, 0.0, r);
  d = 1.0 - halftoneSmoothStep(0.0, sizeRadius, d);
  d = pow(d, 2.0 + baseR);
  return d;
}

float getSoftBall(vec2 uv, float r, float baseR) {
  float d = length(uv - 0.5);
  float sizeRadius = clamp(baseR, 0.0, 1.0);
  sizeRadius = mix(0.5 * sizeRadius, 0.0, r);
  d = 1.0 - halftoneLinearStep(0.0, sizeRadius, d);
  float powRadius = 1.0 - halftoneLinearStep(0.0, 2.0, baseR);
  d = pow(d, 4.0 + 3.0 * powRadius);
  return d;
}

float getLumAtPx(vec2 uv, float contrast, float invertedFlag) {
  vec4 tex = textureLod(uInputTex, uv, 0.0);
  if (tex.a <= 0.0001) {
    return invertedFlag > 0.5 ? 1.0 : 0.0;
  }
  vec3 color = vec3(
    halftoneSigmoid(tex.r, contrast),
    halftoneSigmoid(tex.g, contrast),
    halftoneSigmoid(tex.b, contrast)
  );
  float lum = luminance(color);
  if (invertedFlag > 0.5) {
    lum = 1.0 - lum;
  }
  return lum;
}

float halftoneNoise(vec2 p) {
  float a = noise2d(p);
  float b = noise2d(vec2(p.x * 1.31 + p.y * 0.74, p.x * -0.68 + p.y * 1.27) + vec2(11.7, 3.9));
  float c = noise2d(vec2(p.x * -0.57 + p.y * 1.43, p.x * 1.19 + p.y * 0.53) + vec2(-7.4, 13.1));
  return (a + b + c) / 3.0;
}

float halftoneOverlayNoise(vec2 p) {
  float coarse = halftoneNoise(p * 0.73 + vec2(5.31, -8.17));
  float medium = halftoneNoise(vec2(p.x * 1.41 - p.y * 0.52, p.x * 0.67 + p.y * 1.28) + vec2(-11.4, 4.6));
  float fine = halftoneNoise(vec2(p.x * -0.88 + p.y * 1.19, p.x * -1.07 - p.y * 0.79) + vec2(8.2, 10.7));
  return coarse * 0.45 + medium * 0.35 + fine * 0.2;
}

int getStepCount(int styleType) {
  if (styleType == 1) {
    return 6;
  }
  if (styleType == 3) {
    return 6;
  }
  if (styleType == 0) {
    return 2;
  }
  return 1;
}

vec4 halftoneFragment(vec2 vUv) {
  vec4 sourceSample = textureLod(uInputTex, vUv, 0.0);
  float sourceAlpha = sourceSample.a;
  if (sourceAlpha <= 0.0001) {
    return vec4(0.0);
  }

  vec2 dims = vec2(uWidth, uHeight);
  float aspect = max(dims.x / max(dims.y, 1.0), 0.0001);
  float size = clamp(uSize, 0.0, 1.0);
  float radius = clamp(uRadius, 0.0, 2.0);
  float contrastParam = clamp(uContrast, 0.0, 1.0);
  float invertedFlag = uInverted;
  float grainMixer = clamp(uGrainMixer, 0.0, 1.0);
  float grainOverlay = clamp(uGrainOverlay, 0.0, 1.0);
  float grainSizeParam = clamp(uGrainSize, 0.0, 1.0);
  int gridType = int(uGridType + 0.5);
  int styleType = int(uStyleType + 0.5);

  int stepCount = getStepCount(styleType);
  float stepSize = 1.0 / float(stepCount);

  float cellsPerSide = mix(300.0, 7.0, pow(size, 0.7));
  cellsPerSide /= float(stepCount);
  float cellSizeY = 1.0 / cellsPerSide;
  vec2 pad = cellSizeY * vec2(1.0 / aspect, 1.0);
  if (styleType == 1 && gridType == 1) {
    pad *= 0.7;
  }
  float rawCols = max(1.0, floor(1.0 / max(pad.x, 0.0001) + 0.5));
  float rawRows = max(1.0, floor(1.0 / max(pad.y, 0.0001) + 0.5));
  float cols = rawCols + (fract(rawCols * 0.5) < 0.25 ? 1.0 : 0.0);
  float rows = rawRows + (fract(rawRows * 0.5) < 0.25 ? 1.0 : 0.0);
  pad = vec2(1.0 / cols, 1.0 / rows);
  vec2 texelSize = 1.0 / max(dims, vec2(1.0));

  vec2 uv = vUv - 0.5;
  uv /= pad;

  float contrast = mix(0.0, 15.0, pow(contrastParam, 1.5));
  float baseRadius = radius;
  if (uOriginalColors > 0.5) {
    contrast = mix(0.1, 4.0, pow(contrastParam, 2.0));
    baseRadius = 2.0 * pow(0.5 * radius, 0.3);
  }

  float totalShape = 0.0;
  vec3 totalColor = vec3(0.0);
  float totalOpacity = 0.0;

  for (int xi = 0; xi < 6; xi++) {
    if (xi >= stepCount) {
      continue;
    }
    for (int yi = 0; yi < 6; yi++) {
      if (yi >= stepCount) {
        continue;
      }
      vec2 offset = vec2(float(xi) / float(stepCount) - 0.5, float(yi) / float(stepCount) - 0.5);
      if (gridType == 1) {
        float rowIndex = float(yi);
        float colIndex = float(xi);
        if (stepCount == 1) {
          rowIndex = floor(uv.y + offset.y + 1.0);
          if (styleType == 1) {
            colIndex = floor(uv.x + offset.x + 1.0);
          }
        }
        if (styleType == 1) {
          if (fract((rowIndex + colIndex) * 0.5) >= 0.5) {
            continue;
          }
        } else if (fract(rowIndex * 0.5) >= 0.5) {
          offset.x += 0.5 * stepSize;
        }
      }

      vec2 pp = uv + offset;
      vec2 uv_i = floor(pp);
      vec2 uv_f = fract(pp);
      vec2 samplingUV = (uv_i + 0.5 - offset) * pad + 0.5;
      vec2 safeSamplingUV = clamp(samplingUV, texelSize * 0.5, vec2(1.0) - texelSize * 0.5);
      float lum = getLumAtPx(safeSamplingUV, contrast, invertedFlag);
      if (grainMixer > 0.001) {
        float grainSizeCurve = pow(grainSizeParam, 0.72);
        float grainDomainScale = mix(2600.0, 55.0, grainSizeCurve);
        vec2 grainDomain = safeSamplingUV * grainDomainScale + offset * 37.0 + vec2(21.0, -14.0);
        float grainPrimary = halftoneOverlayNoise(grainDomain * mix(1.15, 0.2, grainSizeCurve));
        float grainSecondary = halftoneNoise(
          grainDomain * mix(2.1, 0.38, grainSizeCurve) +
          uv_f * mix(14.0, 4.0, grainSizeCurve)
        );
        float edgeWeight = 1.0 - abs(lum * 2.0 - 1.0);
        float lumJitter = (grainSecondary * 2.0 - 1.0) * (0.08 + 0.32 * grainMixer) * (0.3 + 0.7 * edgeWeight);
        float lumCut = smoothstep(0.45, 0.85 - 0.2 * grainMixer, grainPrimary) * grainMixer * (0.1 + 0.8 * edgeWeight);
        lum = clamp(lum + lumJitter - lumCut, 0.0, 1.0);
      }
      vec4 sampledColor = textureLod(uInputTex, safeSamplingUV, 0.0);
      float sourceCoverage = sampledColor.a;
      if (sourceCoverage <= 0.0001) {
        continue;
      }
      vec3 ballColor = sampledColor.rgb * sourceCoverage;
      float ball = 0.0;
      if (styleType == 0) {
        ball = getCircle(uv_f, lum, baseRadius);
      } else if (styleType == 1) {
        ball = getGooeyBall(uv_f, lum, baseRadius, gridType);
      } else if (styleType == 2) {
        ball = getCircleWithHole(uv_f, lum, baseRadius);
      } else {
        ball = getSoftBall(uv_f, lum, baseRadius);
      }
      float shape = ball * sourceCoverage;
      vec3 color = ballColor * shape;
      // Accumulate premultiplied by shape to achieve correct averaging
      totalColor += color;
      totalShape += shape;
      totalOpacity += shape;
    }
  }

  float eps = 0.0001;
  // FreeCut divides totalColor/totalOpacity by max(totalShape, eps) to recover
  // average color; with premultiplied accumulation above, totalColor already
  // equals shape*ballColor so division yields correct mean.
  totalColor /= max(totalShape, eps);
  totalOpacity /= max(totalShape, eps);

  float finalShape = 0.0;
  if (styleType == 0) {
    finalShape = min(1.0, totalShape);
  } else if (styleType == 1) {
    float aa = 0.08;
    finalShape = smoothstep(0.5 - aa, 0.5 + aa, totalShape);
  } else if (styleType == 2) {
    finalShape = min(1.0, totalShape);
  } else {
    finalShape = totalShape;
  }

  float grainSizeCurve = pow(grainSizeParam, 0.72);
  vec2 grainScale = mix(3200.0, 42.0, grainSizeCurve) * vec2(1.0, 1.0 / aspect);
  vec2 grainUV = vUv * grainScale + vec2(13.1, -9.7);
  float edgeBand = pow(clamp(1.0 - abs(finalShape * 2.0 - 1.0), 0.0, 1.0), 0.55);
  float grainField = halftoneOverlayNoise(grainUV * mix(0.95, 0.16, grainSizeCurve));
  float grainDetail = halftoneNoise(
    grainUV * mix(1.9, 0.28, grainSizeCurve) +
    vec2(-17.3, 6.4)
  );
  float grainCut = smoothstep(0.42, 0.9, grainField);
  float grainWarp = (grainDetail * 2.0 - 1.0) * edgeBand * grainMixer * 0.24;
  float grainErode = edgeBand * grainCut * grainMixer * (0.35 + 1.75 * grainMixer);
  finalShape = clamp(finalShape + grainWarp - grainErode, 0.0, 1.0);

  vec3 finalColor = vec3(0.0);
  float finalOpacity = 0.0;
  if (uOriginalColors > 0.5) {
    finalColor = totalColor * finalShape;
    finalOpacity = totalOpacity * finalShape;
    vec3 bgColor = vec3(uBackR, uBackG, uBackB) * uBackA;
    finalColor += bgColor * (1.0 - finalOpacity);
    finalOpacity += uBackA * (1.0 - finalOpacity);
  } else {
    vec3 fgColor = vec3(uFrontR, uFrontG, uFrontB) * uFrontA;
    vec3 bgColor = vec3(uBackR, uBackG, uBackB) * uBackA;
    finalColor = fgColor * finalShape;
    finalOpacity = uFrontA * finalShape;
    finalColor += bgColor * (1.0 - finalOpacity);
    finalOpacity += uBackA * (1.0 - finalOpacity);
  }

  float grainOverlayNoise = halftoneOverlayNoise(grainUV * mix(0.9, 0.14, grainSizeCurve));
  grainOverlayNoise = pow(grainOverlayNoise, 1.3);
  float grainOverlayV = grainOverlayNoise * 2.0 - 1.0;
  vec3 grainOverlayColor = vec3(grainOverlayV >= 0.0 ? 1.0 : 0.0);
  float grainOverlayStrength = pow(clamp(grainOverlay * abs(grainOverlayV), 0.0, 1.0), 0.8) * 0.5;
  finalColor = mix(finalColor, grainOverlayColor, grainOverlayStrength);
  finalOpacity += 0.5 * grainOverlayStrength;

  finalOpacity = clamp(finalOpacity, 0.0, 1.0) * sourceAlpha;

  // Output STRAIGHT alpha (RGB not premultiplied) - the final blit premultiplies
  // once for the premultiplied output canvas. Multiplying RGB by sourceAlpha here
  // too would premultiply twice on masked/transparent content (sourceAlpha^2),
  // darkening the mask edge into a visible seam. Opaque pixels (sourceAlpha = 1)
  // are unchanged.
  return vec4(clamp(finalColor, vec3(0.0), vec3(1.0)), finalOpacity);
}`,
	schema: [
		{ name: 'colorFront', label: 'Front Color', type: 'color', default: '#2b2b2b' },
		{ name: 'colorBack', label: 'Back Color', type: 'color', default: '#f2f1e8' },
		{ name: 'originalColors', label: 'Original Colors', type: 'boolean', default: false },
		{ name: 'inverted', label: 'Inverted', type: 'boolean', default: false },
		{
			name: 'grid',
			label: 'Grid',
			type: 'select',
			default: 'hex',
			options: [
				{ value: 'hex', label: 'Hex' },
				{ value: 'square', label: 'Square' }
			]
		},
		{
			name: 'type',
			label: 'Type',
			type: 'select',
			default: 'gooey',
			options: [
				{ value: 'classic', label: 'Classic' },
				{ value: 'gooey', label: 'Gooey' },
				{ value: 'holes', label: 'Holes' },
				{ value: 'soft', label: 'Soft' }
			]
		},
		{ name: 'size', label: 'Size', default: 0.5, min: 0, max: 1, step: 0.01 },
		{ name: 'radius', label: 'Radius', default: 1.25, min: 0, max: 2, step: 0.01 },
		{ name: 'contrast', label: 'Contrast', default: 0.4, min: 0, max: 1, step: 0.01 },
		{ name: 'grainMixer', label: 'Grain Mixer', default: 0.2, min: 0, max: 1, step: 0.01 },
		{ name: 'grainOverlay', label: 'Grain Overlay', default: 0.2, min: 0, max: 1, step: 0.01 },
		{ name: 'grainSize', label: 'Grain Size', default: 0.5, min: 0, max: 1, step: 0.01 }
	],
	uniformValues: (params, width, height) => {
		const front = parseHexColor(String(params.colorFront ?? '#2b2b2b'), [
			43 / 255,
			43 / 255,
			43 / 255,
			1
		]);
		const back = parseHexColor(String(params.colorBack ?? '#f2f1e8'), [
			242 / 255,
			241 / 255,
			232 / 255,
			1
		]);
		const grid = params.grid === 'square' ? 0 : 1;
		const style = String(params.type ?? 'gooey');
		const styleType = style === 'classic' ? 0 : style === 'holes' ? 2 : style === 'soft' ? 3 : 1;
		return {
			uFrontR: front[0],
			uFrontG: front[1],
			uFrontB: front[2],
			uFrontA: front[3],
			uBackR: back[0],
			uBackG: back[1],
			uBackB: back[2],
			uBackA: back[3],
			uSize: readNumber(params, 'size', 0.5),
			uRadius: readNumber(params, 'radius', 1.25),
			uContrast: readNumber(params, 'contrast', 0.4),
			uOriginalColors: flag(params, 'originalColors', false),
			uInverted: flag(params, 'inverted', false),
			uGrainMixer: readNumber(params, 'grainMixer', 0.2),
			uGrainOverlay: readNumber(params, 'grainOverlay', 0.2),
			uGrainSize: readNumber(params, 'grainSize', 0.5),
			uGridType: grid,
			uStyleType: styleType,
			uWidth: width,
			uHeight: height
		};
	}
};
