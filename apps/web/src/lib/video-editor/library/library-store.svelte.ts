import { videoLibraryCatalog } from './catalog';
import {
	queryEditorPreferences,
	syncEditorFavorite,
	recordEditorChoice
} from '$lib/editor-agent/preferences';
import { editorSession } from '../editor.svelte';
import { toast } from 'svelte-sonner';
import { m } from '$lib/paraglide/messages';
import {
	deleteLibraryEntry,
	listLibraryEntries,
	putLibraryEntry,
	patchLibraryEntry
} from './repository';
import type { LibraryEntry, LibraryRecipe, LibraryTextSlot } from './types';
let entries = $state<LibraryEntry[]>([]);
let scope = $state('');
let workspaceId = '';
let userId = '';
function syncFavorite(entry: LibraryEntry, targetWorkspaceId = workspaceId): void {
	if (!targetWorkspaceId) return;
	void syncEditorFavorite(targetWorkspaceId, entry.id, entry.name, 'video', {
		favorite: entry.favorite,
		deviceLocal: entry.recipe.kind === 'selection' || entry.recipe.kind === 'text-style'
	}).catch(() => toast.error(m.editor_agent_sync_failed()));
}
let revision = 0;
export const videoLibrary = {
	get entries() {
		return entries;
	},
	get scope() {
		return scope;
	},
	async load(nextScope: string, nextWorkspaceId = '', nextUserId = ''): Promise<void> {
		const generation = ++revision;
		scope = nextScope;
		workspaceId = nextWorkspaceId;
		userId = nextUserId;
		entries = [];
		const loaded = await listLibraryEntries(nextScope);
		if (generation === revision)
			entries = loaded
				.map((entry) => ({
					...entry,
					favorite: nextUserId
						? entry.favoriteOwnerID === nextUserId && entry.favorite
						: !entry.favoriteOwnerID && entry.favorite
				}))
				.toSorted((a, b) => a.position - b.position);
		if (!nextWorkspaceId) return;
		try {
			const remote = await queryEditorPreferences(nextWorkspaceId, '', 'video', '*');
			if (generation !== revision) return;
			const catalog = videoLibraryCatalog(nextScope);
			for (const favorite of remote.favorites ?? []) {
				const current =
					entries.find((entry) => entry.id === favorite.entry_id) ??
					catalog.find((entry) => entry.id === favorite.entry_id);
				if (!current) continue;
				const next = { ...current, favorite: favorite.favorite, favoriteOwnerID: nextUserId };
				await putLibraryEntry(next);
				if (generation !== revision) return;
				entries = [...entries.filter((entry) => entry.id !== next.id), next];
			}
		} catch {
			/* Offline projects keep their existing device-local choices. */
		}
	},
	async save(
		name: string,
		recipe: LibraryRecipe,
		collection = '',
		favorite = true,
		id: string = crypto.randomUUID(),
		slots?: LibraryTextSlot[]
	): Promise<void> {
		revision++;
		const targetWorkspaceId = workspaceId;
		const targetUserId = userId;
		const entry: LibraryEntry = {
			id,
			slots,
			scope,
			name: name.trim(),
			recipe,
			collection: collection.trim(),
			favorite,
			favoriteOwnerID: targetUserId,
			position: Date.now()
		};
		await putLibraryEntry(entry);
		if (entry.scope === scope && targetWorkspaceId === workspaceId && targetUserId === userId) {
			entries = [...entries.filter((value) => value.id !== id), entry];
			syncFavorite(entry, targetWorkspaceId);
		}
	},
	recordChoice(entryId: string, entryName: string): void {
		if (workspaceId && editorSession.project?.id)
			void recordEditorChoice(
				workspaceId,
				editorSession.project.id,
				entryId,
				entryName,
				'video'
			).catch(() => {});
	},
	async update(
		entry: LibraryEntry,
		patch: Partial<Pick<LibraryEntry, 'favorite' | 'name' | 'collection' | 'position' | 'lastUsed'>>
	): Promise<void> {
		revision++;
		const targetWorkspaceId = workspaceId;
		const targetUserId = userId;
		const current = entries.find((value) => value.id === entry.id);
		if (!current) return;
		const next = await patchLibraryEntry(current.id, {
			...patch,
			favorite: patch.favorite ?? current.favorite,
			favoriteOwnerID: targetUserId
		});
		if (next?.scope === scope && targetWorkspaceId === workspaceId && targetUserId === userId) {
			entries = entries
				.map((value) => (value.id === next.id ? next : value))
				.toSorted((a, b) => a.position - b.position);
			if (patch.favorite !== undefined || patch.name !== undefined) syncFavorite(next);
		}
	},
	async restore(entry: LibraryEntry): Promise<void> {
		revision++;
		const targetWorkspaceId = workspaceId;
		const targetUserId = userId;
		const restored = {
			...entry,
			favorite: (entry.favoriteOwnerID ?? '') === targetUserId && entry.favorite,
			favoriteOwnerID: targetUserId
		};
		await putLibraryEntry(restored);
		if (entry.scope === scope && targetWorkspaceId === workspaceId && targetUserId === userId) {
			entries = [...entries.filter((value) => value.id !== entry.id), restored].toSorted(
				(a, b) => a.position - b.position
			);
			syncFavorite(restored, targetWorkspaceId);
		}
	},
	async remove(entry: LibraryEntry): Promise<void> {
		revision++;
		const targetWorkspaceId = workspaceId;
		const targetUserId = userId;
		await deleteLibraryEntry(entry.id);
		if (targetUserId === userId) syncFavorite({ ...entry, favorite: false }, targetWorkspaceId);
		if (targetWorkspaceId !== workspaceId || targetUserId !== userId || entry.scope !== scope)
			return;
		entries = entries.filter((value) => value.id !== entry.id);
	}
};
