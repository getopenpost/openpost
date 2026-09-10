// Adapted from Paper Shaders 0.0.80 heatmap/liquid-metal image preparation
// (Apache-2.0). Operates on the current clip frame in preview and export workers.
// LICENSE and NOTICE are distributed under static/licenses/paper-shaders.

export type LogoMaskStyle = 'heatmap' | 'contour';
export type LogoMaskSource = 'alpha' | 'dark' | 'light';

function blur(gray: Uint8Array, width: number, height: number, radius: number): Uint8Array {
	const integral = new Uint32Array(width * height);
	const result = new Uint8Array(gray.length);
	for (let y = 0; y < height; y++) {
		let row = 0;
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			row += gray[i]!;
			integral[i] = row + (y ? integral[i - width]! : 0);
		}
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const left = Math.max(0, x - radius),
				right = Math.min(width - 1, x + radius);
			const top = Math.max(0, y - radius),
				bottom = Math.min(height - 1, y + radius);
			const sum =
				integral[bottom * width + right]! -
				(left ? integral[bottom * width + left - 1]! : 0) -
				(top ? integral[(top - 1) * width + right]! : 0) +
				(top && left ? integral[(top - 1) * width + left - 1]! : 0);
			result[y * width + x] = Math.round(sum / ((right - left + 1) * (bottom - top + 1)));
		}
	}
	return result;
}

function blurPasses(gray: Uint8Array, width: number, height: number, radius: number): Uint8Array {
	let result = gray;
	for (let pass = 0; pass < 3; pass++) result = blur(result, width, height, radius);
	return result;
}

export function prepareLogoMask(
	pixels: Uint8Array,
	width: number,
	height: number,
	source: LogoMaskSource,
	style: LogoMaskStyle
): Uint8Array {
	const alpha = new Uint8Array(width * height);
	for (let i = 0; i < alpha.length; i++) {
		const p = i * 4;
		const luminance = (0.299 * pixels[p]! + 0.587 * pixels[p + 1]! + 0.114 * pixels[p + 2]!) / 255;
		alpha[i] = Math.round(
			pixels[p + 3]! * (source === 'alpha' ? 1 : source === 'dark' ? 1 - luminance : luminance)
		);
	}
	const result = new Uint8Array(pixels.length);
	if (style === 'heatmap') {
		const gray = alpha.map((value) => 255 - value);
		const radius = Math.max(1, Math.round(Math.max(width, height) * 0.15));
		const outer = blurPasses(gray, width, height, radius);
		const inner = blurPasses(gray, width, height, Math.max(1, Math.round(radius * 0.12)));
		const contour = blur(
			gray,
			width,
			height,
			Math.max(1, Math.round(Math.max(width, height) * 0.005))
		);
		for (let i = 0; i < alpha.length; i++)
			result.set([contour[i]!, outer[i]!, inner[i]!, 255], i * 4);
		return result;
	}
	const red: number[] = [],
		black: number[] = [];
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const i = y * width + x;
			if (
				!alpha[i] ||
				!alpha[i - 1] ||
				!alpha[i + 1] ||
				!alpha[i - width] ||
				!alpha[i + width] ||
				!alpha[i - width - 1] ||
				!alpha[i - width + 1] ||
				!alpha[i + width - 1] ||
				!alpha[i + width + 1]
			)
				continue;
			((x + y) % 2 ? black : red).push(i);
		}
	}
	const field = new Float32Array(alpha.length);
	// Paper's red-black SOR solver: fixed iterations make seeking deterministic.
	const iterations = 40,
		relaxation = 1.9,
		forcing = 0.01;
	for (let iteration = 0; iteration < iterations; iteration++) {
		for (const group of [red, black]) {
			for (const i of group) {
				const next =
					(forcing + field[i - 1]! + field[i + 1]! + field[i - width]! + field[i + width]!) / 4;
				field[i] = relaxation * next + (1 - relaxation) * field[i]!;
			}
		}
	}
	let maximum = 0;
	for (const value of field) maximum = Math.max(maximum, value);
	for (let i = 0; i < alpha.length; i++) {
		const edge = maximum > 0 ? Math.round(255 * (1 - field[i]! / maximum)) : 255;
		result.set([edge, alpha[i]!, 255, 255], i * 4);
	}
	return result;
}
