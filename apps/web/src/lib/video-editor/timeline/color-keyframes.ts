/** Perceptual OKLCH color keyframes. Ported from FreeCut (MIT). */

import type { KeyframeTrack } from '$lib/video-editor/project/types';
import { applyEasing, applyEasingConfig } from './easing';

export const MIN_PACKED_COLOR = 0;
const MAX_PACKED_RGB = 0xffffff;
const RGBA_OFFSET = 0x100000000;
export const MAX_PACKED_COLOR = RGBA_OFFSET + 0xffffffff;

interface RgbaColor {
	r: number;
	g: number;
	b: number;
	a: number;
	hasAlpha: boolean;
}

interface OklchColor {
	l: number;
	c: number;
	h: number;
}

const OKLCH_CACHE_LIMIT = 512;
const oklchByPackedColor = new Map<number, OklchColor>();

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function clampChannel(value: number): number {
	return clamp(Math.round(value), 0, 255);
}

function normalizePackedColor(value: number): number {
	if (!Number.isFinite(value)) return MIN_PACKED_COLOR;
	const rounded = Math.round(value);
	if (rounded <= MAX_PACKED_RGB) return clamp(rounded, MIN_PACKED_COLOR, MAX_PACKED_RGB);
	if (rounded < RGBA_OFFSET) return MAX_PACKED_RGB;
	return clamp(rounded, RGBA_OFFSET, MAX_PACKED_COLOR);
}

function rgbaToPacked({ r, g, b, a, hasAlpha }: RgbaColor): number {
	const red = clampChannel(r);
	const green = clampChannel(g);
	const blue = clampChannel(b);
	if (!hasAlpha) return red * 0x10000 + green * 0x100 + blue;
	return RGBA_OFFSET + red * 0x1000000 + green * 0x10000 + blue * 0x100 + clampChannel(a);
}

function packedToRgba(value: number): RgbaColor {
	const packed = normalizePackedColor(value);
	if (packed >= RGBA_OFFSET) {
		const rgba = packed - RGBA_OFFSET;
		return {
			r: Math.floor(rgba / 0x1000000) & 0xff,
			g: Math.floor(rgba / 0x10000) & 0xff,
			b: Math.floor(rgba / 0x100) & 0xff,
			a: rgba & 0xff,
			hasAlpha: true
		};
	}
	return {
		r: Math.floor(packed / 0x10000) & 0xff,
		g: Math.floor(packed / 0x100) & 0xff,
		b: packed & 0xff,
		a: 255,
		hasAlpha: false
	};
}

function srgbToLinear(channel: number): number {
	const value = clamp(channel / 255, 0, 1);
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
	const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
	return clamp(value, 0, 1) * 255;
}

function rgbaToOklch(color: RgbaColor): OklchColor {
	const red = srgbToLinear(color.r);
	const green = srgbToLinear(color.g);
	const blue = srgbToLinear(color.b);
	const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
	const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
	const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
	const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return {
		l: lightness,
		c: Math.hypot(a, b),
		h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
	};
}

function packedToOklch(value: number): OklchColor {
	const packed = normalizePackedColor(value);
	const cached = oklchByPackedColor.get(packed);
	if (cached) return { ...cached };
	const converted = rgbaToOklch(packedToRgba(packed));
	if (oklchByPackedColor.size >= OKLCH_CACHE_LIMIT) {
		const oldest = oklchByPackedColor.keys().next().value;
		if (oldest !== undefined) oklchByPackedColor.delete(oldest);
	}
	oklchByPackedColor.set(packed, converted);
	return { ...converted };
}

function oklchToRgb(color: OklchColor): Pick<RgbaColor, 'r' | 'g' | 'b'> {
	const hue = (color.h * Math.PI) / 180;
	const a = color.c * Math.cos(hue);
	const b = color.c * Math.sin(hue);
	const lRoot = color.l + 0.3963377774 * a + 0.2158037573 * b;
	const mRoot = color.l - 0.1055613458 * a - 0.0638541728 * b;
	const sRoot = color.l - 0.0894841775 * a - 1.291485548 * b;
	const l = lRoot ** 3;
	const m = mRoot ** 3;
	const s = sRoot ** 3;
	return {
		r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
	};
}

function interpolateOklch(previous: number, next: number, progress: number): number {
	const previousRgba = packedToRgba(previous);
	const nextRgba = packedToRgba(next);
	const previousOklch = packedToOklch(previous);
	const nextOklch = packedToOklch(next);
	if (previousOklch.c < 1e-7) previousOklch.h = nextOklch.h;
	if (nextOklch.c < 1e-7) nextOklch.h = previousOklch.h;
	const hueDelta = ((nextOklch.h - previousOklch.h + 540) % 360) - 180;
	return rgbaToPacked({
		...oklchToRgb({
			l: previousOklch.l + (nextOklch.l - previousOklch.l) * progress,
			c: previousOklch.c + (nextOklch.c - previousOklch.c) * progress,
			h: previousOklch.h + hueDelta * progress
		}),
		a: previousRgba.a + (nextRgba.a - previousRgba.a) * progress,
		hasAlpha: previousRgba.hasAlpha || nextRgba.hasAlpha
	});
}

export function normalizeHexColor(value: string): string | null {
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
	if (!match) return null;
	const hex = match[1];
	if (!hex) return null;
	if (hex.length === 3 || hex.length === 4) {
		return `#${[...hex]
			.map((character) => character + character)
			.join('')
			.toLowerCase()}`;
	}
	return `#${hex.toLowerCase()}`;
}

export function colorStringToKeyframeValue(value: string): number | null {
	const normalized = normalizeHexColor(value);
	if (!normalized) return null;
	const hex = normalized.slice(1);
	return hex.length === 6 ? Number.parseInt(hex, 16) : RGBA_OFFSET + Number.parseInt(hex, 16);
}

export function keyframeValueToHexColor(value: number): string {
	const normalized = normalizePackedColor(value);
	return normalized >= RGBA_OFFSET
		? `#${(normalized - RGBA_OFFSET).toString(16).padStart(8, '0')}`
		: `#${normalized.toString(16).padStart(6, '0')}`;
}

export function interpolateColorTrackToHex(
	track: KeyframeTrack,
	frame: number,
	baseColor: string
): string | null {
	const baseValue = colorStringToKeyframeValue(baseColor);
	if (baseValue === null || track.frames.length === 0) return baseColor;
	if (track.frames.length === 1 || frame <= (track.frames[0] ?? 0)) {
		return keyframeValueToHexColor(track.values[0] ?? baseValue);
	}
	const last = track.frames.length - 1;
	if (frame >= (track.frames[last] ?? 0)) {
		return keyframeValueToHexColor(track.values[last] ?? baseValue);
	}
	for (let index = 1; index <= last; index += 1) {
		const previousFrame = track.frames[index - 1];
		const nextFrame = track.frames[index];
		if (previousFrame === undefined || nextFrame === undefined || frame > nextFrame) continue;
		const progress = (frame - previousFrame) / Math.max(1, nextFrame - previousFrame);
		const config = track.easingConfigs?.[index - 1] ?? undefined;
		const eased = config
			? applyEasingConfig(progress, config)
			: applyEasing(progress, track.easings?.[index - 1] ?? 'linear');
		return keyframeValueToHexColor(
			interpolateOklch(
				track.values[index - 1] ?? baseValue,
				track.values[index] ?? baseValue,
				eased
			)
		);
	}
	return baseColor;
}
