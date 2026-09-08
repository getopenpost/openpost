import { workshopTheme } from './builtins/workshop.js';
import type { ResolvedTheme, ThemeScheme } from './contracts.js';

// Startup and runtime recovery need only Workshop, not the appearance catalog.
export function resolveWorkshopTheme(requestedScheme: ThemeScheme): ResolvedTheme {
	return {
		id: workshopTheme.id,
		revision: workshopTheme.revision,
		name: workshopTheme.name,
		iconPack: workshopTheme.iconPack,
		source: 'builtin',
		requestedScheme,
		scheme: requestedScheme,
		manifest: structuredClone(workshopTheme.schemes[requestedScheme]!),
		fonts: [],
		assets: structuredClone(workshopTheme.assets)
	};
}
