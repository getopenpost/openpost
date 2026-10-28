import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilmstripFrame } from '../media/filmstrip-client';
const io = { lookupCachedFilmstrip: vi.fn(), cloneFrame: vi.fn(), prewarmFilmstrips: vi.fn() };
let scheduler: typeof import('./scrub-proxy-scheduler');

function fakeBitmap(): ImageBitmap {
	return { width: 1, height: 1, close: vi.fn() };
}

function frame(index: number): FilmstripFrame {
	// SAFETY: fallback selection only reads index/bitmap/url; the blob URL never resolves in tests.
	return { index, bitmap: fakeBitmap(), url: `blob:frame-${index}` } as FilmstripFrame;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('scrub-proxy-scheduler', () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.resetAllMocks();
		const { filmstripCache } = await import('../media/filmstrip-client');
		vi.spyOn(filmstripCache, 'cachedFilmstrip').mockImplementation(io.lookupCachedFilmstrip);
		vi.spyOn(filmstripCache, 'prewarm').mockImplementation(io.prewarmFilmstrips);
		vi.stubGlobal('createImageBitmap', io.cloneFrame);
		scheduler = await import('./scrub-proxy-scheduler');
	});

	it('shares one clone across concurrent requests for the same frame', async () => {
		const cloneFrame = io.cloneFrame.mockImplementation(async () => fakeBitmap());
		io.lookupCachedFilmstrip.mockReturnValue({ frames: [frame(0), frame(1)] });
		// fps plan: FILMSTRIP_FRAME_RATE frames; timestamp near frame 1.
		const [first, second] = await Promise.all([
			scheduler.requestScrubFallback('media-a', 1, 60),
			scheduler.requestScrubFallback('media-a', 1, 60)
		]);
		expect(cloneFrame).toHaveBeenCalledTimes(1);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
	});

	it('returns null when the nearest frame drifts too far', async () => {
		const cloneFrame = io.cloneFrame.mockImplementation(async () => fakeBitmap());
		io.lookupCachedFilmstrip.mockReturnValue({ frames: [frame(0)] });
		await expect(scheduler.requestScrubFallback('media-a', 10, 0.75)).resolves.toBeNull();
		expect(cloneFrame).not.toHaveBeenCalled();
	});

	it('drops superseded clones instead of presenting them', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const bitmap = fakeBitmap();
		io.lookupCachedFilmstrip.mockReturnValue({ frames: [frame(0)] });
		io.cloneFrame.mockImplementation(async () => {
			await gate;
			return bitmap;
		});
		const pending = scheduler.requestScrubFallback('media-a', 0, 60);
		scheduler.invalidateScrubFallbacks('media-a');
		release();
		await expect(pending).resolves.toBeNull();
		expect(bitmap.close).toHaveBeenCalledTimes(1);
	});

	it('prewarms filmstrips and tolerates cache failures', () => {
		scheduler.warmScrubProxyFallback();
		expect(io.prewarmFilmstrips).toHaveBeenCalledTimes(1);
		io.prewarmFilmstrips.mockImplementation(() => {
			throw new Error('boom');
		});
		expect(() => scheduler.warmScrubProxyFallback()).not.toThrow();
	});
});
