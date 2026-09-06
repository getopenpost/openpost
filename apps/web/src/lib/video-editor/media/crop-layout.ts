/** Crop layout and feather geometry ported from FreeCut (MIT). */
import type { CropSettings } from '$lib/video-editor/project/types';

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CropInsets {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface MediaCropLayout {
	mediaRect: Rect;
	cropViewportRect: Rect;
	viewportRect: Rect;
	featherPixels: CropInsets;
}

export type MediaCropFitMode = 'contain' | 'fill';

const MAX_EDGE_SUM = 0.999;

export function calculateMediaCropLayout(
	sourceWidth: number,
	sourceHeight: number,
	containerWidth: number,
	containerHeight: number,
	crop?: CropSettings,
	fitMode: MediaCropFitMode = 'contain'
): MediaCropLayout {
	const resolved = resolveCrop(crop);
	const mediaRect = resolveMediaRect(
		sourceWidth,
		sourceHeight,
		containerWidth,
		containerHeight,
		crop,
		resolved,
		fitMode
	);
	const cropPixels: CropInsets = {
		left: mediaRect.width * resolved.left,
		right: mediaRect.width * resolved.right,
		top: mediaRect.height * resolved.top,
		bottom: mediaRect.height * resolved.bottom
	};
	const cropViewportRect = {
		x: mediaRect.x + cropPixels.left,
		y: mediaRect.y + cropPixels.top,
		width: Math.max(0, mediaRect.width - cropPixels.left - cropPixels.right),
		height: Math.max(0, mediaRect.height - cropPixels.top - cropPixels.bottom)
	};
	const referenceDimension = Math.max(1, Math.min(mediaRect.width, mediaRect.height));
	const rawSoftnessPixels = resolved.softness * referenceDimension;
	const softnessPixels = Math.abs(rawSoftnessPixels);
	const outerExpansion: CropInsets =
		rawSoftnessPixels > 0
			? {
					left: cropPixels.left > 0 ? Math.min(softnessPixels, cropPixels.left) : 0,
					right: cropPixels.right > 0 ? Math.min(softnessPixels, cropPixels.right) : 0,
					top: cropPixels.top > 0 ? Math.min(softnessPixels, cropPixels.top) : 0,
					bottom: cropPixels.bottom > 0 ? Math.min(softnessPixels, cropPixels.bottom) : 0
				}
			: { left: 0, right: 0, top: 0, bottom: 0 };
	const rawX = cropViewportRect.x - outerExpansion.left;
	const rawY = cropViewportRect.y - outerExpansion.top;
	const rawRight =
		rawX + Math.max(0, cropViewportRect.width + outerExpansion.left + outerExpansion.right);
	const rawBottom =
		rawY + Math.max(0, cropViewportRect.height + outerExpansion.top + outerExpansion.bottom);
	const viewportRect = {
		x: Math.floor(rawX),
		y: Math.floor(rawY),
		width: Math.ceil(rawRight) - Math.floor(rawX),
		height: Math.ceil(rawBottom) - Math.floor(rawY)
	};
	const featherInput: CropInsets = {
		left: cropPixels.left > 0 ? (rawSoftnessPixels > 0 ? outerExpansion.left : softnessPixels) : 0,
		right:
			cropPixels.right > 0 ? (rawSoftnessPixels > 0 ? outerExpansion.right : softnessPixels) : 0,
		top: cropPixels.top > 0 ? (rawSoftnessPixels > 0 ? outerExpansion.top : softnessPixels) : 0,
		bottom:
			cropPixels.bottom > 0 ? (rawSoftnessPixels > 0 ? outerExpansion.bottom : softnessPixels) : 0
	};
	const [left, right] = clampFeatherAxis(featherInput.left, featherInput.right, viewportRect.width);
	const [top, bottom] = clampFeatherAxis(
		featherInput.top,
		featherInput.bottom,
		viewportRect.height
	);
	return {
		mediaRect,
		cropViewportRect,
		viewportRect,
		featherPixels: { left, right, top, bottom }
	};
}

export function hasCropFeather(feather: CropInsets): boolean {
	return feather.left > 0 || feather.right > 0 || feather.top > 0 || feather.bottom > 0;
}

export function applyCropFeatherMask(
	context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	viewport: Rect,
	feather: CropInsets
): void {
	if (viewport.width <= 0 || viewport.height <= 0) return;
	context.save();
	context.globalCompositeOperation = 'destination-in';
	if (feather.left > 0) {
		const gradient = context.createLinearGradient(viewport.x, 0, viewport.x + viewport.width, 0);
		gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
		gradient.addColorStop(clamp01(feather.left / viewport.width), 'rgba(0, 0, 0, 1)');
		gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
		fillMask(context, viewport, gradient);
	}
	if (feather.right > 0) {
		const gradient = context.createLinearGradient(viewport.x, 0, viewport.x + viewport.width, 0);
		gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
		gradient.addColorStop(
			clamp01((viewport.width - feather.right) / viewport.width),
			'rgba(0, 0, 0, 1)'
		);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
		fillMask(context, viewport, gradient);
	}
	if (feather.top > 0) {
		const gradient = context.createLinearGradient(0, viewport.y, 0, viewport.y + viewport.height);
		gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
		gradient.addColorStop(clamp01(feather.top / viewport.height), 'rgba(0, 0, 0, 1)');
		gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
		fillMask(context, viewport, gradient);
	}
	if (feather.bottom > 0) {
		const gradient = context.createLinearGradient(0, viewport.y, 0, viewport.y + viewport.height);
		gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
		gradient.addColorStop(
			clamp01((viewport.height - feather.bottom) / viewport.height),
			'rgba(0, 0, 0, 1)'
		);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
		fillMask(context, viewport, gradient);
	}
	context.restore();
}

function resolveCrop(crop?: CropSettings) {
	const [left, right] = clampAxisPair(clamp01(crop?.left ?? 0), clamp01(crop?.right ?? 0));
	const [top, bottom] = clampAxisPair(clamp01(crop?.top ?? 0), clamp01(crop?.bottom ?? 0));
	return { left, right, top, bottom, softness: clampSigned01(crop?.softness ?? 0) };
}

function resolveMediaRect(
	sourceWidth: number,
	sourceHeight: number,
	containerWidth: number,
	containerHeight: number,
	crop: CropSettings | undefined,
	resolved: ReturnType<typeof resolveCrop>,
	fitMode: MediaCropFitMode
): Rect {
	if (crop?.refit === true) {
		const remainingWidth = Math.max(1e-6, 1 - resolved.left - resolved.right);
		const remainingHeight = Math.max(1e-6, 1 - resolved.top - resolved.bottom);
		const fitted = containedRect(
			sourceWidth * remainingWidth,
			sourceHeight * remainingHeight,
			containerWidth,
			containerHeight
		);
		const scale = fitted.width / (sourceWidth * remainingWidth);
		return {
			x: fitted.x - sourceWidth * resolved.left * scale,
			y: fitted.y - sourceHeight * resolved.top * scale,
			width: sourceWidth * scale,
			height: sourceHeight * scale
		};
	}
	if (fitMode === 'fill') return { x: 0, y: 0, width: containerWidth, height: containerHeight };
	return containedRect(sourceWidth, sourceHeight, containerWidth, containerHeight);
}

function containedRect(
	sourceWidth: number,
	sourceHeight: number,
	containerWidth: number,
	containerHeight: number
): Rect {
	if (sourceWidth <= 0 || sourceHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
		return { x: 0, y: 0, width: Math.max(0, containerWidth), height: Math.max(0, containerHeight) };
	}
	const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
	const width = sourceWidth * scale;
	const height = sourceHeight * scale;
	return { x: (containerWidth - width) / 2, y: (containerHeight - height) / 2, width, height };
}

function fillMask(
	context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	viewport: Rect,
	gradient: CanvasGradient
): void {
	context.fillStyle = gradient;
	context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
}

function clampFeatherAxis(start: number, end: number, dimension: number): [number, number] {
	const safeStart = Math.max(0, Math.min(start, dimension));
	const safeEnd = Math.max(0, Math.min(end, dimension));
	const total = safeStart + safeEnd;
	if (total <= dimension) return [safeStart, safeEnd];
	if (total <= 0) return [0, 0];
	const scale = dimension / total;
	return [safeStart * scale, safeEnd * scale];
}

function clampAxisPair(start: number, end: number): [number, number] {
	const total = start + end;
	if (total <= MAX_EDGE_SUM) return [start, end];
	const scale = total <= 0 ? 0 : MAX_EDGE_SUM / total;
	return [start * scale, end * scale];
}

function clamp01(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function clampSigned01(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
}
