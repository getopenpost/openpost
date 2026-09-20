import { describe, expect, it, vi } from 'vitest';
import {
	boundedAnalysisDimensions,
	canvasFromBitmap,
	decodeLocalImage,
	encodeCanvas,
	extractPalette,
	mapRenderedPoint,
	ObjectURLSlot,
	rgbaToHex,
	sampleCanvasPixel,
	validateLocalImage
} from './local-image';

async function testImage(): Promise<File> {
	const canvas = document.createElement('canvas');
	canvas.width = 3;
	canvas.height = 2;
	const context = canvas.getContext('2d')!;
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, 1, 1);
	context.fillStyle = '#00ff00';
	context.fillRect(2, 1, 1, 1);
	const blob = await encodeCanvas(canvas, 'png');
	return new File([blob], 'pixels.png', { type: 'image/png' });
}

describe('local image processing', () => {
	it('applies a caller-specific upload size limit', () => {
		expect(() => validateLocalImage({ type: 'image/png', size: 26 }, 25)).toThrowError('too_large');
	});

	it('decodes and re-encodes at the original dimensions with PNG alpha intact', async () => {
		const bitmap = await decodeLocalImage(await testImage());
		expect({ width: bitmap.width, height: bitmap.height }).toEqual({ width: 3, height: 2 });
		const encoded = await encodeCanvas(
			canvasFromBitmap(bitmap, bitmap.width, bitmap.height),
			'png'
		);
		bitmap.close();
		const output = await createImageBitmap(encoded);
		const canvas = canvasFromBitmap(output, output.width, output.height);
		output.close();
		const context = canvas.getContext('2d')!;
		expect(sampleCanvasPixel(context, 0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
		expect(sampleCanvasPixel(context, 1, 1).a).toBe(0);
	});

	it('uses the chosen matte when encoding transparent pixels as JPEG', async () => {
		const bitmap = await decodeLocalImage(await testImage());
		const encoded = await encodeCanvas(canvasFromBitmap(bitmap, 3, 2, '#112233'), 'jpeg', 1);
		bitmap.close();
		const output = await createImageBitmap(encoded);
		const sampled = sampleCanvasPixel(canvasFromBitmap(output, 3, 2).getContext('2d')!, 1, 1);
		output.close();
		expect(sampled.a).toBe(1);
		expect(sampled.r).toBeGreaterThan(5);
		expect(sampled.b).toBeGreaterThan(sampled.r);
	});

	it('rejects an encoder fallback whose MIME does not match the requested output', async () => {
		const canvas = document.createElement('canvas');
		const original = canvas.toBlob.bind(canvas);
		canvas.toBlob = (callback) => callback(new Blob(['fallback'], { type: 'image/png' }));
		await expect(encodeCanvas(canvas, 'webp')).rejects.toMatchObject({ code: 'encode' });
		canvas.toBlob = original;
	});

	it('closes decoded images that exceed the safe pixel bounds', async () => {
		const close = vi.fn();
		const create = vi.stubGlobal(
			'createImageBitmap',
			vi.fn(async () => ({ width: 20_000, height: 20_000, close }))
		);
		await expect(decodeLocalImage(await testImage())).rejects.toMatchObject({ code: 'dimensions' });
		expect(close).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
	});

	it('maps rendered coordinates to the correct source pixel and clamps keyboard samples', () => {
		expect(
			mapRenderedPoint(150, 70, { left: 100, top: 20, width: 100, height: 100 }, 10, 20)
		).toEqual({ x: 5, y: 10 });
		const canvas = document.createElement('canvas');
		canvas.width = 2;
		canvas.height = 1;
		const context = canvas.getContext('2d')!;
		context.fillStyle = '#123456';
		context.fillRect(1, 0, 1, 1);
		expect(rgbaToHex(sampleCanvasPixel(context, 50, -4))).toBe('#123456');
	});

	it('bounds palette work and skips transparent pixels', () => {
		const canvas = document.createElement('canvas');
		canvas.width = 1000;
		canvas.height = 100;
		const context = canvas.getContext('2d', { willReadFrequently: true })!;
		context.fillStyle = '#ff0000';
		context.fillRect(0, 0, 700, 100);
		context.fillStyle = '#0000ff';
		context.fillRect(700, 0, 200, 100);
		const palette = extractPalette(context, 2, 1000);
		expect(palette.map(rgbaToHex)).toEqual(['#FF0000', '#0000FF']);
		const dimensions = boundedAnalysisDimensions(10_000, 5_000, 40_000);
		expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(40_000);
	});

	it('revokes replaced and cleared object URLs and rejects stale versions', () => {
		const create = vi
			.spyOn(URL, 'createObjectURL')
			.mockReturnValueOnce('blob:first')
			.mockReturnValueOnce('blob:second');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const slot = new ObjectURLSlot();
		const first = slot.set(new Blob());
		const second = slot.set(new Blob());
		expect(slot.isCurrent(first.version)).toBe(false);
		expect(slot.isCurrent(second.version)).toBe(true);
		slot.clear();
		expect(revoke.mock.calls).toEqual([['blob:first'], ['blob:second']]);
		create.mockRestore();
		revoke.mockRestore();
	});
});
