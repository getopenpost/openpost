import type { LibraryEntry } from './types';
const DATABASE = 'openpost-video-library';
const STORE = 'entries';

async function database(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('scope', 'scope');
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onblocked = () => reject(new Error('Close other editor tabs and try again.'));
	});
}

async function transact<T>(
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await database();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(STORE, mode);
			const request = operation(tx.objectStore(STORE));
			tx.oncomplete = () => resolve(request.result);
			tx.onerror = () => reject(tx.error ?? request.error);
			tx.onabort = () => reject(tx.error ?? new Error('Library save was interrupted.'));
		});
	} finally {
		db.close();
	}
}

export function listLibraryEntries(scope: string): Promise<LibraryEntry[]> {
	return transact('readonly', (store) => store.index('scope').getAll(scope));
}
export async function putLibraryEntry(entry: LibraryEntry): Promise<void> {
	await transact('readwrite', (store) => store.put(entry));
}
export async function deleteLibraryEntry(id: string): Promise<void> {
	await transact('readwrite', (store) => store.delete(id));
}

export async function patchLibraryEntry(
	id: string,
	patch: Partial<Pick<LibraryEntry, 'favorite' | 'name' | 'collection' | 'position' | 'lastUsed'>>
): Promise<LibraryEntry | undefined> {
	const db = await database();
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite');
			const store = tx.objectStore(STORE);
			const request: IDBRequest<LibraryEntry | undefined> = store.get(id);
			let next: LibraryEntry | undefined;
			request.onsuccess = () => {
				if (!request.result) return;
				next = { ...request.result, ...patch };
				store.put(next);
			};
			tx.oncomplete = () => resolve(next);
			tx.onerror = () => reject(tx.error ?? request.error);
			tx.onabort = () => reject(tx.error ?? new Error('Library save was interrupted.'));
		});
	} finally {
		db.close();
	}
}
