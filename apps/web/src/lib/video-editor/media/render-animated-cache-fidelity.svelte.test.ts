import { afterEach, expect, it } from 'vitest';
import { createBlankProject } from '../project/defaults';
import { animatedImageCache } from './animated-image-client';
import { saveAnimatedImageFrame, saveAnimatedImageMeta } from './animated-image-persistence';
import { mediaPool } from './pool.svelte';
import { TimelineFrameRenderer } from './render-export';

const mediaIds: string[] = [];
afterEach(async () => {
	for (const id of mediaIds.splice(0)) await animatedImageCache.clearMedia(id);
	mediaPool.clear();
});

async function persistedAnimation(size: number, color: string): Promise<string> {
	const id = crypto.randomUUID();
	mediaIds.push(id);
	const canvas = new OffscreenCanvas(size, size);
	const context = canvas.getContext('2d')!;
	context.fillStyle = color;
	context.fillRect(0, 0, size, size);
	const blob = await canvas.convertToBlob();
	for (let index = 0; index < 3; index++) await saveAnimatedImageFrame(id, index, blob);
	await saveAnimatedImageMeta(id, {
		width: size,
		height: size,
		durationsMs: [100, 100, 100],
		frameCount: 3
	});
	mediaPool.upsert(
		{
			id,
			storageType: 'cloud',
			fileName: 'animation.gif',
			fileSize: blob.size,
			mimeType: 'image/gif',
			width: size,
			height: size,
			duration: 0.3,
			fps: 10,
			codec: '',
			bitrate: 0,
			tags: ['image'],
			animationFrameCount: 3
		},
		'ready'
	);
	return id;
}

it('keeps animated transition sources alive across cache eviction and subsequent reuse', async () => {
	// Together these real decoded frames exceed the shared 128MiB cache budget.
	const red = await persistedAnimation(2048, '#ff0000');
	const blue = await persistedAnimation(3072, '#0000ff');
	const green = await persistedAnimation(2048, '#00ff00');
	const project = createBlankProject('Animated cache pressure');
	project.metadata = { width: 64, height: 64, fps: 30 };
	project.timeline!.items = [red, blue, green, red].map((mediaId, index) => ({
		id: `image-${index}`,
		mediaId,
		type: 'image',
		label: 'Animation',
		trackId: 'track-video-main',
		from: index * 30,
		durationInFrames: 30
	}));
	project.timeline!.transitions = [
		{
			id: 'dissolve',
			type: 'crossfade',
			fromItemId: 'image-0',
			toItemId: 'image-1',
			durationInFrames: 10
		}
	];
	const renderer = new TimelineFrameRenderer(project);
	const pixel = async (frame: number) => [
		...(await renderer.render(frame)).getContext('2d')!.getImageData(32, 32, 1, 1).data
	];
	try {
		expect(await pixel(0)).toEqual([255, 0, 0, 255]);
		const blended = await pixel(30);
		expect(blended[0]).toBeGreaterThan(80);
		expect(blended[2]).toBeGreaterThan(80);
		expect(await pixel(40)).toEqual([0, 0, 255, 255]);
		expect(await pixel(60)).toEqual([0, 255, 0, 255]);
		expect(await pixel(90)).toEqual([255, 0, 0, 255]);
	} finally {
		renderer.dispose();
	}
});

it('defers retired animation bitmap cleanup until every consumer releases its lease', async () => {
	const id = await persistedAnimation(16, '#ff0000');
	const media = mediaPool.get(id)!;
	const first = await animatedImageCache.acquire(media);
	const second = await animatedImageCache.acquire(media);
	try {
		await animatedImageCache.clearMedia(id);
		first.release();
		first.release();
		const canvas = new OffscreenCanvas(16, 16);
		const context = canvas.getContext('2d')!;
		context.drawImage(second.frames.frames[0]!, 0, 0);
		expect([...context.getImageData(8, 8, 1, 1).data]).toEqual([255, 0, 0, 255]);
		second.release();
		expect(second.frames.frames.map((frame) => frame.width)).toEqual([0, 0, 0]);
	} finally {
		first.release();
		second.release();
	}
});
