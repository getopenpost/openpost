import { describe, expect, it } from 'vitest';
import { createProjectTrashOperations, type ProjectTrashRuntime } from './project-trash';

function runtime(
	options: {
		active?: boolean;
		failMediaId?: string;
		failProjectDelete?: boolean;
	} = {}
) {
	const deletedProjects: string[] = [];
	const deletedMedia: string[] = [];
	const events: string[] = [];
	const value: ProjectTrashRuntime = {
		withProjectLock: async (id, operation) => {
			events.push(`lock:${id}`);
			return operation();
		},
		isTrashed: async () => !options.active,
		getMediaIds: async () => ['only-here', 'shared', 'only-here', 'failed'],
		deleteProject: async (id) => {
			if (options.failProjectDelete) throw new Error('project delete failed');
			events.push(`project:${id}`);
			deletedProjects.push(id);
		},
		getProjectsUsingMedia: async (id) => {
			events.push(`references:${id}`);
			if (id === options.failMediaId) throw new Error('reference scan failed');
			return id === 'shared' ? ['another-project'] : [];
		},
		deleteMedia: async (id) => {
			events.push(`media:${id}`);
			deletedMedia.push(id);
		}
	};
	return {
		deletedMedia,
		deletedProjects,
		events,
		operations: createProjectTrashOperations(value)
	};
}

describe('project trash operations', () => {
	it('deletes a trashed project before reclaiming only unshared media', async () => {
		const testRuntime = runtime({ failMediaId: 'failed' });
		const result = await testRuntime.operations.permanentlyDeleteProject('project-one');

		expect(testRuntime.deletedProjects).toEqual(['project-one']);
		expect(testRuntime.deletedMedia).toEqual(['only-here']);
		expect(testRuntime.events.slice(0, 2)).toEqual(['lock:project-one', 'project:project-one']);
		expect(result).toEqual({
			projectId: 'project-one',
			deletedMediaIds: ['only-here'],
			retainedMediaIds: ['shared'],
			failedMediaIds: ['failed']
		});
	});

	it('refuses to purge an active project', async () => {
		const testRuntime = runtime({ active: true });

		await expect(testRuntime.operations.permanentlyDeleteProject('project-one')).rejects.toThrow(
			'Project is not in trash'
		);
		expect(testRuntime.deletedProjects).toEqual([]);
	});

	it('does not touch media when the project directory cannot be deleted', async () => {
		const testRuntime = runtime({ failProjectDelete: true });

		await expect(testRuntime.operations.permanentlyDeleteProject('project-one')).rejects.toThrow(
			'project delete failed'
		);
		expect(testRuntime.deletedMedia).toEqual([]);
		expect(testRuntime.events).toEqual(['lock:project-one']);
	});
});
