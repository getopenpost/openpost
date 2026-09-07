import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SPEECH_CLEANUP_SETTINGS,
	loadSpeechCleanupSettings,
	normalizeSpeechCleanupSettings,
	saveSpeechCleanupSettings
} from './speech-cleanup-settings';

function memoryStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		data: store
	};
}

describe('speech-cleanup-settings', () => {
	it('returns defaults when nothing is stored', () => {
		expect(loadSpeechCleanupSettings(memoryStorage())).toEqual(DEFAULT_SPEECH_CLEANUP_SETTINGS);
	});

	it('survives a save/load round trip', () => {
		const storage = memoryStorage();
		const settings = {
			...DEFAULT_SPEECH_CLEANUP_SETTINGS,
			minSilenceMs: 800,
			autoThresholds: false,
			silenceThresholdDb: -50
		};
		saveSpeechCleanupSettings(settings, storage);
		expect(loadSpeechCleanupSettings(storage)).toEqual(settings);
	});

	it('clamps out-of-range values and rejects unknown presets', () => {
		const normalized = normalizeSpeechCleanupSettings({
			fillerPreset: 'nope',
			minSilenceMs: 99_999,
			paddingStartMs: -5,
			silenceThresholdDb: 0,
			autoThresholds: 'yes'
		});
		expect(normalized.fillerPreset).toBe('balanced');
		expect(normalized.minSilenceMs).toBe(10000);
		expect(normalized.paddingStartMs).toBe(0);
		expect(normalized.silenceThresholdDb).toBe(-20);
		expect(normalized.autoThresholds).toBe(true);
	});

	it('falls back to defaults on corrupt JSON', () => {
		const storage = memoryStorage({
			'openpost-video-editor-cleanup-settings-v1': '{broken'
		});
		expect(loadSpeechCleanupSettings(storage)).toEqual(DEFAULT_SPEECH_CLEANUP_SETTINGS);
	});
});
