import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	disposeScrubProxyScheduler,
	invalidateScrubFallbacks,
	requestScrubFallback,
	resetScrubFallbackSchedulerDeps,
	setScrubFallbackSchedulerDeps,
	warmScrubProxyFallback
} from './scrub-proxy-scheduler';
import type { FilmstripFrame } from '../media/filmstrip-client';

function fakeBitmap(): ImageBitmap {
	// SAFETY: tests only assert close() on the stand-in; no pixels are read.
	return { close: vi.fn() } as ImageBitmap;
}

function frame(index: number): FilmstripFrame {
	// SAFETY: fallback selection only reads index/bitmap/url; the blob URL never resolves in tests.
	return { index, bitmap: undefined, url: `blob:frame-${index}` } as FilmstripFrame;
}

describe('scrub-proxy-scheduler', () => {
	beforeEach(() => {
		disposeScrubProxyScheduler();
		resetScrubFallbackSchedulerDeps();
	});

	it('shares one clone across concurrent requests for the same frame', async () => {
		const cloneFrame = vi.fn(async () => fakeBitmap());
		setScrubFallbackSchedulerDeps({
			lookupCachedFilmstrip: () => ({ frames: [frame(0), frame(1)] }),
			cloneFrame
		});
		// fps plan: FILMSTRIP_FRAME_RATE frames; timestamp near frame 1.
		const [first, second] = await Promise.all([
			requestScrubFallback('media-a', 1, 60),
			requestScrubFallback('media-a', 1, 60)
		]);
		expect(cloneFrame).toHaveBeenCalledTimes(1);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
	});

	it('returns null when the nearest frame drifts too far', async () => {
		const cloneFrame = vi.fn(async () => fakeBitmap());
		setScrubFallbackSchedulerDeps({
			lookupCachedFilmstrip: () => ({ frames: [frame(0)] }),
			cloneFrame
		});
		await expect(requestScrubFallback('media-a', 10, 0.75)).resolves.toBeNull();
		expect(cloneFrame).not.toHaveBeenCalled();
	});

	it('drops superseded clones instead of presenting them', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const bitmap = fakeBitmap();
		setScrubFallbackSchedulerDeps({
			lookupCachedFilmstrip: () => ({ frames: [frame(0)] }),
			cloneFrame: async () => {
				await gate;
				return bitmap;
			}
		});
		const pending = requestScrubFallback('media-a', 0, 60);
		invalidateScrubFallbacks('media-a');
		release();
		await expect(pending).resolves.toBeNull();
		expect(bitmap.close).toHaveBeenCalledTimes(1);
	});

	it('prewarms filmstrips through the hook and tolerates failures', () => {
		const prewarmFilmstrips = vi.fn();
		setScrubFallbackSchedulerDeps({ prewarmFilmstrips });
		warmScrubProxyFallback();
		expect(prewarmFilmstrips).toHaveBeenCalledTimes(1);
		setScrubFallbackSchedulerDeps({
			prewarmFilmstrips: () => {
				throw new Error('boom');
			}
		});
		expect(() => warmScrubProxyFallback()).not.toThrow();
	});
});
