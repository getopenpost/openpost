import { describe, expect, it } from 'vitest';
import {
	getMotionPresetAnchorFrame,
	MOTION_PRESETS,
	MOTION_PRESETS_BY_ID,
	motionPresetById,
	type MotionPresetBuildContext,
	type ResolvedMotionTransform
} from './motion-presets';

const anchor: ResolvedMotionTransform = {
	x: 100,
	y: 200,
	width: 400,
	height: 300,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	opacity: 1
};

function context(overrides: Partial<MotionPresetBuildContext> = {}): MotionPresetBuildContext {
	return {
		anchor,
		durationInFrames: 90,
		fps: 30,
		frameWidth: 1920,
		frameHeight: 1080,
		...overrides
	};
}

describe('motion presets', () => {
	it('keeps preset lookup aligned with unique catalog ids', () => {
		const ids = MOTION_PRESETS.map((preset) => preset.id);
		expect(new Set(ids)).toHaveLength(ids.length);
		expect(MOTION_PRESETS_BY_ID.size).toBe(ids.length);
	});

	it('writes only declared properties and keeps every key in bounds', () => {
		for (const preset of MOTION_PRESETS) {
			for (const keyframe of preset.build(context())) {
				expect(preset.properties).toContain(keyframe.property);
				expect(keyframe.frame).toBeGreaterThanOrEqual(0);
				expect(keyframe.frame).toBeLessThanOrEqual(89);
			}
		}
	});

	it('produces no keys for a single-frame clip', () => {
		for (const preset of MOTION_PRESETS) {
			expect(preset.build(context({ durationInFrames: 1 }))).toEqual([]);
		}
	});

	it('settles entrances on the anchor and starts exits from it', () => {
		const entrance = motionPresetById('slide-in-left').build(context());
		const entranceX = entrance.filter((keyframe) => keyframe.property === 'x');
		expect(entranceX[0]?.value).toBeLessThan(anchor.x);
		expect(entranceX.at(-1)?.value).toBe(anchor.x);

		const exit = motionPresetById('fade-out').build(context());
		expect(exit[0]).toMatchObject({ value: anchor.opacity });
		expect(exit.at(-1)).toMatchObject({ value: 0 });
	});

	it('uses the same category anchor frames as FreeCut', () => {
		expect(getMotionPresetAnchorFrame('entrance', 90, 30)).toBe(15);
		expect(getMotionPresetAnchorFrame('exit', 90, 30)).toBe(74);
		expect(getMotionPresetAnchorFrame('emphasis', 90, 30)).toBe(0);
	});

	it('uses render-time scale for presets that must preserve layout', () => {
		expect(motionPresetById('pulse').properties).toEqual(['scaleX', 'scaleY']);
		expect(motionPresetById('pop-in').properties).toEqual(['scaleX', 'scaleY', 'opacity']);
	});
});
