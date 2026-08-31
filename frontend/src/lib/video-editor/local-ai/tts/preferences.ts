import type { LocalTtsEngine } from './registry';

export const LOCAL_TTS_ENGINE_STORAGE_KEY = 'openpost-video-editor-tts-engine-v1';

interface TtsPreferenceStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function browserStorage(): TtsPreferenceStorage | null {
	try {
		return 'localStorage' in globalThis ? globalThis.localStorage : null;
	} catch {
		return null;
	}
}

function isLocalTtsEngine(value: string | null): value is LocalTtsEngine {
	return value === 'kokoro' || value === 'moss' || value === 'supertonic';
}

export function getStoredLocalTtsEngine(
	storage: TtsPreferenceStorage | null = browserStorage()
): LocalTtsEngine {
	try {
		const value = storage?.getItem(LOCAL_TTS_ENGINE_STORAGE_KEY) ?? null;
		return isLocalTtsEngine(value) ? value : 'kokoro';
	} catch {
		return 'kokoro';
	}
}

export function setStoredLocalTtsEngine(
	engine: LocalTtsEngine,
	storage: TtsPreferenceStorage | null = browserStorage()
): void {
	try {
		storage?.setItem(LOCAL_TTS_ENGINE_STORAGE_KEY, engine);
	} catch {
		// Storage can fail in private browsing or when the quota is full.
	}
}
