import { deleteMedia } from '../workspace-fs/media';
import { getProjectsUsingMedia } from '../workspace-fs/project-media';
import { deleteProject } from '../workspace-fs/projects';
import { createLogger } from '../workspace-fs/logger';
import {
	getTrashedProjectMediaIds,
	isProjectTrashed,
	withProjectTrashLock
} from '../workspace-fs/trash';

const logger = createLogger('ProjectTrash');

export interface ProjectPurgeResult {
	projectId: string;
	deletedMediaIds: string[];
	retainedMediaIds: string[];
	failedMediaIds: string[];
}

export interface ProjectTrashRuntime {
	withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T>;
	isTrashed(projectId: string): Promise<boolean>;
	getMediaIds(projectId: string): Promise<string[]>;
	deleteProject(projectId: string): Promise<void>;
	getProjectsUsingMedia(mediaId: string): Promise<string[]>;
	deleteMedia(mediaId: string): Promise<void>;
}

export function createProjectTrashOperations(runtime: ProjectTrashRuntime) {
	async function permanentlyDeleteProject(projectId: string): Promise<ProjectPurgeResult> {
		return runtime.withProjectLock(projectId, async () => {
			if (!(await runtime.isTrashed(projectId))) {
				throw new Error(`Project is not in trash: ${projectId}`);
			}

			const mediaIds = [...new Set(await runtime.getMediaIds(projectId))];
			await runtime.deleteProject(projectId);

			const deletedMediaIds: string[] = [];
			const retainedMediaIds: string[] = [];
			const failedMediaIds: string[] = [];
			for (const mediaId of mediaIds) {
				try {
					const remainingProjects = await runtime.getProjectsUsingMedia(mediaId);
					if (remainingProjects.length > 0) {
						retainedMediaIds.push(mediaId);
						continue;
					}
					await runtime.deleteMedia(mediaId);
					deletedMediaIds.push(mediaId);
				} catch (error) {
					logger.warn(
						`Media cleanup failed after deleting project ${projectId}: ${mediaId}`,
						error
					);
					failedMediaIds.push(mediaId);
				}
			}

			return { projectId, deletedMediaIds, retainedMediaIds, failedMediaIds };
		});
	}

	return { permanentlyDeleteProject };
}

const productionRuntime: ProjectTrashRuntime = {
	withProjectLock: withProjectTrashLock,
	isTrashed: isProjectTrashed,
	getMediaIds: getTrashedProjectMediaIds,
	deleteProject,
	getProjectsUsingMedia,
	deleteMedia
};

export const { permanentlyDeleteProject } = createProjectTrashOperations(productionRuntime);
