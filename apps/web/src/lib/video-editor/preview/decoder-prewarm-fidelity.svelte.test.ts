import { afterEach, expect, it } from 'vitest';
import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from 'mediabunny';
import {
	clearPreviewDecoderPrewarm,
	clonePrewarmedPreviewFrame,
	prewarmPreviewFrame
} from './decoder-prewarm-client';
import type { MediaMetadata } from '../media/types';

afterEach(clearPreviewDecoderPrewarm);

async function video(color: string): Promise<Blob> {
	const canvas = new OffscreenCanvas(32, 32);
	const context = canvas.getContext('2d')!;
	context.fillStyle = color;
	context.fillRect(0, 0, 32, 32);
	const target = new BufferTarget();
	const output = new Output({ target, format: new Mp4OutputFormat() });
	const source = new VideoSampleSource({ codec: 'avc', bitrate: 100_000 });
	output.addVideoTrack(source, { frameRate: 30 });
	await output.start();
	const sample = new VideoSample(canvas, { timestamp: 0, duration: 1 / 30 });
	try {
		await source.add(sample);
	} finally {
		sample.close();
	}
	source.close();
	await output.finalize();
	return new Blob([target.buffer!], { type: 'video/mp4' });
}

it.each(['proxy replacement', 'source relink'] as const)(
	'shows new pixels after %s with unchanged encoded size',
	async (change) => {
		const encoded = await Promise.all([video('#ff0000'), video('#0000ff')]);
		const size = Math.max(...encoded.map((blob) => blob.size));
		// MP4 readers ignore padding after the final box, preserving equal-size distinct sources.
		const [red, blue] = encoded.map(
			(blob) => new Blob([blob, new Uint8Array(size - blob.size)], { type: blob.type })
		);
		const media: MediaMetadata = {
			id: 'changing-preview',
			storageType: 'cloud',
			fileName: 'source.mp4',
			fileSize: size,
			mimeType: 'video/mp4',
			width: 32,
			height: 32,
			duration: 1 / 30,
			fps: 30,
			codec: 'avc',
			bitrate: 100_000,
			tags: []
		};
		const canvas = new OffscreenCanvas(32, 32);
		const context = canvas.getContext('2d')!;
		const urls: string[] = [];
		try {
			for (const [blob, channel] of [
				[red!, 0],
				[blue!, 2]
			] as const) {
				const url = URL.createObjectURL(blob);
				urls.push(url);
				await prewarmPreviewFrame(
					{ ...media, remoteUrl: change === 'source relink' ? url : urls[0] },
					0,
					change === 'proxy replacement' ? blob : undefined
				);
				const frame = await clonePrewarmedPreviewFrame(media.id, 0, 0);
				expect(frame).not.toBeNull();
				try {
					context.drawImage(frame!, 0, 0);
					const pixel = context.getImageData(16, 16, 1, 1).data;
					expect(pixel[channel]).toBeGreaterThan(240);
					expect(pixel[2 - channel]).toBeLessThan(15);
				} finally {
					frame?.close();
				}
			}
		} finally {
			urls.forEach((url) => URL.revokeObjectURL(url));
		}
	}
);
