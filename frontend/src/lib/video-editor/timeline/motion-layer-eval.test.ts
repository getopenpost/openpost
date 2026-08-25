import { describe, expect, it } from 'vitest';
import {
	applyMotionAnimationLayers,
	createMotionAnimationLayer,
	removeMotionAnimationLayers,
	getActiveMotionLayerChannels
} from './motion-layer-eval';
import type { ResolvedMotionTransform } from './motion-presets';

const anchor: ResolvedMotionTransform = {
	x: 100,
	y: 50,
	width: 200,
	height: 100,
	rotation: 10,
	opacity: 1
};

describe('motion animation layers', () => {
	it('stores preset output as additive position and multiplicative scale contributions', () => {
		const layer = createMotionAnimationLayer({
			name: 'Slide and zoom',
			source: 'built-in-preset',
			sourcePresetId: 'slide-in-left',
			anchor,
			payloads: [
				{ property: 'x', frame: 0, value: -100, easing: 'linear' },
				{ property: 'x', frame: 10, value: 100, easing: 'linear' },
				{ property: 'width', frame: 0, value: 100, easing: 'linear' },
				{ property: 'width', frame: 10, value: 200, easing: 'linear' }
			]
		});
		// At frame 5 midway: x (0) because -100+200 delta = 0 offset, width 150 (mid)
		const resolved = applyMotionAnimationLayers(anchor, [layer], 5);
		expect(resolved.x).toBeCloseTo(0);
		expect(resolved.width).toBeCloseTo(150);
	});

	it('layers on top of an independently animated pose', () => {
		const layer = createMotionAnimationLayer({
			name: 'Offset',
			source: 'built-in-preset',
			sourcePresetId: 'slide-in-right',
			anchor,
			payloads: [
				{ property: 'x', frame: 0, value: 140, easing: 'linear' },
				{ property: 'x', frame: 10, value: 100, easing: 'linear' }
			]
		});
		const posed = { ...anchor, x: 300 };
		expect(applyMotionAnimationLayers(posed, [layer], 0).x).toBe(340);
		expect(applyMotionAnimationLayers(posed, [layer], 10).x).toBe(300);
	});

	it('can invert its contribution for canvas edits without jump', () => {
		const layer = createMotionAnimationLayer({
			name: 'Pulse',
			source: 'built-in-preset',
			sourcePresetId: 'pulse',
			anchor,
			payloads: [
				{ property: 'x', frame: 0, value: 120, easing: 'linear' },
				{ property: 'width', frame: 0, value: 250, easing: 'linear' }
			]
		});
		const visual = applyMotionAnimationLayers(anchor, [layer], 0);
		expect(removeMotionAnimationLayers(visual, [layer], 0)).toEqual(anchor);
	});

	it('respects enabled flag and empty layers', () => {
		expect(applyMotionAnimationLayers(anchor, undefined, 5)).toBe(anchor);
		expect(applyMotionAnimationLayers(anchor, [], 5)).toBe(anchor);
		const disabled = createMotionAnimationLayer({
			name: 'Disabled',
			source: 'built-in-preset',
			sourcePresetId: 'fade-in',
			anchor,
			payloads: [{ property: 'x', frame: 0, value: 500, easing: 'linear' }]
		});
		disabled.enabled = false;
		expect(applyMotionAnimationLayers(anchor, [disabled], 0).x).toBe(anchor.x);
		expect(getActiveMotionLayerChannels([disabled])).toEqual([]);
		expect(
			getActiveMotionLayerChannels([
				createMotionAnimationLayer({
					name: 'A',
					source: 'built-in-preset',
					sourcePresetId: 'fade-in',
					anchor,
					payloads: [{ property: 'opacity', frame: 0, value: 0.5, easing: 'linear' }]
				})
			])
		).toEqual(['opacity']);
	});

	it('evaluates additive and multiplicative blending correctly', () => {
		const layer = createMotionAnimationLayer({
			name: 'Scale up',
			source: 'built-in-preset',
			sourcePresetId: 'zoom-in',
			anchor,
			payloads: [
				{ property: 'width', frame: 0, value: 100, easing: 'linear' },
				{ property: 'width', frame: 10, value: 400, easing: 'linear' }
			]
		});
		// anchor width 200 -> factors 0.5 and 2.0
		expect(applyMotionAnimationLayers(anchor, [layer], 0).width).toBeCloseTo(100);
		expect(applyMotionAnimationLayers(anchor, [layer], 10).width).toBeCloseTo(400);
		expect(applyMotionAnimationLayers(anchor, [layer], 5).width).toBeCloseTo(250);
	});

	it('sums multiple enabled layers', () => {
		const a = createMotionAnimationLayer({
			name: 'A',
			source: 'built-in-preset',
			sourcePresetId: 'slide-in-left',
			anchor,
			payloads: [{ property: 'x', frame: 0, value: 110, easing: 'linear' }]
		});
		const b = createMotionAnimationLayer({
			name: 'B',
			source: 'built-in-preset',
			sourcePresetId: 'slide-in-right',
			anchor,
			payloads: [{ property: 'x', frame: 0, value: 120, easing: 'linear' }]
		});
		// contributions: (110-100)=10 + (120-100)=20 =30
		expect(applyMotionAnimationLayers(anchor, [a, b], 0).x).toBe(130);
	});
});
