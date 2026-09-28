import { expect, it } from 'vitest';
import { audioFadeInCurveGain } from '../media/clip-fades';
import { getAudioFadeCurveControlPoint, getAudioFadeCurveFromOffset } from './fade-handles';

it('places a sliced fade handle on the visible part of its original envelope', () => {
	const point = getAudioFadeCurveControlPoint({
		handle: 'in',
		fadePixels: 100,
		clipWidthPixels: 300,
		curve: 0,
		curveX: 0.6,
		progressStart: 0.5,
		progressEnd: 1
	});
	expect(point.x).toBeCloseTo(20);
	expect(point.y).toBeCloseTo(40);
});

it('maps a curve drag through the retained portion of the fade', () => {
	const curve = getAudioFadeCurveFromOffset({
		handle: 'in',
		pointerOffsetX: 50,
		pointerOffsetY: 25,
		fadePixels: 100,
		clipWidthPixels: 300,
		rowHeight: 100,
		progressStart: 0.5,
		progressEnd: 1
	});
	expect(curve.curveX).toBeCloseTo(0.75);
	expect(audioFadeInCurveGain(0.75, curve.curve, curve.curveX)).toBeCloseTo(0.75);
});
