import { describe, expect, it } from 'vitest';
import { createTextCurvePath, shadowColor, shadowOffset, textCurveStartOffset } from './effects';
import type { ImageEditorShadowEffect, ImageEditorTextCurve } from './types';

const shadow: ImageEditorShadowEffect = {
	color: '#f97316',
	opacity: 0.5,
	blur: 20,
	angle: 90,
	distance: 24
};

function curve(type: ImageEditorTextCurve['type']): ImageEditorTextCurve {
	return { type, strength: 0.7, offset: 0.25, reverse: false };
}

describe('OpenPost Image Editor layer effects', () => {
	it('converts shadow angle and distance into canvas offsets', () => {
		const offset = shadowOffset(shadow);
		expect(offset.x).toBeCloseTo(0);
		expect(offset.y).toBeCloseTo(24);
		expect(shadowColor(shadow)).toBe('rgba(249, 115, 22, 0.5)');
	});

	it('builds distinct paths for arc, wave, circle, and ellipse text', () => {
		const paths = [
			createTextCurvePath(600, 180, curve('arc_up')),
			createTextCurvePath(600, 180, curve('arc_down')),
			createTextCurvePath(600, 180, curve('wave')),
			createTextCurvePath(600, 180, curve('circle')),
			createTextCurvePath(600, 180, curve('ellipse'))
		];
		expect(paths.every(Boolean)).toBe(true);
		expect(new Set(paths).size).toBe(paths.length);
		expect(createTextCurvePath(600, 180, curve('none'))).toBeNull();
	});

	it('keeps text path offset normalized to the layer width', () => {
		expect(textCurveStartOffset(600, curve('arc_up'))).toBe(150);
		expect(textCurveStartOffset(1200, curve('arc_up'))).toBe(300);
	});
});
