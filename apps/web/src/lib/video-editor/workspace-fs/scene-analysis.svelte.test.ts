import { expect, it } from 'vitest';
import { getWorkspaceRoot, setWorkspaceRoot } from '@openpost/editor-shared/workspace';
import {
	deleteSceneAnalysis,
	getSceneAnalysis,
	getSceneThumbnail,
	saveSceneAnalysis,
	saveSceneThumbnail
} from './scene-analysis';
import type { SceneAnalysis } from '../media/scene-search/types';

it('persists derived scenes, vectors and thumbnails without a local workspace folder', async () => {
	const previous = getWorkspaceRoot();
	setWorkspaceRoot(null);
	const mediaId = crypto.randomUUID();
	const analysis: SceneAnalysis = {
		schemaVersion: 1,
		detectorVersion: 1,
		mediaId,
		sourceFileSize: 10,
		method: 'image',
		sampleIntervalSec: 1,
		analyzedAt: 1,
		scenes: [
			{
				id: `${mediaId}:0`,
				mediaId,
				index: 0,
				startSec: 0,
				endSec: 1,
				timeSec: 0,
				text: 'A launch',
				embedding: new Float32Array([1, 0]),
				imageEmbedding: new Float32Array([0, 1])
			}
		]
	};
	try {
		expect(await getSceneAnalysis(mediaId)).toBeNull();
		await saveSceneAnalysis(analysis);
		const thumbnail = await saveSceneThumbnail(mediaId, 0, new Blob(['thumbnail']));
		expect(await getSceneAnalysis(mediaId)).toMatchObject(analysis);
		expect(await (await getSceneThumbnail(thumbnail))?.text()).toBe('thumbnail');
		await deleteSceneAnalysis(mediaId);
		expect(await getSceneAnalysis(mediaId)).toBeNull();
		expect(await getSceneThumbnail(thumbnail)).toBeNull();
	} finally {
		setWorkspaceRoot(previous);
	}
});
