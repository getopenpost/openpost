import { describe, expect, it } from 'vitest';
import type { ItemEffect } from './types';
import {
	autoBalanceFromFrame,
	blackPointFromPick,
	replaceColorGradeInStack,
	snapshotColorGrade,
	whiteBalanceFromPick,
	whitePointFromPick,
	withoutColorGradeEffects
} from './color-grade';

function grade(id: string, effectId = 'gpu-color-wheels'): ItemEffect {
	return { id, type: 'gpu', effectId, enabled: true, params: { lift: 0.2 } };
}

describe('color grade stacks', () => {
	it('replaces color effects in place and preserves non-grade effects', () => {
		const current: ItemEffect[] = [
			{ id: 'css', type: 'blur', amount: 2, enabled: true },
			grade('old-wheels'),
			{ id: 'blur', type: 'gpu', effectId: 'gpu-gaussian-blur', params: {}, enabled: true },
			grade('old-curves', 'gpu-curves')
		];
		let id = 0;
		const next = replaceColorGradeInStack(
			current,
			[
				{ effectId: 'gpu-color-wheels', params: { gain: 1.4 }, enabled: true },
				{ effectId: 'gpu-curves', params: { masterShadowY: 0.1 }, enabled: false }
			],
			() => `new-${++id}`
		);

		expect(next.map((effect) => effect.id)).toEqual(['css', 'new-1', 'new-2', 'blur']);
		expect(snapshotColorGrade(next)).toEqual([
			{ effectId: 'gpu-color-wheels', params: { gain: 1.4 }, enabled: true },
			{ effectId: 'gpu-curves', params: { masterShadowY: 0.1 }, enabled: false }
		]);
		expect(withoutColorGradeEffects(next).map((effect) => effect.id)).toEqual(['css', 'blur']);
	});
});

describe('color grade pickers', () => {
	it('leaves a neutral white-balance sample unchanged', () => {
		expect(whiteBalanceFromPick({ r: 0.5, g: 0.5, b: 0.5 }, 10, -5)).toEqual({
			temperature: 10,
			tint: -5
		});
	});

	it('corrects warm and green samples in the opposite direction', () => {
		expect(whiteBalanceFromPick({ r: 0.6, g: 0.5, b: 0.4 }, 0, 0)).toEqual({
			temperature: -100,
			tint: 0
		});
		expect(whiteBalanceFromPick({ r: 0.5, g: 0.6, b: 0.5 }, 0, 0)).toEqual({
			temperature: 0,
			tint: 66.6667
		});
	});

	it('uses frame percentiles for levels and the mean for white balance', () => {
		const data = new Uint8ClampedArray([
			3, 3, 3, 255, 128, 128, 128, 255, 250, 250, 250, 255, 0, 0, 0, 0
		]);
		const result = autoBalanceFromFrame(
			{ data, width: 3, height: 1 },
			{
				lift: 0,
				gain: 1,
				temperature: 0,
				tint: 0
			}
		);
		expect(result.lift).toBeCloseTo(-3 / 255, 4);
		expect(result.gain).toBeCloseTo(1 / ((250 - 3) / 255), 4);
		expect(result.temperature).toBe(0);
		expect(result.tint).toBe(0);
	});

	it('leaves the current correction unchanged for a fully transparent frame', () => {
		const current = { lift: -0.2, gain: 1.4, temperature: 12, tint: -8 };
		expect(
			autoBalanceFromFrame(
				{ data: new Uint8ClampedArray([255, 0, 0, 0]), width: 1, height: 1 },
				current
			)
		).toEqual(current);
	});
});
