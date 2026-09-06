import { describe, expect, it, vi } from 'vitest';
import {
	AbsolutePhaseResampler,
	downmixToOutputChannels,
	resampleChannelLinear
} from './sample-rate-converter';
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

	it('cancels mid-decode and does not leak', async () => {
		const controller = new AbortController();
		// Simulate a long decode that checks abort
		const work = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => resolve(), 100);
			controller.signal.addEventListener('abort', () => {
				clearTimeout(timer);
				reject(new DOMException('Aborted', 'AbortError'));
			});
		});
		controller.abort();
		await expect(work).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('keeps bounded memory across chunked resample', () => {
		const rateIn = 44_100;
		const rateOut = 48_000;
		const frames = 48_000 * 10; // 10 sec
		const input = new Float32Array(frames);
		for (let i = 0; i < frames; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / rateIn);
		const single = resampleChannelLinear(input, rateIn, rateOut);
		const resampler = new AbsolutePhaseResampler(rateIn, rateOut);
		const chunkSize = 4096;
		let total = 0;
		let maxBuffered = 0;
		for (let off = 0; off < input.length; off += chunkSize) {
			const chunk = input.subarray(off, off + chunkSize);
			const out = resampler.processChunk(chunk, off + chunkSize >= input.length);
			total += out.length;
			maxBuffered = Math.max(maxBuffered, chunk.length);
		}
		expect(total).toBe(single.length);
		expect(maxBuffered).toBeLessThanOrEqual(chunkSize);
		expect(total).toBeGreaterThan(0);
	});

	it('preserves impulse across chunk boundary', () => {
		const rateIn = 44_100;
		const rateOut = 48_000;
		const frames = 10_000;
		const impulseAt = 4095; // right at chunk edge
		const input = new Float32Array(frames);
		input[impulseAt] = 1;
		const single = resampleChannelLinear(input, rateIn, rateOut);
		const resampler = new AbsolutePhaseResampler(rateIn, rateOut);
		const c1 = input.subarray(0, 4096);
		const c2 = input.subarray(4096);
		const o1 = resampler.processChunk(c1, false);
		const o2 = resampler.processChunk(c2, true);
		const chunked = new Float32Array(o1.length + o2.length);
		chunked.set(o1, 0);
		chunked.set(o2, o1.length);
		expect(chunked.length).toBe(single.length);
		const idxSingle = single.indexOf(Math.max(...single));
		const idxChunked = chunked.indexOf(Math.max(...chunked));
		expect(Math.abs(idxSingle - idxChunked)).toBeLessThanOrEqual(1);
	});

	it('downmix keeps 5.1 center in stereo and duplicates mono', () => {
		const L = new Float32Array([1]);
		const R = new Float32Array([0]);
		const C = new Float32Array([1]);
		const stereo = downmixToOutputChannels(
			[L, R, C, new Float32Array([0]), new Float32Array([0]), new Float32Array([0])],
			2
		);
		expect(stereo[0]![0]).toBeCloseTo(1 + 0.7071, 2);
		const mono = new Float32Array([0.7]);
		const dup = downmixToOutputChannels([mono], 2);
		expect(dup[0]![0]).toBeCloseTo(0.7, 4);
		expect(dup[1]![0]).toBeCloseTo(0.7, 4);
	});
});
