import { describe, expect, it } from 'vitest';
import { fileWithInferredMediaType } from './media-file-types';
import { probeMediaFile } from './probe-client';
import animatedGifUrl from './fixtures/animated-rgb.gif?url';
import animatedWebpUrl from './fixtures/animated-rgb.webp?url';

async function fixtureFile(url: string, name: string): Promise<File> {
	const response = await fetch(url);
	expect(response.ok).toBe(true);
	return fileWithInferredMediaType(new File([await response.blob()], name));
}

describe('animated image import probe', () => {
	it('reports real animation metadata for an animated GIF instead of a frozen still', async () => {
		const probe = await probeMediaFile(await fixtureFile(animatedGifUrl, 'animated-rgb.gif'));
		expect(probe.kind).toBe('image');
		expect(probe.animationFrameCount).toBeGreaterThan(1);
		expect(probe.durationSeconds).toBeCloseTo(0.3, 2);
		expect(probe.fps).toBeGreaterThan(0);
		expect(probe.width).toBe(16);
		expect(probe.height).toBe(12);
		expect(probe.thumbnailBlob?.size).toBeGreaterThan(0);
	});

	it('reports real animation metadata for an animated WebP instead of a frozen still', async () => {
		const probe = await probeMediaFile(await fixtureFile(animatedWebpUrl, 'animated-rgb.webp'));
		expect(probe.kind).toBe('image');
		expect(probe.animationFrameCount).toBeGreaterThan(1);
		expect(probe.durationSeconds).toBeCloseTo(0.3, 2);
		expect(probe.fps).toBeGreaterThan(0);
	});

	it('keeps static images non-animated', async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 4;
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		const file = fileWithInferredMediaType(new File([blob ?? new Blob()], 'static.png'));
		const probe = await probeMediaFile(file);
		expect(probe.kind).toBe('image');
		expect(probe.animationFrameCount).toBeUndefined();
		expect(probe.durationSeconds).toBe(0);
	});
});
