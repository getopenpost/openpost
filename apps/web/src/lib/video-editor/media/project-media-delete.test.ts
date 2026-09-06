import { describe, expect, it, vi } from 'vitest';
import { deleteMediaFromProject, type ProjectMediaDeleteRuntime } from './project-media-delete';

function runtime(remainingProjectIds: string[]): ProjectMediaDeleteRuntime {
	return {
		removeMediaFromProject: vi.fn(async () => undefined),
		getProjectsUsingMedia: vi.fn(async () => remainingProjectIds),
		deleteMedia: vi.fn(async () => undefined)
	};
}

describe('deleteMediaFromProject', () => {
	it('keeps workspace bytes while another project or trash entry references the media', async () => {
		const dependencies = runtime(['other-project']);
		await expect(deleteMediaFromProject('current', 'camera', dependencies)).resolves.toEqual({
			deletedWorkspaceBytes: false,
			remainingProjectIds: ['other-project']
		});
		expect(dependencies.removeMediaFromProject).toHaveBeenCalledExactlyOnceWith(
			'current',
			'camera'
		);
		expect(dependencies.deleteMedia).not.toHaveBeenCalled();
	});

	it('deletes workspace bytes only after the last project association is gone', async () => {
		const dependencies = runtime([]);
		await expect(deleteMediaFromProject('current', 'camera', dependencies)).resolves.toEqual({
			deletedWorkspaceBytes: true,
			remainingProjectIds: []
		});
		expect(dependencies.deleteMedia).toHaveBeenCalledExactlyOnceWith('camera');
	});
});
