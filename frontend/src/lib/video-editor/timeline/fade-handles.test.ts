import { describe, expect, it } from 'vitest';
import {
	AUDIO_FADE_CURVE_X_MIN,
	clampAudioFadeCurve,
	clampAudioFadeCurveX,
	clampFadeSeconds,
	evaluateAudioFadeInCurve,
	evaluateAudioFadeOutCurve,
	fadeRatio,
	fadeSecondsFromOffset,
	getAudioFadeCurveControlPoint,
	getAudioFadeCurveFromOffset,
	getAudioFadeCurvePath,
	supportsAudioFade,
	supportsVisualFade
} from './fade-handles';
import type { TimelineItem } from '../project/types';

function item(overrides: Partial<TimelineItem>): TimelineItem {
	// SAFETY: test helper builds minimal TimelineItem; overrides fill discriminant.
	return {
		id: 'x',
		trackId: 't',
		from: 0,
		durationInFrames: 90,
		label: 'x',
		type: 'video',
		...overrides
	} as TimelineItem;
}

describe('fade-handles', () => {
	it('supports only the intended types', () => {
		expect(supportsAudioFade(item({ type: 'audio' }))).toBe(true);
		expect(supportsAudioFade(item({ type: 'video' }))).toBe(false);
		expect(supportsVisualFade(item({ type: 'video' }))).toBe(true);
		expect(supportsVisualFade(item({ type: 'composition' }))).toBe(true);
		expect(supportsVisualFade(item({ type: 'audio' }))).toBe(false);
	});

	it('maps frame-accurate ratio and pointer offset', () => {
		expect(fadeRatio(1, 30, 90)).toBeCloseTo(1 / 3);
		expect(fadeRatio(3, 30, 90)).toBe(1);
		// pointer at 30px of 90px clip, 30fps, 90 frames => 1s
		expect(
			fadeSecondsFromOffset({
				handle: 'in',
				clipWidthPixels: 90,
				pointerOffsetPixels: 30,
				fps: 30,
				maxDurationFrames: 90
			})
		).toBeCloseTo(1);
		expect(
			fadeSecondsFromOffset({
				handle: 'out',
				clipWidthPixels: 90,
				pointerOffsetPixels: 60,
				fps: 30,
				maxDurationFrames: 90
			})
		).toBeCloseTo(1);
		// out handle offset 80 => fade 10px => 0.333s snapped to frame => 0.333
		expect(
			fadeSecondsFromOffset({
				handle: 'out',
				clipWidthPixels: 90,
				pointerOffsetPixels: 80,
				fps: 30,
				maxDurationFrames: 90
			})
		).toBeCloseTo(10 / 30);
	});

	it('clamps each independent fade to the clip and snaps to a frame', () => {
		// Fade-in and fade-out may overlap, so each can span the whole three-second clip.
		expect(clampFadeSeconds(1, 90, 30)).toBeCloseTo(1);
		// no negative
		expect(clampFadeSeconds(-1, 90, 30)).toBe(0);
		// cannot exceed duration
		expect(clampFadeSeconds(10, 90, 30)).toBeCloseTo(3);
		// snapping
		expect(clampFadeSeconds(0.051, 90, 30)).toBeCloseTo(0.067, 2);
	});

	it('preserves independent curve/bias conceptually (patch only duration)', () => {
		// Ensure helper does not touch curve fields; in real store patch only fadeIn/out
		// SAFETY: test helper with audio-only curve fields; intersection narrows test item.
		const audio = item({
			type: 'audio',
			audioFadeIn: 1,
			audioFadeInCurve: 0.8,
			audioFadeInCurveX: 0.25
		}) as TimelineItem & { audioFadeInCurve?: number };
		// simulate commit only changes fadeIn, curve stays
		const patch: Partial<TimelineItem> = { audioFadeIn: clampFadeSeconds(0.5, 90, 30) };
		expect(patch.audioFadeIn).toBeCloseTo(0.5);
		const updated = { ...audio, ...patch };
		expect(updated.audioFadeInCurve).toBe(0.8);
	});

	it('matches FreeCut curve clamping and sharp fade evaluation', () => {
		expect(clampAudioFadeCurve(-2)).toBe(-1);
		expect(clampAudioFadeCurve(2)).toBe(1);
		expect(clampAudioFadeCurve(0.126)).toBe(0.13);
		expect(clampAudioFadeCurveX(-1)).toBe(0.04);
		expect(clampAudioFadeCurveX(2)).toBe(0.96);

		expect(evaluateAudioFadeInCurve(0.5, 0, 0.5)).toBeCloseTo(0.5, 5);
		expect(evaluateAudioFadeInCurve(0.5, 0.5, 0.5)).toBeGreaterThan(0.5);
		expect(evaluateAudioFadeInCurve(0.5, -0.5, 0.5)).toBeLessThan(0.5);
		expect(evaluateAudioFadeOutCurve(0.5, 0.5, 0.5)).toBeGreaterThan(0.5);
		expect(evaluateAudioFadeOutCurve(0.5, -0.5, 0.5)).toBeLessThan(0.5);
		expect(evaluateAudioFadeInCurve(0.25, 1, 0)).toBeGreaterThan(0.7);
		expect(evaluateAudioFadeOutCurve(0.75, -1, 1)).toBeLessThan(0.3);
	});

	it('keeps each draggable control point on its rendered curve', () => {
		const fadeInPoint = getAudioFadeCurveControlPoint({
			handle: 'in',
			fadePixels: 40,
			clipWidthPixels: 120,
			curve: 0.8,
			curveX: 0.25
		});
		const fadeOutPoint = getAudioFadeCurveControlPoint({
			handle: 'out',
			fadePixels: 40,
			clipWidthPixels: 120,
			curve: -0.8,
			curveX: 0.75
		});

		expect(fadeInPoint.x).toBeCloseTo(10, 5);
		expect(fadeInPoint.y).toBeCloseTo(100 - evaluateAudioFadeInCurve(0.25, 0.8, 0.25) * 100, 5);
		expect(fadeOutPoint.x).toBeCloseTo(110, 5);
		expect(fadeOutPoint.y).toBeCloseTo(100 - evaluateAudioFadeOutCurve(0.75, -0.8, 0.75) * 100, 5);
		const fadeInPath = getAudioFadeCurvePath({
			handle: 'in',
			fadePixels: 40,
			clipWidthPixels: 120,
			curve: 0.8,
			curveX: 0.25
		});
		expect(fadeInPath).toMatch(/^M 0 0 L 40 0 L /);
		expect(fadeInPath).toMatch(/ Z$/);
	});

	it('maps pointer position back to curve and keeps edge snapping editable', () => {
		const top = getAudioFadeCurveFromOffset({
			handle: 'in',
			pointerOffsetX: 20,
			pointerOffsetY: 0,
			fadePixels: 40,
			clipWidthPixels: 120,
			rowHeight: 40
		});
		const bottom = getAudioFadeCurveFromOffset({
			handle: 'in',
			pointerOffsetX: 20,
			pointerOffsetY: 40,
			fadePixels: 40,
			clipWidthPixels: 120,
			rowHeight: 40
		});
		expect(top.curve).toBeGreaterThan(0);
		expect(bottom.curve).toBeLessThan(0);

		const edgeTop = getAudioFadeCurveFromOffset({
			handle: 'in',
			pointerOffsetX: -40,
			pointerOffsetY: 0,
			fadePixels: 40,
			clipWidthPixels: 120,
			rowHeight: 40
		});
		const edgeBottom = getAudioFadeCurveFromOffset({
			handle: 'in',
			pointerOffsetX: -40,
			pointerOffsetY: 40,
			fadePixels: 40,
			clipWidthPixels: 120,
			rowHeight: 40
		});
		expect(edgeTop.curveX).toBe(AUDIO_FADE_CURVE_X_MIN);
		expect(edgeBottom.curveX).toBe(AUDIO_FADE_CURVE_X_MIN);
		expect(edgeBottom.curve).toBeLessThan(edgeTop.curve);
	});
});
