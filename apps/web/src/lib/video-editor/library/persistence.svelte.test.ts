import { expect, it } from 'vitest';
import {
	deleteLibraryEntry,
	listLibraryEntries,
	putLibraryEntry,
	patchLibraryEntry
} from './repository';
import type { LibraryEntry } from './types';
import { videoLibrary } from './library-store.svelte';

it('keeps saved library items across reads and isolates workspace collections', async () => {
	const id = crypto.randomUUID();
	const entry: LibraryEntry = {
		id,
		scope: `test:${id}`,
		name: 'My timer',
		collection: 'Tutorials',
		position: 1,
		favorite: true,
		recipe: {
			kind: 'timer',
			timer: {
				style: 'ring',
				format: 'clock',
				direction: 'down',
				warningSound: true
			}
		}
	};
	try {
		await putLibraryEntry(entry);
		entry.name = 'Unsaved change';
		const restored = await listLibraryEntries(entry.scope);
		expect(restored[0]).toMatchObject({
			name: 'My timer',
			collection: 'Tutorials',
			favorite: true,
			recipe: { timer: { warningSound: true } }
		});
		expect(await listLibraryEntries(`other:${id}`)).toEqual([]);
		await Promise.all([
			patchLibraryEntry(id, { name: 'Renamed' }),
			patchLibraryEntry(id, { favorite: false })
		]);
		expect((await listLibraryEntries(entry.scope))[0]).toMatchObject({
			name: 'Renamed',
			favorite: false
		});
		await deleteLibraryEntry(id);
		expect(await listLibraryEntries(entry.scope)).toEqual([]);
	} finally {
		await deleteLibraryEntry(id);
	}
});

it('does not transfer a favorite when a deleted recipe is restored after an account change', async () => {
	const priorScope = videoLibrary.scope;
	const scope = `favorite-undo:${crypto.randomUUID()}`;
	await videoLibrary.load(scope, '', 'first-user');
	await videoLibrary.save('My fade', { kind: 'transition', presentation: 'fade' });
	const deleted = $state.snapshot(videoLibrary.entries[0]);
	try {
		await videoLibrary.remove(deleted);
		await videoLibrary.load(scope, '', 'second-user');
		await videoLibrary.restore(deleted);
		expect(videoLibrary.entries).toHaveLength(1);
		expect(videoLibrary.entries[0].favorite).toBe(false);
		await videoLibrary.load(scope, '', 'second-user');
		expect(videoLibrary.entries[0].favorite).toBe(false);
	} finally {
		await deleteLibraryEntry(deleted.id);
		await videoLibrary.load(priorScope);
	}
});
