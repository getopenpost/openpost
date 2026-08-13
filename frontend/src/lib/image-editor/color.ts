export interface ImageEditorRGB {
	r: number;
	g: number;
	b: number;
}

export interface ImageEditorHSL {
	h: number;
	s: number;
	l: number;
}

export function normalizeHex(value: string, fallback = '#000000'): string {
	const candidate = value.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(candidate)) return candidate;
	if (/^#[0-9a-f]{8}$/.test(candidate) && candidate.endsWith('ff')) {
		return candidate.slice(0, 7);
	}
	if (/^#[0-9a-f]{3}$/.test(candidate)) {
		return `#${candidate
			.slice(1)
			.split('')
			.map((part) => `${part}${part}`)
			.join('')}`;
	}
	return fallback;
}

export function hexToRGB(value: string): ImageEditorRGB {
	const hex = normalizeHex(value).slice(1);
	return {
		r: Number.parseInt(hex.slice(0, 2), 16),
		g: Number.parseInt(hex.slice(2, 4), 16),
		b: Number.parseInt(hex.slice(4, 6), 16)
	};
}

export function rgbToHex({ r, g, b }: ImageEditorRGB): string {
	return `#${[r, g, b]
		.map((value) =>
			Math.round(clamp(value, 0, 255))
				.toString(16)
				.padStart(2, '0')
		)
		.join('')}`;
}

export function rgbToHSL({ r, g, b }: ImageEditorRGB): ImageEditorHSL {
	const red = clamp(r, 0, 255) / 255;
	const green = clamp(g, 0, 255) / 255;
	const blue = clamp(b, 0, 255) / 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;
	let hue = 0;
	if (delta > 0) {
		if (max === red) hue = ((green - blue) / delta) % 6;
		else if (max === green) hue = (blue - red) / delta + 2;
		else hue = (red - green) / delta + 4;
		hue *= 60;
		if (hue < 0) hue += 360;
	}
	const lightness = (max + min) / 2;
	const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	return {
		h: hue,
		s: saturation * 100,
		l: lightness * 100
	};
}

export function hslToRGB({ h, s, l }: ImageEditorHSL): ImageEditorRGB {
	const hue = ((h % 360) + 360) % 360;
	const saturation = clamp(s, 0, 100) / 100;
	const lightness = clamp(l, 0, 100) / 100;
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const segment = hue / 60;
	const second = chroma * (1 - Math.abs((segment % 2) - 1));
	let red = 0;
	let green = 0;
	let blue = 0;
	if (segment < 1) [red, green] = [chroma, second];
	else if (segment < 2) [red, green] = [second, chroma];
	else if (segment < 3) [green, blue] = [chroma, second];
	else if (segment < 4) [green, blue] = [second, chroma];
	else if (segment < 5) [red, blue] = [second, chroma];
	else [red, blue] = [chroma, second];
	const match = lightness - chroma / 2;
	return {
		r: Math.round((red + match) * 255),
		g: Math.round((green + match) * 255),
		b: Math.round((blue + match) * 255)
	};
}

export function hslToHex(value: ImageEditorHSL): string {
	return rgbToHex(hslToRGB(value));
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
