import { describe, expect, it } from 'vitest';
import type { RenderQueueJob, RenderQueueSnapshot } from './render-queue-store';
import {
	renderQueuePersistenceSignature,
	restoreRenderQueue,
	serializeRenderQueue
} from './render-queue-persistence';

const snapshot: RenderQueueSnapshot = {
	projectId: 'project',
	projectName: 'Project',
	fps: 30,
	width: 1920,
	height: 1080,
	tracks: [],
	items: [],
	transitions: [],
	compositions: []
};

function job(id: string, status: RenderQueueJob['status']): RenderQueueJob {
	return {
		id,
		projectId: 'project',
		name: id,
		status,
		progress: status === 'rendering' ? 0.5 : 0,
		settings: {
			format: 'webm',
			codec: 'vp9',
			quality: 'standard',
			width: 1920,
			height: 1080,
			subtitleMode: 'burn',
			range: { startFrame: 0, endFrame: 30 }
		},
		snapshot,
		createdAt: 1
	};
}

describe('render queue persistence', () => {
	it('deduplicates shared snapshots and pauses restored in-flight work', () => {
		const rendering = {
			...job('a', 'rendering'),
			phase: 'rendering' as const,
			framesDone: 15,
			totalFrames: 30
		};
		const document = serializeRenderQueue([rendering, job('b', 'queued')], false);
		expect(Object.keys(document.snapshots)).toHaveLength(1);
		expect(document.jobs.map(({ snapshotId }) => snapshotId)).toEqual(['snapshot-1', 'snapshot-1']);

		const restored = restoreRenderQueue(document);
		expect(restored.isPaused).toBe(true);
		expect(restored.jobs[0]?.snapshot).toBe(restored.jobs[1]?.snapshot);
		expect(restored.jobs[0]).toMatchObject({
			progress: 0.5,
			phase: 'rendering',
			framesDone: 15,
			totalFrames: 30
		});
	});

	it('detects frame progress changes that require a durable save', () => {
		const rendering = { ...job('a', 'rendering'), phase: 'rendering' as const };
		const before = renderQueuePersistenceSignature([rendering], false);
		const after = renderQueuePersistenceSignature(
			[{ ...rendering, progress: 0.5, framesDone: 15, totalFrames: 30 }],
			false
		);

		expect(after).not.toBe(before);
	});

	it('keeps queued work unpaused when the saved queue was running', () => {
		const restored = restoreRenderQueue(serializeRenderQueue([job('queued', 'queued')], false));

		expect(restored.isPaused).toBe(false);
		expect(restored.jobs).toHaveLength(1);
	});

	it('rejects unsupported documents without guessing', () => {
		// SAFETY: this deliberately invalid schema version exercises the runtime compatibility guard.
		expect(
			restoreRenderQueue({
				...serializeRenderQueue([], false),
				schemaVersion: 2
			} as never)
		).toEqual({ jobs: [], isPaused: false });
	});
});
