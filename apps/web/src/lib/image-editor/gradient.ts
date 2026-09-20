import type {
	ImageEditorGradientStop,
	ImageEditorGradientValue,
	ImageEditorPaintPoint
} from './types';

const FALLBACK_STOPS: ImageEditorGradientStop[] = [
	{ offset: 0, color: '#f97316' },
	{ offset: 1, color: '#7c3aed' }
];

export function normalizedGradientStops(
	stops: ImageEditorGradientStop[],
	reverse = false
): ImageEditorGradientStop[] {
	const source = stops.length >= 2 ? stops : FALLBACK_STOPS;
	const normalized = source
		.map((stop) => ({
			offset: clamp(stop.offset, 0, 1),
			color: stop.color
		}))
		.sort((left, right) => left.offset - right.offset);
	return reverse
		? normalized.map((stop) => ({ offset: 1 - stop.offset, color: stop.color })).reverse()
		: normalized;
}

export function createImageEditorCanvasGradient(
	context: CanvasRenderingContext2D,
	gradient: ImageEditorGradientValue
): CanvasGradient {
	const stops = normalizedGradientStops(gradient.stops, gradient.reverse);
	const start = gradient.start;
	const end = safeGradientEnd(start, gradient.end);
	const deltaX = end.x - start.x;
	const deltaY = end.y - start.y;
	let canvasGradient: CanvasGradient;

	if (gradient.type === 'radial') {
		canvasGradient = context.createRadialGradient(
			start.x,
			start.y,
			0,
			start.x,
			start.y,
			Math.max(1, Math.hypot(deltaX, deltaY))
		);
	} else if (gradient.type === 'angle' && context.createConicGradient) {
		canvasGradient = context.createConicGradient(Math.atan2(deltaY, deltaX), start.x, start.y);
	} else if (gradient.type === 'reflected') {
		canvasGradient = context.createLinearGradient(start.x - deltaX, start.y - deltaY, end.x, end.y);
		const reflected = [
			...stops.map((stop) => ({
				offset: (1 - stop.offset) / 2,
				color: stop.color
			})),
			...stops.map((stop) => ({
				offset: 0.5 + stop.offset / 2,
				color: stop.color
			}))
		].sort((left, right) => left.offset - right.offset);
		for (const stop of reflected) canvasGradient.addColorStop(stop.offset, stop.color);
		return canvasGradient;
	} else {
		canvasGradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
	}

	for (const stop of stops) canvasGradient.addColorStop(stop.offset, stop.color);
	return canvasGradient;
}

export function retargetImageEditorGradient(
	gradient: ImageEditorGradientValue,
	type: ImageEditorGradientValue['type'],
	width: number,
	height: number
): ImageEditorGradientValue {
	const angle = Math.atan2(gradient.end.y - gradient.start.y, gradient.end.x - gradient.start.x);
	return orientImageEditorGradient({ ...gradient, type }, width, height, angle);
}

export function orientImageEditorGradient(
	gradient: ImageEditorGradientValue,
	width: number,
	height: number,
	angle: number
): ImageEditorGradientValue {
	const center = { x: width / 2, y: height / 2 };
	const direction = { x: Math.cos(angle), y: Math.sin(angle) };
	const radius = distanceToBounds(center, direction, width, height);
	const centered = gradient.type !== 'linear';
	return {
		...gradient,
		start: centered
			? center
			: {
					x: center.x - direction.x * radius,
					y: center.y - direction.y * radius
				},
		end: {
			x: center.x + direction.x * radius,
			y: center.y + direction.y * radius
		}
	};
}

export function paintImageEditorCanvasGradient(
	context: CanvasRenderingContext2D,
	gradient: ImageEditorGradientValue,
	width: number,
	height: number
): void {
	if (gradient.type !== 'diamond') {
		context.fillStyle = createImageEditorCanvasGradient(context, gradient);
		context.fillRect(0, 0, width, height);
		return;
	}

	const image = context.createImageData(width, height);
	const palette = createGradientPalette(gradient);
	const end = safeGradientEnd(gradient.start, gradient.end);
	const deltaX = end.x - gradient.start.x;
	const deltaY = end.y - gradient.start.y;
	const length = Math.max(1, Math.hypot(deltaX, deltaY));
	const cosine = deltaX / length;
	const sine = deltaY / length;
	for (let y = 0; y < height; y++) {
		const relativeY = y + 0.5 - gradient.start.y;
		for (let x = 0; x < width; x++) {
			const relativeX = x + 0.5 - gradient.start.x;
			const rotatedX = relativeX * cosine + relativeY * sine;
			const rotatedY = -relativeX * sine + relativeY * cosine;
			const ratio = clamp((Math.abs(rotatedX) + Math.abs(rotatedY)) / length, 0, 1);
			const paletteIndex = Math.round(ratio * (GRADIENT_PALETTE_SIZE - 1)) * 4;
			const pixelIndex = (y * width + x) * 4;
			image.data[pixelIndex] = palette[paletteIndex];
			image.data[pixelIndex + 1] = palette[paletteIndex + 1];
			image.data[pixelIndex + 2] = palette[paletteIndex + 2];
			image.data[pixelIndex + 3] = palette[paletteIndex + 3];
		}
	}
	context.putImageData(image, 0, 0);
}

export function gradientRatioAtPoint(
	gradient: ImageEditorGradientValue,
	point: ImageEditorPaintPoint
): number {
	const start = gradient.start;
	const end = safeGradientEnd(start, gradient.end);
	const deltaX = end.x - start.x;
	const deltaY = end.y - start.y;
	const lengthSquared = Math.max(1, deltaX * deltaX + deltaY * deltaY);
	if (gradient.type === 'radial') {
		return clamp(Math.hypot(point.x - start.x, point.y - start.y) / Math.sqrt(lengthSquared), 0, 1);
	}
	if (gradient.type === 'angle') {
		const base = Math.atan2(deltaY, deltaX);
		const angle = Math.atan2(point.y - start.y, point.x - start.x) - base;
		return (((angle / (Math.PI * 2)) % 1) + 1) % 1;
	}
	if (gradient.type === 'diamond') {
		const length = Math.max(1, Math.hypot(deltaX, deltaY));
		const cosine = deltaX / length;
		const sine = deltaY / length;
		const relativeX = point.x - start.x;
		const relativeY = point.y - start.y;
		const rotatedX = relativeX * cosine + relativeY * sine;
		const rotatedY = -relativeX * sine + relativeY * cosine;
		return clamp((Math.abs(rotatedX) + Math.abs(rotatedY)) / length, 0, 1);
	}
	const projection = ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared;
	return gradient.type === 'reflected'
		? clamp(Math.abs(projection), 0, 1)
		: clamp(projection, 0, 1);
}

export function gradientColorAt(
	gradient: ImageEditorGradientValue,
	point: ImageEditorPaintPoint
): string {
	const stops = normalizedGradientStops(gradient.stops, gradient.reverse);
	const ratio = gradientRatioAtPoint(gradient, point);
	const rightIndex = stops.findIndex((stop) => stop.offset >= ratio);
	if (rightIndex <= 0) return stops[0].color;
	if (rightIndex < 0) return stops.at(-1)?.color ?? '#000000';
	const left = stops[rightIndex - 1];
	const right = stops[rightIndex];
	const span = Math.max(Number.EPSILON, right.offset - left.offset);
	return interpolateHex(left.color, right.color, (ratio - left.offset) / span);
}

function safeGradientEnd(
	start: ImageEditorPaintPoint,
	end: ImageEditorPaintPoint
): ImageEditorPaintPoint {
	return Math.hypot(end.x - start.x, end.y - start.y) < 0.5 ? { x: start.x + 1, y: start.y } : end;
}

const GRADIENT_PALETTE_SIZE = 1025;

function createGradientPalette(gradient: ImageEditorGradientValue): Uint8ClampedArray {
	const palette = new Uint8ClampedArray(GRADIENT_PALETTE_SIZE * 4);
	for (let index = 0; index < GRADIENT_PALETTE_SIZE; index++) {
		const ratio = index / (GRADIENT_PALETTE_SIZE - 1);
		const color = parseHex(
			gradientColorAt(gradient, {
				x: gradient.start.x + (gradient.end.x - gradient.start.x) * ratio,
				y: gradient.start.y + (gradient.end.y - gradient.start.y) * ratio
			})
		) ?? [0, 0, 0, 255];
		palette.set(color, index * 4);
	}
	return palette;
}

function distanceToBounds(
	center: ImageEditorPaintPoint,
	direction: ImageEditorPaintPoint,
	width: number,
	height: number
): number {
	const distances = [
		direction.x > Number.EPSILON ? (width - center.x) / direction.x : Number.POSITIVE_INFINITY,
		direction.x < -Number.EPSILON ? -center.x / direction.x : Number.POSITIVE_INFINITY,
		direction.y > Number.EPSILON ? (height - center.y) / direction.y : Number.POSITIVE_INFINITY,
		direction.y < -Number.EPSILON ? -center.y / direction.y : Number.POSITIVE_INFINITY
	].filter((value) => Number.isFinite(value) && value > 0);
	return Math.max(1, Math.min(...distances));
}

function interpolateHex(left: string, right: string, ratio: number): string {
	const leftRGBA = parseHex(left);
	const rightRGBA = parseHex(right);
	if (!leftRGBA || !rightRGBA) return ratio < 0.5 ? left : right;
	const channels = leftRGBA.map((value, index) =>
		Math.round(value + (rightRGBA[index] - value) * clamp(ratio, 0, 1))
	);
	return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(value: string): [number, number, number, number] | null {
	const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim());
	if (!match) return null;
	let hex = match[1];
	if (hex.length <= 4) hex = [...hex].map((character) => character + character).join('');
	if (hex.length === 6) hex += 'ff';
	return [
		Number.parseInt(hex.slice(0, 2), 16),
		Number.parseInt(hex.slice(2, 4), 16),
		Number.parseInt(hex.slice(4, 6), 16),
		Number.parseInt(hex.slice(6, 8), 16)
	];
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
