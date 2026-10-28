import type { ThemeManifest } from '$lib/themes/contracts';

/** Detached draft data for theme component tests; duplication is owned by the API. */
export function duplicateThemeManifest(
	manifest: ThemeManifest,
	id: string,
	name: string
): ThemeManifest {
	return { ...structuredClone(manifest), id, name, revision: 'draft' };
}
