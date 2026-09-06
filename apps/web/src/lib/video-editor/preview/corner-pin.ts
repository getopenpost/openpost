/**
 * Projective four-corner warp for Canvas2D preview and export.
 * Ported from FreeCut (MIT), runtime/composition-runtime/utils/corner-pin.ts.
 */

import type { TimelineItemCornerPin } from '../project/types';

type WarpContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CornerPinOffsets {
	topLeft: [number, number];
	topRight: [number, number];
	bottomRight: [number, number];
	bottomLeft: [number, number];
}

export type CornerPinKey = keyof CornerPinOffsets;

export interface CornerPinQuad {
	topLeft: [number, number];
	topRight: [number, number];
	bottomRight: [number, number];
	bottomLeft: [number, number];
}

export type CornerPinHomography = [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number
];

export function hasCornerPin(pin: CornerPinOffsets | undefined): boolean {
	if (!pin) return false;
	return (
		pin.topLeft[0] !== 0 ||
		pin.topLeft[1] !== 0 ||
		pin.topRight[0] !== 0 ||
		pin.topRight[1] !== 0 ||
		pin.bottomRight[0] !== 0 ||
		pin.bottomRight[1] !== 0 ||
		pin.bottomLeft[0] !== 0 ||
		pin.bottomLeft[1] !== 0
	);
}

export function resolveCornerPinForSize(
	pin: TimelineItemCornerPin | undefined,
	width: number,
	height: number
): CornerPinOffsets | undefined {
	if (!pin) return undefined;
	const referenceWidth =
		pin.referenceWidth && pin.referenceWidth > 1e-6 ? pin.referenceWidth : width;
	const referenceHeight =
		pin.referenceHeight && pin.referenceHeight > 1e-6 ? pin.referenceHeight : height;
	const scaleX = referenceWidth > 1e-6 ? width / referenceWidth : 1;
	const scaleY = referenceHeight > 1e-6 ? height / referenceHeight : 1;
	const scale = ([x, y]: [number, number]): [number, number] => [x * scaleX, y * scaleY];
	return {
		topLeft: scale(pin.topLeft),
		topRight: scale(pin.topRight),
		bottomRight: scale(pin.bottomRight),
		bottomLeft: scale(pin.bottomLeft)
	};
}

export function withCornerPinReferenceSize(
	pin: CornerPinOffsets,
	width: number,
	height: number
): TimelineItemCornerPin {
	return {
		...pin,
		referenceWidth: width > 0 ? width : undefined,
		referenceHeight: height > 0 ? height : undefined
	};
}

export function cornerPinPoints(
	width: number,
	height: number,
	pin: CornerPinOffsets
): CornerPinQuad {
	return {
		topLeft: [pin.topLeft[0], pin.topLeft[1]],
		topRight: [width + pin.topRight[0], pin.topRight[1]],
		bottomRight: [width + pin.bottomRight[0], height + pin.bottomRight[1]],
		bottomLeft: [pin.bottomLeft[0], height + pin.bottomLeft[1]]
	};
}

/** Map the source rectangle to the pinned quadrilateral. */
export function computeCornerPinHomography(
	width: number,
	height: number,
	pin: CornerPinOffsets
): CornerPinHomography {
	const points = cornerPinPoints(width, height, pin);
	const [x0, y0] = points.topLeft;
	const [x1, y1] = points.topRight;
	const [x2, y2] = points.bottomRight;
	const [x3, y3] = points.bottomLeft;
	const dx1 = x1 - x2;
	const dx2 = x3 - x2;
	const sx = x0 - x1 + x2 - x3;
	const dy1 = y1 - y2;
	const dy2 = y3 - y2;
	const sy = y0 - y1 + y2 - y3;
	const determinant = dx1 * dy2 - dy1 * dx2;
	if (Math.abs(determinant) < 1e-10) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
	const g = (sx * dy2 - sy * dx2) / determinant;
	const h = (dx1 * sy - dy1 * sx) / determinant;
	return [
		(x1 - x0 + g * x1) / width,
		(x3 - x0 + h * x3) / height,
		x0,
		(y1 - y0 + g * y1) / width,
		(y3 - y0 + h * y3) / height,
		y0,
		g / width,
		h / height,
		1
	];
}

export function projectCornerPinPoint(
	homography: CornerPinHomography,
	x: number,
	y: number
): [number, number] {
	const scale = homography[6] * x + homography[7] * y + homography[8];
	if (Math.abs(scale) < 1e-10) return [x, y];
	return [
		(homography[0] * x + homography[1] * y + homography[2]) / scale,
		(homography[3] * x + homography[4] * y + homography[5]) / scale
	];
}

function drawTexturedTriangle(
	context: WarpContext,
	source: CanvasImageSource,
	sourceTriangle: [number, number, number, number, number, number],
	destinationTriangle: [number, number, number, number, number, number]
): void {
	const [sx0, sy0, sx1, sy1, sx2, sy2] = sourceTriangle;
	const [dx0, dy0, dx1, dy1, dx2, dy2] = destinationTriangle;
	context.save();
	const centerX = (dx0 + dx1 + dx2) / 3;
	const centerY = (dy0 + dy1 + dy2) / 3;
	const expand = (x: number, y: number): [number, number] => {
		const offsetX = x - centerX;
		const offsetY = y - centerY;
		const length = Math.hypot(offsetX, offsetY);
		return length < 1e-6 ? [x, y] : [x + (offsetX / length) * 1.5, y + (offsetY / length) * 1.5];
	};
	const [ex0, ey0] = expand(dx0, dy0);
	const [ex1, ey1] = expand(dx1, dy1);
	const [ex2, ey2] = expand(dx2, dy2);
	context.beginPath();
	context.moveTo(ex0, ey0);
	context.lineTo(ex1, ey1);
	context.lineTo(ex2, ey2);
	context.closePath();
	context.clip();

	const determinant = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
	if (Math.abs(determinant) < 1e-10) {
		context.restore();
		return;
	}
	const inverse = 1 / determinant;
	const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * inverse;
	const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) * inverse;
	const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * inverse;
	const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) * inverse;
	const e =
		(dx0 * (sx1 * sy2 - sx2 * sy1) +
			dx1 * (sx2 * sy0 - sx0 * sy2) +
			dx2 * (sx0 * sy1 - sx1 * sy0)) *
		inverse;
	const f =
		(dy0 * (sx1 * sy2 - sx2 * sy1) +
			dy1 * (sx2 * sy0 - sx0 * sy2) +
			dy2 * (sx0 * sy1 - sx1 * sy0)) *
		inverse;
	context.transform(a, b, c, d, e, f);
	context.drawImage(source, 0, 0);
	context.restore();
}

/** Draw a source canvas through FreeCut's seam-safe projective mesh. */
export function drawCornerPinImage(
	context: WarpContext,
	source: CanvasImageSource,
	width: number,
	height: number,
	destinationX: number,
	destinationY: number,
	pin: CornerPinOffsets,
	subdivisions = 16
): void {
	const homography = computeCornerPinHomography(width, height, pin);
	for (let row = 0; row < subdivisions; row++) {
		for (let column = 0; column < subdivisions; column++) {
			const sx0 = (column / subdivisions) * width;
			const sy0 = (row / subdivisions) * height;
			const sx1 = ((column + 1) / subdivisions) * width;
			const sy1 = ((row + 1) / subdivisions) * height;
			const [x0, y0] = projectCornerPinPoint(homography, sx0, sy0);
			const [x1, y1] = projectCornerPinPoint(homography, sx1, sy0);
			const [x2, y2] = projectCornerPinPoint(homography, sx1, sy1);
			const [x3, y3] = projectCornerPinPoint(homography, sx0, sy1);
			drawTexturedTriangle(
				context,
				source,
				[sx0, sy0, sx1, sy0, sx1, sy1],
				[
					destinationX + x0,
					destinationY + y0,
					destinationX + x1,
					destinationY + y1,
					destinationX + x2,
					destinationY + y2
				]
			);
			drawTexturedTriangle(
				context,
				source,
				[sx0, sy0, sx1, sy1, sx0, sy1],
				[
					destinationX + x0,
					destinationY + y0,
					destinationX + x2,
					destinationY + y2,
					destinationX + x3,
					destinationY + y3
				]
			);
		}
	}
}
