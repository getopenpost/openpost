import type { ThemeIconPackId, ThemeIconRole } from '../contracts.js';
import type { ThemeIconData, ThemeIconPack } from './types.js';

const packLoaders = {
	lucide: () => import('./packs/lucide.js'),
	'heroicons-outline': () => import('./packs/heroicons-outline.js'),
	'heroicons-solid': () => import('./packs/heroicons-solid.js'),
	phosphor: () => import('./packs/phosphor.js'),
	tabler: () => import('./packs/tabler.js')
} satisfies Record<ThemeIconPackId, () => Promise<{ default: ThemeIconPack }>>;

const packCache = new Map<ThemeIconPackId, Promise<ThemeIconPack>>();

export function loadThemeIconPack(id: ThemeIconPackId): Promise<ThemeIconPack> {
	const cached = packCache.get(id);
	if (cached) return cached;
	const loading = packLoaders[id]().then((module) => module.default);
	packCache.set(id, loading);
	return loading;
}

export async function loadThemeIcon(
	pack: ThemeIconPackId,
	role: ThemeIconRole
): Promise<ThemeIconData> {
	return (await loadThemeIconPack(pack)).icons[role];
}
