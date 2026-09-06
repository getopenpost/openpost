import { describe, expect, it } from 'vitest';
import {
	audioClipFadeGainAtFrame,
	audioFadeInCurveGain,
	audioFadeOutCurveGain,
	dbToLinearGain,
	linearGainToDb,
	visualClipFadeOpacityAtFrame
} from './clip-fades';

const base = { from: 30, durationInFrames: 120 };

describe('clip fades', () => {
	it('matches visual fade timing and handles overlapping fades without a full-opacity spike', () => {
		const video = { ...base, type: 'video' as const, fadeIn: 1, fadeOut: 1 };
		expect(visualClipFadeOpacityAtFrame(video, 30, 30)).toBe(0);
		expect(visualClipFadeOpacityAtFrame(video, 45, 30)).toBeCloseTo(0.5);
		expect(visualClipFadeOpacityAtFrame(video, 90, 30)).toBe(1);
		expect(visualClipFadeOpacityAtFrame(video, 135, 30)).toBeCloseTo(0.5);

		const overlap = {
			...video,
			durationInFrames: 30,
			fadeIn: 0.75,
			fadeOut: 0.75
		};
		expect(visualClipFadeOpacityAtFrame(overlap, 45, 30)).toBeCloseTo(2 / 3);
	});

	it('uses shaped audio curves and leaves transition handles outside the clip span unchanged', () => {
		const audio = {
			...base,
			audioFadeIn: 1,
			audioFadeOut: 1,
			audioFadeInCurve: 0.8,
			audioFadeOutCurve: -0.8
		};
		expect(audioClipFadeGainAtFrame(audio, 29, 30)).toBe(1);
		expect(audioClipFadeGainAtFrame(audio, 30, 30)).toBe(0);
		expect(audioClipFadeGainAtFrame(audio, 45, 30)).toBeGreaterThan(0.5);
		expect(audioClipFadeGainAtFrame(audio, 135, 30)).toBeLessThan(0.5);
		expect(audioClipFadeGainAtFrame(audio, 150, 30)).toBe(1);
		expect(audioFadeInCurveGain(0.5, 0, 0.52)).toBeCloseTo(0.5);
		expect(audioFadeOutCurveGain(0.5, 0, 0.52)).toBeCloseTo(0.5);
	});

	it('round-trips the persisted linear gain through the dB inspector scale', () => {
		for (const db of [-60, -24, -6, 0, 6, 12]) {
			expect(linearGainToDb(dbToLinearGain(db))).toBeCloseTo(db, 6);
		}
		expect(dbToLinearGain(-60)).toBeCloseTo(0.001, 8);
	});
});
