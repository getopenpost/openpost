import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { mediaDrawGeometry, scaleItemForCanvas } from './render-geometry';

const item: TimelineItem = {
	id: 'v',
	trackId: 't',
	from: 0,
	durationInFrames: 30,
	label: 'Video',
	type: 'video'
};

describe('mediaDrawGeometry', () => {
	it('fits untransformed media into the canvas', () => {
		expect(mediaDrawGeometry(item, 1920, 1080, 1280, 720)).toMatchObject({
			centerX: 640,
			centerY: 360,
			drawWidth: 1280,
			drawHeight: 720
		});
	});

	it('uses pixel offsets and explicit dimensions', () => {
		const transformed = {
			...item,
			transform: { x: 40, y: -20, width: 320, height: 180 }
		};
		expect(mediaDrawGeometry(transformed, 1920, 1080, 1280, 720)).toMatchObject({
			centerX: 680,
			centerY: 340,
			drawWidth: 320,
			drawHeight: 180
		});
	});

	it('maps fractional crop edges to a fixed destination viewport', () => {
		const cropped = {
			...item,
			crop: { left: 0.1, right: 0.2, top: 0.25, bottom: 0.25 }
		};
		expect(mediaDrawGeometry(cropped, 1000, 500, 1000, 500)).toMatchObject({
			sourceX: 0,
			sourceY: 0,
			sourceWidth: 1000,
			sourceHeight: 500,
			mediaRect: { x: 0, y: 0, width: 1000, height: 500 },
			viewportRect: { x: 100, y: 125, width: 700, height: 250 }
		});
	});

	it('scales project-space clip and text geometry for smaller exports', () => {
		const scaled = scaleItemForCanvas(
			{
				...item,
				fontSize: 48,
				textSpans: [
					{ text: 'Title', fontSize: 64, letterSpacing: 4 },
					{ text: 'Subtitle', fontSize: 32 }
				],
				strokeWidth: 4,
				transform: {
					x: 200,
					y: -100,
					width: 960,
					height: 540,
					cornerRadius: 20
				}
			},
			0.5,
			0.5
		);
		expect(scaled.transform).toMatchObject({
			x: 100,
			y: -50,
			width: 480,
			height: 270,
			cornerRadius: 10
		});
		expect(scaled.fontSize).toBe(24);
		expect(scaled.strokeWidth).toBe(2);
		expect(scaled.textSpans).toEqual([
			{ text: 'Title', fontSize: 32, letterSpacing: 2 },
			{ text: 'Subtitle', fontSize: 16 }
		]);
	});
});
