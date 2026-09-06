import { deleteMedia } from '../workspace-fs/media';
import { getProjectsUsingMedia, removeMediaFromProject } from '../workspace-fs/project-media';

export interface ProjectMediaDeleteRuntime {
	removeMediaFromProject(projectId: string, mediaId: string): Promise<void>;
	getProjectsUsingMedia(mediaId: string): Promise<string[]>;
	deleteMedia(mediaId: string): Promise<void>;
}

const defaultRuntime: ProjectMediaDeleteRuntime = {
	removeMediaFromProject,
	getProjectsUsingMedia,
	deleteMedia
};

export interface ProjectMediaDeleteResult {
	deletedWorkspaceBytes: boolean;
	remainingProjectIds: string[];
}

export async function deleteMediaFromProject(
	projectId: string,
	mediaId: string,
	runtime: ProjectMediaDeleteRuntime = defaultRuntime
): Promise<ProjectMediaDeleteResult> {
	await runtime.removeMediaFromProject(projectId, mediaId);
	const remainingProjectIds = await runtime.getProjectsUsingMedia(mediaId);
	if (remainingProjectIds.length > 0) {
		return { deletedWorkspaceBytes: false, remainingProjectIds };
	}
	await runtime.deleteMedia(mediaId);
	return { deletedWorkspaceBytes: true, remainingProjectIds: [] };
}
