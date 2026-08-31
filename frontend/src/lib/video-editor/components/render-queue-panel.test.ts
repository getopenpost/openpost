import { describe, expect, it } from 'vitest';
import type { RenderQueueJob } from '../export/render-queue-store';
import { completedExportRefreshKey } from './render-queue-panel';

function completedJob(id: string): RenderQueueJob {
	return {
		id,
		projectId: 'project',
		name: id,
		status: 'completed',
		progress: 1,
		settings: {
			format: 'mp4',
			codec: 'avc',
			quality: 'standard',
			width: 1920,
			height: 1080,
			subtitleMode: 'burn',
			range: { startFrame: 0, endFrame: 30 }
		},
		snapshot: {
			projectId: 'project',
			projectName: 'Project',
			fps: 30,
			width: 1920,
			height: 1080,
			tracks: [],
			items: [],
			transitions: [],
			compositions: []
		},
		createdAt: 1,
		finishedAt: 100
	};
}

describe('completedExportRefreshKey', () => {
	it('changes when another export completes at the same timestamp', () => {
		const first = completedJob('first');
		const second = completedJob('second');

		expect(completedExportRefreshKey([first, second])).not.toBe(completedExportRefreshKey([first]));
	});
});
