import type Rocket from '@lucide/svelte/icons/rocket';
import Fuse from 'fuse.js';
import { logoIconMetadata } from './logo-maker-core';
import lucideMetadata from './logo-icon-metadata.json';

type IconModule = { default: typeof Rocket };
const searchMetadataBySlug: Record<
	string,
	{ tags: string[]; categories: string[]; aliases: string[] }
> = lucideMetadata;
const modules = import.meta.glob<IconModule>(
	'../../../../../../node_modules/@lucide/svelte/dist/icons/*.svelte'
);

// Vite includes only loader functions here, not the icon artwork.
export const logoIcons = Object.entries(modules)
	.map(([path, load]) => {
		const slug = path.slice(path.lastIndexOf('/') + 1, -'.svelte'.length);
		const value = slug.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
		const metadata = Object.entries(logoIconMetadata).find(([key]) => key === value)?.[1];
		const searchMetadata = searchMetadataBySlug[slug];
		const label =
			metadata?.[0] ?? slug.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
		return {
			value,
			label,
			name: slug.replace(/-/g, ' '),
			aliases: searchMetadata.aliases.map((alias) => alias.replace(/-/g, ' ')),
			tags: [...searchMetadata.tags, metadata?.[1] ?? ''],
			categories: searchMetadata.categories,
			load
		};
	})
	.sort((left, right) => left.label.localeCompare(right.label));

export const LOGO_ICON_BATCH_SIZE = 40;

// Match Lucide's search priorities while keeping artwork behind dynamic loaders.
const iconSearch = new Fuse(logoIcons, {
	threshold: 0.2,
	ignoreLocation: true,
	keys: [
		{ name: 'name', weight: 3 },
		{ name: 'aliases', weight: 3 },
		{ name: 'tags', weight: 2 },
		{ name: 'categories', weight: 1 }
	]
});

export function searchLogoIcons(query: string) {
	const normalized = query.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
	if (!normalized) return logoIcons;
	return iconSearch.search(normalized).map(({ item }) => item);
}
