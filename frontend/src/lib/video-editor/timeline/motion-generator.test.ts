import { describe, expect, it } from 'vitest';
import { applyMotionGeneratorSettings } from './motion-generator';
import {
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

function context(): MotionPresetBuildContext {
	return {
		anchor,
		durationInFrames: 90,
		fps: 30,
		frameWidth: 1920,
		frameHeight: 1080
	};
}

describe('motion generator settings', () => {
	it('scales values around the resting transform', () => {
		const preset = motionPresetById('slide-in-left');
		const payloads = applyMotionGeneratorSettings(preset, preset.build(context()), context(), {
			durationScale: 1,
			intensityScale: 0.5,
			staggerFrames: 0
		});
		const start = payloads.find((payload) => payload.property === 'x' && payload.frame === 0);
		expect(start?.value).toBeGreaterThan(-500);
		expect(start?.value).toBeLessThan(100);
	});

	it('retimes entrances from the start and exits toward the end', () => {
		const entrance = motionPresetById('fade-in');
		const entrancePayloads = applyMotionGeneratorSettings(
			entrance,
			entrance.build(context()),
			context(),
			{ durationScale: 2, intensityScale: 1, staggerFrames: 0 }
		);
		expect(entrancePayloads.at(-1)?.frame).toBe(30);

		const exit = motionPresetById('fade-out');
		const exitPayloads = applyMotionGeneratorSettings(exit, exit.build(context()), context(), {
			durationScale: 2,
			intensityScale: 1,
			staggerFrames: 0
		});
		expect(exitPayloads[0]?.frame).toBe(59);
		expect(exitPayloads.at(-1)?.frame).toBe(89);
	});

	it('delays entrances and pulls exits earlier for each staggered item', () => {
		const settings = { durationScale: 1, intensityScale: 1, staggerFrames: 3 };
		const entrance = motionPresetById('fade-in');
		const exit = motionPresetById('fade-out');
		const entrancePayloads = applyMotionGeneratorSettings(
			entrance,
			entrance.build(context()),
			context(),
			settings,
			2
		);
		const exitPayloads = applyMotionGeneratorSettings(
			exit,
			exit.build(context()),
			context(),
			settings,
			2
		);
		expect(entrancePayloads[0]?.frame).toBe(6);
		expect(exitPayloads.at(-1)?.frame).toBe(83);
	});

	it('clamps duration, intensity, and generated property bounds', () => {
		const preset = motionPresetById('zoom-in');
		const payloads = applyMotionGeneratorSettings(preset, preset.build(context()), context(), {
			durationScale: 99,
			intensityScale: 99,
			staggerFrames: -10
		});
		expect(payloads.every((payload) => payload.frame >= 0 && payload.frame < 90)).toBe(true);
		expect(payloads.find((payload) => payload.property === 'opacity')?.value).toBe(0);
		expect(
			payloads
				.filter((payload) => payload.property === 'width')
				.every((payload) => payload.value >= 1)
		).toBe(true);
	});
});
