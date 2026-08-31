import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	canvasLayersAtPoint,
	canvasPointFromClient,
	type CanvasLayerCandidate
} from './canvas-layer-picker';

function candidate(
	id: string,
	trackName: string,
	transform: CanvasLayerCandidate['transform']
): CanvasLayerCandidate {
	return {
		item: {
			id,
			trackId: `${id}-track`,
			from: 0,
			durationInFrames: 30,
			label: id,
			type: 'shape'
		} satisfies TimelineItem,
		trackName,
		transform
	};
}

describe('canvas layer picker', () => {
	it('maps the pointer into canvas space and returns overlapping layers top-first', () => {
		expect(
			canvasPointFromClient(300, 200, { left: 100, top: 100, width: 400, height: 200 }, 800, 400)
		).toEqual({
			x: 400,
			y: 200
		});

		const bottom = candidate('bottom', 'Video 2', {
			x: 0,
			y: 0,
			width: 300,
			height: 200,
			rotation: 0
		});
		const top = candidate('top', 'Video 1', {
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			rotation: 45,
			scaleX: 2,
			scaleY: 0.5
		});
		const elsewhere = candidate('elsewhere', 'Video 3', {
			x: 300,
			y: 0,
			width: 100,
			height: 100,
			rotation: 0
		});

		expect(canvasLayersAtPoint([bottom, top, elsewhere], { x: 400, y: 200 }, 800, 400)).toEqual([
			top,
			bottom
		]);
	});
});
