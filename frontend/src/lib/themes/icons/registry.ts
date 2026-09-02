import type { ThemeIconPackId, ThemeIconRole } from '../contracts.js';
import lucidePack from './packs/lucide.generated.js';
import type { ThemeIconData, ThemeIconPack } from './types.js';

type ThemeIconPackLoader = () => Promise<{ default: ThemeIconPack }>;
type ThemeIconPackLoaders = Record<ThemeIconPackId, ThemeIconPackLoader>;

const packLoaders = {
	lucide: () => import('./packs/lucide.generated.js'),
	'heroicons-outline': () => import('./packs/heroicons-outline.generated.js'),
	'heroicons-solid': () => import('./packs/heroicons-solid.generated.js'),
	phosphor: () => import('./packs/phosphor.generated.js'),
	tabler: () => import('./packs/tabler.generated.js')
} satisfies ThemeIconPackLoaders;

export interface ThemeIconRegistry {
	loadPack(id: ThemeIconPackId): Promise<ThemeIconPack>;
	getIcon(pack: ThemeIconPackId, role: ThemeIconRole): ThemeIconData;
}

export function createThemeIconRegistry(
	loaders: ThemeIconPackLoaders,
	fallback: ThemeIconPack = lucidePack
): ThemeIconRegistry {
	const loaded = new Map<ThemeIconPackId, ThemeIconPack>([[fallback.id, fallback]]);
	const pending = new Map<ThemeIconPackId, Promise<ThemeIconPack>>();

	return {
		loadPack(id) {
			const ready = loaded.get(id);
			if (ready) return Promise.resolve(ready);
			const current = pending.get(id);
			if (current) return current;

			const request = (async () => {
				try {
					const module = await loaders[id]();
					loaded.set(id, module.default);
					return module.default;
				} finally {
					pending.delete(id);
				}
			})();
			pending.set(id, request);
			return request;
		},
		getIcon(pack, role) {
			return (loaded.get(pack) ?? fallback).icons[role];
		}
	};
}

const registry = createThemeIconRegistry(packLoaders);

export function loadThemeIconPack(id: ThemeIconPackId): Promise<ThemeIconPack> {
	return registry.loadPack(id);
}

export function getThemeIcon(pack: ThemeIconPackId, role: ThemeIconRole): ThemeIconData {
	return registry.getIcon(pack, role);
}

export async function loadThemeIcon(
	pack: ThemeIconPackId,
	role: ThemeIconRole
): Promise<ThemeIconData> {
	await loadThemeIconPack(pack);
	return getThemeIcon(pack, role);
}
