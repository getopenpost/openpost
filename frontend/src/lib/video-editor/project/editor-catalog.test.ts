import { describe, expect, it, vi } from 'vitest';
import type { Project } from './types';
import {
	filterLocalVideoProjects,
	loadLocalVideoProjectCatalog,
	releaseLocalVideoProjectThumbnails
} from './workspace-project-catalog';

function project(id: string, name: string, description: string, updatedAt: number): Project {
	return {
		id,
		name,
		description,
		createdAt: updatedAt - 1_000,
		updatedAt,
		duration: 12,
		metadata: { width: 1920, height: 1080, fps: 30 }
	};
}

describe('local Video project catalog', () => {
	it('searches project names and descriptions without changing the folder-backed source', () => {
		const projects = [
			project('older', 'Product tour', 'Launch walkthrough', 10),
			project('newer', 'Launch cut', 'Short update', 30),
			project('other', 'Customer story', 'Founder interview', 20)
		];

		expect(filterLocalVideoProjects(projects, ' launch ').map((item) => item.id)).toEqual([
			'newer',
			'older'
		]);
		expect(filterLocalVideoProjects(projects, 'founder').map((item) => item.id)).toEqual(['other']);
		expect(filterLocalVideoProjects(projects, '')).toHaveLength(3);
		expect(projects.map((item) => item.id)).toEqual(['older', 'newer', 'other']);
	});

	it('loads local thumbnails and releases every object URL owned by the catalog', async () => {
		const projects = [
			project('with-thumbnail', 'Launch cut', '', 20),
			project('without-thumbnail', 'Notes', '', 10)
		];
		const createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
		const revokeObjectURL = vi.fn();

		const catalog = await loadLocalVideoProjectCatalog({
			listProjects: async () => projects,
			readThumbnail: async (id) => (id === 'with-thumbnail' ? new Blob(['preview']) : null),
			createObjectURL,
			revokeObjectURL
		});

		expect(catalog.projects).toEqual(projects);
		expect(catalog.thumbnailUrls).toEqual({ 'with-thumbnail': 'blob:7' });
		releaseLocalVideoProjectThumbnails(catalog.thumbnailUrls, revokeObjectURL);
		expect(revokeObjectURL).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:7');
	});

	it('releases partial thumbnail URLs when the folder catalog cannot finish loading', async () => {
		const projects = [
			project('with-thumbnail', 'Launch cut', '', 20),
			project('broken-thumbnail', 'Broken preview', '', 10)
		];
		const revokeObjectURL = vi.fn();

		await expect(
			loadLocalVideoProjectCatalog({
				listProjects: async () => projects,
				readThumbnail: async (id) => {
					if (id === 'with-thumbnail') return new Blob(['preview']);
					await Promise.resolve();
					throw new Error('thumbnail read failed');
				},
				createObjectURL: () => 'blob:preview',
				revokeObjectURL
			})
		).rejects.toThrow('thumbnail read failed');
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
	});
});
