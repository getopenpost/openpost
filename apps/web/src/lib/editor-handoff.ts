export type EditorHandoffKind = 'image' | 'video';
export type EditorHandoffStatus = 'completed' | 'cancelled';

export interface ComposerRecoverySnapshot<T = HandoffJSONValue> {
	version: 2;
	editor: EditorHandoffKind;
	workspace_id: string;
	publication_id?: string;
	publication_revision?: number;
	return_token?: string;
	return_url: string;
	purpose: string;
	created_at: string;
	expires_at: string;
	payload: T;
}

const HANDOFF_PREFIX = 'openpost:editor-handoff:return:';

export type HandoffJSONValue =
	| string
	| number
	| boolean
	| null
	| HandoffJSONValue[]
	| { [key: string]: HandoffJSONValue };

export const editorReturnParameter = {
	image: 'image_editor_return',
	video: 'video_editor_return'
} satisfies Record<EditorHandoffKind, string>;

function browserSessionStorage(): Storage | null {
	if (typeof window === 'undefined') return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function isHandoffRecord(value: unknown): value is { [key: string]: HandoffJSONValue } {
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

function parseSnapshot(raw: string): ComposerRecoverySnapshot | null {
	try {
		const value: unknown = JSON.parse(raw);
		if (!isHandoffRecord(value)) return null;
		const version = value.version;
		const editor = value.editor;
		const returnURL = safeReturnURL(value.return_url);
		if (
			!returnURL ||
			!Object.hasOwn(value, 'payload') ||
			typeof value.workspace_id !== 'string' ||
			!value.workspace_id.trim() ||
			typeof value.purpose !== 'string' ||
			typeof value.created_at !== 'string' ||
			typeof value.expires_at !== 'string' ||
			!Number.isFinite(Date.parse(value.expires_at))
		) {
			return null;
		}
		if (version !== 2 || (editor !== 'image' && editor !== 'video')) return null;
		const snapshot: ComposerRecoverySnapshot = {
			version,
			editor,
			workspace_id: value.workspace_id,
			return_url: returnURL,
			purpose: value.purpose,
			created_at: value.created_at,
			expires_at: value.expires_at,
			payload: value.payload
		};
		if (typeof value.publication_id === 'string') snapshot.publication_id = value.publication_id;
		if (typeof value.publication_revision === 'number') {
			snapshot.publication_revision = value.publication_revision;
		}
		if (typeof value.return_token === 'string') snapshot.return_token = value.return_token;
		return snapshot;
	} catch {
		return null;
	}
}

export function storeEditorHandoff<T>(
	token: string,
	snapshot: ComposerRecoverySnapshot<T>,
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
	const snapshot = current ? parseSnapshot(current) : null;
	if (!snapshot || Date.parse(snapshot.expires_at) <= now) {
		clearEditorHandoff(token, storage);
		return null;
	}
	if (expectedEditor && snapshot.editor !== expectedEditor) return null;
	return snapshot;
}

export function clearEditorHandoff(
	token: string,
	storage: Storage | null = browserSessionStorage()
): void {
	if (!storage || !token.trim()) return;
	storage.removeItem(`${HANDOFF_PREFIX}${token}`);
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
