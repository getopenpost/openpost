import { THEME_ICON_ROLES, type ThemeIconPackId, type ThemeIconRole } from '../contracts.js';
import lucidePack from './packs/lucide.generated.js';
import type { ThemeIconData, ThemeIconPack } from './types.js';

type ThemeIconPackLoader = () => Promise<{ default: ThemeIconPack }>;
type ThemeIconPackLoaders = Record<ThemeIconPackId, ThemeIconPackLoader>;

const THEME_ICON_VIEW_BOX = /^\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/;
const MAX_THEME_ICON_BODY_LENGTH = 16_384;

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
	assertCompletePack(fallback.id, fallback);
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
					assertCompletePack(id, module.default);
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

function assertCompletePack(expectedId: ThemeIconPackId, pack: ThemeIconPack): void {
	if (!pack || pack.id !== expectedId) {
		throw new Error(`${expectedId} returned the wrong theme icon pack`);
	}
	for (const role of THEME_ICON_ROLES) {
		const icon = pack.icons?.[role];
		if (!icon || !safeGeneratedIconBody(icon.body) || !THEME_ICON_VIEW_BOX.test(icon.viewBox)) {
			throw new Error(`${expectedId} has an invalid ${role} theme icon`);
		}
	}
}

function safeGeneratedIconBody(body: string): boolean {
	return (
		body.length > 0 &&
		body.length <= MAX_THEME_ICON_BODY_LENGTH &&
		body.includes('<') &&
		!/<\/?(?:script|svg|foreignObject)\b/i.test(body) &&
		!/\b(?:href|on\w+)\s*=/i.test(body) &&
		!/url\s*\(/i.test(body)
	);
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
