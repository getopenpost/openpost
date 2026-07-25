import { browser } from '$app/environment';
import type { ComposerRecoverySnapshot, StudioDocument } from './types';

const DB_NAME = 'openpost-studio';
const DB_VERSION = 1;
const STORE = 'documents';
const COMPOSER_PREFIX = 'openpost:studio:return:';

interface LocalStudioRecovery {
	design_id: string;
	workspace_id: string;
	revision: number;
	document: StudioDocument;
	updated_at: string;
	expires_at: string;
}

async function openRecoveryDB(): Promise<IDBDatabase> {
	return await new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'design_id' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Could not open Studio recovery.'));
	});
}

export async function storeLocalStudioRecovery(
	recovery: Omit<LocalStudioRecovery, 'updated_at' | 'expires_at'>
): Promise<void> {
	if (!browser) return;
	const db = await openRecoveryDB();
	const now = new Date();
	const record: LocalStudioRecovery = {
		...recovery,
		updated_at: now.toISOString(),
		expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
	};
	await new Promise<void>((resolve, reject) => {
		const transaction = db.transaction(STORE, 'readwrite');
		transaction.objectStore(STORE).put(record);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	db.close();
}

export async function loadLocalStudioRecovery(
	designID: string
): Promise<LocalStudioRecovery | null> {
	if (!browser) return null;
	const db = await openRecoveryDB();
	const record = await new Promise<LocalStudioRecovery | undefined>((resolve, reject) => {
		const request = db.transaction(STORE).objectStore(STORE).get(designID);
		request.onsuccess = () => resolve(request.result as LocalStudioRecovery | undefined);
		request.onerror = () => reject(request.error);
	});
	db.close();
	if (!record) return null;
	if (Date.parse(record.expires_at) < Date.now()) {
		await clearLocalStudioRecovery(designID);
		return null;
	}
	return record;
}

export async function clearLocalStudioRecovery(designID: string): Promise<void> {
	if (!browser) return;
	const db = await openRecoveryDB();
	await new Promise<void>((resolve, reject) => {
		const transaction = db.transaction(STORE, 'readwrite');
		transaction.objectStore(STORE).delete(designID);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	db.close();
}

export function storeComposerRecovery(token: string, snapshot: ComposerRecoverySnapshot): void {
	if (!browser) return;
	sessionStorage.setItem(`${COMPOSER_PREFIX}${token}`, JSON.stringify(snapshot));
}

export function loadComposerRecovery(token: string): ComposerRecoverySnapshot | null {
	if (!browser) return null;
	const raw = sessionStorage.getItem(`${COMPOSER_PREFIX}${token}`);
	if (!raw) return null;
	try {
		const snapshot = JSON.parse(raw) as ComposerRecoverySnapshot;
		if (Date.parse(snapshot.expires_at) < Date.now()) {
			clearComposerRecovery(token);
			return null;
		}
		return snapshot;
	} catch {
		clearComposerRecovery(token);
		return null;
	}
}

export function clearComposerRecovery(token: string): void {
	if (browser) sessionStorage.removeItem(`${COMPOSER_PREFIX}${token}`);
}
