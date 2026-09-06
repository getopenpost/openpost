import { readBlob, writeBlob } from '../workspace-fs/fs-primitives';
import { associateMediaWithProject, getProjectMediaIds } from '../workspace-fs/project-media';
import { projectThumbnailPath } from '../workspace-fs/paths';
import { createProject, deleteProject, getProject, updateProject } from '../workspace-fs/projects';
import { requireWorkspaceRoot } from '../workspace-fs/root';
import { cloneProjectDocument } from './project-clone';
import type { Project } from './types';

export interface ProjectOperationsRuntime {
	getProject(id: string): Promise<Project | undefined>;
	createProject(project: Project): Promise<Project>;
	deleteProject(id: string): Promise<void>;
	updateProject(id: string, updates: Partial<Project>): Promise<Project>;
	getMediaIds(projectId: string): Promise<string[]>;
	associateMedia(projectId: string, mediaId: string): Promise<void>;
	readThumbnail(projectId: string): Promise<Blob | null>;
	writeThumbnail(projectId: string, thumbnail: Blob): Promise<void>;
}

export function createProjectOperations(runtime: ProjectOperationsRuntime) {
	async function duplicateProjectWithMedia(projectId: string, name?: string): Promise<Project> {
		const source = await runtime.getProject(projectId);
		if (!source) throw new Error(`Project not found: ${projectId}`);
		const duplicate = cloneProjectDocument(source, { name: name?.trim() || undefined });
		let created = false;
		try {
			await runtime.createProject(duplicate);
			created = true;
			for (const mediaId of await runtime.getMediaIds(source.id)) {
				await runtime.associateMedia(duplicate.id, mediaId);
			}

			const thumbnail = await runtime.readThumbnail(source.id);
			if (thumbnail) {
				await runtime.writeThumbnail(duplicate.id, thumbnail);
				const thumbnailId = `project:${duplicate.id}:cover`;
				await runtime.updateProject(duplicate.id, { thumbnailId });
				duplicate.thumbnailId = thumbnailId;
			}

			return duplicate;
		} catch (error) {
			if (created) await runtime.deleteProject(duplicate.id).catch(() => undefined);
			throw error;
		}
	}

	return { duplicateProjectWithMedia };
}

const productionRuntime: ProjectOperationsRuntime = {
	getProject,
	createProject,
	deleteProject,
	updateProject,
	getMediaIds: getProjectMediaIds,
	associateMedia: associateMediaWithProject,
	readThumbnail: (projectId) => readBlob(requireWorkspaceRoot(), projectThumbnailPath(projectId)),
	writeThumbnail: (projectId, thumbnail) =>
		writeBlob(requireWorkspaceRoot(), projectThumbnailPath(projectId), thumbnail)
};

export const { duplicateProjectWithMedia } = createProjectOperations(productionRuntime);
