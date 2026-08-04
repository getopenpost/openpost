import { browser } from '$app/environment';
import type { ComposerRecoverySnapshot, ImageEditorDocument } from './types';
import { openImageEditorDatabase, IMAGE_EDITOR_RECOVERY_STORE } from './local-persistence';

const COMPOSER_PREFIX = 'openpost:image-editor:return:';
const LEGACY_COMPOSER_PREFIX = 'openpost:studio:return:';

interface LocalImageEditorRecovery {
	design_id: string;
	workspace_id: string;
	revision: number;
	document: ImageEditorDocument;
	updated_at: string;
	expires_at: string;
}

export async function storeLocalImageEditorRecovery(
	recovery: Omit<LocalImageEditorRecovery, 'updated_at' | 'expires_at'>
): Promise<void> {
	if (!browser) return;
	const db = await openImageEditorDatabase();
	const now = new Date();
	const record: LocalImageEditorRecovery = {
		...recovery,
		updated_at: now.toISOString(),
		expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
	};
	await new Promise<void>((resolve, reject) => {
		const transaction = db.transaction(IMAGE_EDITOR_RECOVERY_STORE, 'readwrite');
		transaction.objectStore(IMAGE_EDITOR_RECOVERY_STORE).put(record);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	db.close();
}

export async function loadLocalImageEditorRecovery(
	designID: string
): Promise<LocalImageEditorRecovery | null> {
	if (!browser) return null;
	const db = await openImageEditorDatabase();
	const record = await new Promise<LocalImageEditorRecovery | undefined>((resolve, reject) => {
		const request = db
			.transaction(IMAGE_EDITOR_RECOVERY_STORE)
			.objectStore(IMAGE_EDITOR_RECOVERY_STORE)
			.get(designID);
		request.onsuccess = () => resolve(request.result as LocalImageEditorRecovery | undefined);
		request.onerror = () => reject(request.error);
	});
	db.close();
	if (!record) return null;
	if (Date.parse(record.expires_at) < Date.now()) {
		await clearLocalImageEditorRecovery(designID);
		return null;
	}
	return record;
}

export async function clearLocalImageEditorRecovery(designID: string): Promise<void> {
	if (!browser) return;
	const db = await openImageEditorDatabase();
	await new Promise<void>((resolve, reject) => {
		const transaction = db.transaction(IMAGE_EDITOR_RECOVERY_STORE, 'readwrite');
		transaction.objectStore(IMAGE_EDITOR_RECOVERY_STORE).delete(designID);
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
	const raw =
		sessionStorage.getItem(`${COMPOSER_PREFIX}${token}`) ??
		sessionStorage.getItem(`${LEGACY_COMPOSER_PREFIX}${token}`);
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
	if (!browser) return;
	sessionStorage.removeItem(`${COMPOSER_PREFIX}${token}`);
	sessionStorage.removeItem(`${LEGACY_COMPOSER_PREFIX}${token}`);
}
