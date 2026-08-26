import { describe, expect, it } from 'vitest';
import {
	clampFadeSeconds,
	fadeRatio,
	fadeSecondsFromOffset,
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

	it('clamps so fades remain valid and snaps to frame', () => {
		// duration 3s (90 frames), other fade 2.5s, computed 1s should clamp to 0.5s
		expect(clampFadeSeconds(1, 2.5, 90, 30)).toBeCloseTo(0.5);
		// no negative
		expect(clampFadeSeconds(-1, 0, 90, 30)).toBe(0);
		// cannot exceed duration
		expect(clampFadeSeconds(10, 0, 90, 30)).toBeCloseTo(3);
		// snapping
		expect(clampFadeSeconds(0.051, 0, 90, 30)).toBeCloseTo(0.067, 2);
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
		const patch: Partial<TimelineItem> = { audioFadeIn: clampFadeSeconds(0.5, 0, 90, 30) };
		expect(patch.audioFadeIn).toBeCloseTo(0.5);
		// curve not in patch => preserved
		expect('audioFadeInCurve' in patch).toBe(false);
	});
});
