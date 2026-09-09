export interface ProjectCreationSettings {
	width: number;
	height: number;
	fps: number;
}

export type ProjectPresetId =
	| 'youtube-1080p'
	| 'vertical-9-16'
	| 'instagram-square'
	| 'instagram-portrait'
	| 'x-landscape'
	| 'linkedin-landscape';

// Ported from FreeCut (MIT): ProjectTemplate platform/namePrefix metadata.
// `name` stays in Paraglide messages (see projectPresetName in
// preset-label.ts); `platform` is the uppercase eyebrow and
// `namePrefix` seeds collision-free default project names.
export interface ProjectPreset extends ProjectCreationSettings {
	id: ProjectPresetId;
	platform: string;
	namePrefix: string;
}

export const DEFAULT_PROJECT_CREATION_SETTINGS: ProjectCreationSettings = {
	width: 1920,
	height: 1080,
	fps: 30
};

export const PROJECT_PRESETS: readonly ProjectPreset[] = [
	{
		id: 'youtube-1080p',
		platform: 'YouTube',
		namePrefix: 'YouTube',
		...DEFAULT_PROJECT_CREATION_SETTINGS
	},
	{
		id: 'vertical-9-16',
		platform: 'Vertical',
		namePrefix: 'Vertical',
		width: 1080,
		height: 1920,
		fps: 30
	},
	{
		id: 'instagram-square',
		platform: 'Instagram',
		namePrefix: 'Instagram Square',
		width: 1080,
		height: 1080,
		fps: 30
	},
	{
		id: 'instagram-portrait',
		platform: 'Instagram',
		namePrefix: 'Instagram Portrait',
		width: 1080,
		height: 1350,
		fps: 30
	},
	{
		id: 'x-landscape',
		platform: 'Twitter/X',
		namePrefix: 'Twitter/X',
		width: 1200,
		height: 675,
		fps: 30
	},
	{
		id: 'linkedin-landscape',
		platform: 'LinkedIn',
		namePrefix: 'LinkedIn',
		width: 1200,
		height: 627,
		fps: 30
	}
] as const;

export const PROJECT_FPS_OPTIONS = [24, 25, 30, 50, 60] as const;
export const MIN_PROJECT_WIDTH = 320;
export const MAX_PROJECT_WIDTH = 7680;
export const MIN_PROJECT_HEIGHT = 240;
export const MAX_PROJECT_HEIGHT = 4320;

export function isValidProjectCreationSettings(
	settings: ProjectCreationSettings
): settings is ProjectCreationSettings {
	return (
		Number.isInteger(settings.width) &&
		settings.width >= MIN_PROJECT_WIDTH &&
		settings.width <= MAX_PROJECT_WIDTH &&
		Number.isInteger(settings.height) &&
		settings.height >= MIN_PROJECT_HEIGHT &&
		settings.height <= MAX_PROJECT_HEIGHT &&
		PROJECT_FPS_OPTIONS.some((fps) => fps === settings.fps)
	);
}

export function projectAspectRatio(width: number, height: number): string {
	function greatestCommonDivisor(left: number, right: number): number {
		return right === 0 ? left : greatestCommonDivisor(right, left % right);
	}
	const divisor = greatestCommonDivisor(width, height);
	return `${width / divisor}:${height / divisor}`;
}
