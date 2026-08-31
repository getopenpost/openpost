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
	it('persists capture sources, devices, processing, and video quality together', () => {
		const storage = storageWith();
		const preferences = createRecorderPreferencesStore(storage);

		preferences.set('cameraDeviceId', 'studio-camera');
		preferences.set('microphoneDeviceId', 'studio-mic');
		preferences.set('includeCamera', true);
		preferences.set('videoResolution', '2160p');
		preferences.set('videoFrameRate', 60);
		preferences.set('cameraFacingMode', 'user');
		preferences.set('noiseSuppression', false);
		preferences.set('countdownSeconds', 10);

		const restored = createRecorderPreferencesStore(storage);
		expect(restored.value).toMatchObject({
			cameraDeviceId: 'studio-camera',
			microphoneDeviceId: 'studio-mic',
			includeCamera: true,
			videoResolution: '2160p',
			videoFrameRate: 60,
			cameraFacingMode: 'user',
			noiseSuppression: false,
			countdownSeconds: 10
		});
		expect(storage.setItem).toHaveBeenLastCalledWith(
			RECORDER_PREFERENCES_STORAGE_KEY,
			expect.any(String)
		);
	});

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

	it('keeps recording usable when browser storage is absent or blocked', () => {
		const memoryOnly = createRecorderPreferencesStore(null);
		expect(() => memoryOnly.set('includeCamera', true)).not.toThrow();
		expect(memoryOnly.value.includeCamera).toBe(true);

		const blockedStorage = {
			getItem: vi.fn(() => {
				throw new DOMException('Blocked', 'SecurityError');
			}),
			setItem: vi.fn(() => {
				throw new DOMException('Full', 'QuotaExceededError');
			}),
			removeItem: vi.fn(() => {
				throw new DOMException('Blocked', 'SecurityError');
			})
		};
		const blocked = createRecorderPreferencesStore(blockedStorage);
		expect(blocked.value).toEqual(DEFAULT_RECORDER_PREFERENCES);
		expect(() => blocked.set('countdownSeconds', 10)).not.toThrow();
		expect(() => blocked.reset()).not.toThrow();
	});
});
