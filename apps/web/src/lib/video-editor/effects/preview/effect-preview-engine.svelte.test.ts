import { expect, it } from 'vitest';
import { getEffectPreviewPoster } from './effect-preview-engine';

it('shows colored Heatmap contours in the gallery poster', async () => {
	const frame = await getEffectPreviewPoster([{ kind: 'gpu', effectId: 'gpu-paper-heatmap' }]);
	expect(frame?.mode).toBe('gpu');
	if (!frame) throw new Error('Missing Heatmap poster');
	const canvas = new OffscreenCanvas(160, 90);
	const context = canvas.getContext('2d')!;
	context.drawImage(frame.canvas, 0, 0);
	const pixels = context.getImageData(0, 0, 160, 90).data;
	let warmPixels = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		if (pixels[i] > 180 && pixels[i] > pixels[i + 2] * 1.5) warmPixels++;
	}
	expect(warmPixels).toBeGreaterThan(100);
});
