import { afterEach, describe, expect, it } from 'vitest';
import { importGeneratedImage } from '../import.svelte';
import { mediaPool } from '../pool.svelte';
import { getSceneThumbnail } from '../../workspace-fs/scene-analysis';
import { setWorkspaceRoot } from '../../workspace-fs/root';
import { analyzeMediaScenes } from './scene-analysis-client';

let workspaceName: string | null = null;

async function generatedPng(): Promise<File> {
	const canvas = new OffscreenCanvas(640, 360);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable.');
	context.fillStyle = '#c64f18';
	context.fillRect(0, 0, canvas.width, canvas.height);
	const blob = await canvas.convertToBlob({ type: 'image/png' });
	return new File([blob], 'scene still.png', { type: 'image/png' });
}

afterEach(async () => {
	mediaPool.clear();
	setWorkspaceRoot(null);
	if (!workspaceName) return;
	const root = await navigator.storage.getDirectory();
	await root.removeEntry(workspaceName, { recursive: true }).catch(() => undefined);
	workspaceName = null;
});

describe('still-image scene analysis', () => {
	it('builds one persisted scene from the imported image thumbnail without a video decoder', async () => {
		const root = await navigator.storage.getDirectory();
		workspaceName = `image-scene-analysis-${crypto.randomUUID()}`;
		const workspace = await root.getDirectoryHandle(workspaceName, { create: true });
		setWorkspaceRoot(workspace);
		const media = await importGeneratedImage(await generatedPng(), {
			projectId: 'project',
			width: 640,
			height: 360
		});
		const progress: number[] = [];

		const analysis = await analyzeMediaScenes(media, {
			onProgress: (next) => progress.push(next.percent)
		});

		expect(analysis).toMatchObject({
			mediaId: media.id,
			method: 'image',
			scenes: [
				{
					id: `${media.id}:0`,
					startSec: 0,
					endSec: 3,
					timeSec: 0
				}
			]
		});
		expect(progress).toEqual([0, 100]);
		const thumbnail = await getSceneThumbnail(analysis.scenes[0]!.thumbRelPath!);
		expect(thumbnail?.type).toBe('image/jpeg');
		expect((await analyzeMediaScenes(media)).analyzedAt).toBe(analysis.analyzedAt);
	});
});
