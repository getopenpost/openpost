import { describe, expect, it } from 'vitest';
import { createBlankProject } from './defaults';
import { createProjectOperations, type ProjectOperationsRuntime } from './project-operations';
import type { Project } from './types';

function runtime(
	options: {
		failAssociation?: boolean;
		failThumbnailUpdate?: boolean;
		thumbnail?: Blob | null;
	} = {}
) {
	const source = createBlankProject('Source');
	source.thumbnailId = 'source-cover';
	const created: Project[] = [];
	const deleted: string[] = [];
	const associations: Array<{ projectId: string; mediaId: string }> = [];
	const thumbnails: Array<{ projectId: string; thumbnail: Blob }> = [];
	const updates: Array<{ projectId: string; updates: Partial<Project> }> = [];
	const projectRuntime: ProjectOperationsRuntime = {
		getProject: async (id) => (id === source.id ? source : undefined),
		createProject: async (project) => {
			created.push(project);
			return project;
		},
		deleteProject: async (id) => {
			deleted.push(id);
		},
		updateProject: async (projectId, projectUpdates) => {
			if (options.failThumbnailUpdate) throw new Error('thumbnail update failed');
			updates.push({ projectId, updates: projectUpdates });
			return { ...created[0]!, ...projectUpdates };
		},
		getMediaIds: async () => ['media-one', 'media-two'],
		associateMedia: async (projectId, mediaId) => {
			if (options.failAssociation) throw new Error('association failed');
			associations.push({ projectId, mediaId });
		},
		readThumbnail: async () => options.thumbnail ?? null,
		writeThumbnail: async (projectId, thumbnail) => {
			thumbnails.push({ projectId, thumbnail });
		}
	};
	return {
		associations,
		created,
		deleted,
		operations: createProjectOperations(projectRuntime),
		source,
		thumbnails,
		updates
	};
}

describe('project operations', () => {
	it('duplicates a project with media associations and its project thumbnail', async () => {
		const thumbnail = new Blob(['cover'], { type: 'image/jpeg' });
		const testRuntime = runtime({ thumbnail });

		const duplicate = await testRuntime.operations.duplicateProjectWithMedia(
			testRuntime.source.id,
			'Campaign copy'
		);

		expect(duplicate.id).not.toBe(testRuntime.source.id);
		expect(duplicate.name).toBe('Campaign copy');
		expect(testRuntime.associations).toEqual([
			{ projectId: duplicate.id, mediaId: 'media-one' },
			{ projectId: duplicate.id, mediaId: 'media-two' }
		]);
		expect(testRuntime.thumbnails).toEqual([{ projectId: duplicate.id, thumbnail }]);
		expect(testRuntime.updates).toEqual([
			{
				projectId: duplicate.id,
				updates: { thumbnailId: `project:${duplicate.id}:cover` }
			}
		]);
	});

	it('removes a partial duplicate when media association fails', async () => {
		const testRuntime = runtime({ failAssociation: true });

		await expect(
			testRuntime.operations.duplicateProjectWithMedia(testRuntime.source.id)
		).rejects.toThrow('association failed');
		expect(testRuntime.created).toHaveLength(1);
		expect(testRuntime.deleted).toEqual([testRuntime.created[0]?.id]);
	});

	it('removes a partial duplicate when its copied thumbnail cannot be recorded', async () => {
		const testRuntime = runtime({
			failThumbnailUpdate: true,
			thumbnail: new Blob(['cover'], { type: 'image/jpeg' })
		});

		await expect(
			testRuntime.operations.duplicateProjectWithMedia(testRuntime.source.id)
		).rejects.toThrow('thumbnail update failed');
		expect(testRuntime.thumbnails).toHaveLength(1);
		expect(testRuntime.deleted).toEqual([testRuntime.created[0]?.id]);
	});
});
