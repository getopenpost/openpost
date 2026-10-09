import { afterEach, expect, it } from 'vitest';
import {
	BufferTarget,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import { createBlankProject } from '../project/defaults';
import { TimelineFrameRenderer } from './render-export';
import { mediaPool } from './pool.svelte';
import { clearProxyCache, getProxy } from './proxy-client';
import { extractFreezeFrameFromBlob } from './freeze-frame';
import {
	clearPreviewDecoderPrewarm,
	clonePrewarmedPreviewFrame,
	prewarmPreviewFrame
} from '../preview/decoder-prewarm-client';

afterEach(() => {
	mediaPool.clear();
	clearProxyCache('picture');
	clearPreviewDecoderPrewarm();
});

function registerPicture(url: string, blob: Blob, width: number, height: number): void {
	mediaPool.upsert(
		{
			id: 'picture',
			storageType: 'cloud',
			remoteUrl: url,
			fileName: 'picture',
			fileSize: blob.size,
			mimeType: blob.type,
			width,
			height,
			duration: 1 / 30,
			fps: 30,
			codec: blob.type === 'video/webm' ? 'vp9' : 'avc',
			bitrate: 1_000_000,
			tags: []
		},
		'ready'
	);
}

async function pictureVideo(alpha: boolean, rotation: 0 | 90 | 180 | 270 = 0): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({
		target,
		format: alpha ? new WebMOutputFormat() : new Mp4OutputFormat()
	});
	const source = new VideoSampleSource({
		codec: alpha ? 'vp9' : 'avc',
		bitrate: 1_000_000,
		alpha: alpha ? 'keep' : 'discard'
	});
	output.addVideoTrack(source, { frameRate: 30, rotation });
	await output.start();
	const canvas = new OffscreenCanvas(80, 40);
	const context = canvas.getContext('2d')!;
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, 40, 40);
	if (!alpha) {
		context.fillStyle = '#0000ff';
		context.fillRect(40, 0, 40, 40);
	}
	const sample = new VideoSample(canvas, { timestamp: 0, duration: 1 / 30 });
	await source.add(sample);
	sample.close();
	source.close();
	await output.finalize();
	return new Blob([target.buffer!], { type: alpha ? 'video/webm' : 'video/mp4' });
}

it.each(['freeze', 'seek'])('preserves transparency in a %s frame', async (kind) => {
	const blob = await pictureVideo(true);
	const url = URL.createObjectURL(blob);
	registerPicture(url, blob, 80, 40);
	let bitmap: ImageBitmap | null = null;
	try {
		if (kind === 'freeze') {
			const frozen = await extractFreezeFrameFromBlob(
				blob,
				{
					id: 'freeze',
					type: 'video',
					trackId: 'track-video-main',
					label: 'Freeze',
					from: 0,
					durationInFrames: 3
				},
				1,
				60
			);
			bitmap = await createImageBitmap(frozen.blob);
		} else {
			await prewarmPreviewFrame(mediaPool.get('picture')!, 0);
			bitmap = await clonePrewarmedPreviewFrame('picture', 0, 0);
		}
		expect(bitmap).not.toBeNull();
		const canvas = new OffscreenCanvas(80, 40);
		const context = canvas.getContext('2d')!;
		context.drawImage(bitmap!, 0, 0);
		expect(context.getImageData(20, 20, 1, 1).data[0]).toBeGreaterThan(240);
		expect(context.getImageData(60, 20, 1, 1).data[3]).toBe(0);
	} finally {
		bitmap?.close();
		URL.revokeObjectURL(url);
	}
});

it.each([0, 90, 180, 270] as const)(
	'preserves the picture orientation of a %i degree rotated video',
	async (rotation) => {
		const blob = await pictureVideo(false, rotation);
		const url = URL.createObjectURL(blob);
		const width = rotation % 180 === 0 ? 80 : 40;
		const height = rotation % 180 === 0 ? 40 : 80;
		registerPicture(url, blob, width, height);
		const project = createBlankProject('Rotated source');
		project.metadata = { width: 80, height: 80, fps: 30, backgroundColor: '#00ff00' };
		project.timeline!.items = [
			{
				id: 'picture',
				mediaId: 'picture',
				type: 'video',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 1,
				label: 'Picture',
				sourceWidth: width,
				sourceHeight: height,
				transform: { width, height }
			}
		];
		const renderer = new TimelineFrameRenderer(project);
		try {
			const context = (await renderer.render(0)).getContext('2d')!;
			const redPoint =
				rotation === 0
					? [20, 40]
					: rotation === 90
						? [40, 20]
						: rotation === 180
							? [60, 40]
							: [40, 60];
			const red = context.getImageData(redPoint[0]!, redPoint[1]!, 1, 1).data;
			const blue = context.getImageData(80 - redPoint[0]!, 80 - redPoint[1]!, 1, 1).data;
			expect(red[0]).toBeGreaterThan(240);
			expect(red[2]).toBeLessThan(15);
			expect(blue[2]).toBeGreaterThan(240);
			expect(blue[0]).toBeLessThan(15);
			expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([0, 255, 0, 255]);
		} finally {
			renderer.dispose();
			URL.revokeObjectURL(url);
		}
	}
);

it.each(['source', 'proxy'])(
	'composites transparent video %s over the project background',
	async (variant) => {
		const blob = await pictureVideo(true);
		const url = URL.createObjectURL(blob);
		let proxyUrl: string | undefined;
		registerPicture(url, blob, 80, 40);
		if (variant === 'proxy') {
			const proxy = await getProxy(mediaPool.get('picture')!);
			proxyUrl = URL.createObjectURL(proxy);
			registerPicture(proxyUrl, proxy, 80, 40);
		}
		const project = createBlankProject('Transparent source');
		project.metadata = { width: 80, height: 40, fps: 30, backgroundColor: '#00ff00' };
		project.timeline!.items = [
			{
				id: 'picture',
				mediaId: 'picture',
				type: 'video',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 1,
				label: 'Picture'
			}
		];
		const renderer = new TimelineFrameRenderer(project);
		try {
			const context = (await renderer.render(0)).getContext('2d')!;
			expect(context.getImageData(20, 20, 1, 1).data[0]).toBeGreaterThan(240);
			expect([...context.getImageData(60, 20, 1, 1).data]).toEqual([0, 255, 0, 255]);
		} finally {
			renderer.dispose();
			URL.revokeObjectURL(url);
			if (proxyUrl) URL.revokeObjectURL(proxyUrl);
		}
	}
);

it.each(['clip', 'adjustment'])(
	'keeps %s blur proportional when resizing an export',
	async (owner) => {
		const project = createBlankProject('Blur scaling');
		project.metadata = { width: 64, height: 64, fps: 30 };
		project.timeline!.items = [
			{
				id: 'square',
				type: 'shape',
				shapeType: 'rectangle',
				fillColor: '#ff0000',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 1,
				label: 'Square',
				transform: { width: 32, height: 32 },
				effects: [{ id: 'blur', type: 'blur', enabled: true, amount: 4 }]
			}
		];
		if (owner === 'adjustment') {
			const shape = project.timeline!.items[0]!;
			project.timeline!.items.push({
				id: 'adjustment',
				type: 'adjustment',
				trackId: 'track-video-overlay',
				from: 0,
				durationInFrames: 1,
				label: 'Blur',
				effects: shape.effects
			});
			shape.effects = [];
		}
		const original = structuredClone(project);
		const normal = new TimelineFrameRenderer(project);
		const large = new TimelineFrameRenderer(project, { width: 128, height: 128 });
		try {
			const smallPixel = (await normal.render(0)).getContext('2d')!.getImageData(18, 32, 1, 1)
				.data[0]!;
			const largePixel = (await large.render(0)).getContext('2d')!.getImageData(36, 64, 1, 1)
				.data[0]!;
			expect(smallPixel).toBeGreaterThan(100);
			expect(smallPixel).toBeLessThan(240);
			expect(Math.abs(largePixel - smallPixel)).toBeLessThan(12);
			expect(project).toEqual(original);
		} finally {
			normal.dispose();
			large.dispose();
		}
	}
);

it('scales text with implicit font styling when resizing an export', async () => {
	const project = createBlankProject('Default text scaling');
	project.metadata = { width: 128, height: 128, fps: 30 };
	project.timeline!.items = [
		{
			id: 'text',
			type: 'text',
			text: 'M',
			color: '#ffffff',
			textAlign: 'left',
			verticalAlign: 'top',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 1,
			label: 'Text',
			transform: { width: 128, height: 128 }
		}
	];
	const counts: number[] = [];
	const origins: Array<[number, number]> = [];
	for (const width of [128, 256]) {
		const renderer = new TimelineFrameRenderer(project, { width, height: width });
		try {
			const data = (await renderer.render(0))
				.getContext('2d')!
				.getImageData(0, 0, width, width).data;
			counts.push(data.filter((value, index) => index % 4 === 0 && value > 128).length);
			let left = width;
			let top = width;
			for (let index = 0; index < data.length; index += 4) {
				if (data[index]! <= 128) continue;
				left = Math.min(left, (index / 4) % width);
				top = Math.min(top, Math.floor(index / 4 / width));
			}
			origins.push([left, top]);
		} finally {
			renderer.dispose();
		}
	}
	expect(counts[0]).toBeGreaterThan(20);
	expect(counts[1]! / counts[0]!).toBeGreaterThan(3.5);
	expect(counts[1]! / counts[0]!).toBeLessThan(4.5);
	for (const axis of [0, 1])
		expect(Math.abs(origins[1]![axis]! / 2 - origins[0]![axis]!)).toBeLessThan(2);
});

it.each([false, true])(
	'preserves a refitted crop in a resized export, nested=%s',
	async (nested) => {
		const blob = await pictureVideo(false);
		const url = URL.createObjectURL(blob);
		registerPicture(url, blob, 80, 40);
		const project = createBlankProject('Cropped source');
		project.metadata = { width: 80, height: 80, fps: 30, backgroundColor: '#00ff00' };
		project.timeline!.items = [
			{
				id: 'picture',
				mediaId: 'picture',
				type: 'video',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 1,
				label: 'Picture',
				sourceWidth: 80,
				sourceHeight: 40,
				transform: { width: 40, height: 40 },
				crop: { left: 0.5, top: 0, right: 0, bottom: 0, refit: true }
			}
		];
		if (nested) {
			project.timeline!.compositions = [
				{
					id: 'nested',
					name: 'Nested',
					width: 80,
					height: 80,
					fps: 30,
					durationInFrames: 1,
					items: project.timeline!.items,
					tracks: project.timeline!.tracks,
					transitions: []
				}
			];
			project.timeline!.items = [
				{
					id: 'nested',
					type: 'composition',
					compositionId: 'nested',
					trackId: 'track-video-main',
					from: 0,
					durationInFrames: 1,
					label: 'Nested'
				}
			];
		}
		const renderer = new TimelineFrameRenderer(project, { width: 160, height: 160 });
		try {
			const context = (await renderer.render(0)).getContext('2d')!;
			for (const [x, y] of [
				[45, 45],
				[115, 115]
			]) {
				const pixel = context.getImageData(x!, y!, 1, 1).data;
				expect(pixel[2]).toBeGreaterThan(240);
				expect(pixel[0]).toBeLessThan(15);
			}
			expect([...context.getImageData(30, 80, 1, 1).data]).toEqual([0, 255, 0, 255]);
		} finally {
			renderer.dispose();
			URL.revokeObjectURL(url);
		}
	}
);
