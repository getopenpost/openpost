import { afterEach, expect, it, vi } from 'vitest';
import { createBlankProject } from '../project/defaults';
import { mediaPool } from './pool.svelte';
import { TimelineFrameRenderer } from './render-export';

afterEach(() => {
	vi.restoreAllMocks();
	mediaPool.clear();
});

it('shares one large decoded image between transition participants and releases it on disposal', async () => {
	const size = 2048;
	const source = new OffscreenCanvas(size, size);
	const context = source.getContext('2d')!;
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, size, size);
	const blob = await source.convertToBlob();
	const url = URL.createObjectURL(blob);
	mediaPool.upsert(
		{
			id: 'photo',
			storageType: 'cloud',
			remoteUrl: url,
			fileName: 'photo.png',
			fileSize: blob.size,
			mimeType: blob.type,
			width: size,
			height: size,
			duration: 0,
			fps: 0,
			codec: '',
			bitrate: 0,
			tags: []
		},
		'ready'
	);
	const project = createBlankProject('Shared image');
	project.metadata = { width: 64, height: 64, fps: 30 };
	project.timeline!.items = [0, 1].map((index) => ({
		id: `photo-${index}`,
		type: 'image',
		mediaId: 'photo',
		label: 'Photo',
		trackId: 'track-video-main',
		from: index * 30,
		durationInFrames: 30
	}));
	project.timeline!.transitions = [
		{
			id: 'dissolve',
			type: 'crossfade',
			fromItemId: 'photo-0',
			toItemId: 'photo-1',
			durationInFrames: 21
		}
	];
	const decode = vi.spyOn(globalThis, 'createImageBitmap');
	const renderer = new TimelineFrameRenderer(project);
	try {
		const canvas = await renderer.render(30);
		expect([...canvas.getContext('2d')!.getImageData(32, 32, 1, 1).data]).toEqual([255, 0, 0, 255]);
		const bitmaps = await Promise.all(decode.mock.results.map((result) => result.value));
		renderer.dispose();
		await expect.poll(() => bitmaps.map((bitmap) => bitmap.width)).toEqual(bitmaps.map(() => 0));
		expect(decode).toHaveBeenCalledTimes(1);
	} finally {
		renderer.dispose();
		for (const result of decode.mock.results) (await result.value)?.close();
		URL.revokeObjectURL(url);
	}
});
