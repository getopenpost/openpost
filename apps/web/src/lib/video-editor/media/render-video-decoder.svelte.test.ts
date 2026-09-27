import { describe, expect, it, vi } from 'vitest';
import { VideoSample } from 'mediabunny';
import { ResilientVideoFrameDecoder } from './render-video-decoder';

function sampleAt(timestamp: number, size = 2): VideoSample {
	const canvas = new OffscreenCanvas(size, size);
	canvas.getContext('2d')!.fillRect(0, 0, size, size);
	return new VideoSample(canvas, { timestamp, duration: 0.25 });
}

describe('ResilientVideoFrameDecoder', () => {
	it('retries WebCodecs decoding failures with software decoding', async () => {
		const preferences: string[] = [];
		const sample = sampleAt(0, 1);
		const hardwareSink = {
			samples: vi.fn(async function* () {
				await Promise.reject(new Error('Decoding error'));
				yield sample;
			})
		};
		const softwareSink = {
			samples: vi.fn(async function* () {
				yield sample;
			})
		};

		const decoder = new ResilientVideoFrameDecoder(
			(hardwareAcceleration) => {
				preferences.push(hardwareAcceleration);
				const sink = hardwareAcceleration === 'prefer-software' ? softwareSink : hardwareSink;
				return { ...sink, samplesAtTimestamps: sink.samples };
			},
			{ width: 1, height: 1 }
		);

		try {
			const rendered = await decoder.getFrame(0);
			expect(rendered?.source.displayWidth).toBe(1);
			expect(await decoder.getFrame(1)).toBe(rendered);
			expect(preferences).toEqual(['no-preference', 'prefer-software']);
			expect(hardwareSink.samples).toHaveBeenCalledOnce();
			expect(softwareSink.samples).toHaveBeenCalledOnce();
			decoder.dispose();
			expect(rendered?.source.displayWidth).toBe(0);
		} finally {
			decoder.dispose();
			sample.close();
		}
	});

	it('does not hide non-decoding failures behind a retry', async () => {
		const failure = new Error('The input has no video track.');
		const createSink = vi.fn(() => ({
			samplesAtTimestamps: vi.fn(),
			samples: async function* () {
				await Promise.reject(failure);
				yield sampleAt(0, 1);
			}
		}));
		const decoder = new ResilientVideoFrameDecoder(createSink, { width: 1, height: 1 });

		try {
			await expect(decoder.getFrame(0)).rejects.toBe(failure);
			expect(createSink).toHaveBeenCalledOnce();
		} finally {
			decoder.dispose();
		}
	});

	it('preserves reverse prefetch across a software retry and closes its samples', async () => {
		const requests: number[][] = [];
		const samples: VideoSample[] = [];
		const decoder = new ResilientVideoFrameDecoder(
			(hardwareAcceleration) => ({
				samples: vi.fn(),
				samplesAtTimestamps: async function* (timestamps) {
					const requested: number[] = [];
					for await (const timestamp of timestamps) requested.push(timestamp);
					requests.push(requested);
					for (const timestamp of requested) {
						const sample = sampleAt(timestamp);
						samples.push(sample);
						yield sample;
						if (hardwareAcceleration !== 'prefer-software') throw new Error('Decoding error');
					}
				}
			}),
			{ width: 2, height: 2, reverse: true }
		);
		const upcoming = (function* () {
			yield 0.5;
			yield 0.25;
			yield 0;
		})();
		try {
			const first = await decoder.getFrame(0.75, upcoming);
			expect(first?.timestamp).toBe(0.75);
			expect((await decoder.getFrame(0.25))?.timestamp).toBe(0.25);
			expect(requests).toEqual([
				[0, 0.25, 0.5, 0.75],
				[0, 0.25, 0.5, 0.75]
			]);
			for (const sample of samples) expect(() => sample.toVideoFrame()).toThrow(/closed/i);
			decoder.dispose();
			expect(first?.source.displayWidth).toBe(0);
		} finally {
			decoder.dispose();
			for (const sample of samples) sample.close();
		}
	});

	it('closes skipped and replaced samples while retaining the final frame until disposal', async () => {
		const samples = [0, 0.25, 0.5].map((timestamp) => sampleAt(timestamp));
		const decoder = new ResilientVideoFrameDecoder(
			() => ({
				samplesAtTimestamps: vi.fn(),
				samples: async function* () {
					yield* samples;
				}
			}),
			{ width: 2, height: 2 }
		);
		try {
			const first = (await decoder.getFrame(0))!;
			expect(first.source.displayWidth).toBe(2);
			const last = (await decoder.getFrame(0.5))!;
			expect(first.source.displayWidth).toBe(0);
			for (const skipped of samples.slice(0, 2))
				expect(() => skipped.toVideoFrame()).toThrow(/closed/i);
			expect(await decoder.getFrame(0.6)).toBe(last);
			expect(last.source.displayWidth).toBe(2);
			decoder.dispose();
			expect(last.source.displayWidth).toBe(0);
			expect(() => samples[2]!.toVideoFrame()).toThrow(/closed/i);
		} finally {
			decoder.dispose();
			for (const sample of samples) sample.close();
		}
	});
});
