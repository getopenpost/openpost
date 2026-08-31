import { describe, expect, it } from 'vitest';
import {
	createEditorSettingsStore,
	DEFAULT_EDITOR_SETTINGS,
	normalizeEditorSettings
} from './editor-settings.svelte';

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	};
}

describe('editor settings', () => {
	it('normalizes corrupt and out-of-range persisted values', () => {
		expect(
			normalizeEditorSettings({
				maxUndoHistory: 999,
				autoSaveIntervalMinutes: 'later',
				snapByDefault: false,
				showWaveforms: 'yes',
				defaultTranscriptionModel: 'not-a-model',
				defaultTranscriptionLanguage: 'xx',
				defaultTranscriptionQuantization: 'bad'
			})
		).toEqual({
			...DEFAULT_EDITOR_SETTINGS,
			maxUndoHistory: 200,
			snapByDefault: false
		});
	});

	it('keeps disabled periodic saves and snaps intervals to safe choices', () => {
		expect(normalizeEditorSettings({ autoSaveIntervalMinutes: 0 }).autoSaveIntervalMinutes).toBe(0);
		expect(normalizeEditorSettings({ autoSaveIntervalMinutes: 3 }).autoSaveIntervalMinutes).toBe(5);
		expect(normalizeEditorSettings({ autoSaveIntervalMinutes: 13 }).autoSaveIntervalMinutes).toBe(
			15
		);
		expect(normalizeEditorSettings({ autoSaveIntervalMinutes: 999 }).autoSaveIntervalMinutes).toBe(
			30
		);
	});

	it('normalizes and persists asset library layout preferences', () => {
		expect(
			normalizeEditorSettings({
				mediaLibraryViewMode: 'tiles',
				mediaLibraryItemSize: 99
			})
		).toMatchObject({ mediaLibraryViewMode: 'grid', mediaLibraryItemSize: 5 });
		expect(normalizeEditorSettings({ mediaLibraryItemSize: -2 }).mediaLibraryItemSize).toBe(1);

		const storage = memoryStorage();
		const settings = createEditorSettingsStore(storage);
		settings.set('mediaLibraryViewMode', 'list');
		settings.set('mediaLibraryItemSize', 4);
		const restored = createEditorSettingsStore(storage);
		expect(restored.mediaLibraryViewMode).toBe('list');
		expect(restored.mediaLibraryItemSize).toBe(4);
	});

	it('clamps and persists the primary editor panel sizes', () => {
		const normalized = normalizeEditorSettings({
			assetBrowserWidth: 999,
			inspectorPanelWidth: 100,
			motionPanelWidth: 401.4,
			sourceMonitorWidth: 612,
			scopesPanelWidth: Number.NaN,
			timelineHeight: 50,
			colorDockHeight: 900,
			audioMixerHeight: 120
		});
		expect(normalized).toMatchObject({
			assetBrowserWidth: 480,
			inspectorPanelWidth: 280,
			motionPanelWidth: 401,
			sourceMonitorWidth: 612,
			scopesPanelWidth: DEFAULT_EDITOR_SETTINGS.scopesPanelWidth,
			timelineHeight: 180,
			colorDockHeight: 720,
			audioMixerHeight: 160
		});

		const storage = memoryStorage();
		const settings = createEditorSettingsStore(storage);
		settings.set('assetBrowserWidth', 388);
		settings.set('timelineHeight', 344);
		const restored = createEditorSettingsStore(storage);
		expect(restored.assetBrowserWidth).toBe(388);
		expect(restored.timelineHeight).toBe(344);
	});

	it('normalizes and persists the default generated caption style', () => {
		expect(
			normalizeEditorSettings({ defaultCaptionStylePresetId: 'unknown' })
				.defaultCaptionStylePresetId
		).toBe('netflix');

		const storage = memoryStorage();
		const settings = createEditorSettingsStore(storage);
		settings.set('defaultCaptionStylePresetId', 'tiktok');
		expect(createEditorSettingsStore(storage).defaultCaptionStylePresetId).toBe('tiktok');
	});

	it('persists canvas snapping independently from the timeline default', () => {
		const storage = memoryStorage();
		const settings = createEditorSettingsStore(storage);
		settings.set('snapByDefault', false);
		settings.set('canvasSnapEnabled', true);

		const restored = createEditorSettingsStore(storage);
		expect(restored.snapByDefault).toBe(false);
		expect(restored.canvasSnapEnabled).toBe(true);
		expect(normalizeEditorSettings({ canvasSnapEnabled: 'yes' }).canvasSnapEnabled).toBe(true);
	});

	it('persists changes and resets the complete settings document', () => {
		const storage = memoryStorage();
		const first = createEditorSettingsStore(storage);
		first.set('maxUndoHistory', 30);
		first.set('autoSaveIntervalMinutes', 10);
		first.set('showFilmstrips', false);
		first.set('defaultTranscriptionModel', 'whisper-small');

		const restored = createEditorSettingsStore(storage);
		expect(restored.maxUndoHistory).toBe(30);
		expect(restored.autoSaveIntervalMinutes).toBe(10);
		expect(restored.showFilmstrips).toBe(false);
		expect(restored.defaultTranscriptionModel).toBe('whisper-small');

		restored.reset();
		expect(createEditorSettingsStore(storage).value).toEqual(DEFAULT_EDITOR_SETTINGS);
	});
});
