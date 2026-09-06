import { browser } from '$app/environment';
import type { ImageEditorDocument } from './types';
import { migrateImageEditorDocument, type ImageEditorDocumentInput } from './document';
import { openImageEditorDatabase, IMAGE_EDITOR_RECOVERY_STORE } from './local-persistence';

interface LocalImageEditorRecovery {
	design_id: string;
	workspace_id: string;
	revision: number;
	document: ImageEditorDocument;
	updated_at: string;
	expires_at: string;
}

type LocalRecoveryField =
	| string
	| number
	| boolean
	| null
	| LocalRecoveryField[]
	| { [key: string]: LocalRecoveryField }
	| undefined;

interface LocalImageEditorRecoveryInput {
	design_id?: LocalRecoveryField;
	workspace_id?: LocalRecoveryField;
	revision?: LocalRecoveryField;
	document?: LocalRecoveryField;
	updated_at?: LocalRecoveryField;
	expires_at?: LocalRecoveryField;
}

function recoveryString(value: LocalRecoveryField): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

export function parseLocalImageEditorRecovery(value: unknown): LocalImageEditorRecovery | null {
	if (!value || Object(value) !== value || Array.isArray(value)) return null;
	// SAFETY: The checks above establish the record boundary; all members are validated below.
	const input = value as LocalImageEditorRecoveryInput;
	const designID = recoveryString(input.design_id);
	const workspaceID = recoveryString(input.workspace_id);
	const updatedAt = recoveryString(input.updated_at);
	const expiresAt = recoveryString(input.expires_at);
	if (
		!designID ||
		!workspaceID ||
		!Number.isFinite(input.revision) ||
		!updatedAt ||
		!expiresAt ||
		!Number.isFinite(Date.parse(updatedAt)) ||
		!Number.isFinite(Date.parse(expiresAt)) ||
		!input.document ||
		Object(input.document) !== input.document ||
		Array.isArray(input.document)
	) {
		return null;
	}
	// SAFETY: The document is a non-array object; the migration validates its complete schema.
	const migration = migrateImageEditorDocument(input.document as ImageEditorDocumentInput);
	if (!migration.document || migration.readOnly) return null;
	return {
		design_id: designID,
		workspace_id: workspaceID,
		revision: Number(input.revision),
		document: migration.document,
		updated_at: updatedAt,
		expires_at: expiresAt
	};
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
	const storedValue = await new Promise<unknown>((resolve, reject) => {
		const request = db
			.transaction(IMAGE_EDITOR_RECOVERY_STORE)
			.objectStore(IMAGE_EDITOR_RECOVERY_STORE)
			.get(designID);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	db.close();
	const record = parseLocalImageEditorRecovery(storedValue);
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
