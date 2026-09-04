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
});
