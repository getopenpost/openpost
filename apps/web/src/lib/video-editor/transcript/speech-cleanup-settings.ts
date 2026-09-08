import { z } from 'zod';
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

function boundedNumber(min: number, max: number, fallback: number) {
	return z
		.number()
		.finite()
		.transform((value) => Math.min(max, Math.max(min, value)))
		.catch(fallback);
}

function storedWords(fallback: string[]) {
	return z
		.array(z.string().nullable().catch(null))
		.transform((words) => words.filter((word) => word !== null))
		.catch(() => [...fallback]);
}

const fillerSettingsSchema = z.object({
	fillerWords: storedWords(DEFAULT_FILLER_REMOVAL_SETTINGS.fillerWords),
	fillerPhrases: storedWords(DEFAULT_FILLER_REMOVAL_SETTINGS.fillerPhrases),
	paddingMs: z.number().finite().catch(DEFAULT_FILLER_REMOVAL_SETTINGS.paddingMs),
	maxSimpleFillerMs: z.number().finite().catch(DEFAULT_FILLER_REMOVAL_SETTINGS.maxSimpleFillerMs),
	maxPhraseFillerMs: z.number().finite().catch(DEFAULT_FILLER_REMOVAL_SETTINGS.maxPhraseFillerMs)
});

const storedSettingsSchema = z.object({
	fillerPreset: z.enum(FILLER_REMOVAL_PRESETS.map((preset) => preset.id)).catch('balanced'),
	fillerSettings: fillerSettingsSchema.catch(() => fillerSettingsSchema.parse({})),
	silenceMode: z.enum(['signal', 'transcript']).catch('signal'),
	minSilenceMs: boundedNumber(100, 10000, 500),
	paddingStartMs: boundedNumber(0, 2000, 100),
	paddingEndMs: boundedNumber(0, 2000, 100),
	autoThresholds: z.boolean().catch(true),
	silenceThresholdDb: boundedNumber(-80, -20, -45),
	audioThresholdDb: boundedNumber(-77, -6, -35)
});

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
		return storedSettingsSchema.parse(saved ? JSON.parse(saved) : {});
	} catch {
		return storedSettingsSchema.parse({});
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
