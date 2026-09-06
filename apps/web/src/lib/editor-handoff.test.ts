import { describe, expect, it } from 'vitest';
import {
	clearEditorHandoff,
	editorHandoffReturnURL,
	loadEditorHandoff,
	storeEditorHandoff,
	type ComposerRecoverySnapshot
} from './editor-handoff';

class MemoryStorage implements Storage {
	readonly values = new Map<string, string>();
	get length(): number {
		return this.values.size;
	}
	clear(): void {
		this.values.clear();
	}
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

function snapshot(editor: 'image' | 'video'): ComposerRecoverySnapshot<{ text: string }> {
	return {
		version: 2,
		editor,
		workspace_id: 'workspace-1',
		publication_id: 'publication-1',
		publication_revision: 4,
		return_token: `${editor}-token`,
		return_url: '/publications/publication-1?panel=compose',
		purpose: 'post_media',
		created_at: '2099-08-09T10:00:00.000Z',
		expires_at: '2099-08-09T12:00:00.000Z',
		payload: { text: 'still here' }
	};
}

describe('editor handoff recovery', () => {
	it('keeps image and video snapshots in one namespaced store', () => {
		const storage = new MemoryStorage();
		storeEditorHandoff('video-token', snapshot('video'), storage);

		expect(
			loadEditorHandoff('video-token', 'video', storage, Date.parse('2099-08-09T11:00:00Z'))
		).toMatchObject({
			editor: 'video',
			publication_id: 'publication-1',
			publication_revision: 4,
			return_token: 'video-token',
			payload: { text: 'still here' }
		});
		expect(
			loadEditorHandoff('video-token', 'image', storage, Date.parse('2099-08-09T11:00:00Z'))
		).toBeNull();
	});

	it('builds a same-origin cancellation return and rejects unsafe stored URLs', () => {
		const storage = new MemoryStorage();
		storeEditorHandoff('video-token', snapshot('video'), storage);
		expect(editorHandoffReturnURL('video-token', 'video', 'cancelled', storage)).toBe(
			'/publications/publication-1?panel=compose&video_editor_return=video-token&editor_handoff_cancelled=1'
		);

		storage.setItem(
			'openpost:editor-handoff:return:unsafe',
			JSON.stringify({ ...snapshot('video'), return_url: '//attacker.example/path' })
		);
		expect(loadEditorHandoff('unsafe', 'video', storage)).toBeNull();
	});

	it('expires and clears the current key for a token', () => {
		const storage = new MemoryStorage();
		storeEditorHandoff('expired', snapshot('image'), storage);
		expect(
			loadEditorHandoff('expired', 'image', storage, Date.parse('2099-08-09T12:00:00Z'))
		).toBeNull();
		clearEditorHandoff('expired', storage);
		expect(storage.length).toBe(0);
	});
});
