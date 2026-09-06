import type { ThemeManifest } from '$lib/themes';
import type { ThemeReference } from './theme-library-model';

export interface ThemeLibraryItem {
	manifest: ThemeManifest;
	reference: ThemeReference;
	source: 'builtin' | 'organization';
	state?: 'draft' | 'published';
	hasDraftChanges?: boolean;
	assignedWorkspaces?: number;
}

export interface CreateThemeInput {
	name: string;
	source: ThemeReference;
}
