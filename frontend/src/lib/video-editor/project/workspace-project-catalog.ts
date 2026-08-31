import type { Project } from './types';

const PROJECT_THUMBNAIL_READ_CONCURRENCY = 8;

export interface WorkspaceProjectLoaderDependencies {
	listProjects(): Promise<Project[]>;
	readThumbnail(id: string): Promise<Blob | null>;
	createObjectURL(blob: Blob): string;
	revokeObjectURL(url: string): void;
}

export interface WorkspaceProjectSnapshot {
	projects: Project[];
	thumbnailUrls: Record<string, string>;
}

export function filterLocalVideoProjects(projects: Project[], query: string): Project[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return projects
		.filter(
			(project) =>
				!normalizedQuery ||
				`${project.name} ${project.description}`.toLocaleLowerCase().includes(normalizedQuery)
		)
		.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function releaseLocalVideoProjectThumbnails(
	thumbnailUrls: Readonly<Record<string, string>>,
	revokeObjectURL: (url: string) => void = (url) => URL.revokeObjectURL(url)
): void {
	for (const url of Object.values(thumbnailUrls)) revokeObjectURL(url);
}

export async function loadLocalVideoProjectCatalog(
	dependencies: WorkspaceProjectLoaderDependencies
): Promise<WorkspaceProjectSnapshot> {
	const projects = await dependencies.listProjects();
	const thumbnailUrls: Record<string, string> = {};
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < projects.length) {
			const project = projects[nextIndex++];
			if (!project) continue;
			const thumbnail = await dependencies.readThumbnail(project.id);
			if (thumbnail) thumbnailUrls[project.id] = dependencies.createObjectURL(thumbnail);
		}
	}

	try {
		await Promise.all(
			Array.from({ length: Math.min(PROJECT_THUMBNAIL_READ_CONCURRENCY, projects.length) }, () =>
				worker()
			)
		);
		return { projects, thumbnailUrls };
	} catch (error) {
		releaseLocalVideoProjectThumbnails(thumbnailUrls, dependencies.revokeObjectURL);
		throw error;
	}
}
