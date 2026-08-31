import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { RenderQueueJob, RenderQueueJobStatus } from '../export/render-queue-store';
import { renderQueueStore } from '../export/render-queue-store';
import RenderQueuePanel from './render-queue-panel.svelte';

function job(id: string, status: RenderQueueJobStatus): RenderQueueJob {
	return {
		id,
		projectId: 'project',
		name: id,
		status,
		progress: status === 'completed' ? 1 : 0,
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
		error: status === 'failed' ? 'Encoder unavailable' : undefined,
		finishedAt: status === 'queued' ? undefined : 2
	};
}

afterEach(() => renderQueueStore.hydrate([], true));

describe('RenderQueuePanel', () => {
	it('runs only valid state-specific job actions from the context menu', async () => {
		renderQueueStore.hydrate(
			[
				job('Queued first', 'queued'),
				job('Failed render', 'failed'),
				job('Queued second', 'queued'),
				job('Completed render', 'completed')
			],
			true
		);
		const screen = await render(RenderQueuePanel, { projectId: 'project' });
		await screen.getByRole('button', { name: 'Exports (2)' }).click();

		const openMenu = async (id: string) => {
			let row: HTMLElement | null = null;
			await vi.waitFor(() => {
				row = document.querySelector<HTMLElement>(`[data-render-queue-job="${id}"]`);
				expect(row).not.toBeNull();
			});
			row!.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: 80,
					clientY: 80
				})
			);
		};

		await openMenu('Queued second');
		await screen.getByRole('menuitem', { name: 'Move render up' }).click();
		expect(get(renderQueueStore).jobs.map((entry) => entry.id)).toEqual([
			'Queued second',
			'Failed render',
			'Queued first',
			'Completed render'
		]);

		await openMenu('Queued second');
		await expect.element(screen.getByRole('menuitem', { name: 'Move render up' })).toBeDisabled();
		await screen.getByRole('menuitem', { name: 'Cancel render' }).click();
		expect(get(renderQueueStore).jobs[0]?.status).toBe('cancelled');

		await openMenu('Failed render');
		expect(screen.getByRole('menuitem', { name: 'Cancel render' }).query()).toBeNull();
		await screen.getByRole('menuitem', { name: 'Retry render' }).click();
		expect(get(renderQueueStore).jobs.find((entry) => entry.id === 'Failed render')?.status).toBe(
			'queued'
		);

		await openMenu('Completed render');
		expect(screen.getByRole('menuitem', { name: 'Retry render' }).query()).toBeNull();
		await screen.getByRole('menuitem', { name: 'Remove render' }).click();
		expect(get(renderQueueStore).jobs.some((entry) => entry.id === 'Completed render')).toBe(false);
	});
});
