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

describe('editor-settings layout dock', () => {
	it('keeps the assets column full height and the tools above the timeline by default', () => {
		const settings = normalizeEditorSettings({});
		expect(settings.leftSidebarCollapsed).toBe(false);
		expect(settings.rightSidebarCollapsed).toBe(false);
		expect(settings.leftSidebarFullColumn).toBe(true);
		expect(settings.rightSidebarFullColumn).toBe(false);
		expect(settings.theaterMode).toBe(false);
	});

	it('keeps stored collapse, expand, and theater choices and rejects unknown values', () => {
		const settings = normalizeEditorSettings({
			leftSidebarCollapsed: true,
			rightSidebarCollapsed: true,
			expandedSidebar: 'left',
			theaterMode: true
		});
		expect(settings.leftSidebarCollapsed).toBe(true);
		expect(settings.rightSidebarCollapsed).toBe(true);
		expect(settings.leftSidebarFullColumn).toBe(true);
		expect(settings.theaterMode).toBe(true);
		expect(normalizeEditorSettings({ expandedSidebar: 'right' }).rightSidebarFullColumn).toBe(true);
		expect(
			normalizeEditorSettings({ rightSidebarFullColumn: false, expandedSidebar: 'right' })
				.rightSidebarFullColumn
		).toBe(false);
		expect(normalizeEditorSettings({ leftSidebarCollapsed: 1 }).leftSidebarCollapsed).toBe(false);
		expect(normalizeEditorSettings({ theaterMode: 'yes' }).theaterMode).toBe(false);
	});

	it('persists the dock layout across store instances without touching panel widths', () => {
		const storage = memoryStorage();
		const first = createEditorSettingsStore(storage);
		const assetWidth = first.assetBrowserWidth;
		const inspectorWidth = first.inspectorPanelWidth;
		first.set('leftSidebarCollapsed', true);
		first.set('leftSidebarFullColumn', false);
		first.set('rightSidebarFullColumn', true);
		first.set('theaterMode', true);
		const second = createEditorSettingsStore(storage);
		expect(second.leftSidebarCollapsed).toBe(true);
		expect(second.leftSidebarFullColumn).toBe(false);
		expect(second.rightSidebarFullColumn).toBe(true);
		expect(second.theaterMode).toBe(true);
		expect(second.assetBrowserWidth).toBe(assetWidth);
		expect(second.inspectorPanelWidth).toBe(inspectorWidth);
	});
});
