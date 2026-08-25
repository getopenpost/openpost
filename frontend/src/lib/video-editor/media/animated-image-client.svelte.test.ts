import { describe, expect, it } from 'vitest';
import { animatedImageCache } from './animated-image-client';
import type { AnimatedImageFrames } from './animated-image-client';
import { animatedFrameIndexAtTime } from './animated-image-plan';
import {
	loadAnimatedImage,
	removeAnimatedImage
} from './animated-image-persistence';
import animatedGifUrl from './fixtures/animated-rgb.gif?url';
import animatedWebpUrl from './fixtures/animated-rgb.webp?url';
import type { MediaMetadata } from './types';

let fixtureSeq = 0;

function stubFileHandle(getFile: () => Promise<File>): FileSystemFileHandle {
	// SAFETY: resolveMediaBlob only reads name and getFile from this stub handle.
	return { kind: 'file', getFile } as FileSystemFileHandle;
}

async function animatedImageMedia(url: string, fileName: string): Promise<MediaMetadata> {
	const blob = await (await fetch(url)).blob();
	const handle = stubFileHandle(async () => new File([blob], fileName));
	return {
		id: `test-animated-${++fixtureSeq}`,
		storageType: 'handle',
		fileName,
		fileSize: blob.size,
		mimeType: fileName.endsWith('.gif') ? 'image/gif' : 'image/webp',
		duration: 0.3,
		width: 16,
		height: 12,
		fps: 10,
		codec: '',
		bitrate: 0,
		animationFrameCount: 3,
		tags: ['image'],
		fileHandle: handle
	};
}

function centerColor(frames: AnimatedImageFrames, index: number): string {
	const bitmap = frames.frames[index];
	expect(bitmap).toBeDefined();
	const canvas = document.createElement('canvas');
	canvas.width = bitmap!.width;
	canvas.height = bitmap!.height;
	const context = canvas.getContext('2d');
	context?.drawImage(bitmap!, 0, 0);
	const data = context?.getImageData(8, 6, 1, 1).data;
	expect(data).toBeDefined();
	const [r, g, b] = [data![0], data![1], data![2]];
	if (r! > 150 && g! < 120) return 'red';
	if (g! > 100 && r! < 120) return 'green';
	if (b! > 150) return 'blue';
	return `unknown(${r},${g},${b})`;
}

describe('animated image frame cache', () => {
	it('extracts exact per-frame delays from an animated GIF', async () => {
		const media = await animatedImageMedia(animatedGifUrl, 'animated-rgb.gif');
		try {
			const frames = await animatedImageCache.getAnimatedImage(media);
			expect(frames.isComplete).toBe(true);
			expect(frames.frames.length).toBe(3);
			expect(frames.durationsMs).toEqual([100, 100, 100]);
			expect(frames.totalDurationMs).toBe(300);
			expect([frames.width, frames.height]).toEqual([16, 12]);
			expect(frames.cumulativeDelaysMs).toEqual([0, 100, 200, 300]);
			expect(centerColor(frames, 0)).toBe('red');
			expect(centerColor(frames, 1)).toBe('green');
			expect(centerColor(frames, 2)).toBe('blue');

			// Frame lookup follows the exact delay boundaries.
			expect(animatedFrameIndexAtTime(frames.cumulativeDelaysMs, frames.totalDurationMs, 50)).toBe(
				0
			);
			expect(
				animatedFrameIndexAtTime(frames.cumulativeDelaysMs, frames.totalDurationMs, 250)
			).toBe(2);

			// A second request resolves from the memory cache without re-extracting.
			const again = await animatedImageCache.getAnimatedImage(media);
			expect(again.frames[0]).toBe(frames.frames[0]);
		} finally {
			await animatedImageCache.clearMedia(media.id);
		}
	});

	it('extracts an animated WebP and persists frames for reload', async () => {
		const media = await animatedImageMedia(animatedWebpUrl, 'animated-rgb.webp');
		try {
			const frames = await animatedImageCache.getAnimatedImage(media);
			expect(frames.frames.length).toBe(3);
			expect(frames.durationsMs).toEqual([100, 100, 100]);
			expect(centerColor(frames, 2)).toBe('blue');

			const persisted = await loadAnimatedImage(media.id);
			expect(persisted).not.toBeNull();
			expect(persisted?.durationsMs).toEqual([100, 100, 100]);
			expect(persisted?.frames.length).toBe(3);

			await animatedImageCache.clearMedia(media.id);
			await expect(loadAnimatedImage(media.id)).resolves.toBeNull();
		} finally {
			await removeAnimatedImage(media.id);
		}
	});

	it('rejects static images instead of pretending they animate', async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 4;
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		const media: MediaMetadata = {
			id: `test-static-${++fixtureSeq}`,
			storageType: 'handle',
			fileName: 'static.png',
			fileSize: blob?.size ?? 0,
			mimeType: 'image/png',
			duration: 0,
			width: 4,
			height: 4,
			fps: 0,
			codec: '',
			bitrate: 0,
			tags: ['image'],
			fileHandle: stubFileHandle(async () => new File([blob ?? new Blob()], 'static.png'))
		};
		await expect(animatedImageCache.getAnimatedImage(media)).rejects.toThrow(/not animated/);
	});
});
