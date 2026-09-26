import { describe, expect, it, vi } from 'vitest';
import { ResilientVideoCanvasDecoder } from './render-video-decoder';

describe('ResilientVideoCanvasDecoder', () => {
	it('retries WebCodecs decoding failures with software decoding', async () => {
		const preferences: string[] = [];
		// SAFETY: The test only compares this canvas by identity; no OffscreenCanvas API is called.
		const rendered = { canvas: {} as OffscreenCanvas, timestamp: 0, duration: 1 };
		const hardwareSink = {
			canvases: vi.fn(async function* () {
				await Promise.reject(new Error('Decoding error'));
				yield rendered;
			})
		};
		const softwareSink = {
			canvases: vi.fn(async function* () {
				yield rendered;
			})
		};

		const decoder = new ResilientVideoCanvasDecoder((hardwareAcceleration) => {
			preferences.push(hardwareAcceleration);
			return hardwareAcceleration === 'prefer-software' ? softwareSink : hardwareSink;
		});

		expect(await decoder.getCanvas(0)).toBe(rendered);
		expect(await decoder.getCanvas(1)).toBe(rendered);
		expect(preferences).toEqual(['no-preference', 'prefer-software']);
		expect(hardwareSink.canvases).toHaveBeenCalledOnce();
		expect(softwareSink.canvases).toHaveBeenCalledOnce();
		decoder.dispose();
	});

	it('does not hide non-decoding failures behind a retry', async () => {
		const failure = new Error('The input has no video track.');
		const createSink = vi.fn(() => ({
			canvases: async function* () {
				await Promise.reject(failure);
				yield { canvas: new OffscreenCanvas(1, 1), timestamp: 0, duration: 1 };
			}
		}));
		const decoder = new ResilientVideoCanvasDecoder(createSink);

		await expect(decoder.getCanvas(0)).rejects.toBe(failure);
		expect(createSink).toHaveBeenCalledOnce();
	});
});
