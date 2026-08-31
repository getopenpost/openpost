import { describe, expect, it } from 'vitest';
import { renderColorGradeTile } from './color-grade-tile-renderer';

async function averageRed(blob: Blob): Promise<number> {
	const bitmap = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
	let total = 0;
	for (let index = 0; index < pixels.length; index += 4) total += pixels[index] ?? 0;
	return total / (pixels.length / 4);
}

describe('color filmstrip GPU renderer', () => {
	it('bakes the real effect stack into a bounded thumbnail blob', async () => {
		const source = document.createElement('canvas');
		source.width = 640;
		source.height = 360;
		const context = source.getContext('2d');
		if (!context) throw new Error('2D canvas unavailable');
		context.fillStyle = 'rgb(64 64 64)';
		context.fillRect(0, 0, source.width, source.height);

		const blob = await renderColorGradeTile(
			source.toDataURL('image/png'),
			[{ effectId: 'gpu-brightness', params: { amount: 0.5 } }],
			256
		);

		expect(blob).not.toBeNull();
		if (!blob) return;
		const bitmap = await createImageBitmap(blob);
		expect(Math.max(bitmap.width, bitmap.height)).toBe(256);
		expect(bitmap.width / bitmap.height).toBeCloseTo(16 / 9, 1);
		bitmap.close();
		expect(await averageRed(blob)).toBeGreaterThan(170);
	});
});
