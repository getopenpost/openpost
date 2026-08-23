import { describe, expect, it, vi } from 'vitest';
import { abortableWait, watchPostBuilderRun } from './client';
import type { PostBuilderClient, PostBuilderRun } from './types';

function run(phase: PostBuilderRun['phase']): PostBuilderRun {
	return { id: 'run-1', phase };
}

function clientWithLoad(load: PostBuilderClient['load']): PostBuilderClient {
	return {
		create: vi.fn(),
		load,
		cancel: vi.fn(),
		retry: vi.fn(),
		commit: vi.fn()
	};
}

describe('watchPostBuilderRun', () => {
	it('reports durable phases in order and stops after the ready phase', async () => {
		const load = vi
			.fn<PostBuilderClient['load']>()
			.mockResolvedValueOnce(run('planning'))
			.mockResolvedValueOnce(run('ready'));
		const phases: PostBuilderRun['phase'][] = [];

		const result = await watchPostBuilderRun(clientWithLoad(load), 'run-1', {
			initialRun: run('queued'),
			intervalMs: 0,
			wait: async () => {},
			onUpdate: (next) => phases.push(next.phase)
		});

		expect(phases).toEqual(['queued', 'planning', 'ready']);
		expect(load).toHaveBeenCalledTimes(2);
		expect(result.phase).toBe('ready');
	});

	it('does not request an already terminal run again', async () => {
		const load = vi.fn<PostBuilderClient['load']>();

		const result = await watchPostBuilderRun(clientWithLoad(load), 'run-1', {
			initialRun: run('failed')
		});

		expect(result.phase).toBe('failed');
		expect(load).not.toHaveBeenCalled();
	});
});

describe('abortableWait', () => {
	it('rejects with the abort error contract when cancelled', async () => {
		const controller = new AbortController();
		const waiting = abortableWait(10_000, controller.signal);
		controller.abort();

		await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
	});
});
