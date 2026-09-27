import { expect, it } from 'vitest';
import {
	deleteLibraryEntry,
	listLibraryEntries,
	putLibraryEntry,
	patchLibraryEntry
} from './repository';
import type { LibraryEntry } from './types';

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
