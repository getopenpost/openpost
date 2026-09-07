import {
	DEFAULT_FILLER_REMOVAL_SETTINGS,
	FILLER_REMOVAL_PRESETS,
	type FillerRemovalPresetId,
	type FillerRemovalSettings
} from './speech-cleanup';

const STORAGE_KEY = 'openpost-video-editor-cleanup-settings-v1';

type SilenceDetectionMode = 'signal' | 'transcript';

export interface SpeechCleanupPersistedSettings {
	fillerPreset: FillerRemovalPresetId;
	fillerSettings: FillerRemovalSettings;
	silenceMode: SilenceDetectionMode;
	minSilenceMs: number;
	paddingStartMs: number;
	paddingEndMs: number;
	autoThresholds: boolean;
	silenceThresholdDb: number;
	audioThresholdDb: number;
}

export const DEFAULT_SPEECH_CLEANUP_SETTINGS: SpeechCleanupPersistedSettings = {
	fillerPreset: 'balanced',
	fillerSettings: {
		...DEFAULT_FILLER_REMOVAL_SETTINGS,
		fillerWords: [...DEFAULT_FILLER_REMOVAL_SETTINGS.fillerWords],
		fillerPhrases: [...DEFAULT_FILLER_REMOVAL_SETTINGS.fillerPhrases]
	},
	silenceMode: 'signal',
	minSilenceMs: 500,
	paddingStartMs: 100,
	paddingEndMs: 100,
	autoThresholds: true,
	silenceThresholdDb: -45,
	audioThresholdDb: -35
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
}

function normalizeFillerSettings(value: unknown): FillerRemovalSettings {
	const record = (value ?? {}) as Partial<FillerRemovalSettings>;
	const words = Array.isArray(record.fillerWords)
		? record.fillerWords.filter((entry): entry is string => typeof entry === 'string')
		: DEFAULT_FILLER_REMOVAL_SETTINGS.fillerWords;
	const phrases = Array.isArray(record.fillerPhrases)
		? record.fillerPhrases.filter((entry): entry is string => typeof entry === 'string')
		: DEFAULT_FILLER_REMOVAL_SETTINGS.fillerPhrases;
	return {
		...DEFAULT_FILLER_REMOVAL_SETTINGS,
		...(typeof record === 'object' ? record : {}),
		fillerWords: [...words],
		fillerPhrases: [...phrases]
	};
}

export function normalizeSpeechCleanupSettings(value: unknown): SpeechCleanupPersistedSettings {
	const record = (value ?? {}) as Partial<SpeechCleanupPersistedSettings>;
	const preset = FILLER_REMOVAL_PRESETS.some((candidate) => candidate.id === record.fillerPreset)
		? record.fillerPreset!
		: DEFAULT_SPEECH_CLEANUP_SETTINGS.fillerPreset;
	return {
		fillerPreset: preset,
		fillerSettings: normalizeFillerSettings(record.fillerSettings),
		silenceMode: record.silenceMode === 'transcript' ? 'transcript' : 'signal',
		minSilenceMs: clampNumber(record.minSilenceMs, 100, 10000, 500),
		paddingStartMs: clampNumber(record.paddingStartMs, 0, 2000, 100),
		paddingEndMs: clampNumber(record.paddingEndMs, 0, 2000, 100),
		autoThresholds: typeof record.autoThresholds === 'boolean' ? record.autoThresholds : true,
		silenceThresholdDb: clampNumber(record.silenceThresholdDb, -80, -20, -45),
		audioThresholdDb: clampNumber(record.audioThresholdDb, -77, -6, -35)
	};
}

interface SettingsStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function browserStorage(): SettingsStorage | null {
	try {
		return 'localStorage' in globalThis ? globalThis.localStorage : null;
	} catch {
		return null;
	}
}

export function loadSpeechCleanupSettings(
	storage: SettingsStorage | null = browserStorage()
): SpeechCleanupPersistedSettings {
	try {
		const saved = storage?.getItem(STORAGE_KEY);
		if (!saved) return normalizeSpeechCleanupSettings(undefined);
		return normalizeSpeechCleanupSettings(JSON.parse(saved) as unknown);
	} catch {
		return normalizeSpeechCleanupSettings(undefined);
	}
}

export function saveSpeechCleanupSettings(
	settings: SpeechCleanupPersistedSettings,
	storage: SettingsStorage | null = browserStorage()
): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Private browsing and full storage must not break the dialog.
	}
}
