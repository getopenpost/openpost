import { describe, expect, it } from 'vitest';
import type { MotionModifier } from '$lib/video-editor/project/types';
import { DEFAULT_MOTION_GENERATOR_SETTINGS } from './motion-generator';
import {
	applyMotionModifiers,
	createMotionModifier,
	evaluateMotionModifiers,
	getMotionModifierSettings,
	updateMotionModifierSettings,
	type MotionModifierEvalContext
} from './motion-modifier-eval';
import type { ResolvedMotionTransform } from './motion-presets';

const resting: ResolvedMotionTransform = {
	x: 100,
	y: 200,
	width: 400,
	height: 300,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	opacity: 0.9
};

function context(overrides: Partial<MotionModifierEvalContext> = {}): MotionModifierEvalContext {
	return { frame: 15, fps: 30, frameWidth: 1920, frameHeight: 1080, ...overrides };
}

function modifier(overrides: Partial<MotionModifier> = {}): MotionModifier {
	return {
		id: 'motion',
		type: 'float-drift',
		enabled: true,
		amplitude: 1,
		frequency: 0.625,
		phaseFrames: 0,
		seed: 1,
		...overrides
	};
}

describe('motion modifier evaluation', () => {
	it('is frame-rate independent at equal wall-clock time', () => {
		const at30 = evaluateMotionModifiers([modifier()], context({ frame: 15, fps: 30 }));
		const at60 = evaluateMotionModifiers([modifier()], context({ frame: 30, fps: 60 }));
		expect(at60.dx).toBeCloseTo(at30.dx, 6);
		expect(at60.dy).toBeCloseTo(at30.dy, 6);
		expect(at60.dRotation).toBeCloseTo(at30.dRotation, 6);
	});

	it('scales and sums deterministic contributions', () => {
		const weak = evaluateMotionModifiers([modifier({ amplitude: 0.5 })], context());
		const strong = evaluateMotionModifiers([modifier()], context());
		expect(strong.dx).toBeCloseTo(weak.dx * 2, 6);
		expect(strong.dy).toBeCloseTo(weak.dy * 2, 6);

		const shake = modifier({ type: 'micro-shake', frequency: 8, seed: 3 });
		const combined = evaluateMotionModifiers([modifier(), shake], context());
		const shakeOnly = evaluateMotionModifiers([shake], context());
		expect(combined.dx).toBeCloseTo(strong.dx + shakeOnly.dx, 6);
		expect(combined.dy).toBeCloseTo(strong.dy + shakeOnly.dy, 6);
	});

	it('uses a zero-allocation fast path when no modifier contributes', () => {
		expect(applyMotionModifiers(resting, undefined, context())).toBe(resting);
		expect(applyMotionModifiers(resting, [], context())).toBe(resting);
		expect(applyMotionModifiers(resting, [modifier({ enabled: false })], context())).toBe(resting);
		expect(applyMotionModifiers(resting, [modifier({ amplitude: 0 })], context())).toBe(resting);
	});

	it('layers drift around the resting pose without changing box or opacity', () => {
		const result = applyMotionModifiers(resting, [modifier()], context());
		expect(Math.abs(result.x - resting.x)).toBeGreaterThan(0);
		expect(Math.abs(result.x - resting.x)).toBeLessThanOrEqual(18);
		expect(result.width).toBe(resting.width);
		expect(result.opacity).toBe(resting.opacity);
	});

	it('breathes with render-time scale without changing layout bounds', () => {
		const breath = modifier({ type: 'breath-pulse', frequency: 0.55 });
		const result = applyMotionModifiers(
			{ ...resting, opacity: 1 },
			[breath],
			context({ frame: 13 })
		);
		expect(result.width).toBe(resting.width);
		expect(result.height).toBe(resting.height);
		expect(result.scaleX).not.toBe(resting.scaleX);
		expect(result.scaleY).not.toBe(resting.scaleY);
		expect(result.opacity).toBeGreaterThanOrEqual(0);
		expect(result.opacity).toBeLessThanOrEqual(1);
	});

	it('keeps micro-shake stable for a seed and frame', () => {
		const shake = modifier({ type: 'micro-shake', frequency: 8, seed: 5 });
		expect(evaluateMotionModifiers([shake], context({ frame: 9 }))).toEqual(
			evaluateMotionModifiers([shake], context({ frame: 9 }))
		);
	});

	it('stagger creates distinct phase and noise across a selection', () => {
		const settings = { ...DEFAULT_MOTION_GENERATOR_SETTINGS, staggerFrames: 4 };
		const first = createMotionModifier('float-drift', settings, 0);
		const second = createMotionModifier('float-drift', settings, 2);
		expect(first.phaseFrames).toBe(0);
		expect(second.phaseFrames).toBe(8);
		expect(second.seed).not.toBe(first.seed);
		expect(first.channelGains).toEqual({ x: 1, y: 1, rotation: 1 });
	});

	it('tunes and mutes channels independently while legacy records stay at full gain', () => {
		const xOnly = modifier({ channelGains: { x: 1, y: 0, rotation: 0 } });
		const result = evaluateMotionModifiers([xOnly], context());
		expect(result.dx).not.toBe(0);
		expect(result.dy).toBe(0);
		expect(result.dRotation).toBe(0);
		expect(evaluateMotionModifiers([modifier()], context())).toEqual(
			evaluateMotionModifiers(
				[modifier({ version: 2, channelGains: { x: 1, y: 1, rotation: 1 } })],
				context()
			)
		);
		const legacyBreath = modifier({
			type: 'breath-pulse',
			channelGains: { width: 0, height: 1, opacity: 0 }
		});
		const legacyResult = applyMotionModifiers(resting, [legacyBreath], context({ frame: 13 }));
		expect(legacyResult.scaleX).toBe(1);
		expect(legacyResult.scaleY).not.toBe(1);
	});

	it('round-trips and updates editable settings without replacing identity', () => {
		const created = createMotionModifier('breath-pulse', {
			...DEFAULT_MOTION_GENERATOR_SETTINGS,
			intensityScale: 1.4,
			durationScale: 2
		});
		expect(getMotionModifierSettings(created)).toMatchObject({
			intensityScale: 1.4,
			durationScale: 2
		});
		const updated = updateMotionModifierSettings(created, {
			intensityScale: 0.5,
			durationScale: 0.5,
			channelGains: { opacity: 0 }
		});
		expect(updated.id).toBe(created.id);
		expect(updated.seed).toBe(created.seed);
		expect(updated.amplitude).toBeCloseTo(0.5, 6);
		expect(updated.frequency).toBeCloseTo(1.1, 6);
		expect(updated.channelGains).toMatchObject({ scaleX: 1, scaleY: 1, opacity: 0 });
	});

	it('sways only rotation and spins continuously', () => {
		const sway = createMotionModifier('sway', DEFAULT_MOTION_GENERATOR_SETTINGS);
		const swayPeak = evaluateMotionModifiers([sway], context({ frame: 15 }));
		expect(swayPeak.dRotation).toBeCloseTo(4, 3);
		expect(swayPeak.dx).toBe(0);

		const spin = createMotionModifier('spin', DEFAULT_MOTION_GENERATOR_SETTINGS);
		const firstTurn = evaluateMotionModifiers([spin], context({ frame: 30 })).dRotation;
		const secondTurn = evaluateMotionModifiers([spin], context({ frame: 60 })).dRotation;
		expect(firstTurn).toBeCloseTo(108, 3);
		expect(secondTurn).toBeGreaterThan(firstTurn);
	});

	it('slows continuous motion as duration grows', () => {
		const fast = createMotionModifier('float-drift', {
			...DEFAULT_MOTION_GENERATOR_SETTINGS,
			durationScale: 1
		});
		const slow = createMotionModifier('float-drift', {
			...DEFAULT_MOTION_GENERATOR_SETTINGS,
			durationScale: 2
		});
		expect(slow.frequency).toBeCloseTo(fast.frequency / 2, 6);
	});
});
