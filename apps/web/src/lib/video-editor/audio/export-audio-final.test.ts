import { describe, expect, it } from 'vitest';
import { frameToSourceSeconds, planMixdown, sliceMixEntries } from '../media/render-plan';
import type { TimelineItem, TimelineTrack } from '../project/types';

function track(id: string, order: number, extra: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'audio',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order,
		...extra
	};
}
function item(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'c',
		trackId: 't',
		from: 0,
		durationInFrames: 100,
		label: '',
		type: 'audio',
		mediaId: 'm',
		...extra
	};
}

describe('export audio final - trim, gain, speed', () => {
	it('keeps exact trim boundaries sample-accurate', () => {
		const fps = 30;
		const clip = item({
			from: 10,
			durationInFrames: 60,
			sourceStart: 30,
			sourceFps: 30,
			sourceEnd: 90
		});
		expect(frameToSourceSeconds(clip, 10, fps)).toBeCloseTo(1);
		expect(frameToSourceSeconds(clip, 70, fps)).toBeCloseTo(3);
		const entries = planMixdown([clip], [track('t', 0)], fps);
		expect(entries[0]?.sourceOffsetSeconds).toBeCloseTo(1);
		expect(entries[0]?.durationSeconds).toBeCloseTo(2);
		const sliced = sliceMixEntries(entries, 1, 2);
		expect(sliced[0]?.whenSeconds).toBe(0);
		expect(sliced[0]?.durationSeconds).toBeCloseTo(1);
		// Sliced at 1 sec: original starts at 0.333, so skipped 0.666 translates to source offset 1.666
		expect(sliced[0]?.sourceOffsetSeconds).toBeCloseTo(1.666, 2);
	});

	it('respects mute, solo, gain, fades and speed', () => {
		const muted = planMixdown([item({ mediaId: 'a' })], [track('t', 0, { muted: true })], 30);
		expect(muted).toEqual([]);
		const soloTracks = [track('t', 0), track('s', 1, { solo: true })];
		const soloEntries = planMixdown(
			[item({ trackId: 't', mediaId: 'a' }), item({ trackId: 's', mediaId: 'b' })],
			soloTracks,
			30
		);
		expect(soloEntries.map((e) => e.mediaId)).toEqual(['b']);
		const gain = planMixdown(
			[item({ mediaId: 'a', volume: 0.5 })],
			[track('t', 0, { volume: 0.5 })],
			30
		);
		expect(gain[0]?.gainPoints[0]?.value).toBeCloseTo(0.25);
		const fast = planMixdown(
			[item({ mediaId: 'a', speed: 2, durationInFrames: 60 })],
			[track('t', 0)],
			30
		);
		expect(fast[0]?.playbackRate).toBe(2);
		expect(fast[0]?.durationSeconds).toBeCloseTo(2);
	});
});
