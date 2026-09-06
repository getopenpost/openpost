import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createRenderQueueStore, type RenderQueueJob } from './render-queue-store';

function job(id: string, status: RenderQueueJob['status'] = 'queued'): RenderQueueJob {
	return {
		id,
		projectId: 'project',
		name: `Job ${id}`,
		status,
		progress: status === 'completed' ? 1 : 0,
		settings: {
			format: 'mp4',
			codec: 'avc',
			quality: 'standard',
			width: 1920,
			height: 1080,
			subtitleMode: 'burn',
			range: { startFrame: 0, endFrame: 300 }
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
		createdAt: 1
	};
}

describe('render queue store', () => {
	it('runs one queued job at a time and records terminal output', () => {
		const queue = createRenderQueueStore();
		queue.enqueue([job('a'), job('b')]);
		expect(queue.next()?.id).toBe('a');
		expect(queue.markRendering('a')).toBe(true);
		expect(queue.markRendering('b')).toBe(false);
		expect(get(queue).jobs[0]).toMatchObject({
			status: 'rendering',
			phase: 'preparing',
			progress: 0,
			framesDone: 0,
			totalFrames: 300
		});
		queue.updateProgress('a', {
			phase: 'rendering',
			progress: 0.5,
			framesDone: 150,
			totalFrames: 300
		});
		queue.markCompleted('a', {
			savedPath: 'exports/a.mp4',
			outputLabel: 'a.mp4',
			fileSize: 42
		});

		expect(get(queue).jobs[0]).toMatchObject({
			status: 'completed',
			progress: 1,
			savedPath: 'exports/a.mp4',
			outputLabel: 'a.mp4',
			fileSize: 42
		});
		expect(queue.next()?.id).toBe('b');
	});

	it('reorders only queued work and retries failed or cancelled jobs cleanly', () => {
		const queue = createRenderQueueStore();
		queue.hydrate([job('done', 'completed'), job('a'), job('failed', 'failed'), job('b')], false);
		queue.move('b', -1);
		expect(get(queue).jobs.map(({ id }) => id)).toEqual(['done', 'b', 'failed', 'a']);
		queue.retry('failed');
		expect(get(queue).jobs.find(({ id }) => id === 'failed')).toMatchObject({
			status: 'queued',
			progress: 0,
			error: undefined,
			phase: undefined,
			framesDone: undefined,
			totalFrames: undefined
		});
	});

	it('restores interrupted jobs as paused queued work and clears only finished jobs', () => {
		const queue = createRenderQueueStore();
		queue.hydrate([job('rendering', 'rendering'), job('done', 'completed'), job('queued')], true);
		expect(get(queue)).toMatchObject({ isPaused: true, activeJobId: null });
		expect(get(queue).jobs[0]).toMatchObject({ status: 'queued', progress: 0 });
		queue.clearFinished();
		expect(get(queue).jobs.map(({ id }) => id)).toEqual(['rendering', 'queued']);
	});

	it('keeps queued work running when the restored queue was not paused', () => {
		const queue = createRenderQueueStore();
		queue.hydrate([job('queued')], false);

		expect(get(queue)).toMatchObject({ isPaused: false, activeJobId: null });
		expect(queue.next()?.id).toBe('queued');
	});
});
