import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_RECORDER_PREFERENCES,
	RECORDER_PREFERENCES_STORAGE_KEY,
	createRecorderPreferencesStore
} from './recorder-preferences.svelte';

function storageWith(initial: string | null = null) {
	let value = initial;
	return {
		getItem: vi.fn(() => value),
		setItem: vi.fn((_key: string, next: string) => {
			value = next;
		}),
		removeItem: vi.fn(() => {
			value = null;
		})
	};
}

describe('recorder preferences', () => {
	it('rejects damaged and unsupported stored values without losing valid fields', () => {
		const storage = storageWith(
			JSON.stringify({
				includeScreen: false,
				videoResolution: '8k',
				videoFrameRate: 120,
				countdownSeconds: -1,
				microphoneDeviceId: 42
			})
		);

		const preferences = createRecorderPreferencesStore(storage);

		expect(preferences.value).toEqual({
			...DEFAULT_RECORDER_PREFERENCES,
			includeScreen: false
		});
	});
});
