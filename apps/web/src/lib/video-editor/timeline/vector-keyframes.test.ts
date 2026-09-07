import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { promoteVectorKeyframes } from './vector-keyframes';

function videoItem(keyframes: TimelineItem['keyframes']): TimelineItem {
	return {
		id: 'a',
		trackId: 't',
		from: 0,
		durationInFrames: 100,
		label: '',
		type: 'video',
		transform: { x: 0, y: 0, width: 200, height: 100, opacity: 1, rotation: 0 },
		keyframes
	};
}

describe('promoteVectorKeyframes', () => {
	it('promotes the union of scalar frames with easing inheritance and source attribution', () => {
		const item = videoItem({
			x: {
				frames: [0, 10],
				values: [0, 100],
				ids: ['x0', 'x1'],
				easings: ['hold', 'linear']
			},
			y: {
				frames: [5, 10],
				values: [50, 60],
				ids: ['y0', 'y1'],
				easings: ['linear', 'linear']
			}
		});
		const promoted = promoteVectorKeyframes(item, 'position');
		expect(promoted).not.toBeNull();
		expect(promoted?.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 5, 10]);
		// Frame 5 inherits the outgoing segment easing of the x lane (hold).
		expect(promoted?.keyframes.find((keyframe) => keyframe.frame === 5)?.easing).toBe('hold');
		// The y key at frame 5 remaps to the coupled `:y` editor identity.
		const frame5 = promoted?.keyframes.find((keyframe) => keyframe.frame === 5);
		expect(promoted?.identityRemap.get('y0')).toBe(`${frame5?.id}:y`);
		expect(promoted?.identityRemap.get('x0')).toBe(
			promoted?.keyframes.find((keyframe) => keyframe.frame === 0)?.id
		);
	});

	it('converts scale lanes to percent against the authored box', () => {
		const item = videoItem({
			width: { frames: [0], values: [400], ids: ['w0'] }
		});
		const promoted = promoteVectorKeyframes(item, 'scale');
		expect(promoted?.keyframes.map((keyframe) => keyframe.frame)).toEqual([0]);
		// 400px against a 200px box promotes to 200%.
		expect(promoted?.keyframes[0]?.value.x).toBe(200);
		// Missing height falls back to the 100% base.
		expect(promoted?.keyframes[0]?.value.y).toBe(100);
	});

	it('returns null when no scalar tracks exist', () => {
		expect(promoteVectorKeyframes(videoItem(undefined), 'position')).toBeNull();
	});
});
