import { describe, expect, it } from 'vitest';
import { BufferTarget, Output, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import type { MediaMetadata } from './types';
import { scanSceneCuts } from './scene-scan';
import { detectAdaptiveSceneCuts } from './scene-search/scene-analysis-client';

const SIZE = 64;
const FPS = 6;

async function renderSceneVideo(colors: readonly string[]): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 500_000, keyFrameInterval: 1 });
	output.addVideoTrack(source, { frameRate: FPS });
	await output.start();
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	for (let frame = 0; frame < colors.length; frame += 1) {
		context.fillStyle = colors[frame]!;
		context.fillRect(0, 0, SIZE, SIZE);
		const sample = new VideoSample(canvas, {
			timestamp: frame / FPS,
			duration: 1 / FPS
		});
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Scene fixture produced no bytes');
	return new Blob([target.buffer], { type: 'video/webm' });
}

function media(blob: Blob): MediaMetadata {
	return {
		id: crypto.randomUUID(),
		storageType: 'handle',
		// SAFETY: the scene scanner only calls getFile on this test handle.
		fileHandle: {
			getFile: async () => new File([blob], 'scenes.webm', { type: blob.type })
		} as FileSystemFileHandle,
		fileName: 'scenes.webm',
		fileSize: blob.size,
		mimeType: blob.type,
		duration: 2,
		width: SIZE,
		height: SIZE,
		fps: FPS,
		codec: 'vp8',
		bitrate: 500_000,
		tags: ['video']
	};
}

describe('scene scanning', () => {
	it('finds a hard cut through both the fast and frame-accurate detectors', async () => {
		const blob = await renderSceneVideo([
			...Array<string>(6).fill('#ef4444'),
			...Array<string>(6).fill('#2563eb')
		]);
		const source = media(blob);

		const fastFrames = await scanSceneCuts(source, { sourceFps: FPS, mode: 'fast' });
		const adaptiveCuts = await detectAdaptiveSceneCuts(source);

		expect(fastFrames).toHaveLength(1);
		expect(fastFrames[0]).toBeGreaterThanOrEqual(5);
		expect(fastFrames[0]).toBeLessThanOrEqual(7);
		expect(adaptiveCuts).toHaveLength(1);
		expect(adaptiveCuts[0]!.time).toBeCloseTo(1, 1);
	});

	it('does not invent cuts in a continuous shot', async () => {
		const source = media(await renderSceneVideo(Array<string>(12).fill('#16a34a')));

		await expect(scanSceneCuts(source, { sourceFps: FPS, mode: 'fast' })).resolves.toEqual([]);
		await expect(detectAdaptiveSceneCuts(source)).resolves.toEqual([]);
	});
});
