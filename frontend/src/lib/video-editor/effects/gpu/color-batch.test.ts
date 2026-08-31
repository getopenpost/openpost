import { describe, expect, it } from 'vitest';
import { MAX_INLINE_COLOR_EFFECTS, packColorBatch, planEffectPasses } from './color-batch';

const effect = (effectId: string, params: Record<string, number> = {}) => ({ effectId, params });

describe('inline color effect batching', () => {
	it('batches only consecutive supported effects and preserves order around other passes', () => {
		const effects = [
			effect('gpu-brightness'),
			effect('gpu-contrast'),
			effect('gpu-glow'),
			effect('gpu-saturation'),
			effect('gpu-sepia')
		];

		const passes = planEffectPasses(effects, true);

		expect(passes).toHaveLength(3);
		expect(passes[0]).toEqual({ kind: 'color-batch', effects: effects.slice(0, 2) });
		expect(passes[1]).toEqual({ kind: 'single', effect: effects[2] });
		expect(passes[2]).toEqual({ kind: 'color-batch', effects: effects.slice(3) });
	});

	it('bounds each batch and leaves a lone remainder on the established single-pass path', () => {
		const effects = Array.from({ length: MAX_INLINE_COLOR_EFFECTS + 1 }, () =>
			effect('gpu-invert')
		);

		const passes = planEffectPasses(effects, true);

		expect(passes).toHaveLength(2);
		expect(passes[0]).toMatchObject({ kind: 'color-batch' });
		if (passes[0]?.kind !== 'color-batch') throw new Error('Expected a color batch.');
		expect(passes[0].effects).toHaveLength(MAX_INLINE_COLOR_EFFECTS);
		expect(passes[1]).toEqual({ kind: 'single', effect: effects.at(-1) });
	});

	it('packs ordered parameters and the current animation time', () => {
		const packed = packColorBatch(
			[
				effect('gpu-hue-shift', { shift: 0.25, span: 0.5, flow: 2 }),
				effect('gpu-levels', {
					inputBlack: 0.1,
					inputWhite: 0.9,
					gamma: 1.2,
					outputBlack: 0.05,
					outputWhite: 0.95
				})
			],
			1920,
			1080,
			3
		);

		expect(packed.count).toBe(2);
		expect(Array.from(packed.kinds.slice(0, 2))).toEqual([4, 6]);
		expect(Array.from(packed.values0.slice(0, 4))).toEqual([0.25, 0.5, 2, 3]);
		expect(Array.from(packed.values0.slice(4, 8))).toEqual([
			expect.closeTo(0.1),
			expect.closeTo(0.9),
			expect.closeTo(1.2),
			expect.closeTo(0.05)
		]);
		expect(packed.values1[4]).toBeCloseTo(0.95);
	});
});
