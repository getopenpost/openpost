import { describe, expect, it, vi } from 'vitest';
import { ResilientVideoCanvasDecoder } from './render-video-decoder';

describe('ResilientVideoCanvasDecoder', () => {
	it('retries WebCodecs decoding failures with software decoding', async () => {
		const preferences: string[] = [];
		// SAFETY: The test only compares this canvas by identity; no OffscreenCanvas API is called.
		const rendered = { canvas: {} as OffscreenCanvas, timestamp: 0, duration: 1 };
		const hardwareSink = {
			getCanvas: vi.fn().mockRejectedValue(new Error('Decoding error'))
		};
		const softwareSink = {
			getCanvas: vi.fn().mockResolvedValue(rendered)
		};

		const decoder = new ResilientVideoCanvasDecoder((hardwareAcceleration) => {
			preferences.push(hardwareAcceleration);
			return hardwareAcceleration === 'prefer-software' ? softwareSink : hardwareSink;
		});

		expect(await decoder.getCanvas(0)).toBe(rendered);
		expect(await decoder.getCanvas(1)).toBe(rendered);
		expect(preferences).toEqual(['no-preference', 'prefer-software']);
		expect(hardwareSink.getCanvas).toHaveBeenCalledOnce();
		expect(softwareSink.getCanvas).toHaveBeenCalledWith(1);
	});

	it('does not hide non-decoding failures behind a retry', async () => {
		const failure = new Error('The input has no video track.');
		const createSink = vi.fn(() => ({
			getCanvas: vi.fn().mockRejectedValue(failure)
		}));
		const decoder = new ResilientVideoCanvasDecoder(createSink);

		await expect(decoder.getCanvas(0)).rejects.toBe(failure);
		expect(createSink).toHaveBeenCalledOnce();
	});
});
