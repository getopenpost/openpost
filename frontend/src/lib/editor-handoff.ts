export type EditorHandoffKind = 'image' | 'video';
export type EditorHandoffStatus = 'completed' | 'cancelled';

export interface ComposerRecoverySnapshot<T = unknown> {
	version: 2;
	editor: EditorHandoffKind;
	workspace_id: string;
	return_url: string;
	purpose: string;
	created_at: string;
	expires_at: string;
	payload: T;
}

interface LegacyComposerRecoverySnapshot {
	version: 1;
	workspace_id: string;
	return_url: string;
	purpose: string;
	created_at: string;
	expires_at: string;
	payload: unknown;
}

const HANDOFF_PREFIX = 'openpost:editor-handoff:return:';
const LEGACY_PREFIXES = ['openpost:image-editor:return:', 'openpost:studio:return:'] as const;

export const editorReturnParameter: Record<EditorHandoffKind, string> = {
	image: 'image_editor_return',
	video: 'video_editor_return'
};

function browserSessionStorage(): Storage | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeReturnURL(value: unknown): string | null {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
	try {
		const parsed = new URL(value, 'https://openpost.invalid');
		if (parsed.origin !== 'https://openpost.invalid') return null;
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return null;
	}
}

function parseSnapshot(
	raw: string,
	legacy: boolean
): ComposerRecoverySnapshot | LegacyComposerRecoverySnapshot | null {
	try {
		const value: unknown = JSON.parse(raw);
		if (!isRecord(value)) return null;
		const version = value.version;
		const editor = value.editor;
		const returnURL = safeReturnURL(value.return_url);
		if (
			!returnURL ||
			typeof value.workspace_id !== 'string' ||
			!value.workspace_id.trim() ||
			typeof value.purpose !== 'string' ||
			typeof value.created_at !== 'string' ||
			typeof value.expires_at !== 'string' ||
			!Number.isFinite(Date.parse(value.expires_at))
		) {
			return null;
		}
		if (legacy && version === 1) {
			return { ...(value as unknown as LegacyComposerRecoverySnapshot), return_url: returnURL };
		}
		if (version !== 2 || (editor !== 'image' && editor !== 'video')) return null;
		return { ...(value as unknown as ComposerRecoverySnapshot), return_url: returnURL };
	} catch {
		return null;
	}
}

export function storeEditorHandoff(
	token: string,
	snapshot: ComposerRecoverySnapshot,
	storage: Storage | null = browserSessionStorage()
): void {
	if (!storage || !token.trim()) return;
	storage.setItem(`${HANDOFF_PREFIX}${token}`, JSON.stringify(snapshot));
}

export function loadEditorHandoff(
	token: string,
	expectedEditor?: EditorHandoffKind,
	storage: Storage | null = browserSessionStorage(),
	now = Date.now()
): ComposerRecoverySnapshot | null {
	if (!storage || !token.trim()) return null;
	const current = storage.getItem(`${HANDOFF_PREFIX}${token}`);
	let snapshot = current ? parseSnapshot(current, false) : null;
	if (!snapshot) {
		for (const prefix of LEGACY_PREFIXES) {
			const raw = storage.getItem(`${prefix}${token}`);
			if (!raw) continue;
			snapshot = parseSnapshot(raw, true);
			if (snapshot) break;
		}
	}
	if (!snapshot || Date.parse(snapshot.expires_at) <= now) {
		clearEditorHandoff(token, storage);
		return null;
	}
	const normalized: ComposerRecoverySnapshot =
		snapshot.version === 1 ? { ...snapshot, version: 2, editor: 'image' } : snapshot;
	if (expectedEditor && normalized.editor !== expectedEditor) return null;
	return normalized;
}

export function clearEditorHandoff(
	token: string,
	storage: Storage | null = browserSessionStorage()
): void {
	if (!storage || !token.trim()) return;
	storage.removeItem(`${HANDOFF_PREFIX}${token}`);
	for (const prefix of LEGACY_PREFIXES) storage.removeItem(`${prefix}${token}`);
}

export function editorHandoffReturnURL(
	token: string,
	editor: EditorHandoffKind,
	status: EditorHandoffStatus,
	storage: Storage | null = browserSessionStorage()
): string | null {
	const snapshot = loadEditorHandoff(token, editor, storage);
	if (!snapshot) return null;
	const target = new URL(snapshot.return_url, 'https://openpost.invalid');
	target.searchParams.set(editorReturnParameter[editor], token);
	if (status === 'cancelled') target.searchParams.set('editor_handoff_cancelled', '1');
	else target.searchParams.delete('editor_handoff_cancelled');
	return `${target.pathname}${target.search}${target.hash}`;
}
