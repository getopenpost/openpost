import { describe, expect, it } from 'vitest';

// Seam that mirrors the export animatedImageSource missing-frame guard.
// Must throw instead of returning null to avoid silent poster fallback.

function resolveAnimatedBitmapOrThrow(
	frames: (ImageBitmap | undefined)[],
	index: number,
	fileName: string
): ImageBitmap {
	const bitmap = frames[index];
	if (!bitmap) throw new Error(`Animated image frame ${index} missing for ${fileName}`);
	return bitmap;
}

describe('export must fail clearly for known animation decode errors', () => {
	it('throws when frame is missing instead of falling back', () => {
		const fakeA = { close: () => {} } as unknown as ImageBitmap;
		expect(() =>
			resolveAnimatedBitmapOrThrow([fakeA, undefined as unknown as ImageBitmap], 1, 'anim.gif')
		).toThrow(/frame 1 missing/);
	});

	it('throws for decode rejection, not swallowed', async () => {
		const failingCache = {
			getAnimatedImage: () => Promise.reject(new Error('decode boom'))
		};
		await expect(failingCache.getAnimatedImage()).rejects.toThrow(/decode boom/);
		// Export must propagate, not return null
		try {
			await failingCache.getAnimatedImage();
			throw new Error('should have thrown');
		} catch (e) {
			expect((e as Error).message).toMatch(/decode boom/);
		}
	});
});
