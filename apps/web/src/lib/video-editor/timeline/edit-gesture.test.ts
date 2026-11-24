import { describe, expect, it } from 'vitest';
import { timelineOffsetToSourceFrame, playbackRateCurve } from './source-time-map';
import { audioClipFadeGainAtFrame } from '../media/clip-fades';
import type { TimelineItem } from '../project/types';
import { isRateStretchableType, planRateStretchGesture, planTrimGesture } from './edit-gesture';

function video(
	id: string,
	trackId: string,
	from: number,
	durationInFrames: number,
	extra: Partial<TimelineItem> = {}
): TimelineItem {
	return {
		id,
		trackId,
		from,
		durationInFrames,
		label: id,
		type: 'video',
		...extra
	};
}

describe('rate-stretch gesture parity', () => {
	it('treats video, audio, composition, and looping GIFs as stretchable only', () => {
		expect(isRateStretchableType(video('v', 't', 0, 10))).toBe(true);
		expect(isRateStretchableType({ ...video('a', 't', 0, 10), type: 'audio' })).toBe(true);
		expect(isRateStretchableType({ ...video('c', 't', 0, 10), type: 'composition' })).toBe(true);
		expect(
			isRateStretchableType({
				...video('g', 't', 0, 10),
				type: 'image',
				label: 'loop.gif'
			})
		).toBe(true);
		expect(
			isRateStretchableType({
				...video('s', 't', 0, 10),
				type: 'image',
				label: 'still.png'
			})
		).toBe(false);
		expect(isRateStretchableType({ ...video('x', 't', 0, 10), type: 'text' })).toBe(false);
	});

	it('changes only speed for looping GIFs, keeping duration fixed', () => {
		const item = video('gif', 't', 0, 100, {
			type: 'image',
			label: 'loop.gif',
			speed: 1
		});
		const plan = planRateStretchGesture(item, 'end', 30, [item], 30, [], 1);
		expect(plan?.patch.speed).toBe(0.9);
		expect('durationInFrames' in (plan?.patch ?? {})).toBe(false);
	});
});

it('preserves the existing fade envelope when dragging a trimmed clip edge', () => {
	const item = video('clip', 't', 15, 285, {
		sourceStart: 15,
		sourceEnd: 300,
		sourceFps: 30,
		audioFadeIn: 2,
		audioFadeOut: 2,
		audioFadeOffsets: { in: 0.5, out: 0 }
	});
	const plan = planTrimGesture(item, 'start', 15, [item], 30, [], 0);
	const trimmed = { ...item, ...plan.patch };
	expect(trimmed.from).toBe(30);
	expect(audioClipFadeGainAtFrame(trimmed, 30, 30)).toBeCloseTo(0.5);
	expect(audioClipFadeGainAtFrame(trimmed, 270, 30)).toBeCloseTo(0.5);
});

describe('trimmed source playback', () => {
	it('keeps a linear source speed ramp after trimming inside the ramp', () => {
		const original = video('v', 't', 0, 83, {
			sourceStart: 0,
			sourceEnd: 120,
			sourceDuration: 120,
			sourceFps: 30,
			speed: 1,
			speedRamp: [
				{ id: 'a', sourceFrame: 0, speed: 1, easing: 'linear' },
				{ id: 'b', sourceFrame: 120, speed: 2, easing: 'linear' }
			]
		});
		const plan = planTrimGesture(original, 'start', 40, [original], 30, [], 0);
		const retained = { ...original, ...plan.patch };
		expect(retained.sourceStart).toBe(47);
		// Integrating 1 / (1 + source / 120) gives elapsed = 120 * ln(1 + source / 120).
		expect(timelineOffsetToSourceFrame(retained, 20, 30)).toBeCloseTo(
			167 * Math.exp(20 / 120) - 120,
			4
		);
		const curve = playbackRateCurve(retained, 30);
		expect(curve[0]?.offsetFrames).toBe(0);
		expect(curve[0]?.rate).toBeCloseTo(1 + 47 / 120, 5);
		expect(curve.every((point) => point.offsetFrames >= 0)).toBe(true);
	});
});

it('keeps implicit ramp endpoints anchored to their original window after trimming', () => {
	const original = video('v', 't', 0, 83, {
		sourceStart: 0,
		sourceEnd: 120,
		sourceDuration: 120,
		sourceFps: 30,
		speed: 1,
		speedRamp: [{ id: 'peak', sourceFrame: 60, speed: 2, easing: 'linear' }]
	});
	const retained = {
		...original,
		...planTrimGesture(original, 'start', 20, [original], 30, [], 0).patch
	};
	expect(retained.sourceStart).toBe(24);
	expect(timelineOffsetToSourceFrame(retained, 10, 30)).toBeCloseTo(84 * Math.exp(10 / 60) - 60, 4);
});
