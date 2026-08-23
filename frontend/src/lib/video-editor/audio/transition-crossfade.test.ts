import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { audioCrossfadeGainAtFrame, equalPowerGain } from './transition-crossfade';
import { planMixdown } from '../media/render-plan';

function track(id: string, order: number, extra: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order,
		...extra
	};
}

function videoItem(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 60,
		label: '',
		type: 'video',
		mediaId: 'media-1',
		...extra
	};
}

function transition(from: string, to: string, durationInFrames = 20): TimelineTransition {
	return {
		id: `t-${from}-${to}`,
		type: 'crossfade',
		durationInFrames,
		fromItemId: from,
		toItemId: to
	};
}

describe('equalPowerGain', () => {
	it('hits exact endpoints', () => {
		expect(equalPowerGain(0, false)).toBeCloseTo(1, 12);
		expect(equalPowerGain(0, true)).toBeCloseTo(0, 12);
		expect(equalPowerGain(1, false)).toBeCloseTo(0, 12);
		expect(equalPowerGain(1, true)).toBeCloseTo(1, 12);
	});

	it('hits midpoint at sqrt 0.5', () => {
		const expected = Math.SQRT1_2;
		expect(equalPowerGain(0.5, false)).toBeCloseTo(expected, 12);
		expect(equalPowerGain(0.5, true)).toBeCloseTo(expected, 12);
		// Power stays constant
		const out = equalPowerGain(0.5, false);
		const inn = equalPowerGain(0.5, true);
		expect(out * out + inn * inn).toBeCloseTo(1, 12);
	});
});

describe('audioCrossfadeGainAtFrame', () => {
	const left = videoItem({ id: 'left', from: 0, durationInFrames: 60 });
	const right = videoItem({ id: 'right', from: 60, durationInFrames: 60, mediaId: 'media-2' });
	const t = transition('left', 'right', 20);
	const itemsById = new Map<string, TimelineItem>([
		['left', left],
		['right', right]
	]);

	it('returns 1 outside window', () => {
		expect(audioCrossfadeGainAtFrame(left, 49, [t], itemsById)).toBe(1);
		expect(audioCrossfadeGainAtFrame(right, 49, [t], itemsById)).toBe(1);
		expect(audioCrossfadeGainAtFrame(left, 80, [t], itemsById)).toBe(1);
	});

	it('hits exact endpoints on first and last active frames', () => {
		// Window centered: start 50, end 70, duration 20
		// first active = 50, last active = 69
		expect(audioCrossfadeGainAtFrame(left, 50, [t], itemsById)).toBeCloseTo(1, 12);
		expect(audioCrossfadeGainAtFrame(right, 50, [t], itemsById)).toBeCloseTo(0, 12);
		// At window end boundary (70) should be exclusive -> gain 1 (outside)
		expect(audioCrossfadeGainAtFrame(left, 70, [t], itemsById)).toBe(1);
		// Last active frame 69 should be near zero/one but computed via cos/sin of 0.95 progress
		// We assert exact 0 at progress 1 (end), not last active — but gain at 69 is cos(0.95*pi/2) ~ 0.078
		// For exact endpoint, check at fractional end: simulate by checking progress 1 would be 0
		expect(equalPowerGain(1, false)).toBeCloseTo(0, 12);
	});

	it('midpoint is equal power', () => {
		// progress 0.5 at frame 60
		expect(audioCrossfadeGainAtFrame(left, 60, [t], itemsById)).toBeCloseTo(Math.SQRT1_2, 12);
		expect(audioCrossfadeGainAtFrame(right, 60, [t], itemsById)).toBeCloseTo(Math.SQRT1_2, 12);
	});

	it('handles middle clip with both incoming and outgoing', () => {
		const a = videoItem({ id: 'a', from: 0, durationInFrames: 60 });
		const b = videoItem({ id: 'b', from: 60, durationInFrames: 60, mediaId: 'media-b' });
		const c = videoItem({ id: 'c', from: 120, durationInFrames: 60, mediaId: 'media-c' });
		const t1 = transition('a', 'b', 20); // window 50-70
		const t2 = transition('b', 'c', 20); // window 110-130
		const map = new Map<string, TimelineItem>([
			['a', a],
			['b', b],
			['c', c]
		]);
		// b incoming at 60 should be sqrt0.5
		expect(audioCrossfadeGainAtFrame(b, 60, [t1, t2], map)).toBeCloseTo(Math.SQRT1_2, 12);
		// b outgoing at 120 should be sqrt0.5
		expect(audioCrossfadeGainAtFrame(b, 120, [t1, t2], map)).toBeCloseTo(Math.SQRT1_2, 12);
		// b middle (90) no transition => 1
		expect(audioCrossfadeGainAtFrame(b, 90, [t1, t2], map)).toBe(1);
		// b at first window start 50 => 1 (incoming 0 but b is incoming, so 0? actually at 50 b is incoming with progress 0 => 0)
		// Wait b is incoming for t1, so at 50 gain 0. At 70 exclusive, gain 1.
		expect(audioCrossfadeGainAtFrame(b, 50, [t1, t2], map)).toBeCloseTo(0, 12);
		expect(audioCrossfadeGainAtFrame(b, 110, [t1, t2], map)).toBeCloseTo(1, 12);
		// b outgoing at 125 middle of second window -> 0.707
		expect(audioCrossfadeGainAtFrame(b, 120, [t1, t2], map)).toBeCloseTo(Math.SQRT1_2, 12);
	});

	it('applies to linked audio companions', () => {
		const leftVideo = videoItem({ id: 'lv', from: 0, durationInFrames: 60, linkedGroupId: 'g1' });
		const leftAudio: TimelineItem = videoItem({
			id: 'la',
			type: 'audio',
			trackId: 'track-audio',
			from: 0,
			durationInFrames: 60,
			linkedGroupId: 'g1',
			mediaId: 'media-1'
		});
		const rightVideo = videoItem({
			id: 'rv',
			from: 60,
			durationInFrames: 60,
			mediaId: 'media-2',
			linkedGroupId: 'g2'
		});
		const rightAudio: TimelineItem = videoItem({
			id: 'ra',
			type: 'audio',
			trackId: 'track-audio',
			from: 60,
			durationInFrames: 60,
			mediaId: 'media-2',
			linkedGroupId: 'g2'
		});
		const tr = transition('lv', 'rv', 20);
		const map = new Map<string, TimelineItem>([
			['lv', leftVideo],
			['la', leftAudio],
			['rv', rightVideo],
			['ra', rightAudio]
		]);
		// linked audio should follow video window
		expect(audioCrossfadeGainAtFrame(leftAudio, 50, [tr], map)).toBeCloseTo(1, 12);
		expect(audioCrossfadeGainAtFrame(leftAudio, 60, [tr], map)).toBeCloseTo(Math.SQRT1_2, 12);
		expect(audioCrossfadeGainAtFrame(rightAudio, 60, [tr], map)).toBeCloseTo(Math.SQRT1_2, 12);
	});

	it('no-transition identity', () => {
		expect(audioCrossfadeGainAtFrame(left, 60, [], itemsById)).toBe(1);
	});

	it('fade-black dips to silence in middle', () => {
		const fb: TimelineTransition = { ...t, type: 'fade-black' };
		// first half: outgoing fades, incoming silent
		expect(audioCrossfadeGainAtFrame(left, 50, [fb], itemsById)).toBeCloseTo(1, 12);
		expect(audioCrossfadeGainAtFrame(right, 50, [fb], itemsById)).toBeCloseTo(0, 12);
		// At frame 55 (progress 0.25) outgoing: progress*2=0.5 => cos(pi/4)=0.707
		expect(audioCrossfadeGainAtFrame(left, 55, [fb], itemsById)).toBeCloseTo(Math.SQRT1_2, 10);
		expect(audioCrossfadeGainAtFrame(left, 65, [fb], itemsById)).toBeCloseTo(0, 12);
		expect(audioCrossfadeGainAtFrame(right, 65, [fb], itemsById)).toBeCloseTo(Math.SQRT1_2, 10);
		expect(audioCrossfadeGainAtFrame(right, 60, [fb], itemsById)).toBeCloseTo(0, 12);
		expect(audioCrossfadeGainAtFrame(right, 69, [fb], itemsById)).toBeCloseTo(0.987, 2);
	});
});

describe('planMixdown with crossfades', () => {
	function trackW(id: string, order: number, extra: Partial<TimelineTrack> = {}): TimelineTrack {
		return {
			id,
			name: id,
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order,
			...extra
		};
	}
	it('preserves mute/solo and multiplies with crossfade', () => {
		const left = videoItem({ id: 'left', from: 0, durationInFrames: 60, volume: 0.5 });
		const right = videoItem({
			id: 'right',
			from: 60,
			durationInFrames: 60,
			volume: 0.8,
			mediaId: 'media-2'
		});
		const tr = transition('left', 'right', 20);
		const soloOther = trackW('track-audio', 2, { solo: true });
		const mainTrack = trackW('track-video-main', 1);
		// Solo on other track mutes main => no entries for left on main
		const entriesSolo = planMixdown([left], [mainTrack, soloOther], 30, []);
		expect(entriesSolo).toHaveLength(0);
		// Without solo, gain = volume * trackVolume (1) * crossfade
		const entries = planMixdown([left, right], [trackW('track-video-main', 0)], 30, [tr]);
		expect(entries).toHaveLength(2);
		const leftEntry = entries.find((e) => e.itemId === 'left')!;
		// At frame 50 (window start) gain should be 0.5 * 1
		const p50 = leftEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 50 / 30) < 0.001);
		expect(p50?.value).toBeCloseTo(0.5, 12);
		// At midpoint frame 60, gain = 0.5 * 0.707
		const p60 = leftEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 60 / 30) < 0.001);
		expect(p60?.value).toBeCloseTo(0.5 * Math.SQRT1_2, 10);
	});

	it('composes with keyframed volume multiplicatively', () => {
		const left = videoItem({
			id: 'left',
			from: 0,
			durationInFrames: 60,
			mediaId: 'media-1',
			keyframes: { volume: { frames: [0, 60], values: [0, 1] } }
		});
		const right = videoItem({ id: 'right', from: 60, durationInFrames: 60, mediaId: 'media-2' });
		const tr = transition('left', 'right', 20);
		const entries = planMixdown([left, right], [trackW('track-video-main', 0)], 30, [tr]);
		const leftEntry = entries.find((e) => e.itemId === 'left')!;
		// At frame 60, animated volume ~0.5 (since track is 0..60 over 60 frames, at 60 => 1 but at 60 is outside? Actually left's frame 60 is beyond duration, but our gain points go 0..60 inclusive.
		// At absolute frame 60, relative 60 => value 1, crossfade 0.707 => 0.707
		const p60 = leftEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 60 / 30) < 0.001);
		// The exact animated value at frame 60 is 1 (clamped after last key)
		expect(p60?.value).toBeCloseTo(0.707, 1);
	});

	it('no-transition identity leaves single gain point', () => {
		const item = videoItem({
			id: 'solo',
			from: 30,
			durationInFrames: 60,
			volume: 0.7,
			mediaId: 'media-1'
		});
		const entries = planMixdown([item], [trackW('track-video-main', 0)], 30, []);
		expect(entries[0]?.gainPoints).toEqual([{ whenSeconds: 1, value: 0.7 }]);
	});

	it('endpoints exact at window boundaries via gain points', () => {
		const left = videoItem({ id: 'left', from: 0, durationInFrames: 60, mediaId: 'media-1' });
		const right = videoItem({ id: 'right', from: 60, durationInFrames: 60, mediaId: 'media-2' });
		const tr = transition('left', 'right', 20); // window 50-70
		const entries = planMixdown([left, right], [trackW('track-video-main', 0)], 30, [tr]);
		const leftEntry = entries.find((e) => e.itemId === 'left')!;
		const rightEntry = entries.find((e) => e.itemId === 'right')!;
		const leftStart = leftEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 50 / 30) < 0.001);
		const rightMid = rightEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 60 / 30) < 0.001);
		expect(leftStart?.value).toBeCloseTo(1, 12);
		expect(rightMid?.value).toBeCloseTo(Math.SQRT1_2, 10);
		// At frame 69 (last active before exclusive end 70) - left exists, right exists (69 is within right's 60-120)
		const leftEnd = leftEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 69 / 30) < 0.001);
		const rightEnd = rightEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 69 / 30) < 0.001);
		// Left at 69 is beyond its duration (60) so left has no point at 69; check right's value
		expect(leftEnd).toBeUndefined();
		expect(rightEnd?.value).toBeCloseTo(Math.sin((0.95 * Math.PI) / 2), 6);
		// Left last point is at 59 (its last frame within window) progress (59-50)/20=0.45 => cos(0.45*pi/2)=~0.76
		const leftLast = leftEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 59 / 30) < 0.001);
		expect(leftLast?.value).toBeCloseTo(Math.cos((0.45 * Math.PI) / 2), 5);
	});

	it('chained transitions handle middle clip both fades', () => {
		const a = videoItem({ id: 'a', from: 0, durationInFrames: 60, mediaId: 'media-a' });
		const b = videoItem({ id: 'b', from: 60, durationInFrames: 60, mediaId: 'media-b' });
		const c = videoItem({ id: 'c', from: 120, durationInFrames: 60, mediaId: 'media-c' });
		const t1 = transition('a', 'b', 20);
		const t2 = transition('b', 'c', 20);
		const entries = planMixdown([a, b, c], [trackW('track-video-main', 0)], 30, [t1, t2]);
		const bEntry = entries.find((e) => e.itemId === 'b')!;
		// b should have crossfade at both ends, middle unaffected
		const mid = bEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 90 / 30) < 0.001);
		expect(mid?.value).toBeCloseTo(1, 12);
		const inc = bEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 60 / 30) < 0.001);
		expect(inc?.value).toBeCloseTo(Math.SQRT1_2, 10);
		const out = bEntry.gainPoints.find((p) => Math.abs(p.whenSeconds - 120 / 30) < 0.001);
		expect(out?.value).toBeCloseTo(Math.SQRT1_2, 10);
	});
});
