import type { EditorColorRenderEffect } from './rendering';

const SUPPORTED_EFFECTS = new Set([
	'gpu-brightness',
	'gpu-exposure',
	'gpu-contrast',
	'gpu-saturation',
	'gpu-vibrance',
	'gpu-hue-shift',
	'gpu-temperature',
	'gpu-color-wheels'
]);

function numberParam(effect: EditorColorRenderEffect, name: string, fallback: number): number {
	const value = Number(effect.params[name] ?? fallback);
	return Number.isFinite(value) ? value : fallback;
}

/** Exact Canvas2D fallback for the shared grade effects used by still images. */
export function renderColorEffectsWithCanvas2D(
	canvas: HTMLCanvasElement,
	source: TexImageSource,
	width: number,
	height: number,
	effects: readonly EditorColorRenderEffect[]
): boolean {
	if (effects.some((effect) => !SUPPORTED_EFFECTS.has(effect.effectId))) return false;
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return false;
	try {
		context.drawImage(source, 0, 0, width, height);
		const frame = context.getImageData(0, 0, width, height);
		applyColorEffectsToPixels(frame.data, effects);
		context.putImageData(frame, 0, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * CPU implementation of the canonical effect parameters.
 *
 * Channels are quantized after each effect, matching the inline GPU color batch.
 */
export function applyColorEffectsToPixels(
	pixels: Uint8ClampedArray,
	effects: readonly EditorColorRenderEffect[]
): void {
	for (const effect of effects) {
		for (let index = 0; index < pixels.length; index += 4) {
			let red = (pixels[index] ?? 0) / 255;
			let green = (pixels[index + 1] ?? 0) / 255;
			let blue = (pixels[index + 2] ?? 0) / 255;

			switch (effect.effectId) {
				case 'gpu-brightness': {
					const amount = numberParam(effect, 'amount', 0);
					red += amount;
					green += amount;
					blue += amount;
					break;
				}
				case 'gpu-exposure': {
					const multiplier = 2 ** numberParam(effect, 'exposure', 0);
					const offset = numberParam(effect, 'offset', 0);
					const gamma = Math.max(0.05, numberParam(effect, 'gamma', 1));
					red = Math.max(0, red * multiplier + offset) ** (1 / gamma);
					green = Math.max(0, green * multiplier + offset) ** (1 / gamma);
					blue = Math.max(0, blue * multiplier + offset) ** (1 / gamma);
					break;
				}
				case 'gpu-contrast': {
					const amount = numberParam(effect, 'amount', 1);
					red = (red - 0.5) * amount + 0.5;
					green = (green - 0.5) * amount + 0.5;
					blue = (blue - 0.5) * amount + 0.5;
					break;
				}
				case 'gpu-saturation': {
					[red, green, blue] = mixSaturation(red, green, blue, numberParam(effect, 'amount', 1));
					break;
				}
				case 'gpu-vibrance': {
					const maximum = Math.max(red, green, blue);
					const minimum = Math.min(red, green, blue);
					const saturation = (maximum - minimum) / (maximum + 0.001);
					[red, green, blue] = mixSaturation(
						red,
						green,
						blue,
						1 + numberParam(effect, 'amount', 0) * (1 - saturation)
					);
					break;
				}
				case 'gpu-hue-shift':
					[red, green, blue] = shiftHue(red, green, blue, numberParam(effect, 'shift', 0));
					break;
				case 'gpu-temperature': {
					const temperature = numberParam(effect, 'temperature', 0);
					const tint = numberParam(effect, 'tint', 0);
					red += temperature * 0.1 + tint * 0.05;
					green -= tint * 0.1;
					blue += -temperature * 0.1 + tint * 0.05;
					break;
				}
				case 'gpu-color-wheels': {
					const luma = luma601(red, green, blue);
					const shadowMask = 1 - smoothstep(0, 0.5, luma);
					const highlightMask = smoothstep(0.5, 1, luma);
					const adjustment =
						(numberParam(effect, 'shadows', 0) / 100) * shadowMask +
						(numberParam(effect, 'highlights', 0) / 100) * highlightMask;
					red += adjustment;
					green += adjustment;
					blue += adjustment;
					break;
				}
			}

			pixels[index] = quantize(red);
			pixels[index + 1] = quantize(green);
			pixels[index + 2] = quantize(blue);
		}
	}
}

function luma601(red: number, green: number, blue: number): number {
	return red * 0.299 + green * 0.587 + blue * 0.114;
}

function mixSaturation(red: number, green: number, blue: number, amount: number) {
	const gray = luma601(red, green, blue);
	return [
		gray + (red - gray) * amount,
		gray + (green - gray) * amount,
		gray + (blue - gray) * amount
	] as const;
}

function shiftHue(red: number, green: number, blue: number, shift: number) {
	const maximum = Math.max(red, green, blue);
	const minimum = Math.min(red, green, blue);
	const delta = maximum - minimum;
	let hue = 0;
	if (delta > 0) {
		if (maximum === red) hue = ((green - blue) / delta) % 6;
		else if (maximum === green) hue = (blue - red) / delta + 2;
		else hue = (red - green) / delta + 4;
		hue /= 6;
	}
	const saturation = maximum === 0 ? 0 : delta / maximum;
	return hsvToRgb((((hue + shift) % 1) + 1) % 1, saturation, maximum);
}

function hsvToRgb(hue: number, saturation: number, value: number) {
	const sector = Math.floor(hue * 6);
	const fraction = hue * 6 - sector;
	const low = value * (1 - saturation);
	const falling = value * (1 - fraction * saturation);
	const rising = value * (1 - (1 - fraction) * saturation);
	switch (sector % 6) {
		case 0:
			return [value, rising, low] as const;
		case 1:
			return [falling, value, low] as const;
		case 2:
			return [low, value, rising] as const;
		case 3:
			return [low, falling, value] as const;
		case 4:
			return [rising, low, value] as const;
		default:
			return [value, low, falling] as const;
	}
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const position = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
	return position * position * (3 - 2 * position);
}

function quantize(value: number): number {
	return Math.round(Math.max(0, Math.min(1, value)) * 255);
}
