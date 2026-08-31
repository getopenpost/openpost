/* oxlint-disable anti-slop/no-runtime-typeof -- This module parses localStorage JSON at its I/O boundary and validates every primitive field before use. */
import type {
	RecorderCameraFacingMode,
	RecorderVideoFrameRate,
	RecorderVideoResolution
} from './recorder.svelte';

export const RECORDER_PREFERENCES_STORAGE_KEY = 'openpost-video-editor-recorder-v1';

export type RecorderCursorMode = 'always' | 'motion' | 'never';

export interface RecorderPreferencesValue {
	includeScreen: boolean;
	includeCamera: boolean;
	includeMicrophone: boolean;
	includeSystemAudio: boolean;
	cameraDeviceId: string;
	microphoneDeviceId: string;
	countdownSeconds: 0 | 3 | 5 | 10;
	plannedMinutes: 2 | 5 | 15 | 30;
	videoResolution: RecorderVideoResolution;
	videoFrameRate: RecorderVideoFrameRate;
	cameraFacingMode: RecorderCameraFacingMode;
	noiseSuppression: boolean;
	autoGainControl: boolean;
	cursorMode: RecorderCursorMode;
}

export const DEFAULT_RECORDER_PREFERENCES: RecorderPreferencesValue = {
	includeScreen: true,
	includeCamera: false,
	includeMicrophone: true,
	includeSystemAudio: true,
	cameraDeviceId: '',
	microphoneDeviceId: '',
	countdownSeconds: 0,
	plannedMinutes: 5,
	videoResolution: '1080p',
	videoFrameRate: 30,
	cameraFacingMode: 'default',
	noiseSuppression: true,
	autoGainControl: false,
	cursorMode: 'always'
};

interface RecorderPreferencesStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

type StoredRecorderPreferences = Partial<RecorderPreferencesValue>;

function browserStorage(): RecorderPreferencesStorage | null {
	try {
		return 'localStorage' in globalThis ? globalThis.localStorage : null;
	} catch {
		return null;
	}
}

function parsedObject(value: string): StoredRecorderPreferences {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		// SAFETY: Each optional field is checked below before it enters recorder preferences.
		return parsed as StoredRecorderPreferences;
	} catch {
		return {};
	}
}

function booleanOr(value: boolean | undefined, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function stringOr(value: string | undefined, fallback: string): string {
	return typeof value === 'string' && value.length <= 512 ? value : fallback;
}

function oneOf<T extends string | number>(
	value: T | undefined,
	allowed: readonly T[],
	fallback: T
): T {
	return value !== undefined && allowed.includes(value) ? value : fallback;
}

export function normalizeRecorderPreferences(
	stored: StoredRecorderPreferences
): RecorderPreferencesValue {
	return {
		includeScreen: booleanOr(stored.includeScreen, DEFAULT_RECORDER_PREFERENCES.includeScreen),
		includeCamera: booleanOr(stored.includeCamera, DEFAULT_RECORDER_PREFERENCES.includeCamera),
		includeMicrophone: booleanOr(
			stored.includeMicrophone,
			DEFAULT_RECORDER_PREFERENCES.includeMicrophone
		),
		includeSystemAudio: booleanOr(
			stored.includeSystemAudio,
			DEFAULT_RECORDER_PREFERENCES.includeSystemAudio
		),
		cameraDeviceId: stringOr(stored.cameraDeviceId, ''),
		microphoneDeviceId: stringOr(stored.microphoneDeviceId, ''),
		countdownSeconds: oneOf(stored.countdownSeconds, [0, 3, 5, 10] as const, 0),
		plannedMinutes: oneOf(stored.plannedMinutes, [2, 5, 15, 30] as const, 5),
		videoResolution: oneOf(stored.videoResolution, ['720p', '1080p', '2160p'] as const, '1080p'),
		videoFrameRate: oneOf(stored.videoFrameRate, [24, 30, 60] as const, 30),
		cameraFacingMode: oneOf(
			stored.cameraFacingMode,
			['default', 'user', 'environment'] as const,
			'default'
		),
		noiseSuppression: booleanOr(
			stored.noiseSuppression,
			DEFAULT_RECORDER_PREFERENCES.noiseSuppression
		),
		autoGainControl: booleanOr(
			stored.autoGainControl,
			DEFAULT_RECORDER_PREFERENCES.autoGainControl
		),
		cursorMode: oneOf(stored.cursorMode, ['always', 'motion', 'never'] as const, 'always')
	};
}

export function createRecorderPreferencesStore(
	storage: RecorderPreferencesStorage | null = browserStorage()
) {
	let initial = DEFAULT_RECORDER_PREFERENCES;
	try {
		const saved = storage?.getItem(RECORDER_PREFERENCES_STORAGE_KEY);
		if (saved) initial = normalizeRecorderPreferences(parsedObject(saved));
	} catch {
		initial = DEFAULT_RECORDER_PREFERENCES;
	}
	const state = $state<RecorderPreferencesValue>({ ...initial });

	function persist(): void {
		try {
			storage?.setItem(RECORDER_PREFERENCES_STORAGE_KEY, JSON.stringify(state));
		} catch {
			// Full or blocked storage must not prevent recording.
		}
	}

	return {
		get value(): RecorderPreferencesValue {
			return state;
		},
		set<K extends keyof RecorderPreferencesValue>(
			key: K,
			value: RecorderPreferencesValue[K]
		): void {
			Object.assign(state, normalizeRecorderPreferences({ ...state, [key]: value }));
			persist();
		},
		reset(): void {
			Object.assign(state, DEFAULT_RECORDER_PREFERENCES);
			try {
				storage?.removeItem(RECORDER_PREFERENCES_STORAGE_KEY);
			} catch {
				persist();
			}
		}
	};
}

export type RecorderPreferencesStore = ReturnType<typeof createRecorderPreferencesStore>;

export const recorderPreferences = createRecorderPreferencesStore();
