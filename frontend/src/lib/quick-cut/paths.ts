export const QUICK_CUT_DIR = 'quick-cut';
export const QUICK_CUT_PROJECTS_DIR = 'quick-cut/projects';

export function quickCutProjectPath(id: string): string[] {
	return [QUICK_CUT_DIR, 'projects', `${sanitize(id)}.json`];
}

export function quickCutProjectDir(id: string): string[] {
	return [QUICK_CUT_DIR, 'projects', sanitize(id)];
}

function sanitize(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) || 'project';
}

export function quickCutIndexPath(): string[] {
	return [QUICK_CUT_DIR, 'index.json'];
}
