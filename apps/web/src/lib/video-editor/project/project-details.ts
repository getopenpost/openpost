import type { Project } from './types';
import {
	MAX_PROJECT_HEIGHT,
	MAX_PROJECT_WIDTH,
	MIN_PROJECT_HEIGHT,
	MIN_PROJECT_WIDTH,
	PROJECT_FPS_OPTIONS,
	type ProjectCreationSettings
} from './project-presets';

export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 500;
export const PROJECT_DETAILS_FPS_OPTIONS = [...PROJECT_FPS_OPTIONS, 120, 240] as const;

export interface ProjectDetailsInput extends ProjectCreationSettings {
	name: string;
	description: string;
}

export type ProjectDetailsUpdate = Pick<Project, 'name' | 'description' | 'metadata' | 'duration'>;

export function isValidProjectDetails(input: ProjectDetailsInput): boolean {
	const name = input.name.trim();
	return (
		name.length > 0 &&
		name.length <= MAX_PROJECT_NAME_LENGTH &&
		input.description.length <= MAX_PROJECT_DESCRIPTION_LENGTH &&
		Number.isInteger(input.width) &&
		input.width >= MIN_PROJECT_WIDTH &&
		input.width <= MAX_PROJECT_WIDTH &&
		Number.isInteger(input.height) &&
		input.height >= MIN_PROJECT_HEIGHT &&
		input.height <= MAX_PROJECT_HEIGHT &&
		PROJECT_DETAILS_FPS_OPTIONS.some((fps) => fps === input.fps)
	);
}

export function buildProjectDetailsUpdate(
	project: Project,
	input: ProjectDetailsInput
): ProjectDetailsUpdate | null {
	if (!isValidProjectDetails(input)) return null;
	const durationInFrames = (project.timeline?.items ?? []).reduce(
		(maximum, item) => Math.max(maximum, item.from + item.durationInFrames),
		0
	);
	return {
		name: input.name.trim(),
		description: input.description.trim(),
		metadata: {
			...project.metadata,
			width: input.width,
			height: input.height,
			fps: input.fps
		},
		duration: durationInFrames / input.fps
	};
}

export function projectDetailsChanged(project: Project, update: ProjectDetailsUpdate): boolean {
	return (
		project.name !== update.name ||
		project.description !== update.description ||
		project.metadata.width !== update.metadata.width ||
		project.metadata.height !== update.metadata.height ||
		project.metadata.fps !== update.metadata.fps
	);
}
