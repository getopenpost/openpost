import { describe, expect, it } from 'vitest';
import { createEditorSettingsStore, normalizeEditorSettings } from './editor-settings.svelte';

function memoryStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		}
	};
}

describe('editor-settings caption search mode', () => {
	it('defaults to keyword matching', () => {
		expect(normalizeEditorSettings({}).captionSearchMode).toBe('keyword');
	});

	it('keeps a stored semantic choice and rejects unknown values', () => {
		expect(normalizeEditorSettings({ captionSearchMode: 'semantic' }).captionSearchMode).toBe(
			'semantic'
		);
		expect(normalizeEditorSettings({ captionSearchMode: 'fuzzy' }).captionSearchMode).toBe(
			'keyword'
		);
	});

	it('persists the mode across store instances', () => {
		const storage = memoryStorage();
		const first = createEditorSettingsStore(storage);
		first.set('captionSearchMode', 'semantic');
		const second = createEditorSettingsStore(storage);
		expect(second.captionSearchMode).toBe('semantic');
	});
});
