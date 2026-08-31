import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { RenderQueueRunner } from './render-queue-runner';
import { createRenderQueueStore, type RenderQueueJob } from './render-queue-store';

async function waitUntil(assertion: () => void): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			assertion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
	throw lastError;
}

function job(id: string): RenderQueueJob {
	return {
		id,
		projectId: 'project',
		name: id,
		status: 'queued',
		progress: 0,
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
		createdAt: 1
	};
}

describe('RenderQueueRunner', () => {
	it('drains serially, reports progress, and cancels the active job before continuing', async () => {
		const queue = createRenderQueueStore();
		const calls: string[] = [];
		const execute = vi.fn(async (next: RenderQueueJob, options) => {
			calls.push(next.id);
			options.onProgress({ phase: 'rendering', framesDone: 1, totalFrames: 2, progress: 0.5 });
			if (next.id === 'a') {
				await new Promise<void>((_resolve, reject) => {
					options.signal.addEventListener('abort', () =>
						reject(new DOMException('cancelled', 'AbortError'))
					);
				});
			}
			return {
				kind: 'artifact' as const,
				savedPath: `exports/${next.id}.mp4`,
				outputLabel: `${next.id}.mp4`,
				fileSize: 2
			};
		});
		const runner = new RenderQueueRunner(queue, execute);
		runner.start();
		queue.enqueue([job('a'), job('b')]);
		await waitUntil(() => expect(get(queue).activeJobId).toBe('a'));
		expect(get(queue).jobs[0]?.progress).toBe(0.5);
		runner.cancel('a');

		await waitUntil(() => expect(get(queue).jobs[1]?.status).toBe('completed'));
		expect(calls).toEqual(['a', 'b']);
		expect(get(queue).jobs[0]?.status).toBe('cancelled');
		runner.stop();
	});

	it('cancels the active render and removes every job when the queue is cleared', async () => {
		const queue = createRenderQueueStore();
		const execute = vi.fn(
			async (_next: RenderQueueJob, options: { signal: AbortSignal }): Promise<never> =>
				new Promise((_resolve, reject) => {
					options.signal.addEventListener('abort', () =>
						reject(new DOMException('cancelled', 'AbortError'))
					);
				})
		);
		const runner = new RenderQueueRunner(queue, execute);
		runner.start();
		queue.enqueue([job('a'), job('b')]);
		await waitUntil(() => expect(get(queue).activeJobId).toBe('a'));

		runner.clearAll();

		await waitUntil(() => expect(get(queue)).toMatchObject({ jobs: [], activeJobId: null }));
		expect(execute).toHaveBeenCalledOnce();
		runner.stop();
	});
});
