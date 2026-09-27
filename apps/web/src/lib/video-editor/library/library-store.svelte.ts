import {
	deleteLibraryEntry,
	listLibraryEntries,
	putLibraryEntry,
	patchLibraryEntry
} from './repository';
import type { LibraryEntry, LibraryRecipe } from './types';
let entries = $state<LibraryEntry[]>([]);
let scope = $state('');
let revision = 0;
export const videoLibrary = {
	get entries() {
		return entries;
	},
	get scope() {
		return scope;
	},
	async load(nextScope: string): Promise<void> {
		const generation = ++revision;
		scope = nextScope;
		entries = [];
		const loaded = await listLibraryEntries(nextScope);
		if (generation === revision) entries = loaded.toSorted((a, b) => a.position - b.position);
	},
	async save(
		name: string,
		recipe: LibraryRecipe,
		collection = '',
		favorite = true,
		id: string = crypto.randomUUID()
	): Promise<void> {
		const entry: LibraryEntry = {
			id,
			scope,
			name: name.trim(),
			recipe,
			collection: collection.trim(),
			favorite,
			position: Date.now()
		};
		await putLibraryEntry(entry);
		if (entry.scope === scope) entries = [...entries.filter((value) => value.id !== id), entry];
	},
	async update(
		entry: LibraryEntry,
		patch: Partial<Pick<LibraryEntry, 'favorite' | 'name' | 'collection' | 'position' | 'lastUsed'>>
	): Promise<void> {
		const current = entries.find((value) => value.id === entry.id);
		if (!current) return;
		const next = await patchLibraryEntry(current.id, patch);
		if (next?.scope === scope)
			entries = entries
				.map((value) => (value.id === next.id ? next : value))
				.toSorted((a, b) => a.position - b.position);
	},
	async restore(entry: LibraryEntry): Promise<void> {
		await putLibraryEntry(entry);
		if (entry.scope === scope)
			entries = [...entries.filter((value) => value.id !== entry.id), entry].toSorted(
				(a, b) => a.position - b.position
			);
	},
	async remove(entry: LibraryEntry): Promise<void> {
		await deleteLibraryEntry(entry.id);
		entries = entries.filter((value) => value.id !== entry.id);
	}
};
