/** Exact CPU fallback for the 25-mode GPU blend contract. */

import type { BlendMode } from './blend-modes';

type Rgb = [number, number, number];

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const mapRgb = (left: Rgb, right: Rgb, fn: (a: number, b: number) => number): Rgb => [
	fn(left[0], right[0]),
	fn(left[1], right[1]),
	fn(left[2], right[2])
];

function rgbToHsl([red, green, blue]: Rgb): Rgb {
	const maximum = Math.max(red, green, blue);
	const minimum = Math.min(red, green, blue);
	const lightness = (maximum + minimum) * 0.5;
	if (maximum === minimum) return [0, 0, lightness];
	const delta = maximum - minimum;
	const saturation =
		lightness > 0.5
			? delta / (2 - maximum - minimum)
			: delta / Math.max(0.000_01, maximum + minimum);
	let hue: number;
	if (maximum === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
	else if (maximum === green) hue = (blue - red) / delta + 2;
	else hue = (red - green) / delta + 4;
	return [hue / 6, saturation, lightness];
}

function hueToRgb(p: number, q: number, raw: number): number {
	let value = raw;
	if (value < 0) value += 1;
	if (value > 1) value -= 1;
	if (value < 1 / 6) return p + (q - p) * 6 * value;
	if (value < 1 / 2) return q;
	if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
	return p;
}

function hslToRgb([hue, saturation, lightness]: Rgb): Rgb {
	if (saturation === 0) return [lightness, lightness, lightness];
	const q =
		lightness < 0.5
			? lightness * (1 + saturation)
			: lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	return [hueToRgb(p, q, hue + 1 / 3), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1 / 3)];
}

const luminance = ([red, green, blue]: Rgb) => red * 0.3 + green * 0.59 + blue * 0.11;

function setLuminance(color: Rgb, target: number): Rgb {
	const delta = target - luminance(color);
	let result: Rgb = [color[0] + delta, color[1] + delta, color[2] + delta];
	const minimum = Math.min(...result);
	const maximum = Math.max(...result);
	const current = luminance(result);
	if (minimum < 0) {
		const scale = (value: number) => current + ((value - current) * current) / (current - minimum);
		result = [scale(result[0]), scale(result[1]), scale(result[2])];
	}
	if (maximum > 1) {
		const scale = (value: number) =>
			current + ((value - current) * (1 - current)) / (maximum - current);
		result = [scale(result[0]), scale(result[1]), scale(result[2])];
	}
	return result;
}

function colorBurn(base: number, layer: number): number {
	return layer === 0 ? 0 : 1 - Math.min(1, (1 - base) / Math.max(layer, 0.001));
}

function colorDodge(base: number, layer: number): number {
	return layer === 1 ? 1 : Math.min(1, base / Math.max(1 - layer, 0.001));
}

export function applyBlendMode(base: Rgb, layer: Rgb, mode: BlendMode): Rgb {
	switch (mode) {
		case 'normal':
		case 'dissolve':
			return layer;
		case 'darken':
			return mapRgb(base, layer, Math.min);
		case 'multiply':
			return mapRgb(base, layer, (a, b) => a * b);
		case 'color-burn':
			return mapRgb(base, layer, colorBurn);
		case 'linear-burn':
			return mapRgb(base, layer, (a, b) => Math.max(a + b - 1, 0));
		case 'lighten':
			return mapRgb(base, layer, Math.max);
		case 'screen':
			return mapRgb(base, layer, (a, b) => 1 - (1 - a) * (1 - b));
		case 'color-dodge':
			return mapRgb(base, layer, colorDodge);
		case 'linear-dodge':
			return mapRgb(base, layer, (a, b) => Math.min(a + b, 1));
		case 'overlay':
			return mapRgb(base, layer, (a, b) => (a <= 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)));
		case 'soft-light':
			return mapRgb(base, layer, (a, b) =>
				b <= 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (Math.sqrt(a) - a)
			);
		case 'hard-light':
			return mapRgb(base, layer, (a, b) => (b <= 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)));
		case 'vivid-light':
			return mapRgb(base, layer, (a, b) =>
				b <= 0.5 ? colorBurn(a, 2 * b) : colorDodge(a, 2 * (b - 0.5))
			);
		case 'linear-light':
			return mapRgb(base, layer, (a, b) => clamp(a + 2 * b - 1));
		case 'pin-light':
			return mapRgb(base, layer, (a, b) =>
				b <= 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * (b - 0.5))
			);
		case 'hard-mix':
			return mapRgb(base, layer, (a, b) => (a + b >= 1 ? 1 : 0));
		case 'difference':
			return mapRgb(base, layer, (a, b) => Math.abs(a - b));
		case 'exclusion':
			return mapRgb(base, layer, (a, b) => a + b - 2 * a * b);
		case 'subtract':
			return mapRgb(base, layer, (a, b) => Math.max(a - b, 0));
		case 'divide':
			return mapRgb(base, layer, (a, b) => Math.min(a / Math.max(b, 0.001), 1));
		case 'hue': {
			const baseHsl = rgbToHsl(base);
			const layerHsl = rgbToHsl(layer);
			return hslToRgb([layerHsl[0], baseHsl[1], baseHsl[2]]);
		}
		case 'saturation': {
			const baseHsl = rgbToHsl(base);
			const layerHsl = rgbToHsl(layer);
			return hslToRgb([baseHsl[0], layerHsl[1], baseHsl[2]]);
		}
		case 'color': {
			const layerHsl = rgbToHsl(layer);
			return setLuminance(hslToRgb([layerHsl[0], layerHsl[1], 0.5]), luminance(base));
		}
		case 'luminosity':
			return setLuminance(base, luminance(layer));
	}
}

const f32 = Math.fround;
const fract32 = (value: number) => f32(value - Math.floor(value));

function hash21(x: number, y: number): number {
	const scale = f32(0.1031);
	const offset = f32(33.33);
	const p3: Rgb = [
		fract32(f32(f32(x) * scale)),
		fract32(f32(f32(y) * scale)),
		fract32(f32(f32(x) * scale))
	];
	const dot = f32(
		f32(p3[0] * f32(p3[1] + offset)) +
			f32(f32(p3[1] * f32(p3[2] + offset)) + f32(p3[2] * f32(p3[0] + offset)))
	);
	const q: Rgb = [f32(p3[0] + dot), f32(p3[1] + dot), f32(p3[2] + dot)];
	return fract32(f32(f32(q[0] + q[1]) * q[2]));
}

/** Blend a full-frame straight-alpha layer over a finished straight-alpha base. */
export function blendImageData(
	base: ImageData,
	layer: ImageData,
	mode: BlendMode,
	dissolveAlpha = 1
): ImageData {
	if (base.width !== layer.width || base.height !== layer.height) {
		throw new Error('CPU blend inputs must have matching dimensions.');
	}
	const output = new Uint8ClampedArray(base.data.length);
	for (let offset = 0; offset < output.length; offset += 4) {
		const pixelIndex = offset / 4;
		const x = pixelIndex % base.width;
		const y = Math.floor(pixelIndex / base.width);
		const baseColor: Rgb = [
			(base.data[offset] ?? 0) / 255,
			(base.data[offset + 1] ?? 0) / 255,
			(base.data[offset + 2] ?? 0) / 255
		];
		const layerColor: Rgb = [
			(layer.data[offset] ?? 0) / 255,
			(layer.data[offset + 1] ?? 0) / 255,
			(layer.data[offset + 2] ?? 0) / 255
		];
		const baseAlpha = (base.data[offset + 3] ?? 0) / 255;
		let sourceAlpha = (layer.data[offset + 3] ?? 0) / 255;
		if (mode === 'dissolve') {
			const threshold = clamp(dissolveAlpha);
			const seedX = f32(f32((x + 0.5) / base.width) * 1024);
			// ImageData is top-origin. WebGL fragment coordinates, and therefore
			// the shader's interpolated UV used as its seed, are bottom-origin.
			const framebufferY = base.height - 1 - y;
			const seedY = f32(f32((framebufferY + 0.5) / base.height) * 1024);
			const coverage = hash21(seedX, seedY) < threshold ? 1 : 0;
			sourceAlpha = coverage * clamp(sourceAlpha / Math.max(threshold, 0.000_01));
		}
		const blended = applyBlendMode(baseColor, layerColor, mode);
		const outputAlpha = sourceAlpha + baseAlpha * (1 - sourceAlpha);
		for (let channel = 0; channel < 3; channel++) {
			const premultiplied =
				(blended[channel] ?? 0) * baseAlpha * sourceAlpha +
				(layerColor[channel] ?? 0) * sourceAlpha * (1 - baseAlpha) +
				(baseColor[channel] ?? 0) * baseAlpha * (1 - sourceAlpha);
			output[offset + channel] =
				outputAlpha > 0.000_01 ? clamp(premultiplied / outputAlpha) * 255 : 0;
		}
		output[offset + 3] = outputAlpha * 255;
	}
	return new ImageData(output, base.width, base.height);
}
