import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { RenderQueueJob } from '../export/render-queue-store';
import { renderQueueStore } from '../export/render-queue-store';
import RenderQueueController from './render-queue-controller.svelte';

function job(): RenderQueueJob {
	return {
		id: 'render-1',
		projectId: 'project-1',
		name: 'Launch video',
		status: 'queued',
		progress: 0,
		settings: {
			format: 'mp4',
			codec: 'avc',
			quality: 'high',
			width: 1920,
			height: 1080,
			subtitleMode: 'burn',
			range: { startFrame: 0, endFrame: 300 }
		},
		snapshot: {
			projectId: 'project-1',
			projectName: 'Launch',
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

afterEach(() => renderQueueStore.hydrate([], true));

describe('RenderQueueController', () => {
	it('persists live frame progress with the project queue', async () => {
		const loadQueue = vi.fn(async () => ({ jobs: [], isPaused: true }));
		const saveQueue = vi.fn(async () => undefined);
		const view = render(RenderQueueController, {
			projectId: 'project-1',
			loadQueue,
			saveQueue
		});

		await vi.waitFor(() => expect(loadQueue).toHaveBeenCalledWith('project-1'));
		renderQueueStore.enqueue([job()]);
		await vi.waitFor(() => expect(saveQueue).toHaveBeenCalled());
		saveQueue.mockClear();

		renderQueueStore.updateProgress('render-1', {
			phase: 'rendering',
			progress: 0.5,
			framesDone: 150,
			totalFrames: 300
		});

		await vi.waitFor(() => {
			expect(saveQueue).toHaveBeenCalledWith(
				'project-1',
				expect.arrayContaining([
					expect.objectContaining({
						id: 'render-1',
						progress: 0.5,
						framesDone: 150,
						totalFrames: 300
					})
				]),
				true
			);
		});
		expect(get(renderQueueStore).jobs[0]?.phase).toBe('rendering');
		view.unmount();
	});
});
