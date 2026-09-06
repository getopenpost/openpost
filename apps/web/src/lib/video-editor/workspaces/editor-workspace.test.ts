import { describe, expect, it } from 'vitest';
import {
	createEditorWorkspaceStore,
	EDITOR_WORKSPACE_STORAGE_KEY
} from './editor-workspace.svelte';

describe('editor workspace state', () => {
	it('restores a valid workspace and persists real changes only', () => {
		const writes: string[] = [];
		const store = createEditorWorkspaceStore({
			getItem: (key) => (key === EDITOR_WORKSPACE_STORAGE_KEY ? 'color' : null),
			setItem: (_key, value) => writes.push(value)
		});

		expect(store.current).toBe('color');
		expect(store.set('color')).toBe(false);
		expect(store.set('motion')).toBe(true);
		expect(store.current).toBe('motion');
		expect(writes).toEqual(['motion']);
	});

	it('falls back to Edit when saved state or storage is bad', () => {
		expect(
			createEditorWorkspaceStore({ getItem: () => 'compose', setItem: () => undefined }).current
		).toBe('edit');
		expect(
			createEditorWorkspaceStore({
				getItem: () => {
					throw new Error('blocked');
				},
				setItem: () => {
					throw new Error('blocked');
				}
			}).set('color')
		).toBe(true);
	});
});
