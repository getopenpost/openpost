import { describe, expect, it } from 'vitest';
import {
	MOTION_MODULATORS,
	motionModulatorScalesBox
} from '$lib/video-editor/timeline/motion-modulators';
import { motionPresetScalesBox } from '$lib/video-editor/timeline/actions/motion-presets';
import { MOTION_PRESETS } from '$lib/video-editor/timeline/motion-presets';

describe('motion box-scale gating', () => {
	it('marks every modulator thumbnail as looping', () => {
		for (const modulator of MOTION_MODULATORS) {
			expect(modulator.thumbnail.loop).toBe(true);
		}
	});

	it('keeps breath-pulse unflagged: it drives transform scale, not the box', () => {
		const breath = MOTION_MODULATORS.find((modulator) => modulator.id === 'breath-pulse')!;
		expect(breath.properties).toEqual(['scaleX', 'scaleY', 'opacity']);
		expect(motionModulatorScalesBox(breath)).toBe(false);
	});

	it('flags a box-scaling modulator so text clips gate it out', () => {
		expect(motionModulatorScalesBox({ ...MOTION_MODULATORS[0]!, scalesBox: true })).toBe(true);
	});

	it('detects width/height presets when they return', () => {
		expect(MOTION_PRESETS.every((preset) => !motionPresetScalesBox(preset))).toBe(true);
		expect(motionPresetScalesBox({ properties: ['scaleX', 'opacity'] })).toBe(false);
		expect(motionPresetScalesBox({ properties: ['width', 'opacity'] })).toBe(true);
		expect(motionPresetScalesBox({ properties: ['height'] })).toBe(true);
	});
});
