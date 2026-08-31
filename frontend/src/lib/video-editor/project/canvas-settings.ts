import {
	MAX_PROJECT_HEIGHT,
	MAX_PROJECT_WIDTH,
	MIN_PROJECT_HEIGHT,
	MIN_PROJECT_WIDTH
} from './project-presets';
import type { ProjectResolution } from './types';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { execute } from '../timeline/commands/command-store.svelte';

export type ProjectCanvasPatch = Partial<
	Pick<ProjectResolution, 'width' | 'height' | 'backgroundColor'>
>;

function validDimension(value: number | undefined, minimum: number, maximum: number): boolean {
	return value === undefined || (Number.isInteger(value) && value >= minimum && value <= maximum);
}

export function isValidProjectCanvasPatch(patch: ProjectCanvasPatch): boolean {
	return (
		validDimension(patch.width, MIN_PROJECT_WIDTH, MAX_PROJECT_WIDTH) &&
		validDimension(patch.height, MIN_PROJECT_HEIGHT, MAX_PROJECT_HEIGHT) &&
		(patch.backgroundColor === undefined || /^#[0-9a-f]{6}$/i.test(patch.backgroundColor))
	);
}

export function updateProjectCanvas(patch: ProjectCanvasPatch): boolean {
	if (!isValidProjectCanvasPatch(patch)) return false;
	return execute('UPDATE_PROJECT_CANVAS', () => sequenceStore.updateRootResolution(patch));
}

export function swapProjectCanvasDimensions(): boolean {
	const { width, height } = sequenceStore.rootResolution;
	return updateProjectCanvas({ width: height, height: width });
}

export function resetProjectCanvasDimensions(): boolean {
	return updateProjectCanvas({ width: 1920, height: 1080 });
}
