/**
 * Cell-based ASCII renderer with a CPU-rasterized glyph atlas.
 *
 * Ported from FreeCut (MIT), infrastructure/gpu-effects/effects/stylize.ts.
 * The WebGL2 shader keeps FreeCut's grid, tone, edge, color, and alpha rules;
 * the atlas builder also works on the main thread when OffscreenCanvas is absent.
 */

import type { GpuDataTextureSpec, GpuParamValues, GpuShaderDefinition } from '../types';
import { parseHexColor, readNumber } from '../types';

interface StringLookup {
	[key: string]: string;
}

const ASCII_ATLAS_RAMPS: StringLookup = {
	ascii: '@%#*+=-:. ',
	dense: '@WB#$oahkbn+=-:. ',
	binary: '01',
	symbols: '#@&$%*+!=;:-. ',
	standard: '@%#*+=-:. ',
	simple: '@#*-. ',
	blocks: '█▓▒░ ',
	dots: '●•· ',
	minimal: 'x. '
};

const ASCII_FONT_STACK: StringLookup = {
	monospace: 'monospace',
	courier: '"Courier New", Courier, monospace',
	consolas: 'Consolas, "Lucida Console", monospace',
	lucida: '"Lucida Console", Monaco, monospace'
};

const ASCII_ATLAS_CELL = 24;
const ASCII_ATLAS_MAX_GLYPHS = 64;

function asciiAtlasRamp(params: GpuParamValues): string {
	if (params.charSet === 'custom') {
		const custom = String(params.customChars ?? '');
		const chars = [...custom].slice(0, ASCII_ATLAS_MAX_GLYPHS);
		return chars.length > 0 ? chars.join('') : ' ';
	}
	const charSet = String(params.charSet ?? 'ascii');
	return ASCII_ATLAS_RAMPS[charSet] ?? ASCII_ATLAS_RAMPS.ascii ?? '@%#*+=-:. ';
}

function buildAsciiAtlas(params: GpuParamValues) {
	const chars = [...asciiAtlasRamp(params)].slice(0, ASCII_ATLAS_MAX_GLYPHS);
	const cell = ASCII_ATLAS_CELL;
	const width = Math.max(chars.length, 1) * cell;
	const height = cell;
	const data = new Uint8Array(width * height * 4);
	const canvas =
		typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(width, height)
			: typeof document !== 'undefined'
				? Object.assign(document.createElement('canvas'), { width, height })
				: null;
	// SAFETY: both branches create a 2D canvas and request only its 2D context.
	const context = canvas?.getContext('2d', { willReadFrequently: true }) as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null
		| undefined;
	if (!context) {
		data.fill(255);
		return { width, height, data };
	}

	const font = String(params.font ?? 'monospace');
	context.clearRect(0, 0, width, height);
	context.fillStyle = '#ffffff';
	context.font = `${Math.round(cell * 0.82)}px ${ASCII_FONT_STACK[font] ?? ASCII_FONT_STACK.monospace}`;
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	for (let index = 0; index < chars.length; index++) {
		context.fillText(chars[index] ?? '', index * cell + cell / 2, cell / 2 + 1);
	}
	const pixels = context.getImageData(0, 0, width, height).data;
	for (let index = 0; index < width * height; index++) {
		const alpha = pixels[index * 4 + 3] ?? 0;
		data[index * 4] = alpha;
		data[index * 4 + 1] = alpha;
		data[index * 4 + 2] = alpha;
		data[index * 4 + 3] = alpha;
	}
	return { width, height, data };
}

export const asciiDataTexture: GpuDataTextureSpec = {
	key: (params) => `${asciiAtlasRamp(params)}|${String(params.font ?? 'monospace')}`,
	build: buildAsciiAtlas
};

function flag(params: GpuParamValues, name: string, fallback: boolean): number {
	return (params[name] ?? fallback) === true ? 1 : 0;
}

export const ascii: GpuShaderDefinition = {
	id: 'gpu-ascii',
	label: 'ASCII',
	category: 'stylize',
	entryPoint: 'asciiFragment',
	fragmentSource: /* glsl */ `
uniform sampler2D uAsciiAtlas;
uniform float uFontSize;
uniform float uLetterSpacing;
uniform float uLineHeight;
uniform float uMatchSourceColor;
uniform float uInvert;
uniform float uAsciiOpacity;
uniform float uOriginalOpacity;
uniform float uContrast;
uniform float uBrightness;
uniform float uSaturation;
uniform float uWidth;
uniform float uHeight;
uniform float uTransparentBg;
uniform float uEdgeDetect;
uniform float uGlyphCount;
uniform float uTextR;
uniform float uTextG;
uniform float uTextB;
uniform float uBgR;
uniform float uBgG;
uniform float uBgB;

ivec2 asciiClampCoord(ivec2 coord, ivec2 size) {
  return clamp(coord, ivec2(0), max(size - ivec2(1), ivec2(0)));
}

vec4 asciiLoad(ivec2 coord, ivec2 size) {
  return texelFetch(uInputTex, asciiClampCoord(coord, size), 0);
}

vec3 asciiAdjust(vec3 color) {
  return clamp((color - 0.5) * uContrast + 0.5 + vec3(uBrightness), vec3(0.0), vec3(1.0));
}

float asciiEdge(vec2 center, ivec2 size, float sx, float sy) {
  float tl = luminance601(asciiLoad(ivec2(center + vec2(-sx, -sy)), size).rgb);
  float tc = luminance601(asciiLoad(ivec2(center + vec2(0.0, -sy)), size).rgb);
  float tr = luminance601(asciiLoad(ivec2(center + vec2(sx, -sy)), size).rgb);
  float ml = luminance601(asciiLoad(ivec2(center + vec2(-sx, 0.0)), size).rgb);
  float mr = luminance601(asciiLoad(ivec2(center + vec2(sx, 0.0)), size).rgb);
  float bl = luminance601(asciiLoad(ivec2(center + vec2(-sx, sy)), size).rgb);
  float bc = luminance601(asciiLoad(ivec2(center + vec2(0.0, sy)), size).rgb);
  float br = luminance601(asciiLoad(ivec2(center + vec2(sx, sy)), size).rgb);
  return clamp(length(vec2((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl),
                           (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr))), 0.0, 1.0);
}

vec4 asciiFragment(vec2 vUv) {
  vec2 texSize = vec2(uWidth, uHeight);
  ivec2 texSizeI = ivec2(max(int(uWidth), 1), max(int(uHeight), 1));
  vec2 pixelPos = vUv * texSize;
  vec4 base = asciiLoad(ivec2(pixelPos), texSizeI);
  if (base.a <= 0.0001) return vec4(0.0);

  vec3 adjustedBase = asciiAdjust(base.rgb);
  vec3 background = mix(vec3(uBgR, uBgG, uBgB), adjustedBase, uOriginalOpacity);
  float cellWidth = max(uFontSize * max(0.25, 0.6 + uLetterSpacing * 0.05), 1.0);
  float cellHeight = max(uFontSize * max(uLineHeight, 0.25), 1.0);
  vec2 cells = max(vec2(1.0), floor(texSize / vec2(cellWidth, cellHeight)));
  vec2 gridSize = cells * vec2(cellWidth, cellHeight);
  vec2 origin = (texSize - gridSize) * 0.5;

  if (any(lessThan(pixelPos, origin)) || any(greaterThanEqual(pixelPos, origin + gridSize))) {
    if (uTransparentBg >= 0.5) return vec4(adjustedBase, base.a * uOriginalOpacity);
    return vec4(background, base.a);
  }

  vec2 gridPos = (pixelPos - origin) / vec2(cellWidth, cellHeight);
  vec2 localUv = fract(gridPos);
  vec2 samplePos = origin + (floor(gridPos) + 0.5) * vec2(cellWidth, cellHeight);
  vec4 sampleColor = asciiLoad(ivec2(samplePos), texSizeI);
  vec3 adjustedSample = asciiAdjust(sampleColor.rgb);
  float density = uEdgeDetect >= 0.5
    ? asciiEdge(samplePos, texSizeI, cellWidth, cellHeight)
    : luminance601(adjustedSample);
  if (uInvert >= 0.5) density = 1.0 - density;

  float count = max(uGlyphCount, 1.0);
  float glyph = clamp(floor(density * count), 0.0, count - 1.0);
  float atlasX = (glyph + clamp(localUv.x, 0.04, 0.96)) / count;
  float mask = texture(uAsciiAtlas, vec2(atlasX, localUv.y)).a;
  vec3 sourceGray = vec3(luminance601(adjustedSample));
  vec3 sourceColor = clamp(sourceGray + (adjustedSample - sourceGray) * uSaturation, 0.0, 1.0);
  vec3 glyphColor = uMatchSourceColor >= 0.5 ? sourceColor : vec3(uTextR, uTextG, uTextB);
  float inkAlpha = clamp(mask * uAsciiOpacity, 0.0, 1.0);

  if (uTransparentBg >= 0.5) {
    float underAlpha = uOriginalOpacity * (1.0 - inkAlpha);
    float outAlpha = inkAlpha + underAlpha;
    vec3 outRgb = (glyphColor * inkAlpha + adjustedBase * underAlpha) / max(outAlpha, 0.0001);
    return vec4(outRgb, base.a * outAlpha);
  }
  return vec4(mix(background, glyphColor, inkAlpha), base.a);
}`,
	schema: [
		{
			name: 'charSet',
			label: 'Character Set',
			type: 'select',
			default: 'ascii',
			options: [
				{ value: 'ascii', label: 'ASCII Ramp' },
				{ value: 'dense', label: 'Dense' },
				{ value: 'binary', label: 'Binary' },
				{ value: 'symbols', label: 'Symbols' },
				{ value: 'custom', label: 'Custom' },
				{ value: 'standard', label: 'Standard' },
				{ value: 'simple', label: 'Simple' },
				{ value: 'blocks', label: 'Blocks' },
				{ value: 'dots', label: 'Dots' },
				{ value: 'minimal', label: 'Minimal' }
			]
		},
		{
			name: 'customChars',
			label: 'Custom Characters',
			type: 'text',
			default: 'OPENPOST 01',
			maxLength: 64,
			visibleWhen: (p) => p.charSet === 'custom'
		},
		{
			name: 'font',
			label: 'Font',
			type: 'select',
			default: 'monospace',
			options: [
				{ value: 'monospace', label: 'Monospace' },
				{ value: 'courier', label: 'Courier' },
				{ value: 'consolas', label: 'Consolas' },
				{ value: 'lucida', label: 'Lucida Console' }
			]
		},
		{ name: 'fontSize', label: 'Font Size', default: 8, min: 4, max: 24, step: 1 },
		{ name: 'letterSpacing', label: 'Letter Spacing', default: 0, min: -2, max: 5, step: 0.1 },
		{ name: 'lineHeight', label: 'Line Height', default: 1, min: 0.5, max: 2, step: 0.1 },
		{ name: 'matchSourceColor', label: 'Match Source Color', type: 'boolean', default: true },
		{
			name: 'textColor',
			label: 'Text Color',
			type: 'color',
			default: '#ffffff',
			visibleWhen: (p) => p.matchSourceColor !== true
		},
		{
			name: 'bgColor',
			label: 'Background',
			type: 'color',
			default: '#0a0a0f',
			visibleWhen: (p) => p.transparentBg !== true
		},
		{ name: 'transparentBg', label: 'Transparent Background', type: 'boolean', default: false },
		{ name: 'edgeDetect', label: 'Edge Detection', type: 'boolean', default: false },
		{
			name: 'colorSaturation',
			label: 'Saturation',
			default: 100,
			min: 0,
			max: 200,
			step: 1,
			visibleWhen: (p) => p.matchSourceColor === true
		},
		{ name: 'asciiOpacity', label: 'ASCII Opacity', default: 100, min: 0, max: 100, step: 1 },
		{ name: 'originalOpacity', label: 'Original Opacity', default: 0, min: 0, max: 100, step: 1 },
		{ name: 'contrast', label: 'Contrast', default: 100, min: 50, max: 200, step: 1 },
		{ name: 'brightness', label: 'Brightness', default: 0, min: -100, max: 100, step: 1 },
		{ name: 'invert', label: 'Invert', type: 'boolean', default: false }
	],
	uniformValues: (params, width, height) => {
		const text = parseHexColor(String(params.textColor ?? '#ffffff'), [1, 1, 1, 1]);
		const background = parseHexColor(String(params.bgColor ?? '#0a0a0f'), [
			10 / 255,
			10 / 255,
			15 / 255,
			1
		]);
		return {
			uFontSize: readNumber(params, 'fontSize', 8),
			uLetterSpacing: readNumber(params, 'letterSpacing', 0),
			uLineHeight: readNumber(params, 'lineHeight', 1),
			uMatchSourceColor: flag(params, 'matchSourceColor', true),
			uInvert: flag(params, 'invert', false),
			uAsciiOpacity: readNumber(params, 'asciiOpacity', 100) / 100,
			uOriginalOpacity: readNumber(params, 'originalOpacity', 0) / 100,
			uContrast: readNumber(params, 'contrast', 100) / 100,
			uBrightness: readNumber(params, 'brightness', 0) / 255,
			uSaturation: readNumber(params, 'colorSaturation', 100) / 100,
			uWidth: width,
			uHeight: height,
			uTransparentBg: flag(params, 'transparentBg', false),
			uEdgeDetect: flag(params, 'edgeDetect', false),
			uGlyphCount: [...asciiAtlasRamp(params)].length,
			uTextR: text[0],
			uTextG: text[1],
			uTextB: text[2],
			uBgR: background[0],
			uBgG: background[1],
			uBgB: background[2]
		};
	},
	dataTexture: asciiDataTexture
};
