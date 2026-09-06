import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	buildMotionPathPoints,
	calculateAnchorDrag,
	calculateCropFromDrag,
	calculateTransformResize,
	calculateTransformRotation,
	transformHandleCursor,
	transformHandlePoint
} from './on-canvas-tools';

describe('on-canvas crop geometry', () => {
	it('inverse-rotates pointer movement into the clip local axes', () => {
		const crop = calculateCropFromDrag({
			edge: 'left',
			startCrop: undefined,
			startPoint: { x: 0, y: 0 },
			currentPoint: { x: 0, y: 25 },
			rotation: 90,
			mediaWidth: 100,
			mediaHeight: 50,
			sourceDimension: 400
		});
		expect(crop.left).toBe(0.25);
	});

	it('keeps at least one intrinsic source pixel visible', () => {
		const crop = calculateCropFromDrag({
			edge: 'right',
			startCrop: { left: 0.25, right: 0, top: 0, bottom: 0 },
			startPoint: { x: 100, y: 0 },
			currentPoint: { x: -1000, y: 0 },
			rotation: 0,
			mediaWidth: 100,
			mediaHeight: 50,
			sourceDimension: 400
		});
		expect(crop.right).toBe(299 / 400);
	});
});

describe('on-canvas anchor geometry', () => {
	it('compensates position so a rotated layer does not jump', () => {
		const next = calculateAnchorDrag(
			{ x: 10, y: 20, width: 200, height: 100, rotation: 90 },
			{ x: 0, y: 0 },
			{ x: 0, y: 20 }
		);
		expect(next.anchorX).toBeCloseTo(120);
		expect(next.anchorY).toBeCloseTo(50);
		expect(next.x).toBeCloseTo(-10);
		expect(next.y).toBeCloseTo(40);
	});
});

describe('on-canvas transform geometry', () => {
	const transform = { x: 0, y: 0, width: 200, height: 100, rotation: 0 };

	it('does not flip through a handle or collapse below the FreeCut minimum', () => {
		const startPoint = transformHandlePoint({
			transform,
			handle: 'e',
			canvasWidth: 1000,
			canvasHeight: 500
		});
		const next = calculateTransformResize({
			startTransform: transform,
			handle: 'e',
			startPoint,
			currentPoint: { x: startPoint.x - 500, y: startPoint.y },
			maintainAspectRatio: false,
			oppositeAnchored: false,
			canvasWidth: 1000,
			canvasHeight: 500
		});
		expect(next).toMatchObject({ width: 20, height: 100 });
	});
});
