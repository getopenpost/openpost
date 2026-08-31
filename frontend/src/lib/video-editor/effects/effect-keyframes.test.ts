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

	it('exposes visible numeric and color params but excludes runtime quality controls', () => {
		const grain = gpuEffect('grain', 'gpu-grain');
		const grainProperties = getAnimatableEffectPropertiesForItem(item(grain));
		expect(grainProperties).toContain('effect:gpu-grain:grain:amount');
		expect(grainProperties).not.toContain('effect:gpu-grain:grain:speed');

		const ascii = gpuEffect('ascii', 'gpu-ascii');
		const sourceColorProperties = getAnimatableEffectPropertiesForItem(item(ascii));
		expect(sourceColorProperties).toContain('effect:gpu-ascii:ascii:colorSaturation');
		expect(sourceColorProperties).not.toContain('effect:gpu-ascii:ascii:textColor');

		ascii.params.matchSourceColor = false;
		const customColorProperties = getAnimatableEffectPropertiesForItem(item(ascii));
		expect(customColorProperties).toContain('effect:gpu-ascii:ascii:textColor');
		expect(customColorProperties).not.toContain('effect:gpu-ascii:ascii:colorSaturation');
	});

	it('matches FreeCut time-control and pixel-sort animation metadata', () => {
		const nonAnimatableTimeControls = [
			gpuEffect('hue', 'gpu-hue-shift'),
			gpuEffect('wave', 'gpu-trigger-wave'),
			gpuEffect('vhs', 'gpu-vhs')
		] as const;
		const paramNames = ['flow', 'speed', 'speed'] as const;

		for (const [index, effect] of nonAnimatableTimeControls.entries()) {
			expect(getGpuEffectKeyframeProperty(effect, paramNames[index]!)).toBeNull();
		}

		const pixelSort = gpuEffect('sort', 'gpu-pixel-sort');
		expect(getGpuEffectKeyframeProperty(pixelSort, 'length')).toBeNull();
	});

	it('keeps FreeCut animation and quality metadata on the owning schemas', () => {
		const metadata = [
			['gpu-gaussian-blur', 'samples', false, true],
			['gpu-motion-blur', 'samples', false, true],
			['gpu-radial-blur', 'samples', false, true],
			['gpu-zoom-blur', 'samples', false, true],
			['gpu-hue-shift', 'flow', false, undefined],
			['gpu-trigger-wave', 'speed', false, undefined],
			['gpu-grain', 'speed', false, undefined],
			['gpu-glow', 'rings', false, true],
			['gpu-glow', 'samplesPerRing', false, true],
			['gpu-scanlines', 'speed', false, undefined],
			['gpu-color-glitch', 'speed', false, undefined],
			['gpu-block-glitch', 'speed', false, undefined],
			['gpu-vhs', 'speed', false, undefined],
			['gpu-pixel-sort', 'length', false, true]
		] as const;

		for (const [effectId, paramName, animatable, quality] of metadata) {
			const schema = getGpuEffect(effectId)?.schema.find((param) => param.name === paramName);
			expect(schema?.quality, `${effectId}:${paramName}`).toBe(quality);
			expect(schema?.animatable, `${effectId}:${paramName}`).toBe(animatable);
		}
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
	it('resolves numeric and perceptual color tracks without mutating the source', () => {
		const contrast = gpuEffect('contrast', 'gpu-contrast');
		const ascii = gpuEffect('ascii', 'gpu-ascii', {
			...getGpuEffectDefaultParams('gpu-ascii'),
			matchSourceColor: false,
			textColor: '#ff0000'
		});
		const contrastProperty = getGpuEffectKeyframeProperty(contrast, 'amount')!;
		const colorProperty = getGpuEffectKeyframeProperty(ascii, 'textColor')!;
		const source: TimelineItem = {
			...item(contrast),
			effects: [contrast, ascii],
			keyframes: {
				[contrastProperty]: { frames: [0, 30], values: [1, 3] },
				[colorProperty]: {
					frames: [0, 30],
					values: [colorStringToKeyframeValue('#ff0000')!, colorStringToKeyframeValue('#0000ff')!]
				}
			}
		};
		const resolved = resolveAnimatedEffectsAt(source, 115);
		expect(resolved?.[0]?.type === 'gpu' ? resolved[0].params.amount : null).toBe(2);
		const color = resolved?.[1]?.type === 'gpu' ? resolved[1].params.textColor : null;
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
		expect(color).not.toBe('#ff0000');
		expect(contrast.params.amount).toBe(1);
		expect(ascii.params.textColor).toBe('#ff0000');
	});

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
