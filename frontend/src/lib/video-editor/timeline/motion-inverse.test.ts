import { describe, expect, it } from 'vitest';
import {
	applyMotionAnimationLayers,
	createMotionAnimationLayer,
	removeMotionAnimationLayers
} from './motion-layer-eval';
import {
	applyMotionModifiers,
	evaluateMotionModifiers,
	removeMotionModifiers
} from './motion-modifier-eval';
import type { ResolvedMotionTransform } from './motion-presets';
import type { MotionModifier } from '$lib/video-editor/project/types';

const anchor: ResolvedMotionTransform = {
	x: 100,
	y: 50,
	width: 200,
	height: 100,
	scaleX: 1,
	scaleY: 1,
	rotation: 10,
	opacity: 0.8
};
const fps = 30;
const ctx = { frame: 10, fps, frameWidth: 1920, frameHeight: 1080 };

function layerAt(frame = 10): ReturnType<typeof createMotionAnimationLayer> {
	return createMotionAnimationLayer({
		name: 'Slide',
		source: 'built-in-preset',
		sourcePresetId: 'slide-in-left',
		anchor,
		payloads: [
			{ property: 'x', frame: 0, value: 80, easing: 'linear' },
			{ property: 'x', frame: 20, value: 100, easing: 'linear' },
			{ property: 'rotation', frame: 0, value: 20, easing: 'linear' },
			{ property: 'rotation', frame: 20, value: 10, easing: 'linear' },
			{ property: 'width', frame: 0, value: 100, easing: 'linear' },
			{ property: 'width', frame: 20, value: 200, easing: 'linear' }
		]
	});
}

function modifier(type: MotionModifier['type'] = 'float-drift'): MotionModifier {
	return {
		version: 2,
		id: 'm1',
		type,
		enabled: true,
		amplitude: 1,
		frequency: 0.625,
		phaseFrames: 0,
		seed: 1
	};
}

describe('canvas commit inverse with additive layers', () => {
	it('inverts position channel without double count', () => {
		const layer = layerAt();
		const base = { ...anchor };
		const visual = applyMotionAnimationLayers(base, [layer], 10);
		// visual.x = base.x + (90-100) = 90? Actually at frame10 midpoint: 90
		expect(visual.x).not.toBe(base.x);
		const intendedVisual = { ...visual, x: visual.x + 20, y: visual.y + 15 };
		const invertedBase = removeMotionAnimationLayers(intendedVisual, [layer], 10);
		const reapplied = applyMotionAnimationLayers(invertedBase, [layer], 10);
		expect(reapplied.x).toBeCloseTo(intendedVisual.x, 8);
		expect(reapplied.y).toBeCloseTo(intendedVisual.y, 8);
		// single gesture must not accumulate: base after invert should be base +20/+15
		expect(invertedBase.x).toBeCloseTo(base.x + 20, 8);
		expect(invertedBase.y).toBeCloseTo(base.y + 15, 8);
	});

	it('inverts rotation additive', () => {
		const layer = layerAt();
		const base = { ...anchor };
		const visual = applyMotionAnimationLayers(base, [layer], 10);
		const intended = { ...visual, rotation: visual.rotation + 12 };
		const inverted = removeMotionAnimationLayers(intended, [layer], 10);
		const reapplied = applyMotionAnimationLayers(inverted, [layer], 10);
		expect(reapplied.rotation).toBeCloseTo(intended.rotation, 8);
	});

	it('inverts size multiply without double count', () => {
		const layer = layerAt();
		const base = { ...anchor };
		const visual = applyMotionAnimationLayers(base, [layer], 10);
		// at frame10 width factor ~0.75? anchor 200 -> 150 visual?
		const intended = { ...visual, width: 300, height: 200 };
		const inverted = removeMotionAnimationLayers(intended, [layer], 10);
		const reapplied = applyMotionAnimationLayers(inverted, [layer], 10);
		expect(reapplied.width).toBeCloseTo(intended.width, 8);
		expect(reapplied.height).toBeCloseTo(intended.height, 8);
		// verify inversion actually divided
		expect(inverted.width).not.toBe(intended.width);
	});

	it('stacks multiple layers and inverts sum', () => {
		const a = createMotionAnimationLayer({
			name: 'A',
			source: 'built-in-preset',
			sourcePresetId: 'fade-in',
			anchor,
			payloads: [{ property: 'x', frame: 10, value: 110, easing: 'linear' }]
		});
		const b = createMotionAnimationLayer({
			name: 'B',
			source: 'built-in-preset',
			sourcePresetId: 'fade-in',
			anchor,
			payloads: [{ property: 'x', frame: 10, value: 130, easing: 'linear' }]
		});
		// contributions +10 and +30 = +40
		const visual = applyMotionAnimationLayers(anchor, [a, b], 10);
		expect(visual.x).toBe(140);
		const intended = { ...visual, x: 200 };
		const inverted = removeMotionAnimationLayers(intended, [a, b], 10);
		expect(inverted.x).toBe(160);
		expect(applyMotionAnimationLayers(inverted, [a, b], 10).x).toBe(200);
	});

	it('skips disabled layers', () => {
		const enabled = layerAt();
		const disabled = createMotionAnimationLayer({
			name: 'Disabled',
			source: 'built-in-preset',
			sourcePresetId: 'slide-in-left',
			anchor,
			payloads: [{ property: 'x', frame: 10, value: 500, easing: 'linear' }]
		});
		disabled.enabled = false;
		const visual = applyMotionAnimationLayers(anchor, [enabled, disabled], 10);
		const withEnabledOnly = applyMotionAnimationLayers(anchor, [enabled], 10);
		expect(visual.x).toBe(withEnabledOnly.x);
		const intended = { ...visual, x: visual.x + 25 };
		const inverted = removeMotionAnimationLayers(intended, [enabled, disabled], 10);
		expect(applyMotionAnimationLayers(inverted, [enabled, disabled], 10).x).toBe(intended.x);
	});

	it('combines layer and modifier inversion (layers after modifiers inverse order)', () => {
		const layer = layerAt();
		const mod = modifier('float-drift');
		const base = { ...anchor };
		const afterLayer = applyMotionAnimationLayers(base, [layer], ctx.frame);
		const visual = applyMotionModifiers(afterLayer, [mod], ctx);
		const delta = evaluateMotionModifiers([mod], ctx);
		const layerDelta = visual.x - (base.x + delta.dx);
		expect(layerDelta).not.toBe(0);
		const intended = {
			...visual,
			x: visual.x + 30,
			width: visual.width * 1.2,
			rotation: visual.rotation + 5
		};
		// inverse order: remove modifiers then layers
		const afterModRemove = removeMotionModifiers(intended, [mod], ctx);
		const baseInverted = removeMotionAnimationLayers(afterModRemove, [layer], ctx.frame);
		const reappliedLayer = applyMotionAnimationLayers(baseInverted, [layer], ctx.frame);
		const reapplied = applyMotionModifiers(reappliedLayer, [mod], ctx);
		expect(reapplied.x).toBeCloseTo(intended.x, 7);
		expect(reapplied.width).toBeCloseTo(intended.width, 7);
		expect(reapplied.rotation).toBeCloseTo(intended.rotation, 7);
	});
});
