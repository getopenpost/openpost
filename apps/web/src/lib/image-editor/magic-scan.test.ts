import { describe, expect, it } from 'vitest';
import { scanMagicPixels } from './magic-scan-core';
import { ImageEditorMagicScan, MAXIMUM_MAGIC_SCAN_PIXELS } from './magic-scan';

function image(width: number, height: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let index = 0; index < width * height; index++) {
		data[index * 4] = index % width < width / 2 ? 255 : 0;
		data[index * 4 + 3] = index < width ? 0 : 255;
	}
	return data;
}

describe('OpenPost Image Editor cancellable magic pixel scan', () => {
	it('treats alpha as part of the match and preserves contiguous semantics', async () => {
		const data = image(6, 4);
		const transparent = await scanMagicPixels({
			width: 6,
			height: 4,
			data,
			point: { x: 1, y: 0 },
			tolerance: 0,
			contiguous: true
		});
		expect(transparent.reduce((total, value) => total + value, 0)).toBe(3);

		const globalRed = await scanMagicPixels({
			width: 6,
			height: 4,
			data,
			point: { x: 1, y: 2 },
			tolerance: 0,
			contiguous: false
		});
		expect(globalRed.reduce((total, value) => total + value, 0)).toBe(9);
	});

	it('yields progress and cancels without returning a partial mask', async () => {
		let cancelled = false;
		let progressCalls = 0;
		await expect(
			scanMagicPixels(
				{
					width: 300,
					height: 300,
					data: new Uint8ClampedArray(300 * 300 * 4),
					point: { x: 0, y: 0 },
					tolerance: 0,
					contiguous: false
				},
				{
					yieldEvery: 4_096,
					shouldCancel: () => cancelled,
					onProgress: () => {
						progressCalls++;
						cancelled = true;
					}
				}
			)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(progressCalls).toBeGreaterThan(0);
	});

	it('includes exact tolerance boundaries for color and alpha', async () => {
		const data = new Uint8ClampedArray([
			100, 100, 100, 200, 112, 100, 100, 200, 113, 100, 100, 200, 100, 100, 100, 188
		]);
		const mask = await scanMagicPixels({
			width: 4,
			height: 1,
			data,
			point: { x: 0, y: 0 },
			tolerance: 12,
			contiguous: false
		});
		expect(Array.from(mask)).toEqual([1, 1, 0, 1]);
	});

	it('rejects unsafe image dimensions before allocating a worker scan', async () => {
		const scanner = new ImageEditorMagicScan();
		await expect(
			scanner.scan({
				width: MAXIMUM_MAGIC_SCAN_PIXELS + 1,
				height: 1,
				data: new Uint8ClampedArray(),
				point: { x: 0, y: 0 },
				tolerance: 0,
				contiguous: true
			})
		).rejects.toBeInstanceOf(RangeError);
		scanner.dispose();
	});
});
