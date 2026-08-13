import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listImageEditorDesigns } from '$lib/image-editor/api';
import { deleteCloudVideoProject, listCloudVideoProjects } from '$lib/video-editor/api';

const mocks = vi.hoisted(() => ({
	get: vi.fn(),
	delete: vi.fn()
}));

vi.mock('$lib/api/client', () => ({
	client: {
		GET: mocks.get,
		DELETE: mocks.delete
	}
}));

describe('editor catalog API pagination', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('forwards scoped image search, pagination, and cancellation', async () => {
		mocks.get.mockResolvedValue({
			data: { designs: [], total: 123, can_edit: true },
			error: null
		});
		const controller = new AbortController();

		await expect(
			listImageEditorDesigns('workspace-a', {
				search: 'launch',
				limit: 50,
				offset: 100,
				signal: controller.signal
			})
		).resolves.toMatchObject({ total: 123, can_edit: true });
		expect(mocks.get).toHaveBeenCalledWith('/image-editor/designs', {
			params: {
				query: {
					workspace_id: 'workspace-a',
					search: 'launch',
					limit: 50,
					offset: 100
				}
			},
			signal: controller.signal
		});
	});

	it('forwards scoped video search, pagination, and cancellation', async () => {
		mocks.get.mockResolvedValue({
			data: { projects: [], total: 75, can_edit: false },
			error: null
		});
		const controller = new AbortController();

		await expect(
			listCloudVideoProjects('workspace-b', {
				search: 'recap',
				limit: 50,
				offset: 50,
				signal: controller.signal
			})
		).resolves.toEqual({ projects: [], total: 75, canEdit: false });
		expect(mocks.get).toHaveBeenCalledWith('/video-editor/projects', {
			params: {
				query: {
					workspace_id: 'workspace-b',
					search: 'recap',
					limit: 50,
					offset: 50
				}
			},
			signal: controller.signal
		});
	});

	it('uses the existing authorized cloud-video delete endpoint and preserves server errors', async () => {
		mocks.delete.mockResolvedValueOnce({ error: null });
		await expect(deleteCloudVideoProject('video-a')).resolves.toBeUndefined();
		expect(mocks.delete).toHaveBeenCalledWith('/video-editor/projects/{id}', {
			params: { path: { id: 'video-a' } }
		});

		mocks.delete.mockResolvedValueOnce({
			error: { detail: 'workspace is read-only for this user' }
		});
		await expect(deleteCloudVideoProject('video-b')).rejects.toThrow(
			'workspace is read-only for this user'
		);
	});
});
