import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { applyLottieColorOverrides, extractLottieColorLayers } from './color';
import {
	extractLottieAnimation,
	extractLottieManifest,
	extractLottieThemeData,
	parseLottieFileBytes
} from './metadata';
import { resolveLottieRenderSpec } from './render-spec';
import { extractLottieValueSlots } from './slots';
import { applyLottieTextOverrides, extractLottieTextLayers } from './text';

function templateAnimation(color: [number, number, number, number] = [1, 0, 0, 1]) {
	return {
		v: '5.12.2',
		w: 64,
		h: 64,
		fr: 30,
		ip: 0,
		op: 30,
		slots: {
			headline: { nm: 'Headline', p: { a: 1, k: [{ s: { t: 'Original' } }] } },
			opacity: { nm: 'Opacity', p: { a: 0, k: 80 } },
			offset: { nm: 'Offset', p: { a: 0, k: [12, -4] } },
			accent: { nm: 'Accent', p: { a: 0, k: color } }
		},
		layers: [
			{
				ty: 5,
				nm: 'Title fallback',
				t: { d: { sid: 'headline', k: [{ s: { t: 'Fallback' } }] } }
			},
			{
				ty: 4,
				nm: 'Art',
				shapes: [
					{ ty: 'fl', nm: 'Bound', c: { sid: 'accent' } },
					{ ty: 'fl', nm: 'Coat', c: { a: 0, k: [0, 0, 1, 1] } }
				]
			}
		]
	};
}

describe('advanced Lottie editing', () => {
	it('extracts and patches authored text and color slots', () => {
		const animation = templateAnimation();
		expect(extractLottieTextLayers(animation)).toEqual([
			{ key: 's:headline', text: 'Original', label: 'Headline' }
		]);
		expect(extractLottieColorLayers(animation)).toEqual([
			{ key: 's:accent', color: '#ff0000', label: 'Accent', named: true },
			{ key: 'c0', color: '#0000ff', label: 'Coat', named: true }
		]);

		const text = JSON.parse(applyLottieTextOverrides(animation, { 's:headline': 'OpenPost' })!);
		expect(text.slots.headline.p.k[0].s.t).toBe('OpenPost');
		expect(text.layers[0].t.d.k[0].s.t).toBe('OpenPost');

		const color = JSON.parse(applyLottieColorOverrides(animation, { 's:accent': '#00ff00' })!);
		expect(color.slots.accent.p.k).toEqual([0, 1, 0, 1]);
		expect(color.layers[1].shapes[0].c.k).toEqual([0, 1, 0, 1]);
	});
});
