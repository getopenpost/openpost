import { afterEach, describe, expect, it } from 'vitest';
import { BufferTarget, Output, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import { readBlob, readJson } from '../workspace-fs/fs-primitives';
import {
	mediaMetadataPath,
	mediaSourceByFileName,
	mediaThumbnailPath
} from '../workspace-fs/paths';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { importGeneratedVideo } from './import.svelte';
import { mediaPool } from './pool.svelte';
import type { MediaMetadata } from './types';

let workspaceName: string | null = null;

async function generatedVideo(): Promise<File> {
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new VideoSampleSource({ codec: 'vp8', bitrate: 300_000, keyFrameInterval: 1 });
	output.addVideoTrack(source, { frameRate: 2 });
	await output.start();
	const canvas = new OffscreenCanvas(64, 36);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	for (let frame = 0; frame < 2; frame++) {
		context.fillStyle = frame === 0 ? '#e23b3b' : '#376ee6';
		context.fillRect(0, 0, 64, 36);
		const sample = new VideoSample(canvas, {
			timestamp: frame / 2,
			duration: 0.5
		});
		await source.add(sample);
		sample.close();
	}
	source.close();
	await output.finalize();
	if (!target.buffer) throw new Error('Video render produced no bytes.');
	return new File([target.buffer], 'generated.webm', { type: 'video/webm' });
}

afterEach(async () => {
	mediaPool.clear();
	setWorkspaceRoot(null);
	if (workspaceName) {
		const root = await navigator.storage.getDirectory();
		await root.removeEntry(workspaceName, { recursive: true }).catch(() => undefined);
		workspaceName = null;
	}
});

describe('generated video import', () => {
	it('probes, thumbnails, persists, associates, and exposes a rendered video as first-class media', async () => {
		const root = await navigator.storage.getDirectory();
		workspaceName = `generated-video-test-${crypto.randomUUID()}`;
		const workspace = await root.getDirectoryHandle(workspaceName, { create: true });
		setWorkspaceRoot(workspace);

		const imported = await importGeneratedVideo(await generatedVideo(), {
			projectId: 'project',
			tags: ['upscaled']
		});

		expect(imported).toMatchObject({
			storageType: 'workspace',
			fileName: 'generated.webm',
			mimeType: 'video/webm',
			width: 64,
			height: 36,
			fps: 2,
			codec: 'vp8'
		});
		expect(imported.tags).toEqual(expect.arrayContaining(['video', 'upscaled']));
		expect(imported.frameRateMetrics).toMatchObject({
			bestGuessFrameRate: 2,
			frameRateIsConstant: true,
			underlyingFrameRate: 2
		});
		expect(mediaPool.get(imported.id)).toEqual(imported);
		expect(
			await readBlob(workspace, mediaSourceByFileName(imported.id, imported.fileName))
		).not.toBeNull();
		expect(await readBlob(workspace, mediaThumbnailPath(imported.id))).not.toBeNull();
		expect(
			(await readJson<MediaMetadata>(workspace, mediaMetadataPath(imported.id)))?.frameRateMetrics
		).toEqual(imported.frameRateMetrics);
	});
});
