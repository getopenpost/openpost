import { describe, expect, it } from 'vitest';
import type { GpuEffect } from './types';
import type { TimelineItem } from '../project/types';
import { getGpuEffect, getGpuEffectDefaultParams } from './gpu/registry';
import { colorStringToKeyframeValue } from '../timeline/color-keyframes';
import {
	buildEffectKeyframeProperty,
	effectPropertyPatch,
	getAnimatableEffectPropertiesForItem,
	getGpuEffectKeyframeProperty,
	parseEffectKeyframeProperty,
	removeEffectKeyframes,
	resolveAnimatedEffectsAt
} from './effect-keyframes';

function gpuEffect(
	id: string,
	effectId: string,
	params = getGpuEffectDefaultParams(effectId)
): GpuEffect {
	return { id, type: 'gpu', effectId, enabled: true, params };
}

function item(effect: GpuEffect): TimelineItem {
	return {
		id: 'clip',
		trackId: 'track',
		from: 100,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		effects: [effect]
	};
}

describe('effect keyframe properties', () => {
	it('uses FreeCut stable property identifiers', () => {
		const property = buildEffectKeyframeProperty('gpu-contrast', 'instance-1', 'amount');
		expect(property).toBe('effect:gpu-contrast:instance-1:amount');
		expect(parseEffectKeyframeProperty(property)).toEqual({
			effectType: 'gpu-contrast',
			effectId: 'instance-1',
			paramName: 'amount'
		});
	});

	it('patches the exact effect instance without changing the rest of the stack', () => {
		const first = gpuEffect('first', 'gpu-contrast');
		const second = gpuEffect('second', 'gpu-contrast');
		const source = { ...item(first), effects: [first, second] };
		const property = getGpuEffectKeyframeProperty(second, 'amount')!;
		const patch = effectPropertyPatch(source, property, 2.25);
		expect(patch?.effects?.[0]).toBe(first);
		expect(patch?.effects?.[1]).toMatchObject({ id: 'second', params: { amount: 2.25 } });
	});
});

describe('animated effect resolution', () => {
	it('removes only lanes owned by the deleted effect instance', () => {
		const removed = buildEffectKeyframeProperty('gpu-contrast', 'old', 'amount');
		const kept = buildEffectKeyframeProperty('gpu-contrast', 'new', 'amount');
		expect(
			removeEffectKeyframes(
				{
					opacity: { frames: [0], values: [1] },
					[removed]: { frames: [0], values: [1] },
					[kept]: { frames: [0], values: [2] }
				},
				'old'
			)
		).toEqual({
			opacity: { frames: [0], values: [1] },
			[kept]: { frames: [0], values: [2] }
		});
	});
});
