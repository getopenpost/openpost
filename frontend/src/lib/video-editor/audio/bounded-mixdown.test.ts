import { describe, expect, it, vi } from 'vitest';
import {
	BOUNDED_AUDIO_CHUNK_FRAMES,
	BOUNDED_AUDIO_FAST_PATH_MAX_BYTES,
	getPeakBufferedBytes,
	getPeakBufferedFrames,
	getTotalDecodedFrames,
	getTotalOutputFrames,
	mixBoundedAudioToChunks,
	resetPeakBuffered,
	type DecodeWindowFn
} from './bounded-mixdown';
import type { MixEntry } from '../media/render-plan';

function makeEntry(
	overrides: Partial<MixEntry> & { mediaId: string; whenSeconds: number; durationSeconds: number }
): MixEntry {
	return {
		itemId: overrides.itemId ?? 'item',
		mediaId: overrides.mediaId,
		whenSeconds: overrides.whenSeconds,
		sourceOffsetSeconds: overrides.sourceOffsetSeconds ?? 0,
		playbackRate: overrides.playbackRate ?? 1,
		pitchShiftSemitones: overrides.pitchShiftSemitones ?? 0,
		audioEqStages: overrides.audioEqStages ?? [],
		reversed: overrides.reversed ?? false,
		durationSeconds: overrides.durationSeconds,
		gainPoints: overrides.gainPoints ?? [{ whenSeconds: overrides.whenSeconds, value: 1 }],
		previewGainPoints: overrides.previewGainPoints ?? [
			{ whenSeconds: overrides.whenSeconds, value: 1 }
		],
		mixerTrackGain: overrides.mixerTrackGain ?? 1,
		transitionGainSpans: overrides.transitionGainSpans ?? []
	};
}

function constantDecodeWindow(value: number, sampleRate = 48_000) {
	return async (mediaId: string, startSec: number, durationSec: number) => {
		const frames = Math.max(0, Math.round(durationSec * sampleRate));
		if (frames <= 0) return { channels: [new Float32Array(0), new Float32Array(0)], sampleRate };
		const ch = new Float32Array(frames).fill(value);
		return { channels: [ch.slice(), ch.slice()], sampleRate };
	};
}

describe('bounded mixdown', () => {
	it('keeps peak buffered frames bounded for long synthetic timelines with overlap', async () => {
		const chunkFrames = BOUNDED_AUDIO_CHUNK_FRAMES;
		const makeLongEntries = (totalSec: number): MixEntry[] => {
			const entries: MixEntry[] = [];
			// Two overlapping tracks, 100 sec each, offset 0.5 sec to create overlap everywhere
			for (let i = 0; i < 2; i++) {
				entries.push(
					makeEntry({
						mediaId: `media-${i}`,
						whenSeconds: i * 0.5,
						durationSeconds: totalSec,
						sourceOffsetSeconds: 0,
						gainPoints: [
							{ whenSeconds: i * 0.5, value: 1 },
							{ whenSeconds: i * 0.5 + totalSec, value: 1 }
						]
					})
				);
			}
			return entries;
		};

		const decode = constantDecodeWindow(0.5);

		resetPeakBuffered();
		const shortEntries = makeLongEntries(10);
		const shortChunks: Float32Array[][] = [];
		await mixBoundedAudioToChunks(shortEntries, 10, decode, {
			async addChunk(channels) {
				shortChunks.push(channels.map((c) => c.slice()));
			},
			async close() {}
		});
		const shortPeak = getPeakBufferedFrames();
		const shortBytes = getPeakBufferedBytes();

		resetPeakBuffered();
		const longEntries = makeLongEntries(100);
		const longChunks: Float32Array[][] = [];
		await mixBoundedAudioToChunks(longEntries, 100, decode, {
			async addChunk(channels) {
				longChunks.push(channels.map((c) => c.slice()));
			},
			async close() {}
		});
		const longPeak = getPeakBufferedFrames();
		const longBytes = getPeakBufferedBytes();

		// Peak should not grow with duration: both should be bounded near chunkFrames * channels * few allocations
		expect(longPeak).toBeLessThanOrEqual(shortPeak * 1.5);
		expect(longPeak).toBeLessThan(chunkFrames * 8);
		expect(longBytes).toBeLessThan(BOUNDED_AUDIO_FAST_PATH_MAX_BYTES);
		expect(longPeak).toBeGreaterThan(0);
		expect(shortPeak).toBeGreaterThan(0);
		// Also verify total mixed frames equals duration
		const shortTotal = shortChunks.reduce((sum, ch) => sum + (ch[0]?.length ?? 0), 0);
		const longTotal = longChunks.reduce((sum, ch) => sum + (ch[0]?.length ?? 0), 0);
		expect(shortTotal).toBe(10 * 48_000);
		expect(longTotal).toBe(100 * 48_000);
	});

	it('preserves fade/gain semantics per sample', async () => {
		// Single entry with linear fade from 0 to 1 over 2 seconds
		const entry = makeEntry({
			mediaId: 'm1',
			whenSeconds: 0,
			durationSeconds: 2,
			gainPoints: [
				{ whenSeconds: 0, value: 0 },
				{ whenSeconds: 2, value: 1 }
			]
		});
		const decode = constantDecodeWindow(1);
		const collected: Float32Array[] = [];
		resetPeakBuffered();
		await mixBoundedAudioToChunks([entry], 2, decode, {
			async addChunk(channels) {
				collected.push(channels[0]!.slice());
			},
			async close() {}
		});
		const flat = collected.flatMap((c) => Array.from(c));
		expect(flat.length).toBe(2 * 48_000);
		// At 0 sec gain 0 => near 0, at 1 sec gain 0.5, at 2 sec near 1
		expect(flat[0]).toBeCloseTo(0, 2);
		expect(flat[48_000]).toBeCloseTo(0.5, 2);
		expect(flat[96_000 - 1]).toBeCloseTo(1, 2);
	});

	it('applies transition gain multiplicatively', async () => {
		const entry = makeEntry({
			mediaId: 'm2',
			whenSeconds: 0,
			durationSeconds: 2,
			gainPoints: [{ whenSeconds: 0, value: 1 }],
			transitionGainSpans: [
				{ startSeconds: 0, durationSeconds: 1, isIncoming: false, dipToSilence: false }
			]
		});
		// outgoing transition: cos curve from 1 to 0 over 1 sec, boundary exclusive at 1.0
		const decode = constantDecodeWindow(1);
		const collected: Float32Array[] = [];
		await mixBoundedAudioToChunks([entry], 2, decode, {
			async addChunk(ch) {
				collected.push(ch[0]!.slice());
			},
			async close() {}
		});
		const flat = collected.flatMap((c) => Array.from(c));
		expect(flat[0]).toBeCloseTo(1, 1);
		expect(flat[24_000]).toBeCloseTo(0.707, 1);
		expect(flat[47_999]).toBeCloseTo(0, 1);
		expect(flat[48_000]).toBeCloseTo(1, 1);
		expect(flat[72_000]).toBeCloseTo(1, 1);
	});

	it('cancellation aborts and does not leak peak', async () => {
		const entry = makeEntry({
			mediaId: 'm3',
			whenSeconds: 0,
			durationSeconds: 100,
			gainPoints: [{ whenSeconds: 0, value: 1 }]
		});
		const decode = async (id: string, start: number, dur: number) => {
			await new Promise((r) => setTimeout(r, 5));
			const frames = Math.round(dur * 48_000);
			return {
				channels: [new Float32Array(frames).fill(0.5), new Float32Array(frames).fill(0.5)],
				sampleRate: 48_000
			};
		};
		const controller = new AbortController();
		resetPeakBuffered();
		const promise = mixBoundedAudioToChunks(
			[entry],
			100,
			decode,
			{
				async addChunk() {
					if (controller.signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
				},
				async close() {}
			},
			{ signal: controller.signal }
		);
		setTimeout(() => controller.abort(), 10);
		await expect(promise).rejects.toSatisfy(
			(e: unknown) => (e as DOMException).name === 'AbortError'
		);
		expect(getPeakBufferedFrames()).toBeLessThan(BOUNDED_AUDIO_CHUNK_FRAMES * 8);
	});

	it('decodes only required windows, not full source', async () => {
		const calls: Array<{ start: number; dur: number }> = [];
		const decode = async (id: string, start: number, dur: number) => {
			calls.push({ start, dur });
			const frames = Math.round(dur * 48_000);
			return {
				channels: [new Float32Array(frames).fill(1), new Float32Array(frames).fill(1)],
				sampleRate: 48_000
			};
		};
		const entry = makeEntry({
			mediaId: 'm4',
			whenSeconds: 10,
			durationSeconds: 5,
			sourceOffsetSeconds: 100,
			playbackRate: 2 // source duration 10 sec, but timeline 5 sec
		});
		resetPeakBuffered();
		await mixBoundedAudioToChunks([entry], 20, decode, {
			async addChunk() {},
			async close() {}
		});
		// Should have decoded only windows overlapping entry, not entire 20 sec timeline
		// Each chunk overlapping entry will call decode with duration ~1 sec * playbackRate
		expect(calls.length).toBeGreaterThan(0);
		for (const c of calls) {
			expect(c.dur).toBeLessThanOrEqual(2); // at most chunk * playbackRate
			expect(c.start).toBeGreaterThanOrEqual(100);
			expect(c.start + c.dur).toBeLessThanOrEqual(110);
		}
	});

	it('produces correct stereo samples (right channel indexing)', async () => {
		const entry = makeEntry({
			mediaId: 'stereo',
			whenSeconds: 0,
			durationSeconds: 1,
			gainPoints: [{ whenSeconds: 0, value: 1 }]
		});
		const decode = async () => {
			const frames = 48_000;
			const left = new Float32Array(frames).fill(1);
			const right = new Float32Array(frames).fill(-1);
			return { channels: [left, right], sampleRate: 48_000 };
		};
		const collected: Float32Array[][] = [];
		await mixBoundedAudioToChunks([entry], 1, decode, {
			async addChunk(channels) {
				collected.push([channels[0]!.slice(), channels[1]!.slice()]);
			},
			async close() {}
		});
		const flatL = collected.flatMap((c) => Array.from(c[0]!));
		const flatR = collected.flatMap((c) => Array.from(c[1]!));
		expect(flatL[0]).toBeCloseTo(1, 5);
		expect(flatR[0]).toBeCloseTo(-1, 5);
		expect(flatL[1000]).toBeCloseTo(1, 5);
		expect(flatR[1000]).toBeCloseTo(-1, 5);
	});

	it('handles reversal across multiple chunks without missing boundary samples', async () => {
		// Create a source with ramp 0..N, reversed should be N..0
		const sourceLen = 5 * 48_000;
		const source = Float32Array.from({ length: sourceLen }, (_, i) => i / sourceLen);
		const decode = async (id: string, start: number, dur: number) => {
			const startFrame = Math.round(start * 48_000);
			const frames = Math.round(dur * 48_000);
			const slice = source.slice(startFrame, startFrame + frames);
			return { channels: [slice.slice(), slice.slice()], sampleRate: 48_000 };
		};
		const entry = makeEntry({
			mediaId: 'rev',
			whenSeconds: 0,
			durationSeconds: 5,
			sourceOffsetSeconds: 5, // exclusive end at 5 sec
			reversed: true,
			gainPoints: [{ whenSeconds: 0, value: 1 }]
		});
		resetPeakBuffered();
		const collected: Float32Array[] = [];
		await mixBoundedAudioToChunks([entry], 5, decode, {
			async addChunk(ch) {
				collected.push(ch[0]!.slice());
			},
			async close() {}
		});
		const flat = collected.flatMap((c) => Array.from(c));
		expect(flat.length).toBe(5 * 48_000);
		// First sample should be near end of source (reversed), last near start
		expect(flat[0]).toBeCloseTo(source[sourceLen - 1] ?? 0, 2);
		expect(flat[flat.length - 1]).toBeCloseTo(source[0] ?? 0, 2);
		// Check continuity at chunk boundary (around 48k)
		const diff = Math.abs((flat[48_000 - 1] ?? 0) - (flat[48_000] ?? 0));
		expect(diff).toBeLessThan(0.01);
	});

	it('proves linear decode work, not quadratic', async () => {
		let totalCalls = 0;
		const decode = async (id: string, start: number, dur: number) => {
			totalCalls++;
			const frames = Math.round(dur * 48_000);
			return {
				channels: [new Float32Array(frames).fill(0.5), new Float32Array(frames).fill(0.5)],
				sampleRate: 48_000
			};
		};
		resetPeakBuffered();
		await mixBoundedAudioToChunks(
			[
				makeEntry({
					mediaId: 'a',
					whenSeconds: 0,
					durationSeconds: 10,
					gainPoints: [{ whenSeconds: 0, value: 1 }]
				})
			],
			10,
			decode,
			{
				async addChunk() {},
				async close() {}
			}
		);
		const shortCalls = totalCalls;
		const shortDecoded = getTotalDecodedFrames();
		totalCalls = 0;
		resetPeakBuffered();
		await mixBoundedAudioToChunks(
			[
				makeEntry({
					mediaId: 'a',
					whenSeconds: 0,
					durationSeconds: 100,
					gainPoints: [{ whenSeconds: 0, value: 1 }]
				})
			],
			100,
			decode,
			{
				async addChunk() {},
				async close() {}
			}
		);
		const longCalls = totalCalls;
		const longDecoded = getTotalDecodedFrames();
		// Calls should scale linearly with duration (10x), not quadratically (~100x)
		expect(longCalls).toBeGreaterThan(shortCalls);
		expect(longCalls / shortCalls).toBeCloseTo(10, 0);
		expect(longDecoded / shortDecoded).toBeCloseTo(10, 0);
	});

	it('clamps negative source windows and preserves sourceOffset meaning for reversed', async () => {
		const decode = async (id: string, start: number, dur: number) => {
			expect(start).toBeGreaterThanOrEqual(0);
			const frames = Math.round(dur * 48_000);
			return {
				channels: [new Float32Array(frames).fill(1), new Float32Array(frames).fill(1)],
				sampleRate: 48_000
			};
		};
		const entry = makeEntry({
			mediaId: 'neg',
			whenSeconds: 0,
			durationSeconds: 2,
			sourceOffsetSeconds: 0.5,
			reversed: true,
			gainPoints: [{ whenSeconds: 0, value: 1 }]
		});
		await mixBoundedAudioToChunks([entry], 2, decode, {
			async addChunk() {},
			async close() {}
		});
		expect(true).toBe(true);
	});

	it('sink close happens exactly once on success and not on abort', async () => {
		const entry = makeEntry({
			mediaId: 'x',
			whenSeconds: 0,
			durationSeconds: 1,
			gainPoints: [{ whenSeconds: 0, value: 1 }]
		});
		const decode = constantDecodeWindow(1);
		let closeCount = 0;
		await mixBoundedAudioToChunks([entry], 1, decode, {
			async addChunk() {},
			async close() {
				closeCount++;
			}
		});
		expect(closeCount).toBe(1);
		closeCount = 0;
		const controller = new AbortController();
		const longDecode = async () => {
			await new Promise((r) => setTimeout(r, 5));
			return {
				channels: [new Float32Array(48_000).fill(1), new Float32Array(48_000).fill(1)],
				sampleRate: 48_000
			};
		};
		const p = mixBoundedAudioToChunks(
			[
				makeEntry({
					mediaId: 'y',
					whenSeconds: 0,
					durationSeconds: 10,
					gainPoints: [{ whenSeconds: 0, value: 1 }]
				})
			],
			10,
			longDecode,
			{
				async addChunk() {},
				async close() {
					closeCount++;
				}
			},
			{ signal: controller.signal }
		);
		setTimeout(() => controller.abort(), 10);
		await expect(p).rejects.toSatisfy((e: unknown) => (e as DOMException).name === 'AbortError');
		expect(closeCount).toBe(0);
	});

	it('handles unreadable sources correctly', async () => {
		const good = makeEntry({
			mediaId: 'good',
			whenSeconds: 0,
			durationSeconds: 1,
			gainPoints: [{ whenSeconds: 0, value: 1 }]
		});
		const bad = makeEntry({
			mediaId: 'bad',
			whenSeconds: 0,
			durationSeconds: 1,
			gainPoints: [{ whenSeconds: 0, value: 1 }]
		});
		const decode: DecodeWindowFn = async (id: string) => {
			if (id === 'bad') return null;
			return {
				channels: [new Float32Array(48_000).fill(1), new Float32Array(48_000).fill(1)],
				sampleRate: 48_000
			};
		};
		let gotChunks = false;
		await mixBoundedAudioToChunks([good, bad], 1, decode, {
			async addChunk(ch) {
				gotChunks = true;
				expect(ch[0]![0]).toBeCloseTo(1, 5);
			},
			async close() {}
		});
		expect(gotChunks).toBe(true);
		await expect(
			mixBoundedAudioToChunks([bad], 1, decode, {
				async addChunk() {},
				async close() {}
			})
		).rejects.toThrow(/empty/i);
	});
});
