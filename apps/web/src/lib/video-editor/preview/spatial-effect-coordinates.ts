import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	computeCornerPinHomography,
	hasCornerPin,
	projectCornerPinPoint,
	resolveCornerPinForSize,
	type CornerPinHomography
} from '$lib/video-editor/preview/corner-pin';

export interface SpatialPoint {
	x: number;
	y: number;
}

export interface SpatialEffectCanvasGeometry {
	item: Pick<TimelineItem, 'transform' | 'crop' | 'cornerPin'>;
	canvasWidth: number;
	canvasHeight: number;
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function visibleSourceRange(item: Pick<TimelineItem, 'crop'>) {
	const crop = item.crop ?? {};
	const left = Math.min(0.999, Math.max(0, crop.left ?? 0));
	const right = Math.min(0.999, Math.max(0, crop.right ?? 0));
	const top = Math.min(0.999, Math.max(0, crop.top ?? 0));
	const bottom = Math.min(0.999, Math.max(0, crop.bottom ?? 0));
	return {
		left,
		top,
		width: Math.max(0.001, 1 - left - right),
		height: Math.max(0.001, 1 - top - bottom)
	};
}

function rotate(point: SpatialPoint, degrees: number): SpatialPoint {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return {
		x: point.x * cos - point.y * sin,
		y: point.x * sin + point.y * cos
	};
}

function invertHomography(matrix: CornerPinHomography): CornerPinHomography | null {
	const [a, b, c, d, e, f, g, h, i] = matrix;
	const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	if (Math.abs(determinant) < 1e-10) return null;
	const inverse = 1 / determinant;
	return [
		(e * i - f * h) * inverse,
		(c * h - b * i) * inverse,
		(b * f - c * e) * inverse,
		(f * g - d * i) * inverse,
		(a * i - c * g) * inverse,
		(c * d - a * f) * inverse,
		(d * h - e * g) * inverse,
		(b * g - a * h) * inverse,
		(a * e - b * d) * inverse
	];
}

function cornerPinMapping(
	item: Pick<TimelineItem, 'cornerPin'>,
	width: number,
	height: number
): { width: number; height: number; homography: CornerPinHomography } | null {
	const pinWidth = Math.max(1, Math.round(width));
	const pinHeight = Math.max(1, Math.round(height));
	const pin = resolveCornerPinForSize(item.cornerPin, pinWidth, pinHeight);
	return pin && hasCornerPin(pin)
		? {
				width: pinWidth,
				height: pinHeight,
				homography: computeCornerPinHomography(pinWidth, pinHeight, pin)
			}
		: null;
}

/**
 * OpenPost applies GPU effects to the full source texture before crop and item
 * transform. Convert the shader UV into the exact project-canvas point drawn by
 * preview and export.
 */
export function spatialEffectUvToCanvasPoint(
	point: SpatialPoint,
	geometry: SpatialEffectCanvasGeometry
): SpatialPoint {
	const { item, canvasWidth, canvasHeight } = geometry;
	const transform = item.transform ?? {};
	const width = Math.max(1, transform.width ?? canvasWidth);
	const height = Math.max(1, transform.height ?? canvasHeight);
	const anchorX = transform.anchorX ?? width / 2;
	const anchorY = transform.anchorY ?? height / 2;
	const source = visibleSourceRange(item);
	const visiblePoint = {
		x: ((point.x - source.left) / source.width) * width,
		y: ((point.y - source.top) / source.height) * height
	};
	const pin = cornerPinMapping(item, width, height);
	const projected = pin
		? projectCornerPinPoint(
				pin.homography,
				(visiblePoint.x / width) * pin.width,
				(visiblePoint.y / height) * pin.height
			)
		: ([visiblePoint.x, visiblePoint.y] as const);
	const local = { x: projected[0] - anchorX, y: projected[1] - anchorY };
	const flipped = {
		x: transform.flipHorizontal ? -local.x : local.x,
		y: transform.flipVertical ? -local.y : local.y
	};
	const rotated = rotate(flipped, transform.rotation ?? 0);
	return {
		x: canvasWidth / 2 + (transform.x ?? 0) + rotated.x,
		y: canvasHeight / 2 + (transform.y ?? 0) + rotated.y
	};
}

/** Reverse `spatialEffectUvToCanvasPoint` and clamp writes to shader UV bounds. */
export function canvasPointToSpatialEffectUv(
	point: SpatialPoint,
	geometry: SpatialEffectCanvasGeometry
): SpatialPoint {
	const { item, canvasWidth, canvasHeight } = geometry;
	const transform = item.transform ?? {};
	const width = Math.max(1, transform.width ?? canvasWidth);
	const height = Math.max(1, transform.height ?? canvasHeight);
	const anchorX = transform.anchorX ?? width / 2;
	const anchorY = transform.anchorY ?? height / 2;
	const centered = {
		x: point.x - canvasWidth / 2 - (transform.x ?? 0),
		y: point.y - canvasHeight / 2 - (transform.y ?? 0)
	};
	const unrotated = rotate(centered, -(transform.rotation ?? 0));
	const local = {
		x: transform.flipHorizontal ? -unrotated.x : unrotated.x,
		y: transform.flipVertical ? -unrotated.y : unrotated.y
	};
	const pin = cornerPinMapping(item, width, height);
	let visiblePoint = { x: local.x + anchorX, y: local.y + anchorY };
	if (pin) {
		const inverse = invertHomography(pin.homography);
		if (inverse) {
			const unprojected = projectCornerPinPoint(inverse, visiblePoint.x, visiblePoint.y);
			visiblePoint = {
				x: (unprojected[0] / pin.width) * width,
				y: (unprojected[1] / pin.height) * height
			};
		}
	}
	const source = visibleSourceRange(item);
	return {
		x: clampUnit(source.left + (visiblePoint.x / width) * source.width),
		y: clampUnit(source.top + (visiblePoint.y / height) * source.height)
	};
}
