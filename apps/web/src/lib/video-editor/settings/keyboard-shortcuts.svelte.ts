import {
	DEFAULT_EDITOR_SHORTCUTS,
	resolveEditorShortcuts,
	sanitizeShortcutOverrides,
	shortcutOverrideRecordSchema,
	type EditorShortcutBindingMap,
	type EditorShortcutId,
	type EditorShortcutOverrideMap
} from './keyboard-shortcuts';

const STORAGE_KEY = 'openpost-video-editor-shortcuts-v1';

interface ShortcutStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function browserStorage(): ShortcutStorage | null {
	try {
		return 'localStorage' in globalThis ? globalThis.localStorage : null;
	} catch {
		return null;
	}
}

export function createKeyboardShortcutStore(storage: ShortcutStorage | null = browserStorage()) {
	let initial: EditorShortcutOverrideMap = {};
	try {
		const saved = storage?.getItem(STORAGE_KEY);
		if (saved) {
			initial = sanitizeShortcutOverrides(shortcutOverrideRecordSchema.parse(JSON.parse(saved)));
		}
	} catch {
		initial = {};
	}
	let overrides = $state<EditorShortcutOverrideMap>({ ...initial });

	function persist(): void {
		try {
			if (Object.keys(overrides).length === 0) storage?.removeItem(STORAGE_KEY);
			else storage?.setItem(STORAGE_KEY, JSON.stringify(overrides));
		} catch {
			// Private browsing and full storage must not disable editor commands.
		}
	}

	function replace(next: EditorShortcutOverrideMap): void {
		overrides = sanitizeShortcutOverrides(next);
		persist();
	}

	return {
		get overrides(): EditorShortcutOverrideMap {
			return overrides;
		},
		get bindings(): EditorShortcutBindingMap {
			return resolveEditorShortcuts(overrides);
		},
		get customCount(): number {
			return Object.keys(overrides).length;
		},
		setBinding(id: EditorShortcutId, binding: string): void {
			replace({ ...overrides, [id]: binding });
		},
		unbind(id: EditorShortcutId): void {
			replace({ ...overrides, [id]: '' });
		},
		resetBinding(id: EditorShortcutId): void {
			const next = { ...overrides };
			delete next[id];
			replace(next);
		},
		replaceOverrides(next: EditorShortcutOverrideMap): void {
			replace(next);
		},
		resetAll(): void {
			overrides = {};
			try {
				storage?.removeItem(STORAGE_KEY);
			} catch {
				persist();
			}
		},
		defaultBinding(id: EditorShortcutId): string {
			return DEFAULT_EDITOR_SHORTCUTS[id];
		}
	};
}

export const keyboardShortcuts = createKeyboardShortcutStore();
