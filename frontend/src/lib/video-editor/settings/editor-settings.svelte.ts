/* oxlint-disable anti-slop/no-runtime-typeof -- This module parses localStorage JSON at its I/O boundary and validates primitive JSON fields before domain use. */
import type { TranscriptionModel, TranscriptionQuantization } from '../transcript/engine/types';
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	TRANSCRIPTION_LANGUAGE_OPTIONS,
	TRANSCRIPTION_MODEL_OPTIONS,
	TRANSCRIPTION_QUANTIZATION_OPTIONS
} from '../transcript/engine/models';
import {
	CAPTION_STYLE_PRESETS,
	DEFAULT_CAPTION_STYLE_PRESET_ID,
	type CaptionStylePresetId
} from '../typography/caption-style-presets';

const STORAGE_KEY = 'openpost-video-editor-settings-v1';

type JsonValue = null | boolean | number | string | JsonValue[] | JsonRecord;
interface JsonRecord {
	[key: string]: JsonValue;
}

export type MediaLibraryViewMode = 'grid' | 'list';

export interface EditorSettingsValue {
	maxUndoHistory: number;
	autoSaveIntervalMinutes: number;
	snapByDefault: boolean;
	canvasSnapEnabled: boolean;
	showWaveforms: boolean;
	showFilmstrips: boolean;
	extractFilmstrips: boolean;
	mediaLibraryViewMode: MediaLibraryViewMode;
	mediaLibraryItemSize: number;
	assetBrowserWidth: number;
	inspectorPanelWidth: number;
	motionPanelWidth: number;
	sourceMonitorWidth: number;
	scopesPanelWidth: number;
	timelineHeight: number;
	colorDockHeight: number;
	audioMixerHeight: number;
	defaultTranscriptionModel: TranscriptionModel;
	defaultTranscriptionLanguage: string;
	defaultTranscriptionQuantization: TranscriptionQuantization;
	defaultCaptionStylePresetId: CaptionStylePresetId;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettingsValue = {
	maxUndoHistory: 100,
	autoSaveIntervalMinutes: 5,
	snapByDefault: true,
	canvasSnapEnabled: true,
	showWaveforms: true,
	showFilmstrips: true,
	extractFilmstrips: true,
	mediaLibraryViewMode: 'grid',
	mediaLibraryItemSize: 2,
	assetBrowserWidth: 336,
	inspectorPanelWidth: 320,
	motionPanelWidth: 340,
	sourceMonitorWidth: 480,
	scopesPanelWidth: 360,
	timelineHeight: 260,
	colorDockHeight: 520,
	audioMixerHeight: 224,
	defaultTranscriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
	defaultTranscriptionLanguage: '',
	defaultTranscriptionQuantization: 'hybrid',
	defaultCaptionStylePresetId: DEFAULT_CAPTION_STYLE_PRESET_ID
};

interface SettingsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function clampUndoHistory(value: JsonValue | undefined): number {
	const number = typeof value === 'number' && Number.isFinite(value) ? value : 100;
	return Math.round(Math.min(200, Math.max(10, number)) / 10) * 10;
}

export const AUTO_SAVE_INTERVAL_MINUTES = [5, 10, 15, 20, 25, 30] as const;

function clampAutoSaveInterval(value: JsonValue | undefined): number {
	if (value === 0) return 0;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_EDITOR_SETTINGS.autoSaveIntervalMinutes;
	}
	return AUTO_SAVE_INTERVAL_MINUTES.reduce((closest, candidate) =>
		Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
	);
}

function isTranscriptionModel(value: JsonValue | undefined): value is TranscriptionModel {
	return TRANSCRIPTION_MODEL_OPTIONS.some((option) => option.value === value);
}

function isTranscriptionQuantization(
	value: JsonValue | undefined
): value is TranscriptionQuantization {
	return TRANSCRIPTION_QUANTIZATION_OPTIONS.some((option) => option.value === value);
}

function isTranscriptionLanguage(value: JsonValue | undefined): value is string {
	return (
		typeof value === 'string' &&
		TRANSCRIPTION_LANGUAGE_OPTIONS.some((option) => option.value === value)
	);
}

function isCaptionStylePresetId(value: JsonValue | undefined): value is CaptionStylePresetId {
	return CAPTION_STYLE_PRESETS.some((preset) => preset.id === value);
}

function normalizeCaptionStylePresetId(value: JsonValue | undefined): CaptionStylePresetId {
	return isCaptionStylePresetId(value) ? value : DEFAULT_CAPTION_STYLE_PRESET_ID;
}

function normalizeMediaLibraryViewMode(value: JsonValue | undefined): MediaLibraryViewMode {
	return value === 'list' || value === 'grid'
		? value
		: DEFAULT_EDITOR_SETTINGS.mediaLibraryViewMode;
}

function clampMediaLibraryItemSize(value: JsonValue | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return DEFAULT_EDITOR_SETTINGS.mediaLibraryItemSize;
	}
	return Math.max(1, Math.min(5, Math.round(value)));
}

function clampLayoutSize(
	value: JsonValue | undefined,
	fallback: number,
	min: number,
	max: number
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.round(Math.min(max, Math.max(min, value)));
}

function isJsonRecord(value: JsonValue): value is JsonRecord {
	return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function parseSettingsJson(value: string): JsonValue {
	// SAFETY: JSON.parse returns only the recursive JSON value types represented above.
	return JSON.parse(value) as JsonValue;
}

export function normalizeEditorSettings(value: JsonValue): EditorSettingsValue {
	const record = isJsonRecord(value) ? value : {};
	return {
		maxUndoHistory: clampUndoHistory(record.maxUndoHistory),
		autoSaveIntervalMinutes: clampAutoSaveInterval(record.autoSaveIntervalMinutes),
		snapByDefault:
			typeof record.snapByDefault === 'boolean'
				? record.snapByDefault
				: DEFAULT_EDITOR_SETTINGS.snapByDefault,
		canvasSnapEnabled:
			typeof record.canvasSnapEnabled === 'boolean'
				? record.canvasSnapEnabled
				: DEFAULT_EDITOR_SETTINGS.canvasSnapEnabled,
		showWaveforms:
			typeof record.showWaveforms === 'boolean'
				? record.showWaveforms
				: DEFAULT_EDITOR_SETTINGS.showWaveforms,
		showFilmstrips:
			typeof record.showFilmstrips === 'boolean'
				? record.showFilmstrips
				: DEFAULT_EDITOR_SETTINGS.showFilmstrips,
		extractFilmstrips:
			typeof record.extractFilmstrips === 'boolean'
				? record.extractFilmstrips
				: DEFAULT_EDITOR_SETTINGS.extractFilmstrips,
		mediaLibraryViewMode: normalizeMediaLibraryViewMode(record.mediaLibraryViewMode),
		mediaLibraryItemSize: clampMediaLibraryItemSize(record.mediaLibraryItemSize),
		assetBrowserWidth: clampLayoutSize(record.assetBrowserWidth, 336, 300, 480),
		inspectorPanelWidth: clampLayoutSize(record.inspectorPanelWidth, 320, 280, 520),
		motionPanelWidth: clampLayoutSize(record.motionPanelWidth, 340, 300, 520),
		sourceMonitorWidth: clampLayoutSize(record.sourceMonitorWidth, 480, 300, 720),
		scopesPanelWidth: clampLayoutSize(record.scopesPanelWidth, 360, 280, 600),
		timelineHeight: clampLayoutSize(record.timelineHeight, 260, 180, 620),
		colorDockHeight: clampLayoutSize(record.colorDockHeight, 520, 500, 720),
		audioMixerHeight: clampLayoutSize(record.audioMixerHeight, 224, 160, 420),
		defaultTranscriptionModel: isTranscriptionModel(record.defaultTranscriptionModel)
			? record.defaultTranscriptionModel
			: DEFAULT_EDITOR_SETTINGS.defaultTranscriptionModel,
		defaultTranscriptionLanguage: isTranscriptionLanguage(record.defaultTranscriptionLanguage)
			? record.defaultTranscriptionLanguage
			: DEFAULT_EDITOR_SETTINGS.defaultTranscriptionLanguage,
		defaultTranscriptionQuantization: isTranscriptionQuantization(
			record.defaultTranscriptionQuantization
		)
			? record.defaultTranscriptionQuantization
			: DEFAULT_EDITOR_SETTINGS.defaultTranscriptionQuantization,
		defaultCaptionStylePresetId: normalizeCaptionStylePresetId(record.defaultCaptionStylePresetId)
	};
}

function browserStorage(): SettingsStorage | null {
	try {
		return 'localStorage' in globalThis ? globalThis.localStorage : null;
	} catch {
		return null;
	}
}

export function createEditorSettingsStore(storage: SettingsStorage | null = browserStorage()) {
	let initial = DEFAULT_EDITOR_SETTINGS;
	try {
		const saved = storage?.getItem(STORAGE_KEY);
		if (saved) initial = normalizeEditorSettings(parseSettingsJson(saved));
	} catch {
		initial = DEFAULT_EDITOR_SETTINGS;
	}
	const state = $state<EditorSettingsValue>({ ...initial });

	function persist(): void {
		try {
			storage?.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// Private browsing and full storage must not break the editor.
		}
	}

	function set<K extends keyof EditorSettingsValue>(key: K, value: EditorSettingsValue[K]): void {
		const normalized = normalizeEditorSettings({ ...state, [key]: value });
		Object.assign(state, normalized);
		persist();
	}

	return {
		get value(): EditorSettingsValue {
			return state;
		},
		get maxUndoHistory(): number {
			return state.maxUndoHistory;
		},
		get autoSaveIntervalMinutes(): number {
			return state.autoSaveIntervalMinutes;
		},
		get snapByDefault(): boolean {
			return state.snapByDefault;
		},
		get canvasSnapEnabled(): boolean {
			return state.canvasSnapEnabled;
		},
		get showWaveforms(): boolean {
			return state.showWaveforms;
		},
		get showFilmstrips(): boolean {
			return state.showFilmstrips;
		},
		get extractFilmstrips(): boolean {
			return state.extractFilmstrips;
		},
		get mediaLibraryViewMode(): MediaLibraryViewMode {
			return state.mediaLibraryViewMode;
		},
		get mediaLibraryItemSize(): number {
			return state.mediaLibraryItemSize;
		},
		get assetBrowserWidth(): number {
			return state.assetBrowserWidth;
		},
		get inspectorPanelWidth(): number {
			return state.inspectorPanelWidth;
		},
		get motionPanelWidth(): number {
			return state.motionPanelWidth;
		},
		get sourceMonitorWidth(): number {
			return state.sourceMonitorWidth;
		},
		get scopesPanelWidth(): number {
			return state.scopesPanelWidth;
		},
		get timelineHeight(): number {
			return state.timelineHeight;
		},
		get colorDockHeight(): number {
			return state.colorDockHeight;
		},
		get audioMixerHeight(): number {
			return state.audioMixerHeight;
		},
		get defaultTranscriptionModel(): TranscriptionModel {
			return state.defaultTranscriptionModel;
		},
		get defaultTranscriptionLanguage(): string {
			return state.defaultTranscriptionLanguage;
		},
		get defaultTranscriptionQuantization(): TranscriptionQuantization {
			return state.defaultTranscriptionQuantization;
		},
		get defaultCaptionStylePresetId(): CaptionStylePresetId {
			return state.defaultCaptionStylePresetId;
		},
		set,
		reset(): void {
			Object.assign(state, DEFAULT_EDITOR_SETTINGS);
			try {
				storage?.removeItem(STORAGE_KEY);
			} catch {
				persist();
			}
		}
	};
}

export const editorSettings = createEditorSettingsStore();
