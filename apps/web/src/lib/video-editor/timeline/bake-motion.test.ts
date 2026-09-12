import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { bakeMotionModifiersToKeyframes } from './bake-motion';

describe('bakeMotionModifiersToKeyframes', () => {
	it('does not bake motion-layer channels that the renderer does not apply', () => {
		const item: TimelineItem = {
			id: 'clip',
			trackId: 'video',
			from: 0,
			durationInFrames: 30,
			label: 'Clip',
			type: 'video',
			motionLayers: [
				{
					id: 'layer',
					name: 'Unused anchor',
					enabled: true,
					source: 'saved-preset',
					sourcePresetId: 'test',
					tracks: [
						{
							property: 'anchorX',
							blend: 'add',
							keyframes: [{ id: 'keyframe', frame: 0, value: 20, easing: 'linear' }]
						}
					]
				}
			]
		};

		expect(
			bakeMotionModifiersToKeyframes(item, { fps: 30, frameWidth: 1920, frameHeight: 1080 })
		).toEqual({
			keyframes: [],
			properties: []
		});
	});
});
