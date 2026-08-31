import { describe, expect, it } from 'vitest';
import { resolveColorGradeThumbnailTreatment } from './color-grade-thumbnail';
import type { ItemEffect } from './types';

function gpuEffect(
	effectId: string,
	params: Record<string, number | string | boolean>,
	enabled = true
): ItemEffect {
	return { id: effectId, type: 'gpu', effectId, params, enabled };
}

describe('color grade thumbnail fallback', () => {
	it('ignores disabled and non-color effects', () => {
		const treatment = resolveColorGradeThumbnailTreatment([
			gpuEffect('gpu-color-wheels', { temperature: 50 }, false),
			gpuEffect('gpu-gaussian-blur', { radius: 8 })
		]);

		expect(treatment).toEqual({ hasGrade: false, filter: '', overlayBackground: null });
	});

	it('keeps live wheel and curve changes visible until the exact GPU frame lands', () => {
		const treatment = resolveColorGradeThumbnailTreatment([
			gpuEffect('gpu-color-wheels', {
				exposure: 1,
				contrast: 1.35,
				saturation: 45,
				hue: 65,
				temperature: 40,
				offsetHue: 315,
				offsetAmount: 0.5
			}),
			gpuEffect('gpu-curves', {
				masterPoints: '[[0,0],[0.25,0.15],[0.75,0.9],[1,1]]',
				redPoints: '[[0,0],[0.25,0.35],[0.75,0.8],[1,1]]'
			})
		]);

		expect(treatment.hasGrade).toBe(true);
		expect(treatment.filter).toContain('brightness(');
		expect(treatment.filter).toContain('contrast(');
		expect(treatment.filter).toContain('saturate(');
		expect(treatment.filter).toContain('hue-rotate(54deg)');
		expect(treatment.overlayBackground).toContain('315');
	});
});
