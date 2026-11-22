import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSequenceView, writeSequenceView } from './sequence-view-storage';

// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock('$app/environment', () => ({ browser: true }));

const storage = new Map<string, string>();
beforeEach(() => {
	storage.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => void storage.set(key, String(value)),
		removeItem: (key: string) => void storage.delete(key),
		clear: () => storage.clear(),
		key: (index: number) => [...storage.keys()][index] ?? null,
		get length() {
			return storage.size;
		}
	});
});
afterEach(() => {
	storage.clear();
	vi.unstubAllGlobals();
});
it('restores the playhead, timeline viewport and panel only in the same project and Workspace', () => {
	writeSequenceView('project-a', 'workspace-a', {
		activeSequenceId: 'motion',
		editSequenceId: null,
		currentFrame: 706,
		zoomLevel: 2.5,
		scrollPosition: 300,
		leftPanel: 'transcript'
	});
	expect(readSequenceView('project-a', 'workspace-a')).toMatchObject({
		currentFrame: 706,
		zoomLevel: 2.5,
		scrollPosition: 300,
		leftPanel: 'transcript'
	});
	expect(readSequenceView('project-b', 'workspace-a')).toBeNull();
	expect(readSequenceView('project-a', 'workspace-b')).toBeNull();
});
